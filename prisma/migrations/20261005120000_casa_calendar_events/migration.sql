-- Casa: eventos de la Agenda compartidos por grupo (aditiva)

-- CreateEnum
CREATE TYPE "public"."CalendarEventRepeat" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "public"."CalendarEvent" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT,
    "note" TEXT,
    "repeat" "public"."CalendarEventRepeat" NOT NULL DEFAULT 'NONE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_groupId_date_idx" ON "public"."CalendarEvent"("groupId", "date");

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
