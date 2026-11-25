(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxWorkspaceLayout = api;
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';
  const ids = node => !node ? [] : node.id ? [node.id] : [...ids(node.first), ...ids(node.second)];
  const MIN_RATIO = .05, MAX_RATIO = .95;
  const clampRatio = value => Math.max(MIN_RATIO, Math.min(MAX_RATIO, value));
  // Number of cells a subtree occupies along `axis`. A nested split on the
  // other axis counts as one cell, so rows/columns line up as a grid.
  const span = (node, axis) => !node || node.id || node.axis !== axis ? 1 : span(node.first, axis) + span(node.second, axis);
  // Every cell along the same axis gets an equal share.
  function balance(node) {
    if (!node || node.id) return node;
    const first = balance(node.first), second = balance(node.second);
    const before = span(first, node.axis), after = span(second, node.axis);
    return { ...node, ratio: clampRatio(before / (before + after)), first, second };
  }
  // The automatic arrangement is an aligned grid in reading order: about as
  // many columns as rows, equal cells, and no row more than one cell longer
  // than another (5 terminals: 3 over 2).
  function chain(items, axis) {
    return items.length === 1 ? items[0] : { axis, ratio: 1 / items.length, first: items[0], second: chain(items.slice(1), axis) };
  }
  function grid(node) {
    const list = ids(node);
    if (!list.length) return null;
    const columns = Math.ceil(Math.sqrt(list.length)), rows = Math.ceil(list.length / columns);
    const base = Math.floor(list.length / rows), extra = list.length % rows, lines = [];
    for (let row = 0, start = 0; row < rows; row++) {
      const size = base + (row < extra ? 1 : 0);
      lines.push(chain(list.slice(start, start += size).map(id => ({ id })), 'row'));
    }
    return balance(chain(lines, 'column'));
  }
  // Same cells in the same places; ratios may differ after a divider drag.
  function sameShape(left, right) {
    if (!left || !right) return left === right;
    if (left.id || right.id) return left.id === right.id;
    return left.axis === right.axis && sameShape(left.first, right.first) && sameShape(left.second, right.second);
  }
  // Same cells and the same sizes (no divider was dragged).
  function sameSizes(left, right) {
    if (!left || !right) return left === right;
    if (left.id || right.id) return left.id === right.id;
    return left.axis === right.axis && Math.abs((Number(left.ratio) || .5) - (Number(right.ratio) || .5)) < 1e-6
      && sameSizes(left.first, right.first) && sameSizes(left.second, right.second);
  }
  const untouched = node => sameSizes(node, grid(node)) || sameSizes(node, balance(node));
  // `after` is `before` with cells the app added or dropped. A view that was
  // the automatic grid, sizes untouched, stays one; one arranged by dropping,
  // sizes untouched, shares the space evenly again. Once a divider was dragged
  // the sizes are the person's: the cells that stay keep them, a removed
  // cell's space goes to its neighbour and a new cell halves the one it opens
  // beside.
  function settle(before, after) {
    if (!after || sameShape(before, after)) return after;
    if (sameSizes(before, grid(before))) return grid(after);
    if (sameSizes(before, balance(before))) return balance(after);
    return after;
  }
  // A drop or a placed panel: even shares again unless the person sized the view.
  const even = (before, after) => !before || untouched(before) ? balance(after) : after;
  function insert(node, target, next, axis, before) {
    if (!node) return { id: next };
    if (node.id) return node.id === target ? { axis, ratio: 0.5, first: before ? { id: next } : node, second: before ? node : { id: next } } : node;
    return { ...node, first: insert(node.first, target, next, axis, before), second: insert(node.second, target, next, axis, before) };
  }
  // Open `next` beside `target` without the user choosing where.
  function split(node, target, next, axis = 'row', before = false) {
    return settle(node, insert(node, target, next, axis, before));
  }
  function prune(node, target) {
    if (!node || node.id === target) return null;
    if (node.id) return node;
    const first = prune(node.first, target), second = prune(node.second, target);
    return first && second ? { ...node, first, second } : first || second;
  }
  function remove(node, target) {
    return settle(node, prune(node, target));
  }
  // The user dropped `next` on one side of `target`: it lands exactly there.
  function drop(node, target, next, axis = 'row', before = false) {
    return even(node, insert(prune(node, next), target, next, axis, before));
  }
  // A saved view without the sessions that are gone.
  function fit(node, available) {
    return settle(node, restore(node, available));
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
      result = result ? { axis: 'row', ratio: .5, first: result, second: missing } : missing;
      ids(missing).forEach(id => present.add(id));
    }
    return settle(node, result);
  }
  // Put a whole panel beside `target`. `chosen` means the user dropped it on
  // that side, so it lands exactly there.
  function place(node, incoming, target, axis = 'row', before = false, chosen = false) {
    const incomingIds = ids(incoming);
    if (!incomingIds.length || incomingIds.includes(target)) return node;
    incoming = restore(incoming, new Set(incomingIds));
    let remaining = node;
    for (const id of incomingIds) remaining = prune(remaining, id);
    if (!remaining) return grid(incoming);
    if (!ids(remaining).includes(target)) target = ids(remaining)[0];
    const attach = branch => branch.id
      ? branch.id === target
        ? { axis, ratio: .5, first: before ? incoming : branch, second: before ? branch : incoming }
        : branch
      : { ...branch, first: attach(branch.first), second: attach(branch.second) };
    return chosen ? even(node, attach(remaining)) : settle(node, attach(remaining));
  }
  // Cells side by side along `axis` under a split, with their share of it. A
  // split on the other axis is one cell.
  function cells(node, axis, share = 1, out = []) {
    if (node && !node.id && node.axis === axis) {
      cells(node.first, axis, share * node.ratio, out);
      cells(node.second, axis, share * (1 - node.ratio), out);
    } else out.push(share);
    return out;
  }
  function share(node, axis, sizes, at = { index: 0 }) {
    if (!node || node.id || node.axis !== axis) return sizes[at.index++];
    const first = share(node.first, axis, sizes, at), second = share(node.second, axis, sizes, at);
    node.ratio = first / (first + second);
    return first + second;
  }
  // Dragging a divider sizes only the two cells beside it; every other cell
  // keeps its size, even when the split nests several cells (3 or more side
  // by side). `position` is where the divider goes, as a share of the split.
  const MIN_CELL = .06;
  function resize(node, position) {
    if (!node || node.id) return node;
    const sizes = cells(node, node.axis), at = cells(node.first, node.axis).length;
    const before = sizes.slice(0, at - 1).reduce((sum, value) => sum + value, 0);
    const pair = sizes[at - 1] + sizes[at], min = Math.min(MIN_CELL, pair / 2);
    const edge = Math.max(before + min, Math.min(before + pair - min, Number(position) || 0));
    sizes[at - 1] = edge - before; sizes[at] = pair - sizes[at - 1];
    share(node, node.axis, sizes);
    return node;
  }
  // The cells of a same-axis run as subtrees with their share of it.
  function parts(node, axis, part = 1, out = []) {
    if (node && !node.id && node.axis === axis) {
      parts(node.first, axis, part * node.ratio, out);
      parts(node.second, axis, part * (1 - node.ratio), out);
    } else out.push({ node, share: part });
    return out;
  }
  function chainOf(items, axis) {
    if (items.length === 1) return items[0].node;
    const total = items.reduce((sum, item) => sum + item.share, 0);
    return { axis, ratio: clampRatio(items[0].share / total), first: items[0].node, second: chainOf(items.slice(1), axis) };
  }
  const other = axis => axis === 'row' ? 'column' : 'row';
  // Rows of the same number of terminals (2×2, 3×3) can turn into columns.
  function transposable(node) {
    if (!node || node.id) return false;
    const lines = parts(node, node.axis), across = other(node.axis);
    const counts = lines.map(line => line.node && !line.node.id && line.node.axis === across ? parts(line.node, across).length : 1);
    return lines.length > 1 && counts[0] > 1 && counts.every(count => count === counts[0]);
  }
  // Rows become columns (or columns rows), in place, the same terminals in the
  // same places. The line `widthsFrom` gives the new lines their sizes; each
  // new line's cells keep the old lines' sizes. A divider across the grid then
  // moves for one line only: dragging between A and C leaves B and D alone.
  function transpose(node, widthsFrom = 0) {
    if (!transposable(node)) return null;
    const axis = node.axis, across = other(axis), lines = parts(node, axis);
    const grid = lines.map(line => parts(line.node, across));
    const source = grid[Math.max(0, Math.min(grid.length - 1, widthsFrom))];
    const next = chainOf(source.map((cell, column) => ({ share: cell.share,
      node: chainOf(lines.map((line, row) => ({ share: line.share, node: grid[row][column].node })), axis) })), across);
    for (const key of Object.keys(node)) delete node[key];
    return Object.assign(node, next);
  }
  // Where a divider sits in its run: the number of cells before it.
  function boundary(run, target) {
    const before = cells(run.first, run.axis).length;
    if (run === target) return before;
    const inside = (node, wanted) => node === wanted || Boolean(node && !node.id && node.axis === run.axis && (inside(node.first, wanted) || inside(node.second, wanted)));
    return inside(run.first, target) ? boundary(run.first, target) : before + boundary(run.second, target);
  }
  // The split in a run whose divider has `index` cells before it.
  function divider(run, index) {
    if (!run || run.id) return null;
    const before = cells(run.first, run.axis).length;
    if (index === before) return run;
    return index < before ? divider(run.first, index) : divider(run.second, index - before);
  }
  return { ids, split, drop, remove, restore, fit, reconcile, place, balance, grid, cells, resize, parts, transposable, transpose, boundary, divider };
});
