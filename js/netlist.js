// TapeOut netlist tools: decode, simulate, and compile expressions to NAND.
// Format (shared by the TapeOut client and other X Layer projects):
//   signal 0 = const 0, signal 1 = const 1, signals 2..2+nIn-1 = inputs, then one signal per element.
//   NAND  = 7 bytes: 0x00, u24 a, u24 b
//   LATCH = 4 bytes: 0x01, u24 d
//   The last nOut elements are the outputs, in order.

export const OP_NAND = 0;
export const OP_LATCH = 1;

export function hexToBytes(value) {
  const raw = String(value).replace(/^0x/, '');
  if (raw.length % 2 || /[^0-9a-f]/i.test(raw)) throw new Error('Invalid hex bytes.');
  return Uint8Array.from(raw.match(/../g)?.map((x) => parseInt(x, 16)) ?? []);
}
export function bytesToHex(bytes) {
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function decode(netlistHex, nIn) {
  const bytes = typeof netlistHex === 'string' ? hexToBytes(netlistHex) : netlistHex;
  const elements = [];
  let next = 2 + nIn;
  let p = 0;
  const u24 = () => { const v = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]; p += 3; return v; };
  while (p < bytes.length) {
    const op = bytes[p++];
    if (op === OP_NAND) {
      if (p + 6 > bytes.length) throw new Error('Truncated NAND.');
      const a = u24(), b = u24();
      elements.push({ op, a, b, out: next++ });
    } else if (op === OP_LATCH) {
      if (p + 3 > bytes.length) throw new Error('Truncated LATCH.');
      elements.push({ op, d: u24(), out: next++ });
    } else throw new Error(`Unknown opcode ${op}.`);
  }
  const total = next;
  for (const e of elements) {
    const refs = e.op === OP_NAND ? [e.a, e.b] : [e.d];
    if (refs.some((r) => r >= total)) throw new Error('Netlist references a missing signal.');
  }
  return elements;
}

/** Build a fast evaluator: (inputBits:number, state:number[]) -> { out:number (bit k = output k), state } */
export function compileSim(elements, nIn, nOut) {
  if (nOut > elements.length) throw new Error('Netlist has fewer elements than outputs.');
  const size = 2 + nIn + elements.length;
  const sig = new Uint8Array(size);
  const outIdx = elements.slice(-nOut).map((e) => e.out);
  const latches = elements.filter((e) => e.op === OP_LATCH);
  return function run(inputBits, state = []) {
    sig[0] = 0; sig[1] = 1;
    for (let i = 0; i < nIn; i++) sig[2 + i] = (inputBits / 2 ** i) & 1; // works past 31 bits for small values
    let l = 0;
    for (let k = 0; k < elements.length; k++) {
      const e = elements[k];
      sig[e.out] = e.op === OP_NAND ? (sig[e.a] & sig[e.b]) ^ 1 : (state[l++] ? 1 : 0);
    }
    let out = 0;
    for (let k = 0; k < outIdx.length; k++) out |= sig[outIdx[k]] << k;
    return { out, state: latches.map((e) => sig[e.d]) };
  };
}

// ---------- expression compiler ----------
// Grammar: expr := xor ('|' xor)* ; xor := and ('^' and)* ; and := unary ('&' unary)* ;
//          unary := '~' unary | '(' expr ')' | '0' | '1' | x<n> | y<n> | t<n>   (t = time, for moving pieces)
function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:([xyt]\d+)|([01])|([~&|^()]))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (/^\s*$/.test(src.slice(at))) break;
    m = re.exec(src);
    if (!m) throw new Error(`Unexpected "${src.slice(at).trim()[0]}" at position ${at + 1}.`);
    tokens.push(m[1] ? { t: 'var', v: m[1] } : m[2] ? { t: 'const', v: Number(m[2]) } : { t: m[3] });
  }
  return tokens;
}
export function parse(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i]?.t;
  const bin = (sub, op) => () => { let left = sub(); while (peek() === op) { i++; left = { op, a: left, b: sub() }; } return left; };
  const unary = () => {
    const tok = tokens[i++];
    if (!tok) throw new Error('Expression ended early.');
    if (tok.t === '~') return { op: '~', a: unary() };
    if (tok.t === '(') { const e = or(); if (tokens[i++]?.t !== ')') throw new Error('Missing ")".'); return e; }
    if (tok.t === 'var') return { op: 'var', v: tok.v };
    if (tok.t === 'const') return { op: 'const', v: tok.v };
    throw new Error(`Unexpected "${tok.t}".`);
  };
  const and = bin(unary, '&');
  const xor = bin(and, '^');
  const or = bin(xor, '|');
  if (!tokens.length) throw new Error('Empty expression.');
  const tree = or();
  if (i !== tokens.length) throw new Error(`Unexpected "${tokens[i].t === 'var' ? tokens[i].v : tokens[i].t}".`);
  return tree;
}

