const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(process.cwd(), "build");

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function createBmp(width, height, getColor) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = Buffer.alloc(fileSize);

  // BMP file header (14 bytes)
  buffer.write("BM", 0);
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(0, 6);
  buffer.writeUInt32LE(54, 10);

  // DIB header (BITMAPINFOHEADER, 40 bytes)
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(pixelDataSize, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);
  buffer.writeUInt32LE(0, 46);
  buffer.writeUInt32LE(0, 50);

  // Pixel data (bottom-up, BGR)
  for (let y = 0; y < height; y++) {
    const rowOffset = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getColor(x, y);
      const offset = rowOffset + x * 3;
      buffer.writeUInt8(b, offset);
      buffer.writeUInt8(g, offset + 1);
      buffer.writeUInt8(r, offset + 2);
    }
  }

  return buffer;
}

function horizontalGradient(width, height, leftHex, rightHex) {
  const left = hexToRgb(leftHex);
  const right = hexToRgb(rightHex);
  return createBmp(width, height, (x) => ({
    r: lerp(left.r, right.r, x / (width - 1)),
    g: lerp(left.g, right.g, x / (width - 1)),
    b: lerp(left.b, right.b, x / (width - 1)),
  }));
}

function verticalGradient(width, height, topHex, bottomHex) {
  const top = hexToRgb(topHex);
  const bottom = hexToRgb(bottomHex);
  return createBmp(width, height, (_, y) => ({
    r: lerp(top.r, bottom.r, y / (height - 1)),
    g: lerp(top.g, bottom.g, y / (height - 1)),
    b: lerp(top.b, bottom.b, y / (height - 1)),
  }));
}

function main() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  fs.writeFileSync(
    path.join(BUILD_DIR, "installerHeader.bmp"),
    horizontalGradient(150, 57, "#1e1b4b", "#4c1d95")
  );

  fs.writeFileSync(
    path.join(BUILD_DIR, "installerSidebar.bmp"),
    verticalGradient(164, 314, "#312e81", "#5b21b6")
  );

  console.log("Generated installer BMP assets in build/");
}

main();
