// Runs only after native, per-window permission. This is a Node process,
// not a security sandbox: installation code has the user's OS permissions.
const run = require(process.argv[2]);
const directory = process.argv[3];
process.parentPort.on('message', async ({ data }) => {
  try {
    if (typeof run !== 'function') throw new Error('后端需使用 module.exports = async (action, args, context) => …');
    const result = await run(data.action, data.args, { dataDirectory: directory });
    const encoded = JSON.stringify(result ?? null);
    if (Buffer.byteLength(encoded) > 65536) throw new Error('后端返回结果超过 64 KiB。');
    process.parentPort.postMessage({ id: data.id, result: JSON.parse(encoded) });
  } catch (cause) { process.parentPort.postMessage({ id: data.id, error: String(cause.message || cause).slice(0,2000) }); }
});
