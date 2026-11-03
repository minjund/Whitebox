'use strict';
const assert = require('node:assert/strict');

module.exports = async function checkTerminalRightEdge(evaluate, webContents) {
  const results = await evaluate(async () => {
    const results = [];
    const previousFontSize = term.options.fontSize;
    const previousSize = { cols: term.cols, rows: term.rows };
    for (const history of [false, true]) for (const fontSize of [11, 14, 24]) {
      term.reset(); term.options.fontSize = fontSize; term.resize(80, 10);
      if (history) await write(Array.from({ length: 30 }, (_, i) => `history-${i}\r\n`).join(''));
      await write('\x1b[?25l\x1b[1;79H\x1b[48;2;240;32;32m끝\x1b[0m');
      term.refresh(); await delay();
      const canvas = term.renderer.getCanvas(), metrics = term.renderer.getMetrics();
      const scale = canvas.width / (term.cols * metrics.width);
      const pixel = [...canvas.getContext('2d').getImageData(Math.floor((term.cols * metrics.width - 2) * scale), Math.floor((metrics.height - 1) * scale), 1, 1).data];
      results.push({ history, fontSize, pixel, last: term.buffer.active.getLine(term.buffer.active.baseY).translateToString(true).slice(-1), scale });
    }
    term.options.fontSize = previousFontSize;
    term.reset(); term.resize(previousSize.cols, previousSize.rows);
    return results;
  });
  for (const result of results) {
    assert.equal(result.last, '끝');
    assert.deepEqual(result.pixel, [240, 32, 32, 255], `The last terminal cell must remain painted after refresh: ${JSON.stringify(result)}`);
  }
  const scroll = await evaluate(async () => {
    term.reset(); term.resize(80, 20);
    await write(Array.from({ length: 100 }, (_, i) => `edge-history-${i}\r\n`).join(''));
    term.scrollToBottom(); await delay();
    const canvas = term.renderer.getCanvas().getBoundingClientRect();
    const bar = term.element.querySelector('[role=scrollbar]');
    window.edgePointerTrace = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) bar.addEventListener(type, event => edgePointerTrace.push({ type, target: event.target.className, y: event.clientY, captured: bar.hasPointerCapture(event.pointerId) }));
    const rect = bar.getBoundingClientRect(), thumb = bar.firstChild.getBoundingClientRect();
    return { outsideGrid: rect.left >= canvas.right, visible: !bar.hidden, maximum: term.buffer.active.baseY,
      controlsGrid: document.getElementById(bar.getAttribute('aria-controls')) === term.renderer.getCanvas(),
      x: rect.left + rect.width / 2, y: thumb.top + thumb.height / 2, top: rect.top + 4,
      ariaMaximum: bar.getAttribute('aria-valuemax') };
  });
  assert(scroll.outsideGrid && scroll.visible, 'Scrollback controls belong outside the terminal text grid');
  assert.equal(scroll.controlsGrid, true, 'Accessible scroll controls identify their terminal grid');
  assert.equal(Number(scroll.ariaMaximum), scroll.maximum);
  webContents.debugger.attach('1.3');
  try {
    const mouse = params => webContents.debugger.sendCommand('Input.dispatchMouseEvent', params);
    await mouse({ type: 'mouseMoved', x: scroll.x, y: scroll.y });
    await mouse({ type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, x: scroll.x, y: scroll.y });
    await mouse({ type: 'mouseMoved', button: 'left', buttons: 1, x: scroll.x, y: scroll.top });
    await mouse({ type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: scroll.x, y: scroll.top });
  } finally { webContents.debugger.detach(); }
  const moved = await evaluate(async () => { await delay(); return { position: term.buffer.active.viewportY, events: edgePointerTrace }; });
  assert.equal(moved.position, 0, 'Dragging the external thumb to the top reaches the first scrollback row: ' + JSON.stringify({ scroll, moved }));
  const lastColumn = await evaluate(async () => {
    term.scrollToBottom(); await delay();
    const bounds = term.renderer.getCanvas().getBoundingClientRect();
    return { x: bounds.right - 7, y: bounds.top + term.renderer.getMetrics().height / 2, position: term.buffer.active.viewportY };
  });
  webContents.debugger.attach('1.3');
  try {
    for (const type of ['mousePressed', 'mouseReleased']) await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, x: lastColumn.x, y: lastColumn.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
    });
  } finally { webContents.debugger.detach(); }
  const afterClick = await evaluate(async () => { await delay(); return term.buffer.active.viewportY; });
  assert.equal(afterClick, lastColumn.position, 'Clicking the last text column must not hit an invisible native scrollbar');
  const keyboard = await evaluate(async () => {
    const bar = term.element.querySelector('[role=scrollbar]');
    writes.length = 0;
    for (const key of ['End', 'ArrowUp', 'ArrowLeft', 'x', 'Escape']) bar.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === 'x' ? 'KeyX' : key, bubbles: true, cancelable: true }));
    await delay();
    const state = { position: term.buffer.active.viewportY, maximum: term.buffer.active.baseY, input: writes.join('') };
    await write('\x1b[?1000h\x1b[?1006h'); writes.length = 0;
    const rect = bar.getBoundingClientRect();
    bar.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + 20, bubbles: true, cancelable: true }));
    await delay(); state.wheel = { position: term.buffer.active.viewportY, input: writes.join('') };
    await write('\x1b[?1000l\x1b[?1006l');
    term.reset(); term.resize(80, 20); return state;
  });
  assert.equal(keyboard.position, keyboard.maximum - 1);
  assert.deepEqual({ keyInput: keyboard.input, wheelInput: keyboard.wheel.input, wheelPosition: keyboard.wheel.position },
    { keyInput: '', wheelInput: '', wheelPosition: keyboard.maximum - 4 }, 'The separate scroll control must isolate keyboard and wheel input from the terminal program');
  return results;
};
