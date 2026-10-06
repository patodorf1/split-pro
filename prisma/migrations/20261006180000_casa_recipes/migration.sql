-- Casa: recetario de la casa e ingredientes principales (aditiva)

-- CreateEnum
CREATE TYPE "public"."RecipeKind" AS ENUM ('PROTEIN', 'MAIN', 'SALAD', 'SIDE');

-- CreateEnum
CREATE TYPE "public"."RecipeSource" AS ENUM ('APP', 'API', 'IMPORT');

-- CreateTable
CREATE TABLE "public"."Recipe" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "kind" "public"."RecipeKind" NOT NULL,
    "yieldText" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "source" "public"."RecipeSource" NOT NULL DEFAULT 'APP',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecipeIngredient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_groupId_titleKey_key" ON "public"."Recipe"("groupId", "titleKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredient_recipeId_key_key" ON "public"."RecipeIngredient"("recipeId", "key");

-- AddForeignKey
ALTER TABLE "public"."Recipe" ADD CONSTRAINT "Recipe_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Recipe" ADD CONSTRAINT "Recipe_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "public"."Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
