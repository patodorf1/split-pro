/**
 * Lógica pura de Documentos (Casa): tipos permitidos, detección por contenido (magic bytes),
 * nombres de archivo seguros, rangos de descarga y armado de la clave de guardado.
 *
 * No toca disco ni base: la usan el endpoint de subida, el de descarga, el router de tRPC y la UI,
 * y se testea sin nada de eso.
 */

/** Tope por archivo. Un PDF escaneado de varias páginas entra holgado. */
export const DOCUMENT_MAX_SIZE_MB = 25;
export const DOCUMENT_MAX_SIZE_BYTES = DOCUMENT_MAX_SIZE_MB * 1024 * 1024;

export const MAX_DOCUMENT_NAME_LENGTH = 120;
export const MAX_FOLDER_NAME_LENGTH = 40;

/** Íconos que se pueden elegir para una sección (claves de lucide, ver `DocumentFolderIcon`). */
export const DOCUMENT_FOLDER_ICONS = [
  'folder',
  'user',
  'baby',
  'smile',
  'heart',
  'car',
  'bike',
  'sailboat',
  'house',
  'dog',
  'plane',
  'stethoscope',
  'shield',
  'briefcase',
  'graduation-cap',
  'wallet',
] as const;

export type DocumentFolderIconKey = (typeof DOCUMENT_FOLDER_ICONS)[number];

export const isDocumentFolderIcon = (value: string): value is DocumentFolderIconKey =>
  (DOCUMENT_FOLDER_ICONS as readonly string[]).includes(value);

export type DocumentKind =
  | 'pdf'
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'heic'
  | 'heif'
  | 'doc'
  | 'docx'
  | 'xls'
  | 'xlsx'
  | 'txt';

export interface DocumentTypeInfo {
  kind: DocumentKind;
  mimeType: string;
  /** Extensión canónica con la que se guarda y se descarga. */
  ext: string;
  /** Extensiones aceptadas en el nombre original para este tipo. */
  extensions: readonly string[];
  /** ¿Se puede mostrar en el navegador (inline)? El resto siempre se descarga. */
  inline: boolean;
  isImage: boolean;
}

export const DOCUMENT_TYPES: Record<DocumentKind, DocumentTypeInfo> = {
  pdf: {
    kind: 'pdf',
    mimeType: 'application/pdf',
    ext: 'pdf',
    extensions: ['pdf'],
    inline: true,
    isImage: false,
  },
  jpeg: {
    kind: 'jpeg',
    mimeType: 'image/jpeg',
    ext: 'jpg',
    extensions: ['jpg', 'jpeg'],
    inline: true,
    isImage: true,
  },
  png: {
    kind: 'png',
    mimeType: 'image/png',
    ext: 'png',
    extensions: ['png'],
    inline: true,
    isImage: true,
  },
  webp: {
    kind: 'webp',
    mimeType: 'image/webp',
    ext: 'webp',
    extensions: ['webp'],
    inline: true,
    isImage: true,
  },
  heic: {
    kind: 'heic',
    mimeType: 'image/heic',
    ext: 'heic',
    extensions: ['heic'],
    inline: true,
    isImage: true,
  },
  heif: {
    kind: 'heif',
    mimeType: 'image/heif',
    ext: 'heif',
    extensions: ['heif'],
    inline: true,
    isImage: true,
  },
  doc: {
    kind: 'doc',
    mimeType: 'application/msword',
    ext: 'doc',
    extensions: ['doc'],
    inline: false,
    isImage: false,
  },
  docx: {
    kind: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    extensions: ['docx'],
    inline: false,
    isImage: false,
  },
  xls: {
    kind: 'xls',
    mimeType: 'application/vnd.ms-excel',
    ext: 'xls',
    extensions: ['xls'],
    inline: false,
    isImage: false,
  },
  xlsx: {
    kind: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    extensions: ['xlsx'],
    inline: false,
    isImage: false,
  },
  txt: {
    kind: 'txt',
    mimeType: 'text/plain',
    ext: 'txt',
    extensions: ['txt'],
    inline: true,
    isImage: false,
  },
};

