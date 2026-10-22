'use strict';

const fs = require('fs');
const path = require('path');

class AttentionPopupPreferenceStore {
  constructor(file, options = {}) {
    if (!file || typeof file !== 'string') throw new TypeError('A preference file path is required.');
    this.file = file;
    this.fileSystem = options.fileSystem || fs;
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};
    this.enabled = true;
  }

  normalize(value) {
    const candidate = value && typeof value === 'object' ? value.enabled : value;
    // Restore the response window for new profiles and keep saved choices,
    // including the unversioned preferences written before 2.0.
    return { enabled: candidate == null ? true : candidate === true };
  }

  load() {
    try {
      const parsed = JSON.parse(this.fileSystem.readFileSync(this.file, 'utf8'));
      this.enabled = this.normalize(parsed).enabled;
    } catch (error) {
      this.enabled = error?.code === 'ENOENT';
      if (!error || error.code !== 'ENOENT') this.onError(error);
    }
    return this.snapshot();
  }

  save(value) {
    const next = this.normalize({ version: 2, enabled: typeof value === 'boolean' ? value : value?.enabled });
    const directory = path.dirname(this.file);
    const temporary = `${this.file}.${process.pid}.tmp`;
    this.fileSystem.mkdirSync(directory, { recursive: true });
    try {
      this.fileSystem.writeFileSync(temporary, JSON.stringify({ version: 2, ...next }, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      this.fileSystem.renameSync(temporary, this.file);
    } catch (error) {
      try {
        if (typeof this.fileSystem.unlinkSync === 'function') this.fileSystem.unlinkSync(temporary);
      } catch {}
      this.onError(error);
      throw error;
    }
    this.enabled = next.enabled;
    return this.snapshot();
  }

  getEnabled() {
    return this.enabled;
  }

  setEnabled(enabled) {
    return this.save({ enabled: Boolean(enabled) });
  }

  snapshot() {
    return { enabled: this.enabled };
  }
}

module.exports = { AttentionPopupPreferenceStore };
