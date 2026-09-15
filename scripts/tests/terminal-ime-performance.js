'use strict';

const assert = require('node:assert/strict');

// Count work in the real Chromium/Ghostty fixture. Wall-clock timings are
// diagnostic only; correctness must not depend on the machine's speed.
module.exports = async function checkImePerformance(evaluate, report) {
  const result = await evaluate(async () => {
    await reset(term);
    term.resize(160, 30);
    await outputTo(term, '가다  END\x1b[3G');
    start(term);
    update(term, 'ㅎ');
    await delay();
    const tail = term.element.querySelector('.whitebox-ime-tail');
    let measurements = 0;
    let tailRebuilds = 0;
    let fullPaints = 0;
    let rowPaints = 0;
    const measure = term.measureTextCells;
    const render = term.renderer.render;
    const renderLine = term.renderer.renderLine;
    const observer = new MutationObserver(records => {
      tailRebuilds += records.filter(record => record.target === tail).length;
    });
    observer.observe(tail, { childList: true });
    term.measureTextCells = function (...args) { measurements += 1; return measure.apply(this, args); };
    term.renderer.render = function (...args) {
      if (args[1]) fullPaints += 1;
      return render.apply(this, args);
    };
    term.renderer.renderLine = function (...args) { rowPaints += 1; return renderLine.apply(this, args); };
    try {
      const started = performance.now();
      for (let index = 0; index < 120; index += 1) update(term, ['ㅎ', '하', '한'][index % 3]);
      const inputMs = performance.now() - started;
      await delay();
      const burst = { measurements, tailRebuilds, inputMs, text: snapshot().text };

      measurements = 0; tailRebuilds = 0;
      const firstTailCell = tail.firstChild;
      for (const text of ['ㅎ', '하', '한', '한']) {
        update(term, text);
        await delay();
      }
      const stableTail = { measurements, tailRebuilds, reused: tail.firstChild === firstTailCell };

      fullPaints = 0; rowPaints = 0; measurements = 0; tailRebuilds = 0;
      const outputStarted = performance.now();
      for (let index = 0; index < 40; index += 1) {
        term.write(`\x1b[s\x1b[3;1H출력 ${index}\x1b[u`);
      }
      const outputMs = performance.now() - outputStarted;
      await delay();
      const output = { fullPaints, rowPaints, measurements, tailRebuilds, outputMs,
        text: term.buffer.active.getLine(2).translateToString(true), preedit: snapshot().text };

      fullPaints = 0;
      receiveOutput({ id: entry.host.dataset.terminalScreen, data: '\x1b[s\x1b[4;1H실시간 출력\x1b[u' });
      await delay();
      const liveOutput = { fullPaints, text: term.buffer.active.getLine(3).translateToString(true) };

      await outputTo(term, '\x1b[s\x1b[3G\x1b[38;2;12;34;56m뒤\x1b[0m  NEW\x1b[u');
      await delay();
      const changedTail = { text: tail.textContent,
        color: getComputedStyle(tail.firstChild).color };
      // Ending before the queued paint must not resurrect the overlay.
      update(term, '한');
      end(term, '한');
      await delay();
      const hiddenAfterCommit = !snapshot().visible;
      return { burst, stableTail, output, liveOutput, changedTail, hiddenAfterCommit };
    } finally {
      observer.disconnect();
      term.measureTextCells = measure;
      term.renderer.render = render;
      term.renderer.renderLine = renderLine;
      term.resize(80, 10);
    }
  });
  report(result);
  assert.equal(result.burst.text, '한');
  assert(result.burst.measurements <= 2, 'A queued input burst should measure only the latest preedit');
  assert(result.burst.tailRebuilds <= 1, 'A queued input burst should not repeatedly rebuild the row');
  assert.equal(result.stableTail.reused, true, 'Typing alone must preserve the unchanged row nodes');
  assert.equal(result.stableTail.tailRebuilds, 0);
  assert(result.output.fullPaints <= 1, 'Small output fragments must not each repaint the whole terminal');
  assert.equal(result.output.text, '출력 39');
  assert.equal(result.output.preedit, '한');
  assert.equal(result.liveOutput.text, '실시간 출력');
  assert.equal(result.liveOutput.fullPaints, 0, 'The app output queue must retain dirty-row rendering');
  assert(result.changedTail.text.startsWith('뒤  NEW'));
  assert.equal(result.changedTail.color, 'rgb(12, 34, 56)');
  assert.equal(result.hiddenAfterCommit, true);
  return result;
};
