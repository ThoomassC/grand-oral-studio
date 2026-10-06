"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useId, useRef, useState, useTransition } from "react";
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
import { activateClaude, deleteAnthropicApiKey, testAnthropicApiKey } from "@/server/actions/settings";
import type { AiSetupStatus } from "./ai-status";
import { ChoiceInfo, type ChoiceInfoItem } from "./ChoiceInfo";

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";
const NETWORK_ERROR = "La connexion a été interrompue. Réessayez.";

/** La clé saisie n'est jamais conservée dans cet état : seulement les messages. */
interface ActivateState {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const INITIAL: ActivateState = { status: IDLE, fieldErrors: {} };

/** Les aides sur la clé, derrière le bouton « i » du champ (et du résumé de la clé). */
const KEY_INFO: readonly ChoiceInfoItem[] = [
  {
    term: "Format",
    detail: (
      <>
        Collez la clé entière : elle commence par « <span className="num whitespace-nowrap">sk-ant-</span> ».
      </>
    ),
  },
  {
    term: "Crédits",
    detail: "Ajoutez quelques euros de crédit dans la console Anthropic (rubrique Billing) : sans crédit, la clé est refusée.",
  },
  {
    term: "Sécurité",
    detail: "Votre clé est chiffrée et n'est jamais réaffichée : seuls ses 4 derniers caractères restent visibles.",
  },
];

/**
 * Question 2 de la Configuration IA : connecter Claude avec sa clé API.
 *
 * Sans clé personnelle : le lien vers la console, le champ (aides derrière
 * son bouton « i ») et « Vérifier et activer », qui vérifient la clé, l'enregistrent chiffrée ET choisissent
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
  const [testing, startTest] = useTransition();
  const [testStatus, setTestStatus] = useState<FormStatusState>(IDLE);

  /** Revérifie la clé enregistrée auprès d'Anthropic (quota de vérification côté serveur). */
  function testKey() {
    if (testing) return;
    setTestStatus(IDLE);
    startTest(async () => {
      try {
        const result = await testAnthropicApiKey();
        setTestStatus(
          result.ok
            ? { kind: "success", message: `Connexion à Claude réussie (modèle ${result.data.model}).` }
            : { kind: "error", message: result.error },
        );
      } catch {
        setTestStatus({ kind: "error", message: NETWORK_ERROR });
      }
    });
  }
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

  return (
    <div className="flex flex-col gap-5">
      {claude.userKey ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p>
              Clé <span className="num font-semibold">•••• {claude.userKey.last4}</span>
              {claude.userKey.addedAtLabel ? <> · ajoutée le {claude.userKey.addedAtLabel}</> : null}
            </p>
            {/* Champ révélé (« Remplacer ») : son propre « i » suffit. */}
            {showForm ? null : <ChoiceInfo label="Votre clé API" items={KEY_INFO} />}
          </div>
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
            <Button type="button" variant="ghost" size="small" onClick={testKey} aria-disabled={testing || undefined}>
              <ButtonLabel idle="Tester la connexion" busy="Test en cours…" isBusy={testing} />
            </Button>
            <ConfirmAction
              triggerLabel="Supprimer ma clé"
              title="Supprimer votre clé ?"
              triggerDisabled={pending}
              question="Votre clé est effacée de Grand Oral Studio. Elle reste valable dans votre console Anthropic. Le jour J, la rédaction se fera sans IA tant qu'aucune clé n'est connectée."
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
          <FormStatus state={testStatus} />
        </div>
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
          <div className="flex flex-col gap-4">
            <p>
              Créez une clé dans la{" "}
              <a href={CONSOLE_URL} className="opale-link font-semibold" target="_blank" rel="noopener noreferrer">
                console Anthropic, rubrique API Keys
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
              , puis collez-la ci-dessous.
            </p>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={ids.key} className="opale-field__label">
                  Clé API Anthropic
                </label>
                <ChoiceInfo label="Votre clé API" items={KEY_INFO} />
              </div>
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
              {/* Le format, lu avec le champ ; le détail (crédits, sécurité) est derrière le « i ». */}
              <p id={ids.hint} className="sr-only">
                Elle commence par « sk-ant- ».
              </p>
              <FieldError id={`${ids.key}-err`} message={keyError} />
            </div>
            <div>
              <Button type="submit" aria-disabled={pending || undefined}>
                <ButtonLabel idle="Vérifier et activer" busy="Vérification de la clé…" isBusy={pending} />
              </Button>
            </div>
          </div>
          <FormStatus state={state.status} className="mt-4" />
          <LiveRegion className="sr-only">{pending ? "Vérification de la clé auprès d'Anthropic…" : null}</LiveRegion>
        </form>
      ) : null}

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
