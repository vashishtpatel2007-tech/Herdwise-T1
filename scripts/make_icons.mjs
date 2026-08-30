/**
 * Generate the PWA icons referenced by the manifest.
 *
 * Written as a pure-Node PNG encoder rather than pulling in a raster library:
 * the icon is two shapes, and a build-time dependency that exists to draw a
 * rounded rectangle is not worth the install cost on a project whose whole
 * premise is running on cheap hardware.
 *
 * The mark is the government cattle ear tag itself — the object already
 * hanging on every animal in the country, and the anchor of the palette (§10).
 *
 *   node scripts/make_icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = [0xf2, 0xc2, 0x00]; // --tag-yellow
const INK = [0x10, 0x23, 0x1a]; // --ink

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
  // Each scanline is prefixed with filter byte 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle, for cheap anti-aliasing. */
function roundedRectSdf(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5, py = y + 0.5;

      // Background: rounded square in tag yellow.
      const bg = roundedRectSdf(px, py, c, c, size * 0.5, size * 0.5, size * 0.22);
      const bgA = Math.max(0, Math.min(1, 0.5 - bg));

      // The ear tag: a rounded panel in ink, spanning y 0.26 .. 0.84.
      const tag = roundedRectSdf(px, py, c, size * 0.55, size * 0.26, size * 0.29, size * 0.10);
      const tagA = Math.max(0, Math.min(1, 0.5 - tag));

      // The punch hole, fully INSIDE the panel — a hole, not a notch in the
      // top edge. Centre it a comfortable radius below the panel's top.
      const hole = Math.hypot(px - c, py - size * 0.38) - size * 0.072;
      const holeA = Math.max(0, Math.min(1, 0.5 - hole));

      let r = TAG[0], g = TAG[1], b = TAG[2];
      const inkA = Math.max(0, tagA - holeA);
      r = r * (1 - inkA) + INK[0] * inkA;
      g = g * (1 - inkA) + INK[1] * inkA;
      b = b * (1 - inkA) + INK[2] * inkA;

      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
      buf[i + 3] = Math.round(bgA * 255);
    }
  }
  return encodePng(size, size, buf);
}

mkdirSync('public', { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, drawIcon(size));
  console.log(`public/icon-${size}.png`);
}

// Favicon as SVG: sharp at every size, a few hundred bytes.
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#F2C200"/>
  <path d="M50 22a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z" fill="#10231A"/>
  <rect x="24" y="42" width="52" height="42" rx="10" fill="#10231A"/>
</svg>\n`,
);
console.log('public/favicon.svg');
