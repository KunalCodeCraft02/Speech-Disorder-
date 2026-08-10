// One-off PWA/Capacitor icon generator — no image-library dependency
// (no sharp/canvas download needed). Writes raw PNGs by hand: pixel
// buffer -> zlib-deflated scanlines -> minimal PNG chunk framing. Draws a
// simple "waveform pulse" mark (three bars) on the app's dark background,
// matching the palette in src/index.css. Re-run with `node
// scripts/generate-icons.cjs` any time the mark/sizes need to change —
// this is a build-time tool, not part of the shipped app.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PLANE = [0x07, 0x0a, 0x12]; // --color-plane
const ACCENT = [0x39, 0x87, 0xe5]; // --color-accent
const GOOD = [0x0c, 0xa3, 0x0c]; // --color-good

const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** pixels: Uint8Array of length w*h*4 (RGBA), row-major. */
function encodePng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([signature, chunk('IHDR', ihdrData), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

function setPixel(pixels, width, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

/** Draws the icon into a fresh RGBA buffer: dark background + a 3-bar waveform-pulse mark, sized within `contentScale` of the canvas (smaller for maskable safe-zone). */
function drawIcon(size, contentScale) {
  const pixels = Buffer.alloc(size * size * 4);
  const height = size;
  const width = size;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(pixels, width, x, y, PLANE, 255);
  }

  const contentSize = size * contentScale;
  const left = (size - contentSize) / 2;
  const barWidth = contentSize * 0.16;
  const gap = contentSize * 0.1;
  const bars = [
    { heightFrac: 0.45, color: ACCENT },
    { heightFrac: 0.85, color: ACCENT },
    { heightFrac: 0.6, color: GOOD },
  ];
  const totalBarsWidth = bars.length * barWidth + (bars.length - 1) * gap;
  let cursorX = left + (contentSize - totalBarsWidth) / 2;
  const centerY = size / 2;
  const cornerRadius = barWidth / 2;

  for (const bar of bars) {
    const barHeight = contentSize * bar.heightFrac;
    const top = centerY - barHeight / 2;
    const bottom = centerY + barHeight / 2;
    for (let y = Math.round(top); y < Math.round(bottom); y++) {
      for (let x = Math.round(cursorX); x < Math.round(cursorX + barWidth); x++) {
        // Rounded caps: skip corners outside the corner-radius circle near top/bottom edges.
        const distFromTop = y - top;
        const distFromBottom = bottom - y;
        const xCenter = cursorX + barWidth / 2;
        const dx = x - xCenter;
        let paint = true;
        if (distFromTop < cornerRadius) {
          const dy = cornerRadius - distFromTop;
          paint = dx * dx + dy * dy <= cornerRadius * cornerRadius;
        } else if (distFromBottom < cornerRadius) {
          const dy = cornerRadius - distFromBottom;
          paint = dx * dx + dy * dy <= cornerRadius * cornerRadius;
        }
        if (paint) setPixel(pixels, width, x, y, bar.color, 255);
      }
    }
    cursorX += barWidth + gap;
  }

  return pixels;
}

function writeIcon(outPath, size, contentScale) {
  const pixels = drawIcon(size, contentScale);
  const png = encodePng(size, size, pixels);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${size}x${size})`);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
writeIcon(path.join(outDir, 'icon-192.png'), 192, 0.7);
writeIcon(path.join(outDir, 'icon-512.png'), 512, 0.7);
writeIcon(path.join(outDir, 'icon-maskable-512.png'), 512, 0.5); // smaller safe-zone content for maskable masking
writeIcon(path.join(outDir, 'apple-touch-icon.png'), 180, 0.7);
