'use strict';
// Run from the repository root with its existing Electron. No packages required.
// node_modules/.bin/electron docs/design-drafts/analysis-visibility/a-reading-mode/capture.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = __dirname;
const profile = path.join(output, '.capture-profile');
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
async function evaluate(code) { return win.webContents.executeJavaScript(code, true); }
async function open(query = {}) {
  await win.loadFile(path.join(output, 'index.html'), { query });
  // Hidden windows have no OS focus; emulate a focused, loaded page so native
  // focus/blur events and the focused dock render during capture.
  if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  win.webContents.focus();
  await evaluate('document.fonts.ready.then(() => true)');
  await delay(230);
}
async function shot(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await delay(70);
  fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
}
async function key(keyCode, text, modifiers=[]) {
  win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
  if(text!==undefined)win.webContents.sendInputEvent({type:'char',keyCode:text,modifiers});
  win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
  await delay(30);
}
async function checkDockInput() {
  assert.equal(await evaluate('document.documentElement.dataset.mode'),'reading');
  assert.equal(await evaluate('document.activeElement.id'),'terminal-input');
  assert.equal(await evaluate('document.querySelector("#selected-pane").classList.contains("is-input-focused")'),true);
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".dock-input-status")).display'),'none');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#selected-pane")).borderColor===getComputedStyle(document.querySelector(".dock-input-status")).color'),true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#selected-pane")).boxShadow.includes("none")'),false);
}
app.whenReady().then(async () => {
  const deadline = setTimeout(() => app.exit(1), 45000);
  try {
    win = new BrowserWindow({width:1440,height:900,useContentSize:true,show:false,
      webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    const errors=[];
    win.webContents.on('console-message', event => { if(event.level==='error')errors.push(event.message); });
    for (const theme of ['dark', 'light']) {
      await open({theme});
      const layout = await evaluate(`(() => {
        const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
        const style=getComputedStyle(document.querySelector('.reading-body'));
        return {review:box('.review'),terminal:box('.terminal'),body:box('.reading-body'),action:box('#prepare'),sidebar:box('.sidebar'),font:style.fontSize,line:style.lineHeight,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.equal(layout.sidebar.width,220);
      assert.equal(layout.terminal.width,344);
      assert(layout.body.width>=640 && layout.body.width<=720);
      assert.equal(layout.font,'15px');assert.equal(layout.line,'27px');
      assert(layout.action.bottom<=layout.review.bottom,'recommended action visible on first screen');
      assert(await evaluate('document.querySelector("summary").getBoundingClientRect().bottom <= document.querySelector(".review").getBoundingClientRect().bottom'),'detail disclosure visible on first screen');
      assert.equal(layout.overflow,false);
      // Show the updated input-focused dock in both requested screenshots.
      await key('x','x');
      await checkDockInput();
      assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'x');
      await evaluate('document.querySelector("#terminal-input").select()');
      await win.webContents.insertText('문서 본문을 확인해 주세요.');
      await shot(`${theme}.png`);
      console.log(`${theme}: ${JSON.stringify(layout)}`);
    }
    await open({theme:'dark',state:'analyzing'});
    await delay(230);
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'terminal');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".loading-body")).display'),'block');
    await evaluate(`document.querySelector('[data-theme-choice="dark"]').click()`);
    await shot('analyzing-dark.png');
    await evaluate(`document.querySelector('[data-scenario="arrived"]').click()`);
    await delay(230);
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'reading');
    await evaluate(`document.querySelector('#terminal-content').click()`);
    await checkDockInput();
    const readingGeometry=await evaluate('JSON.stringify([".review",".terminal"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]}))');
    // Native first printable key from an unfocused page routes to the same dock.
    await evaluate('document.activeElement.blur()');
    await key('x','x');
    await checkDockInput();
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'x');
    assert.equal(await evaluate('JSON.stringify([".review",".terminal"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]}))'),readingGeometry);
    await evaluate('document.activeElement.blur()');
    await key('Backspace');
    await checkDockInput();
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'');
    await evaluate('document.activeElement.blur()');
    await key('Enter','\r');
    await checkDockInput();
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'\n');
    await evaluate(`document.querySelector('#terminal-input').value='x';document.querySelector('#expand').click()`);
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'terminal');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'Period',key:'.',ctrlKey:true,bubbles:true}))`);
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'reading');
    assert.equal(await evaluate('document.documentElement.dataset.read'),'true');
    await evaluate(`document.querySelector('#prepare').click()`);
    await checkDockInput();
    assert.match(await evaluate('document.querySelector("#terminal-input").value'),/^x\n\n생성된 문서/);
    assert.equal(await evaluate('document.querySelector("#draft-notice").hidden'),false);
    // Keep native Tab/Shift+Tab order and protect controls, explicitly focused
    // analysis text, links, editable content, selection, and unrelated shortcuts.
    await evaluate('document.querySelector("#prepare").focus()');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".dock-input-status")).display'),'none');
    const draft=await evaluate('document.querySelector("#terminal-input").value');
    await key('x','x');
    assert.equal(await evaluate('document.activeElement.id'),'prepare');
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),draft);
    await key('Tab');
    assert.equal(await evaluate('document.activeElement.tagName'),'SUMMARY');
    await key('Tab');assert.equal(await evaluate('document.activeElement.id'),'expand');
    await key('Tab');await checkDockInput();
    await key('Tab',undefined,['shift']);assert.equal(await evaluate('document.activeElement.id'),'expand');
    await evaluate(`(() => {const a=document.createElement('a');a.id='test-link';a.href='#answer';a.textContent='근거';document.querySelector('#answer').append(a);a.focus()})()`);
    await key('x','x');assert.equal(await evaluate('document.activeElement.id'),'test-link');
    await evaluate(`document.querySelector('#test-link').remove();document.querySelector('#answer').tabIndex=0;document.querySelector('#answer').focus()`);
    await key('x','x');assert.equal(await evaluate('document.activeElement.id'),'answer');
    await evaluate(`document.querySelector('#answer').removeAttribute('tabindex');document.activeElement.blur();const r=document.createRange();r.selectNodeContents(document.querySelector('h1'));getSelection().removeAllRanges();getSelection().addRange(r)`);
    assert.equal(await evaluate('getSelection().isCollapsed'),false);
    await key('x','x');assert.notEqual(await evaluate('document.activeElement.id'),'terminal-input');
    await evaluate(`getSelection().removeAllRanges();document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);
    assert.notEqual(await evaluate('document.activeElement.id'),'terminal-input');
    await evaluate(`(() => {const el=document.createElement('div');el.id='test-editable';el.contentEditable='true';document.querySelector('#answer').append(el);el.focus()})()`);
    await key('x','x');assert.equal(await evaluate('document.activeElement.id'),'test-editable');
    assert.equal(await evaluate('document.querySelector("#test-editable").textContent'),'x');
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),draft);
    await evaluate(`document.querySelector('#test-editable').remove()`);
    await open({theme:'dark',count:'3',state:'analyzing'});
    assert.equal(await evaluate('[...document.querySelectorAll(".pane")].filter(el=>getComputedStyle(el).display!=="none").length'),3);
    await shot('grid-three-dark.png');
    await evaluate(`document.querySelector('[data-scenario="arrived"]').click()`);
    await delay(230);
    assert.equal(await evaluate('[...document.querySelectorAll(".pane")].filter(el=>getComputedStyle(el).display!=="none").length'),1);
    assert.equal(await evaluate('[...document.querySelectorAll(".other-terminals button")].filter(el=>getComputedStyle(el).display!=="none").length'),2);
    await evaluate(`document.querySelector('.other-terminals [data-open-terminal="THREE_ONLY"]').click()`);
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'reading');
    await evaluate(`document.querySelector('#expand').click();document.querySelector('.tree [data-open-terminal="THREE_ONLY"]').click()`);
    assert.equal(await evaluate('document.activeElement.id'),'input-three');
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'terminal');
    // Composition that starts on a non-editor: preserve intermediate text and
    // commit once, without replacing the editor or leaving reading mode.
    await open({theme:'dark'});
    await evaluate(`document.body.dispatchEvent(new CompositionEvent('compositionstart',{data:'',bubbles:true}));document.body.dispatchEvent(new CompositionEvent('compositionupdate',{data:'ㅎ',bubbles:true}))`);
    await checkDockInput();
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'ㅎ');
    await evaluate(`document.body.dispatchEvent(new CompositionEvent('compositionupdate',{data:'한글',bubbles:true}));document.body.dispatchEvent(new CompositionEvent('compositionend',{data:'한글',bubbles:true}))`);
    await checkDockInput();
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'한글');
    await evaluate(`document.querySelector('#terminal-input').blur();document.body.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.body.dispatchEvent(new CompositionEvent('compositionupdate',{data:'취소',bubbles:true}));document.body.dispatchEvent(new CompositionEvent('compositionend',{data:'',bubbles:true}))`);
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'한글');
    // Native Chromium IME preedit after the real Process/229 key route. This
    // exercises the browser composition engine, not an operating-system IME.
    await open({theme:'dark'});
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Process',code:'KeyG',windowsVirtualKeyCode:229});
    await checkDockInput();
    await win.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'ㅎ');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'한글',selectionStart:2,selectionEnd:2});
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'한글');
    await win.webContents.debugger.sendCommand('Input.insertText',{text:'한글'});
    await checkDockInput();
    assert.equal(await evaluate('document.querySelector("#terminal-input").value'),'한글');
    // Result arriving while actively composing stays in terminal mode.
    await open({theme:'dark',state:'analyzing'});
    await evaluate(`(() => {const el=document.querySelector('#terminal-input');el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('[data-scenario="arrived"]').click();})()`);
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'terminal');
    await evaluate(`document.querySelector('#terminal-input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
    assert.equal(await evaluate('document.documentElement.dataset.mode'),'terminal');
    await open({theme:'dark'});
    await evaluate(`document.querySelector('details').open=true`);
    assert.equal(await evaluate('document.querySelector("details").open'),true);
    // Native Chromium emulation for reduced-motion and color-scheme.
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`document.querySelector('#mode-toggle').click()`);
    assert.equal(await evaluate('document.getAnimations().length'),0);
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
    nativeTheme.themeSource='light';await open();
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--wb-bg").trim()'),'#fbfcfd');
    nativeTheme.themeSource='dark';await open();
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--wb-bg").trim()'),'#13161a');
    await evaluate(`document.querySelector('[data-theme-choice="light"]').click()`);
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--wb-bg").trim()'),'#fbfcfd');
    for(const width of [1100,900,700]) {
      win.setContentSize(width,900);await open({theme:'light'});
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`overflow at ${width}`);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: reading mode retained for dock click, native printable/Backspace/Enter, synthetic and Chromium IME; focused accent/status; controls/selection/Tab preserved; explicit return, draft preservation, grid restore, themes, reduced motion and responsive widths.');
    clearTimeout(deadline);
    win.destroy();
    app.quit();
  } catch(error) {
    console.error(error);clearTimeout(deadline);if(win&&!win.isDestroyed())win.destroy();app.exit(1);
  }
});
// Only remove this harness's disposable Chromium profile during normal shutdown.
app.on('will-quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}});
