-- Casa: datos rápidos (DNI, pasaporte, obra social, nacimiento) en las secciones de personas.
-- Sólo agrega columnas; no carga ningún dato.

-- AlterTable
ALTER TABLE "public"."DocumentFolder" ADD COLUMN "isPerson" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "quickFields" JSONB;

-- Marca como "persona" las secciones de Clari, Belu y Pato (ids 1, 2 y 3 del seed de Casa).
-- El chequeo de nombre evita marcar otra sección si en alguna base los ids no coinciden.
UPDATE "public"."DocumentFolder"
SET "isPerson" = true
WHERE "id" IN (1, 2, 3) AND "name" IN ('Clari', 'Belu', 'Pato');
