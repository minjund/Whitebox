(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxWorkspaceLayout = api;
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';
  const ids = node => !node ? [] : node.id ? [node.id] : [...ids(node.first), ...ids(node.second)];
  const MIN_RATIO = .1, MAX_RATIO = .9;
  const clampRatio = value => Math.max(MIN_RATIO, Math.min(MAX_RATIO, value));
  // Number of cells a subtree occupies along `axis`. A nested split on the
  // other axis counts as one cell, so rows/columns line up as a grid.
  const span = (node, axis) => !node || node.id || node.axis !== axis ? 1 : span(node.first, axis) + span(node.second, axis);
  // Split, separate and remove operations re-align the arrangement: every
  // cell along the same axis gets an equal share instead of 50/25/12.5 halves.
  function balance(node) {
    if (!node || node.id) return node;
    const first = balance(node.first), second = balance(node.second);
    const before = span(first, node.axis), after = span(second, node.axis);
    return { ...node, ratio: clampRatio(before / (before + after)), first, second };
  }
  function insert(node, target, next, axis, before) {
    if (!node) return { id: next };
    if (node.id) return node.id === target ? { axis, ratio: 0.5, first: before ? { id: next } : node, second: before ? node : { id: next } } : node;
    return { ...node, first: insert(node.first, target, next, axis, before), second: insert(node.second, target, next, axis, before) };
  }
  function split(node, target, next, axis = 'row', before = false) {
    return balance(insert(node, target, next, axis, before));
  }
  function prune(node, target) {
    if (!node || node.id === target) return null;
    if (node.id) return node;
    const first = prune(node.first, target), second = prune(node.second, target);
    return first && second ? { ...node, first, second } : first || second;
  }
  function remove(node, target) {
    return balance(prune(node, target));
  }
  function restore(node, available, seen = new Set(), depth = 0) {
    if (!node || depth > 16) return null;
    if (typeof node.id === 'string') {
      if (!available.has(node.id) || seen.has(node.id)) return null;
      seen.add(node.id);
      return { id: node.id };
    }
    const first = restore(node.first, available, seen, depth + 1), second = restore(node.second, available, seen, depth + 1);
    return first && second ? { axis: node.axis === 'column' ? 'column' : 'row', ratio: clampRatio(Number(node.ratio) || .5), first, second } : first || second;
  }
  function reconcile(node, panels, available = new Set(panels.flatMap(ids))) {
    let result = restore(node, available);
    const present = new Set(ids(result));
    for (const panel of panels) {
      const missing = restore(panel, available, new Set(present));
      if (!missing) continue;
      result = result ? balance({ axis: 'row', ratio: .5, first: result, second: missing }) : missing;
      ids(missing).forEach(id => present.add(id));
    }
    return result;
  }
  function place(node, incoming, target, axis = 'row', before = false) {
    const incomingIds = ids(incoming);
    if (!incomingIds.length || incomingIds.includes(target)) return node;
    incoming = restore(incoming, new Set(incomingIds));
    let remaining = node;
    for (const id of incomingIds) remaining = prune(remaining, id);
    if (!remaining) return balance(incoming);
    if (!ids(remaining).includes(target)) target = ids(remaining)[0];
    const attach = branch => branch.id
      ? branch.id === target
        ? { axis, ratio: .5, first: before ? incoming : branch, second: before ? branch : incoming }
        : branch
      : { ...branch, first: attach(branch.first), second: attach(branch.second) };
    return balance(attach(remaining));
  }
  return { ids, split, remove, restore, reconcile, place, balance };
});
