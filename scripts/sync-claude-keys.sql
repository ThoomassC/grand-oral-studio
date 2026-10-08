-- Synchronise les clés Claude de user_ai_credential (provider 'claude', aadScheme 1)
-- avec les colonnes historiques anthropicKey* de user_ai_settings.
--
-- Quand : après le déploiement du code 1.2.0, puis une fois encore avant le « contract »
-- de la 1.3 (suppression des colonnes anthropicKey*). Entre l'application de la migration
-- 20261008090000_v120_expand et la mise en ligne du code 1.2, le code 1.1 a pu ajouter,
-- remplacer ou supprimer une clé Claude dans les colonnes historiques ; la recopie de la
-- migration (ON CONFLICT DO NOTHING) ne voit que les ajouts.
--
-- Rejouable : un second passage ne change rien. Les lignes aadScheme 2 ont été écrites
-- (ou rechiffrées) par le code 1.2 : elles font foi et ne sont jamais touchées.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sync-claude-keys.sql
--
-- Verrous : lignes de user_ai_credential concernées uniquement (aucun verrou de table
-- au-delà de ROW EXCLUSIVE). Retour arrière : aucun nécessaire, les colonnes historiques
-- restent la source ; rejouer le script après correction suffit.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Clé supprimée par le code 1.1 (ou réglages disparus) : la recopie aadScheme 1 est retirée.
DELETE FROM "user_ai_credential" AS c
WHERE c."provider" = 'claude'
  AND c."aadScheme" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "user_ai_settings" AS s
    WHERE s."userId" = c."userId" AND s."anthropicKeyCiphertext" IS NOT NULL
  );

-- Clé ajoutée par le code 1.1 : recopiée. Clé remplacée : la recopie aadScheme 1 suit,
-- et sa date de vérification, qui portait sur l'ancienne clé, est effacée.
INSERT INTO "user_ai_credential" ("userId", "provider", "ciphertext", "keyVersion", "aadScheme", "last4", "model", "verifiedAt", "createdAt", "updatedAt")
SELECT s."userId", 'claude', s."anthropicKeyCiphertext", s."keyVersion", 1, s."anthropicKeyLast4", NULL, NULL, s."createdAt", s."updatedAt"
FROM "user_ai_settings" AS s
WHERE s."anthropicKeyCiphertext" IS NOT NULL
ON CONFLICT ("userId", "provider") DO UPDATE
SET "ciphertext" = EXCLUDED."ciphertext",
    "keyVersion" = EXCLUDED."keyVersion",
    "last4" = EXCLUDED."last4",
    "verifiedAt" = NULL,
    "updatedAt" = now()
WHERE "user_ai_credential"."aadScheme" = 1
  AND "user_ai_credential"."ciphertext" IS DISTINCT FROM EXCLUDED."ciphertext";

COMMIT;
