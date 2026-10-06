// Turn a circuit's truth table into a deterministic artwork.
// Each grid cell is one input combination; its colour is the circuit's output for that input.
import { decode, compileSim, hexToBytes } from './netlist.js?v=10';

export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Lay out inputs on a square-ish grid and evaluate every cell.
 * Moving pieces (timeBits > 0) put their time inputs after x and y; `frame` picks the time value.
 */
export function truthGrid({ netlistHex, nIn, nOut, timeBits = 0 }, frame = 0) {
  const elements = decode(netlistHex, nIn);
  const run = compileSim(elements, nIn, nOut);
  const moving = timeBits > 0 && (nIn - timeBits) % 2 === 0 && nIn - timeBits <= 14;
  const xBits = moving ? (nIn - timeBits) / 2 : Math.min(7, Math.ceil(nIn / 2));
  const yBits = moving ? xBits : Math.min(7, nIn - xBits);
  const extraBits = nIn - xBits - yBits; // circuits wider than 14 inputs: fix the rest from the netlist hash
  const frames = moving ? 2 ** timeBits : 1;
  const extra = moving ? frame % frames : extraBits > 0 ? (hash32(netlistHex) % 2 ** Math.min(extraBits, 30)) : 0;
  const w = 2 ** xBits, h = 2 ** yBits;
  const cells = new Uint32Array(w * h);
  const stateful = elements.some((e) => e.op === 1);
  let state = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const input = x + y * w + extra * w * h;
    const r = run(input, state);
    if (stateful) state = r.state; // latches carry state across cells in reading order
    cells[y * w + x] = r.out;
  }
  return { w, h, cells, xBits, yBits, extraBits, extra, frames, stateful, gateCount: elements.filter((e) => e.op === 0).length,
    latchCount: elements.filter((e) => e.op === 1).length };
}

export function palette(seed, nOut, theme = 'dark') {
  const r = rng(seed);
  const light = theme === 'light';
  const levels = 2 ** Math.min(nOut, 3);
  const hueA = Math.floor(r() * 360);
  const scheme = Math.floor(r() * 3);
  const offset = [40, 110, 170][scheme]; // analogous, split, contrast
  const hueB = (hueA + offset * (r() < 0.5 ? 1 : -1) + 360) % 360;
  const sat = 72 + Math.floor(r() * 20);
  const bg = light ? `hsl(${hueA}, 40%, 94%)` : `hsl(${hueA}, 28%, 7%)`;
  const colors = [bg];
  for (let v = 1; v < levels; v++) {
    const t = levels > 2 ? (v - 1) / (levels - 2) : 0;
    const d = ((hueB - hueA + 540) % 360) - 180; // shortest way round the colour wheel
    const hue = Math.round((hueA + d * t + 360) % 360);
    const yellowish = hue >= 40 && hue <= 100; // yellows wash out on light backgrounds
    const lum = light ? (levels > 2 ? Math.round(36 + 22 * t) : 46) - (yellowish ? 12 : 0) : (levels > 2 ? Math.round(46 + 26 * t) : 62);
    colors.push(`hsl(${hue}, ${sat}%, ${lum}%)`);
  }
  return { bg, colors, scheme: ['Analogous', 'Split', 'Contrast'][scheme] };
}

const STYLES = ['Tiles', 'Dots', 'Weave', 'Pixels'];

/**
 * Render to a canvas. meta = { title, processor, circuitId, author }.
 * Returns traits shown beside the artwork.
 */
