/**
 * A tiny raster canvas plus a PNG encoder.
 *
 * Why not ImageMagick or ffmpeg: neither is guaranteed to be installed, and a
 * splash generator that silently produces nothing on a clean machine is worse
 * than one that draws its own pixels. PNG is a simple enough format to emit
 * correctly — IHDR, IDAT with zlib, IEND, each chunk CRC'd — and Node ships zlib.
 *
 * The drawing surface is deliberately minimal: fill, rect, circle, gradient,
 * and 5x7 bitmap text. That is enough for a splash screen, and small enough to
 * read. Nothing here is a general graphics library.
 */

import zlib from "zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // RGBA, opaque black. A splash that is transparent where the background
    // should be shows the firmware logo through it on some panels.
    this.data = Buffer.alloc(width * height * 4, 0);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
  }

  /** Linear blend of one pixel. `a` is 0..1. */
  blend(x, y, r, g, b, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    if (a >= 1) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      return;
    }
    this.data[i] = Math.round(this.data[i] * (1 - a) + r * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + g * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + b * a);
  }

  /** Vertical linear gradient over the whole frame. */
  verticalGradient(top, bottom) {
    for (let y = 0; y < this.height; y++) {
      const t = this.height === 1 ? 0 : y / (this.height - 1);
      const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
      const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
      const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4;
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
      }
    }
  }

  rect(x, y, w, h, color, alpha = 1) {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        this.blend(xx, yy, color[0], color[1], color[2], alpha);
      }
    }
  }

  /** Anti-aliased disc: distance-based coverage, so a logo edge is not jagged. */
  circle(cx, cy, radius, color, alpha = 1) {
    const r2 = radius * radius;
    for (let yy = Math.floor(cy - radius - 1); yy <= cy + radius + 1; yy++) {
      for (let xx = Math.floor(cx - radius - 1); xx <= cx + radius + 1; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 + radius) continue;
        // Coverage ramps across roughly one pixel at the edge.
        const d = Math.sqrt(d2);
        const cov = Math.max(0, Math.min(1, radius - d + 0.5));
        if (cov > 0) this.blend(xx, yy, color[0], color[1], color[2], alpha * cov);
      }
    }
  }

  /** Rounded rectangle, built from a rect plus four discs. */
  roundRect(x, y, w, h, radius, color, alpha = 1) {
    const r = Math.min(radius, Math.floor(Math.min(w, h) / 2));
    this.rect(x + r, y, w - 2 * r, h, color, alpha);
    this.rect(x, y + r, r, h - 2 * r, color, alpha);
    this.rect(x + w - r, y + r, r, h - 2 * r, color, alpha);
    this.circle(x + r, y + r, r, color, alpha);
    this.circle(x + w - r, y + r, r, color, alpha);
    this.circle(x + r, y + h - r, r, color, alpha);
    this.circle(x + w - r, y + h - r, r, color, alpha);
  }

  /** RGB PNG bytes. Filter 0 on every row: the encoder stays obvious, and zlib handles the size. */
  toPng() {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      const rowStart = y * (this.width * 4 + 1);
      raw[rowStart] = 0;
      this.data.copy(raw, rowStart + 1, y * this.width * 4, (y + 1) * this.width * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/**
 * 5x7 bitmap font, uppercase plus digits and a few symbols.
 *
 * Each glyph is seven rows of five bits. Small enough to inline, readable at 3x
 * scale, and it means the generator can draw real words without shipping a font
 * file or depending on a text renderer.
 */
const GLYPHS = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  3: [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  "-": [0, 0, 0, 0b11111, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

/** Width of a string in pixels at a given scale, including one-glyph spacing. */
export function textWidth(text, scale) {
  return String(text).length * 6 * scale - scale;
}

/** Draw text at 6-px advance per glyph (5 wide + 1 space). */
export function drawText(canvas, text, x, y, scale, color, alpha = 1) {
  const s = String(text).toUpperCase();
  let cx = x;
  for (const ch of s) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          canvas.rect(cx + col * scale, y + row * scale, scale, scale, color, alpha);
        }
      }
    }
    cx += 6 * scale;
  }
  return cx;
}

/** True when every character can be drawn; used to reject a title honestly. */
export function canRenderText(text) {
  for (const ch of String(text).toUpperCase()) {
    if (!(ch in GLYPHS)) return { ok: false, ch };
  }
  return { ok: true };
}

export function parseColor(input, fallback) {
  const s = String(input ?? "").trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const named = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    red: [220, 38, 38],
    green: [34, 197, 94],
    blue: [37, 99, 235],
    cyan: [34, 211, 238],
    purple: [147, 51, 234],
    amber: [245, 158, 11],
    slate: [30, 41, 59],
  };
  return named[s.toLowerCase()] ?? fallback;
}
