const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
let server;
let window;
let pageUrl;

app.setPath("userData", path.join(os.tmpdir(), `whitebox-sketch-011-${process.pid}`));
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
      pageUrl = `http://127.0.0.1:${server.address().port}/.planning/sketches/011-comprehension-remediation-flow/index.html`;
      resolve();
    });
  });
}

async function load(width = 1440, height = 900) {
  if (!window) window = new BrowserWindow({ width, height, show: false, backgroundColor: "#030609", webPreferences: { backgroundThrottling: false } });
  window.setSize(width, height);
  await window.loadURL(pageUrl);
  await new Promise(resolve => setTimeout(resolve, 160));
}

async function prepareReview(flow) {
  await window.reload();
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-flow-choice="${flow}"]').click();
    document.querySelector('input[name="q1"][value="a"]').click();
    document.querySelector('input[name="q2"][value="a"]').click();
    document.querySelector('input[name="q3"][value="a"]').click();
    document.getElementById('quiz').requestSubmit();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 140));
}

async function capture(filename) {
  await window.webContents.executeJavaScript(`document.getElementById('toast').classList.remove('show')`);
  window.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 90));
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, filename), image.toPNG());
}

async function verifyModes() {
  const selectors = { a: ".review-root.mode-a", b: ".review-desk", c: ".morph-grid" };
  for (const flow of Object.keys(selectors)) {
    await prepareReview(flow);
    const result = await window.webContents.executeJavaScript(`(() => ({
      flow: document.body.dataset.flow,
      hasMode: Boolean(document.querySelector('${selectors[flow]}')),
      wrongCount: document.getElementById('count').textContent,
      reviewCards: document.querySelectorAll('[data-review]').length
    }))()`);
    if (result.flow !== flow || !result.hasMode || result.wrongCount !== "오답 2" || result.reviewCards !== 2) {
      throw new Error(`011 mode verification failed: ${JSON.stringify(result)}`);
    }
  }
}

async function verifyRemediation() {
  await prepareReview("c");
  const result = await window.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('[data-review]')];
    const q1 = cards.find(card => card.dataset.review === 'q1');
    q1.querySelector('input[name="v-q1"][value="c"]').click();
    q1.querySelector('[data-variant-submit]').click();
    const q3 = cards.find(card => card.dataset.review === 'q3');
    q3.querySelector('input[name="v-q3"][value="b"]').click();
    q3.querySelector('[data-variant-submit]').click();
    const stillDebt = document.getElementById('score').textContent.includes('재확인 1개 남음');
    q3.querySelector('[data-understood]').click();
    const finalScore = document.getElementById('score').textContent.includes('최종 2/3');
    document.getElementById('close').click();
    const badgeVisible = !document.getElementById('badge').classList.contains('hidden');
    document.getElementById('reopen').click();
    return { stillDebt, finalScore, badgeVisible, reopened: !document.getElementById('overlay').classList.contains('hidden') };
  })()`);
  if (Object.values(result).some(value => !value)) throw new Error(`011 remediation verification failed: ${JSON.stringify(result)}`);
}

async function verifyIssueExclusion() {
  await window.reload();
  const result = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-issue="q3"]').click();
    document.querySelector('input[name="q1"][value="b"]').click();
    document.querySelector('input[name="q2"][value="a"]').click();
    document.getElementById('quiz').requestSubmit();
    return { count: document.getElementById('count').textContent, score: document.getElementById('score').textContent };
  })()`);
  if (!result.score.includes("최종 2/2")) throw new Error(`011 issue exclusion failed: ${JSON.stringify(result)}`);
}

async function verifyMobile() {
  window.setSize(390, 844);
  await prepareReview("c");
  const result = await window.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('.dialog').getBoundingClientRect();
    return { innerWidth, scrollWidth: document.documentElement.scrollWidth, cards: document.querySelectorAll('[data-review]').length, visible: dialog.width > 300 && dialog.height > 500 };
  })()`);
  if (result.scrollWidth > result.innerWidth || result.cards !== 2 || !result.visible) throw new Error(`011 mobile verification failed: ${JSON.stringify(result)}`);
}

app.whenReady().then(async () => {
  await startServer();
  await load();
  for (const [flow, filename] of [["a", "variant-a-inline-expansion.png"], ["b", "variant-b-review-desk.png"], ["c", "variant-c-card-morph.png"]]) {
    await prepareReview(flow);
    await capture(filename);
  }
  await verifyModes();
  await verifyRemediation();
  await verifyIssueExclusion();
  await verifyMobile();
  await capture("mobile-card-morph.png");
  window.destroy();
  server.close();
  app.quit();
}).catch(error => {
  console.error(error);
  if (server) server.close();
  app.exit(1);
});
