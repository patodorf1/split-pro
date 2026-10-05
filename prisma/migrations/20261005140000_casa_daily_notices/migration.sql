-- CreateTable
CREATE TABLE "public"."DailyNoticeLog" (
    "userId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyNoticeLog_pkey" PRIMARY KEY ("userId","day")
);

-- AddForeignKey
ALTER TABLE "public"."DailyNoticeLog" ADD CONSTRAINT "DailyNoticeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
