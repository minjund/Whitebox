'use strict';

// Only completion-event counters are authoritative. Missing usage is not zero.
function terminalReviewUsage(provider, raw) {
  const count = key => Number.isSafeInteger(raw?.[key]) && raw[key] >= 0 ? raw[key] : null;
  const input = count('input_tokens'), output = count('output_tokens');
  if (input === null || output === null) return null;
  const cachedInput = count(provider === 'claude' ? 'cache_read_input_tokens' : 'cached_input_tokens') || 0;
  const cacheWrite = provider === 'claude' ? count('cache_creation_input_tokens') || 0 : 0;
  // Codex cached input is included in input_tokens. Claude reports cache reads
  // and writes separately from its uncached input_tokens. Never count twice.
  const totalInput = provider === 'claude' ? input + cachedInput + cacheWrite : input;
  return { input: totalInput, output, cachedInput, cacheWrite, total: totalInput + output };
}

module.exports = { terminalReviewUsage };
