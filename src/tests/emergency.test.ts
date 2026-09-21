import {
  MAX_EMERGENCY_NAME_LENGTH,
  MAX_EMERGENCY_NOTE_LENGTH,
  dialableNumber,
  emergencyContactFieldsSchema,
  telHref,
  whatsappHref,
} from '~/lib/emergency';
import { emergencyRouter } from '~/server/api/routers/emergency';

// El router importa el contexto de tRPC, que trae la sesión y el cliente de la base: acá se usa
// Una base falsa por test. superjson es ESM puro y la llamada directa no serializa nada.
jest.mock('~/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('~/server/db', () => ({ db: {} }));
jest.mock('superjson', () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => ({ json: value }),
    deserialize: (value: unknown) => value,
  },
}));

const MEMBER_FILTER = { groupUsers: { some: { userId: 7 } } };

const makeDb = (found: unknown = null) => {
  const emergencyContact = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(found),
    aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 4 } }),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data })),
    update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
    delete: jest.fn().mockResolvedValue({}),
  };
  const groupUser = { findFirst: jest.fn().mockResolvedValue(found ? { groupId: 1 } : null) };
  const group = { findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Casa' }]) };
  const tables = { emergencyContact, groupUser, group };
  // Las transacciones corren directo contra la misma base falsa.
  const $transaction = jest.fn((fn: (tx: typeof tables) => unknown) => fn(tables));
  return { ...tables, $transaction };
};

const callerFor = (db: ReturnType<typeof makeDb>, userId: number | null = 7) =>
  emergencyRouter.createCaller({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sesión mínima de prueba
    session: null === userId ? null : ({ user: { id: userId }, expires: '' } as never),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- base falsa de prueba
    db: db as never,
  });

const VALID = { name: 'Policía', phone: '911', whatsapp: null, note: 'Emergencias' };
const CONTACT = { id: 1, groupId: 1, name: 'Policía', phone: '911', sortOrder: 0 };

