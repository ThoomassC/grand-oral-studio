SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Moteurs de rédaction (claude | ollama | free) et trace du moteur sur les decks.
--
-- Verrouillage : ADD COLUMN nullable et DROP NOT NULL ne réécrivent pas les
-- tables (métadonnées seules, ACCESS EXCLUSIVE bref, borné par lock_timeout).
-- Les CHECK sont posés NOT VALID (aucun parcours sous verrou fort) puis validés
-- par VALIDATE CONSTRAINT (SHARE UPDATE EXCLUSIVE : lectures et écritures continuent).
--
-- Rollback :
--   ALTER TABLE "Deck" DROP CONSTRAINT "Deck_engine_known", DROP COLUMN "engine";
--   ALTER TABLE "user_ai_settings" DROP CONSTRAINT "user_ai_settings_engine_known",
--     DROP CONSTRAINT "user_ai_settings_ollama_model_required",
--     DROP CONSTRAINT "user_ai_settings_ollama_model_length",
--     DROP CONSTRAINT "user_ai_settings_key_all_or_nothing",
--     DROP COLUMN "engine", DROP COLUMN "ollamaModel";
--   DELETE FROM "user_ai_settings" WHERE "anthropicKeyCiphertext" IS NULL;  -- puis :
--   ALTER TABLE "user_ai_settings" ALTER COLUMN "anthropicKeyCiphertext" SET NOT NULL,
--     ALTER COLUMN "anthropicKeyLast4" SET NOT NULL, ALTER COLUMN "keyVersion" SET NOT NULL;
--   (le DELETE perd les préférences de moteur des utilisateurs sans clé).

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "engine" TEXT;

-- AlterTable
ALTER TABLE "user_ai_settings" ADD COLUMN     "engine" TEXT,
ADD COLUMN     "ollamaModel" TEXT,
ALTER COLUMN "anthropicKeyCiphertext" DROP NOT NULL,
ALTER COLUMN "anthropicKeyLast4" DROP NOT NULL,
ALTER COLUMN "keyVersion" DROP NOT NULL;

-- NULL = deck antérieur au suivi du moteur.
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_engine_known"
    CHECK ("engine" IS NULL OR "engine" IN ('claude', 'ollama', 'free', 'mock')) NOT VALID;
ALTER TABLE "Deck" VALIDATE CONSTRAINT "Deck_engine_known";

-- La clé est entière ou absente : jamais un chiffré sans version, ni des 4 derniers caractères orphelins.
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_key_all_or_nothing"
    CHECK (
      ("anthropicKeyCiphertext" IS NULL AND "anthropicKeyLast4" IS NULL AND "keyVersion" IS NULL)
      OR ("anthropicKeyCiphertext" IS NOT NULL AND "anthropicKeyLast4" IS NOT NULL AND "keyVersion" IS NOT NULL)
    ) NOT VALID;
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_engine_known"
    CHECK ("engine" IS NULL OR "engine" IN ('claude', 'ollama', 'free')) NOT VALID;
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_ollama_model_required"
    CHECK ("engine" IS DISTINCT FROM 'ollama' OR "ollamaModel" IS NOT NULL) NOT VALID;
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_ollama_model_length"
    CHECK ("ollamaModel" IS NULL OR char_length("ollamaModel") BETWEEN 1 AND 200) NOT VALID;
ALTER TABLE "user_ai_settings" VALIDATE CONSTRAINT "user_ai_settings_key_all_or_nothing";
ALTER TABLE "user_ai_settings" VALIDATE CONSTRAINT "user_ai_settings_engine_known";
ALTER TABLE "user_ai_settings" VALIDATE CONSTRAINT "user_ai_settings_ollama_model_required";
ALTER TABLE "user_ai_settings" VALIDATE CONSTRAINT "user_ai_settings_ollama_model_length";
