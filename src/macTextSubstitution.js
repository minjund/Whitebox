'use strict';

const { runBestEffort } = require('./diagnostics');

// macOS text substitutions replace what the user typed. "Add period with
// double-space" is on by default; while Hangul is typed quickly the input
// system's replacement range can trail Chromium's asynchronous selection, so it
// replaces the previous syllable with "." instead of the space. A terminal and
// an AI prompt want exactly the typed text, as Terminal.app and iTerm2 do.
// These are this app's own NSUserDefaults, which take precedence over the
// global setting; other apps are unaffected.
const MAC_TEXT_SUBSTITUTION_DEFAULTS = Object.freeze([
  'NSAutomaticPeriodSubstitutionEnabled',
  'NSAutomaticTextReplacementEnabled',
  'NSAutomaticQuoteSubstitutionEnabled',
  'NSAutomaticDashSubstitutionEnabled',
  'NSAutomaticSpellingCorrectionEnabled',
  'NSAutomaticCapitalizationEnabled',
  'WebAutomaticSpellingCorrectionEnabled',
]);

function disableMacTextSubstitutions({ platform = process.platform, systemPreferences } = {}) {
  if (platform !== 'darwin' || typeof systemPreferences?.setUserDefault !== 'function') return [];
  const disabled = [];
  for (const key of MAC_TEXT_SUBSTITUTION_DEFAULTS) {
    runBestEffort(`mac-text-substitution:${key}`, () => {
      systemPreferences.setUserDefault(key, 'boolean', false);
      disabled.push(key);
    });
  }
  return disabled;
}

module.exports = { MAC_TEXT_SUBSTITUTION_DEFAULTS, disableMacTextSubstitutions };
