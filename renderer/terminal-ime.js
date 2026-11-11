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
        let lastKeyEscape = false;
        let bracketedPaste = null;
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
        const previousPreparePaste = terminal.preparePaste;
        const preparePaste = () => {
          if (disposed) return;
          const focused = doc.activeElement === textarea;
          // Clipboard text bypasses the browser's editable value. Finish any
          // marked text before those bytes, then reset both the native input
          // context and our shadow selection before the next IME composition.
          if (composing && !pending) pending = { start: startOffset, suffix: suffixLength, timer: null };
          if (focused) textarea.blur();
          flush();
          clearReconciliation();
          composing = false;
          text = '';
          hide();
          textarea.value = '';
          textarea.setSelectionRange(0, 0);
          if (focused) terminal.focus();
          // Ghostty's native context-menu cleanup can leave this focused
          // textarea fixed, behind the canvas and 0×0. Restore a usable native
          // candidate anchor now, before another key or PTY echo is required.
          render();
        };
        terminal.preparePaste = preparePaste;
        const render = () => {
          if (disposed || !screen.isConnected) { hide(); return; }
          const buffer = terminal.buffer.active;
          const cursorRow = buffer.baseY + buffer.cursorY - buffer.viewportY;
          const cursorInViewport = cursorRow >= 0 && cursorRow < terminal.rows;
          // Reading scrollback can put the real cursor outside the viewport.
          // Hide its overlay, but keep the native input anchor usable there.
          const row = Math.max(0, Math.min(terminal.rows - 1, cursorRow));
          const { width: cellWidth, height: cellHeight } = terminal.renderer.getMetrics();
          const options = terminal.options;
          const theme = options.theme;
          const column = Math.min(buffer.cursorX, terminal.cols - 1);
          // Read layout before changing styles or replacing any row content.
          const screenLeft = screen.offsetLeft;
          const screenTop = screen.offsetTop;
          const screenWidth = screen.clientWidth;
          const screenHeight = screen.clientHeight;
          // Canvas CSS bounds can briefly differ from rows × cell metrics during
          // resize/font changes. Keep the native candidate target inside the
          // actual viewport even when the real cursor is in scrollback.
          const nativeAnchor = width => {
            const anchorWidth = Math.max(1, Math.min(width, screenWidth || width));
            const anchorHeight = Math.max(1, Math.min(cellHeight, screenHeight || cellHeight));
            return { left: `${screenLeft + Math.max(0, Math.min(column * cellWidth, screenWidth - anchorWidth))}px`,
              top: `${screenTop + Math.max(0, Math.min(row * cellHeight, screenHeight - anchorHeight))}px`,
              width: `${anchorWidth}px`, height: `${anchorHeight}px` };
          };
          Object.assign(textarea.style, { position: 'absolute', zIndex: '2', pointerEvents: 'none' });
          if (!cursorInViewport || !composing || !text || doc.activeElement !== textarea) {
            hide();
            Object.assign(textarea.style, { position: 'absolute', ...nativeAnchor(cellWidth) });
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
          Object.assign(textarea.style, { ...nativeAnchor(preeditWidth),
            fontFamily: options.fontFamily, fontSize: `${options.fontSize}px` });
        };
        const scheduleRender = () => {
          // Composition, scroll and output can all arrive in the same frame.
          // Paint the latest state once, without blocking native IME events.
          if (disposed || frame) return;
          frame = requestAnimationFrame(() => { frame = 0; render(); });
        };
        const recoverInputAnchor = () => {
          if (disposed || doc.activeElement !== textarea) return;
          const style = textarea.style;
          // Ghostty arms context-menu cleanup on a later task. It can run
          // after preparePaste has restored focus, hiding the textarea again
          // without a blur/focus event or PTY output to trigger a repaint.
          // Keep its intentional 1px menu target until cleanup actually hides
          // it; restoring that live menu target would disrupt native menus.
          const viewport = screen.getBoundingClientRect();
          const target = textarea.getBoundingClientRect();
          // Upstream cursor synchronization can also move a positive-sized
          // target outside scrollback after our paste render. Preserve the
          // intentional fixed-position native-menu target while it is active.
          const outside = style.position === 'absolute' && viewport.width > 0 && viewport.height > 0
            && (target.left < viewport.left - 1 || target.right > viewport.right + 1
              || target.top < viewport.top - 1 || target.bottom > viewport.bottom + 1);
          if (outside || Number(style.zIndex) < 0 || parseFloat(style.width) <= 0 || parseFloat(style.height) <= 0) {
            // Observe upstream changes, not our own repair writes. Zero metrics
            // during a hidden/detaching pane must not create a microtask loop.
            anchorObserver.disconnect();
            try { render(); }
            finally { if (!disposed) anchorObserver.observe(textarea, { attributes: true, attributeFilter: ['style'] }); }
          }
        };
        const anchorObserver = new MutationObserver(recoverInputAnchor);
        anchorObserver.observe(textarea, { attributes: true, attributeFilter: ['style'] });
        listen('beforeinput', event => {
          // Bypass upstream's container handler, which prevents all edits.
          event.stopImmediatePropagation();
          recoverInputAnchor();
        });
        listen('compositionstart', event => {
          event.stopPropagation();
          recoverInputAnchor();
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
          if (['insertText', 'insertReplacementText', 'insertFromComposition'].includes(event.inputType) && event.data) {
            const duplicate = reconciliation && textarea.value === reconciliation.value;
            clearReconciliation();
            if (!duplicate) terminal.input(event.data, true);
          } else if (['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
            terminal.input(event.inputType === 'deleteContentBackward' ? '\x7f' : '\x1b[3~', true);
          }
        });
        listen('keydown', event => {
          // Restore synchronously too: the next native key can arrive in the
          // same task as cleanup, before MutationObserver/RAF has run.
          recoverInputAnchor();
          // After clipboard/input-source transitions macOS can report a Hangul
          // jamo with its physical keyCode and isComposing=false. Let the
          // browser IME interpret it; Ghostty would otherwise preventDefault
          // and send each consonant/vowel as a finished terminal character.
          const nativeJamo = !event.ctrlKey && !event.altKey && !event.metaKey
            && /^[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]$/u.test(event.key);
          if (event.isComposing || event.keyCode === 229 || nativeJamo
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
          const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
          const doubleEscape = plain && event.key === 'Escape' && lastKeyEscape;
          lastKeyEscape = plain && event.key === 'Escape' && !doubleEscape;
          const control = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
            ? ({ KeyA: 'a', KeyC: 'c', KeyD: 'd', KeyE: 'e', KeyK: 'k', KeyU: 'u', KeyW: 'w' })[event.code] || '' : '';
          if (plain || control) {
            // Ghostty consumes navigation and editing keys. Mirror them in the
            // browser's shadow line: a following native IME edit then lands at
            // the intended caret without splitting surrogate pairs, and the
            // value reported as the terminal input draft (which holds Summary
            // sends) is cleared with the line instead of lingering until Enter.
            const value = textarea.value;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const boundaries = [...segmenter.segment(value)].map(segment => segment.index).concat(value.length);
            const previous = [...boundaries].reverse().find(index => index < start) ?? 0;
            const next = boundaries.find(index => index > end) ?? value.length;
            const word = value.slice(0, start).search(/\S+\s*$/u);
            let caretPosition = null;
            let edit = null;
            if (plain && event.key === 'ArrowLeft') caretPosition = start !== end ? start : previous;
            if (plain && event.key === 'ArrowRight') caretPosition = start !== end ? end : next;
            if ((plain && event.key === 'Home') || control === 'a') caretPosition = 0;
            if ((plain && event.key === 'End') || control === 'e') caretPosition = value.length;
            if (plain && event.key === 'Backspace') edit = start !== end ? [start, end] : [previous, start];
            if ((plain && event.key === 'Delete') || control === 'd') edit = start !== end ? [start, end] : [start, next];
            if (control === 'k') edit = [start, value.length];
            if (control === 'w') edit = [word < 0 ? start : word, end];
            // Submit, interrupt, kill-line and Esc Esc (an AI CLI clearing its
            // prompt) leave no draft in the terminal line.
            if ((plain && event.key === 'Enter') || doubleEscape || control === 'c' || control === 'u') edit = [0, value.length];
            if (edit) {
              textarea.value = value.slice(0, edit[0]) + value.slice(edit[1]);
              caretPosition = edit[0];
            }
            if (caretPosition !== null) textarea.setSelectionRange(caretPosition, caretPosition);
          }
        });
        listen('blur', () => {
          // A normal blur finishes composition first. Removing or re-parenting
          // the focused textarea (a workspace layout re-render) blurs it with
          // no compositionend while the syllable stays in the value: commit
          // that text instead of silently dropping the user's Korean input.
          if (composing && !pending) pending = { start: startOffset, suffix: suffixLength, timer: null };
          flush();
          clearReconciliation();
          composing = false;
          text = '';
          hide();
          scheduleRender();
        });
        listen('focus', render);
        // The textarea value is also the terminal's reported input draft. A new
        // line editor (shell prompt after an AI CLI exits, or a restarted CLI)
        // and a terminal reset start with an empty line, whatever was typed.
        const clearDraft = () => {
          if (disposed || composing || pending) return;
          clearReconciliation();
          textarea.value = '';
          textarea.setSelectionRange(0, 0);
        };
        // Line editors (zsh/bash, Claude Code, Codex) enable bracketed paste
        // while they read a line and disable it when they hand the terminal
        // over or exit. Catch an off→on cycle even inside one output batch.
        let lineEditorEnded = false;
        const observeLineEditor = () => {
          const enabled = Boolean(terminal.wasmTerm?.hasBracketedPaste?.());
          if (enabled && (bracketedPaste === false || lineEditorEnded)) { lineEditorEnded = false; clearDraft(); }
          bracketedPaste = enabled;
        };
        const patch = (name, wrap) => {
          const own = Object.prototype.hasOwnProperty.call(terminal, name), original = terminal[name];
          if (typeof original !== 'function') return () => {};
          const wrapped = wrap(original);
          terminal[name] = wrapped;
          return () => {
            if (terminal[name] !== wrapped) return;
            if (own) terminal[name] = original;
            else delete terminal[name];
          };
        };
        const restoreReset = patch('reset', original => function (...args) {
          clearDraft();
          return original.apply(this, args);
        });
        const restoreWrite = patch('write', original => function (data, ...args) {
          if (typeof data === 'string' && data.includes('\x1b[?2004l')) lineEditorEnded = true;
          return original.call(this, data, ...args);
        });
        const subscriptions = [terminal.onRender(scheduleRender), terminal.onRender(observeLineEditor),
          terminal.onResize(scheduleRender), terminal.onScroll(scheduleRender)];
        cleanup = () => {
          disposed = true;
          anchorObserver.disconnect();
          if (pending) clearTimeout(pending.timer);
          pending = null;
          clearReconciliation();
          if (frame) cancelAnimationFrame(frame);
          for (const [type, listener] of listeners) textarea.removeEventListener(type, listener, true);
          restoreReset();
          restoreWrite();
          if (terminal.preparePaste === preparePaste) {
            if (previousPreparePaste === undefined) delete terminal.preparePaste;
            else terminal.preparePaste = previousPreparePaste;
          }
          subscriptions.forEach(subscription => subscription.dispose());
          view.remove();
        };
      },
      dispose() { cleanup(); },
    };
  },
};
