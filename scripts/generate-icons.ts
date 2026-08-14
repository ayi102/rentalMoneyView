/**
 * Generate the PWA / home-screen icons in public/ from one vector source.
 *
 * The generated PNGs are committed, so you only need to re-run this if you change
 * the mark or the palette:
 *   npx tsx scripts/generate-icons.ts
 *
 * The mark is drawn as plain rectangles rather than text, so rasterizing never
 * depends on a font being installed.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ACCENT = "#1f6feb";

/**
 * @param size    output pixel size
 * @param inset   fraction of the canvas left empty around the mark. Maskable
 *                icons need the content inside the middle ~80% because the OS
 *                crops them to an arbitrary shape (circle, squircle, …).
 * @param rounded round the background corners. Maskable icons must be full-bleed
 *                — the OS applies its own mask — so they pass false.
 */
function svg(size: number, inset: number, rounded: boolean): string {
  const radius = rounded ? size * 0.22 : 0;

  // Three ascending bars, evoking the charts the app is built around.
  const area = size * (1 - inset * 2);
  const x0 = size * inset;
  const gap = area * 0.12;
  const barW = (area - gap * 2) / 3;
  const heights = [0.42, 0.68, 1.0].map((h) => area * h);
  const baseY = size * inset + area;
  const barR = barW * 0.28;

  const bars = heights
    .map((h, i) => {
      const x = x0 + i * (barW + gap);
      const y = baseY - h;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="${barR.toFixed(2)}" fill="#ffffff"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius.toFixed(2)}" fill="${ACCENT}"/>
  ${bars}
</svg>`;
}

interface Target {
  file: string;
  size: number;
  inset: number;
  rounded: boolean;
}

const targets: Target[] = [
  { file: "icon-192.png", size: 192, inset: 0.26, rounded: true },
  { file: "icon-512.png", size: 512, inset: 0.26, rounded: true },
  // Extra padding + full bleed for Android's adaptive masking.
  { file: "icon-maskable-512.png", size: 512, inset: 0.32, rounded: false },
  { file: "apple-touch-icon.png", size: 180, inset: 0.26, rounded: true },
];

async function main() {
  const outDir = path.resolve("public");
  fs.mkdirSync(outDir, { recursive: true });

  for (const t of targets) {
    const out = path.join(outDir, t.file);
    await sharp(Buffer.from(svg(t.size, t.inset, t.rounded)))
      .png()
      .toFile(out);
    console.log(`  ${t.file}  ${t.size}x${t.size}`);
  }

  // Also emit the vector for the browser tab, which can use it at any size.
  fs.writeFileSync(path.join(outDir, "icon.svg"), svg(512, 0.26, true));
  console.log("  icon.svg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
