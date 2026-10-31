const fs = require('node:fs');
const path = require('node:path');

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

function pixelIcon(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (x, y, color, opacity = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const a = opacity / 255, ia = 1 - a;
    data[i] = Math.round(color[0] * a + data[i] * ia);
    data[i + 1] = Math.round(color[1] * a + data[i + 1] * ia);
    data[i + 2] = Math.round(color[2] * a + data[i + 2] * ia);
    data[i + 3] = Math.min(255, Math.round(opacity + data[i + 3] * ia));
  };
  const scale = size / 64;
  const line = (x1, y1, x2, y2, color, width = 1.25) => {
    x1 *= scale; y1 *= scale; x2 *= scale; y2 *= scale; width *= scale;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.5));
    for (let i = 0; i <= steps; i++) {
      const x = x1 + (x2 - x1) * i / steps, y = y1 + (y2 - y1) * i / steps;
      for (let a = -width; a <= width; a++) for (let b = -width; b <= width; b++) if (a * a + b * b <= width * width) put(x + a, y + b, color);
    }
  };
  const rect = (x, y, w, h, color) => {
    x *= scale; y *= scale; w *= scale; h *= scale;
    for (let py = Math.round(y); py < Math.round(y + h); py++) for (let px = Math.round(x); px < Math.round(x + w); px++) put(px, py, color);
  };
  const circle = (cx, cy, radius, color, opacity = 255) => {
    cx *= scale; cy *= scale; radius *= scale;
    const r = radius * radius;
    for (let y = Math.floor(cy - radius); y <= cy + radius; y++) for (let x = Math.floor(cx - radius); x <= cx + radius; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r) put(x, y, color, opacity);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const glow = Math.max(0, 1 - Math.hypot(px - .67, py - .35) * 1.5);
    put(x, y, [Math.round(17 + glow * 35), Math.round(29 + glow * 35), Math.round(31 + glow * 23)]);
  }
  // Rain-lane arch frames a delivered letter, the app's central motif.
  line(10, 19, 32, 8, [122, 218, 216], 1.45);
  line(32, 8, 54, 19, [122, 218, 216], 1.45);
  line(13, 19, 13, 48, [122, 218, 216], 1.2);
  line(51, 19, 51, 48, [122, 218, 216], 1.2);
  line(13, 48, 51, 48, [122, 218, 216], 1.2);
  rect(19, 25, 26, 19, [240, 246, 240]);
  line(19, 25, 32, 36, [46, 137, 137], 1.65);
  line(45, 25, 32, 36, [46, 137, 137], 1.65);
  line(19, 44, 28, 36, [91, 167, 160], 1.2);
  line(45, 44, 36, 36, [91, 167, 160], 1.2);
  circle(47, 13, 3.2, [248, 209, 128]);
  circle(47, 13, 7, [248, 209, 128], 32);
  for (const [x, y] of [[17, 52], [25, 55], [39, 54], [47, 51]]) line(x, y, x - .8, y + 3, [122, 218, 216], .65);
  // Rounded dark rim.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = Math.min(x, size - 1 - x), ny = Math.min(y, size - 1 - y), cornerRadius = 12 * scale;
    if ((nx < cornerRadius && ny < cornerRadius) && Math.hypot(cornerRadius - nx, cornerRadius - ny) > cornerRadius) put(x, y, [14, 20, 21]);
  }
  return data;
}

function writeIco() {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    const rgba = pixelIcon(size);
    const xorBytes = size * size * 4;
    const maskRow = Math.ceil(size / 32) * 4;
    const maskBytes = maskRow * size;
    const image = Buffer.alloc(40 + xorBytes + maskBytes);
    image.writeUInt32LE(40, 0); image.writeInt32LE(size, 4); image.writeInt32LE(size * 2, 8);
    image.writeUInt16LE(1, 12); image.writeUInt16LE(32, 14); image.writeUInt32LE(0, 16); image.writeUInt32LE(xorBytes + maskBytes, 20);
    let offset = 40;
    for (let y = size - 1; y >= 0; y--) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      image[offset++] = rgba[i + 2]; image[offset++] = rgba[i + 1]; image[offset++] = rgba[i]; image[offset++] = rgba[i + 3];
    }
    images.push({ size, image });
  }
  let offset = 6 + images.length * 16;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  images.forEach(({ size, image }, index) => {
    const i = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, i); header.writeUInt8(size === 256 ? 0 : size, i + 1);
    header.writeUInt8(0, i + 2); header.writeUInt8(0, i + 3); header.writeUInt16LE(1, i + 4); header.writeUInt16LE(32, i + 6);
    header.writeUInt32LE(image.length, i + 8); header.writeUInt32LE(offset, i + 12); offset += image.length;
  });
  fs.writeFileSync(path.join(outDir, 'rain-alley.ico'), Buffer.concat([header, ...images.map((entry) => entry.image)]));
}

function writeBmp(file, width, height, painter) {
  const rowStride = Math.ceil(width * 3 / 4) * 4;
  const bytes = Buffer.alloc(54 + rowStride * height);
  bytes.write('BM', 0); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(rowStride * height, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = painter(x, y); const i = 54 + (height - 1 - y) * rowStride + x * 3;
    bytes[i] = rgb[2]; bytes[i + 1] = rgb[1]; bytes[i + 2] = rgb[0];
  }
  fs.writeFileSync(path.join(outDir, file), bytes);
}

writeIco();
writeBmp('installer-header.bmp', 150, 57, (x, y) => {
  const glow = Math.max(0, 1 - Math.hypot(x / 150 - .19, y / 57 - .45) * 1.3);
  const line = Math.abs(y - (10 + .23 * x)) < 1.1 || Math.abs(y - (47 - .18 * x)) < 1.1;
  return line ? [196, 169, 117] : [Math.round(21 + 30 * glow), Math.round(33 + 31 * glow), Math.round(34 + 24 * glow)];
});
writeBmp('installer-sidebar.bmp', 164, 314, (x, y) => {
  const sky = Math.min(1, y / 195);
  const moon = Math.max(0, 1 - Math.hypot(x - 119, y - 70) / 46);
  const bldg = y > 165 + 12 * Math.sin(x / 20) || (y > 207 && x < 69) || (y > 187 && x > 116);
  const window = ((x > 19 && x < 47) || (x > 78 && x < 101) || (x > 128 && x < 149)) && y > 185 && y < 246 && ((x >> 4) + (y >> 4)) % 2 === 0;
  const rain = x % 27 === 8 && (y + 4) % 41 < 15;
  if (window) return [208, 156, 101];
  if (bldg) return [67, 71, 59];
  if (rain) return [89, 120, 117];
  const shade = moon * .28;
  return [Math.round(23 + sky * 14 + shade * 99), Math.round(38 + sky * 7 + shade * 67), Math.round(41 + sky * 1 + shade * 26)];
});
console.log('Created rain-alley.ico and NSIS illustration bitmaps.');
