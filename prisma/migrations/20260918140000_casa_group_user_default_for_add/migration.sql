-- Casa: grupo preseleccionado al agregar un gasto (como mucho uno por usuario)
ALTER TABLE "public"."GroupUser" ADD COLUMN "defaultForAdd" BOOLEAN NOT NULL DEFAULT false;
