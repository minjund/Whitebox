'use strict';
const assert = require('assert/strict');
const { reconcile, move, leaves, swap } = require('../renderer/group-layout');
const ids = ['claude-1', 'codex-1', 'claude-2'];
let tree = reconcile(null, ids);
for (const direction of ['tab', 'left', 'right', 'up', 'down']) {
  tree = move(tree, ids[0], ids[1], direction);
  assert.deepEqual(leaves(tree).flatMap(pane => pane.tabs).sort(), [...ids].sort(), 'moves retain every exact session once');
  assert.deepEqual(reconcile(JSON.parse(JSON.stringify(tree)), ids), tree, 'saved split and tab layout restores');
}
tree = move(tree, ids[0], ids[1], 'tab');
assert.equal(leaves(tree).find(pane => pane.tabs.includes(ids[1])).active, ids[0]);
tree = reconcile(tree, [ids[1], ids[2], 'gemini-1']);
assert.deepEqual(leaves(tree).flatMap(pane => pane.tabs).sort(), [ids[1], ids[2], 'gemini-1'].sort());
assert.equal(reconcile(tree, []), null);
console.log('✓ split/tab moves preserve identities; add/remove reconcile; serialized layout restores');

const original = reconcile(null, ['a','b','c']);
const swapped = swap(original, 'a', 'c');
assert.deepEqual(leaves(swapped).flatMap(pane=>pane.tabs), ['c','b','a']);
assert.deepEqual(swap(swapped, 'c', 'a'), original);
