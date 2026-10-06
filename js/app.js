import { CONFIG } from '../config.js?v=11';
import { compile, netlistToExprs } from './netlist.js?v=11';
import { render, truthGrid, hash32 } from './art.js?v=11';
import * as chain from './chain.js?v=11';

const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const params = new URLSearchParams(location.search);
let processor = params.get('p') || CONFIG.PROCESSOR || null; // null = not launched yet: show examples
let current = null; // circuit shown in detail view
let account = null;
let cpuInfo = null; // the gallery processor, once read

// ---------- theme ----------
const theme = () => 'light'; // dark mode comes later; its colours are already in style.css
const painted = new Set(); // every canvas we draw, so a theme switch can repaint it
let frame = 0; // animation frame for moving pieces
function paint(canvas, circuit, meta) {
  painted.add(canvas);
  canvas._art = { circuit, meta };
  return (canvas._traits = render(canvas, circuit, { ...meta, theme: theme(), frame }));
}
function repaintAll(movingOnly = false) {
  for (const c of painted) {
    if (!c.isConnected) { painted.delete(c); continue; }
    if (movingOnly && !c._art.circuit.timeBits) continue;
    c._traits = render(c, c._art.circuit, { ...c._art.meta, theme: theme(), frame });
  }
}
document.fonts?.ready.then(repaintAll); // canvas captions use Geist; redraw once it has loaded

// ---------- sections ----------
// Gallery, Studio and About live on one page; the nav scrolls to them. Only the detail view replaces the page.
const PAGE = ['gallery', 'studio', 'about'];
function setNav(tab) { document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); }
function show(tab) {
  const detail = tab === 'detail';
  $('tab-detail').classList.toggle('on', detail);
  PAGE.forEach((t) => $('tab-' + t).classList.toggle('on', !detail));
  if (detail) { scrollTo(0, 0); return; }
  setNav(tab);
  if (tab === 'gallery') scrollTo({ top: 0, behavior: 'smooth' });
  else $('tab-' + tab).scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.querySelectorAll('nav button, [data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab || b.dataset.go)));
// highlight the nav button for whichever section is in view
if ('IntersectionObserver' in window) {
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => seen.set(e.target.id.slice(4), e.isIntersecting ? e.intersectionRatio : 0));
    if ($('tab-detail').classList.contains('on')) return;
    const best = PAGE.reduce((a, t) => ((seen.get(t) || 0) > (seen.get(a) || 0) ? t : a), 'gallery');
    if (seen.get(best)) setNav(best);
  }, { rootMargin: '-35% 0px -45% 0px', threshold: [0, .01, .5, 1] });
  PAGE.forEach((t) => io.observe($('tab-' + t)));
}
$('back').onclick = () => { history.replaceState(null, '', processor ? `?p=${processor}` : './'); show('gallery'); };

$('connect').onclick = async () => {
  try { account = await chain.connect(); $('connect').textContent = short(account); updateQuote(); }
  catch (e) { alert(e.message); }
};

// ---------- patterns ----------
const range = (n) => Array.from({ length: n }, (_, i) => i);
const PRESETS = {
  'Sierpinski': (b) => [range(b).map((i) => `~(x${i}&y${i})`).join(' & ')],
  'Moiré': (b) => [`x${b - 3}^y${b - 3}`, `x${b - 2}^y${b - 2}`, `x${b - 1}^y${b - 1}`],
  'Weave': (b) => [`x0^y1`, `x1^y0`, `x${b - 1}^y${b - 1}`],
  'Lattice': (b) => [`(x${b - 1}^y${b - 1}) & ~(x0|y0)`, `x${b - 2}^y${b - 1} ^ (x1&y1)`],
  'Carpet': (b) => [range(b).map((i) => `(x${i}&y${i})`).join(' | '), `x${b - 1}^y${b - 2}`],
  'Kente': (b) => [`x${b - 1}^y${b - 2}`, `(x1^y1)&x${b - 2}`, `y0&~x0`],
};
// Motion: each layer also flips with the time inputs t0–t2, so every frame (t = 0…7) is a different picture.
const TIME_BITS = 3;
const withMotion = (exprs, b) => exprs.map((e, k) =>
  `(${e}) ^ (t${k % 3} & x${b - 1}) ^ (t${(k + 1) % 3} & y${b - 1}) ^ (t${(k + 2) % 3} & x${Math.max(0, b - 2)})`);
