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
    if (empty.length) cells[empty[Math.floor(random() * empty.length)]] = random() < .9 ? 2 : 4;
  }
  function start(best = 0, random = Math.random) {
    const game = { cells: Array(16).fill(0), score: 0, best, open: true };
    spawn(game.cells, random); spawn(game.cells, random); return game;
  }
  function indexes(direction, line) {
    return Array.from({ length: 4 }, (_, i) => direction === 'left' ? line * 4 + i
      : direction === 'right' ? line * 4 + 3 - i : direction === 'up' ? i * 4 + line : (3 - i) * 4 + line);
  }
  function slide(game, direction) {
    const next = { ...game, cells: [...game.cells] };
    for (let line = 0; line < 4; line++) {
      const slots = indexes(direction, line), tiles = slots.map(index => game.cells[index]).filter(Boolean), merged = [];
      for (let i = 0; i < tiles.length; i++) {
        if (tiles[i] === tiles[i + 1] && tiles[i] < 2 ** 30) {
          const tile = tiles[i] * 2; merged.push(tile); next.score += tile; i++;
        } else merged.push(tiles[i]);
      }
      slots.forEach((slot, i) => { next.cells[slot] = merged[i] || 0; });
    }
    next.best = Math.max(next.best, next.score); return next;
  }
  function move(game, direction, random = Math.random) {
    if (!directions.includes(direction)) return game;
    const next = slide(game, direction);
    if (next.cells.every((tile, i) => tile === game.cells[i])) return game;
    spawn(next.cells, random); return next;
  }
  function over(game) { return directions.every(direction => slide(game, direction).cells.every((tile, i) => tile === game.cells[i])); }
  function createView({ root, t, read, save }) {
    let waiting = false, completed = false, swipe = null;
    root.innerHTML = `<button type="button" data-game-open></button><div class="wb-2048-panel" hidden>
      <header><strong>2048</strong><span data-game-score></span><button type="button" data-game-close></button></header>
      <p class="wb-2048-status" data-game-status role="status" aria-live="polite"></p>
      <div class="wb-2048-board" tabindex="0" role="group">${Array.from({ length: 16 }, () => '<span class="wb-2048-cell" aria-hidden="true"></span>').join('')}</div>
      <div class="wb-2048-controls">${directions.map((direction, i) => `<button type="button" data-game-direction="${direction}">${['←', '↑', '→', '↓'][i]}</button>`).join('')}<button type="button" data-game-new></button></div>
      <p class="wb-2048-hint" data-game-hint></p></div>`;
    const $ = selector => root.querySelector(selector), board = $('.wb-2048-board'), cells = [...root.querySelectorAll('.wb-2048-cell')];
    function render(options) {
      if (options) { waiting = options.waiting; completed = options.completed ?? !waiting; }
      root.dataset.waiting = String(Boolean(waiting));
      const game = read()?.game2048;
      root.hidden = !waiting && !game?.open;
      $('[data-game-open]').hidden = Boolean(game?.open);
      $('[data-game-open]').textContent = t('잠깐 놀기 · 2048');
      $('.wb-2048-panel').hidden = !game?.open;
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
      if (!value?.game2048?.open) return;
      const next = move(value.game2048, direction);
      if (next !== value.game2048) { value.game2048 = next; save(); render(); }
    }
    root.addEventListener('click', event => {
      const value = read(); if (!value) return;
      const button = event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-game-open')) { value.game2048 = value.game2048 || start(); value.game2048.open = true; }
      else if (button.hasAttribute('data-game-close')) value.game2048.open = false;
      else if (button.hasAttribute('data-game-new')) value.game2048 = start(value.game2048?.best);
      else if (button.dataset.gameDirection) { play(button.dataset.gameDirection); return; }
      save(); render();
      if (value.game2048.open) board.focus();
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
  const api = { start, move, over, restore, createView };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Whitebox2048 = api;
})();
