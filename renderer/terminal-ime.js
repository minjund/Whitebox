'use strict';

// Own browser composition on Ghostty's textarea. Only a completed composition
// enters terminal.input -> onData -> Whitebox's acknowledged input queue.
// In particular, never let ghostty-web's bubbling compositionend send an old
// Korean final consonant before Chromium has moved it into the next syllable.
window.WhiteboxTerminalIme = {
  createAddon() {
    let cleanup = () => {};
    return {
      activate(terminal) {
        const textarea = terminal.textarea;
        const screen = terminal.renderer.getCanvas();
        const doc = textarea.ownerDocument;
        const view = doc.createElement('div');
        view.className = 'whitebox-ime-view';
        view.setAttribute('aria-hidden', 'true');
        Object.assign(view.style, { display: 'none', position: 'absolute', zIndex: '2', pointerEvents: 'none',
          overflow: 'hidden', whiteSpace: 'pre', direction: 'ltr' });
        const preedit = doc.createElement('span');
        preedit.className = 'whitebox-ime-preedit';
        Object.assign(preedit.style, { flex: '0 0 auto', textDecoration: 'underline' });
        const caret = doc.createElement('span');
        caret.className = 'whitebox-ime-caret';
        const tail = doc.createElement('span');
        tail.className = 'whitebox-ime-tail';
        Object.assign(tail.style, { flex: '0 0 auto', whiteSpace: 'pre' });
        view.append(preedit, caret, tail);
        terminal.element.appendChild(view);
        let composing = false;
        let disposed = false;
        let text = '';
        let startOffset = 0;
        let suffixLength = 0;
        let pending = null;
        let reconciliation = null;
        let frame = 0;
        let measuredText = null;
        let measuredCells = 0;
        let tailSignature = null;
        const listeners = [];
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        const listen = (type, listener) => {
          textarea.addEventListener(type, listener, true);
          listeners.push([type, listener]);
        };
        const clearReconciliation = () => {
          if (reconciliation) clearTimeout(reconciliation.timer);
          reconciliation = null;
        };
        const hide = () => { view.style.display = 'none'; };
        const flush = () => {
          if (!pending || disposed) return;
          const commit = pending;
          pending = null;
          clearTimeout(commit.timer);
          const value = textarea.value;
          const input = value.slice(commit.start, Math.max(commit.start, value.length - commit.suffix));
          clearReconciliation();
          const sent = { value, timer: null };
          reconciliation = sent;
          sent.timer = setTimeout(() => { if (reconciliation === sent) reconciliation = null; }, 0);
          if (input) terminal.input(input, true);
        };
        const render = () => {
          if (disposed || !screen.isConnected) { hide(); return; }
          const buffer = terminal.buffer.active;
          const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
          if (row < 0 || row >= terminal.rows) { hide(); return; }
          const { width: cellWidth, height: cellHeight } = terminal.renderer.getMetrics();
          const options = terminal.options;
          const theme = options.theme;
          const column = Math.min(buffer.cursorX, terminal.cols - 1);
          // Read layout before changing styles or replacing any row content.
          const screenLeft = screen.offsetLeft;
          const screenTop = screen.offsetTop;
          const screenWidth = screen.clientWidth;
          if (!composing || !text || doc.activeElement !== textarea) {
            hide();
            Object.assign(textarea.style, { position: 'absolute', left: `${screenLeft + column * cellWidth}px`,
              top: `${screenTop + row * cellHeight}px`, width: `${cellWidth}px`, height: `${cellHeight}px` });
            return;
          }
          if (text !== measuredText) {
            measuredCells = terminal.measureTextCells(text);
            measuredText = text;
          }
          const preeditWidth = Math.max(1, measuredCells) * cellWidth;
          const available = (terminal.cols - column) * cellWidth;
          const anchorLeft = Math.max(0, Math.min(column * cellWidth, screenWidth - preeditWidth));
          Object.assign(view.style, { display: 'flex', left: `${screenLeft + anchorLeft}px`,
            top: `${screenTop + row * cellHeight}px`, width: `${Math.max(available, preeditWidth)}px`,
            height: `${cellHeight}px`, lineHeight: `${cellHeight}px`, fontFamily: options.fontFamily,
            fontSize: `${options.fontSize}px`, fontWeight: 'normal', color: theme.foreground || '#ffffff',
            background: theme.background || '#000000' });
          if (preedit.textContent !== text) preedit.textContent = text;
          preedit.style.width = `${preeditWidth}px`;
          Object.assign(caret.style, { flex: '0 0 1px', width: '1px', marginLeft: '-1px', height: `${cellHeight}px`,
            background: theme.cursor || theme.foreground || '#ffffff' });
          const line = buffer.getLine(buffer.baseY + buffer.cursorY);
          const tailCells = [];
          for (let index = column; index < terminal.cols; index += 1) {
            const cell = line?.getCell(index);
            if (!cell || cell.getWidth() === 0) continue;
            const fg = `#${cell.getFgColor().toString(16).padStart(6, '0')}`;
            const bg = `#${cell.getBgColor().toString(16).padStart(6, '0')}`;
            tailCells.push({ text: cell.isInvisible() ? ' ' : cell.getChars() || ' ',
              width: `${cell.getWidth() * cellWidth}px`,
              color: cell.isInverse() ? bg : fg, background: cell.isInverse() ? fg : bg,
              fontWeight: cell.isBold() ? 'bold' : 'normal', fontStyle: cell.isItalic() ? 'italic' : 'normal' });
          }
          // Most composition updates only change the preedit. Keep the row's
          // DOM intact unless output, cursor movement or cell metrics changed.
          const signature = JSON.stringify(tailCells);
          if (signature !== tailSignature) {
            const fragment = doc.createDocumentFragment();
            for (const { text: cellText, ...style } of tailCells) {
              const span = doc.createElement('span');
              span.textContent = cellText;
              Object.assign(span.style, { display: 'inline-block', ...style });
              fragment.appendChild(span);
            }
            tail.replaceChildren(fragment);
            tailSignature = signature;
          }
          tail.style.display = preeditWidth > available ? 'none' : '';
          // Anchor native candidate windows to the painted cursor.
          Object.assign(textarea.style, { left: `${screenLeft + anchorLeft}px`,
            top: `${screenTop + row * cellHeight}px`, width: `${preeditWidth}px`, height: `${cellHeight}px`,
            fontFamily: options.fontFamily, fontSize: `${options.fontSize}px` });
        };
        const scheduleRender = () => {
          // Composition, scroll and output can all arrive in the same frame.
          // Paint the latest state once, without blocking native IME events.
          if (disposed || frame) return;
          frame = requestAnimationFrame(() => { frame = 0; render(); });
        };
        listen('beforeinput', event => {
          // Bypass upstream's container handler, which prevents all edits.
          event.stopImmediatePropagation();
        });
        listen('compositionstart', event => {
          event.stopPropagation();
          flush();
          clearReconciliation();
          startOffset = textarea.selectionStart;
          suffixLength = textarea.value.length - textarea.selectionEnd;
          composing = true;
          text = '';
          hide();
        });
        listen('compositionupdate', event => {
          event.stopPropagation();
          text = event.data || '';
          if (!text) hide();
          scheduleRender();
        });
        listen('compositionend', event => {
          event.stopPropagation();
          if (!composing) return;
          composing = false;
          text = '';
          hide();
          pending = { start: startOffset, suffix: suffixLength, timer: setTimeout(flush, 0) };
        });
        listen('input', event => {
          event.stopPropagation();
          if (composing || event.isComposing) return;
          if (pending) { flush(); return; }
          if (event.inputType === 'insertText' && event.data) {
            const duplicate = reconciliation && textarea.value === reconciliation.value;
            clearReconciliation();
            if (!duplicate) terminal.input(event.data, true);
          } else if (['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
            terminal.input(event.inputType === 'deleteContentBackward' ? '\x7f' : '\x1b[3~', true);
          }
        });
        listen('keydown', event => {
          if (event.isComposing || event.keyCode === 229
            || (composing && ['Meta', 'Shift', 'Control', 'Alt'].includes(event.key))) {
            event.stopPropagation();
            return;
          }
          if (composing) {
            composing = false;
            text = '';
            hide();
            pending = { start: startOffset, suffix: suffixLength, timer: null };
          }
          flush();
          clearReconciliation();
          if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
            // Ghostty consumes navigation keys. Move the browser's shadow
            // caret as well, so a following native IME edit replaces/inserts
            // at the intended selection without splitting surrogate pairs.
            const value = textarea.value;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const boundaries = ['ArrowLeft', 'ArrowRight'].includes(event.key)
              ? [...segmenter.segment(value)].map(segment => segment.index).concat(value.length) : [];
            let caretPosition = null;
            if (event.key === 'ArrowLeft') caretPosition = start !== end ? start : [...boundaries].reverse().find(index => index < start) ?? 0;
            if (event.key === 'ArrowRight') caretPosition = start !== end ? end : boundaries.find(index => index > end) ?? value.length;
            if (event.key === 'Home') caretPosition = 0;
            if (event.key === 'End') caretPosition = value.length;
            if (caretPosition !== null) textarea.setSelectionRange(caretPosition, caretPosition);
            if (event.key === 'Enter') textarea.value = '';
          }
        });
        listen('blur', () => {
          flush();
          clearReconciliation();
          composing = false;
          text = '';
          hide();
        });
        const subscriptions = [terminal.onRender(scheduleRender), terminal.onResize(scheduleRender), terminal.onScroll(scheduleRender)];
        cleanup = () => {
          disposed = true;
          if (pending) clearTimeout(pending.timer);
          pending = null;
          clearReconciliation();
          if (frame) cancelAnimationFrame(frame);
          for (const [type, listener] of listeners) textarea.removeEventListener(type, listener, true);
          subscriptions.forEach(subscription => subscription.dispose());
          view.remove();
        };
      },
      dispose() { cleanup(); },
    };
  },
};
