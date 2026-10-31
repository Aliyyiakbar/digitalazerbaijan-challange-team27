#!/usr/bin/env node
// PWA ikonlarını (192, 512 PNG) brauzersiz yaradır: qara fon, üç sütun (aşağı/orta/yüksək sıxlıq).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'public');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function icon(size) {
  const s = size / 64;
  const px = Buffer.alloc(size * size * 4);
  const rect = (x, y, w, h, [r, g, b], rad) => {
    for (let j = Math.floor(y * s); j < Math.ceil((y + h) * s); j++)
      for (let i = Math.floor(x * s); i < Math.ceil((x + w) * s); i++) {
        // yuvarlaq künclər
        const cx = Math.min(Math.max(i, (x + rad) * s), (x + w - rad) * s);
        const cy = Math.min(Math.max(j, (y + rad) * s), (y + h - rad) * s);
        if (Math.hypot(i - cx, j - cy) > rad * s) continue;
        const o = (j * size + i) * 4;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
      }
  };
  rect(0, 0, 64, 64, [10, 10, 10], 0); // maskable: tam fon
  rect(14, 36, 9, 14, [255, 255, 255], 2);
  rect(27.5, 26, 9, 24, [255, 255, 255], 2);
  rect(41, 14, 9, 36, [74, 138, 214], 2);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const n of [192, 512]) writeFileSync(join(out, `icon-${n}.png`), icon(n));
console.log('icon-192.png, icon-512.png yaradıldı');
