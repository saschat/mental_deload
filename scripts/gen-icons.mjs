// Renders the app icons as PNGs without native dependencies:
// a calendar card with a check mark on an indigo background.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [74, 91, 212];
const CARD = [255, 255, 255];
const ACCENT = [255, 183, 77];
const CHECK = [74, 91, 212];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Signed distance helpers (unit square coordinates 0..1).
const roundedBox = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segment = (px, py, ax, ay, bx, by, w) => {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - w;
};

function blend(base, color, coverage) {
  return base.map((c, i) => Math.round(c + (color[i] - c) * coverage));
}

function renderer(size, { scale = 1, rounded = true, mono = false } = {}) {
  const aa = 1.2 / size;
  const cov = (d) => Math.max(0, Math.min(1, 0.5 - d / aa));
  return (x, y) => {
    const u = (x / size - 0.5) / scale + 0.5;
    const v = (y / size - 0.5) / scale + 0.5;
    const bgD = rounded ? roundedBox(x / size, y / size, 0.5, 0.5, 0.5, 0.5, 0.22) : -1;
    const bgA = mono ? 0 : cov(bgD);
    let col = BG;
    const card = roundedBox(u, v, 0.5, 0.54, 0.3, 0.27, 0.07);
    const header = Math.max(card, -(0.37 - v));
    const ring1 = roundedBox(u, v, 0.38, 0.27, 0.03, 0.07, 0.03);
    const ring2 = roundedBox(u, v, 0.62, 0.27, 0.03, 0.07, 0.03);
    const check = Math.min(segment(u, v, 0.37, 0.57, 0.46, 0.66, 0.045), segment(u, v, 0.46, 0.66, 0.65, 0.46, 0.045));
    let alpha = bgA;
    const fg = mono ? [255, 255, 255] : CARD;
    const c1 = cov(card);
    col = blend(col, fg, c1);
    if (!mono) col = blend(col, ACCENT, cov(header));
    const cc = cov(check);
    col = blend(col, mono ? [0, 0, 0] : CHECK, cc);
    const rings = cov(Math.min(ring1, ring2));
    col = blend(col, mono ? [255, 255, 255] : [255, 255, 255], rings);
    if (mono) alpha = Math.max(Math.min(c1, 1 - cc), rings);
    else alpha = Math.max(alpha, c1, rings);
    return [...col, Math.round(alpha * 255)];
  };
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, renderer(192)));
writeFileSync("public/icons/icon-512.png", png(512, renderer(512)));
// Maskable: full-bleed background, content within the 80% safe zone.
writeFileSync("public/icons/icon-maskable-512.png", png(512, renderer(512, { scale: 0.8, rounded: false })));
// Monochrome badge for the Android status bar.
writeFileSync("public/icons/badge-96.png", png(96, renderer(96, { mono: true, rounded: false })));
console.log("Icons written to public/icons/");
