"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, focusLater } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { ANTHROPIC_KEY_MAX_LENGTH, SaveApiKeyInputSchema } from "@/domain/api-key";
import { activateClaude, deleteAnthropicApiKey } from "@/server/actions/settings";
import type { AiSetupStatus } from "./ai-status";

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";
const NETWORK_ERROR = "La connexion a été interrompue. Réessayez.";

/** La clé saisie n'est jamais conservée dans cet état : seulement les messages. */
interface ActivateState {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const INITIAL: ActivateState = { status: IDLE, fieldErrors: {} };

const SOURCE_NOTE: Partial<Record<AiSetupStatus["claude"]["source"], string>> = {
  mock: "Mode démonstration : aucune clé nécessaire.",
  server: "Le serveur fournit une clé : vous pouvez aussi utiliser la vôtre.",
};

/**
 * Question 2 de la Configuration IA : connecter Claude avec sa clé API.
 *
 * Sans clé personnelle : trois étapes (créer, coller, « Vérifier et
 * activer »), qui vérifient la clé, l'enregistrent chiffrée ET choisissent
 * Claude en un seul geste côté serveur. Avec une clé : son résumé (4 derniers
 * caractères), « Remplacer » (révèle le champ) et « Supprimer ma clé ».
 *
 * Le format est validé ici avec le schéma de l'action (aucun appel serveur
 * pour une clé mal formée) ; la validité réelle est vérifiée par le serveur.
 */
export function ClaudeConnect({ claude, onActivated }: { claude: AiSetupStatus["claude"]; onActivated: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  /** Garde synchrone contre le double clic : `pending` n'est vrai qu'au rendu suivant. */
  const submittingRef = useRef(false);
  /**
   * Activation réussie alors que « Remplacer » n'existe pas encore (première clé) :
   * le formulaire, et son bouton focalisé, disparaîtront au rafraîchissement de la
   * page ; « Remplacer » prendra alors le focus en apparaissant.
   */
  const focusReplaceOnMountRef = useRef(false);
  const baseId = useId();
  const ids = { form: `${baseId}-form`, key: `${baseId}-key`, hint: `${baseId}-hint`, replace: `${baseId}-replace` };
  const [replacing, setReplacing] = useState(false);
  const [keyTyped, setKeyTyped] = useState(false);
  const [announce, setAnnounce] = useState("");
  // Une clé saisie mais pas activée serait perdue en quittant la page.
  useUnsavedChanges(keyTyped);

  const [state, submit, pending] = useActionState<ActivateState, FormData>(async (_prev, formData) => {
    try {
      const checked = validateWith(SaveApiKeyInputSchema, { apiKey: String(formData.get("apiKey") ?? "") });
      if (!checked.ok) {
        focusFirstInvalid(formRef.current);
        return { status: { kind: "error", message: "La clé saisie n'a pas le bon format." }, fieldErrors: checked.fieldErrors };
      }
      let result: Awaited<ReturnType<typeof activateClaude>>;
      try {
        result = await activateClaude(checked.data);
      } catch {
        return { status: { kind: "error", message: NETWORK_ERROR }, fieldErrors: {} };
      }
      if (!result.ok) {
        const fieldErrors = result.fieldErrors ?? {};
        if (firstError(fieldErrors, "apiKey")) focusFirstInvalid(formRef.current);
        return { status: { kind: "error", message: result.error }, fieldErrors };
      }
      // Succès : le champ est vidé, la clé ne reste nulle part côté client.
      formRef.current?.reset();
      setReplacing(false);
      setAnnounce(`Claude est activé : clé •••• ${result.data.last4} vérifiée et enregistrée.`);
      // Le formulaire disparaît avec le bouton focalisé : le focus passe à « Remplacer », à côté de
      // l'état de la clé. Déjà là (remplacement) : tout de suite ; sinon, à son apparition.
      if (document.getElementById(ids.replace)) focusLater([ids.replace]);
      else focusReplaceOnMountRef.current = true;
      onActivated();
      router.refresh();
      return INITIAL;
    } finally {
      submittingRef.current = false;
    }
  }, INITIAL);

  const showForm = claude.userKey === null || replacing;

  /** Ref de « Remplacer » : prend le focus à son apparition après une activation, s'il est perdu. */
  const replaceRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node || !focusReplaceOnMountRef.current) return;
    focusReplaceOnMountRef.current = false;
    const active = node.ownerDocument.activeElement;
    // Ne pas voler le focus si l'utilisateur est allé ailleurs entre-temps.
    if (active === null || active === node.ownerDocument.body) node.focus();
  }, []);
  const keyError = firstError(state.fieldErrors, "apiKey");
  const note = claude.userKey === null ? SOURCE_NOTE[claude.source] : undefined;

  return (
    <div className="flex flex-col gap-5">
      {claude.userKey ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
          <p>
            Clé <span className="num font-semibold">•••• {claude.userKey.last4}</span>
            {claude.userKey.addedAtLabel ? <> · ajoutée le {claude.userKey.addedAtLabel}</> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              id={ids.replace}
              ref={replaceRef}
              type="button"
              variant="ghost"
              size="small"
              aria-expanded={replacing}
              aria-controls={ids.form}
              onClick={() => {
                if (pending) return;
                if (replacing) {
                  formRef.current?.reset();
                  setReplacing(false);
                  return;
                }
                // Rendu immédiat du champ révélé, puis focus dessus (dans le même geste).
                flushSync(() => {
                  setReplacing(true);
                  setAnnounce("");
                });
                document.getElementById(ids.key)?.focus();
              }}
            >
              Remplacer
            </Button>
            <ConfirmAction
              triggerLabel="Supprimer ma clé"
              title="Supprimer votre clé ?"
              triggerDisabled={pending}
              question="Votre clé est effacée de Grand Oral Studio. Elle reste valable dans votre console Anthropic."
              confirmLabel="Supprimer la clé"
              onConfirm={async () => {
                const result = await deleteAnthropicApiKey();
                if (!result.ok) return result.error;
                setReplacing(false);
                setAnnounce("Votre clé a été supprimée.");
                router.refresh();
                return null;
              }}
              onDone={() => focusLater([ids.key])}
            />
          </div>
        </div>
      ) : note ? (
        <p className="rounded-lg border border-border bg-surface-2 p-4">{note}</p>
      ) : null}

      {showForm ? (
        <form
          id={ids.form}
          ref={formRef}
          noValidate
          aria-label="Connecter Claude avec votre clé API"
          onReset={() => setKeyTyped(false)}
          onSubmit={(e) => {
            e.preventDefault();
            if (pending || submittingRef.current) return;
            submittingRef.current = true;
            setAnnounce("");
            const data = new FormData(e.currentTarget);
            startTransition(() => submit(data));
          }}
        >
          <ol className="flex list-decimal flex-col gap-4 pl-5 marker:font-semibold marker:text-muted">
            <li>
              Créez une clé dans la{" "}
              <a href={CONSOLE_URL} className="opale-link font-semibold" target="_blank" rel="noopener noreferrer">
                console Anthropic, rubrique API Keys
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
              .
            </li>
            <li>
              <label htmlFor={ids.key} className="opale-field__label">
                Clé API Anthropic
              </label>
              <PasswordInput
                id={ids.key}
                name="apiKey"
                autoComplete="off"
                data-1p-ignore=""
                data-lpignore="true"
                spellCheck={false}
                placeholder="sk-ant-…"
                maxLength={ANTHROPIC_KEY_MAX_LENGTH}
                onChange={(e) => setKeyTyped(e.target.value !== "")}
                {...errorProps(state.fieldErrors, "apiKey", `${ids.key}-err`, ids.hint)}
              />
              <p id={ids.hint} className="opale-field__helper">
                Collez-la ici. Elle commence par « sk-ant- ».
              </p>
              <FieldError id={`${ids.key}-err`} message={keyError} />
            </li>
            <li>
              <Button type="submit" aria-disabled={pending || undefined}>
                <ButtonLabel idle="Vérifier et activer" busy="Vérification de la clé…" isBusy={pending} />
              </Button>
            </li>
          </ol>
          <FormStatus state={state.status} className="mt-4" />
          <LiveRegion className="sr-only">{pending ? "Vérification de la clé auprès d'Anthropic…" : null}</LiveRegion>
        </form>
      ) : null}

      <p className="text-sm text-muted">Chiffrée, jamais réaffichée : seuls les 4 derniers caractères restent visibles.</p>
      <LiveRegion className="text-sm font-medium text-success">
        {announce ? (
          <>
            <span aria-hidden="true">✓ </span>
            {announce}
          </>
        ) : null}
      </LiveRegion>
    </div>
  );
}
