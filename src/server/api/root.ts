import { groupRouter } from '~/server/api/routers/group';
import { createTRPCRouter } from '~/server/api/trpc';

import { userRouter } from './routers/user';
import { bankTransactionsRouter } from './routers/bankTransactions';
import { calendarRouter } from './routers/calendar';
import { documentsRouter } from './routers/documents';
import { emergencyRouter } from './routers/emergency';
import { expenseRouter } from './routers/expense';
import { shoppingRouter } from './routers/shopping';
import { statsRouter } from './routers/stats';
import { stockRouter } from './routers/stock';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  group: groupRouter,
  user: userRouter,
  bankTransactions: bankTransactionsRouter,
  calendar: calendarRouter,
  documents: documentsRouter,
  emergency: emergencyRouter,
  expense: expenseRouter,
  shopping: shoppingRouter,
  stock: stockRouter,
  stats: statsRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
