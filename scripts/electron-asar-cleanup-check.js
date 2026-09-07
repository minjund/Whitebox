'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

if (process.argv[2] === '--child') {
  require('../src/macUpdateHelper').removePath(process.argv[3]).catch(error => {console.error(error);process.exitCode=1;});
} else {
  (async () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'whitebox-asar-cleanup-'));
    try {
      const source=path.join(root,'source');fs.mkdirSync(source);
      fs.writeFileSync(path.join(source,'package.json'),'{"version":"1.0.0"}');
      const bundle=path.join(root,'Whitebox.app');const resources=path.join(bundle,'Contents','Resources');
      fs.mkdirSync(resources,{recursive:true});
      await require('@electron/asar').createPackage(source,path.join(resources,'app.asar'));
      const result=spawnSync(require('electron'),[__filename,'--child',bundle],{
        env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000,
      });
      assert.equal(result.status,0,result.stderr || String(result.error || result.signal));
      assert.equal(fs.existsSync(bundle),false,'Physical app.asar and its bundle must both be removed');
      console.log('PASS Electron Node-mode cleanup of a real app.asar bundle');
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
