// X Layer TapeOut adapter: read processors and circuits, and send the wallet transactions
// to launch a processor, mint NAND transistors and tape out a circuit.
// Selectors, event topics and the factory address follow the shipped TapeOut client, as
// documented by CircuitDesk (MIT): github.com/diveyreadytodive-star/circuitdesk-ignix-tapeout
import { CONFIG } from '../config.js?v=7';

export const PLATFORM = Object.freeze({
  chainId: 196, chainIdHex: '0xc4', chainName: 'X Layer',
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  factoryImplementation: '0x74956236ab64ed143933040b4137e8a352e4d17b',
  explorer: 'https://www.oklink.com/xlayer',
  rpcs: ['https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com', 'https://xlayer.drpc.org'],
});
const SEL = {
  cpuCount: 'a94da8a7', cpuAt: '4bc7cbbd', isCPU: '5f5a364f', deployFee: 'eb2a5d2c',
  factory: 'c45a0155', transistors: '6fbd1719', nextId: '61b8ce8c',
  circuitInfo: '084d60f1', ownerOf: '6352211e', netlist: '3fc4be56', eval: '934d06ea',
  tapeoutFee: 'adfb2b69', supplyCap: '8f770ad0', minted: '4f02c420',
  mintPrice: '6817c76c', protocolFee: 'b0e21e8a', creator: '02d05d3f',
  circuits: '5f48772d', cpuName: '700ed104', story: '46c922d1', balanceOf: '00fdd58e',
  createCPU: '47f9b5fd', mint: '1b2ef1ca', tapeout: '7bd3ac1d',
};
const CPU_CREATED = '0x2e8868f18a1eaf0222b5b09484fdf12163e9741393f8457cd79d2ae42b2d2290';
const TAPED_OUT = '0xc11215e417669c143c8a07aeb778034c0a0a85ebdf305d64a629b19a7a9ce031';
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const enc = new TextEncoder(), dec = new TextDecoder();

const isAddr = (v) => /^0x[0-9a-fA-F]{40}$/.test(String(v));
const addr = (v) => { if (!isAddr(v)) throw new Error('Expected a 0x… contract address.'); return String(v).toLowerCase(); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const addrWord = (v) => addr(v).slice(2).padStart(64, '0');
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (v) => Uint8Array.from(String(v).replace(/^0x/, '').match(/../g)?.map((x) => parseInt(x, 16)) ?? []);
const dyn = (bytes) => word(bytes.length) + hex(bytes).padEnd(Math.ceil(bytes.length / 32) * 64, '0');
const readWord = (data, i = 0) => BigInt('0x' + (String(data).replace(/^0x/, '').slice(i * 64, (i + 1) * 64) || '0'));
const readAddr = (data, i = 0) => '0x' + readWord(data, i).toString(16).padStart(40, '0');
function readBytes(data) {
  const raw = String(data).replace(/^0x/, '');
  const start = Number(readWord(raw, 0));
  const len = Number(BigInt('0x' + raw.slice(start * 2, start * 2 + 64)));
  return fromHex(raw.slice((start + 32) * 2, (start + 32 + len) * 2));
}
const call = (sel, ...args) => '0x' + SEL[sel] + args.map(word).join('');
const callA = (sel, a) => '0x' + SEL[sel] + addrWord(a);

// Public RPCs rate-limit bursts, so keep a few requests in flight and retry with backoff.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting = [];
async function slot() {
  if (inFlight < MAX_IN_FLIGHT) { inFlight++; return; }
  await new Promise((resolve) => waiting.push(resolve));
  inFlight++;
}
function release() { inFlight--; waiting.shift()?.(); }

async function rpcOnce(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) {
    const e = new Error(body.error.message || 'RPC error');
    e.revert = /revert|execution/i.test(e.message); // a contract answer, not a server problem
    throw e;
  }
  return body.result;
}
async function rpc(method, params = []) {
  await slot();
  try {
    let last;
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const url of PLATFORM.rpcs) {
        try { return await rpcOnce(url, method, params); }
        catch (e) { if (e.revert) throw e; last = e; }
      }
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
    throw new Error(`X Layer RPC unavailable (${last?.message ?? 'unknown'}).`);
  } finally { release(); }
}
const ethCall = (to, data, block = 'latest') => rpc('eth_call', [{ to: addr(to), data }, block]);
const uintAt = async (to, sel, ...a) => readWord(await ethCall(to, call(sel, ...a)));

