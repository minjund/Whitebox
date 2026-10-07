'use strict';

// A workspace owns one split tree; each leaf contains one or more session tabs.
(() => {
  const leaf = ids => ({ tabs: ids, active: ids[0] });
  function leaves(tree) { return !tree ? [] : tree.tabs ? [tree] : [...leaves(tree.first), ...leaves(tree.second)]; }
  function prune(tree, ids) {
    if (!tree) return null;
    if (tree.tabs) {
      const tabs = tree.tabs.filter(id => ids.includes(id));
      return tabs.length ? { tabs, active: tabs.includes(tree.active) ? tree.active : tabs[0] } : null;
    }
    const first = prune(tree.first, ids), second = prune(tree.second, ids);
    return first && second ? { axis: tree.axis === 'vertical' ? 'vertical' : 'horizontal', ratio: Math.max(.15, Math.min(.85, Number(tree.ratio) || .5)), first, second } : first || second;
  }
  function reconcile(tree, ids) {
    tree = prune(tree, ids);
    for (const id of ids) if (!leaves(tree).some(pane => pane.tabs.includes(id))) {
      tree = tree ? { axis: 'horizontal', ratio: .5, first: tree, second: leaf([id]) } : leaf([id]);
    }
    return tree;
  }
  function move(tree, id, target, direction) {
    if (id === target || !leaves(tree).some(pane => pane.tabs.includes(id)) || !leaves(tree).some(pane => pane.tabs.includes(target))) return tree;
    const ids = leaves(tree).flatMap(pane => pane.tabs).filter(value => value !== id);
    tree = prune(tree, ids);
    function place(node) {
      if (node.tabs) {
        if (!node.tabs.includes(target)) return node;
        if (direction === 'tab') return { tabs: [...node.tabs, id], active: id };
        const before = ['left', 'up'].includes(direction);
        return { axis: ['up', 'down'].includes(direction) ? 'vertical' : 'horizontal', ratio: .5, first: before ? leaf([id]) : node, second: before ? node : leaf([id]) };
      }
      return { ...node, first: place(node.first), second: place(node.second) };
    }
    return place(tree);
  }
  function swap(tree, id, target) {
    if (id === target || !leaves(tree).some(pane => pane.tabs.includes(id)) || !leaves(tree).some(pane => pane.tabs.includes(target))) return tree;
    const replace = value => value === id ? target : value === target ? id : value;
    function visit(node) {
      return node.tabs ? { tabs: node.tabs.map(replace), active: replace(node.active) }
        : { ...node, first: visit(node.first), second: visit(node.second) };
    }
    return visit(tree);
  }
  const api = { leaf, leaves, reconcile, move, swap };
  if (typeof module !== 'undefined') module.exports = api;
  else window.WhiteboxGroupLayout = api;
})();
