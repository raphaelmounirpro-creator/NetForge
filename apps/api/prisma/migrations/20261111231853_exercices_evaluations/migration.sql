-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "content" JSON NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "owner_id" UUID NOT NULL,
    "exercise_id" UUID,
    "exercise_revision" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "content" JSON NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "hints_revealed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(3),
    "score" INTEGER,
    "max_score" INTEGER NOT NULL,
    "result" JSON,
    "evaluator_version" INTEGER,
    "engine_version" VARCHAR(32),
    "submission_hash" CHAR(64),

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercises_owner_id_updated_at_idx" ON "exercises"("owner_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "publications_code_key" ON "publications"("code");

-- CreateIndex
CREATE INDEX "publications_exercise_id_created_at_idx" ON "publications"("exercise_id", "created_at");

-- CreateIndex
CREATE INDEX "attempts_user_id_started_at_idx" ON "attempts"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "attempts_publication_id_user_id_idx" ON "attempts"("publication_id", "user_id");

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
