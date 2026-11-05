'use strict';
// Panel separation, split and removal keep cells aligned: every cell along the
// same axis receives an equal share.
const assert = require('assert');
const layout = require('../renderer/terminal-workspace-layout');

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
// Width share of each leaf along the root row axis.
function shares(node, axis, share = 1, out = {}) {
  if (node.id) { out[node.id] = share; return out; }
  if (node.axis !== axis) { for (const id of layout.ids(node)) out[id] = share; return out; }
  shares(node.first, axis, share * node.ratio, out);
  shares(node.second, axis, share * (1 - node.ratio), out);
  return out;
}

// Repeated right splits of the last pane give equal columns, not 50/25/25.
let tree = { id: 'a' };
tree = layout.split(tree, 'a', 'b', 'row');
tree = layout.split(tree, 'b', 'c', 'row');
tree = layout.split(tree, 'c', 'd', 'row');
for (const value of Object.values(shares(tree, 'row'))) close(value, 1 / 4, 'four equal columns');

// Splitting the first pane on the left side stays equal as well.
tree = layout.split(tree, 'a', 'z', 'row', true);
assert.deepEqual(layout.ids(tree), ['z', 'a', 'b', 'c', 'd']);
for (const value of Object.values(shares(tree, 'row'))) close(value, 1 / 5, 'five equal columns');

// Removing (separating) a pane re-aligns the remaining columns.
tree = layout.remove(tree, 'b');
assert.deepEqual(layout.ids(tree), ['z', 'a', 'c', 'd']);
for (const value of Object.values(shares(tree, 'row'))) close(value, 1 / 4, 'columns after removal');

// A perpendicular split counts as one cell of the outer row.
let mixed = layout.split(layout.split({ id: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'row');
mixed = layout.split(mixed, 'b', 'b2', 'column');
const row = shares(mixed, 'row');
close(row.a, 1 / 3, 'outer column a'); close(row.b, 1 / 3, 'outer column b'); close(row.c, 1 / 3, 'outer column c');

// Placing a separated multi-terminal panel next to a pane aligns all cells.
let placed = layout.split({ id: 'a' }, 'a', 'b', 'row');
placed = layout.place(placed, { axis: 'row', ratio: .7, first: { id: 'x' }, second: { id: 'y' } }, 'b', 'row');
assert.deepEqual(layout.ids(placed), ['a', 'b', 'x', 'y']);
for (const value of Object.values(shares(placed, 'row'))) close(value, 1 / 4, 'placed panel columns');

// Reconciling missing panels appends aligned columns.
const reconciled = layout.reconcile({ id: 'a' }, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
for (const value of Object.values(shares(reconciled, 'row'))) close(value, 1 / 3, 'reconciled columns');

// Eight equal panes survive restore without clamping (new-terminal --count 8).
let eight = { id: 't0' };
for (let index = 1; index < 8; index++) eight = layout.split(eight, `t${index - 1}`, `t${index}`, 'row');
const restored = layout.restore(JSON.parse(JSON.stringify(eight)), new Set(layout.ids(eight)));
for (const value of Object.values(shares(restored, 'row'))) close(value, 1 / 8, 'eight restored columns');

console.log('terminal-workspace-layout-test: ok');