const design = (name, bits, tb = 0) => compile(tb ? withMotion(PRESETS[name](bits), bits) : PRESETS[name](bits), bits, tb);
// Circuits read from the Ọnà processor with an odd input count are moving pieces (3 time inputs).
const withTime = (c) => ({ ...c, timeBits: CONFIG.PROCESSOR && c.processor?.toLowerCase() === CONFIG.PROCESSOR.toLowerCase()
  && c.nIn % 2 === 1 && c.nIn >= 2 * 2 + TIME_BITS ? TIME_BITS : 0 });

/** Random but pleasing rules: mostly high bits for bold shapes, some low bits for texture. */
function surprise(bits, rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const hi = () => Math.max(0, bits - 1 - Math.floor(rand() * Math.min(3, bits)));
  const any = () => Math.floor(rand() * bits);
  const term = () => pick([
    () => `x${hi()}^y${hi()}`, () => `x${any()}&y${any()}`, () => `~(x${hi()}|y${any()})`,
    () => `(x${any()}^y${hi()})&x${hi()}`, () => `x${hi()}^y${any()}^x${any()}`,
  ])();
  for (let attempt = 0; attempt < 30; attempt++) {
    const layers = 1 + Math.floor(rand() * 3);
    const exprs = range(layers).map(() => {
      let e = term();
      const extra = Math.floor(rand() * 2);
      for (let k = 0; k < extra; k++) e = `(${e}) ${pick(['^', '&', '|'])} (${term()})`;
      return e;
    });
    const c = compile(exprs, bits);
    const g = truthGrid(c);
    const lit = g.cells.reduce((n, v) => n + (v ? 1 : 0), 0) / g.cells.length;
    if (lit > 0.15 && lit < 0.85 && c.gateCount >= 8 && c.gateCount <= 40) return exprs;
  }
  return PRESETS.Moiré(bits);
}

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- moving pieces ----------
// Every moving piece steps through its 8 frames together. Each frame is the same circuit with a different time input.
if (!calm) setInterval(() => { if (document.hidden) return; frame = (frame + 1) % 2 ** TIME_BITS; repaintAll(true); }, 650);

// ---------- tap a tile ----------
// Map a tap back to its cell and say which question that tile asked the circuit, and what it answered.
let tipTimer = null;
function inspect(e) {
  const cv = e.currentTarget, g = cv._traits?.geo;
  if (!g) return;
  const r = cv.getBoundingClientRect(), k = 1080 / r.width;
  const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
  const col = Math.floor((px - g.ox) / g.cell), row = Math.floor((py - g.oy) / g.cell);
  const tip = $('tip');
  if (col < 0 || row < 0 || col >= g.w || row >= g.h) { tip.hidden = true; return; }
  const v = g.cells[row * g.w + col];
  const answer = range(g.nOut).map((i) => (v >> i) & 1).join(' ');
  const moving = cv._traits.frames > 1;
  // read the colour straight off the canvas so the swatch is exactly what the tile shows
  const ctx = cv.getContext('2d'), s = cv.width / 1080;
  const [cr, cg, cb] = ctx.getImageData(Math.floor((g.ox + (col + 0.5) * g.cell) * s), Math.floor((g.oy + (row + 0.5) * g.cell) * s), 1, 1).data;
  tip.innerHTML = `This tile asks the circuit: column <b>${col}</b>, row <b>${row}</b>${moving ? `, time <b>${g.extra}</b>` : ''}.<br>
    It answered <b>${answer}</b>${g.nOut > 1 ? ' (one bit per colour layer)' : ''}${v ? `, which paints this colour <span class="sw" style="background:rgb(${cr},${cg},${cb})"></span>` : ', so the tile stays empty'}.`;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX - w / 2)) + 'px';
  tip.style.top = (e.clientY - h - 14 < 8 ? e.clientY + 18 : e.clientY - h - 14) + 'px';
  clearTimeout(tipTimer); tipTimer = setTimeout(() => { tip.hidden = true; }, 4500);
}
document.querySelectorAll('canvas.inspect').forEach((c) => c.addEventListener('click', inspect));
addEventListener('scroll', () => { $('tip').hidden = true; }, { passive: true });

