'use strict';
// Uses the repository's existing Electron capturePage approach; no packages installed.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(app.getPath('temp'), 'whitebox-inline-card-' + process.pid));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width:1440, height:900, useContentSize:true, show:false, webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
  const errors = [];
  win.webContents.on('console-message', event => { if(event.level === 'error') errors.push(event.message); });
  const js = source => win.webContents.executeJavaScript(source);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const visible = id => js(`!document.getElementById(${JSON.stringify(id)}).hidden`);
  await win.loadFile(path.join(__dirname,'index.html'));
  win.show();win.focus();
  await delay(350);
  const metrics = await js(`(() => { const card=document.getElementById('card-one'),pane=document.getElementById('pane-one'),title=document.getElementById('conclusion-one');return {viewport:[innerWidth,innerHeight],cardHeight:card.offsetHeight,paneHeight:pane.clientHeight,cardWidth:card.offsetWidth,paneWidth:pane.clientWidth,titleHeight:title.clientHeight,titleLineHeight:parseFloat(getComputedStyle(title).lineHeight),cardOverflow:card.scrollHeight>card.clientHeight,pageOverflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.deepEqual(metrics.viewport,[1440,900]);
  assert.ok(metrics.cardHeight <= metrics.paneHeight * .4 + 1);
  assert.equal(metrics.cardWidth,metrics.paneWidth);
  assert.ok(Math.abs(metrics.titleHeight-metrics.titleLineHeight)<1,'Conclusion is one line at 1440×900');
  assert.equal(metrics.cardOverflow,false);
  assert.equal(metrics.pageOverflow,false);
  assert.equal(await visible('card-one'),true);
  assert.equal(await visible('card-two'),false);
  for(const theme of ['dark','light']){
    await click(`[data-theme-choice="${theme}"]`);
    await delay(150);
    fs.writeFileSync(path.join(__dirname,theme+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  // Native keyboard events verify Esc and a first typed character without losing it.
  await js(`document.getElementById('input-one').focus()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await delay(50);
  assert.equal(await visible('card-one'),false);
  assert.equal(await visible('chip-one'),true);
  await click('#chip-one');
  assert.equal(await visible('card-one'),true);
  await js(`document.getElementById('input-one').focus()`);
  win.webContents.sendInputEvent({type:'char',keyCode:'a'});
  await delay(50);
  assert.equal(await visible('card-one'),false);
  assert.equal(await js(`document.getElementById('input-one').value`),'a');
  await click('[data-scene="arrived"]');
  await click('[data-details="one"]');
  assert.equal(await visible('review'),true);
  assert.match(await js(`document.getElementById('reviewBody').innerText`),/문서 생성은 보고됐지만/);
  await click('#closeReview');
  assert.equal(await js(`document.activeElement.dataset.details`),'one');
  await click('[data-draft="one"]');
  assert.equal(await js(`document.getElementById('draftDialog').open`),true);
  assert.match(await js(`document.getElementById('draftText').value`),/본문을 읽고/);
  await click('#closeDraft');
  await delay(60);
  await click('[data-scene="analyzing"]');
  assert.equal(await visible('card-one'),false);
  assert.equal(await visible('card-two'),false);
  assert.match(await js(`document.getElementById('state-one').innerText`),/분석 중/);
  // Result arriving while typing stays collapsed and unread, without interrupting focus.
  await js(`document.getElementById('input-two').focus()`);
  assert.equal(await js(`document.getElementById('selectedStatus').textContent`),'TWO_ONLY 선택됨');
  await click('#backgroundDemo');
  assert.equal(await visible('card-one'),false);
  assert.equal(await visible('chip-one'),true);
  assert.equal(await js(`document.querySelectorAll('.toast').length`),1);
  await click('.toast-main');
  assert.equal(await visible('card-one'),true);
  assert.equal(await js(`document.getElementById('pane-one').classList.contains('selected')`),true);
  assert.equal(await js(`document.querySelectorAll('.toast').length`),0);
  // Two background arrivals stack. Dismissing a toast retains its result chip.
  await js(`document.getElementById('input-two').focus()`);
  await click('#backgroundDemo');
  await js(`document.getElementById('input-one').focus()`);
  await click('#backgroundDemo');
  assert.equal(await js(`document.querySelectorAll('.toast').length`),2);
  await click('.toast .icon-btn');
  assert.equal(await js(`document.querySelectorAll('.toast').length`),1);
  assert.equal(await visible('chip-one'),true);
  // System theme follows native preference.
  await click('[data-theme-choice="system"]');
  for(const theme of ['dark','light']){
    nativeTheme.themeSource=theme;
    await delay(70);
    assert.equal(await js(`getComputedStyle(document.documentElement).colorScheme`),theme);
  }
  // Check a smaller desktop and overflow while detail is open.
  win.setContentSize(1100,900);
  await delay(60);
  await click('[data-scene="arrived"]');
  await click('[data-details="one"]');
  assert.equal(await js(`document.documentElement.scrollWidth>innerWidth`),false);
  await click('#closeReview');
  const narrow = await js(`(() => {const c=document.getElementById('card-one'),p=document.getElementById('pane-one');return {card:c.offsetHeight,pane:p.clientHeight,overflow:c.scrollHeight>c.clientHeight};})()`);
  assert.ok(narrow.card<=narrow.pane*.4+1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',metrics,narrow,checks:['default two-pane arrival','dark/light capture','40% height and full width','single-line conclusion','native Esc','native typing retains first character','result chip reopen','detail and focus return','draft only','analysis state','background toast selection','toast stacking and dismiss','system theme','1100px overflow','no console errors']},null,2));
  win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
