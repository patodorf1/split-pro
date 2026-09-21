-- Casa: avisos de vencimiento de documentos en Inicio (posponer / descartar, por usuario)

-- CreateTable
CREATE TABLE "public"."DocumentReminderState" (
    "documentId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "snoozedUntil" TIMESTAMP(3),
    "dismissedForExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentReminderState_pkey" PRIMARY KEY ("documentId","userId")
);

-- CreateIndex
CREATE INDEX "DocumentReminderState_userId_idx" ON "public"."DocumentReminderState"("userId");

-- AddForeignKey
ALTER TABLE "public"."DocumentReminderState" ADD CONSTRAINT "DocumentReminderState_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentReminderState" ADD CONSTRAINT "DocumentReminderState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
