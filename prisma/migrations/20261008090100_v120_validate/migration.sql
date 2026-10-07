SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- v1.2.0 — validation des contraintes posées NOT VALID par 20261008090000_v120_expand.
-- Fichier séparé = transaction séparée : le verrou ACCESS EXCLUSIVE de l'expand est relâché.
--
-- Verrouillage : VALIDATE CONSTRAINT prend SHARE UPDATE EXCLUSIVE sur la table validée
-- (lectures ET écritures continuent ; seuls les DDL concurrents attendent) et parcourt la
-- table. Pour la clé étrangère, ROW SHARE sur "user" (les écritures sur "user" continuent).
-- Toutes les lignes existantes satisfont déjà ces contraintes (colonnes neuves à leur défaut,
-- ensembles de valeurs élargis) : la validation ne peut échouer que sur une donnée écrite à la
-- main entre les deux migrations, et alors rien n'est validé (on corrige puis on relance).
--
-- Rollback : aucun nécessaire (une contrainte validée se retire par le rollback de l'expand) ;
-- supprimer la ligne de _prisma_migrations si l'on veut rejouer ce fichier.

ALTER TABLE "Theme" VALIDATE CONSTRAINT "Theme_problems_valid";

ALTER TABLE "Deck" VALIDATE CONSTRAINT "Deck_createdById_fkey";
ALTER TABLE "Deck" VALIDATE CONSTRAINT "Deck_practice_final_only";
ALTER TABLE "Deck" VALIDATE CONSTRAINT "Deck_prep_started_final_only";
ALTER TABLE "Deck" VALIDATE CONSTRAINT "Deck_engine_known";

ALTER TABLE "user_ai_settings" VALIDATE CONSTRAINT "user_ai_settings_engine_known";
ALTER TABLE "user_ai_settings" VALIDATE CONSTRAINT "user_ai_settings_key_source_known";
