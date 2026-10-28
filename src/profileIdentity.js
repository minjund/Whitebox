'use strict';

const fs = require('fs');
const path = require('path');

// macOS volumes may be case-sensitive or case-insensitive. Comparing lowercase
// strings conflates distinct stores on one and misses aliases on the other.
function sameProfileDirectory(left, right, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const platform = options.platform || process.platform;
  const normalize = value => {
    const resolved = path.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (normalize(left) === normalize(right)) return true;
  try {
    const a = fileSystem.lstatSync(left);
    const b = fileSystem.lstatSync(right);
    return a.isDirectory() && b.isDirectory() && !a.isSymbolicLink() && !b.isSymbolicLink()
      && a.ino > 0 && a.dev === b.dev && a.ino === b.ino;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

module.exports = { sameProfileDirectory };
