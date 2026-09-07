(function bootstrapComprehensionOutputFilter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WhiteboxComprehensionOutput = api;
})(typeof window !== "undefined" ? window : globalThis, function createComprehensionOutputFilterApi() {
  "use strict";

  const PACKET_ENVELOPE = Object.freeze({
    kind: "packet",
    open: '<whitebox-comprehension-packet version="1">',
    close: "</whitebox-comprehension-packet>",
  });
  const CONTRACT_ENVELOPE = Object.freeze({
    kind: "contract",
    open: '<whitebox-comprehension-contract version="1">',
    close: "</whitebox-comprehension-contract>",
  });
  const RESERVED_ENVELOPES = Object.freeze([CONTRACT_ENVELOPE, PACKET_ENVELOPE]);
  const MAX_PACKET_PAYLOAD_BYTES = 64 * 1024;
  const DEFAULT_MAX_CANDIDATE_PRINTABLE = MAX_PACKET_PAYLOAD_BYTES
    + PACKET_ENVELOPE.open.length
    + PACKET_ENVELOPE.close.length;
  const DEFAULT_MAX_CANDIDATE_RAW = 512 * 1024;
  const DEFAULT_MAX_ANSI_RAW = 64 * 1024;

  function isCsiFinal(code) {
    return code >= 0x40 && code <= 0x7e;
  }

  function scanCsi(value, start) {
    for (let index = start; index < value.length; index += 1) {
      if (isCsiFinal(value.charCodeAt(index))) return index + 1;
    }
    return -1;
  }

  function scanControlString(value, start, allowBell) {
    for (let index = start; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if ((allowBell && code === 0x07) || code === 0x9c) return index + 1;
      if (code === 0x1b) {
        if (index + 1 >= value.length) return -1;
        if (value[index + 1] === "\\") return index + 2;
      }
    }
    return -1;
  }

  function ansiEnd(value, index) {
    const code = value.charCodeAt(index);
    if (code === 0x9b) return scanCsi(value, index + 1);
    if (code === 0x9d) return scanControlString(value, index + 1, true);
    if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) return scanControlString(value, index + 1, false);
    if (code === 0x9c) return index + 1;
    if (code !== 0x1b) return 0;
    if (index + 1 >= value.length) return -1;
    const next = value[index + 1];
    if (next === "[") return scanCsi(value, index + 2);
    if (next === "]") return scanControlString(value, index + 2, true);
    if (["P", "X", "^", "_"].includes(next)) return scanControlString(value, index + 2, false);
    if (next === "\\") return index + 2;

    let cursor = index + 1;
    while (cursor < value.length) {
      const nextCode = value.charCodeAt(cursor);
      if (nextCode >= 0x20 && nextCode <= 0x2f) {
        cursor += 1;
        continue;
      }
      if (nextCode >= 0x30 && nextCode <= 0x7e) return cursor + 1;
      return index + 1;
    }
    return -1;
  }

  function createAnsiTokenizer(maxAnsiRaw) {
    let pending = "";

    function take(value, final = false) {
      const input = pending + String(value == null ? "" : value);
      pending = "";
      const tokens = [];
      let index = 0;
      while (index < input.length) {
        const end = ansiEnd(input, index);
        if (end !== 0) {
          if (end < 0) {
            const suffix = input.slice(index);
            if (!final && suffix.length <= maxAnsiRaw) pending = suffix;
            else tokens.push({ raw: suffix, text: "" });
            break;
          }
          tokens.push({ raw: input.slice(index, end), text: "" });
          index = end;
          continue;
        }

        const first = input.charCodeAt(index);
        if (first >= 0xd800 && first <= 0xdbff) {
          if (index + 1 >= input.length) {
            if (!final) pending = input.slice(index);
            else tokens.push({ raw: input[index], text: input[index] });
            break;
          }
          const second = input.charCodeAt(index + 1);
          if (second >= 0xdc00 && second <= 0xdfff) {
            const raw = input.slice(index, index + 2);
            tokens.push({ raw, text: raw });
            index += 2;
            continue;
          }
        }
        tokens.push({ raw: input[index], text: input[index] });
        index += 1;
      }
      return tokens;
    }

    return {
      take,
      hasPending: () => Boolean(pending),
    };
  }

  function normalizeContractText(value) {
    return String(value || "").replace(/\r\n/gu, "\n");
  }

  function utf8ByteLength(value) {
    try {
      if (typeof TextEncoder !== "function") return Number.POSITIVE_INFINITY;
      return new TextEncoder().encode(String(value == null ? "" : value)).byteLength;
    } catch (_error) {
      return Number.POSITIVE_INFINITY;
    }
  }

  function normalizeAuthority(value) {
    const state = String(value?.state || "release").toLowerCase();
    if (state !== "ready" && state !== "pending") return { state: "release" };
    return {
      state,
      sessionId: String(value?.sessionId || ""),
      packetFingerprint: String(value?.packetFingerprint || ""),
      completionGeneration: String(value?.completionGeneration || ""),
    };
  }

  function hasTrustedContractLaunchProvenance(value) {
    const initialPromptFingerprint = String(value?.initialPromptFingerprint || "").trim().toLowerCase();
    return value?.type === "agent"
      && value?.backend === "direct"
      && value?.comprehensionContractInjected === true
      && value?.initialPromptFingerprintVersion === "raw-v1"
      && /^[a-f0-9]{64}$/u.test(initialPromptFingerprint)
      && !String(value?.bridgeId || "").trim()
      && !String(value?.agentResumeSessionId || "").trim()
      && !String(value?.agentForkSourceSessionId || "").trim();
  }

  function createFilter(options = {}) {
    const enabled = options.enabled !== false;
    // Display privacy is independent of packet validation. Only the launch
    // owner may opt in; observers retain the lossless diagnostic stream.
    const hideOwnedEnvelopes = options.hideOwnedEnvelopes === true;
    const maxPrintable = Math.max(1024, Number(options.maxCandidatePrintable) || DEFAULT_MAX_CANDIDATE_PRINTABLE);
    const maxRaw = Math.max(maxPrintable, Number(options.maxCandidateRaw) || DEFAULT_MAX_CANDIDATE_RAW);
    const maxAnsiRaw = Math.max(1024, Number(options.maxAnsiRaw) || DEFAULT_MAX_ANSI_RAW);
    const contractBlock = String(options.contractBlock || "");
    const packetFingerprint = typeof options.packetFingerprint === "function"
      ? options.packetFingerprint
      : () => "";
    const getPacketAuthority = typeof options.getPacketAuthority === "function"
      ? options.getPacketAuthority
      : () => ({ state: "release" });
    const isOwnedTerminal = typeof options.isOwnedTerminal === "function"
      ? options.isOwnedTerminal
      : () => false;
    const tokenizer = createAnsiTokenizer(maxAnsiRaw);
    let scanUnits = [];
    let scanInterstitialRaw = "";
    let candidate = null;
    let held = null;
    let contractHidden = false;

    function ownsHiddenOutput() {
      try { return hideOwnedEnvelopes && isOwnedTerminal() === true; }
      catch (_error) { return false; }
    }

    function serializedUnits(units = scanUnits) {
      return units.map(unit => `${unit.beforeRaw}${unit.raw}`).join("");
    }

    function scanPlain() {
      return scanUnits.map(unit => unit.text).join("");
    }

    function markerText(value) {
      return ownsHiddenOutput() ? value.replace(/\s/gu, '').toLowerCase() : value;
    }

    function authority() {
      try {
        return normalizeAuthority(getPacketAuthority());
      } catch (_error) {
        return { state: "release" };
      }
    }

    function candidateFingerprint(packet) {
      try {
        return String(packetFingerprint(packet) || "");
      } catch (_error) {
        return "";
      }
    }

    function authorityIdentityMatches(expected, current) {
      if (!expected || !current
        || !expected.sessionId
        || expected.sessionId !== current.sessionId) return false;
      if (expected.completionGeneration) {
        return expected.completionGeneration === current.completionGeneration;
      }
      // A running turn does not have a completion generation yet. Its exact
      // linked session is the only available output-source identity; accept
      // the first ready generation for that same source, but never another
      // session or a later known generation.
      return expected.state === "pending";
    }

    function candidateMatchesReadyAuthority(current, fingerprint, sourceAuthority) {
      return current.state === "ready"
        && Boolean(current.sessionId)
        && Boolean(current.packetFingerprint)
        && Boolean(current.completionGeneration)
        && Boolean(fingerprint)
        && current.packetFingerprint === fingerprint
        && authorityIdentityMatches(sourceAuthority, current);
    }

    function retainOpeningSuffix(output) {
      let retainCount = 0;
      const maximum = Math.min(scanUnits.length, Math.max(...RESERVED_ENVELOPES.map(item => item.open.length - 1)));
      for (let count = 1; count <= maximum; count += 1) {
        const suffix = scanUnits.slice(-count).map(unit => unit.text).join("");
        if (markerText(suffix) && RESERVED_ENVELOPES.some(item => markerText(item.open).startsWith(markerText(suffix)))) retainCount = count;
      }
      const emitCount = scanUnits.length - retainCount;
      if (emitCount > 0) output.push(serializedUnits(scanUnits.slice(0, emitCount)));
      scanUnits = retainCount ? scanUnits.slice(-retainCount) : [];
      if (scanUnits.length && scanUnits[0].beforeRaw) {
        output.push(scanUnits[0].beforeRaw);
        scanUnits[0].beforeRaw = "";
      }
    }

    function releaseHeld(output) {
      if (!held) return;
      output.push(held.raw, held.afterRaw);
      held = null;
    }

    function processRaw(value, final, output) {
      const tokens = tokenizer.take(value, final);
      for (const token of tokens) processToken(token, output);
    }

    function reevaluateHeld(output) {
      if (!held) return false;
      const current = authority();
      if (candidateMatchesReadyAuthority(current, held.fingerprint, held.sourceAuthority)) {
        const afterRaw = held.afterRaw;
        held = null;
        if (afterRaw) processRaw(afterRaw, false, output);
        return true;
      }
      if (current.state !== "pending"
        || !authorityIdentityMatches(held.sourceAuthority, current)) {
        releaseHeld(output);
        return true;
      }
      return false;
    }

    function finishCandidate(output) {
      const completed = candidate;
      candidate = null;
      if (!completed) return;
      if (completed.definition.kind === "contract") {
        let owned = false;
        try {
          owned = isOwnedTerminal() === true;
        } catch (_error) {
          owned = false;
        }
        const exactContract = Boolean(contractBlock)
          && normalizeContractText(completed.plain) === normalizeContractText(contractBlock);
        if (!contractHidden && owned && exactContract) contractHidden = true;
        else output.push(completed.raw);
        return;
      }

      const rawJsonText = completed.plain
        .slice(completed.definition.open.length, -completed.definition.close.length);
      if (utf8ByteLength(rawJsonText) > MAX_PACKET_PAYLOAD_BYTES) {
        output.push(completed.raw);
        return;
      }
      const jsonText = rawJsonText.trim();
      let packet = null;
      try {
        packet = JSON.parse(jsonText);
      } catch (_error) {
        output.push(completed.raw);
        return;
      }
      const fingerprint = candidateFingerprint(packet);
      const current = authority();
      if (candidateMatchesReadyAuthority(current, fingerprint, completed.sourceAuthority)) return;
      if (completed.sourceAuthority?.state === "pending"
        && current.state === "pending"
        && fingerprint
        && authorityIdentityMatches(completed.sourceAuthority, current)) {
        held = {
          raw: completed.raw,
          afterRaw: "",
          fingerprint,
          sourceAuthority: completed.sourceAuthority,
        };
        return;
      }
      output.push(completed.raw);
    }

    function processCandidateToken(token, output) {
      if (candidate.hidden) {
        // Keep only a closing-marker suffix, even for malformed or oversized
        // payloads. Never replay private bytes on flush or an input boundary.
        if (token.text && !/\s/u.test(token.text)) {
          candidate.plain = (candidate.plain + token.text.toLowerCase()).slice(-candidate.definition.close.length);
          if (candidate.plain === candidate.definition.close) candidate = null;
        }
        return;
      }
      candidate.raw += token.raw;
      candidate.rawLength += token.raw.length;
      if (token.text) {
        candidate.plain += token.text;
        candidate.printableLength += token.text.length;
      }
      if (candidate.printableLength > maxPrintable || candidate.rawLength > maxRaw) {
        output.push(candidate.raw);
        candidate = null;
        return;
      }
      if (token.text && candidate.plain.endsWith(candidate.definition.close)) finishCandidate(output);
    }

    function processNormalToken(token, output) {
      if (!token.text) {
        if (scanUnits.length) scanInterstitialRaw += token.raw;
        else output.push(token.raw);
        return;
      }
      scanUnits.push({ beforeRaw: scanInterstitialRaw, raw: token.raw, text: token.text });
      scanInterstitialRaw = "";
      const plain = scanPlain();
      const exact = RESERVED_ENVELOPES.find(item => markerText(item.open) === markerText(plain));
      if (exact) {
        const raw = serializedUnits();
        candidate = {
          definition: exact,
          raw,
          plain,
          rawLength: raw.length,
          printableLength: plain.length,
          sourceAuthority: exact.kind === "packet" ? authority() : null,
          hidden: ownsHiddenOutput(),
        };
        scanUnits = [];
        return;
      }
      if (scanUnits.length < 1024 && markerText(plain)
        && RESERVED_ENVELOPES.some(item => markerText(item.open).startsWith(markerText(plain)))) return;
      retainOpeningSuffix(output);
    }

    function processToken(token, output) {
      if (held) {
        held.afterRaw += token.raw;
        if (held.raw.length + held.afterRaw.length > maxRaw) releaseHeld(output);
        return;
      }
      if (candidate) processCandidateToken(token, output);
      else processNormalToken(token, output);
    }

    function releaseAll(output) {
      processRaw("", true, output);
      if (held) releaseHeld(output);
      if (candidate && !candidate.hidden) output.push(candidate.raw);
      candidate = null;
      const privatePrefix = ownsHiddenOutput()
        && markerText(scanPlain()).startsWith('<whitebox-comprehension-');
      if (scanUnits.length && !privatePrefix) output.push(serializedUnits());
      if (scanInterstitialRaw) output.push(scanInterstitialRaw);
      scanUnits = [];
      scanInterstitialRaw = "";
    }

    function consume(value, consumeOptions = {}) {
      const input = String(value == null ? "" : value);
      if (!enabled) return input;
      const output = [];
      reevaluateHeld(output);
      processRaw(input, consumeOptions.final === true, output);
      if (consumeOptions.final === true) releaseAll(output);
      return output.join("");
    }

    function refresh() {
      if (!enabled) return "";
      const output = [];
      reevaluateHeld(output);
      if (candidate?.definition.kind === "packet" && !candidate.hidden && authority().state === "release") {
        output.push(candidate.raw);
        candidate = null;
      }
      return output.join("");
    }

    function releasePending() {
      if (!enabled) return "";
      const output = [];
      releaseAll(output);
      return output.join("");
    }

    return Object.freeze({
      consume,
      refresh,
      flush: releasePending,
      releasePending,
      reset: releasePending,
      isSuppressing: () => Boolean(candidate || held),
      hasPending: () => Boolean(candidate || held || scanUnits.length || scanInterstitialRaw || tokenizer.hasPending()),
    });
  }

  return Object.freeze({
    RESERVED_ENVELOPES,
    MAX_PACKET_PAYLOAD_BYTES,
    DEFAULT_MAX_CANDIDATE_PRINTABLE,
    DEFAULT_MAX_CANDIDATE_RAW,
    createFilter,
    hasTrustedContractLaunchProvenance,
  });
});
