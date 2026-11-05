'use strict';
// Split, separate, close and placement keep terminals in an aligned grid in
// reading order: equal cells, rows differ by at most one cell.
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

// Direction decides the order only.
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

// A saved arrangement from an older version is aligned once; a grid whose
// dividers were dragged keeps its sizes.
const legacy = { axis: 'row', ratio: .5, first: { id: 'a' }, second: { axis: 'column', ratio: .5, first: { id: 'b' }, second: { axis: 'row', ratio: .5, first: { id: 'c' }, second: { id: 'd' } } } };
assertGrid(layout.aligned(legacy), [['a', 'b'], ['c', 'd']], 'legacy layout aligned');
const dragged = JSON.parse(JSON.stringify(layout.grid(legacy)));
dragged.ratio = .7;
assert.strictEqual(layout.aligned(dragged), dragged, 'dragged grid sizes survive');
assert.strictEqual(layout.aligned(null), null);

console.log('terminal-workspace-layout-test: ok');
