SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Parcours en 5 étapes : dates du dernier enregistrement explicite de la charte
-- et du gabarit. Colonnes nullables sans défaut : ADD COLUMN ne réécrit pas la
-- table (métadonnées seules, verrou ACCESS EXCLUSIVE bref, borné par lock_timeout).
-- Pas de rétro-remplissage : les projets existants restent « à faire » jusqu'au
-- prochain enregistrement (voulu).
-- Rollback : ALTER TABLE "Program" DROP COLUMN "brandSavedAt", DROP COLUMN "templateSavedAt";

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "brandSavedAt" TIMESTAMPTZ(3),
ADD COLUMN     "templateSavedAt" TIMESTAMPTZ(3);
