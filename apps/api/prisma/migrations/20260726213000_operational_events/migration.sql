-- CreateTable
CREATE TABLE "OperationalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "detail" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationalEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OperationalEvent_conversationId_createdAt_idx" ON "OperationalEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalEvent_eventType_createdAt_idx" ON "OperationalEvent"("eventType", "createdAt");
