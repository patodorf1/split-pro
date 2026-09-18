-- Casa: lista de compras compartida por grupo

-- CreateEnum
CREATE TYPE "public"."ShoppingItemSource" AS ENUM ('APP', 'ALEXA', 'API');

-- CreateTable
CREATE TABLE "public"."ShoppingItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "note" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedBy" INTEGER,
    "addedBy" INTEGER,
    "source" "public"."ShoppingItemSource" NOT NULL DEFAULT 'APP',
    "externalId" TEXT,
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShoppingItem_groupId_idx" ON "public"."ShoppingItem"("groupId");

-- CreateIndex
CREATE INDEX "ShoppingItem_groupId_checked_idx" ON "public"."ShoppingItem"("groupId", "checked");

-- CreateIndex
-- NULLs son distintos entre sí en Postgres: varios ítems cargados a mano (externalId NULL)
-- pueden convivir, pero un externalId concreto es único dentro del grupo.
CREATE UNIQUE INDEX "ShoppingItem_groupId_externalId_key" ON "public"."ShoppingItem"("groupId", "externalId");

-- AddForeignKey
ALTER TABLE "public"."ShoppingItem" ADD CONSTRAINT "ShoppingItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShoppingItem" ADD CONSTRAINT "ShoppingItem_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShoppingItem" ADD CONSTRAINT "ShoppingItem_checkedBy_fkey" FOREIGN KEY ("checkedBy") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
