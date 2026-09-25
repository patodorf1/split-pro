-- CreateTable
CREATE TABLE "public"."DolarBlueRate" (
    "date" DATE NOT NULL,
    "buy" DOUBLE PRECISION NOT NULL,
    "sell" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DolarBlueRate_pkey" PRIMARY KEY ("date")
);