// ---------- how it works: four boxes that stack as you scroll ----------
{
  const story = $('story'), cards = [...story.querySelectorAll('.story-card')];
  const rule = design('Sierpinski', 4);
  $('v-rule').textContent = PRESETS.Sierpinski(4)[0];
  $('v-gatecount').textContent = `${rule.gateCount} NAND gates`;
  const cols = ['--pink', '--gold', '--teal'];
  $('v-gates').innerHTML = range(rule.gateCount).map((i) => `<i style="--i:${i};--c:var(${cols[i % 3]})"></i>`).join('');
  paint($('v-paint'), design('Moiré', 5), { bare: true });
  const kente = design('Kente', 5);
  paint($('v-mint'), kente, { bare: true });
  $('v-mintgates').textContent = `${kente.gateCount} transistors`;
  if (calm) { story.classList.add('calm'); cards.forEach((c) => c.classList.add('is-on')); }
  else {
    // each box plays its little animation while it's on screen, and replays every few seconds
    const replay = (c) => { // snap back to the start, then play again
      c.classList.add('reset'); c.classList.remove('is-on'); void c.offsetWidth;
      c.classList.remove('reset'); void c.offsetWidth; c.classList.add('is-on');
    };
    const live = new Map();
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const c = e.target;
      if (e.isIntersecting && !live.has(c)) { replay(c); live.set(c, setInterval(() => replay(c), 8000)); }
      else if (!e.isIntersecting && live.has(c)) { clearInterval(live.get(c)); live.delete(c); c.classList.remove('is-on'); }
    }), { threshold: .4 });
    cards.forEach((c) => io.observe(c));
    // the box underneath shrinks a little as the next one slides over it
    const onScroll = () => cards.forEach((c, i) => {
      const next = cards[i + 1];
      c.classList.toggle('covered', !!next && next.getBoundingClientRect().top - c.getBoundingClientRect().top < 60);
    });
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
}

// ---------- reveal on scroll ----------
const revealer = 'IntersectionObserver' in window && !calm
  ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' })
  : null;
function reveal(el) { if (!revealer) return; el.classList.add('reveal'); revealer.observe(el); }
document.querySelectorAll('.section-head, .cpu-card, .studio .frame, .studio .controls, .story-head, #tab-about .prose').forEach(reveal);

// ---------- hero ----------
const HERO = [['Sierpinski', 6], ['Moiré', 5], ['Kente', 5], ['Carpet', 5], ['Weave', 4], ['Lattice', 6]];
let heroIndex = 0;
// caption "decodes": random glyphs settle into the real text left to right
function decode(el, text, ms = 700) {
  const glyphs = '01░▒▓<>/#*';
  const t0 = performance.now();
  (function frame(now) {
    const k = Math.min(1, (now - t0) / ms), fixed = Math.floor(k * text.length);
    el.textContent = text.slice(0, fixed) + [...text.slice(fixed)].map(ch => ch === ' ' ? ' ' : glyphs[Math.random() * glyphs.length | 0]).join('');
    if (k < 1) requestAnimationFrame(frame);
  })(t0);
}
function heroShow(i) {
  const [name, bits] = HERO[i % HERO.length];
  const c = design(name, bits), card = $('hero-card'), art = $('hero-a');
  const caption = `${name} · ${c.gateCount} NAND · ${1 << (2 * bits)} tiles`;
  if (calm || !card.animate || i === 0) { paint(art, c, { bare: true }); $('hero-cap').textContent = caption; return; }
  // the front card lifts off and glides away, the next one rises from the stack behind it
  const out = card.animate([
    { transform: 'none', opacity: 1 },
    { transform: 'translate3d(-4%,-6%,80px) rotateX(8deg) rotateY(-14deg) rotateZ(-4deg)', opacity: 1, offset: .35 },
    { transform: 'translate3d(-60%,-2%,40px) rotateY(-32deg) rotateZ(-12deg)', opacity: 0 }
  ], { duration: 750, easing: 'cubic-bezier(.5,0,.75,0)' });
  $('hero-stage').classList.add('shuffle');
  out.onfinish = () => {
    paint(art, c, { bare: true });
    decode($('hero-cap'), caption);
    $('hero-stage').classList.remove('shuffle');
    card.animate([
      { transform: 'translate3d(5%,-5%,-120px) rotateZ(4deg) scale(.94)', opacity: 0, filter: 'blur(4px)' },
      { transform: 'none', opacity: 1, filter: 'none' }
    ], { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' });
    $('hero-sheen').animate([{ opacity: 0, backgroundPosition: '120% 0' }, { opacity: 1, offset: .3 }, { opacity: 0, backgroundPosition: '-20% 0' }], { duration: 1300, delay: 250, easing: 'ease-out' });
  };
}
heroShow(0);
// gentle 3D tilt that follows the pointer on desktop
if (!calm && matchMedia('(hover: hover)').matches) {
  const stage = $('hero-stage'), tilt = $('hero-tilt');
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    tilt.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
  });
  stage.addEventListener('pointerleave', () => { tilt.style.transform = ''; });
}
if (!calm) setInterval(() => heroShow(++heroIndex), 5000);

