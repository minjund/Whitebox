(function exposeAttentionActivation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxAttentionActivation = api;
})(typeof window !== 'undefined' ? window : globalThis, function createAttentionActivationApi() {
  'use strict';

  function text(value, limit = 1_000) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .trim()
      .slice(0, limit);
  }

  function normalize(value = {}) {
    const activationId = text(value.activationId || value.id, 1_000);
    if (!activationId) return null;
    return {
      activationId,
      cancelled: value.cancelled === true,
      source: text(value.source, 80),
      provider: text(value.provider, 80).toLowerCase(),
      sessionId: text(value.sessionId, 512),
      rawSessionId: text(value.rawSessionId, 512),
      agentId: text(value.agentId, 512),
      targetId: text(value.targetId, 512),
      terminalId: text(value.terminalId, 512),
      deliveryToken: text(value.deliveryToken, 120),
      preservePopupFocus: value.preservePopupFocus === true,
    };
  }

  function createAttentionActivationController(options = {}) {
    const pending = new Map();
    let sequence = 0;
    const retryDelaysMs = (Array.isArray(options.retryDelaysMs)
      ? options.retryDelaysMs
      : [150, 400, 900, 1_800, 3_200])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0)
      .slice(0, 20);

    const report = (scope, error) => {
      try { options.onError?.(scope, error); } catch {}
    };

    const sessionFor = activation => {
      const sessions = (options.getSessions?.() || []).filter(session => (
        !activation.provider
        || String(session?.provider || '').toLowerCase() === activation.provider
      ));
      const internalId = activation.sessionId;
      const internalMatches = internalId
        ? sessions.filter(session => String(session?.id || '') === internalId)
        : [];
      if (internalMatches.length === 1) return internalMatches[0];
      if (internalMatches.length > 1) return null;
      const fallbackIds = [...new Set([
        activation.agentId,
        activation.rawSessionId,
        internalId,
      ].filter(Boolean))];
      const fallbackMatches = sessions.filter(session => fallbackIds.some(id => (
        String(session?.id || '') === id || String(session?.externalId || '') === id
      )));
      return fallbackMatches.length === 1 ? fallbackMatches[0] : null;
    };

    const isCurrent = entry => pending.get(entry.activation.activationId) === entry;

    const clearRetryTimer = entry => {
      if (entry?.retryTimer == null) return;
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    };

    const clearAcknowledgeRetryTimer = entry => {
      if (entry?.ackRetryTimer == null) return;
      clearTimeout(entry.ackRetryTimer);
      entry.ackRetryTimer = null;
    };

    const acknowledge = async (entry, status) => {
      if (!isCurrent(entry)) return false;
      if (entry.acknowledging) {
        if (status === 'user-navigated') entry.ackStatus = status;
        entry.retryQueued = true;
        return false;
      }
      entry.ackStatus = status;
      entry.acknowledging = true;
      try {
        const result = await options.acknowledge?.({
          activationId: entry.activation.activationId,
          deliveryToken: entry.activation.deliveryToken,
          status,
        });
        if (!isCurrent(entry)) return false;
        const accepted = result === true || result?.acknowledged === true;
        if (accepted && entry.ackStatus === status) {
          clearRetryTimer(entry);
          clearAcknowledgeRetryTimer(entry);
          pending.delete(entry.activation.activationId);
        } else if (!accepted) {
          scheduleAcknowledgeRetry(entry);
        }
        return accepted;
      } catch (error) {
        report('attention-activation-ack', error);
        scheduleAcknowledgeRetry(entry);
        return false;
      } finally {
        entry.acknowledging = false;
        if (isCurrent(entry) && entry.ackStatus !== status) entry.retryQueued = true;
      }
    };

    const showSession = (entry, session) => {
      if (entry.contextShown) return;
      entry.contextShown = true;
      try { options.showSession?.(session, entry.activation); } catch (error) {
        report('attention-activation-show-session', error);
      }
    };

    const latest = () => [...pending.values()].sort((left, right) => right.order - left.order)[0] || null;

    const scheduleAcknowledgeRetry = entry => {
      if (!isCurrent(entry) || entry.ackRetryTimer != null) return true;
      if (entry.ackRetryIndex >= retryDelaysMs.length) return false;
      const delay = retryDelaysMs[entry.ackRetryIndex];
      entry.ackRetryIndex += 1;
      entry.ackRetryTimer = setTimeout(() => {
        entry.ackRetryTimer = null;
        void attempt(entry);
      }, delay);
      return true;
    };

    // The former popup gave a person a way to release a provider hook when a
    // terminal disappeared. With that UI gone, keep exact-terminal retries
    // short and bounded, then hand the user back to work status and acknowledge
    // the hook instead of leaving the provider blocked until its long timeout.
    const scheduleRetry = entry => {
      if (!isCurrent(entry) || entry.retryTimer != null) return true;
      if (entry.retryIndex >= retryDelaysMs.length) return false;
      const delay = retryDelaysMs[entry.retryIndex];
      entry.retryIndex += 1;
      entry.retryTimer = setTimeout(() => {
        entry.retryTimer = null;
        void attempt(entry);
      }, delay);
      return true;
    };

    const attempt = async entry => {
      if (!isCurrent(entry)) return;
      if (entry.inFlight) {
        entry.retryQueued = true;
        return;
      }
      if (entry.ackStatus) {
        await acknowledge(entry, entry.ackStatus);
        return;
      }
      entry.inFlight = true;
      entry.retryQueued = false;
      const operationEpoch = entry.operationEpoch;
      const operationCurrent = () => isCurrent(entry) && entry.operationEpoch === operationEpoch;
      try {
      const session = sessionFor(entry.activation);
      if (!session) {
        if (scheduleRetry(entry)) return;
        showSession(entry, null);
        await acknowledge(entry, 'opened-session');
        return;
      }
      if (options.isProviderVisible?.(session.provider) === false) {
        await acknowledge(entry, 'ignored');
        return;
      }
      const ptyEligible = typeof options.canOpenPty === 'function'
        ? options.canOpenPty(session) === true
        : !(session.parentId || session.sourcePluginId || session.controlCapabilities?.pty === false
          || session.presentation?.conversationSurface === 'transcript');
      if (!ptyEligible) {
        showSession(entry, session);
        await acknowledge(entry, 'opened-session');
        return;
      }

      let outcome = { opened: false, retryable: true };
      try {
        outcome = await options.openPty?.(session, entry.activation, {
          isCurrent: operationCurrent,
        }) || outcome;
      } catch (error) {
        report('attention-activation-open-pty', error);
      }
      if (!operationCurrent()) return;
      if (outcome.opened) {
        await acknowledge(entry, 'opened-pty');
        return;
      }
      showSession(entry, session);
      if (outcome.retryable === false || !scheduleRetry(entry)) {
        await acknowledge(entry, 'opened-session');
      }
      } finally {
        entry.inFlight = false;
        if (isCurrent(entry) && entry.retryQueued) {
          entry.retryQueued = false;
          void attempt(entry);
        }
      }
    };

    const retryLatest = () => {
      const entry = latest();
      if (entry) void attempt(entry);
    };

    const handle = value => {
      const activation = normalize(value);
      if (!activation) return { ok: false };
      if (activation.cancelled) {
        const entry = pending.get(activation.activationId);
        if (entry) {
          entry.operationEpoch += 1;
          clearRetryTimer(entry);
          clearAcknowledgeRetryTimer(entry);
        }
        pending.delete(activation.activationId);
        return { ok: true, cancelled: true };
      }
      const existing = pending.get(activation.activationId);
      if (existing) {
        clearRetryTimer(existing);
        clearAcknowledgeRetryTimer(existing);
        existing.activation = activation;
        existing.operationEpoch += 1;
        existing.ackStatus = '';
        existing.retryIndex = 0;
        existing.ackRetryIndex = 0;
      }
      else {
        for (const entry of pending.values()) {
          entry.operationEpoch += 1;
          clearRetryTimer(entry);
          clearAcknowledgeRetryTimer(entry);
        }
        pending.clear();
        pending.set(activation.activationId, {
          activation,
          order: ++sequence,
          contextShown: false,
          operationEpoch: 1,
          inFlight: false,
          retryQueued: false,
          acknowledging: false,
          ackStatus: '',
          retryIndex: 0,
          retryTimer: null,
          ackRetryIndex: 0,
          ackRetryTimer: null,
        });
      }
      retryLatest();
      return { ok: true, pending: true };
    };

    const userNavigated = () => {
      for (const entry of pending.values()) {
        entry.operationEpoch += 1;
        clearRetryTimer(entry);
        clearAcknowledgeRetryTimer(entry);
        entry.ackStatus = 'user-navigated';
        if (entry.inFlight || entry.acknowledging) entry.retryQueued = true;
        else void acknowledge(entry, 'user-navigated');
      }
    };

    return {
      handle,
      retry: retryLatest,
      userNavigated,
      pendingCount: () => pending.size,
      pendingIds: () => [...pending.keys()],
      dispose: () => {
        for (const entry of pending.values()) {
          entry.operationEpoch += 1;
          clearRetryTimer(entry);
          clearAcknowledgeRetryTimer(entry);
        }
        pending.clear();
      },
    };
  }

  return { createAttentionActivationController, normalizeAttentionActivation: normalize };
});
