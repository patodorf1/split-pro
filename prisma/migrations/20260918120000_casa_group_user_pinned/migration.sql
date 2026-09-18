-- Casa: pin por usuario para fijar un grupo arriba de la lista
ALTER TABLE "public"."GroupUser" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
