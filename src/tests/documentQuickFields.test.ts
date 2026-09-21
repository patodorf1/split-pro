import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import {
  MAX_QUICK_FIELD_LENGTH,
  compactQuickFields,
  parseStoredQuickFields,
  quickFieldPreview,
  quickFieldsInputSchema,
} from '~/lib/documentQuickFields';
import { updateFolderQuickFields } from '~/server/documents/quickFields';
import { copyText, copyWithTextarea } from '~/utils/clipboard';

describe('quickFieldsInputSchema', () => {
  it('trims values and keeps only the ones with text', () => {
    expect(
      quickFieldsInputSchema.parse({
        dni: '  30.123.456 ',
        pasaporte: '',
        obraSocial: '   ',
        nacimiento: '12/03/1985',
      }),
    ).toEqual({ dni: '30.123.456', nacimiento: '12/03/1985' });
  });

  it('accepts an empty object (clears everything)', () => {
    expect(quickFieldsInputSchema.parse({})).toEqual({});
  });

  it('rejects values over the length limit', () => {
    expect(
      quickFieldsInputSchema.safeParse({ dni: 'x'.repeat(MAX_QUICK_FIELD_LENGTH + 1) }).success,
    ).toBe(false);
    expect(
      quickFieldsInputSchema.safeParse({ dni: 'x'.repeat(MAX_QUICK_FIELD_LENGTH) }).success,
    ).toBe(true);
  });

  it('measures the limit after trimming', () => {
    const padded = `  ${'x'.repeat(MAX_QUICK_FIELD_LENGTH)}  `;
    expect(quickFieldsInputSchema.parse({ pasaporte: padded })).toEqual({
      pasaporte: 'x'.repeat(MAX_QUICK_FIELD_LENGTH),
    });
  });

  it('rejects unknown keys and non-string values', () => {
    expect(quickFieldsInputSchema.safeParse({ cuit: '20-1' }).success).toBe(false);
    expect(quickFieldsInputSchema.safeParse({ dni: 123 }).success).toBe(false);
  });
});

describe('stored quick fields', () => {
  it.each([null, undefined, 'x', 3, ['a'], true])('reads %p as no data', (raw) => {
    expect(parseStoredQuickFields(raw)).toEqual({});
  });

  it('ignores unknown keys, empty and non-string values', () => {
    expect(
      parseStoredQuickFields({
        dni: '1',
        pasaporte: '',
        obraSocial: 5,
        otro: 'x',
        nacimiento: ' ',
      }),
    ).toEqual({ dni: '1' });
  });

  it('compacts and trims', () => {
    expect(compactQuickFields({ obraSocial: ' OSDE 210 ' })).toEqual({ obraSocial: 'OSDE 210' });
  });

  it('only previews values that fit on the chip', () => {
    expect(quickFieldPreview('30123456')).toBe('30123456');
    expect(quickFieldPreview('12/03/1985')).toBe('12/03/1985');
    expect(quickFieldPreview('OSDE 210 - 61234567801')).toBeNull();
    expect(quickFieldPreview(undefined)).toBeNull();
  });
});

describe('updateFolderQuickFields', () => {
  const makeDb = (folder: { id: number; isPerson: boolean } | null) => {
    const documentFolder = {
      findFirst: jest.fn().mockResolvedValue(folder),
      update: jest
        .fn()
        .mockImplementation(({ where, data }: { where: { id: number }; data: unknown }) =>
          Promise.resolve({
            id: where.id,
            quickFields: (data as { quickFields: unknown }).quickFields,
          }),
        ),
    };
    return { db: { documentFolder } as never, documentFolder };
  };

  it('saves the fields of a person folder, checking membership first', async () => {
    const { db, documentFolder } = makeDb({ id: 3, isPerson: true });

    await expect(updateFolderQuickFields(db, 7, 3, { dni: '30123456' })).resolves.toEqual({
      folderId: 3,
      quickFields: { dni: '30123456' },
    });

    expect(documentFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 3, group: { groupUsers: { some: { userId: 7 } } } },
    });
    expect(documentFolder.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { quickFields: { dni: '30123456' } },
      select: { id: true, quickFields: true },
    });
  });

  it('stores NULL when every field was cleared', async () => {
    const { db, documentFolder } = makeDb({ id: 1, isPerson: true });

    await expect(updateFolderQuickFields(db, 7, 1, {})).resolves.toEqual({
      folderId: 1,
      quickFields: {},
    });
    expect(documentFolder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quickFields: Prisma.DbNull } }),
    );
  });

  it('is NOT_FOUND for a folder the user cannot see', async () => {
    const { db, documentFolder } = makeDb(null);

    await expect(updateFolderQuickFields(db, 7, 3, { dni: '1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(documentFolder.update).not.toHaveBeenCalled();
  });

  it('does not query with a malformed folder id', async () => {
    const { db, documentFolder } = makeDb({ id: 3, isPerson: true });

    await expect(updateFolderQuickFields(db, 7, -1, { dni: '1' })).rejects.toBeInstanceOf(
      TRPCError,
    );
    expect(documentFolder.findFirst).not.toHaveBeenCalled();
  });

  it('refuses folders that are not a person', async () => {
    const { db, documentFolder } = makeDb({ id: 4, isPerson: false });

    await expect(updateFolderQuickFields(db, 7, 4, { dni: '1' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'folder_not_person',
    });
    expect(documentFolder.update).not.toHaveBeenCalled();
  });
});

describe('copyText', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      // oxlint-disable-next-line typescript/no-dynamic-delete -- restaura jsdom
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
    // oxlint-disable-next-line typescript/no-deprecated -- se simula el respaldo
    delete (document as { execCommand?: unknown }).execCommand;
  });

  it('uses the Clipboard API when available', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await expect(copyText('30123456')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('30123456');
  });

  it('falls back to a hidden textarea when the Clipboard API fails', async () => {
    setClipboard({ writeText: jest.fn().mockRejectedValue(new Error('denied')) });
    const execCommand = jest.fn().mockReturnValue(true);
    Object.assign(document, { execCommand });

    await expect(copyText('AAB123456')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back when there is no Clipboard API (old iOS)', async () => {
    setClipboard(undefined);
    Object.assign(document, { execCommand: jest.fn().mockReturnValue(false) });

    await expect(copyText('x')).resolves.toBe(false);
    expect(copyWithTextarea('x')).toBe(false);
  });
});
