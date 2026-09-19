-- CreateTable
CREATE TABLE "feedback_submissions" (
    "id" UUID NOT NULL,
    "user_sub" TEXT NOT NULL,
    "issue_number" INTEGER NOT NULL,
    "issue_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT,
    "state_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "state_fetched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_submissions_user_sub_created_at_idx" ON "feedback_submissions"("user_sub", "created_at");

-- AddForeignKey
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_user_sub_fkey" FOREIGN KEY ("user_sub") REFERENCES "users"("sub") ON DELETE CASCADE ON UPDATE CASCADE;
