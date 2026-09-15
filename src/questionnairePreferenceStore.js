'use strict';

const fs = require('fs');
const path = require('path');

class QuestionnairePreferenceStore {
  constructor(file, { fileSystem = fs, onError = () => {} } = {}) {
    this.file = file;
    this.fs = fileSystem;
    this.onError = onError;
    this.value = { configured: false, enabled: false };
  }

  load() {
    this.value = { configured: false, enabled: false };
    try {
      const saved = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      if (typeof saved?.enabled === 'boolean') this.value = { configured: true, enabled: saved.enabled };
    } catch (error) {
      if (error.code !== 'ENOENT') this.onError(error);
    }
    return this.snapshot();
  }

  save(value) {
    if (typeof value?.enabled !== 'boolean') throw new TypeError('A boolean questionnaire preference is required.');
    const next = { enabled: value.enabled };
    const temporary = `${this.file}.${process.pid}.tmp`;
    this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try {
      this.fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
      this.fs.renameSync(temporary, this.file);
    } catch (error) {
      try { this.fs.unlinkSync(temporary); } catch {}
      this.onError(error);
      throw error;
    }
    this.value = { configured: true, ...next };
    return this.snapshot();
  }

  snapshot() {
    return { ...this.value };
  }
}

module.exports = { QuestionnairePreferenceStore };
