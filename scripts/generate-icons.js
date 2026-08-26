// Generate PNG sizes + Windows ICO from the 1024px build/icon.png,
// without native image deps. ICO is assembled by hand (BMP-in-ICO format),
// resizing with a simple box filter — good enough for app icons.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = process.cwd();
const srcPath = path.join(root, "build", "icon.png");
const outDir = path.join(root, "build", "icons");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let palette = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported png: bitDepth=${bitDepth} colorType=${colorType} (need 8-bit RGB/RGBA)`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // Undo filters; output as RGBA.
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      switch (filter) {
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
      }
      cur[i] = v;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = cur[x * channels];
      out[(y * width + x) * 4 + 1] = cur[x * channels + 1];
      out[(y * width + x) * 4 + 2] = cur[x * channels + 2];
      out[(y * width + x) * 4 + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    prev = cur;
    void palette;
  }
  return { width, height, rgba: out };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // no filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunks = [];
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([head, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(chunk("IHDR", ihdr));
  chunks.push(chunk("IDAT", zlib.deflateSync(raw)));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

// Box-filter resize on premultiplied-alpha-free RGBA (icons tolerate it).
function resize(img, tw, th) {
  const { width: sw, height: sh, rgba } = img;
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy0 = Math.floor((y * sh) / th), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / th));
    for (let x = 0; x < tw; x++) {
      const sx0 = Math.floor((x * sw) / tw), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < sh; sy++)
        for (let sx = sx0; sx < sx1 && sx < sw; sx++) {
          const o = (sy * sw + sx) * 4;
          r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3]; n++;
        }
      const d = (y * tw + x) * 4;
      out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = a / n;
    }
  }
  return { width: tw, height: th, rgba: out };
}

// BMP (BGRA, top-down via negative height) payload for ICO entries.
function bmpEntry(img) {
  const { width: w, height: h, rgba } = img;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8); // XOR + AND masks
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    pixels[i * 4] = rgba[i * 4 + 2];
    pixels[i * 4 + 1] = rgba[i * 4 + 1];
    pixels[i * 4 + 2] = rgba[i * 4];
    pixels[i * 4 + 3] = rgba[i * 4 + 3];
  }
  const mask = Buffer.alloc(Math.ceil(w / 32) * 4 * h); // all-zero = fully opaque
  return Buffer.concat([header, pixels, mask]);
}

function buildIco(images) {
  const count = images.length;
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type 1 = icon
  dir.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const entries = [];
  const bodies = [];
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.width >= 256 ? 0 : img.width;
    e[1] = img.height >= 256 ? 0 : img.height;
    e[4] = 1; e[6] = 32;
    const body = bmpEntry(img);
    e.writeUInt32LE(body.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += body.length;
    entries.push(e);
    bodies.push(body);
  }
  return Buffer.concat([dir, ...entries, ...bodies]);
}

async function main() {
  const src = decodePng(fs.readFileSync(srcPath));
  fs.mkdirSync(outDir, { recursive: true });

  // Square-crop to min dimension first so resized icons stay square.
  const side = Math.min(src.width, src.height);
  const cropX = Math.floor((src.width - side) / 2), cropY = Math.floor((src.height - side) / 2);
  const sq = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++)
    src.rgba.copy(sq, y * side * 4, ((cropY + y) * src.width + cropX) * 4, ((cropY + y) * src.width + cropX + side) * 4);
  const square = { width: side, height: side, rgba: sq };

  const sized = [];
  for (const s of [...ICO_SIZES].sort((a, b) => a - b).reverse()) {
    const img = resize(square, s, s);
    sized.push({ size: s, img });
    if ([16, 32, 48, 256].includes(s))
      fs.writeFileSync(path.join(outDir, `icon_${s}.png`), encodePng(img.width, img.height, img.rgba));
  }

  // electron-builder wants 512/1024 icon.png for linux; keep the source too.
  fs.writeFileSync(path.join(outDir, "icon_1024.png"), encodePng(side, side, sq));

  fs.writeFileSync(path.join(root, "build", "icon.ico"), buildIco(sized.map((s) => s.img)));
  console.log(`Generated ${outDir}/icon_*.png and build/icon.ico (${ICO_SIZES.join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
