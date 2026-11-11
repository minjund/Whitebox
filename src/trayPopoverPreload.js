'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  ready: 'tray-popover:ready',
  resize: 'tray-popover:resize',
  openMain: 'tray-popover:open-main',
  quit: 'tray-popover:quit',
  dismiss: 'tray-popover:dismiss',
  state: 'tray-popover:state',
  hidden: 'tray-popover:hidden',
});

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Tray popover listener must be a function.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('trayPopover', Object.freeze({
  ready: () => ipcRenderer.invoke(CHANNELS.ready),
  resize: height => ipcRenderer.invoke(CHANNELS.resize, { height: Number(height) }),
  openMain: () => ipcRenderer.invoke(CHANNELS.openMain),
  quit: () => ipcRenderer.invoke(CHANNELS.quit),
  dismiss: () => ipcRenderer.invoke(CHANNELS.dismiss),
  onState: callback => subscribe(CHANNELS.state, callback),
  onHidden: callback => subscribe(CHANNELS.hidden, callback),
}));
