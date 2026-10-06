import assert from 'node:assert/strict';
import { compile, decode, compileSim, parse, netlistToExprs } from '../js/netlist.js';

// 1. Decode the known on-chain XOR reference (CPU #0 circuit #1 evaluates 0,1,1,0).
{
  const b = [];
  const nand = (a, c) => b.push(0, 0, 0, a, 0, 0, c);
  nand(2, 3); nand(2, 4); nand(3, 4); nand(5, 6);
  const hex = '0x' + b.map((x) => x.toString(16).padStart(2, '0')).join('');
  const run = compileSim(decode(hex, 2), 2, 1);
  assert.deepEqual([0, 1, 2, 3].map((i) => run(i).out), [0, 1, 1, 0]);
}
// 2. TapeSafe's published maj3 netlist (8 NAND, outputs last) is a majority function.
{
  const hex = '0x0000000400000100000003000001000000040000030000000500000600000002000008000000070000090000000a00000a0000000b00000b';
  const run = compileSim(decode(hex, 3), 3, 1);
  for (let i = 0; i < 8; i++) {
    const ones = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1);
    assert.equal(run(i).out, ones >= 2 ? 1 : 0, `maj3(${i})`);
  }
}
// 3. Compiled expressions match a direct JS evaluation over the whole grid.
const cases = [
  [['~(x0&y0 | x1&y1 | x2&y2 | x3&y3 | x4&y4)'], 5],
  [['~(x0&y0) & ~(x1&y1) & ~(x2&y2) & ~(x3&y3) & ~(x4&y4)'], 5],
  [['~~x1 ^ ~y2'], 3],
  [['x2^y2', 'x3^y3', 'x4^y4'], 5],
  [['x0', 'x0'], 3],              // duplicate outputs need distinct buffered tails
  [['1', '0', 'y1'], 2],          // constants
  [['(x5^y5)&~(x4&y4) | x3^y0'], 6],
];
for (const [exprs, bits] of cases) {
  const c = compile(exprs, bits);
  const run = compileSim(decode(c.netlistHex, c.nIn), c.nIn, c.nOut);
  const n = 1 << bits;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const env = {};
    for (let i = 0; i < bits; i++) { env['x' + i] = (x >> i) & 1; env['y' + i] = (y >> i) & 1; }
    const want = exprs.map((e) => Function(...Object.keys(env), `return (${e}) & 1`)(...Object.values(env)))
      .reduce((acc, v, k) => acc | (v << k), 0);
    assert.equal(run(x | (y << bits)).out, want, `${exprs} @ ${x},${y}`);
  }
  console.log(`ok  ${JSON.stringify(exprs)}  bits=${bits}  NAND=${c.gateCount}`);
}
assert.throws(() => parse('x0 &'), /ended early/);
assert.throws(() => compile(['x9'], 5), /outside/);
// 4. Time inputs (moving pieces): t bits come after x and y.
{
  const c = compile(['x1^y1^t0', 'x0&t1'], 2, 2);
  assert.equal(c.nIn, 6);
  const run = compileSim(decode(c.netlistHex, c.nIn), c.nIn, c.nOut);
  for (let i = 0; i < 64; i++) {
    const b = (k) => (i >> k) & 1; // x0 x1 y0 y1 t0 t1
    assert.equal(run(i).out, (b(1) ^ b(3) ^ b(4)) | ((b(0) & b(5)) << 1), `moving @ ${i}`);
  }
  assert.throws(() => compile(['t0'], 3), /Motion/);
}
// 5. Remix: a netlist turned back into rules compiles to the same truth table.
for (const [exprs, bits, tb] of [[['~(x0&y0) & ~(x1&y1) & ~(x2&y2)'], 3, 0], [['x2^y2', 'x3^y3', 'x4^y4'], 5, 0],
  [['(x3^y3) & ~(x0|y0)', 'x2^y3 ^ (x1&y1)'], 4, 0], [['x1^y1^t0', 'y0&~x0^t2'], 2, 3], [['1', 'x0'], 2, 0]]) {
  const c = compile(exprs, bits, tb);
  const r = netlistToExprs(c);
  assert.ok(r, `remixable ${exprs}`);
  const c2 = compile(r.exprs, r.bits, r.timeBits);
  const a = compileSim(decode(c.netlistHex, c.nIn), c.nIn, c.nOut), b = compileSim(decode(c2.netlistHex, c2.nIn), c2.nIn, c2.nOut);
  for (let i = 0; i < 2 ** c.nIn; i++) assert.equal(b(i).out, a(i).out, `remix ${exprs} @ ${i}`);
  console.log(`ok  remix ${JSON.stringify(exprs)} -> ${JSON.stringify(r.exprs).slice(0, 80)}`);
}
// 6. Remix fuzz: random rules (deterministic seed) always round-trip to the same truth table.
{
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
  const leaf = (b, tb) => { const k = rnd(tb ? 3 : 2); return k === 2 ? `t${rnd(tb)}` : `${'xy'[k]}${rnd(b)}`; };
  const gen = (d, b, tb) => (d === 0 || rnd(4) === 0 ? (rnd(5) === 0 ? `~${leaf(b, tb)}` : leaf(b, tb))
    : `(${gen(d - 1, b, tb)} ${'&|^'[rnd(3)]} ${rnd(4) === 0 ? '~' : ''}${gen(d - 1, b, tb)})`);
  for (let n = 0; n < 60; n++) {
    const b = 2 + rnd(4), tb = rnd(2) ? 3 : 0, layers = 1 + rnd(3);
    const exprs = Array.from({ length: layers }, () => gen(3, b, tb));
    const c = compile(exprs, b, tb), r = netlistToExprs(c);
    assert.ok(r, `remixable ${exprs}`);
    const c2 = compile(r.exprs, r.bits, r.timeBits);
    const A = compileSim(decode(c.netlistHex, c.nIn), c.nIn, c.nOut), B = compileSim(decode(c2.netlistHex, c2.nIn), c2.nIn, c2.nOut);
    for (let i = 0; i < 2 ** c.nIn; i++) assert.equal(B(i).out, A(i).out, `fuzz ${exprs} @ ${i}`);
  }
  console.log('ok  remix fuzz: 60 random rule sets round-trip');
}
console.log('all netlist tests passed');