// ---------------- reads ----------------
export async function readProcessor(contract) {
  const cpu = addr(contract);
  if (readWord(await ethCall(PLATFORM.factory, callA('isCPU', cpu))) !== 1n)
    throw new Error('That address is not a processor from the X Layer TapeOut factory.');
  const [trRaw, nextId, tapeoutFee] = await Promise.all([
    ethCall(cpu, call('transistors')), uintAt(cpu, 'nextId'), uintAt(cpu, 'tapeoutFee')]);
  const tr = readAddr(trRaw);
  const [backlink, supplyCap, minted, mintPrice, protocolFee, creator, name, story] = await Promise.all([
    ethCall(tr, call('circuits')), uintAt(tr, 'supplyCap'), uintAt(tr, 'minted'), uintAt(tr, 'mintPrice'),
    uintAt(tr, 'protocolFee'), ethCall(tr, call('creator')), ethCall(tr, call('cpuName')), ethCall(tr, call('story'))]);
  if (!same(readAddr(backlink), cpu)) throw new Error('Processor and transistor contracts do not match.');
  return { address: cpu, transistors: tr, creator: readAddr(creator), name: dec.decode(readBytes(name)),
    story: dec.decode(readBytes(story)), supplyCap, minted, mintPrice, protocolFee, tapeoutFee,
    circuitCount: Number(nextId) };
}

export async function readCircuit(cpu, id) {
  const [info, owner, netlist] = await Promise.all([
    ethCall(cpu, call('circuitInfo', id)), ethCall(cpu, call('ownerOf', id)), ethCall(cpu, call('netlist', id))]);
  return { id: String(id), processor: addr(cpu), owner: readAddr(owner),
    nIn: Number(readWord(info, 0)), nOut: Number(readWord(info, 1)), nState: Number(readWord(info, 2)),
    gateCount: Number(readWord(info, 3)), netlistHex: '0x' + hex(readBytes(netlist)) };
}

/** On-chain eval of one input (combinational circuits). Returns output bits packed as a number. */
export async function evalOnChain(cpu, id, nIn, nOut, input, block = 'latest') {
  const packed = new Uint8Array(Math.max(1, Math.ceil(nIn / 8)));
  for (let i = 0; i < nIn; i++) if ((input / 2 ** i) & 1) packed[i >> 3] |= 1 << (i & 7);
  const raw = await ethCall(cpu, '0x' + SEL.eval + word(id) + word(64) + dyn(packed), block);
  const out = readBytes(raw);
  let v = 0; for (let k = 0; k < nOut; k++) v |= ((out[k >> 3] >> (k & 7)) & 1) << k;
  return v;
}
export const blockNumber = async () => Number(await rpc('eth_blockNumber'));

export async function readFactory() {
  const [count, deployFee, impl] = await Promise.all([
    uintAt(PLATFORM.factory, 'cpuCount'), uintAt(PLATFORM.factory, 'deployFee'),
    rpc('eth_getStorageAt', [PLATFORM.factory, IMPL_SLOT, 'latest'])]);
  return { count: Number(count), deployFee, implementation: readAddr(impl) };
}

// ---------------- wallet ----------------
function wallet() {
  const p = globalThis.window?.okxwallet || globalThis.window?.ethereum;
  if (!p?.request) throw new Error('Open this page in OKX Wallet, MetaMask or another browser wallet.');
  return p;
}
export async function connect() {
  const p = wallet();
  const accounts = await p.request({ method: 'eth_requestAccounts' });
  if (Number(await p.request({ method: 'eth_chainId' })) !== PLATFORM.chainId) {
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: PLATFORM.chainIdHex }] }); }
    catch (e) {
      if (e.code !== 4902) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: PLATFORM.chainIdHex, chainName: 'X Layer Mainnet',
        nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: ['https://rpc.xlayer.tech'], blockExplorerUrls: [PLATFORM.explorer] }] });
    }
  }
  if (Number(await p.request({ method: 'eth_chainId' })) !== PLATFORM.chainId) throw new Error('Switch your wallet to X Layer mainnet.');
  return addr(accounts[0]);
}
async function send(from, to, data, value) {
  const p = wallet();
  if (Number(await p.request({ method: 'eth_chainId' })) !== PLATFORM.chainId) throw new Error('Wallet left X Layer. Nothing was sent.');
  return p.request({ method: 'eth_sendTransaction', params: [{ from, to: addr(to), data, value: '0x' + BigInt(value).toString(16) }] });
}
async function receipt(hash, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (r) { if (Number(r.status) !== 1) throw new Error(`Transaction reverted: ${hash}`); return r; }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`Still pending: ${hash}. Check it on the explorer before retrying.`);
}
async function checkFactory() {
  const f = await readFactory();
  if (!same(f.implementation, PLATFORM.factoryImplementation))
    throw new Error(`The TapeOut factory was upgraded (now ${f.implementation}). Nothing was sent; review it first.`);
  return f;
}

