const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = process.cwd();
const svgPath = path.join(root, "build", "icon.svg");
const pngPath = path.join(root, "build", "icon.png");

async function main() {
  if (!fs.existsSync(svgPath)) {
    console.error(`SVG icon not found: ${svgPath}`);
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(svgPath);
  await sharp(svgBuffer)
    .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(pngPath);

  console.log(`Generated ${pngPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
