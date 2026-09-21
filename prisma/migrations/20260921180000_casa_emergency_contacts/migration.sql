-- Casa: contactos de emergencia compartidos por grupo (aditiva)

-- CreateTable
CREATE TABLE "public"."EmergencyContact" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmergencyContact_groupId_sortOrder_idx" ON "public"."EmergencyContact"("groupId", "sortOrder");

-- AddForeignKey
ALTER TABLE "public"."EmergencyContact" ADD CONSTRAINT "EmergencyContact_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: contactos iniciales para el grupo 1 ("Casa"). Si el grupo 1 no existe el SELECT no
-- devuelve filas y no se inserta nada; si el grupo ya tiene contactos, tampoco (idempotente).
INSERT INTO "public"."EmergencyContact" ("groupId", "name", "phone", "note", "sortOrder", "updatedAt")
SELECT casa."id", seed."name", seed."phone", seed."note", seed."sortOrder", CURRENT_TIMESTAMP
FROM (
    SELECT "id" FROM "public"."Group"
    WHERE "id" = 1
      AND NOT EXISTS (SELECT 1 FROM "public"."EmergencyContact" WHERE "groupId" = 1)
) AS casa
CROSS JOIN (
    VALUES
        ('Policía', '911', 'Emergencias', 0),
        ('Bomberos', '100', NULL, 1),
        ('SAME / Ambulancia', '107', NULL, 2),
        ('OSDE riesgo de vida', '0810 666 1111', 'Pérdida de conocimiento, convulsiones', 3),
        ('OSDE urgencias', '0810 888 7788', 'Urgencias médicas 24 h', 4),
        ('Swiss Medical emergencias', '0810 888 3226', 'Emergencias 24 h', 5)
) AS seed ("name", "phone", "note", "sortOrder");