// ---------- gallery ----------
function card({ title, sub, right, onClick }) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<canvas width="480" height="480"></canvas><div class="meta"><b></b><div><span class="sub"></span><span class="price"></span></div></div>`;
  el.querySelector('b').textContent = title;
  el.querySelector('.sub').textContent = sub;
  el.querySelector('.price').textContent = right || '';
  if (onClick) el.onclick = onClick;
  $('gallery').append(el);
  reveal(el);
  return el;
}
const piecePrice = (gates) => cpuInfo ? `${chain.fmt(BigInt(gates) * cpuInfo.mintPrice + cpuInfo.protocolFee + cpuInfo.tapeoutFee, 4)} OKB` : '';

async function loadGallery() {
  const info = $('cpu-card');
  $('gallery').innerHTML = '';
  if (!processor) return showExamples();
  $('gallery-title').textContent = 'Gallery';
  info.innerHTML = '<div class="muted">Reading from X Layer…</div>';
  $('foot-cpu').textContent = '· ' + short(processor); $('foot-cpu').href = chain.explorerAddr(processor);
  try {
    const cpu = cpuInfo = await chain.readProcessor(processor);
    const isOurs = CONFIG.PROCESSOR && processor.toLowerCase() === CONFIG.PROCESSOR.toLowerCase();
    $('gallery-title').textContent = isOurs ? 'Gallery' : esc(cpu.name || 'Processor');
    info.innerHTML = `
      <div><span>Processor</span><b>${esc(cpu.name || 'Unnamed')}</b></div>
      <div><span>Artworks</span><b>${cpu.circuitCount}</b></div>
      <div><span>Transistors sold</span><b>${cpu.minted.toLocaleString()} / ${cpu.supplyCap.toLocaleString()}</b></div>
      <div><span>Price each</span><b>${chain.fmt(cpu.mintPrice)} OKB</b></div>
      ${isOurs ? '' : `<div class="muted" style="flex-basis:100%">You're viewing another TapeOut processor as art. <a href="./">Back to ${esc(CONFIG.NAME)}</a></div>`}`;
    if (!cpu.circuitCount) { $('gallery').innerHTML = '<p class="muted">No artworks yet. Be the first in the Studio.</p>'; return; }
    for (const id of range(Math.min(cpu.circuitCount, 48)).map((i) => cpu.circuitCount - i)) {
      const el = card({ title: `${cpu.name || 'Circuit'} #${id}`, sub: 'Loading…' });
      chain.readCircuit(processor, id).then(withTime).then((c) => {
        const t = paint(el.querySelector('canvas'), c, { bare: true, size: 480, circuitId: id });
        el.querySelector('.sub').textContent = `${short(c.owner)} · ${t.gates} NAND`;
        el.onclick = () => openDetail(c, cpu);
      }).catch((e) => {
        el.querySelector('.sub').textContent = 'Could not load';
        el.querySelector('canvas').replaceWith(Object.assign(document.createElement('p'), { className: 'card-err', textContent: e.message }));
      });
    }
  } catch (e) { info.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
function showExamples() {
  $('gallery-title').textContent = 'Example pieces';
  $('cpu-card').innerHTML = `<div style="flex-basis:100%"><span>Coming soon</span><b>The ${esc(CONFIG.NAME)} processor launches on X Layer shortly.</b></div>
    <div class="muted" style="flex-basis:100%">These pieces are previews. Tap one to make it yours in the Studio.</div>`;
  const examples = [['Sierpinski', 5], ['Moiré', 5, 1], ['Kente', 5], ['Weave', 4], ['Lattice', 5, 1], ['Carpet', 5], ['Sierpinski', 6], ['Kente', 6, 1]];
  for (const [name, bits, moving] of examples) {
    const c = design(name, bits, moving ? TIME_BITS : 0);
    const el = card({ title: name, sub: `${c.gateCount} NAND${moving ? ' · moving' : ''}`, right: 'Preview',
      onClick: () => { setMotion(moving ? TIME_BITS : 0); selectPreset(name, bits); show('studio'); } });
    paint(el.querySelector('canvas'), c, { bare: true, size: 480 });
  }
}
$('any-form').onsubmit = (ev) => {
  ev.preventDefault();
  const v = $('any-cpu').value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return alert('Paste a processor address (0x + 40 hex characters).');
  processor = v; history.replaceState(null, '', `?p=${v}`); loadGallery();
};

function openDetail(c, cpu) {
  current = { ...c, cpuName: cpu?.name };
  history.replaceState(null, '', `?p=${c.processor}&c=${c.id}`);
  const title = `${cpu?.name || 'Circuit'} #${c.id}`;
  const t = paint($('big'), c, { circuitId: c.id, processor: c.processor, title });
  $('d-title').textContent = title;
  const rows = [['Owner', `<a href="${chain.explorerAddr(c.owner)}" target="_blank" rel="noopener">${short(c.owner)}</a>`],
    ['Size', `${t.gates} NAND${t.latches ? ` + ${t.latches} LATCH` : ''}`], ['Inputs → outputs', `${c.nIn} → ${c.nOut}`],
    ['Canvas', t.grid + (t.inputsFixed ? ` (${t.inputsFixed} inputs fixed)` : '')], ['Style', t.style], ['Palette', `${t.palette}, ${t.colors} colours`],
    ['Lit cells', t.density], ['Processor', `<a href="${chain.explorerAddr(c.processor)}" target="_blank" rel="noopener">${short(c.processor)}</a>`]];
  if (t.frames > 1) rows.push(['Motion', `${t.frames} frames, one per value of time`]);
  if (t.stateful) rows.push(['Memory', 'Has latches; state carries cell to cell']);
  $('d-traits').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('d-verify-out').textContent = '';
  $('d-verify').disabled = t.stateful;
  remixFrom = netlistToExprs(c);
  $('d-remix').hidden = !remixFrom;
  show('detail');
}
$('d-verify').onclick = async () => {
  const c = current; const out = $('d-verify-out');
  out.textContent = 'Asking the processor contract…';
  try {
    const grid = truthGrid(c, frame); // for a moving piece, check the frame on screen
    const block = await chain.blockNumber();
    const total = grid.w * grid.h;
    const picks = [0, total - 1, ...range(6).map((i) => Math.floor(((i + 1) * total) / 7))];
    let ok = 0;
    for (const cell of picks) {
      const input = cell + grid.extra * total; // inputs beyond the grid (time, or fixed extras) sit above x and y
      const got = await chain.evalOnChain(c.processor, c.id, c.nIn, c.nOut, input, '0x' + block.toString(16));
      if (got === grid.cells[cell]) ok++;
    }
    const at = grid.frames > 1 ? ` (frame ${grid.extra + 1} of ${grid.frames})` : '';
    out.textContent = ok === picks.length
      ? `✓ ${ok}/${picks.length} sample cells${at} match the contract's own answers at block ${block.toLocaleString()}.`
      : `✗ Only ${ok}/${picks.length} cells matched at block ${block}. Please report this circuit.`;
  } catch (e) { out.textContent = e.message; }
};
$('d-download').onclick = () => {
  const a = document.createElement('a');
  a.download = `ona-${current.id}.png`; a.href = $('big').toDataURL('image/png'); a.click();
};
$('d-share').onclick = () => {
  const url = (CONFIG.SITE_URL || location.origin + location.pathname) + `?p=${current.processor}&c=${current.id}`;
  const text = `${current.cpuName || 'Circuit'} #${current.id}: a piece of art drawn from its own on-chain logic. Made with Ọnà on @XLayerOfficial via TapeOut.`;
  open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
};

$('d-remix').onclick = () => {
  if (!remixFrom) return;
  presetName = null; source = 'remix';
  bits = remixFrom.bits; setMotion(remixFrom.timeBits ? TIME_BITS : 0, false);
  document.querySelectorAll('#bits button').forEach((x) => x.classList.toggle('on', Number(x.dataset.bits) === bits));
  setExprs(remixFrom.exprs);
  $('title').value = `Remix of ${$('d-title').textContent}`.slice(0, 40); delete $('title').dataset.auto;
  document.querySelector('.advanced').open = true;
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
  history.replaceState(null, '', processor && processor !== CONFIG.PROCESSOR ? `?p=${processor}` : './');
  updateStudio(); show('studio');
};

// ---------- studio ----------
let bits = 5, presetName = 'Sierpinski', studioDesign = null;
let timeBits = 0;            // 0 = still, TIME_BITS = moving
let source = 'preset';       // where the rules came from: preset | surprise | wallet | remix | typed
let baseExprs = null;        // rules before motion is added (preset, surprise, wallet)
let remixFrom = null;        // rules recovered from the piece open in the detail view
function buildChips() {
  const box = $('patterns'); box.innerHTML = '';
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip' + (name === presetName ? ' on' : '');
    b.innerHTML = `<canvas width="160" height="160"></canvas><span>${esc(name)}</span>`;
    b.onclick = () => selectPreset(name, bits);
    box.append(b);
    paint(b.querySelector('canvas'), design(name, bits, timeBits), { bare: true, size: 160 });
  }
}
function setExprs(exprs) { ['e0', 'e1', 'e2'].forEach((id, i) => { $(id).value = exprs[i] || ''; }); }
const applyBase = () => setExprs(timeBits ? withMotion(baseExprs, bits) : baseExprs);
function setMotion(tb, rebuild = true) {
  timeBits = tb;
  document.querySelectorAll('#motion button').forEach((x) => x.classList.toggle('on', Number(x.dataset.m) === (tb ? 1 : 0)));
  if (!rebuild) return;
  if (baseExprs && source !== 'remix' && source !== 'typed') applyBase();
  buildChips(); updateStudio();
}
document.querySelectorAll('#motion button').forEach((b) => b.onclick = () => setMotion(b.dataset.m === '1' ? TIME_BITS : 0));
function setAutoTitle(t) { if (!$('title').value || $('title').dataset.auto) { $('title').value = t; $('title').dataset.auto = '1'; } }
function selectPreset(name, b = bits) {
  presetName = name; bits = b; source = 'preset';
  document.querySelectorAll('#bits button').forEach((x) => x.classList.toggle('on', Number(x.dataset.bits) === bits));
  baseExprs = PRESETS[name](bits); applyBase();
  setAutoTitle(name);
  buildChips(); updateStudio();
}
// A wallet always gets the same rules: its address seeds the random choices.
function walletRand(addr) {
  let seed = hash32(addr.toLowerCase());
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function fromWallet() {
  presetName = null; source = 'wallet';
  baseExprs = surprise(bits, walletRand(account)); applyBase();
  $('title').value = short(account); $('title').dataset.auto = '1';
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
  updateStudio();
}
$('from-wallet').onclick = async () => {
  try { if (!account) { account = await chain.connect(); $('connect').textContent = short(account); } fromWallet(); }
  catch (e) { $('s-error').textContent = e.message; }
};
document.querySelectorAll('#bits button').forEach((b) => b.onclick = () => {
  bits = Number(b.dataset.bits);
  document.querySelectorAll('#bits button').forEach((x) => x.classList.toggle('on', x === b));
  if (source === 'preset' && presetName) return selectPreset(presetName, bits);
  if (source === 'wallet' && account) { buildChips(); return fromWallet(); }
  source = 'surprise'; baseExprs = surprise(bits); applyBase(); buildChips(); updateStudio();
});
$('surprise').onclick = () => {
  presetName = null; source = 'surprise';
  baseExprs = surprise(bits); applyBase();
  setAutoTitle(`Untitled ${Math.floor(Math.random() * 9000 + 1000)}`);
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
  updateStudio();
};
['e0', 'e1', 'e2'].forEach((id) => $(id).oninput = () => { presetName = null; source = 'typed'; document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); updateStudio(); });
$('title').oninput = () => { delete $('title').dataset.auto; updateStudio(); };

