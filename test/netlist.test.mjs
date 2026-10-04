import assert from 'node:assert/strict';
import { compile, decode, compileSim, parse } from '../js/netlist.js';

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
console.log('all netlist tests passed');
