'use strict';

function normalizedPath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  return normalized.replace(/\/+$/u, '') || (normalized.startsWith('/') ? '/' : '');
}

function pathKey(value) {
  const normalized = normalizedPath(value).replace(/^\/mnt\/([a-z])\//iu, '$1:/');
  return /^(?:[a-z]:|\/\/)/iu.test(normalized) ? normalized.toLowerCase() : normalized;
}

// These roots describe the project selected in the client. Keep them separate
// from cwd: desktop clients may run every conversation in their app-data folder.
function workspaceRootsFromEnvironment(value) {
  const environment = String(value || '').trim().match(/^<environment_context>\s*([\s\S]*?)<\/environment_context>$/u);
  if (!environment) return null;
  const roots = environment[1].match(/<workspace_roots>([\s\S]*?)<\/workspace_roots>/u);
  if (!roots) return null;
  return [...new Set([...roots[1].matchAll(/<root>([^<]+)<\/root>/gu)]
    .map(match => match[1].trim())
    .filter(value => /^(?:[a-z]:[\\/]|\/|\\\\)/iu.test(value)))].slice(0, 32);
}

function attentionProject(session, { requestCwd = '', terminalCwd = '', workspaces = [] } = {}) {
  const roots = [...new Set((session?.workspaceRoots || []).map(normalizedPath).filter(Boolean))];
  const paths = roots.length ? roots : [terminalCwd || requestCwd || session?.originCwd || session?.cwd].filter(Boolean);
  const projects = paths.map(value => {
    const key = pathKey(value);
    const owner = workspaces.filter(item => {
      const parent = pathKey(item.path);
      return parent && (key === parent || key.startsWith(parent === '/' ? '/' : `${parent}/`));
    }).sort((a, b) => pathKey(b.path).length - pathKey(a.path).length)[0];
    const projectPath = owner?.path || value;
    return {
      name: String(owner?.name || normalizedPath(projectPath).split('/').pop() || projectPath),
      path: String(projectPath),
    };
  });
  const unique = [...new Map(projects.map(project => [pathKey(project.path), project])).values()];
  return {
    project: unique.map(project => project.name).join(' · ') || String(session?.workspace || ''),
    projectPath: unique.map(project => project.path).join('\n'),
  };
}

module.exports = { attentionProject, workspaceRootsFromEnvironment };
