const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
async function run() {
  const port = Number(process.argv[2]);
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const target = targets.find(item => item.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const cdp = connectCdp(socket);
  const out = path.resolve(__dirname, '../.work/resource-policy-preview');
  fs.mkdirSync(out, { recursive: true });
  try {
    await cdp.send('Page.reload');
    await waitFor(cdp, "document.body.dataset.page==='scene'", 'Preview did not reload');
    for (const [id, selector] of [['bilidesk', '[data-bili="download"]'], ['xcmusic', '[data-xcm="download"]'], ['cs2-inventory', '#inventoryRuntimeDownload'], ['cs2-demo', '#demoRuntimeDownload']]) {
      await cdp.evaluate(`document.querySelector('#appAddressInput').value=${JSON.stringify('rainalley://app/feature/' + id)};document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
      await waitFor(cdp, `!!document.querySelector(${JSON.stringify(selector)})`, id + ' download control missing');
      assert.match(await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`), /夸克/);
      await new Promise(resolve => setTimeout(resolve, 400));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, id + '.png'), Buffer.from(shot.data, 'base64'));
    }
    await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/bilidesk';document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    console.log('PASS: all four resource download controls render in the native Electron preview; screenshots at ' + out);
  } finally { socket.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
