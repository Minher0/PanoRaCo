/**
 * PanoRaCo PNG Encoder Worker
 *
 * Receives raw RGBA pixel data + dimensions, encodes to a PNG blob using:
 * - RGB (color type 2) when alpha is all-opaque, RGBA (color type 6) otherwise
 * - Paeth filter (filter type 4) on every scanline — best single filter for photos
 * - pako zlib level 9 compression
 *
 * Sends back the encoded PNG as a transferable ArrayBuffer.
 */

// CRC32 lookup table (PNG spec)
const _crcTable = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = _crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/**
 * Encode RGBA pixels to PNG.
 * Uses Paeth filter only (single filter, fast) — best for photographic content.
 */
function encodePNG(W, H, rgba) {
  // Detect if alpha is all-opaque (255)
  let allOpaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) { allOpaque = false; break; }
  }

  const bpp = allOpaque ? 3 : 4;
  const colorType = allOpaque ? 2 : 6;
  const stride = W * bpp;

  // Build raw PNG data: filter byte + Paeth-filtered scanline, per row
  const rawSize = (stride + 1) * H;
  const raw = new Uint8Array(rawSize);

  // Paeth predictor function
  function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  // Single-pass Paeth filtering
  // For each scanline, compute Paeth-filtered bytes directly into raw[]
  if (allOpaque) {
    // RGB output — need to repack from RGBA on the fly
    // Pre-build a packed RGB buffer first (faster than per-pixel extraction)
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }

    for (let y = 0; y < H; y++) {
      const rowOffset = y * stride;
      const upRowOffset = rowOffset - stride;
      const rawRowStart = y * (stride + 1);
      raw[rawRowStart] = 4; // Paeth filter

      // First pixel (x=0): no left, no up-left
      let left = 0, up = 0, upLeft = 0;
      for (let x = 0; x < bpp; x++) {
        const cur = rgb[rowOffset + x];
        up = (y > 0) ? rgb[upRowOffset + x] : 0;
        const pred = paethPredictor(left, up, upLeft);
        raw[rawRowStart + 1 + x] = (cur - pred) & 0xFF;
        left = cur;
        if (y > 0) upLeft = rgb[upRowOffset + x];
      }
      // Remaining pixels
      for (let x = bpp; x < stride; x++) {
        const cur = rgb[rowOffset + x];
        left = rgb[rowOffset + x - bpp];
        up = (y > 0) ? rgb[upRowOffset + x] : 0;
        upLeft = (y > 0) ? rgb[upRowOffset + x - bpp] : 0;
        const pred = paethPredictor(left, up, upLeft);
        raw[rawRowStart + 1 + x] = (cur - pred) & 0xFF;
      }
    }
  } else {
    // RGBA output — direct
    for (let y = 0; y < H; y++) {
      const rowOffset = y * stride;
      const upRowOffset = rowOffset - stride;
      const rawRowStart = y * (stride + 1);
      raw[rawRowStart] = 4; // Paeth filter

      let left = 0, up = 0, upLeft = 0;
      for (let x = 0; x < bpp; x++) {
        const cur = rgba[rowOffset + x];
        up = (y > 0) ? rgba[upRowOffset + x] : 0;
        const pred = paethPredictor(left, up, upLeft);
        raw[rawRowStart + 1 + x] = (cur - pred) & 0xFF;
        left = cur;
        if (y > 0) upLeft = rgba[upRowOffset + x];
      }
      for (let x = bpp; x < stride; x++) {
        const cur = rgba[rowOffset + x];
        left = rgba[rowOffset + x - bpp];
        up = (y > 0) ? rgba[upRowOffset + x] : 0;
        upLeft = (y > 0) ? rgba[upRowOffset + x - bpp] : 0;
        const pred = paethPredictor(left, up, upLeft);
        raw[rawRowStart + 1 + x] = (cur - pred) & 0xFF;
      }
    }
  }

  // Compress with pako zlib level 9
  // pako is loaded via importScripts in the worker
  const compressed = pako.deflate(raw, { level: 9 });

  // Build PNG file
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLen);
  let off = 0;
  png.set(sig, off); off += sig.length;
  png.set(ihdrChunk, off); off += ihdrChunk.length;
  png.set(idatChunk, off); off += idatChunk.length;
  png.set(iendChunk, off);

  return png.buffer;
}

// Load pako
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

self.onmessage = function (e) {
  const { W, H, rgba, requestId } = e.data;
  try {
    const t0 = performance.now();
    const pngBuffer = encodePNG(W, H, new Uint8Array(rgba));
    const t1 = performance.now();
    self.postMessage({
      ok: true,
      pngBuffer: pngBuffer,
      elapsed: t1 - t0,
      requestId: requestId,
    }, [pngBuffer]);
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err.message,
      requestId: requestId,
    });
  }
};