function updateStudio() {
  const exprs = ['e0', 'e1', 'e2'].map((id) => $(id).value.trim()).filter(Boolean);
  try {
    studioDesign = compile(exprs, bits, timeBits);
    $('s-error').textContent = '';
    const t = paint($('preview'), studioDesign, { title: $('title').value || 'Untitled', processor: CONFIG.PROCESSOR || '', tagline: 'preview' });
    $('s-gates').textContent = `${studioDesign.gateCount} NAND`;
    $('s-style').textContent = t.style;
    $('s-mint').disabled = false;
  } catch (e) { studioDesign = null; $('s-error').textContent = e.message; $('s-mint').disabled = true; }
  updateQuote();
}
async function updateQuote() {
  const q = $('s-quote');
  if (!studioDesign) { q.textContent = ''; $('s-price').textContent = '–'; return; }
  if (!CONFIG.PROCESSOR) {
    $('s-price').textContent = 'Soon';
    q.textContent = 'Minting opens when the Ọnà processor launches. You can still design and preview.';
    $('s-mint').disabled = true; return;
  }
  try {
    const r = await chain.quote(CONFIG.PROCESSOR, studioDesign, account);
    $('s-price').textContent = `${chain.fmt(r.total, 4)} OKB`;
    q.innerHTML = `${r.toMint} transistors (${chain.fmt(r.mintValue)} OKB) + tape-out fee ${chain.fmt(r.tapeoutFee)} OKB, plus a tiny network fee.`;
  } catch (e) { q.textContent = e.message; }
}
$('s-mint').onclick = async () => {
  const st = $('s-status'); $('s-mint').disabled = true;
  try {
    const res = await chain.tapeout(CONFIG.PROCESSOR, studioDesign, (msg, hash) => {
      st.innerHTML = esc(msg) + (hash ? ` <a href="${chain.explorerTx(hash)}" target="_blank" rel="noopener">view tx</a>` : '');
    });
    st.innerHTML = `Done! Taped out as #${res.id}. <a href="?p=${CONFIG.PROCESSOR}&c=${res.id}">Open your artwork</a>`;
  } catch (e) { st.textContent = e.message; }
  finally { $('s-mint').disabled = false; }
};

