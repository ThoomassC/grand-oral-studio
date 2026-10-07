SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- v1.2.0 — phase « expand » : tout est AJOUTÉ, rien n'est renommé ni supprimé. Le code v1.1
-- continue d'écrire (colonnes nouvelles nullables ou avec DEFAULT, contraintes élargies).
--
-- Exécution : Prisma envoie ce fichier en une seule requête multi-instructions, que
-- PostgreSQL exécute en UNE transaction implicite (tout ou rien). Les VALIDATE CONSTRAINT
-- sont dans la migration suivante (20261008090100_v120_validate), donc une autre transaction.
--
-- Verrouillage attendu :
--  - Program, Theme, Deck, user_ai_settings : ACCESS EXCLUSIVE (ADD COLUMN, ADD/DROP CHECK)
--    tenu jusqu'au COMMIT, mais bref : aucune réécriture de table (ADD COLUMN nullable ou
--    DEFAULT non volatil = métadonnées seules depuis PG 11 ; CURRENT_TIMESTAMP est STABLE,
--    évalué une fois). Aucun parcours sous ce verrou : CHECK et clé étrangère du Deck posés
--    NOT VALID. Ordre d'acquisition parent → enfant (Program, Theme, Deck), comme le code.
--  - "user" : SHARE ROW EXCLUSIVE (création des clés étrangères vers lui) : bloque les
--    écritures sur "user" jusqu'au COMMIT, pas les lectures.
--  - user_ai_settings : la recopie des clés la parcourt (table de quelques lignes par
--    utilisateur ; aucun lot nécessaire à ce volume).
--  - Nouvelles tables : vides, index créés sans CONCURRENTLY sans conséquence.
--  Si un verrou n'est pas obtenu en 3 s, la migration échoue ENTIÈREMENT (rien n'est appliqué)
--  et se relance telle quelle.
--
-- Ordre de déploiement : cette migration AVANT le code 1.2 (le code 1.1 l'ignore), puis
-- v120_validate, puis le code 1.2. Rollback : voir le bloc en fin de fichier.

-- ---------------------------------------------------------------------------
-- Colonnes (tables existantes)
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "exportTriedAt" TIMESTAMPTZ(3);

-- AlterTable — problems NOT NULL (comme keywords, cf. 20261001120838) : Prisma créerait la
-- liste nullable ; DEFAULT constant donc sans réécriture.
ALTER TABLE "Theme" ADD COLUMN     "problems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "practice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prepStartedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "user_ai_settings" ADD COLUMN     "keySource" TEXT;

-- ---------------------------------------------------------------------------
-- Nouvelles tables
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "user_ai_credential" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "aadScheme" INTEGER NOT NULL,
    "last4" VARCHAR(4) NOT NULL,
    "model" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_ai_credential_pkey" PRIMARY KEY ("userId","provider"),
    CONSTRAINT "user_ai_credential_provider_known"
        CHECK ("provider" IN ('claude', 'mistral', 'gemini', 'openai')),
    -- 1 = AAD userId (clés recopiées de 1.1), 2 = AAD `userId:provider`.
    CONSTRAINT "user_ai_credential_aad_scheme_known" CHECK ("aadScheme" IN (1, 2)),
    -- Jamais de clé en clair : seul le format chiffré versionné est accepté (même règle
    -- que user_ai_settings_ciphertext_format).
    CONSTRAINT "user_ai_credential_ciphertext_format"
        CHECK ("ciphertext" ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
    CONSTRAINT "user_ai_credential_last4_length" CHECK (char_length("last4") = 4),
    CONSTRAINT "user_ai_credential_key_version_positive" CHECK ("keyVersion" >= 1),
    CONSTRAINT "user_ai_credential_model_length"
        CHECK ("model" IS NULL OR char_length("model") BETWEEN 1 AND 200)
);

-- CreateTable
CREATE TABLE "ProgramMember" (
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramMember_pkey" PRIMARY KEY ("programId","userId"),
    -- Le propriétaire est Program.ownerId : il n'y a pas de rôle OWNER ici.
    CONSTRAINT "ProgramMember_role_known" CHECK ("role" IN ('EDITOR', 'VIEWER'))
);

-- CreateTable
CREATE TABLE "DeckQuestion" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeckQuestion_pkey" PRIMARY KEY ("id"),
    -- Même plage que Theme_position_range (positions négatives transitoires au réordonnancement).
    CONSTRAINT "DeckQuestion_position_range" CHECK ("position" > -1000 AND "position" < 1000),
    CONSTRAINT "DeckQuestion_question_length" CHECK (char_length("question") BETWEEN 1 AND 1000),
    CONSTRAINT "DeckQuestion_answer_length" CHECK (char_length("answer") <= 4000)
);

