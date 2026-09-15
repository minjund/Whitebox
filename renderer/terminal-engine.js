'use strict';

// Ghostty's VT parser/state runs locally in WASM; node-pty still owns the shell.
// Keep the pinned ghostty-web API differences here, away from session delivery.
(() => {
  let initialization;
  let ghostty;
  let ghosttyWeb;
  function ready() {
    if (!initialization) {
      initialization = import('../node_modules/@crunchloop/ghostty-web/dist/ghostty-web.es.js')
        .then(async module => {
          ghosttyWeb = module;
          ghostty = await module.Ghostty.load();
        }).catch(error => {
          initialization = null;
          throw error;
        });
    }
    return initialization;
  }

  class Terminal {
    constructor(options = {}) {
      this.backend = new ghosttyWeb.Terminal({ ...options, ghostty, focusOnOpen: false,
        preserveScrollOnWrite: true, emitTerminalResponses: !options.disableStdin });
      this.disposed = false;
      this.callbacks = new Set();
      this.renderListeners = new Set();
      this.scrollListeners = new Set();
      this.addons = [];
      this.writing = false;
      const buffers = new Map();
      const buffer = type => {
        if (!buffers.has(type)) {
          buffers.set(type, new Proxy(this.backend.buffer[type], {
            get: (target, key) => {
              if (key === 'baseY') return type === 'normal' ? this.backend.getScrollbackLength() : 0;
              if (key === 'viewportY') return type === 'normal'
                ? Math.max(0, this.backend.getScrollbackLength() - Math.round(this.backend.getViewportY())) : 0;
              if (key === 'getLine') return row => this.getBufferLine(target, type, row);
              const value = target[key];
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }));
        }
        return buffers.get(type);
      };
      const owner = this;
      this.buffer = {
        get active() { return buffer(owner.backend.wasmTerm?.isAlternateScreen() ? 'alternate' : 'normal'); },
        get normal() { return buffer('normal'); },
        get alternate() { return buffer('alternate'); },
      };
      // Preserve view options used by the preedit overlay. The Canvas renderer
      // owns its font metrics; unsupported xterm typography is not assumed.
      Object.assign(this.backend.options, { fontWeight: 'normal', fontWeightBold: 'bold', letterSpacing: 0,
        screenReaderMode: options.screenReaderMode !== false });
      this.options = new Proxy(this.backend.options, {
        set: (target, key, value) => {
          target[key] = value;
          if (['fontSize', 'fontFamily', 'theme'].includes(key)) this.refresh();
          return true;
        },
      });
      this.backend.onScroll(() => {
        if (!this.writing) this.emitScroll();
      });
      this.backend.onRender(() => this.emitRender());
    }

    get cols() { return this.backend.cols; }
    get rows() { return this.backend.rows; }
    get element() { return this.backend.element; }
    get textarea() { return this.backend.textarea; }
    get renderer() { return this.backend.renderer; }
    get wasmTerm() { return this.backend.wasmTerm; }
    getBufferLine(buffer, type, row) {
      const line = buffer.getLine(row);
      if (!line) return undefined;
      const base = type === 'normal' ? this.backend.getScrollbackLength() : 0;
      const cells = row < base ? this.wasmTerm.getScrollbackLine(row) : this.wasmTerm.getLine(row - base);
      const getCell = column => {
        const original = line.getCell(column);
        if (!original) return undefined;
        return new Proxy(original, { get: (target, key) => {
          if (key === 'getChars') return () => {
            const cell = cells?.[column];
            if (!cell || cell.width === 0) return '';
            if (cell.grapheme_len > 0) return row < base
              ? this.wasmTerm.getScrollbackGraphemeString(row, column)
              : this.wasmTerm.getGraphemeString(row - base, column);
            return cell.codepoint ? String.fromCodePoint(cell.codepoint) : '';
          };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      };
      return {
        length: line.length, isWrapped: line.isWrapped, getCell,
        translateToString(trimRight = false, start = 0, end = line.length) {
          let text = '';
          let limit = Math.min(end, line.length);
          if (trimRight) while (limit > start && !cells?.[limit - 1]?.codepoint) limit -= 1;
          for (let col = Math.max(0, start); col < limit; col += 1) {
            const cell = getCell(col);
            if (cell?.getWidth() > 0) text += cell.getChars() || ' ';
          }
          return text;
        },
      };
    }
    onData(listener) { return this.backend.onData(listener); }
    onResize(listener) { return this.backend.onResize(listener); }
    onSelectionChange(listener) { return this.backend.onSelectionChange(listener); }
    onCursorMove(listener) { return this.onRender(listener); }
    onScroll(listener) { this.scrollListeners.add(listener); return { dispose: () => this.scrollListeners.delete(listener) }; }
    onRender(listener) { this.renderListeners.add(listener); return { dispose: () => this.renderListeners.delete(listener) }; }

    open(host) {
      const element = document.createElement('div');
      // Retain existing layout selectors while replacing the actual emulator.
      element.className = 'xterm ghostty-terminal';
      element.dataset.terminalEngine = 'ghostty';
      host.appendChild(element);
      // Whitebox grants focus only for an explicit user gesture.
      this.backend.focus = () => this.focus();
      this.opening = true;
      try { this.backend.open(element); } finally { this.opening = false; }
      // Native mouse/clipboard handlers must use the same lossless cell reader.
      this.backend.selectionManager.getSelection = () => this.getSelection();
      element.removeAttribute('contenteditable');
      element.removeAttribute('tabindex');
      element.setAttribute('role', 'group');
      this.renderer.getCanvas().classList.add('xterm-screen', 'ghostty-screen');
      this.textarea.classList.add('xterm-helper-textarea', 'ghostty-input');
      this.textarea.readOnly = this.options.disableStdin;
      this.textarea.addEventListener('paste', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const text = event.clipboardData?.getData('text/plain');
        if (text) this.paste(text);
      }, true);
      // Canvas has no readable text for assistive technology. Maintain only
      // visible rows in a throttled, visually hidden accessibility surface.
      if (this.options.screenReaderMode !== false) {
        this.accessibility = document.createElement('div');
        this.accessibility.className = 'ghostty-accessibility xterm-rows';
        this.accessibility.setAttribute('role', 'log');
        this.accessibility.setAttribute('aria-label', 'Terminal output');
        this.accessibility.setAttribute('aria-live', 'off');
        element.appendChild(this.accessibility);
      }
      this.textarea.addEventListener('focus', () => {
        if (this.wasmTerm.hasFocusEvents()) this.input('\x1b[I', true);
      });
      this.textarea.addEventListener('blur', () => {
        if (this.wasmTerm.hasFocusEvents()) this.input('\x1b[O', true);
      });
      this.refresh();
    }

    focus() {
      if (!this.opening && !this.disposed) this.textarea?.focus({ preventScroll: true });
    }
    blur() { this.textarea?.blur(); }
    loadAddon(addon) { addon.activate(this); this.addons.push(addon); }
    attachCustomKeyEventHandler(handler) {
      this.backend.attachCustomKeyEventHandler(event => {
        if (handler(event) === false) return true;
        // 0.4 encodes Shift+Tab as Tab. Preserve the TUI backtab key.
        if (event.key === 'Tab' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
          this.input('\x1b[Z', true);
          return true;
        }
        return false;
      });
    }
    input(data, wasUserInput = true) { if (!this.disposed) this.backend.input(data, wasUserInput); }
    paste(data) {
      // Match terminal paste semantics, including protection against a pasted
      // escape sequence ending the application's bracketed-paste envelope.
      let text = String(data).replace(/\r\n|\n/g, '\r');
      if (this.wasmTerm.hasBracketedPaste()) text = text.replace(/\x1b/g, '');
      this.backend.paste(text);
    }
    write(data, callback) {
      if (this.disposed) { if (callback) queueMicrotask(callback); return; }
      const active = this.buffer.active;
      const anchor = active.viewportY;
      const following = anchor >= active.baseY;
      this.writing = true;
      try {
        // The pinned WASM allocator does not accept a zero-byte allocation.
        if (data.length) this.backend.write(data);
        if (!following && this.buffer.active.type === 'normal') this.scrollToLine(anchor);
      } finally { this.writing = false; }
      this.emitScroll();
      // backend.write already schedules a dirty-row paint. A forced full
      // refresh here repaints every row for every small PTY echo/fragment.
      // ghostty-web ties write callbacks to RAF, which stalls hidden sessions.
      // Parsing is synchronous; a task yields between replay chunks everywhere.
      if (callback) {
        const timer = setTimeout(() => {
          this.callbacks.delete(timer);
          callback();
        }, 0);
        this.callbacks.add(timer);
      }
    }
    writeln(data, callback) { this.write(`${data}\r\n`, callback); }
    resize(cols, rows) {
      this.backend.resize(cols, rows);
      // 0.4 overwrites the DPR-scaled canvas after renderer.resize(). Restore it.
      this.renderer.resize(this.cols, this.rows);
      this.refresh();
      this.emitScroll();
    }
    refresh() {
      if (!this.renderer || this.disposed) return;
      if (this.wasmTerm.getMode(2026)) return;
      this.renderer.render(this.wasmTerm, true, this.backend.getViewportY(), this.backend);
      this.emitRender();
    }
    emitRender() {
      if (this.disposed) return;
      this.scheduleAccessibleRows();
      for (const listener of this.renderListeners) listener({ start: 0, end: this.rows - 1 });
    }
    scheduleAccessibleRows() {
      if (!this.accessibility || this.accessibilityTimer) return;
      this.accessibilityTimer = setTimeout(() => {
        this.accessibilityTimer = null;
        if (this.disposed) return;
        const buffer = this.buffer.active;
        this.accessibility.setAttribute('aria-live', document.activeElement === this.textarea ? 'polite' : 'off');
        while (this.accessibility.children.length > this.rows) this.accessibility.lastChild.remove();
        for (let row = 0; row < this.rows; row += 1) {
          let element = this.accessibility.children[row];
          if (!element) { element = document.createElement('div'); this.accessibility.appendChild(element); }
          const text = buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '';
          if (element.textContent !== text) element.textContent = text;
        }
      }, 80);
    }
    emitScroll() {
      this.scheduleAccessibleRows();
      for (const listener of this.scrollListeners) listener(this.buffer.active.viewportY);
    }
    scrollLines(amount) { this.backend.scrollLines(amount); this.refresh(); }
    scrollPages(amount) { this.scrollLines(amount * this.rows); }
    scrollToTop() { this.backend.scrollToTop(); this.refresh(); }
    scrollToBottom() { this.backend.scrollToBottom(); this.refresh(); }
    scrollToLine(line) {
      // The upstream method accepts distance *from the bottom*, unlike xterm.
      this.backend.scrollToLine(Math.max(0, this.buffer.active.baseY - line));
      this.refresh();
    }
    clear() { this.write('\x1b[2J\x1b[H'); }
    reset() {
      // Keep the same WASM object: upstream reset replaces it while selection
      // retains a freed reference. RIS + ED3 reset state and erase scrollback.
      this.clearSelection();
      this.backend.write('\x1bc\x1b[3J');
      this.scrollToBottom();
    }
    getSelection() {
      const manager = this.backend.selectionManager;
      if (!manager?.selectionStart || !manager.selectionEnd) return '';
      let start = manager.selectionStart;
      let end = manager.selectionEnd;
      if (start.absoluteRow > end.absoluteRow
        || (start.absoluteRow === end.absoluteRow && start.col > end.col)) [start, end] = [end, start];
      const buffer = this.buffer.active;
      const lines = [];
      for (let row = Math.max(0, start.absoluteRow); row <= Math.min(end.absoluteRow, buffer.length - 1); row += 1) {
        const line = buffer.getLine(row);
        if (!line) continue;
        // Trim unused cells, retaining explicitly printed spaces and graphemes.
        lines.push(line.translateToString(true, row === start.absoluteRow ? start.col : 0,
          row === end.absoluteRow ? end.col + 1 : line.length));
      }
      return lines.join('\n');
    }
    hasSelection() { return this.backend.hasSelection(); }
    clearSelection() { this.backend.clearSelection(); }
    setSelection(start, end) {
      // Pinned 0.4.6 selects only the viewport even for selectAll(). Its public
      // API cannot express a scrollback range. Keep this narrow compatibility
      // hook here and exercise full-history copy with the real bundled engine.
      const manager = this.backend.selectionManager;
      if (!manager || !('selectionStart' in manager) || !('selectionEnd' in manager)) {
        throw new Error('Ghostty selection API changed; update the terminal adapter');
      }
      this.backend.selectAll();
      manager.selectionStart = start;
      manager.selectionEnd = end;
      this.refresh();
    }
    selectAll() { this.setSelection({ col: 0, absoluteRow: 0 }, { col: this.cols - 1, absoluteRow: this.buffer.active.length - 1 }); }
    select(column, row, length) {
      if (length <= 0) return this.clearSelection();
      const start = Math.max(0, row) * this.cols + Math.max(0, column);
      const end = Math.min(this.buffer.active.length * this.cols - 1, start + length - 1);
      this.setSelection({ col: start % this.cols, absoluteRow: Math.floor(start / this.cols) },
        { col: end % this.cols, absoluteRow: Math.floor(end / this.cols) });
    }
    selectLines(start, end) { this.select(0, Math.min(start, end), (Math.abs(end - start) + 1) * this.cols); }
    measureTextCells(text) {
      if (!this.measurement) this.measurement = ghostty.createTerminal(1024, 2, { scrollbackLimit: 0 });
      this.measurement.write(`\x1bc${String(text).slice(0, 1024)}`);
      const cursor = this.measurement.getCursor();
      return cursor.y * 1024 + cursor.x;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const addon of this.addons) addon.dispose();
      this.addons = [];
      // Let already accepted writes finish their promises, even on disposal.
      this.renderListeners.clear();
      this.scrollListeners.clear();
      clearTimeout(this.accessibilityTimer);
      this.measurement?.free();
      const element = this.element;
      this.backend.dispose();
      element?.remove();
    }
  }

  class FitAddon {
    constructor() { return new ghosttyWeb.FitAddon(); }
  }
  window.WhiteboxTerminalEngine = { ready, Terminal, FitAddon, name: 'ghostty', get initialized() { return Boolean(ghostty); } };
})();
