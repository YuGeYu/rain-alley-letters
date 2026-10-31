// Custom protocols are handed to the OS only after a shell confirmation.
function externalProtocol(value, enabled) {
  if (!enabled) throw new Error('外部应用跳转默认关闭，请在设置中开启“允许任意外部应用协议”。');
  if (typeof value !== 'string' || value.length > 16000 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('外部应用地址无效。');
  const url = new URL(value);
  if (['http:', 'https:', 'rainalley:', 'javascript:', 'data:', 'blob:', 'about:', 'file:', 'vbscript:'].includes(url.protocol)) throw new Error('此地址应由网页或本地文件功能处理。');
  return url.toString();
}
module.exports = { externalProtocol };
