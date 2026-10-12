-- Casa: To Do de la casa (aditiva)

-- CreateTable
CREATE TABLE "public"."TodoItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneBy" INTEGER,
    "addedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TodoItem_groupId_done_idx" ON "public"."TodoItem"("groupId", "done");

-- AddForeignKey
ALTER TABLE "public"."TodoItem" ADD CONSTRAINT "TodoItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TodoItem" ADD CONSTRAINT "TodoItem_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TodoItem" ADD CONSTRAINT "TodoItem_doneBy_fkey" FOREIGN KEY ("doneBy") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