const ALL_TYPES = Object.values(DOCUMENT_TYPES);

/** Extensiones permitidas (sin punto, en minúscula). */
export const ALLOWED_DOCUMENT_EXTENSIONS: readonly string[] = ALL_TYPES.flatMap(
  (type) => type.extensions,
);

/**
 * Valor para `<input type="file" accept>`. Va con extensiones Y mime types: en iPhone así el
 * selector ofrece Fototeca, Cámara y Archivos.
 */
export const DOCUMENT_ACCEPT_ATTRIBUTE = [
  ...ALLOWED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`),
  ...ALL_TYPES.map((type) => type.mimeType),
].join(',');

export const getDocumentTypeByMime = (mimeType: string): DocumentTypeInfo | null =>
  ALL_TYPES.find((type) => type.mimeType === mimeType) ?? null;

/** ¿El mime guardado es de una imagen (con miniatura posible)? */
export const isImageMime = (mimeType: string): boolean =>
  getDocumentTypeByMime(mimeType)?.isImage ?? false;

// ---------------------------------------------------------------------------------------------
// Nombres de archivo
// ---------------------------------------------------------------------------------------------

/**
 * Caracteres invisibles o de control de dirección. El clásico truco "factura‮fdp.exe" se ve como
 * "factura.exe.pdf": se sacan siempre.
 */
const INVISIBLE_CHARS = new RegExp(
  // oxlint-disable-next-line no-control-regex -- justamente busca caracteres de control
  '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]',
  'g',
);

/**
 * Deja un nombre de archivo presentable y sin sorpresas: sólo la última parte de una ruta, sin
 * caracteres de control ni de dirección, normalizado (NFC), sin espacios de más y con un largo
 * razonable. Nunca devuelve "", "." ni "..".
 */
export const sanitizeFileName = (raw: string, maxLength = 180): string => {
  const lastSegment = String(raw ?? '')
    .split(/[\\/]/)
    .pop();
  const cleaned = (lastSegment ?? '')
    .normalize('NFC')
    .replace(/[\t\n\v\f\r]/g, ' ')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();

  const result = Array.from(cleaned).slice(0, maxLength).join('').trim();

  return result;
};

/** Separa "Póliza 2026.PDF" en { base: "Póliza 2026", ext: "pdf" }. */
export const splitExtension = (fileName: string): { base: string; ext: string } => {
  const dot = fileName.lastIndexOf('.');

  if (dot <= 0 || dot === fileName.length - 1) {
    return { base: fileName, ext: '' };
  }

  return { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() };
};

/** Nombre visible inicial de un documento recién subido: el original sin la extensión. */
export const defaultDocumentName = (originalName: string, fallback = 'Documento'): string => {
  const clean = sanitizeFileName(originalName);
  const { base } = splitExtension(clean);
  const name = cleanDocumentName(base);

  return name || fallback;
};

/** Nombre visible editable: sin control chars, sin barras, un solo espacio, largo acotado. */
export const cleanDocumentName = (raw: string): string =>
  Array.from(
    String(raw ?? '')
      .normalize('NFC')
      .replace(/[\t\n\v\f\r]/g, ' ')
      .replace(INVISIBLE_CHARS, '')
      .replace(/[\\/]/g, '-')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, MAX_DOCUMENT_NAME_LENGTH)
    .join('')
    .trim();

/** Nombre del archivo al descargar o compartir: el nombre visible + la extensión real. */
export const downloadFileName = (name: string, mimeType: string): string => {
  const ext = getDocumentTypeByMime(mimeType)?.ext ?? '';
  const base = cleanDocumentName(name) || 'documento';

  if (!ext) {
    return base;
  }

  return splitExtension(base).ext === ext ? base : `${base}.${ext}`;
};

/**
 * Header `Content-Disposition` con el nombre en UTF-8 (RFC 6266 / 5987) y un respaldo ASCII para
 * navegadores viejos. Sin comillas, barras ni saltos de línea que rompan el header.
 */
export const buildContentDisposition = (
  disposition: 'inline' | 'attachment',
  fileName: string,
): string => {
  const safe = sanitizeFileName(fileName) || 'documento';
  const asciiFallback =
    safe
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/gu, '_')
      .replace(/["\\;%]/g, '_')
      .trim() || 'documento';
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
};

// ---------------------------------------------------------------------------------------------
// Detección por contenido
// ---------------------------------------------------------------------------------------------

export type DocumentRejectReason = 'empty' | 'too_large' | 'type_not_allowed' | 'type_mismatch';

export type DocumentDetection =
  | { ok: true; type: DocumentTypeInfo }
  | { ok: false; reason: DocumentRejectReason };

const startsWithBytes = (buffer: Uint8Array, bytes: number[], offset = 0): boolean =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, index) => buffer[offset + index] === byte);

const asciiAt = (buffer: Uint8Array, offset: number, length: number): string => {
  if (buffer.length < offset + length) {
    return '';
  }

  let result = '';
  for (let index = offset; index < offset + length; index += 1) {
    result += String.fromCharCode(buffer[index]!);
  }

  return result;
};

const readUInt16LE = (buffer: Uint8Array, offset: number): number =>
  buffer[offset]! | (buffer[offset + 1]! << 8);

const readUInt32LE = (buffer: Uint8Array, offset: number): number =>
  (buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16)) +
  buffer[offset + 3]! * 0x1000000;

const readUInt32BE = (buffer: Uint8Array, offset: number): number =>
  buffer[offset]! * 0x1000000 +
  ((buffer[offset + 1]! << 16) | (buffer[offset + 2]! << 8) | buffer[offset + 3]!);

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** El estándar permite basura antes de `%PDF-` dentro del primer KB. */
const isPdf = (buffer: Uint8Array): boolean => {
  const limit = Math.min(buffer.length - PDF_SIGNATURE.length, 1024);

  for (let offset = 0; offset <= limit; offset += 1) {
    if (startsWithBytes(buffer, PDF_SIGNATURE, offset)) {
      return true;
    }
  }

  return false;
};

/** HEIC/HEIF: caja `ftyp` al principio con una marca de la familia (y que no sea AVIF). */
const detectHeif = (buffer: Uint8Array): DocumentKind | null => {
  if ('ftyp' !== asciiAt(buffer, 4, 4)) {
    return null;
  }

  const boxSize = Math.min(readUInt32BE(buffer, 0), buffer.length, 256);
  const major = asciiAt(buffer, 8, 4);

  if (AVIF_BRANDS.has(major)) {
    return null;
  }

  const brands = [major];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(asciiAt(buffer, offset, 4));
  }

  if (brands.some((brand) => HEIC_BRANDS.has(brand))) {
    return 'heic';
  }
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) {
    return 'heif';
  }

  return null;
};

/**
 * Lista los nombres de un ZIP leyendo su directorio central (no descomprime nada). Devuelve null
 * si el ZIP está roto o es ZIP64 (con 25 MB nunca hace falta).
 */
export const listZipEntries = (buffer: Uint8Array, maxEntries = 5000): string[] | null => {
  const minEocd = 22;

  if (buffer.length < minEocd) {
    return null;
  }

  let eocd = -1;
  const stop = Math.max(0, buffer.length - minEocd - 0xffff);
  for (let offset = buffer.length - minEocd; offset >= stop; offset -= 1) {
    if (0x06054b50 === readUInt32LE(buffer, offset)) {
      eocd = offset;
      break;
    }
  }

  if (-1 === eocd) {
    return null;
  }

  const entries = readUInt16LE(buffer, eocd + 10);
  const cdSize = readUInt32LE(buffer, eocd + 12);
  const cdOffset = readUInt32LE(buffer, eocd + 16);

  if (
    0xffff === entries ||
    0xffffffff === cdOffset ||
    cdOffset + cdSize > buffer.length ||
    entries > maxEntries
  ) {
    return null;
  }

  const names: string[] = [];
  let offset = cdOffset;

  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || 0x02014b50 !== readUInt32LE(buffer, offset)) {
      return null;
    }

    const nameLength = readUInt16LE(buffer, offset + 28);
    const extraLength = readUInt16LE(buffer, offset + 30);
    const commentLength = readUInt16LE(buffer, offset + 32);

    if (offset + 46 + nameLength > buffer.length) {
      return null;
    }

    names.push(asciiAt(buffer, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
};

/** Docx/xlsx: ZIP con la estructura de Office Open XML y sin macros. */
const detectOfficeOpenXml = (buffer: Uint8Array): DocumentKind | null => {
  const names = listZipEntries(buffer);

  if (!names || !names.includes('[Content_Types].xml')) {
    return null;
  }
  if (names.some((name) => /vbaproject\.bin$/i.test(name))) {
    return null;
  }
  if (names.includes('word/document.xml')) {
    return 'docx';
  }
  if (names.includes('xl/workbook.xml')) {
    return 'xlsx';
  }

  return null;
};

/**
 * ¿Hay una entrada de directorio de un archivo compuesto OLE2 con este nombre? Las entradas miden
 * 128 bytes, empiezan alineadas y guardan el nombre en UTF-16LE con su largo en el byte 64.
 */
const hasCfbEntry = (buffer: Uint8Array, name: string): boolean => {
  const expectedLength = (name.length + 1) * 2;

  for (let offset = 512; offset + 128 <= buffer.length; offset += 128) {
    if (readUInt16LE(buffer, offset + 64) !== expectedLength) {
      continue;
    }

    let matches = true;
    for (let index = 0; index < name.length; index += 1) {
      if (
        buffer[offset + index * 2] !== name.charCodeAt(index) ||
        0 !== buffer[offset + index * 2 + 1]
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
};

/** Doc/xls viejos (OLE2): se reconocen por la entrada principal; con macros se rechazan. */
const detectOle2 = (buffer: Uint8Array): DocumentKind | null => {
  if (hasCfbEntry(buffer, '_VBA_PROJECT') || hasCfbEntry(buffer, 'Macros')) {
    return null;
  }
  if (hasCfbEntry(buffer, 'WordDocument')) {
    return 'doc';
  }
  if (hasCfbEntry(buffer, 'Workbook')) {
    return 'xls';
  }

  return null;
};

/**
 * Texto plano: no hay firma, así que se exige que no tenga bytes nulos ni controles raros (un
 * binario renombrado a .txt los tiene casi siempre).
 */
const isPlainText = (buffer: Uint8Array): boolean => {
  for (const byte of buffer) {
    if (0 === byte || (byte < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d, 0x1b].includes(byte))) {
      return false;
    }
  }

  return true;
};

/** Tipo real según los primeros bytes (y el directorio si es ZIP u OLE2). */
export const sniffDocumentKind = (buffer: Uint8Array): DocumentKind | null => {
  if (isPdf(buffer)) {
    return 'pdf';
  }
  if (startsWithBytes(buffer, JPEG_SIGNATURE)) {
    return 'jpeg';
  }
  if (startsWithBytes(buffer, PNG_SIGNATURE)) {
    return 'png';
  }
  if ('RIFF' === asciiAt(buffer, 0, 4) && 'WEBP' === asciiAt(buffer, 8, 4)) {
    return 'webp';
  }

  const heif = detectHeif(buffer);
  if (heif) {
    return heif;
  }

  if (startsWithBytes(buffer, ZIP_SIGNATURE)) {
    return detectOfficeOpenXml(buffer);
  }
  if (startsWithBytes(buffer, OLE2_SIGNATURE)) {
    return detectOle2(buffer);
  }

  return null;
};

/**
 * Decide si un archivo subido se acepta y con qué tipo. Tiene que coincidir lo que dice la
 * extensión con lo que dice el contenido; entre imágenes se tolera la diferencia (el iPhone a
 * veces convierte HEIC a JPEG sin cambiar el nombre) y se guarda el tipo real.
 */
export const detectDocumentType = (
  buffer: Uint8Array,
  originalName: string,
  maxSize = DOCUMENT_MAX_SIZE_BYTES,
): DocumentDetection => {
  if (0 === buffer.length) {
    return { ok: false, reason: 'empty' };
  }
  if (buffer.length > maxSize) {
    return { ok: false, reason: 'too_large' };
  }

  const { ext } = splitExtension(sanitizeFileName(originalName));

  if (!ext || !ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) {
    return { ok: false, reason: 'type_not_allowed' };
  }

  const claimed = ALL_TYPES.find((type) => type.extensions.includes(ext))!;
  const sniffed = sniffDocumentKind(buffer);

  if ('txt' === claimed.kind) {
    // Si el contenido tiene firma de otro tipo, no es texto: no se acepta disfrazado.
    return null === sniffed && isPlainText(buffer)
      ? { ok: true, type: DOCUMENT_TYPES.txt }
      : { ok: false, reason: 'type_mismatch' };
  }

  if (null === sniffed) {
    return { ok: false, reason: 'type_mismatch' };
  }

  const actual = DOCUMENT_TYPES[sniffed];

  if (actual.kind === claimed.kind || (actual.isImage && claimed.isImage)) {
    return { ok: true, type: actual };
  }

  return { ok: false, reason: 'type_mismatch' };
};

// ---------------------------------------------------------------------------------------------
// Guardado y descarga
// ---------------------------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  'string' === typeof value && UUID_PATTERN.test(value);

const STORAGE_KEY_PATTERN = new RegExp(
  `^[1-9]\\d{0,9}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${ALL_TYPES.map(
    (type) => type.ext,
  ).join('|')})$`,
);

/**
 * Clave de guardado relativa a la carpeta de documentos: `<groupId>/<uuid>.<ext>`. Nunca lleva el
 * nombre original. Tira error si alguna parte no tiene la forma esperada.
 */
export const buildStorageKey = (groupId: number, id: string, ext: string): string => {
  const key = `${groupId}/${String(id).toLowerCase()}.${ext}`;

  if (!Number.isSafeInteger(groupId) || groupId <= 0 || !isValidStorageKey(key)) {
    throw new Error('Invalid storage key parts');
  }

  return key;
};

export const isValidStorageKey = (key: unknown): key is string =>
  'string' === typeof key && STORAGE_KEY_PATTERN.test(key);

/** Miniatura de una imagen: al lado del original, `<uuid>-thumb.webp`. */
export const thumbnailKeyFor = (storageKey: string): string =>
  storageKey.replace(/\.[a-z]+$/, '-thumb.webp');

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Header `Range` simple (un solo rango en bytes). Devuelve el rango, `'unsatisfiable'` si pide
 * fuera del archivo, o null si no hay header o no se entiende (se responde el archivo entero).
 */
export const parseRangeHeader = (
  header: string | string[] | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null => {
  if ('string' !== typeof header || !header.startsWith('bytes=') || header.includes(',')) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  if (!match || ('' === match[1] && '' === match[2])) {
    return null;
  }

  if (0 === size) {
    return 'unsatisfiable';
  }

  if ('' === match[1]) {
    // "bytes=-500": los últimos 500 bytes.
    const suffix = Number(match[2]);

    if (0 === suffix) {
      return 'unsatisfiable';
    }

    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = '' === match[2] ? size - 1 : Math.min(Number(match[2]), size - 1);

  if (!Number.isSafeInteger(start) || start >= size || end < start) {
    return 'unsatisfiable';
  }

  return { start, end };
};

// ---------------------------------------------------------------------------------------------
// Presentación y búsqueda
// ---------------------------------------------------------------------------------------------

/** "1,2 MB", "830 KB". */
export const formatFileSize = (bytes: number, locale = 'es'): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Math.max(0, bytes);
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = 0 === unit || value >= 10 ? 0 : 1;

  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
};

/** Clave de búsqueda: sin acentos ni mayúsculas ("cedula" encuentra "Cédula"). */
export const normalizeForSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** ¿El nombre contiene todas las palabras buscadas, en cualquier orden? */
export const matchesDocumentSearch = (name: string, query: string): boolean => {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);

  if (0 === words.length) {
    return false;
  }

  const haystack = normalizeForSearch(name);

  return words.every((word) => haystack.includes(word));
};
