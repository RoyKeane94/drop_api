-- CreateTable
CREATE TABLE "ClientErrorLog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" INTEGER,
    "userId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientErrorLog_code_key" ON "ClientErrorLog"("code");
