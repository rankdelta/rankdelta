/**
 * Generate the extension icons (16/32/48/128) with zero dependencies.
 *
 * Draws a rounded violet tile with a white "delta" (△) — the Rankdelta mark —
 * and encodes real PNGs using Node's built-in zlib. Committed output lives in
 * `public/icons/`, so the build never depends on regeneration.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const VIOLET = [124, 58, 237]; // #7c3aed
const WHITE = [255, 255, 255];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // remaining bytes (compression/filter/interlace) already 0

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed area sign for point-in-triangle test. */
function edge(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;

  // Delta triangle geometry (centered, ~52% of the tile).
  const cx = size / 2;
  const apexY = size * 0.26;
  const baseY = size * 0.72;
  const halfBase = size * 0.24;
  const ax = cx;
  const ay = apexY;
  const bx = cx - halfBase;
  const by = baseY;
  const cx2 = cx + halfBase;
  const cy2 = baseY;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-rect mask (in tile coords, small inset).
      const inset = size * 0.06;
      const minX = inset;
      const maxX = size - inset;
      const cxr = Math.min(Math.max(x + 0.5, minX + radius), maxX - radius);
      const cyr = Math.min(Math.max(y + 0.5, minX + radius), maxX - radius);
      const dx = x + 0.5 - cxr;
      const dy = y + 0.5 - cyr;
      const insideRect =
        x + 0.5 >= minX &&
        x + 0.5 <= maxX &&
        y + 0.5 >= minX &&
        y + 0.5 <= maxX &&
        dx * dx + dy * dy <= radius * radius;

      if (!insideRect) {
        px[i + 3] = 0;
        continue;
      }

      const s1 = edge(ax, ay, bx, by, x + 0.5, y + 0.5);
      const s2 = edge(bx, by, cx2, cy2, x + 0.5, y + 0.5);
      const s3 = edge(cx2, cy2, ax, ay, x + 0.5, y + 0.5);
      const inTriangle = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);

      const color = inTriangle ? WHITE : VIOLET;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, drawIcon(size));
  writeFileSync(join(outDir, `icon${size}.png`), png);
}

console.log('Generated icons → public/icons/');
