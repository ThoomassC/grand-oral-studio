-- Garde-fous de verrouillage (cf. pg-perf) : ne jamais faire la queue indéfiniment derrière un verrou.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- CreateEnum
CREATE TYPE "DeckKind" AS ENUM ('SKELETON', 'FINAL');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "brand" JSONB NOT NULL,
    "template" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "kind" "DeckKind" NOT NULL,
    "problem" TEXT,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_window" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "usage_window_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rateLimit_key_key" ON "rateLimit"("key");

-- CreateIndex
CREATE INDEX "Program_ownerId_updatedAt_idx" ON "Program"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Theme_programId_position_key" ON "Theme"("programId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Theme_id_programId_key" ON "Theme"("id", "programId");

-- CreateIndex
CREATE INDEX "Deck_programId_kind_createdAt_idx" ON "Deck"("programId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Deck_themeId_idx" ON "Deck"("themeId");

-- CreateIndex
CREATE UNIQUE INDEX "Deck_one_skeleton_per_theme" ON "Deck"("themeId") WHERE ("kind" = 'SKELETON');

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_themeId_programId_fkey" FOREIGN KEY ("themeId", "programId") REFERENCES "Theme"("id", "programId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants non exprimables dans le schéma Prisma (ajoutés à la main).
-- Prisma ne gère pas les CHECK : ils ne provoquent pas de dérive au diff.
-- ---------------------------------------------------------------------------

-- Position d'un thème : entier positif ou nul (les positions temporaires du
-- réordonnancement sont négatives, cf. src/server/repo/themes.ts) -> on borne
-- uniquement par le haut et par une plage raisonnable.
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_position_range" CHECK ("position" > -1000 AND "position" < 1000);

-- Bornes de taille alignées sur les schémas zod (défense en profondeur).
ALTER TABLE "Program" ADD CONSTRAINT "Program_name_length" CHECK (char_length("name") BETWEEN 1 AND 120);
ALTER TABLE "Program" ADD CONSTRAINT "Program_description_length" CHECK (char_length("description") <= 2000);
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_name_length" CHECK (char_length("name") BETWEEN 1 AND 120);

-- Un squelette n'a pas de problématique ; un deck final en a toujours une.
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_problem_matches_kind" CHECK (
  ("kind" = 'SKELETON' AND "problem" IS NULL) OR
  ("kind" = 'FINAL' AND "problem" IS NOT NULL AND char_length("problem") BETWEEN 1 AND 1500)
);

-- Les JSON stockés sont toujours des objets.
ALTER TABLE "Program" ADD CONSTRAINT "Program_brand_is_object" CHECK (jsonb_typeof("brand") = 'object');
ALTER TABLE "Program" ADD CONSTRAINT "Program_template_is_object" CHECK (jsonb_typeof("template") = 'object');
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_spec_is_object" CHECK (jsonb_typeof("spec") = 'object');
