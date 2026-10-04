SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Prisma crée les listes scalaires (String[]) en colonne nullable ; le code ne
-- manipule jamais NULL ici (défaut []). La table est vide à ce stade : le
-- SET NOT NULL est instantané. Rollback : ALTER COLUMN "keywords" DROP NOT NULL.
UPDATE "Theme" SET "keywords" = ARRAY[]::TEXT[] WHERE "keywords" IS NULL;
ALTER TABLE "Theme" ALTER COLUMN "keywords" SET NOT NULL;

-- Rappel sur la plage de "Theme_position_range" (migration init) : 0..n-1 en
-- régime normal, positions négatives -1..-n transitoires pendant un
-- réordonnancement dans une même transaction.
