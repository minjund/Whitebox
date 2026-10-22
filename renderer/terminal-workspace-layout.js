(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxWorkspaceLayout = api;
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';
  const ids = node => !node ? [] : node.id ? [node.id] : [...ids(node.first), ...ids(node.second)];
  function split(node, target, next, axis = 'row', before = false) {
    if (!node) return { id: next };
    if (node.id) return node.id === target ? { axis, ratio: 0.5, first: before ? { id: next } : node, second: before ? node : { id: next } } : node;
    return { ...node, first: split(node.first, target, next, axis, before), second: split(node.second, target, next, axis, before) };
  }
  function remove(node, target) {
    if (!node || node.id === target) return null;
    if (node.id) return node;
    const first = remove(node.first, target), second = remove(node.second, target);
    return first && second ? { ...node, first, second } : first || second;
  }
  function restore(node, available, seen = new Set(), depth = 0) {
    if (!node || depth > 16) return null;
    if (typeof node.id === 'string') {
      if (!available.has(node.id) || seen.has(node.id)) return null;
      seen.add(node.id);
      return { id: node.id };
    }
    const first = restore(node.first, available, seen, depth + 1), second = restore(node.second, available, seen, depth + 1);
    return first && second ? { axis: node.axis === 'column' ? 'column' : 'row', ratio: Math.max(.15, Math.min(.85, Number(node.ratio) || .5)), first, second } : first || second;
  }
  return { ids, split, remove, restore };
});
