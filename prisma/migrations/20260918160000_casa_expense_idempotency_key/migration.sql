-- Casa: gastos cargados por la API externa + clave de idempotencia

-- CreateTable
CREATE TABLE "public"."ExternalExpense" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "expenseId" UUID,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalExpense_expenseId_key" ON "public"."ExternalExpense"("expenseId");

-- CreateIndex
-- NULLs son distintos entre sí en Postgres: los gastos cargados sin clave pueden convivir, pero una
-- clave concreta es única dentro del grupo.
CREATE UNIQUE INDEX "ExternalExpense_groupId_idempotencyKey_key" ON "public"."ExternalExpense"("groupId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "public"."ExternalExpense" ADD CONSTRAINT "ExternalExpense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExternalExpense" ADD CONSTRAINT "ExternalExpense_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "public"."Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
