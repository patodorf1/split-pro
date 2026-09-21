/**
 * Genera el favicon y todos los íconos de la app (PWA, iOS, Android, Windows)
 * a partir de un único diseño: fondo violeta del tema Lavanda y, en el centro,
 * un círculo partido verticalmente en dos mitades separadas ("mitad y mitad"):
 * la izquierda blanca y la derecha lavanda.
 *
 * El diseño de referencia vive en un lienzo de 112x112 (ver `REFERENCE`) y se
 * escala a cada tamaño. En los favicons chiquitos el círculo se agranda y la
 * separación se engrosa y se alinea a píxel entero para que no se pierda.
 *
 * Uso: `pnpm icons` (o `node scripts/generate-icons.mjs`).
 * Reescribe los archivos existentes con los mismos nombres y dimensiones, así
 * no hay que tocar referencias en _app.tsx, el manifest ni el service worker.
 * El SVG maestro resultante queda en public/icons/icon-master.svg.
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
const LAVENDER = '#cbbcf0';

/**
 * Diseño de referencia en un lienzo de 112x112: dos semicírculos de radio 30
 * centrados, separados 8 unidades.
 *   izquierdo: M52 26 A30 30 0 0 0 52 86 Z
 *   derecho:   M60 26 A30 30 0 0 1 60 86 Z
 */
const REFERENCE = { canvas: 112, radius: 30, gap: 8 };

/**
 * Diámetro del círculo sobre el lado corto del ícono. Con la proporción de
 * referencia (60/112 = 0.54) el punto más lejano del dibujo queda a 0.27 del
 * lado desde el centro, dentro de la zona segura del ícono maskable de Android
 * (círculo central del 80%, radio 0.40) y del recorte de iOS. Por eso el mismo
 * PNG sirve para "any" y "maskable" sin achicar nada.
 */
const RATIO_SAFE = (2 * REFERENCE.radius) / REFERENCE.canvas;
/** En los favicons chiquitos nadie recorta nada y conviene un círculo más grande. */
const RATIO_SMALL = 0.72;
const SMALL_SIZE = 48;

/**
 * Radio y separación para un lado corto `side` y una proporción de diámetro.
 * En tamaños chicos se redondea a píxel entero y la separación se fuerza a un
 * número par de al menos 2 px, así queda nítida y centrada.
 */
const geometry = (side, ratio) => {
  const radius = (ratio * side) / 2;
  const gap = (radius * REFERENCE.gap) / REFERENCE.radius;
  if (side > SMALL_SIZE) return { radius, gap };

  return {
    radius: Math.round(radius),
    gap: Math.max(2, Math.round(gap / 2) * 2),
  };
};

/** Números cortos en el SVG (2 decimales alcanzan de sobra). */
const n = (value) => Number(value.toFixed(2));

const buildSvg = ({ width, height, ratio, background, left = WHITE, right = LAVENDER }) => {
  const { radius, gap } = geometry(Math.min(width, height), ratio);
  const r = n(radius);
  const cx = width / 2;
  const cy = height / 2;
  const top = n(cy - r);
  const bottom = n(cy + r);
  const xl = n(cx - gap / 2);
  const xr = n(cx + gap / 2);
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}<path d="M${xl} ${top}A${r} ${r} 0 0 0 ${xl} ${bottom}Z" fill="${left}"/><path d="M${xr} ${top}A${r} ${r} 0 0 1 ${xr} ${bottom}Z" fill="${right}"/></svg>`;
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
    `${buildSvg({ width: 512, height: 512, ratio: 0.82, background: null, left: '#000000', right: '#000000' })}\n`,
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
