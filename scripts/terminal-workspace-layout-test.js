'use strict';
// Opening, separating and closing keep terminals in an aligned grid in reading
// order: equal cells, rows differ by at most one cell. A terminal the user
// drops on one side of another lands exactly there, and that arrangement is
// kept afterwards.
const assert = require('assert');
const layout = require('../renderer/terminal-workspace-layout');

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
// Rectangle of every cell in a unit canvas.
function cells(node, box = { x: 0, y: 0, w: 1, h: 1 }, out = {}) {
  if (node.id) { out[node.id] = box; return out; }
  const r = node.ratio;
  if (node.axis === 'row') {
    cells(node.first, { ...box, w: box.w * r }, out);
    cells(node.second, { ...box, x: box.x + box.w * r, w: box.w * (1 - r) }, out);
  } else {
    cells(node.first, { ...box, h: box.h * r }, out);
    cells(node.second, { ...box, y: box.y + box.h * r, h: box.h * (1 - r) }, out);
  }
  return out;
}
// Rows as arrays of ids, top to bottom, each row left to right.
function rows(node) {
  const byTop = new Map();
  for (const [id, box] of Object.entries(cells(node))) {
    const key = box.y.toFixed(6);
    if (!byTop.has(key)) byTop.set(key, []);
    byTop.get(key).push([box.x, id, box]);
  }
  return [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((a, b) => a[0] - b[0]));
}
function assertGrid(node, expectedRows, message) {
  const actual = rows(node);
  assert.deepEqual(actual.map(row => row.map(([, id]) => id)), expectedRows, message);
  for (const row of actual) {
    for (const [, id, box] of row) {
      close(box.w, 1 / row.length, `${message}: ${id} width`);
      close(box.h, 1 / actual.length, `${message}: ${id} height`);
    }
  }
}

let tree = { id: 'a' };
tree = layout.split(tree, 'a', 'b', 'row');
assertGrid(tree, [['a', 'b']], 'two side by side');
tree = layout.split(tree, 'b', 'c', 'row');
assertGrid(tree, [['a', 'b'], ['c']], 'three as two over one');
tree = layout.split(tree, 'c', 'd', 'row');
assertGrid(tree, [['a', 'b'], ['c', 'd']], 'four as 2x2');
tree = layout.split(tree, 'd', 'e', 'column');
assertGrid(tree, [['a', 'b', 'c'], ['d', 'e']], 'five as three over two; the split direction does not break the grid');

// Without a drop, the direction decides the order only.
tree = layout.split(tree, 'a', 'z', 'column', true);
assertGrid(tree, [['z', 'a', 'b'], ['c', 'd', 'e']], 'insert before keeps reading order');

// Closing or separating re-aligns the rest.
tree = layout.remove(tree, 'b');
assertGrid(tree, [['z', 'a', 'c'], ['d', 'e']], 'grid after removal');
tree = layout.remove(layout.remove(tree, 'z'), 'a');
assertGrid(tree, [['c', 'd'], ['e']], 'grid after two removals');

// Placing a separated multi-terminal panel joins the same grid.
let placed = layout.split({ id: 'a' }, 'a', 'b', 'row');
placed = layout.place(placed, { axis: 'row', ratio: .7, first: { id: 'x' }, second: { id: 'y' } }, 'b', 'row');
assertGrid(placed, [['a', 'b'], ['x', 'y']], 'placed panel cells');

// Reconciling missing panels appends them to the grid.
assertGrid(layout.reconcile({ id: 'a' }, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]), [['a', 'b'], ['c']], 'reconciled grid');

// Eight terminals (new-terminal --count 8) restore as 3/3/2 without clamping.
let eight = { id: 't0' };
for (let index = 1; index < 8; index++) eight = layout.split(eight, `t${index - 1}`, `t${index}`, 'row');
const restored = layout.restore(JSON.parse(JSON.stringify(eight)), new Set(layout.ids(eight)));
assertGrid(restored, [['t0', 't1', 't2'], ['t3', 't4', 't5'], ['t6', 't7']], 'eight restored');