/**
 * Compile output expressions over a W×H grid to a NAND netlist.
 * Inputs: x0..x(bits-1) are signals 2..; y0..y(bits-1) follow; then t0..t(timeBits-1) for moving pieces.
 * nIn = 2*bits + timeBits. Each value of t is one frame of the animation.
 */
export function compile(exprs, bits, timeBits = 0) {
  if (!exprs.length || exprs.length > 3) throw new Error('Use 1 to 3 colour layers.');
  const nIn = bits * 2 + timeBits;
  const bytes = [];
  const gates = [];
  const memo = new Map();
  let next = 2 + nIn;
  const nand = (a, b) => {
    if (a > b) [a, b] = [b, a];
    const key = a + ',' + b;
    if (memo.has(key)) return memo.get(key);
    bytes.push(OP_NAND, (a >> 16) & 255, (a >> 8) & 255, a & 255, (b >> 16) & 255, (b >> 8) & 255, b & 255);
    gates.push([a, b]);
    memo.set(key, next);
    return next++;
  };
  // Constant folding keeps gate counts honest (0/1 never cost a transistor unless forced).
  const inv = new Map(); // signal -> known inverse, so ~~a and ~nand(a,b) don't cost extra gates
  const not = (a) => {
    if (a === 0) return 1; if (a === 1) return 0;
    if (inv.has(a)) return inv.get(a);
    const r = nand(a, a); inv.set(a, r); inv.set(r, a); return r;
  };
  const and = (a, b) => (a === 0 || b === 0 ? 0 : a === 1 ? b : b === 1 ? a : a === b ? a : not(nand(a, b)));
  const or = (a, b) => (a === 1 || b === 1 ? 1 : a === 0 ? b : b === 0 ? a : a === b ? a : nand(not(a), not(b)));
  const xor = (a, b) => {
    if (a === 0) return b; if (b === 0) return a; if (a === 1) return not(b); if (b === 1) return not(a);
    if (a === b) return 0;
    const t = nand(a, b); return nand(nand(a, t), nand(b, t));
  };
  const varSignal = (name) => {
    const n = Number(name.slice(1));
    if (name[0] === 't') {
      if (n >= timeBits) throw new Error(timeBits ? `${name} is out of range (use t0–t${timeBits - 1}).` : `${name} needs Motion turned on.`);
      return 2 + 2 * bits + n;
    }
    if (n >= bits) throw new Error(`${name} is outside a ${2 ** bits}×${2 ** bits} grid (use ${name[0]}0–${name[0]}${bits - 1}).`);
    return 2 + (name[0] === 'x' ? n : bits + n);
  };
  const build = (node) => {
    switch (node.op) {
      case 'var': return varSignal(node.v);
      case 'const': return node.v;
      case '~': return not(build(node.a));
      case '&': return and(build(node.a), build(node.b));
      case '|': return or(build(node.a), build(node.b));
      case '^': return xor(build(node.a), build(node.b));
    }
    throw new Error('Bad expression node.');
  };
  const outs = exprs.map((src) => build(parse(src)));
  // Outputs must be the last nOut elements, in order. If they aren't already, append
  // fresh (un-memoised) double-NAND buffers: all inverters first, then all restorers.
  const tailOk = () => outs.every((s, k) => s === next - outs.length + k);
  if (!tailOk()) {
    const raw = (a, b) => { bytes.push(OP_NAND, ...u24(a), ...u24(b)); gates.push([a, b]); return next++; };
    const invs = outs.map((s) => raw(s, 1));
    invs.forEach((inv, k) => { outs[k] = raw(inv, 1); });
  }
  if (!tailOk()) throw new Error('Internal error: outputs are not the final elements.');
  return { nIn, nOut: exprs.length, gateCount: gates.length, latchCount: 0, timeBits, netlistHex: bytesToHex(bytes) };
}
function u24(v) { return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }

