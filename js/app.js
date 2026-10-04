import { CONFIG } from '../config.js';
import { compile } from './netlist.js';
import { render, truthGrid } from './art.js';
import * as chain from './chain.js';

const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const params = new URLSearchParams(location.search);
let processor = params.get('p') || CONFIG.PROCESSOR || null; // null = not launched yet: show examples
let current = null; // circuit shown in detail view
let account = null;

$('brand-name').textContent = CONFIG.NAME;

// ---------- tabs ----------
function show(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + tab));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => { show(b.dataset.tab); if (b.dataset.tab === 'studio') updateStudio(); });
$('back').onclick = () => { history.replaceState(null, '', processor ? `?p=${processor}` : './'); show('gallery'); };

$('connect').onclick = async () => {
  try { account = await chain.connect(); $('connect').textContent = short(account); updateQuote(); }
  catch (e) { alert(e.message); }
};

// ---------- gallery ----------
async function loadGallery() {
  const card = $('cpu-card'), grid = $('gallery');
  grid.innerHTML = '';
  if (!processor) return showExamples();
  card.innerHTML = '<div class="muted">Reading processor from X Layer…</div>';
  $('foot-cpu').textContent = '· ' + short(processor); $('foot-cpu').href = chain.explorerAddr(processor);
  try {
    const cpu = await chain.readProcessor(processor);
    const isOurs = CONFIG.PROCESSOR && processor.toLowerCase() === CONFIG.PROCESSOR.toLowerCase();
    const earned = cpu.minted * cpu.mintPrice;
    card.innerHTML = `
      <div><span>Processor</span><b>${esc(cpu.name || 'Unnamed')}</b></div>
      <div><span>Artworks</span><b>${cpu.circuitCount}</b></div>
      <div><span>Transistors sold</span><b>${cpu.minted.toLocaleString()} / ${cpu.supplyCap.toLocaleString()}</b></div>
      <div><span>Price</span><b>${chain.fmt(cpu.mintPrice)} OKB</b></div>
      <div><span>Creator earned</span><b>${chain.fmt(earned, 4)} OKB</b></div>
      ${isOurs ? '' : `<div class="muted" style="flex-basis:100%">You're viewing another TapeOut processor as art. <a href="./">Back to ${esc(CONFIG.NAME)}</a></div>`}`;
    if (!cpu.circuitCount) { grid.innerHTML = '<p class="muted">No circuits yet. Make the first one in the Studio.</p>'; return; }
    const ids = Array.from({ length: Math.min(cpu.circuitCount, 48) }, (_, i) => cpu.circuitCount - i);
    for (const id of ids) {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<canvas width="1080" height="1080"></canvas><div><span>#${id}</span><span class="g">…</span></div>`;
      grid.append(el);
      chain.readCircuit(processor, id).then((c) => {
        const t = render(el.querySelector('canvas'), c, { circuitId: id, processor, title: `${cpu.name} #${id}` });
        el.querySelector('.g').textContent = `${t.gates} NAND · ${t.style}`;
        el.onclick = () => openDetail(c, cpu);
      }).catch((e) => {
        el.querySelector('.g').textContent = 'could not load';
        el.title = e.message;
        el.querySelector('canvas').replaceWith(Object.assign(document.createElement('p'), { className: 'card-err', textContent: e.message }));
        console.warn(id, e);
      });
    }
  } catch (e) {
    card.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}
function showExamples() {
  $('cpu-card').innerHTML = `<div style="flex-basis:100%"><span>Coming soon</span><b>The ${esc(CONFIG.NAME)} processor launches on X Layer shortly.</b></div>
    <div class="muted" style="flex-basis:100%">These are example pieces. Tap one to open it in the Studio.</div>`;
  const grid = $('gallery');
  const examples = [['Sierpinski', 5], ['Moiré', 5], ['Weave', 4], ['Lattice', 5], ['Carpet', 5], ['Sierpinski', 6], ['Moiré', 6], ['Lattice', 4]];
  for (const [name, bits] of examples) {
    const c = compile(PRESETS[name](bits), bits);
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<canvas width="1080" height="1080"></canvas><div><span>${esc(name)}</span><span>${c.gateCount} NAND</span></div>`;
    grid.append(el);
    render(el.querySelector('canvas'), c, { title: name, circuitId: `${name}-${bits}` });
    el.onclick = () => { $('preset').value = name; $('bits').value = String(bits); applyPreset(); show('studio'); };
  }
}
$('any-go').onclick = () => {
  const v = $('any-cpu').value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return alert('Paste a processor address (0x + 40 hex characters).');
  processor = v; history.replaceState(null, '', `?p=${v}`); loadGallery();
};

function openDetail(c, cpu) {
  current = { ...c, cpuName: cpu?.name };
  history.replaceState(null, '', `?p=${c.processor}&c=${c.id}`);
  const title = `${cpu?.name || 'Circuit'} #${c.id}`;
  const t = render($('big'), c, { circuitId: c.id, processor: c.processor, title });
  $('d-title').textContent = title;
  const rows = [['Owner', `<a href="${chain.explorerAddr(c.owner)}" target="_blank" rel="noopener">${short(c.owner)}</a>`],
    ['Gates', `${t.gates} NAND${t.latches ? ` + ${t.latches} LATCH` : ''}`], ['Inputs → outputs', `${c.nIn} → ${c.nOut}`],
    ['Canvas', t.grid + (t.inputsFixed ? ` (${t.inputsFixed} inputs fixed)` : '')], ['Style', t.style], ['Palette', `${t.palette}, ${t.colors} colours`],
    ['Lit cells', t.density], ['Processor', `<a href="${chain.explorerAddr(c.processor)}" target="_blank" rel="noopener">${short(c.processor)}</a>`]];
  if (t.stateful) rows.push(['Memory', 'Has latches; state carries cell to cell']);
  $('d-traits').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('d-verify-out').textContent = '';
  $('d-verify').disabled = t.stateful;
  show('detail');
}

$('d-verify').onclick = async () => {
  const c = current; const out = $('d-verify-out');
  out.textContent = 'Asking the processor contract…';
  try {
    const grid = truthGrid(c);
    const block = await chain.blockNumber();
    const total = grid.w * grid.h;
    const picks = [0, total - 1, ...Array.from({ length: 6 }, (_, i) => Math.floor(((i + 1) * total) / 7))];
    let ok = 0;
    for (const input of picks) {
      const got = await chain.evalOnChain(c.processor, c.id, c.nIn, c.nOut, input, '0x' + block.toString(16));
      if (got === grid.cells[input]) ok++;
    }
    out.textContent = ok === picks.length
      ? `✓ ${ok}/${picks.length} sample cells match the contract's own answers at block ${block.toLocaleString()}.`
      : `✗ Only ${ok}/${picks.length} cells matched at block ${block}. Please report this circuit.`;
  } catch (e) { out.textContent = e.message; }
};
$('d-download').onclick = () => {
  const a = document.createElement('a');
  a.download = `ona-${current.id}.png`; a.href = $('big').toDataURL('image/png'); a.click();
};
$('d-share').onclick = () => {
  const url = (CONFIG.SITE_URL || location.origin + location.pathname) + `?p=${current.processor}&c=${current.id}`;
  const text = `My circuit is a piece of art 🎨 ${current.cpuName || 'Circuit'} #${current.id}, drawn from its own NAND logic on @XLayerOfficial via TapeOut.`;
  open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
};

// ---------- studio ----------
const PRESETS = {
  'Sierpinski': (b) => [range(b).map((i) => `~(x${i}&y${i})`).join(' & ')],
  'Moiré': (b) => [`x${b - 3}^y${b - 3}`, `x${b - 2}^y${b - 2}`, `x${b - 1}^y${b - 1}`],
  'Weave': (b) => [`x0^y1`, `x1^y0`, `x${b - 1}^y${b - 1}`],
  'Lattice': (b) => [`(x${b - 1}^y${b - 1}) & ~(x0|y0)`, `x${b - 2}^y${b - 1} ^ (x1&y1)`],
  'Carpet': (b) => [range(b).map((i) => `(x${i}&y${i})`).join(' | '), `x${b - 1}^y${b - 2}`],
  'Blank': () => ['x0^y0'],
};
function range(n) { return Array.from({ length: n }, (_, i) => i); }
$('preset').innerHTML = Object.keys(PRESETS).map((k) => `<option>${k}</option>`).join('');
function applyPreset() {
  const exprs = PRESETS[$('preset').value](Number($('bits').value));
  ['e0', 'e1', 'e2'].forEach((id, i) => $(id).value = exprs[i] || '');
  if (!$('title').value || $('title').dataset.auto) { $('title').value = $('preset').value; $('title').dataset.auto = '1'; }
  updateStudio();
}
$('preset').onchange = applyPreset;
$('bits').onchange = applyPreset;
['e0', 'e1', 'e2'].forEach((id) => $(id).oninput = updateStudio);
$('title').oninput = () => { delete $('title').dataset.auto; updateStudio(); };

let design = null;
function updateStudio() {
  const exprs = ['e0', 'e1', 'e2'].map((id) => $(id).value.trim()).filter(Boolean);
  try {
    design = compile(exprs, Number($('bits').value));
    $('s-error').textContent = '';
    const t = render($('preview'), design, { title: $('title').value || 'Untitled', processor: CONFIG.PROCESSOR || '' });
    $('s-stats').textContent = `${design.gateCount} NAND · ${t.style} · ${t.palette} · ${t.density} lit`;
    $('s-mint').disabled = false;
  } catch (e) { design = null; $('s-error').textContent = e.message; $('s-mint').disabled = true; }
  updateQuote();
}
async function updateQuote() {
  const q = $('s-quote');
  if (!design) { q.textContent = ''; return; }
  if (!CONFIG.PROCESSOR) { q.innerHTML = 'Preview only: the Ọnà processor launches soon.'; $('s-mint').disabled = true; return; }
  try {
    const r = await chain.quote(CONFIG.PROCESSOR, design, account);
    q.innerHTML = `Buy <b>${r.toMint}</b> NAND (${chain.fmt(r.mintValue)} OKB) + tape-out fee ${chain.fmt(r.tapeoutFee)} OKB = <b>${chain.fmt(r.total)} OKB</b> + gas`;
  } catch (e) { q.textContent = e.message; }
}
$('s-mint').onclick = async () => {
  const st = $('s-status'); $('s-mint').disabled = true;
  try {
    const res = await chain.tapeout(CONFIG.PROCESSOR, design, (msg, hash) => {
      st.innerHTML = esc(msg) + (hash ? ` <a href="${chain.explorerTx(hash)}" target="_blank" rel="noopener">view tx</a>` : '');
    });
    st.innerHTML = `Taped out as #${res.id}. <a href="?p=${CONFIG.PROCESSOR}&c=${res.id}">Open your artwork</a>`;
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
    st.innerHTML = `Launched: <b>${r.processor}</b><br>Put this address in <code>config.js</code> as PROCESSOR. <a href="${chain.explorerTx(r.hash)}" target="_blank" rel="noopener">Deploy tx</a>`;
  } catch (e) { st.textContent = e.message; }
};

// ---------- boot ----------
applyPreset();
loadGallery();
if (processor && params.get('c')) {
  Promise.all([chain.readCircuit(processor, params.get('c')), chain.readProcessor(processor)])
    .then(([c, cpu]) => openDetail(c, cpu)).catch((e) => console.warn(e));
}