export function render(canvas, circuit, meta = {}) {
  const grid = truthGrid(circuit, meta.frame || 0);
  // The look depends only on the logic, so a Studio preview matches the minted piece exactly.
  const seed = hash32(circuit.netlistHex);
  const theme = meta.theme === 'light' ? 'light' : 'dark';
  const pal = palette(seed, circuit.nOut, theme);
  const ink = theme === 'light' ? '23,20,28' : '255,255,255';
  const style = STYLES[seed % STYLES.length];
  const px = meta.size || 1080; // drawing is done in a 1080 space and scaled to the canvas size
  canvas.width = canvas.height = px;
  const size = 1080;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(px / size, 0, 0, px / size, 0, 0);
  const levels = pal.colors.length;
  const value = (c) => (circuit.nOut <= 3 ? c : (c ^ (c >>> 3) ^ (c >>> 6) ^ (c >>> 9)) & 7) % levels;

  // bare: full-bleed artwork only (hero, thumbnails). Otherwise a framed "chip" with pins and caption.
  const bare = !!meta.bare;
  const pad = bare ? 54 : 96, inner = size - pad * 2;
  if (bare) { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, size, size); }
  else {
    ctx.fillStyle = theme === 'light' ? '#fdfbf7' : '#0d0b11'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = pal.bg;
    roundRect(ctx, pad - 18, pad - 18, inner + 36, inner + 36, 22); ctx.fill();
    ctx.strokeStyle = `rgba(${ink},0.10)`; ctx.lineWidth = 2; ctx.stroke();
    // Pins: inputs on the left/top, outputs on the right — one pin per real signal
    ctx.fillStyle = `rgba(${ink},0.28)`;
    drawPins(ctx, 'left', grid.yBits + grid.extraBits, pad, inner);
    drawPins(ctx, 'top', grid.xBits, pad, inner);
    ctx.fillStyle = pal.colors[levels - 1];
    drawPins(ctx, 'right', circuit.nOut, pad, inner);
  }

  // Cells
  // Square cells, centred, so tiny circuits (e.g. 2×1) still look deliberate.
  const cell = Math.min(inner / grid.w, inner / grid.h);
  const cw = cell, ch = cell;
  const ox = pad + (inner - cell * grid.w) / 2, oy = pad + (inner - cell * grid.h) / 2;
  const counts = new Array(levels).fill(0);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const v = value(grid.cells[y * grid.w + x]);
    counts[v]++;
    if (v === 0) continue;
    ctx.fillStyle = pal.colors[v];
    const cx = ox + x * cw, cy = oy + y * ch;
    const g = Math.min(cw, ch);
    if (style === 'Tiles') { roundRect(ctx, cx + g * 0.08, cy + g * 0.08, cw * 0.84, ch * 0.84, g * 0.18); ctx.fill(); }
    else if (style === 'Dots') { ctx.beginPath(); ctx.arc(cx + cw / 2, cy + ch / 2, g * (0.22 + 0.24 * v / (levels - 1)), 0, Math.PI * 2); ctx.fill(); }
    else if (style === 'Weave') {
      if ((x + y) % 2) ctx.fillRect(cx + cw * 0.1, cy + ch * 0.3, cw * 0.8, ch * 0.4);
      else ctx.fillRect(cx + cw * 0.3, cy + ch * 0.1, cw * 0.4, ch * 0.8);
    } else ctx.fillRect(cx, cy, cw + 0.5, ch + 0.5);
  }

  const lit = counts.slice(1).reduce((a, b) => a + b, 0);
  const traits = {
    style, palette: pal.scheme, colors: levels, grid: `${grid.w}×${grid.h}`,
    density: `${Math.round((lit / (grid.w * grid.h)) * 100)}%`,
    gates: grid.gateCount, latches: grid.latchCount, stateful: grid.stateful,
    inputsShown: grid.xBits + grid.yBits, inputsFixed: grid.frames > 1 ? 0 : grid.extraBits, frames: grid.frames,
    // where the cells sit (in the 1080 drawing space), so a tap can be mapped back to its input
    geo: { ox, oy, cell, w: grid.w, h: grid.h, xBits: grid.xBits, extra: grid.extra, cells: grid.cells, nOut: circuit.nOut },
  };
  if (bare) return traits;

  // Caption
  ctx.fillStyle = `rgba(${ink},0.85)`;
  ctx.font = '600 30px "Geist", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(meta.title || 'Untitled circuit', pad - 18, size - 30);
  ctx.textAlign = 'right';
  ctx.fillStyle = `rgba(${ink},0.5)`;
  ctx.font = '500 22px "Geist Mono", ui-monospace, monospace';
  const tag = [meta.circuitId ? `#${meta.circuitId}` : meta.tagline || 'preview', `${grid.gateCount} NAND`, grid.latchCount ? `${grid.latchCount} LATCH` : ''].filter(Boolean).join(' · ');
  ctx.fillText(tag, size - pad + 18, size - 30);
  ctx.textAlign = 'left';
  ctx.font = '500 20px "Geist Mono", ui-monospace, monospace';
  ctx.fillText(meta.processor ? `${meta.processor.slice(0, 6)}…${meta.processor.slice(-4)} · X Layer` : 'Ọnà · X Layer', pad - 18, 36);

  return traits;
}

function drawPins(ctx, side, n, pad, inner) {
  if (!n) return;
  for (let i = 0; i < n; i++) {
    const t = pad + ((i + 0.5) / n) * inner;
    if (side === 'left') ctx.fillRect(pad - 46, t - 3, 22, 6);
    if (side === 'right') ctx.fillRect(pad + inner + 24, t - 3, 22, 6);
    if (side === 'top') ctx.fillRect(t - 3, pad - 46, 6, 22);
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export { hexToBytes };