/**
 * Turn a NAND netlist back into Studio rules (for Remix). Returns null when the circuit
 * can't be written as up to 3 rules over an x/y grid (latches, odd sizes, or rules too long to edit).
 */
export function netlistToExprs({ netlistHex, nIn, nOut, timeBits = 0 }) {
  const els = decode(netlistHex, nIn);
  const bits = (nIn - timeBits) / 2;
  if (els.some((e) => e.op !== 0) || nOut > 3 || !Number.isInteger(bits) || bits < 1 || bits > 7) return null;
  const name = (i) => (i < bits ? `x${i}` : i < 2 * bits ? `y${i - bits}` : `t${i - 2 * bits}`);
  // node: { s: text, neg: text of its inverse, c: 0|1|null, inv: signal it inverts, nand: [a, b] }
  const sig = [{ s: '0', c: 0 }, { s: '1', c: 1 }];
  for (let i = 0; i < nIn; i++) sig.push({ s: name(i), c: null });
  const wrap = (t) => (/^[~]?[xyt]\d+$|^[01]$/.test(t) || (t[0] === '(' && balanced(t)) ? t : `(${t})`);
  const notOf = (i) => { const n = sig[i];
    return n.c !== null ? { s: String(1 - n.c), c: 1 - n.c } : n.neg ? { s: n.neg, c: null, neg: n.s, inv: i } : { s: `~${wrap(n.s)}`, c: null, neg: n.s, inv: i }; };
  const other = (pair, x) => (pair[0] === x ? pair[1] : pair[1] === x ? pair[0] : -1);
  for (const e of els) {
    const A = sig[e.a], B = sig[e.b];
    let r;
    if (A.c === 0 || B.c === 0) r = { s: '1', c: 1 };
    else if (A.c === 1) r = notOf(e.b);
    else if (B.c === 1 || e.a === e.b) r = notOf(e.a);
    else {
      // XOR is built as nand(nand(a, t), nand(b, t)) with t = nand(a, b): write it back as a ^ b
      let xor = null;
      if (A.nand && B.nand) for (const t of A.nand) {
        const a = other(A.nand, t), b = other(B.nand, t);
        if (a >= 0 && b >= 0 && sig[t].nand && other(sig[t].nand, a) === b) xor = [a, b];
      }
      if (xor) r = { s: `${wrap(sig[xor[0]].s)} ^ ${wrap(sig[xor[1]].s)}`, c: null };
      else if (A.inv !== undefined && B.inv !== undefined) r = { s: `${wrap(sig[A.inv].s)} | ${wrap(sig[B.inv].s)}`, c: null }; // nand(~a, ~b) = a | b
      else r = { s: `~(${wrap(A.s)} & ${wrap(B.s)})`, c: null, neg: `${wrap(A.s)} & ${wrap(B.s)}` };
      r.nand = [e.a, e.b];
    }
    if (r.s.length > 1500) return null;
    sig.push(r);
  }
  return { bits, timeBits, exprs: sig.slice(-nOut).map((n) => n.s) };
}
function balanced(t) { // true if the outer parentheses wrap the whole text
  if (t[0] !== '(') return true;
  let d = 0;
  for (let i = 0; i < t.length; i++) { if (t[i] === '(') d++; else if (t[i] === ')') d--; if (d === 0 && i < t.length - 1) return false; }
  return true;
}
