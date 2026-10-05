import { formatDailyNotice, sendDailyNotices } from '~/server/api/services/dailyNoticesService';

const mockFindEventItems = jest.fn();
const mockFindUpcomingExpiries = jest.fn();
const mockSendPush = jest.fn();
const mockDb = {
  pushNotification: { findMany: jest.fn() },
  dailyNoticeLog: { findMany: jest.fn(), createMany: jest.fn() },
};

jest.mock('~/server/db', () => ({
  get db() {
    return mockDb;
  },
}));
jest.mock('~/server/calendar/events', () => ({
  findEventItems: (...args: unknown[]) => mockFindEventItems(...args),
}));
jest.mock('~/server/documents/reminders', () => ({
  findUpcomingExpiries: (...args: unknown[]) => mockFindUpcomingExpiries(...args),
}));
jest.mock('~/server/api/services/notificationService', () => ({
  sendPushNotificationToUsers: (...args: unknown[]) => mockSendPush(...args),
}));

// 2026-10-05 en Argentina (UTC-3): 07:30 y 09:00.
const BEFORE_EIGHT = new Date('2026-10-05T10:30:00.000Z');
const AFTER_EIGHT = new Date('2026-10-05T12:00:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.pushNotification.findMany.mockResolvedValue([{ userId: 1 }, { userId: 2 }]);
  mockDb.dailyNoticeLog.findMany.mockResolvedValue([]);
  mockDb.dailyNoticeLog.createMany.mockResolvedValue({ count: 1 });
  mockFindEventItems.mockResolvedValue([{ title: 'Turno dentista', time: '17:30' }]);
  mockFindUpcomingExpiries.mockResolvedValue([{ name: 'Seguro Fox', daysLeft: 3 }]);
  mockSendPush.mockResolvedValue({ sentCount: 1 });
});

describe('sendDailyNotices', () => {
  it('does nothing before 8 in Argentina', async () => {
    expect(await sendDailyNotices(BEFORE_EIGHT)).toBe(0);
    expect(mockDb.pushNotification.findMany).not.toHaveBeenCalled();
  });

  it('sends today with the badge count to everyone subscribed', async () => {
    expect(await sendDailyNotices(AFTER_EIGHT)).toBe(2);
    expect(mockFindEventItems).toHaveBeenCalledWith(mockDb, 1, {
      from: '2026-10-05',
      to: '2026-10-05',
    });
    expect(mockSendPush).toHaveBeenCalledWith([1], {
      title: 'Hoy en casa',
      message: '17:30 · Turno dentista\nVence en 3 días: Seguro Fox',
      data: { url: '/dashboard', badge: 2 },
    });
  });

  it('skips who already got it today (or was claimed by another run)', async () => {
    mockDb.dailyNoticeLog.findMany.mockResolvedValue([{ userId: 1 }]);
    mockDb.dailyNoticeLog.createMany.mockResolvedValue({ count: 0 });

    expect(await sendDailyNotices(AFTER_EIGHT)).toBe(0);
    expect(mockDb.dailyNoticeLog.createMany).toHaveBeenCalledTimes(1);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('sends nothing when there is nothing today', async () => {
    mockFindEventItems.mockResolvedValue([]);
    mockFindUpcomingExpiries.mockResolvedValue([]);

    expect(await sendDailyNotices(AFTER_EIGHT)).toBe(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe('formatDailyNotice', () => {
  it('shows up to four lines and counts the rest', () => {
    expect(formatDailyNotice(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a\nb\nc\nd\ny 2 más');
  });
});
