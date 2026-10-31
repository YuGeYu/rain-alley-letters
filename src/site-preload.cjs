'use strict';
const { ipcRenderer } = require('electron');
if (!process.isMainFrame) return;

let linkSwiftEnabled = false;
ipcRenderer.on('site:linkswift-enabled', () => { linkSwiftEnabled = true; });
ipcRenderer.on('site:linkswift-disabled', () => { linkSwiftEnabled = false; });
ipcRenderer.on('site:linkswift-storage-sync', (_event, message = {}) => {
  if (!linkSwiftEnabled || !message || !['set', 'delete'].includes(message.action) || typeof message.key !== 'string') return;
  window.postMessage({ __rainAlleyLinkSwiftStorageSync: true, action: message.action, key: message.key, value: message.value }, '*');
});

window.addEventListener('message', (event) => {
  const data = event?.data;
  if (data?.__rainAlleyLinkSwiftRequest !== true || !Number.isInteger(data.id)) return;
  if (!linkSwiftEnabled) return;
  ipcRenderer.invoke('site:netdisk-request', { id: data.id, options: data.options || {} })
    .then((result) => window.postMessage({ __rainAlleyLinkSwiftResponse: true, id: data.id, ok: true, result }, '*'))
    .catch((error) => window.postMessage({ __rainAlleyLinkSwiftResponse: true, id: data.id, ok: false, error: String(error?.message || error) }, '*'));
  event.stopImmediatePropagation();
}, true);
window.addEventListener('message', (event) => {
  const data = event?.data;
  if (data?.__rainAlleyLinkSwiftAbort === true && Number.isSafeInteger(data.id)) {
    if (linkSwiftEnabled) ipcRenderer.send('site:netdisk-abort', data.id);
    event.stopImmediatePropagation();
    return;
  }
  if (data?.__rainAlleyLinkSwiftStorage === true && ['set', 'delete'].includes(data.action) && typeof data.key === 'string' && data.key.length <= 160) {
    if (linkSwiftEnabled) ipcRenderer.send('site:linkswift-storage', { action: data.action, key: data.key, value: data.value });
    event.stopImmediatePropagation();
    return;
  }
  if (data?.__rainAlleyLinkSwiftClipboard !== true) return;
  if (!linkSwiftEnabled) return;
  ipcRenderer.invoke('site:clipboard', String(data.value || '')).catch(() => {});
  event.stopImmediatePropagation();
}, true);
