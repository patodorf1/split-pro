-- Casa: Stock de la casa y secciones aprendidas (aditiva)

-- CreateEnum
CREATE TYPE "public"."StockSection" AS ENUM ('FRIDGE', 'FREEZER', 'PANTRY', 'PRODUCE', 'CLEANING');

-- CreateTable
CREATE TABLE "public"."StockItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "note" TEXT,
    "section" "public"."StockSection" NOT NULL,
    "source" "public"."ShoppingItemSource" NOT NULL DEFAULT 'APP',
    "addedBy" INTEGER,
    "fromShoppingItemId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockPlacement" (
    "groupId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "section" "public"."StockSection" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPlacement_pkey" PRIMARY KEY ("groupId","key")
);

-- CreateIndex
CREATE INDEX "StockItem_fromShoppingItemId_idx" ON "public"."StockItem"("fromShoppingItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_groupId_key_key" ON "public"."StockItem"("groupId", "key");

-- AddForeignKey
ALTER TABLE "public"."StockItem" ADD CONSTRAINT "StockItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockItem" ADD CONSTRAINT "StockItem_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockItem" ADD CONSTRAINT "StockItem_fromShoppingItemId_fkey" FOREIGN KEY ("fromShoppingItemId") REFERENCES "public"."ShoppingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockPlacement" ADD CONSTRAINT "StockPlacement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

