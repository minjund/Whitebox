'use strict';

const { blankUsage, providerList } = require('../providerRegistry');

function usageForSessions(sessions) {
  const usage = blankUsage();
  for (const session of sessions || []) {
    for (const key of Object.keys(usage)) {
      const value = Number(session?.usage?.[key] || 0);
      if (Number.isFinite(value) && value > 0) usage[key] += value;
    }
  }
  if (!usage.total) usage.total = usage.input + usage.output + usage.reasoning;
  return usage;
}

function summaryForSessions(summary, sessions, providers = providerList()) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const active = session => session.status === 'running' || session.status === 'starting';
  const providerRows = (summary?.providers || providers).map(provider => {
    const own = rows.filter(session => session.provider === provider.id);
    return {
      ...provider,
      sessions: own.length,
      active: own.filter(active).length,
      waiting: own.filter(session => session.status === 'waiting').length,
      subagents: own.filter(session => session.parentId).length,
      usage: usageForSessions(own),
    };
  });
  return {
    ...(summary || {}),
    providers: providerRows,
    totals: {
      sessions: rows.length,
      active: rows.filter(active).length,
      waiting: rows.filter(session => session.status === 'waiting').length,
      subagents: rows.filter(session => session.parentId).length,
      usage: usageForSessions(rows),
    },
  };
}

module.exports = { summaryForSessions, usageForSessions };