/** Launch a processor. Supply and price can never be changed afterwards. */
export async function launchProcessor({ name, symbol, story, supply, mintPriceWei, onStatus }) {
  const from = await connect();
  const f = await checkFactory();
  const parts = [name, symbol, story].map((s) => dyn(enc.encode(String(s).trim())));
  let off = 160; const offs = parts.map((p) => { const at = off; off += p.length / 2; return word(at); });
  const data = '0x' + SEL.createCPU + offs.join('') + word(supply) + word(mintPriceWei) + parts.join('');
  onStatus?.(`Confirm in your wallet (deploy fee ${fmt(f.deployFee)} OKB)…`);
  const hash = await send(from, PLATFORM.factory, data, f.deployFee);
  onStatus?.('Waiting for X Layer…', hash);
  const r = await receipt(hash);
  const ev = r.logs?.find((l) => same(l.address, PLATFORM.factory) && same(l.topics?.[0], CPU_CREATED));
  if (!ev) throw new Error(`Confirmed, but the CPUCreated event was not found. Check ${hash}.`);
  const processor = '0x' + ev.topics[1].slice(-40);
  return { hash, processor, info: await readProcessor(processor) };
}

/** Quote and tape out a compiled circuit on a processor (mint missing NAND first). */
export async function quote(cpuAddr, circuit, owner) {
  const cpu = await readProcessor(cpuAddr);
  const held = owner ? readWord(await ethCall(cpu.transistors, '0x' + SEL.balanceOf + addrWord(owner) + word(0))) : 0n;
  const need = BigInt(circuit.gateCount);
  const toMint = need > held ? need - held : 0n;
  if (toMint > cpu.supplyCap - cpu.minted) throw new Error('This processor has sold out of transistors.');
  const mintValue = toMint ? cpu.mintPrice * toMint + cpu.protocolFee : 0n;
  return { cpu, held, toMint, mintValue, tapeoutFee: cpu.tapeoutFee, total: mintValue + cpu.tapeoutFee,
    creatorEarns: cpu.mintPrice * toMint };
}
export async function tapeout(cpuAddr, circuit, onStatus) {
  if (circuit.latchCount) throw new Error('Studio circuits are combinational only.');
  const from = await connect();
  await checkFactory();
  const q = await quote(cpuAddr, circuit, from);
  let mintHash = null;
  if (q.toMint > 0n) {
    onStatus?.(`Confirm: buy ${q.toMint} NAND transistors (${fmt(q.mintValue)} OKB)…`);
    mintHash = await send(from, q.cpu.transistors, call('mint', 0, q.toMint), q.mintValue);
    onStatus?.('Minting transistors…', mintHash);
    await receipt(mintHash);
  }
  onStatus?.(`Confirm: tape out (${fmt(q.tapeoutFee)} OKB fee)…`);
  const data = '0x' + SEL.tapeout + word(96) + word(circuit.nIn) + word(circuit.nOut) + dyn(fromHex(circuit.netlistHex));
  let hash;
  try { hash = await send(from, q.cpu.address, data, q.tapeoutFee); }
  catch (e) { if (mintHash) e.message += ' Your transistors were minted and stay in your wallet; you can tape out again.'; throw e; }
  onStatus?.('Taping out on X Layer…', hash);
  const r = await receipt(hash);
  const ev = r.logs?.find((l) => same(l.address, q.cpu.address) && same(l.topics?.[0], TAPED_OUT));
  if (!ev) throw new Error(`Confirmed, but the TapedOut event was not found. Check ${hash}.`);
  const id = readWord(ev.topics[1]).toString();
  const onChain = await readCircuit(q.cpu.address, id);
  if (!same(onChain.netlistHex, circuit.netlistHex)) throw new Error(`Circuit #${id} on chain differs from your design.`);
  return { hash, mintHash, id };
}

export function fmt(wei, digits = 6) {
  const s = BigInt(wei).toString().padStart(19, '0');
  const whole = s.slice(0, -18), frac = s.slice(-18).replace(/0+$/, '').slice(0, digits);
  return frac ? `${whole}.${frac}` : whole;
}
export function parseOkb(v) {
  const m = String(v).trim().match(/^(\d*)(?:\.(\d{0,18}))?$/);
  if (!m || (!m[1] && !m[2])) throw new Error('Enter an OKB amount like 0.0001.');
  return BigInt(m[1] || '0') * 10n ** 18n + BigInt((m[2] || '').padEnd(18, '0'));
}
export const explorerTx = (h) => `${PLATFORM.explorer}/tx/${h}`;
export const explorerAddr = (a) => `${PLATFORM.explorer}/address/${a}`;
export { CONFIG };
