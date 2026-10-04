SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Nouvelle table : aucune réécriture. La clé étrangère pose un verrou
-- SHARE ROW EXCLUSIVE bref sur "user" (borné par lock_timeout).
-- Rollback : DROP TABLE "user_ai_settings"; (supprime les clés enregistrées).

-- CreateTable
CREATE TABLE "user_ai_settings" (
    "userId" TEXT NOT NULL,
    "anthropicKeyCiphertext" TEXT NOT NULL,
    "anthropicKeyLast4" VARCHAR(4) NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_ai_settings_pkey" PRIMARY KEY ("userId"),
    -- Jamais de clé en clair : seul le format chiffré versionné est accepté.
    CONSTRAINT "user_ai_settings_ciphertext_format"
        CHECK ("anthropicKeyCiphertext" ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
    CONSTRAINT "user_ai_settings_last4_length" CHECK (char_length("anthropicKeyLast4") = 4),
    CONSTRAINT "user_ai_settings_key_version_positive" CHECK ("keyVersion" >= 1)
);

-- AddForeignKey
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
