import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  DOCUMENT_FOLDER_ICONS,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  cleanDocumentName,
  matchesDocumentSearch,
} from '~/lib/documents';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { findAccessibleDocument, findAccessibleFolder, memberOf } from '~/server/documents/access';

/** Lo que ve la UI de un documento (nunca la ruta en disco). */
export const DOCUMENT_SELECT = {
  id: true,
  folderId: true,
  groupId: true,
  name: true,
  mimeType: true,
  size: true,
  notes: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

const SEARCH_LIMIT = 50;

const folderNameSchema = z
  .string()
  .transform((value) => cleanDocumentName(value).slice(0, MAX_FOLDER_NAME_LENGTH).trim())
  .pipe(z.string().min(1));

const documentNameSchema = z
  .string()
  .transform((value) => cleanDocumentName(value).slice(0, MAX_DOCUMENT_NAME_LENGTH).trim())
  .pipe(z.string().min(1));

const iconSchema = z.enum(DOCUMENT_FOLDER_ICONS);

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && 'P2002' === error.code;

/**
 * Documentos de la familia. Todo pasa por el filtro de membresía del grupo dueño: si no sos
 * miembro, la sección o el documento "no existen" (NOT_FOUND).
 */
export const documentsRouter = createTRPCRouter({
  /** Secciones de todos los grupos del usuario, con la cantidad de documentos de cada una. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [folders, counts, groups] = await Promise.all([
      ctx.db.documentFolder.findMany({
        where: { group: memberOf(userId) },
        orderBy: [{ groupId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, groupId: true, name: true, icon: true, sortOrder: true },
      }),
      ctx.db.document.groupBy({
        by: ['folderId'],
        where: { deletedAt: null, group: memberOf(userId) },
        _count: { _all: true },
      }),
      ctx.db.group.findMany({
        where: { archivedAt: null, ...memberOf(userId) },
        orderBy: { id: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

    const countByFolder = new Map(counts.map((row) => [row.folderId, row._count._all]));

    return {
      folders: folders.map((folder) => ({
        ...folder,
        documentCount: countByFolder.get(folder.id) ?? 0,
      })),
      groups,
    };
  }),

  /** Una sección con sus documentos vigentes (lo último subido primero). */
  getFolder: protectedProcedure
    .input(z.object({ folderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const folder = await findAccessibleFolder(ctx.db, input.folderId, ctx.session.user.id);

      if (!folder) {
        throw notFound();
      }

      const [documents, siblings] = await Promise.all([
        ctx.db.document.findMany({
          where: { folderId: folder.id, deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: DOCUMENT_SELECT,
        }),
        ctx.db.documentFolder.findMany({
          where: { groupId: folder.groupId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, icon: true },
        }),
      ]);

      return {
        folder: { id: folder.id, groupId: folder.groupId, name: folder.name, icon: folder.icon },
        documents,
        /** Destinos posibles de "Mover a…": secciones del mismo grupo. */
        siblings,
      };
    }),

  /** Busca por nombre en todas las secciones (sin distinguir acentos ni mayúsculas). */
  search: protectedProcedure
    .input(z.object({ query: z.string().max(100) }))
    .query(async ({ ctx, input }) => {
      if (!input.query.trim()) {
        return [];
      }

      const documents = await ctx.db.document.findMany({
        where: { deletedAt: null, group: memberOf(ctx.session.user.id) },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: { ...DOCUMENT_SELECT, folder: { select: { id: true, name: true, icon: true } } },
      });

      return documents
        .filter((document) => matchesDocumentSearch(document.name, input.query))
        .slice(0, SEARCH_LIMIT);
    }),

  createFolder: protectedProcedure
    .input(
      z.object({ groupId: z.number().int().positive(), name: folderNameSchema, icon: iconSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.db.groupUser.findFirst({
        where: { groupId: input.groupId, userId: ctx.session.user.id },
      });

      if (!membership) {
        throw notFound();
      }

      const last = await ctx.db.documentFolder.aggregate({
        where: { groupId: input.groupId },
        _max: { sortOrder: true },
      });

      try {
        return await ctx.db.documentFolder.create({
          data: {
            groupId: input.groupId,
            name: input.name,
            icon: input.icon,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
          select: { id: true, groupId: true, name: true, icon: true, sortOrder: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'folder_exists' });
        }
        throw error;
      }
    }),

  updateFolder: protectedProcedure
    .input(
      z.object({
        folderId: z.number().int().positive(),
        name: folderNameSchema.optional(),
        icon: iconSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const folder = await findAccessibleFolder(ctx.db, input.folderId, ctx.session.user.id);

      if (!folder) {
        throw notFound();
      }

      try {
        return await ctx.db.documentFolder.update({
          where: { id: folder.id },
          data: { name: input.name, icon: input.icon },
          select: { id: true, groupId: true, name: true, icon: true, sortOrder: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'folder_exists' });
        }
        throw error;
      }
    }),

  /** Sube o baja una sección un lugar (intercambia el orden con la vecina). */
  moveFolder: protectedProcedure
    .input(z.object({ folderId: z.number().int().positive(), direction: z.enum(['up', 'down']) }))
    .mutation(async ({ ctx, input }) => {
      const folder = await findAccessibleFolder(ctx.db, input.folderId, ctx.session.user.id);

      if (!folder) {
        throw notFound();
      }

      return ctx.db.$transaction(async (tx) => {
        const ordered = await tx.documentFolder.findMany({
          where: { groupId: folder.groupId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        const index = ordered.findIndex((entry) => entry.id === folder.id);
        const target = 'up' === input.direction ? index - 1 : index + 1;

        if (index < 0 || target < 0 || target >= ordered.length) {
          return { moved: false };
        }

        const reordered = [...ordered];
        [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];

        // Renumera todo: así se corrigen de paso órdenes repetidos.
        await Promise.all(
          reordered.map((entry, position) =>
            tx.documentFolder.update({ where: { id: entry.id }, data: { sortOrder: position } }),
          ),
        );

        return { moved: true };
      });
    }),

  /** Sólo se puede borrar una sección vacía (sin documentos vigentes). */
  deleteFolder: protectedProcedure
    .input(z.object({ folderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const folder = await findAccessibleFolder(ctx.db, input.folderId, ctx.session.user.id);

      if (!folder) {
        throw notFound();
      }

      return ctx.db.$transaction(async (tx) => {
        const active = await tx.document.count({ where: { folderId: folder.id, deletedAt: null } });

        if (0 < active) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'folder_not_empty' });
        }

        // Los documentos ya borrados (lógicamente) de esta sección se van con ella; sus archivos
        // Quedan en disco, como con cualquier borrado.
        await tx.documentFolder.delete({ where: { id: folder.id } });

        return { deleted: true };
      });
    }),

  renameDocument: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: documentNameSchema }))
    .mutation(async ({ ctx, input }) => {
      const document = await findAccessibleDocument(ctx.db, input.id, ctx.session.user.id);

      if (!document) {
        throw notFound();
      }

      return ctx.db.document.update({
        where: { id: document.id },
        data: { name: input.name },
        select: DOCUMENT_SELECT,
      });
    }),

  /** Mover a otra sección del mismo grupo (el archivo en disco no se toca). */
  moveDocument: protectedProcedure
    .input(z.object({ id: z.string().uuid(), folderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [document, folder] = await Promise.all([
        findAccessibleDocument(ctx.db, input.id, userId),
        findAccessibleFolder(ctx.db, input.folderId, userId),
      ]);

      if (!document || !folder || folder.groupId !== document.groupId) {
        throw notFound();
      }

      return ctx.db.document.update({
        where: { id: document.id },
        data: { folderId: folder.id },
        select: DOCUMENT_SELECT,
      });
    }),

  /** Borrado lógico: desaparece de la app pero el archivo queda en disco (y en los backups). */
  deleteDocument: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const document = await findAccessibleDocument(ctx.db, input.id, ctx.session.user.id);

      if (!document) {
        throw notFound();
      }

      await ctx.db.document.update({
        where: { id: document.id },
        data: { deletedAt: new Date() },
      });

      return { deleted: true, folderId: document.folderId };
    }),
});
