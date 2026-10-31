// Regenerates the favicon set in src/app from the logo in src/lib/logo.ts:
//   icon.svg       vector favicon; switches palette with the browser's light/dark setting
//   favicon.ico    16/32/48 px, light palette (raster icons cannot follow the theme)
//   apple-icon.png 180 px home-screen icon on a light tile
// Run from apps/web with `npm run icons`. Needs Node >= 22.18 (imports the .ts module directly)
// and sharp, which is installed with Next.js.
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { LOGO_BLOCKS, LOGO_COLORS, LOGO_VIEWBOX } from "../src/lib/logo.ts";

const APP_DIR = new URL("../src/app/", import.meta.url);
const [, , , LOGO_HEIGHT] = LOGO_VIEWBOX.split(" ").map(Number);

const toneRules = (palette) => palette.map((color, i) => `.t${i + 1}{fill:${color}}`).join("");
const iconSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}">` +
  `<style>${toneRules(LOGO_COLORS.light)}@media (prefers-color-scheme:dark){${toneRules(LOGO_COLORS.dark)}}</style>` +
  LOGO_BLOCKS.map((block) => `<path class="t${block.tone}" d="${block.d}"/>`).join("") +
  "</svg>\n";

/** Square PNG of the logo in the light palette, with optional padding (logo units) and background. */
async function png(size, { padding = 0, background } = {}) {
  const side = LOGO_HEIGHT + padding * 2;
  const x = -padding - (LOGO_HEIGHT - 100) / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 4}" height="${size * 4}" viewBox="${x} ${-padding} ${side} ${side}">` +
    (background ? `<rect x="${x}" y="${-padding}" width="${side}" height="${side}" fill="${background}"/>` : "") +
    LOGO_BLOCKS.map((block) => `<path d="${block.d}" fill="${LOGO_COLORS.light[block.tone - 1]}"/>`).join("") +
    "</svg>";
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

/** ICO container holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const icoImages = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })));
await writeFile(new URL("icon.svg", APP_DIR), iconSvg);
await writeFile(new URL("favicon.ico", APP_DIR), ico(icoImages));
await writeFile(new URL("apple-icon.png", APP_DIR), await png(180, { padding: 21, background: "#f8f9fb" }));
console.log("Wrote src/app/icon.svg, favicon.ico and apple-icon.png");
