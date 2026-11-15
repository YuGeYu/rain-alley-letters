// Exercise the real packaged client, using only an isolated profile and public reads.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const qa = path.resolve(__dirname, '../.work/xcmusic-native-qa');
async function run() {
  const session = JSON.parse(fs.readFileSync(path.join(qa, 'session.json')));
  const target = (await (await fetch(`http://127.0.0.1:${session.port}/json/list`)).json()).find(t => t.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const cdp = connectCdp(socket), report = {};
  try {
    await cdp.evaluate('void(window.__qaGlobals=document.querySelector("#app").__vue_app__.config.globalProperties)');
    await cdp.evaluate('window.__qaGlobals.$router.push("/search/陈奕迅/song")');
    await waitFor(cdp, 'document.body.innerText.includes("十年") || document.body.innerText.includes("孤勇者")', 'Public search did not render real tracks', 45000);
    report.searchText = await cdp.evaluate('document.body.innerText.slice(0,2300)');
    let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(qa, 'search.png'), Buffer.from(shot.data, 'base64'));
    // A quiet generated WAV avoids depending on music rights for playback verification.
    const dir = path.join(session.base, 'music'); fs.mkdirSync(dir, { recursive: true });
    const sampleRate = 22050, seconds = 8, wav = Buffer.alloc(44 + sampleRate * seconds * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < sampleRate * seconds; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / sampleRate) * 150), 44 + i * 2);
    fs.writeFileSync(path.join(dir, '雨巷音频验收.wav'), wav);
    report.localScan = await cdp.evaluate(`window.electron.ipcRenderer.invoke('get-local-tracks', ${JSON.stringify(dir)})`);
    assert.equal(report.localScan.length, 1); assert.ok(report.localScan[0].duration >= 7.9);
    await cdp.evaluate(`window.__qaGlobals.$store.state.setting.download.localPaths=[${JSON.stringify(dir)}];window.__qaGlobals.$router.push('/local')`);
    await waitFor(cdp, 'document.body.innerText.includes("雨巷音频验收.wav")', 'Local music scan did not render');
    await cdp.evaluate(`(() => {
      const p=window.__qaGlobals.$store.state.player;
      const track={id:'qa_local_track',name:'雨巷音频验收.wav',al:{id:'qa_local_album',name:'本地音频验收',picUrl:''},ar:[{id:'qa_local_artist',name:'本地验收'}],dt:8000,pop:0,localPath:${JSON.stringify(path.join(dir, '雨巷音频验收.wav'))}};
      p.volume=0.08; return p.playTrack(track);
    })()`);
    await waitFor(cdp, 'window.__qaGlobals.$store.state.player._audio.currentTime>0.7', 'Audio playback clock did not advance');
    report.playback = await cdp.evaluate('(()=>{const p=window.__qaGlobals.$store.state.player;const r={time:p._audio.currentTime,duration:p._audio.duration,paused:p._audio.paused,source:p._audio.src,audioContext:p._audioContext?.state};p.playState="pause";return r})()');
    assert.equal(report.playback.paused, false);
    report.paused = await cdp.evaluate('window.__qaGlobals.$store.state.player._audio.paused');
    assert.equal(report.paused, true);
    await cdp.evaluate('window.desktopStorage.setItem("rainalley.qa",JSON.stringify({verified:true}))');
    report.diskState = JSON.parse(fs.readFileSync(path.join(session.profile, 'desktop-state.json')));
    assert.equal(JSON.parse(report.diskState['rainalley.qa']).verified, true);
    delete report.diskState;
    report.desktopPersistence = true;
    shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(qa, 'local-playback.png'), Buffer.from(shot.data, 'base64'));
    await cdp.send('Page.reload');
    await waitFor(cdp, 'window.desktopStorage && document.querySelector("#app")?.innerText.length>30', 'Reload failed');
    assert.equal(await cdp.evaluate('JSON.parse(window.desktopStorage.getItem("rainalley.qa")).verified'), true);
    report.reloadPersistence = true;
    await cdp.evaluate('document.querySelector("#app").__vue_app__.config.globalProperties.$router.push("/search/陈奕迅/song")');
    fs.writeFileSync(path.join(qa, 'checks.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { socket.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
