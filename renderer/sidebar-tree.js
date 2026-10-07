"use strict";

// Virtual folders only: moving a session never changes its workspace or ID.
window.WhiteboxSidebarTree = (() => {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const clean = value => typeof value === "string" && value.length <= 2000;
  function normalize(value = {}) {
    const folders = [];
    const ids = new Set();
    for (const folder of Array.isArray(value?.folders) ? value.folders.slice(0, 1000) : []) {
      if (!folder || !clean(folder.id) || !folder.id || ids.has(folder.id)
        || !clean(folder.projectKey) || !folder.projectKey || !clean(folder.name) || !folder.name.trim()) continue;
      ids.add(folder.id);
      folders.push({ id: folder.id, projectKey: folder.projectKey, name: folder.name.trim().slice(0, 100), parentId: clean(folder.parentId) ? folder.parentId : "" });
    }
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    for (const folder of folders) {
      const visited = new Set([folder.id]);
      let parent = byId.get(folder.parentId);
      if (!parent || parent.projectKey !== folder.projectKey) folder.parentId = "";
      while (parent) {
        if (visited.has(parent.id)) { folder.parentId = ""; break; }
        visited.add(parent.id);
        parent = byId.get(parent.parentId);
      }
    }
    const assignments = [];
    const seen = new Set();
    for (const item of Array.isArray(value?.assignments) ? value.assignments.slice(0, 10000) : []) {
      if (!item || !clean(item.sessionId) || !item.sessionId || !clean(item.projectKey)) continue;
      const folder = byId.get(item.folderId);
      const key = JSON.stringify([item.projectKey, item.sessionId]);
      if (!folder || folder.projectKey !== item.projectKey || seen.has(key)) continue;
      seen.add(key);
      assignments.push({ projectKey: item.projectKey, sessionId: item.sessionId, folderId: folder.id });
    }
    return { folders, assignments, expanded: Array.isArray(value?.expanded) ? [...new Set(value.expanded.filter(id => ids.has(id)))] : [] };
  }
  const data = state => state.sidebarTree || (state.sidebarTree = normalize());
  function descendants(tree, id) {
    const result = new Set([id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const folder of tree.folders) if (result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id); changed = true;
      }
    }
    return result;
  }
  function move(state, projectKey, kind, id, parentId) {
    const tree = data(state);
    if (parentId && !tree.folders.some(folder => folder.id === parentId && folder.projectKey === projectKey)) return false;
    if (kind === "folder") {
      const folder = tree.folders.find(item => item.id === id && item.projectKey === projectKey);
      if (!folder || descendants(tree, id).has(parentId)) return false;
      folder.parentId = parentId;
    } else if (kind === "session") {
      tree.assignments = tree.assignments.filter(item => item.projectKey !== projectKey || item.sessionId !== id);
      if (parentId) tree.assignments.push({ projectKey, sessionId: id, folderId: parentId });
    } else return false;
    for (let parent = tree.folders.find(item => item.id === parentId); parent; parent = tree.folders.find(item => item.id === parent.parentId)) {
      if (!tree.expanded.includes(parent.id)) tree.expanded.push(parent.id);
    }
    state.sidebarExpandedProjects.add(projectKey);
    return true;
  }
  function remove(state, id) {
    const tree = data(state);
    const folder = tree.folders.find(item => item.id === id);
    if (!folder) return false;
    tree.folders.forEach(item => { if (item.parentId === id) item.parentId = folder.parentId; });
    tree.assignments.forEach(item => { if (item.folderId === id) item.folderId = folder.parentId; });
    tree.assignments = tree.assignments.filter(item => item.folderId);
    tree.folders = tree.folders.filter(item => item.id !== id);
    tree.expanded = tree.expanded.filter(item => item !== id);
    return true;
  }
  function render(state, projectKey, sessions, renderSession, esc, groupPrefix) {
    const tree = data(state);
    const folders = tree.folders.filter(folder => folder.projectKey === projectKey);
    const assignment = new Map(tree.assignments.filter(item => item.projectKey === projectKey).map(item => [item.sessionId, item.folderId]));
    const collapsed = state.sidebarPathCollapsed || (state.sidebarPathCollapsed = new Set());
    const norm = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
    function renderPaths(items, level, parts = []) {
      const children = new Map(), leaves = [];
      for (const session of items) {
        const cwd = String(session.sidebarCwd || session.cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
        const relative = norm(cwd).startsWith(`${norm(projectKey)}/`) ? cwd.slice(projectKey.length + 1).split('/').filter(Boolean) : [];
        if (relative.length <= parts.length) leaves.push(session);
        else { const name = relative[parts.length]; if (!children.has(name)) children.set(name, []); children.get(name).push(session); }
      }
      return [...children].sort(([a], [b]) => a.localeCompare(b)).map(([name, entries], index) => {
        const originalRoot = String(entries[0].sidebarCwd || entries[0].cwd || projectKey).replace(/\\/g, '/').slice(0, projectKey.length);
        const path = `${originalRoot}/${[...parts, name].join('/')}`;
        const expanded = !collapsed.has(path), id = `${groupPrefix}Path${encodeURIComponent(path)}`;
        return `<div class="sidebar-tree-folder"><div class="sidebar-tree-folder-row"><button type="button" class="sidebar-tree-folder-toggle" aria-selected="${!state.sidebarFolderFilter?.entryId && state.sidebarFolderFilter?.projectKey === projectKey && state.sidebarFolderFilter?.path === path}" data-path-tree-toggle="${esc(path)}" data-sidebar-project-ref="${esc(projectKey)}" role="treeitem" aria-level="${level}" aria-expanded="${expanded}" aria-controls="${esc(id)}" tabindex="-1"><span class="sidebar-tree-chevron">${expanded ? '⌄' : '›'}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg><b>${esc(name)}</b></button></div><div id="${esc(id)}" class="sidebar-tree-children" role="group"${expanded ? '' : ' hidden'}>${renderPaths(entries, level + 1, [...parts, name])}</div></div>`;
      }).join('') + leaves.map(session => `<div class="sidebar-tree-session-row">${renderSession(session, level)}</div>`).join('');
    }
    const renderGroup = (parentId, level) => folders.filter(folder => folder.parentId === parentId).map(folder => {
      const expanded = tree.expanded.includes(folder.id);
      const groupId = `${groupPrefix}Folder${tree.folders.indexOf(folder)}`;
      return `<div class="sidebar-tree-folder" data-tree-folder="${esc(folder.id)}">
        <div class="sidebar-tree-folder-row">
          <button type="button" class="sidebar-tree-folder-toggle" aria-selected="${state.sidebarFolderFilter?.projectKey === projectKey && state.sidebarFolderFilter?.folderId === folder.id}" data-tree-toggle="${esc(folder.id)}" data-sidebar-folder-id="${esc(folder.id)}" data-sidebar-project-ref="${esc(projectKey)}"
            role="treeitem" aria-level="${level}" aria-expanded="${expanded}" aria-controls="${groupId}" aria-owns="${groupId}" tabindex="-1" draggable="true">
            <span class="sidebar-tree-chevron" aria-hidden="true">${expanded ? "⌄" : "›"}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
            <b>${esc(folder.name)}</b>
          </button>
          <button type="button" class="sidebar-tree-more" data-tree-manage="folder" data-tree-id="${esc(folder.id)}" aria-label="${esc(t("folder.manage_named", { name: folder.name }))}">···</button>
        </div>
        <div id="${groupId}" class="sidebar-tree-children" role="group"${expanded ? "" : " hidden"}>${renderGroup(folder.id, level + 1)}</div>
      </div>`;
    }).join("") + renderPaths(sessions.filter(session => (assignment.get(session.id) || "") === parentId), level);
    return renderGroup("", 2);
  }
  function matchesFilter(state, session) {
    const filter = state.sidebarFolderFilter;
    const norm = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
    if (!filter || norm(filter.projectKey) !== norm(state.workspace)) return true;
    if (filter.entryId) return session.id === filter.entryId;
    if (filter.path) {
      const path = norm(filter.path);
      const paths = session.workspaceRoots?.length ? session.workspaceRoots : [session.sidebarCwd || session.originCwd || session.cwd || session.workspace];
      return paths.some(value => norm(value) === path || norm(value).startsWith(`${path}/`));
    }
    const tree = data(state), included = descendants(tree, filter.folderId);
    return tree.assignments.some(item => norm(item.projectKey) === norm(filter.projectKey) && item.sessionId === session.id && included.has(item.folderId));
  }
  function bind({ state, list, renderWorkspaces, saveDashboardPreferences, announce, selectFolder = () => {} }) {
    if (!list) return;
    let restoreFocus;
    const dialog = document.createElement("dialog");
    dialog.id = "sidebarTreeDialog";
    dialog.setAttribute("aria-label", t("folder.manage"));
    document.body.append(dialog);
    const esc = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    function focusNode(projectKey, kind, id) {
      const group = [...list.querySelectorAll("[data-sidebar-project-key]")].find(item => item.dataset.sidebarProjectKey === projectKey);
      const target = kind === "folder" ? [...(group?.querySelectorAll("[data-sidebar-folder-id]") || [])].find(item => item.dataset.sidebarFolderId === id)
        : kind === "session" ? [...(group?.querySelectorAll("[data-sidebar-session-id]") || [])].find(item => item.dataset.sidebarSessionId === id) : null;
      (target && !target.closest("[hidden]") ? target : group?.querySelector(".project-sidebar-item"))?.focus({ preventScroll: true });
    }
    function commit(projectKey, kind, id) {
      saveDashboardPreferences(); renderWorkspaces();
      focusNode(projectKey, kind, id);
    }
    function open(trigger, kind, id = "") {
      const projectKey = trigger.closest("[data-sidebar-project-key]").dataset.sidebarProjectKey;
      const tree = data(state);
      const folder = tree.folders.find(item => item.id === id);
      const excluded = kind === "folder" ? descendants(tree, id) : new Set();
      const parentId = kind === "folder" ? folder.parentId : tree.assignments.find(item => item.projectKey === projectKey && item.sessionId === id)?.folderId || "";
      const byId = new Map(tree.folders.map(item => [item.id, item]));
      const path = item => { const names = [item.name]; for (let parent = byId.get(item.parentId); parent; parent = byId.get(parent.parentId)) names.unshift(parent.name); return names.join(" / "); };
      dialog.innerHTML = `<form method="dialog"><header class="sidebar-tree-dialog-head"><span class="sidebar-tree-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg></span><h2 id="sidebarTreeDialogTitle">${esc(t(kind === "project" ? "folder.create" : kind === "folder" ? "folder.edit" : "folder.move_session"))}</h2><button type="button" class="sidebar-tree-dialog-close" data-tree-dialog="close" aria-label="${esc(t('folder.cancel'))}">×</button></header><p class="sidebar-tree-dialog-location">${esc(trigger.closest('[data-sidebar-project-key]')?.querySelector('[data-workspace]')?.dataset.workspace || projectKey)}</p>
        ${kind !== "session" ? `<label>${esc(t("folder.name"))}<input name="folderName" maxlength="100" required value="${esc(folder?.name || "")}" autocomplete="off"></label>` : ""}
        ${kind !== "project" ? `<label>${esc(t("folder.destination"))}<select name="destination"><option value="">${esc(t("folder.root"))}</option>${tree.folders.filter(item => item.projectKey === projectKey && !excluded.has(item.id)).map(item => `<option value="${esc(item.id)}"${item.id === parentId ? " selected" : ""}>${esc(path(item))}</option>`).join("")}</select></label>` : ""}
        ${kind === "folder" ? `<p>${esc(t("folder.delete_help"))}</p><button type="button" data-tree-dialog="child">${esc(t("folder.child"))}</button><button type="button" data-tree-dialog="delete">${esc(t("folder.delete"))}</button>` : ""}
        <div class="sidebar-tree-dialog-actions"><button type="button" data-tree-dialog="cancel">${esc(t("folder.cancel"))}</button><button type="submit">${esc(t(kind === "project" ? "folder.submit_create" : "folder.save"))}</button></div></form>`;
      restoreFocus = () => focusNode(projectKey, kind, id);
      dialog.setAttribute('aria-labelledby', 'sidebarTreeDialogTitle');
      dialog.querySelector('[data-tree-dialog="close"]').onclick = () => dialog.close();
      dialog.querySelector('[data-tree-dialog="cancel"]').onclick = () => dialog.close();
      dialog.querySelector('[data-tree-dialog="delete"]')?.addEventListener("click", () => { remove(state, id); dialog.close(); commit(projectKey, "project"); announce(t("folder.deleted")); });
      dialog.querySelector('[data-tree-dialog="child"]')?.addEventListener("click", () => {
        // Reuse the same accessible form to create a child at the chosen node.
        dialog.close(); create(trigger, projectKey, id);
      });
      dialog.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const name = dialog.querySelector('[name="folderName"]')?.value.trim();
        if (kind !== "session" && !name) { dialog.querySelector("input").focus(); return; }
        if (kind === "project") {
          const newId = crypto.randomUUID();
          tree.folders.push({ id: newId, projectKey, parentId: "", name });
          state.sidebarExpandedProjects.add(projectKey);
          dialog.close(); commit(projectKey, "folder", newId);
        } else {
          if (kind === "folder") folder.name = name;
          move(state, projectKey, kind, id, dialog.querySelector("select").value);
          dialog.close(); commit(projectKey, kind, id);
        }
        announce(t("folder.saved"));
      };
      dialog.showModal();
      (dialog.querySelector("input") || dialog.querySelector("select")).focus();
    }
    function create(trigger, projectKey, parentId) {
      open(trigger, "project");
      dialog.querySelector("h2").textContent = t("folder.child");
      dialog.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const name = dialog.querySelector("input").value.trim();
        if (!name) return;
        const tree = data(state), id = crypto.randomUUID();
        tree.folders.push({ id, projectKey, parentId, name });
        if (!tree.expanded.includes(parentId)) tree.expanded.push(parentId);
        state.sidebarExpandedProjects.add(projectKey);
        dialog.close(); commit(projectKey, "folder", id); announce(t("folder.created_child"));
      };
    }
    dialog.addEventListener("close", () => restoreFocus?.());
    list.addEventListener("click", event => {
      const pathTrigger = event.target.closest('[data-path-tree-toggle]');
      if (pathTrigger) {
        event.preventDefault(); event.stopImmediatePropagation();
        const collapsed = state.sidebarPathCollapsed || (state.sidebarPathCollapsed = new Set());
        const path = pathTrigger.dataset.pathTreeToggle;
        if (!event.target.closest('.sidebar-tree-chevron')) {
          collapsed.delete(path);
          selectFolder({ projectKey: pathTrigger.dataset.sidebarProjectRef, path, name: path.split('/').pop() });
        } else if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path);
        renderWorkspaces();
        [...list.querySelectorAll('[data-path-tree-toggle]')].find(item => item.dataset.pathTreeToggle === path)?.focus();
        return;
      }
      const trigger = event.target.closest("[data-tree-toggle], [data-tree-manage], [data-tree-create]");
      if (!trigger) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (trigger.hasAttribute("data-tree-toggle")) {
        const tree = data(state), id = trigger.dataset.treeToggle;
        if (!event.target.closest('.sidebar-tree-chevron')) {
          if (!tree.expanded.includes(id)) tree.expanded.push(id);
          selectFolder({ projectKey: trigger.dataset.sidebarProjectRef, folderId: id, name: tree.folders.find(item => item.id === id)?.name });
        } else tree.expanded = tree.expanded.includes(id) ? tree.expanded.filter(value => value !== id) : [...tree.expanded, id];
        commit(trigger.dataset.sidebarProjectRef, "folder", id);
      } else open(trigger, trigger.dataset.treeManage || "project", trigger.dataset.treeId);
    }, true);
    list.addEventListener("contextmenu", event => {
      const trigger = event.target.closest("[data-sidebar-folder-id], [data-sidebar-session-id]");
      if (!trigger) return;
      event.preventDefault(); event.stopImmediatePropagation();
      open(trigger, trigger.dataset.sidebarFolderId ? "folder" : "session", trigger.dataset.sidebarFolderId || trigger.dataset.sidebarSessionId);
    });
    let dragged = null;
    const clearDrop = () => list.querySelectorAll("[data-tree-drop]").forEach(item => item.removeAttribute("data-tree-drop"));
    list.addEventListener("dragstart", event => {
      const trigger = event.target.closest("[data-sidebar-folder-id], [data-sidebar-session-id]");
      if (!trigger) return;
      event.stopImmediatePropagation();
      dragged = { projectKey: trigger.dataset.sidebarProjectRef, kind: trigger.dataset.sidebarFolderId ? "folder" : "session", id: trigger.dataset.sidebarFolderId || trigger.dataset.sidebarSessionId };
      event.dataTransfer?.setData("application/x-whitebox-tree-node", JSON.stringify(dragged));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }, true);
    function destination(event) {
      const trigger = event.target.closest("[data-sidebar-folder-id], .project-sidebar-item");
      if (!trigger || !dragged || trigger.dataset.sidebarProjectRef !== dragged.projectKey) return null;
      const parentId = trigger.dataset.sidebarFolderId || "";
      if (dragged.kind === "folder" && descendants(data(state), dragged.id).has(parentId)) return null;
      return { trigger, parentId };
    }
    list.addEventListener("dragover", event => {
      if (!dragged) return;
      event.stopImmediatePropagation(); clearDrop();
      const target = destination(event);
      if (!target) return;
      event.preventDefault(); target.trigger.dataset.treeDrop = "true";
    }, true);
    list.addEventListener("drop", event => {
      if (!dragged) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const target = destination(event), node = dragged;
      dragged = null; clearDrop();
      if (target && move(state, node.projectKey, node.kind, node.id, target.parentId)) {
        commit(node.projectKey, node.kind, node.id); announce(t("folder.moved"));
      }
    }, true);
    list.addEventListener("dragleave", event => { if (!list.contains(event.relatedTarget)) clearDrop(); });
    list.addEventListener("dragend", () => { dragged = null; clearDrop(); }, true);
  }
  return { normalize, descendants, move, remove, render, bind, matchesFilter };
})();
