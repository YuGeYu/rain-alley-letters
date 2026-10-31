'use strict';

const { isIP } = require('node:net');

function isPrivateIpv4(host) {
  if (isIP(host) !== 4) return false;
  const [first, second] = host.split('.').map(Number);
  return first === 0 || first === 10 || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function expandIpv6(host) {
  let address = host;
  if (address.includes('.')) {
    const separator = address.lastIndexOf(':');
    const ipv4 = address.slice(separator + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split('.').map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    address = `${address.slice(0, separator + 1)}${high}:${low}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1) return left.length === 8 ? left.map((part) => Number.parseInt(part, 16)) : null;
  const zeros = 8 - left.length - right.length;
  if (zeros < 1) return null;
  return [...left, ...Array(zeros).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
}

function isPrivateNetworkHost(rawHost) {
  let host = String(rawHost || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const name = host.replace(/\.+$/, '');
  if (['localhost', 'home.arpa'].includes(name) || ['.localhost', '.local', '.internal', '.lan', '.home.arpa'].some((suffix) => name.endsWith(suffix))) return true;
  if (isPrivateIpv4(host)) return true;
  if (isIP(host) !== 6) return false;

  const words = expandIpv6(host);
  if (!words) return false;
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true;
  if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xff00) === 0xff00 || words[0] === 0x2002) return true;

  // IPv4-mapped, compatible and NAT64 addresses can still route to a private IPv4 host.
  const prefixIsIpv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const prefixIsIpv4Compatible = words.slice(0, 6).every((word) => word === 0);
  const prefixIsNat64 = words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0);
  if (prefixIsIpv4Mapped || prefixIsIpv4Compatible || prefixIsNat64) {
    const ipv4 = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isPrivateIpv4(ipv4);
  }
  return false;
}

module.exports = { isPrivateNetworkHost };
