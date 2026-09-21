import path from 'node:path';

import {
  DOCUMENT_ACCEPT_ATTRIBUTE,
  DOCUMENT_MAX_SIZE_BYTES,
  buildContentDisposition,
  buildStorageKey,
  cleanDocumentName,
  defaultDocumentName,
  detectDocumentType,
  downloadFileName,
  formatFileSize,
  isUuid,
  isValidStorageKey,
  listZipEntries,
  matchesDocumentSearch,
  parseRangeHeader,
  sanitizeFileName,
  thumbnailKeyFor,
} from '~/lib/documents';
import { findAccessibleDocument, findAccessibleFolder } from '~/server/documents/access';
import {
  isInsideDocumentsRoot,
  resolveDocumentPath,
  resolveThumbnailPath,
} from '~/server/documents/storage';

const UUID = '3f1c2a4e-1111-4222-8333-444455556666';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const u16 = (value: number) => bytes(value & 0xff, (value >> 8) & 0xff);
const u32 = (value: number) =>
  bytes(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);

/** ZIP mínimo (sin compresión y sin contenido) con los nombres pedidos. */
const makeZip = (names: string[]) => {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const name of names) {
    const nameBytes = ascii(name);
    const local = concat(
      u32(0x04034b50),
      new Uint8Array(22),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    );
    const central = concat(
      u32(0x02014b50),
      new Uint8Array(24),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      new Uint8Array(8),
      u32(offset),
      nameBytes,
    );
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const cd = concat(...centrals);
  const eocd = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(names.length),
    u16(names.length),
    u32(cd.length),
    u32(offset),
    u16(0),
  );

  return concat(...locals, cd, eocd);
};

/** Archivo compuesto OLE2 mínimo: cabecera + un sector de directorio con estas entradas. */
const makeOle2 = (entryNames: string[]) => {
  const header = new Uint8Array(512);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const directory = new Uint8Array(512);

  entryNames.forEach((name, index) => {
    const base = index * 128;
    [...name].forEach((char, position) => {
      directory[base + position * 2] = char.charCodeAt(0);
    });
    directory.set(u16((name.length + 1) * 2), base + 64);
  });

  return concat(header, directory);
};