// ---------- launch (processor owner) ----------
$('l-go').onclick = async () => {
  const st = $('l-status');
  try {
    const supply = BigInt($('l-supply').value.replace(/[,_\s]/g, ''));
    const price = chain.parseOkb($('l-price').value);
    if (!confirm(`Launch "${$('l-name').value}" with ${supply.toLocaleString()} transistors at ${chain.fmt(price)} OKB each?\n\nThis can never be changed.`)) return;
    const r = await chain.launchProcessor({ name: $('l-name').value, symbol: $('l-symbol').value, story: $('l-story').value,
      supply, mintPriceWei: price, onStatus: (m, h) => st.innerHTML = esc(m) + (h ? ` <a href="${chain.explorerTx(h)}" target="_blank" rel="noopener">tx</a>` : '') });
    st.innerHTML = `Launched: <b>${r.processor}</b><br>Send this address to be added to the site. <a href="${chain.explorerTx(r.hash)}" target="_blank" rel="noopener">Deploy tx</a>`;
  } catch (e) { st.textContent = e.message; }
};

// ---------- boot ----------
selectPreset('Sierpinski', 5);
loadGallery();
if (processor && params.get('c')) {
  Promise.all([chain.readCircuit(processor, params.get('c')).then(withTime), chain.readProcessor(processor)])
    .then(([c, cpu]) => openDetail(c, cpu)).catch((e) => console.warn(e));
}
