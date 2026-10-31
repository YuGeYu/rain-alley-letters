'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { providerFor, isSharePageUrl, isLinkSwiftAuthorizeUrl, isLinkSwiftOAuthPageUrl, resolveNetdiskInput } = require('../src/netdisk-resolver.cjs');

const shareUrls = [
  ['baidu', 'https://pan.baidu.com/s/abc'],
  ['aliyun', 'https://www.aliyundrive.com/s/abc'],
  ['mcloud', 'https://yun.139.com/share/abc'],
  ['tianyi', 'https://cloud.189.cn/t/abc'],
  ['xunlei', 'https://pan.xunlei.com/s/abc'],
  ['quark', 'https://pan.quark.cn/s/abc'],
  ['uc', 'https://drive.uc.cn/s/abc'],
  ['123pan', 'https://www.123pan.com/s/abc'],
];

test('recognizes all eight supported cloud-drive sharing domains', () => {
  for (const [id, value] of shareUrls) assert.equal(providerFor(new URL(value))?.id, id, value);
});

test('recognizes LinkSwift API domains only as their matching provider', () => {
  const apiUrls = [
    ['baidu', 'https://openapi.baidu.com/oauth/2.0/authorize'],
    ['aliyun', 'https://api.aliyundrive.com/v2/file/get_download_url'],
    ['aliyun', 'https://cdn.alicloudccp.com/v2/file/get_download_url'],
    ['mcloud', 'https://personal-kd-njs.yun.139.com/hcy/file/getDownloadUrl'],
    ['tianyi', 'https://api.cloud.189.cn/open/file/getFileDownloadUrl.action'],
    ['xunlei', 'https://api-pan.xunlei.com/drive/v1/files/abc'],
    ['xunlei', 'https://vod0780-aliyun04-vip-lixian.xunlei.com/file'],
    ['quark', 'https://drive-pc.quark.cn/1/clouddrive/file/download'],
    ['uc', 'https://pc-api.uc.cn/1/clouddrive/file/download'],
    ['123pan', 'https://login.123pan.com/centerlogin'],
  ];
  for (const [id, value] of apiUrls) assert.equal(providerFor(new URL(value))?.id, id, value);
});

test('only page hosts can be fetched as a share page', () => {
  assert.equal(isSharePageUrl(new URL('https://pan.baidu.com/s/abc')), true);
  assert.equal(isSharePageUrl(new URL('https://api.aliyundrive.com/v2/file/get_download_url')), false);
});

test('LinkSwift can open only its exact HTTPS Baidu OAuth authorization URL', () => {
  const allowed = 'https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&scope=basic,netdisk&client_id=omiOnr2tYnN9vSyDErcVFWpPU2mZA7YO&redirect_uri=oob&confirm_login=0';
  assert.equal(isLinkSwiftAuthorizeUrl(allowed), true);
  assert.equal(isLinkSwiftOAuthPageUrl(allowed), true);
  assert.equal(isLinkSwiftOAuthPageUrl('https://openapi.baidu.com/oauth/2.0/login_success#access_token=private'), true);
  for (const value of [
    allowed.replace('https:', 'http:'),
    allowed.replace('openapi.baidu.com', 'evil.baidu.com'),
    allowed.replace('omiOnr2tYnN9vSyDErcVFWpPU2mZA7YO', 'other-client'),
    allowed.replace('redirect_uri=oob', 'redirect_uri=https%3A%2F%2Fevil.example'),
    'https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&scope=basic,netdisk&client_id=omiOnr2tYnN9vSyDErcVFWpPU2mZA7YO&redirect_uri=oob#https://evil.example',
  ]) assert.equal(isLinkSwiftAuthorizeUrl(value), false, value);
});

test('extracts a previously generated direct link without making a network request', async () => {
  const result = await resolveNetdiskInput('https://d.pcs.baidu.com/file/lesson.zip?filename=lesson.zip&sign=abc&expires=123');
  assert.equal(result.status, 'ready');
  assert.equal(result.provider?.id, 'baidu');
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].filename, 'lesson.zip');
  assert.equal(result.links[0].url.includes('sign=abc'), true);
  assert.equal((await resolveNetdiskInput('https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&dlink=1&filename=lesson.zip')).status, 'needs-page');
});

test('rejects unsupported schemes and unrelated hosts', async () => {
  assert.equal((await resolveNetdiskInput('javascript:alert(1)')).status, 'invalid');
  assert.equal((await resolveNetdiskInput('https://example.com/file/download')).status, 'invalid');
});

test('does not follow a cloud-share redirect to an unrelated host', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://example.com/redirected' } });
  try {
    const result = await resolveNetdiskInput('https://pan.baidu.com/s/abc');
    assert.equal(result.status, 'needs-page');
    assert.match(result.message, /跳转|连接|跨域/);
  } finally { global.fetch = originalFetch; }
});
