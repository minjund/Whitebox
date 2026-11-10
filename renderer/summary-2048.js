'use strict';
// Independently implemented 2048 rules; no external game code, art or fonts.
(() => {
  const directions = ['left', 'up', 'right', 'down'];
  const validTile = n => n === 0 || Number.isSafeInteger(n) && n >= 2 && n <= 2 ** 30 && Number.isInteger(Math.log2(n));
  function restore(value) {
    if (!value || !Array.isArray(value.cells) || value.cells.length !== 16 || !value.cells.every(validTile)
      || !Number.isSafeInteger(value.score) || value.score < 0 || value.score > 2 ** 42) return null;
    return { cells: [...value.cells], score: value.score,
      best: Number.isSafeInteger(value.best) && value.best >= value.score && value.best <= 2 ** 42 ? value.best : value.score,
      open: Boolean(value.open) };
  }
  function spawn(cells, random) {
    const empty = cells.map((tile, index) => tile ? -1 : index).filter(index => index >= 0);
    if (!empty.length) return null;
    const index = empty[Math.floor(random() * empty.length)];
    cells[index] = random() < .9 ? 2 : 4; return index;
  }
  function start(best = 0, random = Math.random) {
    const game = { cells: Array(16).fill(0), score: 0, best, open: true };
    spawn(game.cells, random); spawn(game.cells, random); return game;
  }
  function indexes(direction, line) {
    return Array.from({ length: 4 }, (_, i) => direction === 'left' ? line * 4 + i
      : direction === 'right' ? line * 4 + 3 - i : direction === 'up' ? i * 4 + line : (3 - i) * 4 + line);
  }
  function slide(game, direction, trace = null) {
    const next = { ...game, cells: [...game.cells] };
    for (let line = 0; line < 4; line++) {
      const slots = indexes(direction, line), tiles = slots.filter(index => game.cells[index]).map(index => ({ index, value: game.cells[index] })), merged = [];
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i], to = slots[merged.length];
        trace?.motions.push({ from: tile.index, to, value: tile.value });
        if (tile.value === tiles[i + 1]?.value && tile.value < 2 ** 30) {
          trace?.motions.push({ from: tiles[i + 1].index, to, value: tile.value }); trace?.merged.push(to);
          const value = tile.value * 2; merged.push(value); next.score += value; i++;
        } else merged.push(tile.value);
      }
      slots.forEach((slot, i) => { next.cells[slot] = merged[i] || 0; });
    }
    next.best = Math.max(next.best, next.score); return next;
  }
  function move(game, direction, random = Math.random) {
    return step(game, direction, random).game;
  }
  function step(game, direction, random = Math.random) {
    const trace = { game, motions: [], merged: [], spawned: null, gain: 0 };
    if (!directions.includes(direction)) return trace;
    const next = slide(game, direction, trace);
    if (next.cells.every((tile, i) => tile === game.cells[i])) return { ...trace, motions: [], merged: [] };
    return { ...trace, game: next, spawned: spawn(next.cells, random), gain: next.score - game.score };
  }
  function over(game) { return directions.every(direction => slide(game, direction).cells.every((tile, i) => tile === game.cells[i])); }
  function createView({ root, t, read, save, visibility = () => 'always', behavior = () => 'auto-collapse',
    store = { get: value => value?.game2048, set: (value, game) => { value.game2048 = game; } } }) {
    // `read` is the viewed conversation; `store` may hold one board shared by all of them.
    let waiting = false, completed = false, swipe = null, replyKey = null;
    const observed = new WeakMap();
    let animationOwner = null, animationGame = null, animationEpoch = 0;
    const animations = new Set(), ghosts = new Set();
    root.innerHTML = `<button type="button" data-game-open></button><div class="wb-2048-panel" hidden>
      <header><strong>2048</strong><span data-game-score></span><button type="button" data-game-close></button></header>
      <p class="wb-2048-status" data-game-status role="status" aria-live="polite"></p>
      <div class="wb-2048-board" tabindex="0" role="group">${Array.from({ length: 16 }, () => '<span class="wb-2048-cell" aria-hidden="true"></span>').join('')}</div>
      <div class="wb-2048-controls">${directions.map((direction, i) => `<button type="button" data-game-direction="${direction}">${['←', '↑', '→', '↓'][i]}</button>`).join('')}<button type="button" data-game-new></button></div>
      <p class="wb-2048-hint" data-game-hint></p>
      </div>`;
    const $ = selector => root.querySelector(selector), board = $('.wb-2048-board'), cells = [...root.querySelectorAll('.wb-2048-cell')];
    function clearAnimation() {
      animationEpoch++;
      for (const animation of animations) animation.cancel(); animations.clear();
      for (const ghost of ghosts) ghost.remove(); ghosts.clear();
      cells.forEach(cell => { cell.style.color = ''; cell.style.background = ''; });
      animationOwner = null; animationGame = null;
    }
    function animate(element, frames, options) {
      const animation = element.animate(frames, options); animations.add(animation);
      animation.finished.then(() => { animations.delete(animation); animation.cancel(); }, () => { animations.delete(animation); });
      return animation;
    }
    function animateMove(value, result) {
      if (!board.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !board.getBoundingClientRect().width) return;
      animationOwner = value; animationGame = result.game;
      const epoch = animationEpoch, bounds = board.getBoundingClientRect();
      const boxes = cells.map(cell => cell.getBoundingClientRect());
      cells.forEach(cell => { cell.style.color = 'transparent'; cell.style.background = 'var(--wb-line)'; });
      const slides = result.motions.map(motion => {
        const ghost = document.createElement('span'), from = boxes[motion.from], to = boxes[motion.to];
        ghost.className = 'wb-2048-cell wb-2048-moving'; ghost.textContent = motion.value;
        ghost.dataset.level = String(Math.min(11, Math.log2(motion.value))); ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, { left: from.left - bounds.left + 'px', top: from.top - bounds.top + 'px', width: from.width + 'px', height: from.height + 'px' });
        board.append(ghost); ghosts.add(ghost);
        return animate(ghost, [{ transform: 'translate(0, 0)' }, { transform: 'translate(' + (to.left - from.left) + 'px, ' + (to.top - from.top) + 'px)' }],
          { duration: 130, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }).finished;
      });
      Promise.allSettled(slides).then(() => {
        if (epoch !== animationEpoch) return;
        clearAnimation();
        if (read() !== value || store.get(value) !== result.game || root.hidden) return;
        animationOwner = value; animationGame = result.game;
        for (const index of result.merged) animate(cells[index], [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: .45 }, { transform: 'scale(1)' }], { duration: 170 });
        if (result.spawned !== null) animate(cells[result.spawned], [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 150 });
        if (result.gain) animate($('[data-game-score]'), [{ transform: 'translateY(-4px)', color: 'var(--wb-accent)' }, { transform: 'translateY(0)' }], { duration: 220 });
      });
    }
    function render(options) {
      if (options) { waiting = options.waiting; completed = options.completed ?? !waiting; replyKey = options.replyKey || null; }
      root.dataset.waiting = String(Boolean(waiting));
      const value = read();
      if (value && !store.get(value)) { store.set(value, start()); save(); }
      const game = value ? store.get(value) : null;
      let restoreFocus = false;
      if (game) {
        const previous = observed.get(value), policy = behavior();
        const freshReply = replyKey && previous?.replyKey !== replyKey;
        const reopen = previous?.policy !== policy && policy === 'always-open';
        // "While the AI works or summarizes" folds the board when that wait
        // ends; the game itself and its open button always stay available.
        const waitEnded = visibility() === 'summarizing' && previous?.waiting === true && !waiting;
        const collapse = waitEnded || policy === 'auto-collapse' && (freshReply || previous?.policy !== policy && replyKey);
        observed.set(value, { policy, replyKey: replyKey || previous?.replyKey, waiting: Boolean(waiting) });
        if ((collapse && game.open) || (reopen && !game.open)) {
          restoreFocus = Boolean(collapse && root.contains(document.activeElement));
          game.open = !collapse; save();
        }
      }
      root.hidden = !value;
      if (animationOwner && (animationOwner !== value || animationGame !== game || root.hidden || !game?.open)) clearAnimation();
      $('[data-game-open]').hidden = Boolean(game?.open);
      $('[data-game-open]').textContent = t('잠깐 놀기 · 2048');
      $('.wb-2048-panel').hidden = !game?.open;
      if (restoreFocus && !root.hidden) $('[data-game-open]').focus({ preventScroll: true });
      if (!game?.open) return;
      $('[data-game-close]').textContent = t('접기');
      $('[data-game-new]').textContent = t('새 게임');
      $('[data-game-score]').textContent = `${t('점수')} ${game.score} · ${t('최고')} ${game.best}`;
      $('[data-game-status]').textContent = over(game) ? t('더 움직일 수 없어요. 새 게임에 도전하세요.')
        : completed ? t('요약 완료 · 대화에서 결과를 확인하세요.')
        : game.cells.some(tile => tile >= 2048) ? t('2048 달성! 계속 이어갈 수 있어요.') : t('같은 숫자를 합쳐 2048을 만들어 보세요.');
      $('[data-game-hint]').textContent = t('보드를 클릭한 뒤 방향키 · 스와이프 · 아래 버튼으로 이동');
      directions.forEach((direction, i) => { $(`[data-game-direction="${direction}"]`).setAttribute('aria-label', t(['왼쪽', '위쪽', '오른쪽', '아래쪽'][i])); });
      board.setAttribute('aria-label', `${t('2048 게임 보드')}: ${game.cells.map(tile => tile || '·').join(', ')}`);
      cells.forEach((cell, i) => {
        cell.textContent = game.cells[i] || ''; cell.dataset.level = String(game.cells[i] ? Math.min(11, Math.log2(game.cells[i])) : 0);
      });
    }
    function play(direction) {
      const value = read();
      if (!value || !store.get(value)?.open) return;
      clearAnimation();
      const result = step(store.get(value), direction);
      if (result.game !== store.get(value)) { store.set(value, result.game); save(); render(); animateMove(value, result); }
    }
    root.addEventListener('click', event => {
      const value = read(); if (!value) return;
      const button = event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-game-open')) { if (!store.get(value)) store.set(value, start()); store.get(value).open = true; }
      else if (button.hasAttribute('data-game-close')) store.get(value).open = false;
      else if (button.hasAttribute('data-game-new')) store.set(value, start(store.get(value)?.best));
      else if (button.dataset.gameDirection) { play(button.dataset.gameDirection); return; }
      save(); render();
      if (store.get(value).open) board.focus();
      else if (!root.hidden) $('[data-game-open]').focus({ preventScroll: true });
    });
    board.addEventListener('keydown', event => {
      const direction = { ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down' }[event.key];
      if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); play(direction);
    });
    board.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      swipe = { id: event.pointerId, x: event.clientX, y: event.clientY }; board.setPointerCapture(event.pointerId); board.focus({ preventScroll: true });
    });
    board.addEventListener('pointerup', event => {
      if (!swipe || swipe.id !== event.pointerId) return;
      const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y; swipe = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
      play(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
    });
    board.addEventListener('pointercancel', () => { swipe = null; });
    return { render };
  }
  const api = { start, move, step, over, restore, createView };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Whitebox2048 = api;
})();
