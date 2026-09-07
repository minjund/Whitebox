const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
let server;
let window;
let pageUrl;

app.setPath("userData", path.join(os.tmpdir(), `whitebox-sketch-010-${process.pid}`));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const requested = path.resolve(workspaceRoot, `.${pathname}`);
      if (!requested.startsWith(workspaceRoot) || !fs.existsSync(requested)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
      response.writeHead(200, { "Content-Type": types[path.extname(requested)] || "application/octet-stream" });
      fs.createReadStream(requested).pipe(response);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      pageUrl = `http://127.0.0.1:${server.address().port}/.planning/sketches/010-comprehension-packet-placement/index.html`;
      resolve();
    });
  });
}

async function load(width = 1440, height = 900) {
  if (!window) window = new BrowserWindow({ width, height, show: false, backgroundColor: "#030609", webPreferences: { backgroundThrottling: false } });
  window.setSize(width, height);
  await window.loadURL(pageUrl);
  await new Promise(resolve => setTimeout(resolve, 180));
}

async function capture(filename) {
  await window.webContents.executeJavaScript(`document.getElementById('toast').classList.remove('show')`);
  window.webContents.invalidate();
  await window.webContents.capturePage();
  await new Promise(resolve => setTimeout(resolve, 180));
  window.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 100));
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, filename), image.toPNG());
}

async function selectPlacement(placement) {
  await window.webContents.executeJavaScript(`new Promise(resolve => {
    document.querySelector('[data-variant="${placement}"]').click();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
  await new Promise(resolve => setTimeout(resolve, 220));
  const selected = await window.webContents.executeJavaScript(`({ placement: document.body.dataset.placement, active: document.querySelector('[data-variant].active')?.dataset.variant })`);
  if (selected.placement !== placement || selected.active !== placement) throw new Error(`010 placement switch failed: ${JSON.stringify(selected)}`);
}

async function verifyFlow() {
  const result = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('input[name="q1"][value="b"]').click();
    document.querySelector('input[name="q2"][value="b"]').click();
    document.querySelector('input[name="q3"][value="d"]').click();
    document.getElementById('quizForm').requestSubmit();
    const wrongOnly = document.getElementById('questionCount').textContent === '오답 1문항'
      && document.querySelectorAll('[data-question]').length === 1;
    document.querySelector('input[name="variant-q2"][value="b"]').click();
    document.querySelector('[data-variant-submit]').click();
    const finalScore = document.getElementById('score').textContent.includes('최종 3/3');
    document.getElementById('closePacket').click();
    const debtBadge = !document.getElementById('packetBadge').classList.contains('hidden');
    document.getElementById('reopenPacket').click();
    const reopened = !document.getElementById('packetLayer').classList.contains('hidden');
    document.getElementById('resetDemo').click();
    document.querySelector('[data-issue="q3"]').click();
    const issueExcluded = document.getElementById('questionCount').textContent === '2문항';
    document.getElementById('resetDemo').click();
    document.querySelector('input[name="q1"][value="a"]').click();
    document.querySelector('input[name="q2"][value="a"]').click();
    document.querySelector('input[name="q3"][value="d"]').click();
    document.getElementById('quizForm').requestSubmit();
    document.querySelector('input[name="variant-q1"][value="a"]').click();
    document.querySelector('[data-variant-submit]').click();
    const rewrongKeepsDebt = document.getElementById('score').textContent.includes('재확인 1개 남음');
    document.querySelector('[data-understood]').click();
    const understoodKeepsWrongScore = document.getElementById('score').textContent.includes('최종 2/3');
    document.getElementById('resetDemo').click();
    document.getElementById('closePacket').click();
    const unresolvedCloseCreatesDebt = document.getElementById('badgeText').textContent.includes('이해 부채');
    return { wrongOnly, finalScore, debtBadge, reopened, issueExcluded, rewrongKeepsDebt, understoodKeepsWrongScore, unresolvedCloseCreatesDebt };
  })()`);
  if (Object.values(result).some(value => !value)) throw new Error(`010 interaction verification failed: ${JSON.stringify(result)}`);
}

async function verifyMobile() {
  window.setSize(390, 844);
  await window.reload();
  await selectPlacement("c");
  const result = await window.webContents.executeJavaScript(`(() => {
    const dialog = document.getElementById('packetDialog').getBoundingClientRect();
    return {
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      placement: document.body.dataset.placement,
      dialogLeft: Math.round(dialog.left),
      dialogRight: Math.round(dialog.right),
      dialogVisible: dialog.width > 300 && dialog.height > 500
    };
  })()`);
  if (result.scrollWidth > result.innerWidth || result.placement !== "c" || !result.dialogVisible) {
    throw new Error(`010 mobile verification failed: ${JSON.stringify(result)}`);
  }
}

app.whenReady().then(async () => {
  await startServer();
  await load();
  for (const [placement, filename] of [["a", "variant-a-centered.png"], ["b", "variant-b-right-sheet.png"], ["c", "variant-c-bottom-sheet.png"]]) {
    await selectPlacement(placement);
    await capture(filename);
  }
  await verifyFlow();
  await verifyMobile();
  await capture("mobile-bottom-sheet.png");
  window.destroy();
  server.close();
  app.quit();
}).catch(error => {
  console.error(error);
  if (server) server.close();
  app.exit(1);
});
