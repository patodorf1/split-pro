import { findEventItems } from '~/server/calendar/events';
import { db } from '~/server/db';
import { findUpcomingExpiries } from '~/server/documents/reminders';

import { sendPushNotificationToUsers } from './notificationService';

/**
 * Aviso de la mañana: a partir de las 8 (hora de Argentina) cada persona con notificaciones
 * recibe una sola notificación con lo de hoy (eventos de la Agenda y documentos por vencer o
 * vencidos que no pospuso ni descartó). Lleva el número de avisos para el ícono de la app, así el
 * numerito queda al día aunque la app esté cerrada. Si no hay nada, no se manda nada.
 */

const TIME_ZONE = 'America/Argentina/Buenos_Aires';
const SEND_FROM_HOUR = 8;
const CHECK_EVERY_MS = 5 * 60 * 1000;
const MAX_LINES = 4;

const nowInArgentina = (now: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    day: `${read('year')}-${read('month')}-${read('day')}`,
    hour: Number(read('hour')),
  };
};

const expiryLine = (name: string, daysLeft: number) => {
  if (0 > daysLeft) {
    return `Venció: ${name}`;
  }
  if (0 === daysLeft) {
    return `Vence hoy: ${name}`;
  }
  return `Vence en ${daysLeft} ${1 === daysLeft ? 'día' : 'días'}: ${name}`;
};

/** Lo de hoy para una persona: cuántos avisos son y una línea por cada uno. */
export const buildTodayNotices = async (userId: number, day: string, now: Date = new Date()) => {
  const [events, expiries] = await Promise.all([
    findEventItems(db, userId, { from: day, to: day }),
    findUpcomingExpiries(db, userId, now),
  ]);

  const lines = [
    ...events.map((event) => (event.time ? `${event.time} · ${event.title}` : event.title)),
    ...expiries.map((expiry) => expiryLine(expiry.name, expiry.daysLeft)),
  ];

  return { count: lines.length, lines };
};

export const formatDailyNotice = (lines: string[]) => {
  const shown = lines.slice(0, MAX_LINES);
  const rest = lines.length - shown.length;

  return [...shown, ...(0 < rest ? [`y ${rest} más`] : [])].join('\n');
};

/** Manda el aviso de hoy a quien todavía no lo recibió. Devuelve a cuántas personas se mandó. */
export const sendDailyNotices = async (now: Date = new Date()): Promise<number> => {
  const { day, hour } = nowInArgentina(now);

  if (hour < SEND_FROM_HOUR) {
    return 0;
  }

  const dayDate = new Date(`${day}T00:00:00.000Z`);
  const [subscribed, alreadySent] = await Promise.all([
    db.pushNotification.findMany({ select: { userId: true }, distinct: ['userId'] }),
    db.dailyNoticeLog.findMany({ where: { day: dayDate }, select: { userId: true } }),
  ]);
  const done = new Set(alreadySent.map(({ userId }) => userId));

  let sent = 0;
  for (const { userId } of subscribed.filter(({ userId }) => !done.has(userId))) {
    // Se anota antes de mandar: si dos vueltas se pisan, sólo la que logra anotar manda.
    const claimed = await db.dailyNoticeLog.createMany({
      data: [{ userId, day: dayDate }],
      skipDuplicates: true,
    });
    if (0 === claimed.count) {
      continue;
    }

    const { count, lines } = await buildTodayNotices(userId, day, now);
    if (0 === count) {
      continue;
    }

    await sendPushNotificationToUsers([userId], {
      title: 'Hoy en casa',
      message: formatDailyNotice(lines),
      data: { url: '/dashboard', badge: count },
    });
    sent += 1;
  }

  return sent;
};

/** Vuelta periódica, igual que la de gastos recurrentes: nunca se corta por un error. */
export async function checkDailyNotices() {
  try {
    await sendDailyNotices();
  } catch (error) {
    console.error('Error sending daily notices', error);
  } finally {
    setTimeout(checkDailyNotices, CHECK_EVERY_MS);
  }
}