-- CreateTable
CREATE TABLE "DeckQuestionReview" (
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeckQuestionReview_pkey" PRIMARY KEY ("questionId","userId"),
    CONSTRAINT "DeckQuestionReview_status_known" CHECK ("status" IN ('KNOWN', 'TO_REVIEW'))
);

-- CreateTable
CREATE TABLE "Rehearsal" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalSeconds" INTEGER NOT NULL,
    "perSlide" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rehearsal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Rehearsal_total_seconds_range" CHECK ("totalSeconds" BETWEEN 1 AND 7200),
    CONSTRAINT "Rehearsal_per_slide_is_array" CHECK (jsonb_typeof("perSlide") = 'array')
);

-- CreateTable
CREATE TABLE "SharedModel" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SharedModel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SharedModel_kind_known" CHECK ("kind" IN ('TEMPLATE', 'BRAND')),
    CONSTRAINT "SharedModel_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "SharedModel_payload_is_object" CHECK (jsonb_typeof("payload") = 'object')
);

-- CreateIndex
CREATE INDEX "ProgramMember_userId_idx" ON "ProgramMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeckQuestion_deckId_position_key" ON "DeckQuestion"("deckId", "position");

-- CreateIndex
CREATE INDEX "Rehearsal_deckId_createdAt_idx" ON "Rehearsal"("deckId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SharedModel_authorId_idx" ON "SharedModel"("authorId");

-- ---------------------------------------------------------------------------
-- Clés étrangères
-- ---------------------------------------------------------------------------

-- Table existante : NOT VALID (aucun parcours de "Deck" sous verrou), validée dans v120_validate.
-- La contrainte s'applique dès maintenant aux nouvelles écritures.
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "user_ai_credential" ADD CONSTRAINT "user_ai_credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMember" ADD CONSTRAINT "ProgramMember_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMember" ADD CONSTRAINT "ProgramMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckQuestion" ADD CONSTRAINT "DeckQuestion_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckQuestionReview" ADD CONSTRAINT "DeckQuestionReview_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "DeckQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckQuestionReview" ADD CONSTRAINT "DeckQuestionReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rehearsal" ADD CONSTRAINT "Rehearsal_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rehearsal" ADD CONSTRAINT "Rehearsal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedModel" ADD CONSTRAINT "SharedModel_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK sur tables existantes : NOT VALID ici, VALIDATE dans v120_validate.
-- ---------------------------------------------------------------------------

-- Problématiques d'un sujet : 30 au plus, chacune de 10 à 1500 caractères, aucune NULL,
-- tableau à une dimension. Fonction IMMUTABLE (un CHECK ne peut pas contenir de sous-requête).
-- search_path figé : la fonction ne dépend pas du search_path de l'appelant.
CREATE FUNCTION theme_problems_valid(problems TEXT[]) RETURNS BOOLEAN
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT problems IS NOT NULL
       AND coalesce(array_ndims(problems), 1) = 1
       AND cardinality(problems) <= 30
       AND NOT EXISTS (
           SELECT 1 FROM unnest(problems) AS p(value)
           WHERE p.value IS NULL OR char_length(p.value) NOT BETWEEN 10 AND 1500
       )
$$;

ALTER TABLE "Theme" ADD CONSTRAINT "Theme_problems_valid" CHECK (theme_problems_valid("problems")) NOT VALID;

-- Entraînement et chrono de préparation : propres aux decks FINAL.
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_practice_final_only" CHECK ("kind" = 'FINAL' OR NOT "practice") NOT VALID;
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_prep_started_final_only" CHECK ("kind" = 'FINAL' OR "prepStartedAt" IS NULL) NOT VALID;

-- Moteurs cloud : élargissement (+ mistral, gemini, openai). Remplacement en une instruction :
-- aucune fenêtre sans contrainte.
ALTER TABLE "Deck" DROP CONSTRAINT "Deck_engine_known",
    ADD CONSTRAINT "Deck_engine_known"
    CHECK ("engine" IS NULL OR "engine" IN ('claude', 'mistral', 'gemini', 'openai', 'ollama', 'free', 'mock')) NOT VALID;

ALTER TABLE "user_ai_settings" DROP CONSTRAINT "user_ai_settings_engine_known",
    ADD CONSTRAINT "user_ai_settings_engine_known"
    CHECK ("engine" IS NULL OR "engine" IN ('claude', 'mistral', 'gemini', 'openai', 'ollama', 'free')) NOT VALID;

-- NULL = règle 1.1 (clé personnelle si elle existe, sinon clé serveur).
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_key_source_known"
    CHECK ("keySource" IS NULL OR "keySource" IN ('user', 'server')) NOT VALID;

-- ---------------------------------------------------------------------------
-- Recopie des clés Anthropic de 1.1 vers user_ai_credential.
-- Même chiffré, même keyVersion, même last4 ; aadScheme 1 = chiffré avec AAD userId (le code
-- 1.2 le rechiffre en schéma 2 à la lecture). verifiedAt NULL : user_ai_settings n'a aucune
-- colonne de date de vérification (une clé n'y était enregistrée qu'après vérification, mais
-- updatedAt bouge aussi au changement de moteur : ce n'est pas une date de vérification).
-- Rejouable (ON CONFLICT DO NOTHING) : à relancer avant le « contract » 1.3 pour rattraper les
-- clés enregistrées par le code 1.1 entre cette migration et le déploiement du code 1.2.
-- Le bloc balisé est rejoué tel quel par src/server/__tests__/schema-v120.int.test.ts.
-- ---------------------------------------------------------------------------

-- BEGIN copy_claude_keys
INSERT INTO "user_ai_credential" ("userId", "provider", "ciphertext", "keyVersion", "aadScheme", "last4", "model", "verifiedAt", "createdAt", "updatedAt")
SELECT s."userId", 'claude', s."anthropicKeyCiphertext", s."keyVersion", 1, s."anthropicKeyLast4", NULL, NULL, s."createdAt", s."updatedAt"
FROM "user_ai_settings" AS s
WHERE s."anthropicKeyCiphertext" IS NOT NULL
ON CONFLICT ("userId", "provider") DO NOTHING
-- END copy_claude_keys
;

-- ---------------------------------------------------------------------------
-- Rollback (à exécuter AVANT tout retour au seul code 1.1 ; le code 1.1 fonctionne aussi
-- avec le schéma 1.2 en place, le rollback n'est donc nécessaire qu'en cas d'abandon).
-- Perd : membres, questions, statuts, répétitions, modèles partagés, clés des fournisseurs
-- autres que Claude, problématiques des sujets, corbeille (les éléments supprimés en douceur
-- redeviennent visibles : purger d'abord si ce n'est pas voulu), decks d'entraînement (qui
-- redeviennent des decks du jour J). Les clés Claude restent dans user_ai_settings : si le
-- code 1.2 les a rechiffrées ou remplacées dans user_ai_credential, les recopier d'abord
-- (une clé en aadScheme 2 n'est PAS lisible par le code 1.1 : la rechiffrer en AAD userId).
--
--   SET lock_timeout = '3s';
--   ALTER TABLE "user_ai_settings" DROP CONSTRAINT "user_ai_settings_key_source_known",
--       DROP CONSTRAINT "user_ai_settings_engine_known", DROP COLUMN "keySource";
--   UPDATE "user_ai_settings" SET "engine" = NULL WHERE "engine" IN ('mistral', 'gemini', 'openai');
--   ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_engine_known"
--       CHECK ("engine" IS NULL OR "engine" IN ('claude', 'ollama', 'free'));
--   ALTER TABLE "Deck" DROP CONSTRAINT "Deck_engine_known";
--   UPDATE "Deck" SET "engine" = NULL WHERE "engine" IN ('mistral', 'gemini', 'openai');
--   ALTER TABLE "Deck" ADD CONSTRAINT "Deck_engine_known"
--       CHECK ("engine" IS NULL OR "engine" IN ('claude', 'ollama', 'free', 'mock'));
--   DROP TABLE "SharedModel", "Rehearsal", "DeckQuestionReview", "DeckQuestion",
--       "ProgramMember", "user_ai_credential";
--   ALTER TABLE "Deck" DROP CONSTRAINT "Deck_createdById_fkey",
--       DROP CONSTRAINT "Deck_practice_final_only", DROP CONSTRAINT "Deck_prep_started_final_only",
--       DROP COLUMN "createdById", DROP COLUMN "deletedAt", DROP COLUMN "practice",
--       DROP COLUMN "prepStartedAt";
--   ALTER TABLE "Theme" DROP CONSTRAINT "Theme_problems_valid",
--       DROP COLUMN "problems", DROP COLUMN "updatedAt";
--   DROP FUNCTION theme_problems_valid(TEXT[]);
--   ALTER TABLE "Program" DROP COLUMN "deletedAt", DROP COLUMN "exportTriedAt";
--   DELETE FROM "_prisma_migrations"
--       WHERE "migration_name" IN ('20261008090000_v120_expand', '20261008090100_v120_validate');
