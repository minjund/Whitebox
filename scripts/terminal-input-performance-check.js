'use strict';
// Run with: electron scripts/terminal-input-performance-check.js
// For a baseline, run this same harness in the unmodified baseline checkout
// with WHITEBOX_PERF_BASELINE=1. That flag only disables fast-path assertions.
// Dispatch measures the renderer input queue reaching a fake IPC adapter under
// stalled animation frames, not end-to-end keyboard/PTY/display latency.
// Screen reads use the real pinned Ghostty WASM with 16 populated terminals.

const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'whitebox-input-performance-'));
app.setPath('userData',profile);app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const deadline=setTimeout(()=>app.exit(1),90000);
 const win=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{offscreen:true,contextIsolation:true,backgroundThrottling:false}});
 try{
  const files=['renderer/terminal-engine.js','renderer/terminal-ime.js','renderer/terminal-workbench.js','src/terminalReviewTurns.js'];
  const url=file=>pathToFileURL(path.join(root,file)).href;
  const csp=fs.readFileSync(path.join(root,'renderer/index.html'),'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
  const html=path.join(profile,'fixture.html');
  fs.writeFileSync(html,'<!doctype html><meta charset="utf-8">'+csp+`<link rel="stylesheet" href="${url('renderer/styles-terminal-engine.css')}"><div id="terminalRuntimeMount" style="height:500px;width:900px"></div>`+files.map(file=>`<script src="${url(file)}"></script>`).join(''));
  await win.loadFile(html);
  const result=await win.webContents.executeJavaScript(`(async()=>{
   await WhiteboxTerminalEngine.ready();
   window.WhiteboxI18n={t:key=>key};window.WhiteboxRendererUtils={reportRecoverableError:(_scope,error)=>{throw error}};
   const writes=[];window.whitebox={terminalGet:async()=>({replay:'',outputSequence:0}),terminalResize:async()=>{},terminalWrite:async(id,data)=>{writes.push({id,data,at:performance.now()});return {deliveryState:'accepted'}}};
   const state={terminals:new Map(),sessions:[],selectedId:'input',platform:{id:'darwin'}};
   const bench=WhiteboxTerminalWorkbench({$:selector=>document.querySelector(selector),state,notice:message=>{throw Error(message)},xtermOptions:()=>({...WhiteboxTerminalEngine.workspaceOptions(14),cols:100,rows:24})});
   const entry=await bench.ensureSessionTerminal({id:'input',type:'shell'});entry.host.classList.remove('hidden');
   const views=[entry.terminal];
   for(let i=1;i<16;i++){const host=document.createElement('div');host.style.display='none';document.body.append(host);views.push(WhiteboxTerminalEngine.createView(host,{...WhiteboxTerminalEngine.workspaceOptions(14),cols:100,rows:24,screenReaderMode:false}).terminal)}
   const output=Array.from({length:700},(_,i)=>'line-'+i+' 한글 😀 é '+('sample text '.repeat(5))).join('\\r\\n')+'\\r\\nLAST_MARKER';
   for(const term of views)term.write(output);
   const readiness=WhiteboxTerminalReviewTurns.readinessText;
   const snapshot=term=>{if(term.readTextSnapshot)return term.readTextSnapshot(readiness);const buffer=term.buffer.active;const lines=[];for(let r=Math.max(0,buffer.length-400);r<buffer.length;r++)lines.push(buffer.getLine(r)?.translateToString(true)||'');return {text:lines.join('\\n').slice(-24000),readinessText:readiness(buffer)}};
   const costs=[];let correct=true;
   for(let i=0;i<5;i++){const start=performance.now();for(const term of views)correct&&=snapshot(term).text.includes('LAST_MARKER');costs.push(performance.now()-start);await new Promise(r=>setTimeout(r,0))}
   const active=views[0];
   const referenceBuffer=active.buffer.active,referenceRows=[];
   for(let row=Math.max(0,referenceBuffer.length-400);row<referenceBuffer.length;row++)referenceRows.push(referenceBuffer.getLine(row)?.translateToString(true)||'');
   const equivalent=snapshot(active).text===referenceRows.join('\\n').slice(-24000)&&snapshot(active).readinessText===readiness(referenceBuffer);
   let lineReads=0;const original=active.getBufferLine.bind(active);active.getBufferLine=(...args)=>{lineReads++;return original(...args)};
   snapshot(active);const priorReads=lineReads;snapshot(active);const unchangedReads=lineReads-priorReads;
   active.write(' FRESH_MARKER');const changed=snapshot(active).text.includes('FRESH_MARKER');
   active.reset();const reset=!snapshot(active).text.includes('FRESH_MARKER');
   active.write('NORMAL');active.write('\\x1b[?1049hALTERNATE');const alt=snapshot(active).text.includes('ALTERNATE');active.write('\\x1b[?1049l');const normal=snapshot(active).text.includes('NORMAL');
   const beforeResizeReads=lineReads;active.resize(70,30);const resized=snapshot(active).text.includes('NORMAL')&&lineReads>beforeResizeReads;
   const nativeFrame=window.requestAnimationFrame;let frames=0;window.requestAnimationFrame=()=>1;
   const times=[];
   for(let i=0;i<12;i++){const n=writes.length,start=performance.now();entry.terminal.input('x');if(entry.inputPumpFrame)frames++;while(writes.length===n)await new Promise(r=>setTimeout(r,1));times.push(writes[n].at-start);await entry.writeQueue}
   window.requestAnimationFrame=nativeFrame;
   const sorted=[...times].sort((a,b)=>a-b);for(const term of views)term.dispose();
   return {terminals:views.length,scanMs:costs,inputDispatchMs:times,inputP95Ms:sorted[Math.ceil(sorted.length*.95)-1],inputFrames:frames,unchangedReads,correct,equivalent,changed,reset,alt,normal,resized,delivered:writes.map(w=>w.data).join('')};
  })()`,true);
  assert(result.correct&&result.equivalent&&result.changed&&result.reset&&result.alt&&result.normal&&result.resized,JSON.stringify(result));
  assert.equal(result.delivered,'x'.repeat(12));
  if(process.env.WHITEBOX_PERF_BASELINE!=='1'){assert.equal(result.inputFrames,0,'Input waited for a paint');assert.equal(result.unchangedReads,0,'Unchanged snapshot rescanned WASM');}
  const out=path.join(root,'artifacts/performance');fs.mkdirSync(out,{recursive:true});
  const label=process.env.WHITEBOX_PERF_BASELINE==='1'?'before':'after';fs.writeFileSync(path.join(out,'terminal-input-'+label+'.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));clearTimeout(deadline);win.destroy();app.exit(0);
 }catch(error){console.error(error);clearTimeout(deadline);win.destroy();app.exit(1)}
});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
