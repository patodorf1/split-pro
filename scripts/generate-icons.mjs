/**
 * Genera el favicon y todos los íconos de la app (PWA, iOS, Android, Windows)
 * a partir de un único SVG maestro: fondo violeta del tema Lavanda y una "S"
 * blanca centrada.
 *
 * La "S" es un trazo vectorial (dos arcos de circunferencia, estilo geométrico
 * tipo Poppins) convertido a path, así el render no depende de ninguna fuente
 * instalada en la máquina.
 *
 * Uso: `pnpm icons` (o `node scripts/generate-icons.mjs`).
 * Reescribe los archivos existentes con los mismos nombres y dimensiones, así
 * no hay que tocar referencias en _app.tsx, el manifest ni el service worker.
 */
import { Buffer } from 'node:buffer';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

/** Tokens del tema Lavanda (src/styles/globals.css). */
const VIOLET = '#7351bd'; // --primary: hsl(259 45% 53%)
const WHITE = '#ffffff';

/**
 * "S" dibujada como trazo en una caja local de 100x100: dos arcos elípticos de
 * 24x20 centrados en (50,30) y (50,70), con terminales arriba a la derecha y
 * abajo a la izquierda. Proporción y peso al tono de una Poppins bold, pero
 * resuelto con un path, sin depender de la fuente.
 * `S_BOX` es el bounding box real del trazo (incluye el grosor).
 */
const S_PATH = 'M70.78 20A24 20 0 1 0 50 50A24 20 0 1 1 29.22 80';
const S_STROKE = 16;
const S_BOX = { width: 64, height: 96, cx: 50, cy: 50 };

/**
 * Proporción de la altura del ícono que ocupa la "S". Con 0.58 la letra entra
 * completa en el 60% central (el margen de seguridad que pide el ícono
 * maskable de Android y el recorte de iOS): 297x198 px sobre un lienzo de 512.
 */
const RATIO_SAFE = 0.58;
/** En los favicons chiquitos nadie recorta nada y conviene una S más grande. */
const RATIO_SMALL = 0.78;
const SMALL_SIZE = 48;

const buildSvg = ({ width, height, ratio, background, foreground = WHITE }) => {
  const scale = (ratio * Math.min(width, height)) / S_BOX.height;
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}<g transform="translate(${width / 2} ${height / 2}) scale(${scale}) translate(${-S_BOX.cx} ${-S_BOX.cy})"><path d="${S_PATH}" fill="none" stroke="${foreground}" stroke-width="${S_STROKE}" stroke-linecap="round"/></g></svg>`;
};

const renderPng = async (width, height, ratio) =>
  sharp(Buffer.from(buildSvg({ width, height, ratio, background: VIOLET })))
    .png()
    .toBuffer();

/** Junta varios PNG en un .ico (el formato admite PNG embebido desde Vista). */
const buildIco = (pngs) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(256 === size ? 0 : size, 0);
    entry.writeUInt8(256 === size ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]);
};

const listPngs = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPngs(full)));
    } else if (entry.name.endsWith('.png')) {
      files.push(full);
    }
  }

  return files;
};

const main = async () => {
  // SVG maestro: el que se edita si algún día cambia la marca.
  await writeFile(
    path.join(PUBLIC_DIR, 'icons', 'icon-master.svg'),
    `${buildSvg({ width: 512, height: 512, ratio: RATIO_SAFE, background: VIOLET })}\n`,
  );

  // Safari pinned tab: monocromo y con fondo transparente, lo recolorea Safari.
  await writeFile(
    path.join(PUBLIC_DIR, 'icons', 'safari-pinned-tab.svg'),
    `${buildSvg({ width: 512, height: 512, ratio: 0.82, background: null, foreground: '#000000' })}\n`,
  );

  const targets = [];
  for (const dir of ['icons', 'manifest']) {
    const full = path.join(PUBLIC_DIR, dir);
    if (await stat(full).catch(() => null)) {
      targets.push(...(await listPngs(full)));
    }
  }

  for (const file of targets) {
    const { width, height } = await sharp(await readFile(file)).metadata();
    if (!width || !height) {
      console.warn(`saltado (sin dimensiones): ${path.relative(ROOT, file)}`);
      continue;
    }
    const ratio = Math.min(width, height) <= SMALL_SIZE ? RATIO_SMALL : RATIO_SAFE;
    await writeFile(file, await renderPng(width, height, ratio));
    console.log(`${path.relative(ROOT, file)} ${width}x${height}`);
  }

  const icoSizes = [16, 32, 48];
  const ico = buildIco(
    await Promise.all(
      icoSizes.map(async (size) => ({ size, data: await renderPng(size, size, RATIO_SMALL) })),
    ),
  );
  await writeFile(path.join(PUBLIC_DIR, 'favicon.ico'), ico);
  console.log(`public/favicon.ico ${icoSizes.join('/')}`);
};

await main();