const PDF = concat(ascii('%PDF-1.7\n%âãÏÓ\n1 0 obj\n'), new Uint8Array(64).fill(0x20));
const JPEG = concat(bytes(0xff, 0xd8, 0xff, 0xe0), new Uint8Array(32));
const PNG = concat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), new Uint8Array(32));
const WEBP = concat(ascii('RIFF'), u32(100), ascii('WEBPVP8 '), new Uint8Array(32));
const HEIC = concat(
  bytes(0, 0, 0, 24),
  ascii('ftypheic'),
  u32(0),
  ascii('mif1heic'),
  new Uint8Array(16),
);
const AVIF = concat(
  bytes(0, 0, 0, 24),
  ascii('ftypavif'),
  u32(0),
  ascii('mif1avif'),
  new Uint8Array(16),
);
const MP4 = concat(
  bytes(0, 0, 0, 20),
  ascii('ftypisom'),
  u32(0),
  ascii('isom'),
  new Uint8Array(16),
);
const EXE = concat(ascii('MZ'), bytes(0x90, 0, 3, 0, 0, 0, 4, 0), new Uint8Array(64));
const ELF = concat(bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0), new Uint8Array(64));
const DOCX = makeZip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
const XLSX = makeZip(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml']);
const DOCM = makeZip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']);
const PLAIN_ZIP = makeZip(['foto.jpg', 'virus.exe']);
const DOC = makeOle2(['Root Entry', 'WordDocument', 'SummaryInformation']);
const XLS = makeOle2(['Root Entry', 'Workbook']);
const DOC_WITH_MACROS = makeOle2(['Root Entry', 'WordDocument', 'Macros']);
const MSG = makeOle2(['Root Entry', '__properties_version1.0']);
const TEXT = ascii('Patente AB123CD\nPóliza 4455\r\n');
const SVG = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = ascii('<!doctype html><script>alert(1)</script>');

describe('detectDocumentType (magic bytes)', () => {
  it.each([
    ['dni.pdf', PDF, 'application/pdf'],
    ['DNI FRENTE.PDF', PDF, 'application/pdf'],
    ['foto.jpg', JPEG, 'image/jpeg'],
    ['foto.jpeg', JPEG, 'image/jpeg'],
    ['captura.png', PNG, 'image/png'],
    ['imagen.webp', WEBP, 'image/webp'],
    ['IMG_1234.HEIC', HEIC, 'image/heic'],
    [
      'contrato.docx',
      DOCX,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['gastos.xlsx', XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['viejo.doc', DOC, 'application/msword'],
    ['viejo.xls', XLS, 'application/vnd.ms-excel'],
    ['notas.txt', TEXT, 'text/plain'],
  ])('accepts %s by content', (name, buffer, mimeType) => {
    const result = detectDocumentType(buffer, name);

    expect(result).toEqual({ ok: true, type: expect.objectContaining({ mimeType }) });
  });

  it('allows a PDF with a few junk bytes before the header (per spec)', () => {
    expect(detectDocumentType(concat(bytes(0xef, 0xbb, 0xbf), PDF), 'a.pdf').ok).toBe(true);
  });

  it('keeps the real type when an image has the wrong image extension', () => {
    const result = detectDocumentType(JPEG, 'IMG_0001.HEIC');

    expect(result).toEqual({ ok: true, type: expect.objectContaining({ mimeType: 'image/jpeg' }) });
  });

  it.each([
    ['programa.pdf', EXE],
    ['programa.jpg', EXE],
    ['programa.txt', EXE],
    ['linux.pdf', ELF],
    ['foto.pdf', JPEG],
    ['dni.jpg', PDF],
    ['contrato.docx', XLSX],
    ['contrato.docx', DOCM],
    ['contrato.docx', PLAIN_ZIP],
    ['viejo.doc', XLS],
    ['viejo.doc', DOC_WITH_MACROS],
    ['correo.doc', MSG],
    ['imagen.heic', AVIF],
    ['video.heic', MP4],
    ['falso.pdf', SVG],
    ['falso.pdf', HTML],
    ['notas.txt', PDF],
    ['notas.txt', bytes(0x41, 0x00, 0x42)],
  ])('rejects %s whose content does not match', (name, buffer) => {
    expect(detectDocumentType(buffer, name)).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it.each([
    ['logo.svg', SVG],
    ['pagina.html', HTML],
    ['pagina.htm', HTML],
    ['programa.exe', EXE],
    ['archivo.zip', PLAIN_ZIP],
    ['sin-extension', PDF],
    ['video.mp4', MP4],
    ['foto.avif', AVIF],
  ])('rejects the non-allowed type %s', (name, buffer) => {
    expect(detectDocumentType(buffer, name)).toEqual({ ok: false, reason: 'type_not_allowed' });
  });

  it('rejects empty files and files over the limit', () => {
    expect(detectDocumentType(new Uint8Array(0), 'a.pdf')).toEqual({ ok: false, reason: 'empty' });
    expect(detectDocumentType(PDF, 'a.pdf', PDF.length - 1)).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(DOCUMENT_MAX_SIZE_BYTES).toBe(25 * 1024 * 1024);
  });

  it('does not trust a right-to-left override hiding the real extension', () => {
    // "factura‮fdp.exe" se ve como "facturaexe.pdf" pero la extensión real es .exe.
    expect(detectDocumentType(PDF, 'factura‮fdp.exe')).toEqual({
      ok: false,
      reason: 'type_not_allowed',
    });
  });
});

describe('listZipEntries', () => {
  it('reads the central directory names', () => {
    expect(listZipEntries(DOCX)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
    ]);
  });

  it('returns null for broken or non-zip data', () => {
    expect(listZipEntries(PDF)).toBeNull();
    expect(listZipEntries(DOCX.slice(0, DOCX.length - 10))).toBeNull();
  });
});

describe('file names', () => {
  it('keeps only the last path segment and strips control/bidi characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..\\..\\windows\\win.ini')).toBe('win.ini');
    expect(sanitizeFileName('a b‮c\nd.pdf')).toBe('abc d.pdf');
    expect(sanitizeFileName('..')).toBe('');
    expect(sanitizeFileName('.hidden.pdf')).toBe('hidden.pdf');
  });

  it('keeps accents and emoji (normalized)', () => {
    expect(sanitizeFileName('Cédula 🚗 Kuga.pdf')).toBe('Cédula 🚗 Kuga.pdf');
    expect(sanitizeFileName('Cédula.pdf')).toBe('Cédula.pdf'.normalize('NFC'));
  });

  it('builds the default visible name without extension', () => {
    expect(defaultDocumentName('Póliza Kuga 2026.PDF')).toBe('Póliza Kuga 2026');
    expect(defaultDocumentName('.pdf')).toBe('pdf');
    expect(defaultDocumentName('', 'Documento')).toBe('Documento');
  });

  it('cleans edited names (no slashes, no control chars, bounded length)', () => {
    expect(cleanDocumentName('  DNI / frente\t ')).toBe('DNI - frente');
    expect(cleanDocumentName('x'.repeat(500))).toHaveLength(120);
  });

  it('adds the real extension to the download name only when missing', () => {
    expect(downloadFileName('Seguro Kuga', 'application/pdf')).toBe('Seguro Kuga.pdf');
    expect(downloadFileName('Seguro.pdf', 'application/pdf')).toBe('Seguro.pdf');
    expect(downloadFileName('Foto', 'image/jpeg')).toBe('Foto.jpg');
  });

  it('builds a safe Content-Disposition with UTF-8 name and ASCII fallback', () => {
    expect(buildContentDisposition('inline', 'Cédula "Kuga"; 🚗.pdf')).toBe(
      `inline; filename="Cedula _Kuga__ _.pdf"; filename*=UTF-8''C%C3%A9dula%20%22Kuga%22%3B%20%F0%9F%9A%97.pdf`,
    );
    const header = buildContentDisposition('attachment', 'a\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith('attachment; ')).toBe(true);
  });
});

describe('storage keys and paths', () => {
  const root = path.resolve('/app/uploads/documents');

  it('builds keys only from safe parts', () => {
    expect(buildStorageKey(1, UUID, 'pdf')).toBe(`1/${UUID}.pdf`);
    expect(() => buildStorageKey(0, UUID, 'pdf')).toThrow();
    expect(() => buildStorageKey(1, '../../etc', 'pdf')).toThrow();
    expect(() => buildStorageKey(1, UUID, 'exe')).toThrow();
    expect(() => buildStorageKey(1.5, UUID, 'pdf')).toThrow();
  });

  it('validates stored keys strictly', () => {
    expect(isValidStorageKey(`12/${UUID}.jpg`)).toBe(true);
    expect(isValidStorageKey(`12/../${UUID}.jpg`)).toBe(false);
    expect(isValidStorageKey(`/etc/${UUID}.jpg`)).toBe(false);
    expect(isValidStorageKey(`12/${UUID}.html`)).toBe(false);
    expect(isValidStorageKey(`12/${UUID}.pdf .txt`)).toBe(false);
  });

  it('resolves inside the documents root and never outside', () => {
    expect(resolveDocumentPath(`1/${UUID}.pdf`, root)).toBe(path.join(root, '1', `${UUID}.pdf`));
    expect(resolveDocumentPath(`../${UUID}.pdf`, root)).toBeNull();
    expect(resolveDocumentPath('1/../../../etc/passwd', root)).toBeNull();
    expect(resolveThumbnailPath(`1/${UUID}.jpg`, root)).toBe(
      path.join(root, '1', `${UUID}-thumb.webp`),
    );
    expect(thumbnailKeyFor(`1/${UUID}.jpeg`)).toBe(`1/${UUID}-thumb.webp`);
  });

  it('detects paths under uploads/documents (case-insensitive) to block them in /api/files', () => {
    const uploads = path.resolve('/app/uploads');
    expect(isInsideDocumentsRoot(path.join(uploads, 'documents', '1', 'x.pdf'), uploads)).toBe(
      true,
    );
    expect(isInsideDocumentsRoot(path.join(uploads, 'Documents', '1', 'x.pdf'), uploads)).toBe(
      true,
    );
    expect(isInsideDocumentsRoot(path.join(uploads, 'documents'), uploads)).toBe(true);
    expect(isInsideDocumentsRoot(path.join(uploads, '1', 'photo.webp'), uploads)).toBe(false);
    expect(isInsideDocumentsRoot(path.join(uploads, 'documents-old', 'a'), uploads)).toBe(false);
  });

  it('recognizes uuids', () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid('../3f1c2a4e')).toBe(false);
    expect(isUuid(`${UUID}/../x`)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('parseRangeHeader', () => {
  it.each([
    ['bytes=0-99', 1000, { start: 0, end: 99 }],
    ['bytes=100-', 1000, { start: 100, end: 999 }],
    ['bytes=-100', 1000, { start: 900, end: 999 }],
    ['bytes=0-5000', 1000, { start: 0, end: 999 }],
    ['bytes=-5000', 1000, { start: 0, end: 999 }],
  ])('parses %s', (header, size, expected) => {
    expect(parseRangeHeader(header, size)).toEqual(expected);
  });

  it.each([
    ['bytes=1000-', 1000],
    ['bytes=500-100', 1000],
    ['bytes=-0', 1000],
  ])('marks %s as unsatisfiable', (header, size) => {
    expect(parseRangeHeader(header, size)).toBe('unsatisfiable');
  });

  it.each([undefined, '', 'items=0-1', 'bytes=0-1,5-6', 'bytes=abc', 'bytes=-'])(
    'ignores %s (serves the whole file)',
    (header) => {
      expect(parseRangeHeader(header, 1000)).toBeNull();
    },
  );
});

describe('presentation helpers', () => {
  it('formats sizes', () => {
    expect(formatFileSize(512, 'en')).toBe('512 B');
    expect(formatFileSize(1536, 'en')).toBe('1.5 KB');
    expect(formatFileSize(25 * 1024 * 1024, 'en')).toBe('25 MB');
  });

  it('searches ignoring accents, case and word order', () => {
    expect(matchesDocumentSearch('Cédula verde Kuga', 'cedula')).toBe(true);
    expect(matchesDocumentSearch('Cédula verde Kuga', 'KUGA céd')).toBe(true);
    expect(matchesDocumentSearch('Cédula verde Kuga', 'fox')).toBe(false);
    expect(matchesDocumentSearch('Cédula verde Kuga', '   ')).toBe(false);
  });

  it('offers files, photos and camera on iPhone (extensions + mime types, no capture)', () => {
    expect(DOCUMENT_ACCEPT_ATTRIBUTE).toContain('.pdf');
    expect(DOCUMENT_ACCEPT_ATTRIBUTE).toContain('image/heic');
    expect(DOCUMENT_ACCEPT_ATTRIBUTE).not.toContain('svg');
    expect(DOCUMENT_ACCEPT_ATTRIBUTE).not.toContain('html');
  });
});

describe('access checks (membership is always part of the query)', () => {
  const makeDb = () => {
    const document = { findFirst: jest.fn().mockResolvedValue(null) };
    const documentFolder = { findFirst: jest.fn().mockResolvedValue(null) };
    return { db: { document, documentFolder } as never, document, documentFolder };
  };

  it('filters documents by id, not deleted and group membership', async () => {
    const { db, document } = makeDb();

    await findAccessibleDocument(db, UUID, 7);

    expect(document.findFirst).toHaveBeenCalledWith({
      where: { id: UUID, deletedAt: null, group: { groupUsers: { some: { userId: 7 } } } },
    });
  });

  it.each(['../../etc/passwd', `${UUID}/..`, '', 'x', 12, null])(
    'does not even query for a malformed document id %p',
    async (id) => {
      const { db, document } = makeDb();

      await expect(findAccessibleDocument(db, id, 7)).resolves.toBeNull();
      expect(document.findFirst).not.toHaveBeenCalled();
    },
  );

  it('filters folders by group membership and rejects bad ids', async () => {
    const { db, documentFolder } = makeDb();

    await findAccessibleFolder(db, 3, 2);
    expect(documentFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 3, group: { groupUsers: { some: { userId: 2 } } } },
    });

    documentFolder.findFirst.mockClear();
    for (const bad of [0, -1, 1.5, Number.NaN, '3', null]) {
      await expect(findAccessibleFolder(db, bad, 2)).resolves.toBeNull();
    }
    expect(documentFolder.findFirst).not.toHaveBeenCalled();
  });
});
