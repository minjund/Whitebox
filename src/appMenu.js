'use strict';

// macOS only. The menu keeps Electron's default menus (app, edit, view,
// window) and gives File one item: Cmd+W closes the focused window the way
// its own close control does. Windows and Linux keep their current menu, so
// Ctrl+W stays a terminal key there.
function applicationMenuTemplate({ platform, closeLabel, closeWindow }) {
  if (platform !== 'darwin') return null;
  return [
    { role: 'appMenu' },
    { label: 'File', submenu: [{ id: 'whitebox-close-window', label: closeLabel, accelerator: 'Command+W',
      click: (_item, focusedWindow) => closeWindow(focusedWindow) }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

// An attention popup dismisses itself as its × button does; every other
// window gets close(), which runs that window's own close handler (the main
// window hides to the tray while terminals keep running, exactly as its
// close button does).
function closeFocusedWindow(win, { dismissPopup } = {}) {
  if (!win || typeof win.close !== 'function' || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
  if (typeof dismissPopup === 'function' && dismissPopup(win)) return true;
  win.close();
  return true;
}

module.exports = { applicationMenuTemplate, closeFocusedWindow };
