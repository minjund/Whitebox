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
// A dragged divider is the person's size: the closed cell's space goes to its neighbour.
assertCells(layout.fit(saved, new Set(['a', 'c'])), { a: [0, 0, .7, 1], c: [.7, 0, .3, 1] }, 'saved arrangement without a closed session keeps its dragged size');
assertCells(layout.fit(arranged, new Set(['a', 'c'])), { a: [0, 0, .5, 1], c: [.5, 0, .5, 1] }, 'an arrangement nobody sized shares the space evenly again');
const dragged = JSON.parse(JSON.stringify(layout.grid(eight)));
dragged.ratio = .7;
assert.deepEqual(layout.fit(dragged, new Set(layout.ids(eight))), dragged, 'dragged grid sizes survive');
close(layout.fit(dragged, new Set(['t0', 't1', 't2', 't3', 't4'])).ratio, .7, 'a dragged grid that lost sessions keeps its dragged size');
assertGrid(layout.fit(layout.grid(eight), new Set(['t0', 't1', 't2', 't3', 't4'])), [['t0', 't1', 't2'], ['t3', 't4']], 'an untouched grid that lost sessions is a grid again');
// Adding to or taking from a sized split (a group) keeps the other sizes.
{
  const sized = { axis: 'row', ratio: .3, first: { id: 'a' }, second: { axis: 'row', ratio: .4, first: { id: 'b' }, second: { id: 'c' } } };
  assertCells(layout.split(JSON.parse(JSON.stringify(sized)), 'c', 'd', 'row'), { a: [0, 0, .3, 1], b: [.3, 0, .28, 1], c: [.58, 0, .21, 1], d: [.79, 0, .21, 1] }, 'a new terminal halves only the cell it opens beside');
  assertCells(layout.remove(JSON.parse(JSON.stringify(sized)), 'b'), { a: [0, 0, .3, 1], c: [.3, 0, .7, 1] }, 'a removed terminal leaves its space to its neighbour');
  assertCells(layout.drop(JSON.parse(JSON.stringify(sized)), 'a', 'd', 'column'), { a: [0, 0, .3, .5], d: [0, .5, .3, .5], b: [.3, 0, .28, 1], c: [.58, 0, .42, 1] }, 'a drop into a sized split keeps the other sizes');
  console.log('PASS layout: adding to or taking from a sized split keeps the sizes');
}
assert.strictEqual(layout.fit(null, new Set()), null);

// A whole panel dropped on one side lands there too.
assertCells(layout.place(pair, { axis: 'row', ratio: .7, first: { id: 'x' }, second: { id: 'y' } }, 'b', 'column', false, true),
  { a: [0, 0, .5, 1], b: [.5, 0, .5, .5], x: [.5, .5, .25, .5], y: [.75, .5, .25, .5] }, 'panel dropped below a terminal');

console.log('terminal-workspace-layout-test: ok');

// Dragging a divider sizes only the two terminals beside it. Three side by side
// are a nested split; before, the outer divider shrank the two on its right
// together.
{
  const three = layout.balance({ axis: 'row', ratio: .5, first: { id: 'a' }, second: { axis: 'row', ratio: .5, first: { id: 'b' }, second: { id: 'c' } } });
  const width = node => Object.fromEntries(Object.entries(cells(node)).map(([id, box]) => [id, box.w]));
  const start = width(three);
  layout.resize(three, .5);
  const moved = width(three);
  close(moved.a, .5, 'the left terminal grows to the divider');
  close(moved.c, start.c, 'the terminal not beside the divider keeps its width');
  close(moved.b, 1 - .5 - start.c, 'only its neighbour gives up the space');
  // The inner divider (b|c) leaves a alone.
  layout.resize(three.second, .3);
  close(width(three).a, .5, 'the inner divider leaves the left terminal alone');
  // A grid's row divider changes the two rows beside it only.
  const chainOf = list => list.length === 1 ? { id: list[0] } : { axis: 'row', ratio: .5, first: { id: list[0] }, second: chainOf(list.slice(1)) };
  const many = layout.grid(chainOf(['1', '2', '3', '4', '5', '6', '7', '8', '9'])); // three rows of three
  const height = node => Object.fromEntries(Object.entries(cells(node)).map(([id, box]) => [id, box.h]));
  const tall = height(many);
  layout.resize(many, .2);
  const last = Object.keys(tall).at(-1);
  close(height(many)[last], tall[last], 'the last row keeps its height when the first row divider moves');
  // Never below a usable size, and a reload keeps the sizes (ratios stay in range).
  layout.resize(three, 0);
  assert.ok(width(three).a >= .06 - 1e-9, 'a terminal keeps a minimum width');
  assert.deepEqual(layout.restore(JSON.parse(JSON.stringify(three)), new Set(['a', 'b', 'c'])), three, 'dragged sizes survive a reload');
  console.log('PASS layout: a divider resizes only the two terminals beside it');
}

// 2×2: the divider between A and C moves for the left line only, B and D keep
// their heights. The grid turns (rows → columns) with every terminal in place.
{
  const chainOf = list => list.length === 1 ? { id: list[0] } : { axis: 'row', ratio: .5, first: { id: list[0] }, second: chainOf(list.slice(1)) };
  const four = layout.grid(chainOf(['a', 'b', 'c', 'd']));
  assert.equal(layout.transposable(four), true, 'a full grid can turn');
  const before = cells(four);
  const turned = layout.transpose(four, 0);
  assert.equal(turned, four, 'turned in place, so the saved view keeps it');
  for (const [id, box] of Object.entries(cells(four))) for (const key of ['x', 'y', 'w', 'h']) close(box[key], before[id][key], `${id}.${key} stays in place`);
  const left = layout.parts(four, four.axis)[0].node;
  layout.resize(layout.divider(left, 1), .7);
  const after = cells(four);
  close(after.a.h, .7, 'A grows');
  close(after.b.h, before.b.h, 'B keeps its height');
  close(after.d.h, before.d.h, 'D keeps its height');
  assert.equal(layout.transposable(chainOf(['a', 'b', 'c'])), false, 'a single line does not turn');
  assert.equal(layout.boundary(four, layout.divider(four, 1)), 1, 'a divider knows its place');
  console.log('PASS layout: in a 2×2 grid one line can be resized without the other');
}
