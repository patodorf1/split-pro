-- Casa: negocio de cada ítem de Compras (aditiva: vacío = se adivina por el nombre)

-- CreateEnum
CREATE TYPE "public"."ShoppingStore" AS ENUM ('VERDULERIA', 'ALMACEN', 'CARNICERIA');

-- AlterTable
ALTER TABLE "public"."ShoppingItem" ADD COLUMN "store" "public"."ShoppingStore";
