const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createResourceStore } = require('../src/resource-store.cjs');

test('cancel and wrong ZIP preserve inputs; verified cache is reused and tampering is rejected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-resource-'));
  try {
    const source = path.join(root, 'download.zip');
    const bytes = Buffer.from('verified resource');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    let selection = null, prompts = 0;
    const store = createResourceStore({ cache: path.join(root, 'cache'), resources: { client: { fileName: 'client.zip', bytes: bytes.length, sha256 } }, chooseFile: async () => { prompts++; return selection; } });
    assert.equal(await store.acquire('client'), null);
    selection = source;
    await fs.writeFile(source, 'wrong resource');
    await assert.rejects(store.acquire('client'), /校验未通过/);
    assert.equal(await fs.readFile(source, 'utf8'), 'wrong resource');
    await fs.writeFile(source, bytes);
    const cached = await store.acquire('client');
    assert.deepEqual(await fs.readFile(cached), bytes);
    assert.equal(await store.acquire('client'), cached);
    assert.equal(prompts, 3);
    await fs.writeFile(cached, 'modified');
    selection = null;
    assert.equal(await store.acquire('client'), null);
    assert.equal(prompts, 4);
    assert.deepEqual(await fs.readFile(source), bytes);
    selection = source;
    assert.equal(await store.acquire('client'), cached);
    assert.deepEqual(await fs.readFile(cached), bytes);
    assert.throws(() => store.get('../client'), /未找到/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
