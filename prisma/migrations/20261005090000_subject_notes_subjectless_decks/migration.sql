SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- v1.1.0 : notes des sujets, decks finaux sans sujet.
-- Verrouillage : ADD COLUMN avec DEFAULT constant et DROP NOT NULL = métadonnées seules (PG ≥ 11),
-- ACCESS EXCLUSIVE bref borné par lock_timeout. CHECK posés NOT VALID puis validés
-- (SHARE UPDATE EXCLUSIVE : lectures et écritures continuent). La clé étrangère composite
-- "Deck_themeId_programId_fkey" est INCHANGÉE (MATCH SIMPLE : un themeId NULL n'est pas contrôlé).
-- Rollback (perd les decks sans sujet) :
--   DELETE FROM "Deck" WHERE "themeId" IS NULL;
--   ALTER TABLE "Deck" DROP CONSTRAINT "Deck_skeleton_has_theme", ALTER COLUMN "themeId" SET NOT NULL;
--   ALTER TABLE "Theme" DROP CONSTRAINT "Theme_notes_length", DROP COLUMN "notes";

ALTER TABLE "Theme" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_notes_length" CHECK (char_length("notes") <= 4000) NOT VALID;
ALTER TABLE "Theme" VALIDATE CONSTRAINT "Theme_notes_length";

ALTER TABLE "Deck" ALTER COLUMN "themeId" DROP NOT NULL;
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_skeleton_has_theme" CHECK ("kind" <> 'SKELETON' OR "themeId" IS NOT NULL) NOT VALID;
ALTER TABLE "Deck" VALIDATE CONSTRAINT "Deck_skeleton_has_theme";
