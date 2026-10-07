'use strict';

module.exports = async function exerciseSidebarFolders(win) {
  return win.webContents.executeJavaScript(`(async () => {
    const app = window.WhiteboxApp, model = window.WhiteboxSidebarTree;
    const list = document.querySelector('#projectSidebarList');
    const check = (ok, message) => { if (!ok) throw new Error('Folder tree: ' + message); };
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const keydown = (node, key) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const projectKey = list.querySelector('[data-sidebar-session-id]').dataset.sidebarProjectRef;
    const group = () => [...list.querySelectorAll('[data-sidebar-project-key]')].find(node => node.dataset.sidebarProjectKey === projectKey);
    const folder = id => [...group().querySelectorAll('[data-sidebar-folder-id]')].find(node => node.dataset.sidebarFolderId === id);
    const session = id => [...group().querySelectorAll('[data-sidebar-session-id]')].find(node => node.dataset.sidebarSessionId === id);
    const manage = (kind, id) => [...group().querySelectorAll('[data-tree-manage]')].find(node => node.dataset.treeManage === kind && node.dataset.treeId === id);
    const dialog = () => document.querySelector('#sidebarTreeDialog');
    const submit = () => dialog().querySelector('form').requestSubmit();
    const prefs = () => JSON.parse(localStorage.getItem(app.DASHBOARD_STORAGE_KEY));
    const sessionId = group().querySelector('[data-sidebar-session-id]').dataset.sidebarSessionId;
    const originalIds = [...group().querySelectorAll('[data-sidebar-session-id]')].map(node => node.dataset.sidebarSessionId).sort().join('|');

    group().querySelector('[data-tree-create]').click();
    check(dialog().open && document.activeElement === dialog().querySelector('input'), 'create dialog opens with input focus');
    dialog().querySelector('input').value = '기능 개발 <draft>';
    submit(); await frame();
    const parentId = app.state.sidebarTree.folders.at(-1).id;
    check(folder(parentId)?.textContent.includes('<draft>') && !folder(parentId).querySelector('draft'), 'folder name is rendered as text');
    check(prefs().sidebarTree.folders.some(item => item.id === parentId), 'folder creation saved');
    manage('folder', parentId).click();
    dialog().querySelector('[data-tree-dialog="child"]').click();
    dialog().querySelector('input').value = '사이드바'; submit(); await frame();
    const childId = app.state.sidebarTree.folders.at(-1).id;
    check(folder(childId).getAttribute('aria-level') === '3', 'nested folder depth');

    check(!group().querySelector('[data-tree-manage=\"session\"]'), 'session ellipsis removed');
    session(sessionId).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    dialog().querySelector('select').value = parentId; submit(); await frame();
    const parentChildren = folder(parentId).closest('.sidebar-tree-folder').querySelector('.sidebar-tree-children');
    check(session(sessionId).closest('.sidebar-tree-children') === parentChildren && folder(childId).closest('.sidebar-tree-children') === parentChildren, 'sessions and child folders share one parent');
    check(session(sessionId).getAttribute('aria-level') === '3', 'nested session aria level');
    folder(parentId).querySelector('b').click(); await frame();
    check(app.state.sidebarFolderFilter.folderId === parentId && model.matchesFilter(app.state, { id: sessionId }), 'folder name selects its assigned sessions');
    check(!model.matchesFilter(app.state, { id: 'unrelated', cwd: projectKey }), 'virtual folder excludes unassigned sessions');
    folder(childId).querySelector('b').click(); await frame();
    check(!model.matchesFilter(app.state, { id: sessionId }), 'empty child folder does not show parent sessions');
    group().querySelector('[data-workspace]').click(); await frame();
    check(!app.state.sidebarFolderFilter, 'project selection clears the folder filter');
    check(Math.abs(session(sessionId).querySelector('b').getBoundingClientRect().left - folder(childId).querySelector('b').getBoundingClientRect().left) < 1, 'sibling folder and session labels share the same indentation');
    session(sessionId).focus(); keydown(session(sessionId), 'ArrowLeft');
    check(document.activeElement === folder(parentId), 'left arrow returns to actual folder parent');
    keydown(folder(parentId), 'ArrowLeft'); await frame();
    check(folder(parentId).getAttribute('aria-expanded') === 'false' && document.activeElement === folder(parentId), 'folder collapses and retains focus');
    keydown(folder(parentId), 'ArrowRight'); await frame();
    keydown(folder(parentId), 'ArrowRight');
    check(document.activeElement === folder(childId), 'right arrow enters child folder');
    check(!model.move(app.state, projectKey, 'folder', parentId, childId), 'reject moving parent into descendant');

    // Exercise drag handlers without trusting external drag payloads.
    const transfer = { setData() {}, effectAllowed: '', dropEffect: '' };
    const drag = (node, type) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); node.dispatchEvent(event); };
    drag(session(sessionId), 'dragstart'); drag(folder(childId), 'dragover'); drag(folder(childId), 'drop'); await frame();
    check(app.state.sidebarTree.assignments.find(item => item.sessionId === sessionId).folderId === childId, 'drag moves exact session');
    check(folder(childId).getAttribute('aria-expanded') === 'true' && session(sessionId).getAttribute('aria-level') === '4', 'drop expands destination and updates depth');
    drag(folder(childId), 'dragstart'); drag(group().querySelector('.project-sidebar-item'), 'dragover'); drag(group().querySelector('.project-sidebar-item'), 'drop'); await frame();
    check(folder(childId).getAttribute('aria-level') === '2' && session(sessionId).getAttribute('aria-level') === '3', 'folder drag moves subtree to root');
    check(!list.querySelector('[data-tree-drop], [data-project-drop-edge]'), 'drag markers cleaned');

    manage('folder', childId).click(); dialog().querySelector('input').value = '정리된 세션'; submit(); await frame();
    check(folder(childId).textContent.includes('정리된 세션'), 'rename folder');
    app.state.sidebarTree = model.normalize(); app.loadQualityState(); app.renderWorkspaces();
    check(folder(childId)?.textContent.includes('정리된 세션') && session(sessionId).getAttribute('aria-level') === '3', 'folders and assignment restore from persisted preferences');
    // Put the child back under its parent, then delete that parent.
    model.move(app.state, projectKey, 'folder', childId, parentId); app.renderWorkspaces();
    const parentRecord = { ...app.state.sidebarTree.folders.find(item => item.id === parentId) };
    manage('folder', parentId).click(); dialog().querySelector('[data-tree-dialog="delete"]').click(); await frame();
    check(!folder(parentId) && folder(childId).getAttribute('aria-level') === '2' && session(sessionId), 'parent deletion preserves nested folders and their sessions');
    manage('folder', childId).click(); dialog().querySelector('[data-tree-dialog="delete"]').click(); await frame();
    check(!folder(childId) && session(sessionId).getAttribute('aria-level') === '2', 'deletion retains session at root');

    // Rebuild a mixed subtree for visual verification and reload persistence.
    app.state.sidebarTree.folders.push(parentRecord);
    const child = { id: 'sidebar-test-child', projectKey, parentId, name: '사이드바' };
    app.state.sidebarTree.folders.push(child);
    model.move(app.state, projectKey, 'session', sessionId, parentId);
    app.saveDashboardPreferences(); app.renderWorkspaces();
    check([...group().querySelectorAll('[data-sidebar-session-id]')].map(node => node.dataset.sidebarSessionId).sort().join('|') === originalIds, 'no session duplicated or lost');
    const corrupted = model.normalize({ folders: [{ id: 'a', projectKey, parentId: 'b', name: 'A' }, { id: 'b', projectKey, parentId: 'a', name: 'B' }], assignments: [{ projectKey, sessionId, folderId: 'missing' }] });
    check(corrupted.assignments.length === 0 && corrupted.folders.some(item => !item.parentId), 'corrupt cycles and stale assignments repaired');
    const otherKey = [...list.querySelectorAll('[data-sidebar-project-key]')].find(node => node.dataset.sidebarProjectKey !== projectKey).dataset.sidebarProjectKey;
    check(!model.move(app.state, otherKey, 'session', sessionId, parentId), 'cross-project folder assignment rejected');
    return { mixedChildren: true, create: true, rename: true, move: true, drag: true, keyboard: true, persistence: true, deletePreservesSessions: true, cycleRejection: true, exactSessionIds: true };
  })()`);
};