describe('emergency contact validation', () => {
  it('accepts a typical contact and trims / collapses spaces', () => {
    expect(
      emergencyContactFieldsSchema.parse({
        name: '  OSDE   urgencias ',
        phone: ' 0810 888-7788 ',
        whatsapp: '',
        note: '  Urgencias 24 h ',
      }),
    ).toEqual({
      name: 'OSDE urgencias',
      phone: '0810 888-7788',
      whatsapp: null,
      note: 'Urgencias 24 h',
    });
  });

  it('allows an empty phone (card shows "add number")', () => {
    expect(emergencyContactFieldsSchema.parse({ ...VALID, phone: '   ' }).phone).toBe('');
  });

  it.each(['+54 (11) 5555-1234', '911', '0810 666 1111'])('accepts phone %p', (phone) => {
    expect(emergencyContactFieldsSchema.safeParse({ ...VALID, phone }).success).toBe(true);
  });

  it.each(['911a', 'llamar', '11.5555.1234', '1'.repeat(31)])('rejects phone %p', (phone) => {
    expect(emergencyContactFieldsSchema.safeParse({ ...VALID, phone }).success).toBe(false);
  });

  it('rejects an invalid whatsapp', () => {
    expect(emergencyContactFieldsSchema.safeParse({ ...VALID, whatsapp: 'abc' }).success).toBe(
      false,
    );
  });

  it('requires a name of 1 to 60 characters', () => {
    expect(emergencyContactFieldsSchema.safeParse({ ...VALID, name: '   ' }).success).toBe(false);
    expect(
      emergencyContactFieldsSchema.safeParse({
        ...VALID,
        name: 'a'.repeat(MAX_EMERGENCY_NAME_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      emergencyContactFieldsSchema.safeParse({
        ...VALID,
        name: 'a'.repeat(MAX_EMERGENCY_NAME_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('caps the note at 120 characters and stores an empty note as null', () => {
    expect(
      emergencyContactFieldsSchema.safeParse({
        ...VALID,
        note: 'a'.repeat(MAX_EMERGENCY_NOTE_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(emergencyContactFieldsSchema.parse({ ...VALID, note: '  ' }).note).toBeNull();
    expect(emergencyContactFieldsSchema.parse({ ...VALID, note: undefined }).note).toBeNull();
  });
});

describe('phone links', () => {
  it.each([
    ['911', '911'],
    ['0810 888-7788', '08108887788'],
    ['+54 (11) 5555-1234', '+541155551234'],
    ['', ''],
  ])('dialableNumber(%p) = %p', (input, expected) => {
    expect(dialableNumber(input)).toBe(expected);
  });

  it('builds tel: links only when there is a number', () => {
    expect(telHref('0810 666 1111')).toBe('tel:08106661111');
    expect(telHref('')).toBeNull();
  });

  it.each([
    ['11 5555-1234', 'https://wa.me/5491155551234'],
    ['011 15 5555-1234', 'https://wa.me/5491155551234'],
    ['221 15 555-1234', 'https://wa.me/5492215551234'],
    ['+54 9 11 5555-1234', 'https://wa.me/5491155551234'],
    ['+1 (415) 555-0100', 'https://wa.me/14155550100'],
    ['5491155551234', 'https://wa.me/5491155551234'],
  ])('whatsappHref(%p) = %p', (input, expected) => {
    expect(whatsappHref(input)).toBe(expected);
  });

  it('has no whatsapp link without a number', () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref(' ')).toBeNull();
  });
});

describe('emergency router auth', () => {
  it('rejects anonymous users', async () => {
    const db = makeDb(CONTACT);
    await expect(callerFor(db, null).list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(callerFor(db, null).delete({ id: 1 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(db.emergencyContact.delete).not.toHaveBeenCalled();
  });

  it('lists only contacts and groups the user is a member of', async () => {
    const db = makeDb();
    const result = await callerFor(db).list();

    expect(result.groups).toEqual([{ id: 1, name: 'Casa' }]);
    expect(db.emergencyContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { group: MEMBER_FILTER } }),
    );
    expect(db.group.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, ...MEMBER_FILTER } }),
    );
  });

  it('creates at the end of the group list after checking membership', async () => {
    const db = makeDb(CONTACT);
    const created = await callerFor(db).create({ groupId: 1, ...VALID, phone: '' });

    expect(db.groupUser.findFirst).toHaveBeenCalledWith({ where: { groupId: 1, userId: 7 } });
    expect(created).toMatchObject({ groupId: 1, name: 'Policía', phone: '', sortOrder: 5 });
  });

  it('does not create in a group the user does not belong to', async () => {
    const db = makeDb(null);

    await expect(callerFor(db).create({ groupId: 2, ...VALID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.emergencyContact.create).not.toHaveBeenCalled();
  });

  it('rejects invalid input before touching the database', async () => {
    const db = makeDb(CONTACT);

    await expect(
      callerFor(db).create({ groupId: 1, ...VALID, phone: 'llamar' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(callerFor(db).update({ id: 1, ...VALID, name: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(db.groupUser.findFirst).not.toHaveBeenCalled();
    expect(db.emergencyContact.findFirst).not.toHaveBeenCalled();
  });

  it.each(['update', 'delete', 'move'] as const)(
    '%s looks the contact up through the membership filter and 404s otherwise',
    async (action) => {
      const db = makeDb(null);
      const caller = callerFor(db);
      const call =
        'update' === action
          ? caller.update({ id: 5, ...VALID })
          : 'delete' === action
            ? caller.delete({ id: 5 })
            : caller.move({ id: 5, direction: 'up' });

      await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(db.emergencyContact.findFirst).toHaveBeenCalledWith({
        where: { id: 5, group: MEMBER_FILTER },
      });
      expect(db.emergencyContact.update).not.toHaveBeenCalled();
      expect(db.emergencyContact.delete).not.toHaveBeenCalled();
    },
  );

  it('updates and deletes an accessible contact', async () => {
    const db = makeDb(CONTACT);

    await callerFor(db).update({ id: 1, ...VALID, whatsapp: '11 5555 1234' });
    expect(db.emergencyContact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { name: 'Policía', phone: '911', whatsapp: '11 5555 1234', note: 'Emergencias' },
      }),
    );

    await expect(callerFor(db).delete({ id: 1 })).resolves.toEqual({ id: 1 });
    expect(db.emergencyContact.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('moves a contact inside its group and renumbers the order', async () => {
    const db = makeDb({ ...CONTACT, id: 2 });
    db.emergencyContact.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

    await expect(callerFor(db).move({ id: 2, direction: 'up' })).resolves.toEqual({ moved: true });
    expect(db.emergencyContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: 1 } }),
    );
    expect(db.emergencyContact.update.mock.calls.map(([arg]) => arg)).toEqual([
      { where: { id: 2 }, data: { sortOrder: 0 } },
      { where: { id: 1 }, data: { sortOrder: 1 } },
      { where: { id: 3 }, data: { sortOrder: 2 } },
    ]);
  });

  it('does nothing when moving the first contact up', async () => {
    const db = makeDb(CONTACT);
    db.emergencyContact.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await expect(callerFor(db).move({ id: 1, direction: 'up' })).resolves.toEqual({
      moved: false,
    });
    expect(db.emergencyContact.update).not.toHaveBeenCalled();
  });
});