// Exact rectangles of a view, as [x, y, width, height] in quarters and thirds.
function assertCells(node, expected, message) {
  const actual = cells(node);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${message}: members`);
  for (const [id, [x, y, w, h]] of Object.entries(expected)) {
    close(actual[id].x, x, `${message}: ${id} x`); close(actual[id].y, y, `${message}: ${id} y`);
    close(actual[id].w, w, `${message}: ${id} width`); close(actual[id].h, h, `${message}: ${id} height`);
  }
}

// A drop lands on the chosen side of its target, whatever the grid would do.
assertCells(layout.drop({ id: 'a' }, 'a', 'b', 'column'), { a: [0, 0, 1, .5], b: [0, .5, 1, .5] }, 'second terminal dropped below');
assertCells(layout.drop({ id: 'a' }, 'a', 'b', 'column', true), { b: [0, 0, 1, .5], a: [0, .5, 1, .5] }, 'second terminal dropped above');
assertCells(layout.drop({ id: 'a' }, 'a', 'b', 'row', true), { b: [0, 0, .5, 1], a: [.5, 0, .5, 1] }, 'second terminal dropped left');
const pair = layout.split({ id: 'a' }, 'a', 'b', 'row');
let arranged = layout.drop(pair, 'b', 'c', 'column');
assertCells(arranged, { a: [0, 0, .5, 1], b: [.5, 0, .5, .5], c: [.5, .5, .5, .5] }, 'third terminal dropped below the right one');
assertCells(layout.drop(pair, 'a', 'c', 'column', true), { c: [0, 0, .5, .5], a: [0, .5, .5, .5], b: [.5, 0, .5, 1] }, 'third terminal dropped above the left one');
assertCells(layout.drop(pair, 'a', 'c', 'row'), { a: [0, 0, 1 / 3, 1], c: [1 / 3, 0, 1 / 3, 1], b: [2 / 3, 0, 1 / 3, 1] }, 'third terminal dropped between the two');
// Moving a terminal already on screen takes it out of its old cell first.
assertCells(layout.drop(layout.remove(arranged, 'a'), 'c', 'a', 'row'), { b: [0, 0, 1, .5], c: [0, .5, .5, .5], a: [.5, .5, .5, .5] }, 'moved terminal lands right of its target');
assertCells(layout.drop(layout.split(pair, 'b', 'c', 'row'), 'b', 'c', 'column'), { a: [0, 0, .5, 1], b: [.5, 0, .5, .5], c: [.5, .5, .5, .5] }, 'a grid cell dragged below its neighbour');

// The arrangement the user made is kept when terminals open or close.
arranged = layout.split(arranged, 'c', 'd', 'row');
assertCells(arranged, { a: [0, 0, .5, 1], b: [.5, 0, .5, .5], c: [.5, .5, .25, .5], d: [.75, .5, .25, .5] }, 'new terminal opens beside the selected one');
arranged = layout.remove(arranged, 'd');
assertCells(arranged, { a: [0, 0, .5, 1], b: [.5, 0, .5, .5], c: [.5, .5, .5, .5] }, 'closing keeps the arrangement');
assertGrid(layout.remove(arranged, 'c'), [['a', 'b']], 'closing back to a plain row');
// It also survives a restart, minus sessions that are gone.
const saved = JSON.parse(JSON.stringify(arranged));
saved.ratio = .7;
assert.deepEqual(layout.fit(saved, new Set(['a', 'b', 'c'])), saved, 'saved arrangement and its dragged sizes survive');
assertCells(layout.fit(saved, new Set(['a', 'c'])), { a: [0, 0, .5, 1], c: [.5, 0, .5, 1] }, 'saved arrangement without a closed session');
const dragged = JSON.parse(JSON.stringify(layout.grid(eight)));
dragged.ratio = .7;
assert.deepEqual(layout.fit(dragged, new Set(layout.ids(eight))), dragged, 'dragged grid sizes survive');
assertGrid(layout.fit(dragged, new Set(['t0', 't1', 't2', 't3', 't4'])), [['t0', 't1', 't2'], ['t3', 't4']], 'a grid that lost sessions is a grid again');
assert.strictEqual(layout.fit(null, new Set()), null);

// A whole panel dropped on one side lands there too.
assertCells(layout.place(pair, { axis: 'row', ratio: .7, first: { id: 'x' }, second: { id: 'y' } }, 'b', 'column', false, true),
  { a: [0, 0, .5, 1], b: [.5, 0, .5, .5], x: [.5, .5, .25, .5], y: [.75, .5, .25, .5] }, 'panel dropped below a terminal');

console.log('terminal-workspace-layout-test: ok');
