import { type Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { emergencyContactFieldsSchema } from '~/lib/emergency';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { memberOf } from '~/server/documents/access';
import { type db as dbClient } from '~/server/db';

type Db = typeof dbClient;

export const EMERGENCY_CONTACT_SELECT = {
  id: true,
  groupId: true,
  name: true,
  phone: true,
  whatsapp: true,
  note: true,
  sortOrder: true,
} as const;

const CONTACT_ORDER: Prisma.EmergencyContactOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { id: 'asc' },
];

const contactIdSchema = z.number().int().positive();

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });

/** Contacto al que el usuario tiene acceso (miembro del grupo dueño), o null. */
export const findAccessibleContact = async (db: Db, id: number, userId: number) =>
  db.emergencyContact.findFirst({ where: { id, group: memberOf(userId) } });

/**
 * Contactos de emergencia de la familia. Mismo criterio que Documentos: todo pasa por el filtro
 * de membresía del grupo dueño, y si no sos miembro el contacto "no existe" (NOT_FOUND).
 */
export const emergencyRouter = createTRPCRouter({
  /** Contactos de todos los grupos del usuario, más la lista de grupos (para elegir dónde agregar). */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [contacts, groups] = await Promise.all([
      ctx.db.emergencyContact.findMany({
        where: { group: memberOf(userId) },
        orderBy: [{ groupId: 'asc' }, ...CONTACT_ORDER],
        select: EMERGENCY_CONTACT_SELECT,
      }),
      ctx.db.group.findMany({
        where: { archivedAt: null, ...memberOf(userId) },
        orderBy: { id: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

    return { contacts, groups };
  }),

  create: protectedProcedure
    .input(emergencyContactFieldsSchema.extend({ groupId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.db.groupUser.findFirst({
        where: { groupId: input.groupId, userId: ctx.session.user.id },
      });

      if (!membership) {
        throw notFound();
      }

      const last = await ctx.db.emergencyContact.aggregate({
        where: { groupId: input.groupId },
        _max: { sortOrder: true },
      });

      return ctx.db.emergencyContact.create({
        data: {
          groupId: input.groupId,
          name: input.name,
          phone: input.phone,
          whatsapp: input.whatsapp,
          note: input.note,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
        select: EMERGENCY_CONTACT_SELECT,
      });
    }),

  update: protectedProcedure
    .input(emergencyContactFieldsSchema.extend({ id: contactIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const contact = await findAccessibleContact(ctx.db, input.id, ctx.session.user.id);

      if (!contact) {
        throw notFound();
      }

      return ctx.db.emergencyContact.update({
        where: { id: contact.id },
        data: {
          name: input.name,
          phone: input.phone,
          whatsapp: input.whatsapp,
          note: input.note,
        },
        select: EMERGENCY_CONTACT_SELECT,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: contactIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const contact = await findAccessibleContact(ctx.db, input.id, ctx.session.user.id);

      if (!contact) {
        throw notFound();
      }

      await ctx.db.emergencyContact.delete({ where: { id: contact.id } });

      return { id: contact.id };
    }),

  /** Sube o baja un lugar dentro de su grupo (y renumera el orden de todo el grupo). */
  move: protectedProcedure
    .input(z.object({ id: contactIdSchema, direction: z.enum(['up', 'down']) }))
    .mutation(async ({ ctx, input }) => {
      const contact = await findAccessibleContact(ctx.db, input.id, ctx.session.user.id);

      if (!contact) {
        throw notFound();
      }

      return ctx.db.$transaction(async (tx) => {
        const ordered = await tx.emergencyContact.findMany({
          where: { groupId: contact.groupId },
          orderBy: CONTACT_ORDER,
          select: { id: true },
        });
        const index = ordered.findIndex((entry) => entry.id === contact.id);
        const target = 'up' === input.direction ? index - 1 : index + 1;

        if (index < 0 || target < 0 || target >= ordered.length) {
          return { moved: false };
        }

        const reordered = [...ordered];
        [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];

        await Promise.all(
          reordered.map((entry, position) =>
            tx.emergencyContact.update({ where: { id: entry.id }, data: { sortOrder: position } }),
          ),
        );

        return { moved: true };
      });
    }),
});
