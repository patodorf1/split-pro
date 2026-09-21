import {
  REMINDER_SNOOZE_MS,
  REMINDER_TIME_ZONE,
  calendarDaysUntil,
  isReminderVisible,
  reminderWindowEnd,
} from '~/lib/documentReminders';
import { type db as dbClient } from '~/server/db';

import { findAccessibleDocument, memberOf } from './access';

type Db = typeof dbClient;

export interface UpcomingExpiry {
  id: string;
  name: string;
  mimeType: string;
  folderId: number;
  folderName: string;
  expiresAt: Date;
  /** Días de calendario (Argentina) hasta el vencimiento: 0 hoy, negativo si ya venció. */
  daysLeft: number;
}

/**
 * Documentos que vencen en los próximos días (o ya vencieron) de los grupos del usuario, sin los
 * que él pospuso o descartó. Lo más urgente primero.
 */
export const findUpcomingExpiries = async (
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<UpcomingExpiry[]> => {
  const documents = await db.document.findMany({
    where: {
      deletedAt: null,
      group: memberOf(userId),
      expiresAt: { not: null, lt: reminderWindowEnd(now) },
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      mimeType: true,
      folderId: true,
      expiresAt: true,
      folder: { select: { name: true } },
      reminders: {
        where: { userId },
        select: { snoozedUntil: true, dismissedForExpiresAt: true },
      },
    },
  });

  return documents.flatMap((document) => {
    const { expiresAt } = document;

    if (!isReminderVisible(expiresAt, document.reminders[0], now)) {
      return [];
    }

    return [
      {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        folderId: document.folderId,
        folderName: document.folder.name,
        expiresAt,
        daysLeft: calendarDaysUntil(expiresAt, now, REMINDER_TIME_ZONE),
      },
    ];
  });
};

/** Esconde el aviso por un día. `null` si el documento no existe o no es del usuario. */
export const snoozeReminder = async (
  db: Db,
  documentId: string,
  userId: number,
  now: Date = new Date(),
) => {
  const document = await findAccessibleDocument(db, documentId, userId);

  if (!document) {
    return null;
  }

  const snoozedUntil = new Date(now.getTime() + REMINDER_SNOOZE_MS);

  await db.documentReminderState.upsert({
    where: { documentId_userId: { documentId: document.id, userId } },
    create: { documentId: document.id, userId, snoozedUntil },
    update: { snoozedUntil },
  });

  return { snoozedUntil };
};

/**
 * Descarta el aviso de este vencimiento: queda guardada la fecha que se descartó, así si el
 * documento cambia de vencimiento el aviso vuelve solo. `null` si no existe o no es del usuario.
 */
export const dismissReminder = async (db: Db, documentId: string, userId: number) => {
  const document = await findAccessibleDocument(db, documentId, userId);

  if (!document) {
    return null;
  }

  const dismissedForExpiresAt = document.expiresAt;

  await db.documentReminderState.upsert({
    where: { documentId_userId: { documentId: document.id, userId } },
    create: { documentId: document.id, userId, dismissedForExpiresAt },
    update: { dismissedForExpiresAt },
  });

  return { dismissedForExpiresAt };
};
