"use client";

import { Badge, Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { PROVIDER_INFO, type CloudProvider } from "@/domain/ai-providers";
import { deleteConnection, selectWriter } from "@/server/actions/settings";
import { failureMessage } from "./action-error";
import type { ConnectionStatus } from "./ai-status";

const NETWORK_ERROR = "La connexion a été interrompue. Réessayez.";

/**
 * « Mes connexions » : les clés personnelles enregistrées (fournisseur, 4
 * derniers caractères, modèle, date de vérification), avec, pour chacune,
 * « Active » si elle rédige le jour J, sinon « Utiliser » ; « Remplacer »
 * (ouvre la question 2 sur ce fournisseur) et « Supprimer » (confirmation).
 * Sans clé : un état vide qui renvoie vers les cartes de la question 1.
 */
export function ConnectionList({
  connections,
  active,
  headingId,
  onUsed,
  onReplace,
}: {
  connections: ConnectionStatus[];
  /** Fournisseur dont la clé personnelle rédige le jour J, null sinon. */
  active: CloudProvider | null;
  /** Titre de la section : reprend le focus quand une ligne disparaît. */
  headingId: string;
  onUsed: (provider: CloudProvider) => void;
  onReplace: (provider: CloudProvider) => void;
}) {
  const router = useRouter();
  const baseId = useId();
  const replaceId = (provider: CloudProvider) => `${baseId}-replace-${provider}`;
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [using, startUse] = useTransition();
  const [usingProvider, setUsingProvider] = useState<CloudProvider | null>(null);

  function use(provider: CloudProvider) {
    if (using) return;
    setStatus(IDLE);
    setUsingProvider(provider);
    startUse(async () => {
      try {
        const result = await selectWriter({ engine: provider, keySource: "user" });
        if (!result.ok) {
          setStatus({ kind: "error", message: failureMessage(result) });
          return;
        }
        onUsed(provider);
        setStatus({ kind: "success", message: `Choix enregistré : ${PROVIDER_INFO[provider].label}.` });
        // « Utiliser » laisse place au badge « Active » : le focus passe à « Remplacer », sur la même ligne.
        focusLater([replaceId(provider)]);
        router.refresh();
      } catch {
        setStatus({ kind: "error", message: NETWORK_ERROR });
      }
    });
  }

  if (connections.length === 0) {
    return (
      <p className="mt-2 text-muted">
        Aucune clé enregistrée. Cochez Mistral, Gemini, Claude ou OpenAI ci-dessus pour connecter la vôtre.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <FormStatus state={status} className="mb-3" />
      <ul aria-labelledby={headingId} className="flex flex-col">
        {connections.map((c) => {
          const label = PROVIDER_INFO[c.provider].label;
          const isActive = c.provider === active;
          return (
            <li key={c.provider} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
              <div className="min-w-0">
                <p className="font-semibold">{label}</p>
                <p className="text-sm text-muted">
                  Clé <span className="num">•••• {c.last4}</span> · {c.modelLabel} ·{" "}
                  {c.verifiedAtLabel ? `vérifiée le ${c.verifiedAtLabel}` : "pas encore vérifiée"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isActive ? (
                  <Badge tone="primary">Active</Badge>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    aria-label={`Utiliser ${label}`}
                    aria-disabled={using || undefined}
                    onClick={() => use(c.provider)}
                  >
                    <ButtonLabel idle="Utiliser" busy="Enregistrement…" isBusy={using && usingProvider === c.provider} />
                  </Button>
                )}
                <Button
                  id={replaceId(c.provider)}
                  type="button"
                  variant="ghost"
                  size="small"
                  aria-label={`Remplacer la clé ${label}`}
                  onClick={() => onReplace(c.provider)}
                >
                  Remplacer
                </Button>
                <ConfirmAction
                  triggerLabel="Supprimer"
                  triggerAccessibleLabel={`Supprimer la clé ${label}`}
                  title={`Supprimer la clé ${label} ?`}
                  triggerDisabled={using}
                  question={`Votre clé est effacée de Grand Oral Studio. Elle reste valable chez ${PROVIDER_INFO[c.provider].apiName}.${
                    isActive ? ` ${label} rédige le jour J : choisissez ensuite un autre rédacteur.` : ""
                  }`}
                  confirmLabel="Supprimer la clé"
                  onConfirm={async () => {
                    const result = await deleteConnection({ provider: c.provider });
                    if (!result.ok) return failureMessage(result);
                    setStatus({ kind: "success", message: `Clé ${label} supprimée.` });
                    router.refresh();
                    return null;
                  }}
                  onDone={() => focusLater([headingId])}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
