/**
 * Genera los íconos PWA desde la firma elegida (C50 dentro de la C).
 * - icon-192.png / icon-512.png  → full-bleed navy (purpose "any")
 * - icon-maskable-512.png        → contenido en zona segura para recorte Android
 *
 * Uso: node scripts/make-app-icons.mjs
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'public/brand/app-icon-source.png');
const OUT = path.join(root, 'public/icons');
const NAVY = { r: 11, g: 31, b: 58 }; // #0B1F3A

async function coreSquare() {
  // El render tiene esquinas redondeadas con triángulos blancos; los lados
  // rectos ya son navy a sangre. Reemplazamos los píxeles casi-blancos por
  // navy para obtener un cuadrado a sangre completa, sin recortar contenido.
  const { data, info } = await sharp(SRC)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
    if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
      data[i] = NAVY.r;
      data[i + 1] = NAVY.g;
      data[i + 2] = NAVY.b;
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: ch },
  })
    .png()
    .toBuffer();
}

async function main() {
  const core = await coreSquare();

  for (const size of [192, 512]) {
    await sharp(core)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(OUT, `icon-${size}.png`));
  }

  // Maskable: contenido al ~80% sobre lienzo navy (safe zone circular Android)
  const inner = Math.round(512 * 0.8);
  const innerBuf = await sharp(core).resize(inner, inner).png().toBuffer();
  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { ...NAVY, alpha: 1 },
    },
  })
    .composite([{ input: innerBuf, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT, 'icon-maskable-512.png'));

  console.log('Íconos generados en public/icons/: icon-192, icon-512, icon-maskable-512');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
