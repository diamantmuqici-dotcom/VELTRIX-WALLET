// Renders the raster assets the Android shell needs from SVG sources:
//  - legacy launcher icons (API 24–25) in every density bucket
//  - the widget picker preview
// Usage: npm install && npm run render   (outputs are committed under android/app/src/main/res)
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RES = join(here, '../../android/app/src/main/res');
const FONT = process.env.VELTRIX_ICON_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const BG = '#0C1018';
const MARK = '#F3F5F9';
const FACET = '#2DD4A7';
// The VELTRIX "V" mark in a 64-unit artboard (same geometry as the in-app LogoMark).
const markPaths = (scale, tx, ty) =>
  `<g transform="translate(${tx} ${ty}) scale(${scale})"><path d="M17 19h8.5L32 37.5 38.5 19H47L35.6 46h-7.2z" fill="${MARK}"/><path d="M38.5 19H47l-4 9.5h-8.3z" fill="${FACET}"/></g>`;

const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${BG}"/>${markPaths(1.12, -3.84, -4.4)}</svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${BG}"/>${markPaths(1.05, -1.6, -2.1)}</svg>`;

const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

function render(svg, width, out, withFont = false) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: withFont && existsSync(FONT) ? { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' } : { loadSystemFonts: false },
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, r.render().asPng());
  console.log('wrote', out.replace(RES, 'res'));
}

for (const [d, px] of Object.entries(DENSITIES)) {
  render(square, px, join(RES, `mipmap-${d}`, 'ic_launcher.png'));
  render(round, px, join(RES, `mipmap-${d}`, 'ic_launcher_round.png'));
}

// Widget preview: an obsidian demo card with the permanent DEMO CARD label.
const preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 404">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1d22"/><stop offset="0.55" stop-color="#26292f"/><stop offset="1" stop-color="#0a0b0d"/></linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.15"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="640" height="404" rx="34" fill="url(#g)"/>
  <rect width="640" height="404" rx="34" fill="url(#s)"/>
  <rect x="1" y="1" width="638" height="402" rx="33" fill="none" stroke="#fff" stroke-opacity="0.15" stroke-width="2"/>
  <text x="42" y="74" fill="#f6f7f9" font-size="30" font-weight="700" letter-spacing="2">Everyday · DEMO</text>
  <rect x="404" y="40" width="196" height="46" rx="23" fill="#fff" fill-opacity="0.15" stroke="#fff" stroke-opacity="0.55" stroke-width="2"/>
  <text x="502" y="70" text-anchor="middle" fill="#f6f7f9" font-size="19" font-weight="700" letter-spacing="2">DEMO CARD</text>
  <text x="42" y="238" fill="#f6f7f9" font-size="60" font-weight="700">$ ••••</text>
  <text x="42" y="286" fill="#f6f7f9" fill-opacity="0.66" font-size="25">Simulator — not a real card</text>
  <text x="42" y="366" fill="#f6f7f9" font-size="32" font-weight="700" letter-spacing="3">•••• 2048</text>
</svg>`;
render(preview, 640, join(RES, 'drawable-nodpi', 'widget_preview.png'), true);
