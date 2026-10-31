const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateNetworkHost } = require('../src/site-policy.cjs');

test('private and local network addresses stay blocked unless explicitly enabled', () => {
  for (const host of [
    'localhost', 'router.local', 'device.lan', 'home.arpa', 'player.home.arpa',
    '10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.10.20', '100.64.0.1',
    '::', '::1', '[::1]', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '[::ffff:192.168.1.1]', '64:ff9b::a00:1', '2002:0a00:0001::1',
  ]) assert.equal(isPrivateNetworkHost(host), true, `${host} should be treated as local/private`);
});

test('ordinary public web hosts and public IPs stay navigable', () => {
  for (const host of ['example.com', '8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']) {
    assert.equal(isPrivateNetworkHost(host), false, `${host} should not be treated as local/private`);
  }
});
