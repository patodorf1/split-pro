-- Casa: documentos compartidos de la familia (secciones + archivos)

-- CreateTable
CREATE TABLE "public"."DocumentFolder" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'folder',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folderId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" INTEGER,
    "notes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentFolder_groupId_idx" ON "public"."DocumentFolder"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFolder_groupId_name_key" ON "public"."DocumentFolder"("groupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "public"."Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_groupId_deletedAt_idx" ON "public"."Document"("groupId", "deletedAt");

-- CreateIndex
CREATE INDEX "Document_folderId_deletedAt_idx" ON "public"."Document"("folderId", "deletedAt");

-- AddForeignKey
ALTER TABLE "public"."DocumentFolder" ADD CONSTRAINT "DocumentFolder_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "public"."DocumentFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: secciones iniciales para el grupo "Casa" (el de menor id si hubiera más de uno).
-- Idempotente: si ya existen (mismo grupo y nombre) no se duplican, y si no hay grupo "Casa"
-- el SELECT no devuelve filas y no se inserta nada.
INSERT INTO "public"."DocumentFolder" ("groupId", "name", "icon", "sortOrder")
SELECT casa."id", seed."name", seed."icon", seed."sortOrder"
FROM (
    SELECT "id" FROM "public"."Group" WHERE "name" = 'Casa' ORDER BY "id" LIMIT 1
) AS casa
CROSS JOIN (
    VALUES
        ('Clari', 'baby', 0),
        ('Belu', 'user', 1),
        ('Pato', 'user', 2),
        ('Kuga', 'car', 3),
        ('Fox', 'car', 4),
        ('Casa', 'house', 5),
        ('Lancha', 'sailboat', 6)
) AS seed ("name", "icon", "sortOrder")
ON CONFLICT ("groupId", "name") DO NOTHING;
