'use strict';

// Preserve xterm's input path and paint the preedit together with the row it
// covers. The commit guard below works around xterm 6.0's shared send timer
// and textarea-diff input path, following Orca's composition ownership fixes:
// https://github.com/stablyai/orca/pull/12278
// https://github.com/stablyai/orca/pull/12560
// Committed text still travels through terminal.input -> onData, never the PTY
// directly. No synthetic DOM events or changes to the textarea value.
window.WhiteboxTerminalIme = {
  createAddon() {
    let cleanup = () => {};
    function guardCommits(terminal, textarea, nativeView) {
      // Keep this private-API workaround isolated and covered by the real
      // bundled-xterm tests. Remove/revisit when upgrading xterm's helper:
      // https://github.com/xtermjs/xterm.js/issues/6089
      const core = terminal._core;
      const helper = core?._compositionHelper;
      if (!helper || typeof helper.compositionstart !== 'function'
        || typeof helper._finalizeComposition !== 'function'
        || typeof helper.keydown !== 'function'
        || typeof core._inputEvent !== 'function'
        || typeof helper._compositionPosition?.start !== 'number'
        || typeof helper._dataAlreadySent !== 'string'
        || typeof helper._isComposing !== 'boolean'
        || typeof terminal.input !== 'function') return () => {};
      const originalStart = helper.compositionstart;
      const originalFinalize = helper._finalizeComposition;
      const originalKeydown = helper.keydown;
      const originalInput = core._inputEvent;
      let pending = null;
      let suffixLength = 0;
      let nativeInputExpected = false;
      let reconciliation = null;
      const clearReconciliation = () => {
        if (reconciliation) clearTimeout(reconciliation.timer);
        reconciliation = null;
      };
      const flush = () => {
        if (!pending) return;
        const commit = pending;
        pending = null;
        clearTimeout(commit.timer);
        helper._isSendingComposition = false;
        // Read after browser propagation, or immediately before the next
        // composition starts. compositionend.data can still contain the old
        // 받침 when the IME moves that consonant into the next syllable.
        const input = textarea.value.slice(commit.start, textarea.value.length - commit.suffixLength);
        clearReconciliation();
        // Some IMEs emit insertText a task after compositionend. Give that
        // native commit one turn to reconcile with this deferred send, without
        // suppressing a new key or new text (including an identical syllable).
        const sent = { value: textarea.value, timer: null };
        reconciliation = sent;
        sent.timer = setTimeout(() => {
          if (reconciliation === sent) reconciliation = null;
        }, 0);
        if (input) terminal.input(input, true);
      };
      const start = function () {
        // The textarea still contains the previous committed value here. Drain
        // it before xterm overwrites the start offset for the next syllable.
        flush();
        clearReconciliation();
        nativeInputExpected = false;
        originalStart.call(this);
        // In screen reader mode, navigation also moves the textarea selection.
        // The next IME inserts there, not necessarily at value.length. Keep
        // the existing suffix out of the commit, including replaced selections.
        this._compositionPosition.start = textarea.selectionStart;
        suffixLength = textarea.value.length - textarea.selectionEnd;
      };
      const finalize = function (waitForPropagation) {
        const wasComposing = this._isComposing;
        flush();
        nativeView.classList.remove('active');
        this._isComposing = false;
        // A key can finalize synchronously before compositionend arrives.
        // That later event must not enqueue the same syllable a second time.
        if (!wasComposing) return;
        pending = {
          start: this._compositionPosition.start + this._dataAlreadySent.length,
          suffixLength,
          timer: null,
        };
        this._isSendingComposition = true;
        if (waitForPropagation) pending.timer = setTimeout(flush, 0);
        else flush();
      };
      const keydown = function (event) {
        clearReconciliation();
        nativeInputExpected = false;
        // Chromium's Process key is not Enter. Never run xterm 6.0's
        // _handleAnyTextareaChanges timer: it can outlive a whole composition,
        // resend its text, or interpret preedit cancellation as a PTY deletion.
        if (event.keyCode === 229 || event.isComposing) {
          // Any subsequent keypress belongs to this key, not the preceding
          // Latin key. Its native input must not send that character twice.
          core._keyPressHandled = false;
          nativeInputExpected = !this._isComposing && !pending;
          return false;
        }
        // A lone Command/Meta key must not commit or hide an active preedit.
        if ((this._isComposing || pending) && [91, 93, 224].includes(event.keyCode)) return false;
        return originalKeydown.call(this, event);
      };
      const inputEvent = function (event) {
        // The browser owns preedit edits, including deletions. Only a finished
        // composition or a native, non-composition input may reach onData.
        if (helper._isComposing || event.isComposing) return false;
        if (pending) {
          flush();
          nativeInputExpected = false;
          return true;
        }
        if (event.inputType === 'insertText' && event.data) {
          if (reconciliation) {
            // Matching text alone is insufficient: another native insertion
            // may legitimately repeat the same syllable without a keydown.
            const duplicate = textarea.value === reconciliation.value;
            clearReconciliation();
            if (duplicate) return true;
          } else if (!nativeInputExpected) {
            return originalInput.call(this, event);
          }
          const handledByKeypress = nativeInputExpected && this._keyPressHandled;
          nativeInputExpected = false;
          if (handledByKeypress) return true;
          this._unprocessedDeadKey = false;
          terminal.input(event.data, true);
          return true;
        }
        if (nativeInputExpected && ['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
          nativeInputExpected = false;
          terminal.input(event.inputType === 'deleteContentBackward' ? '\x7f' : '\x1b[3~', true);
          return true;
        }
        return originalInput.call(this, event);
      };
      helper.compositionstart = start;
      helper._finalizeComposition = finalize;
      helper.keydown = keydown;
      core._inputEvent = inputEvent;
      // xterm clears its textarea on blur. Commit a finished composition
      // before that listener runs, without submitting an active preedit.
      const blur = () => { flush(); clearReconciliation(); nativeInputExpected = false; };
      textarea.addEventListener('blur', blur, true);
      return () => {
        if (pending) clearTimeout(pending.timer);
        pending = null;
        clearReconciliation();
        helper._isSendingComposition = false;
        textarea.removeEventListener('blur', blur, true);
        if (helper.compositionstart === start) helper.compositionstart = originalStart;
        if (helper._finalizeComposition === finalize) helper._finalizeComposition = originalFinalize;
        if (helper.keydown === keydown) helper.keydown = originalKeydown;
        if (core._inputEvent === inputEvent) core._inputEvent = originalInput;
      };
    }
    return {
      activate(terminal) {
        const textarea = terminal.textarea;
        const screen = terminal.element?.querySelector('.xterm-screen');
        const nativeView = terminal.element?.querySelector('.composition-view');
        if (!textarea || !screen || !nativeView) return;
        const disposeCommitGuard = guardCommits(terminal, textarea, nativeView);
        const doc = textarea.ownerDocument;
        const view = doc.createElement('div');
        view.className = 'whitebox-ime-view';
        view.setAttribute('aria-hidden', 'true');
        Object.assign(view.style, {
          display: 'none', position: 'absolute', zIndex: '2', pointerEvents: 'none',
          overflow: 'hidden', whiteSpace: 'pre', direction: 'ltr',
        });
        const preedit = doc.createElement('span');
        preedit.className = 'whitebox-ime-preedit';
        Object.assign(preedit.style, { flex: '0 0 auto', textDecoration: 'underline' });
        const caret = doc.createElement('span');
        caret.className = 'whitebox-ime-caret';
        const tail = doc.createElement('span');
        tail.className = 'whitebox-ime-tail';
        Object.assign(tail.style, { flex: '0 0 auto', whiteSpace: 'pre' });
        view.append(preedit, caret, tail);
        nativeView.parentElement.appendChild(view);
        const previousVisibility = nativeView.style.visibility;
        nativeView.style.visibility = 'hidden';
        let text = '';
        let disposed = false;
        let timer = null;
        let gridKey = '';
        let gridSpacing = '';
        const ansiNames = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
          'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
        const ansiDefaults = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
          '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];
        const cellColor = (cell, foreground, theme, fallback) => {
          const value = foreground ? cell.getFgColor() : cell.getBgColor();
          if (foreground ? cell.isFgRGB() : cell.isBgRGB()) return `#${value.toString(16).padStart(6, '0')}`;
          if (!(foreground ? cell.isFgPalette() : cell.isBgPalette())) return fallback;
          let index = value;
          if (foreground && index < 8 && cell.isBold() && terminal.options.drawBoldTextInBrightColors) index += 8;
          if (index < 16) return theme[ansiNames[index]] || ansiDefaults[index];
          if (index >= 232) { const shade = 8 + (index - 232) * 10; return `rgb(${shade}, ${shade}, ${shade})`; }
          const cube = index - 16;
          const channel = n => n === 0 ? 0 : 55 + 40 * n;
          return `rgb(${channel(Math.floor(cube / 36))}, ${channel(Math.floor(cube / 6) % 6)}, ${channel(cube % 6)})`;
        };

        const hide = () => { view.style.display = 'none'; };
        const reset = () => {
          text = '';
          hide();
          if (timer !== null) clearTimeout(timer);
          timer = null;
        };
        const render = () => {
          if (disposed || !text || !nativeView.classList.contains('active')
            || !screen.isConnected || doc.activeElement !== textarea) {
            hide();
            return;
          }
          const buffer = terminal.buffer.active;
          const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
          const column = Math.min(buffer.cursorX, terminal.cols - 1);
          // client dimensions are local CSS pixels, unlike transformed screen
          // coordinates. Padding on the outer xterm must not shift the anchor.
          const cellWidth = screen.clientWidth / terminal.cols;
          const cellHeight = screen.clientHeight / terminal.rows;
          if (!(cellWidth > 0 && cellHeight > 0) || row < 0 || row >= terminal.rows) {
            hide();
            return;
          }
          const options = terminal.options;
          const theme = options.theme || {};
          const left = column * cellWidth;
          const available = (terminal.cols - column) * cellWidth;
          Object.assign(view.style, {
            display: 'flex', left: `${left}px`, top: `${row * cellHeight}px`,
            width: `${available}px`, height: `${cellHeight}px`, lineHeight: `${cellHeight}px`,
            fontFamily: options.fontFamily, fontSize: `${options.fontSize}px`,
            fontWeight: String(options.fontWeight), letterSpacing: `${options.letterSpacing}px`,
            color: theme.foreground || '#ffffff', background: theme.background || '#000000',
          });
          preedit.textContent = text;
          // Match the cell advance xterm will use after commit. Browser font
          // fallback often makes Hangul preedit narrower than its two cells,
          // shifting the caret/tail when the syllable is finally echoed.
          const unicode = terminal._core?.unicodeService;
          const scale = screen.getBoundingClientRect().width / screen.clientWidth || 1;
          if (typeof unicode?.getStringCellWidth === 'function' && typeof unicode.wcwidth === 'function') {
            const key = JSON.stringify([text, cellWidth, options.fontFamily, options.fontSize, options.fontWeight]);
            if (key !== gridKey) {
              preedit.style.letterSpacing = '0px';
              const naturalWidth = preedit.getBoundingClientRect().width / scale;
              const advancing = Array.from(text).filter(character => unicode.wcwidth(character.codePointAt(0)) > 0).length;
              gridSpacing = advancing ? `${(unicode.getStringCellWidth(text) * cellWidth - naturalWidth) / advancing}px` : '0px';
              gridKey = key;
            }
            preedit.style.letterSpacing = gridSpacing;
          }
          const caretWidth = Math.max(1, options.cursorWidth || 1);
          Object.assign(caret.style, {
            flex: `0 0 ${caretWidth}px`, width: `${caretWidth}px`,
            marginLeft: `-${caretWidth}px`, height: `${cellHeight}px`,
            background: theme.cursor || theme.foreground || '#ffffff',
          });
          // Use cell-sized spans so CJK/emoji and runs of spaces in the existing
          // row retain their terminal widths rather than browser text widths.
          const line = buffer.getLine(buffer.baseY + buffer.cursorY);
          const fragment = doc.createDocumentFragment();
          const contentEnd = line?.translateToString(true).length ? terminal.cols : column;
          for (let i = column; i < contentEnd; i += 1) {
            const cell = line.getCell(i);
            if (!cell || cell.getWidth() === 0) continue;
            const span = doc.createElement('span');
            span.textContent = cell.isInvisible() ? ' ' : cell.getChars() || ' ';
            const foreground = cellColor(cell, true, theme, theme.foreground || '#ffffff');
            const background = cellColor(cell, false, theme, theme.background || '#000000');
            Object.assign(span.style, {
              display: 'inline-block', width: `${cell.getWidth() * cellWidth}px`,
              verticalAlign: 'top',
              fontWeight: String(cell.isBold() ? options.fontWeightBold : options.fontWeight),
              fontStyle: cell.isItalic() ? 'italic' : 'normal',
              textDecoration: [cell.isUnderline() ? 'underline' : '', cell.isStrikethrough() ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
              color: cell.isInverse() ? background : foreground,
              background: cell.isInverse() ? foreground : background,
              opacity: cell.isDim() ? '0.5' : '1',
            });
            fragment.appendChild(span);
          }
          tail.replaceChildren(fragment);
          const preeditWidth = preedit.getBoundingClientRect().width / scale;
          const overflow = preeditWidth > available;
          const anchorLeft = Math.max(0, Math.min(left, screen.clientWidth - preeditWidth));
          // A wide final syllable must stay whole even if only one cell remains.
          // Move its presentation left instead of clipping half the glyph.
          if (overflow) {
            view.style.left = `${anchorLeft}px`;
            view.style.width = `${screen.clientWidth - anchorLeft}px`;
          }
          tail.style.display = overflow ? 'none' : '';
          view.style.justifyContent = overflow ? 'flex-end' : 'flex-start';
          // The native IME reads this invisible input's rectangle. Never size
          // it to the tail, and keep it inside the right screen edge.
          Object.assign(textarea.style, {
            left: `${anchorLeft}px`,
            top: `${row * cellHeight}px`,
            width: `${Math.max(1, Math.min(preeditWidth, screen.clientWidth))}px`,
            height: `${cellHeight}px`, lineHeight: `${cellHeight}px`,
          });
        };
        const refresh = () => {
          if (disposed) return;
          if (!text) { reset(); return; }
          render();
          if (timer !== null) clearTimeout(timer);
          // xterm also positions its helper on a zero-delay timer. Settle our
          // anchor after it, without a polling loop or another terminal redraw.
          timer = setTimeout(() => { timer = null; render(); }, 0);
        };
        const update = event => { text = event.data || ''; refresh(); };
        textarea.addEventListener('compositionstart', reset);
        textarea.addEventListener('compositionupdate', update);
        textarea.addEventListener('compositionend', reset);
        textarea.addEventListener('blur', reset);
        const subscriptions = [
          terminal.onRender(refresh), terminal.onResize(refresh), terminal.onScroll(refresh),
        ];
        // A non-composition key can make xterm finalize before compositionend.
        // Its active flag is authoritative; don't leave an old overlay behind.
        const observer = new MutationObserver(() => {
          if (!nativeView.classList.contains('active')) reset();
        });
        observer.observe(nativeView, { attributes: true, attributeFilter: ['class'] });
        cleanup = () => {
          disposed = true;
          disposeCommitGuard();
          reset();
          observer.disconnect();
          subscriptions.forEach(subscription => subscription.dispose());
          textarea.removeEventListener('compositionstart', reset);
          textarea.removeEventListener('compositionupdate', update);
          textarea.removeEventListener('compositionend', reset);
          textarea.removeEventListener('blur', reset);
          nativeView.style.visibility = previousVisibility;
          view.remove();
        };
      },
      dispose() { cleanup(); },
    };
  },
};
