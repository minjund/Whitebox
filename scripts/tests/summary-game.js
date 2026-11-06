'use strict';
const assert = require('node:assert/strict');

exports.run = async evaluate => {
  const result = await evaluate(`(async () => {
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const host = document.createElement('div'); host.id = 'terminalWorkspace';
    Object.assign(host.style, { position: 'fixed', top: '0', left: '0', width: '320px', height: '1000px', display: 'block', zIndex: '9999' });
    const root = document.createElement('div'); host.append(root); document.body.append(host);
    const originalMedia = window.matchMedia; let reduced = false;
    window.matchMedia = query => query.includes('prefers-reduced-motion') ? { matches: reduced } : originalMedia.call(window, query);
    let record = { game2048: { cells: [2,2,...Array(14).fill(0)], score: 0, best: 0, open: true } };
    try {
      const view = Whitebox2048.createView({ root, t: text => text, read: () => record, save: () => {} }); view.render();
      const board = root.querySelector('.wb-2048-board');
      board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      check(root.querySelectorAll('.wb-2048-moving').length === 2, 'both original tiles slide into the merged cell');
      check([...root.querySelectorAll('.wb-2048-moving')].some(tile => tile.getAnimations()[0].effect.getKeyframes().at(-1).transform !== 'translate(0, 0)'), 'motion uses real source/destination positions');
      // The animation timeline follows rendered frames, not a wall-clock
      // timeout. Wait for the real slides before inspecting merge effects.
      await Promise.all([...root.querySelectorAll('.wb-2048-moving')].flatMap(tile => tile.getAnimations().map(animation => animation.finished)));
      await Promise.resolve();
      check(root.querySelectorAll('.wb-2048-moving').length === 0, 'slide layers are removed after movement');
      check(root.querySelectorAll('.wb-2048-cell')[0].getAnimations().length > 0, 'merge receives a pop animation');
      check(record.game2048.cells[0] === 4 && record.game2048.score === 4, 'animation preserves game rules and score');
      // Rapid keys commit every valid move while prior motion is cancelled.
      const originalRandom = Math.random, before = structuredClone(record.game2048);
      Math.random = () => 0;
      let expected = before;
      try {
        for (const [key, direction] of [['ArrowDown','down'],['ArrowRight','right'],['ArrowUp','up'],['ArrowLeft','left']]) {
          expected = Whitebox2048.move(expected, direction, () => 0);
          board.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        }
      } finally { Math.random = originalRandom; }
      check(JSON.stringify(record.game2048.cells) === JSON.stringify(expected.cells) && record.game2048.score === expected.score, 'rapid input loses no moves');
      reduced = true;
      board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      check(!root.querySelector('.wb-2048-moving') && board.getAnimations({ subtree: true }).length === 0, 'reduced motion cancels prior effects and skips all new animation');
      reduced = false;
      board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      record = { game2048: Whitebox2048.start() }; view.render();
      check(!root.querySelector('.wb-2048-moving') && [...root.querySelectorAll('.wb-2048-cell')].every(cell => !cell.style.color), 'switching games clears effects and hidden values');

      return { animations: true, reducedMotion: true, rapidInput: true };
    } finally { window.matchMedia = originalMedia; host.remove(); }
  })()`);
  assert.equal(result.animations && result.reducedMotion && result.rapidInput, true);
  console.log('PASS 2048 game UI: real tile sliding/merge pop, rapid input, reduced motion and switch cleanup');
};
