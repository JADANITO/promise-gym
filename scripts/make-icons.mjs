// Rasterises the app icon (same shapes as public/icon.svg) to PNGs without extra deps.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [11, 13, 16], FG = [198, 244, 50];
const rects = [[96, 216, 40, 80, 10], [376, 216, 40, 80, 10], [140, 176, 44, 160, 12], [328, 176, 44, 160, 12], [184, 240, 144, 32, 8]];

function inRound(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rounded) {
  const s = 512 / size, raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * s, py = (y + 0.5) * s;
      const inside = !rounded || inRound(px, py, 0, 0, 512, 512, 96);
      const fg = rects.some(r => inRound(px, py, ...r));
      const col = fg ? FG : BG, o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('public/icon-192.png', png(192, true));
writeFileSync('public/icon-512.png', png(512, true));
writeFileSync('public/apple-touch-icon.png', png(180, false));
console.log('icons written');
