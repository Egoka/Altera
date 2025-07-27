/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `magic_link_tokens` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "magic_link_tokens_userId_key" ON "magic_link_tokens"("userId");
