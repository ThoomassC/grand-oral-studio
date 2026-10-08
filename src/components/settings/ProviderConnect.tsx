"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { SelectInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, focusLater } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { PROVIDER_INFO, type SelectableProvider } from "@/domain/ai-providers";
import { connectProvider, deleteConnection, setConnectionModel, testConnection } from "@/server/actions/settings";
import { failureMessage } from "./action-error";
import type { ConnectionStatus } from "./ai-status";
import { ChoiceInfo, type ChoiceInfoItem } from "./ChoiceInfo";
import { PROVIDER_KEY_MAX_LENGTH, providerKeySchema } from "./provider-key";

const NETWORK_ERROR = "La connexion a été interrompue. Réessayez.";

/** La clé saisie n'est jamais conservée dans cet état : seulement les messages. */
interface ActivateState {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const INITIAL: ActivateState = { status: IDLE, fieldErrors: {} };

/** Où créer une clé, et ce qu'il faut savoir avant de la coller : propre à chaque fournisseur. */
interface ProviderCopy {
  /** Texte du lien vers la page de création de clé. */
  consoleLink: string;
  /** Où la clé reste valable après sa suppression ici. */
  consolePlace: string;
  /** Format, lu avec le champ (description du lecteur d'écran). */
  formatHint: string;
  placeholder?: string;
  /** Aides sur la clé, derrière le bouton « i » du champ (et du résumé de la clé). */
  keyInfo: readonly ChoiceInfoItem[];
}

const SECURITY_INFO: ChoiceInfoItem = {
  term: "Sécurité",
  detail: "Votre clé est chiffrée et n'est jamais réaffichée : seuls ses 4 derniers caractères restent visibles.",
};

function prefixDetail(prefix: string) {
  return (
    <>
      Collez la clé entière : elle commence par « <span className="num whitespace-nowrap">{prefix}</span> ».
    </>
  );
}

/** Fournisseurs proposés seulement : Claude et OpenAI ne se connectent plus depuis la 1.2. */
const COPY: Readonly<Record<SelectableProvider, ProviderCopy>> = {
  mistral: {
    consoleLink: "console Mistral, rubrique API Keys",
    consolePlace: "votre console Mistral",
    formatHint: "Des lettres et des chiffres, sans espace.",
    keyInfo: [
      { term: "Format", detail: "Collez la clé entière : des lettres et des chiffres, sans espace." },
      { term: "Palier gratuit", detail: "Le palier gratuit « Experiment » suffit pour essayer, avec un débit limité." },
      SECURITY_INFO,
    ],
  },
  gemini: {
    consoleLink: "Google AI Studio, rubrique API Keys",
    consolePlace: "Google AI Studio",
    formatHint: "Elle commence par « AIza ».",
    placeholder: "AIza…",
    keyInfo: [
      { term: "Format", detail: prefixDetail("AIza") },
      { term: "Palier gratuit", detail: "Une clé créée dans Google AI Studio donne accès au palier gratuit, avec un débit limité." },
      SECURITY_INFO,
    ],
  },
};

/** « d'Anthropic », « de Mistral ». */
function fromName(name: string): string {
  return /^[AEIOUYaeiouy]/.test(name) ? `d'${name}` : `de ${name}`;
}

/**
 * Question 2 de la page Rédaction IA : connecter un fournisseur avec sa clé API.
 *
 * Sans clé personnelle : le lien vers la page de création de clé, le champ
 * (aides derrière son bouton « i »), le modèle (liste fermée, s'il y en a
 * plusieurs) et « Vérifier et activer », qui vérifient la clé, l'enregistrent
 * chiffrée ET choisissent ce rédacteur en un seul geste côté serveur. Avec une
 * clé : son résumé (4 derniers caractères), son modèle, « Remplacer » (révèle
 * le champ), « Tester la connexion » et « Supprimer ma clé ».
 *
 * La forme de la clé est contrôlée ici (aucun appel serveur pour une clé
 * vide ou trop longue) ; le serveur revérifie la forme exacte, puis la
 * validité réelle auprès du fournisseur. Fournisseurs proposés seulement
 * (Mistral, Gemini) : une connexion héritée Claude/OpenAI ne s'ouvre pas ici.
 */
export function ProviderConnect({
  provider,
  connection,
  onActivated,
  startReplacing = false,
}: {
  provider: SelectableProvider;
  connection: ConnectionStatus | null;
  onActivated: () => void;
  /** Ouvre directement le remplacement de la clé (« Remplacer » de Mes connexions). */
  startReplacing?: boolean;
}) {
  const router = useRouter();
  const info = PROVIDER_INFO[provider];
  const copy = COPY[provider];
  const pickModel = info.models.length > 1;
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
  const ids = {
    form: `${baseId}-form`,
    key: `${baseId}-key`,
    hint: `${baseId}-hint`,
    replace: `${baseId}-replace`,
    model: `${baseId}-model`,
    savedModel: `${baseId}-saved-model`,
  };
  const [replacing, setReplacing] = useState(() => startReplacing && connection !== null);
  const [keyTyped, setKeyTyped] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [testing, startTest] = useTransition();
  const [savingModel, startModel] = useTransition();
  const [summaryStatus, setSummaryStatus] = useState<FormStatusState>(IDLE);

  // Modèle de la clé enregistrée : suit la page après chaque rafraîchissement.
  const [model, setModel] = useState(connection?.model ?? info.defaultModel);
  const [modelSource, setModelSource] = useState(connection?.model);
  if (connection?.model !== modelSource) {
    setModelSource(connection?.model);
    setModel(connection?.model ?? info.defaultModel);
  }

  // « Remplacer » demandé depuis Mes connexions : le champ révélé prend le focus.
  useEffect(() => {
    if (startReplacing) focusLater([ids.key]);
  }, [startReplacing, ids.key]);

  /** Revérifie la clé enregistrée auprès du fournisseur (quota de vérification côté serveur). */
  function testKey() {
    if (testing) return;
    setSummaryStatus(IDLE);
    startTest(async () => {
      try {
        const result = await testConnection({ provider });
        if (!result.ok) {
          setSummaryStatus({ kind: "error", message: failureMessage(result) });
          return;
        }
        setSummaryStatus({ kind: "success", message: `Connexion à ${info.label} réussie (modèle ${result.data.model}).` });
        router.refresh();
      } catch {
        setSummaryStatus({ kind: "error", message: NETWORK_ERROR });
      }
    });
  }

  /** Change le modèle de la clé enregistrée ; revient au précédent en cas d'échec. */
  function changeModel(next: string) {
    if (savingModel || next === model) return;
    const previous = model;
    setModel(next);
    setSummaryStatus(IDLE);
    startModel(async () => {
      try {
        const result = await setConnectionModel({ provider, model: next });
        if (!result.ok) {
          setModel(previous);
          setSummaryStatus({ kind: "error", message: failureMessage(result) });
          return;
        }
        const label = info.models.find((m) => m.id === next)?.label ?? next;
        setSummaryStatus({ kind: "success", message: `Modèle enregistré : ${label}.` });
        router.refresh();
      } catch {
        setModel(previous);
        setSummaryStatus({ kind: "error", message: NETWORK_ERROR });
      }
    });
  }

  // Une clé saisie mais pas activée serait perdue en quittant la page.
  useUnsavedChanges(keyTyped);

  const [state, submit, pending] = useActionState<ActivateState, FormData>(async (_prev, formData) => {
    try {
      const checked = validateWith(providerKeySchema(provider), { apiKey: String(formData.get("apiKey") ?? "") });
      if (!checked.ok) {
        focusFirstInvalid(formRef.current);
        return { status: { kind: "error", message: "La clé saisie n'a pas le bon format." }, fieldErrors: checked.fieldErrors };
      }
      // Un seul modèle proposé : le défaut du serveur ; sinon celui de la liste (la clé remplacée garde le sien).
      const chosenModel = pickModel ? String(formData.get("model") ?? "") || null : null;
      let result: Awaited<ReturnType<typeof connectProvider>>;
      try {
        result = await connectProvider({ provider, apiKey: checked.data.apiKey, model: chosenModel, activate: true });
      } catch {
        return { status: { kind: "error", message: NETWORK_ERROR }, fieldErrors: {} };
      }
      if (!result.ok) {
        const fieldErrors = result.fieldErrors ?? {};
        if (firstError(fieldErrors, "apiKey") || firstError(fieldErrors, "model")) focusFirstInvalid(formRef.current);
        return { status: { kind: "error", message: failureMessage(result) }, fieldErrors };
      }
      // Succès : le champ est vidé, la clé ne reste nulle part côté client.
      formRef.current?.reset();
      setReplacing(false);
      setAnnounce(`${info.label} est activé : clé •••• ${result.data.last4} vérifiée et enregistrée.`);
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

  const showForm = connection === null || replacing;

  /** Ref de « Remplacer » : prend le focus à son apparition après une activation, s'il est perdu. */
  const replaceRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node || !focusReplaceOnMountRef.current) return;
    focusReplaceOnMountRef.current = false;
    const active = node.ownerDocument.activeElement;
    // Ne pas voler le focus si l'utilisateur est allé ailleurs entre-temps.
    if (active === null || active === node.ownerDocument.body) node.focus();
  }, []);
  const keyError = firstError(state.fieldErrors, "apiKey");
  const modelError = firstError(state.fieldErrors, "model");

  return (
    <div className="flex flex-col gap-5">
      {provider === "mistral" ? (
        <Notice tone="warning" title="Palier gratuit">
          Désactivez l&apos;entraînement sur vos données dans Admin Console › Privacy.
        </Notice>
      ) : null}

      {connection ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p>
              Clé <span className="num font-semibold">•••• {connection.last4}</span>
              {connection.addedAtLabel ? <> · ajoutée le {connection.addedAtLabel}</> : null}
            </p>
            {/* Champ révélé (« Remplacer ») : son propre « i » suffit. */}
            {showForm ? null : <ChoiceInfo label="Votre clé API" items={copy.keyInfo} />}
          </div>
          {pickModel && !showForm ? (
            <div>
              <label htmlFor={ids.savedModel} className="opale-field__label">
                Modèle
              </label>
              <SelectInput
                id={ids.savedModel}
                value={model}
                aria-busy={savingModel || undefined}
                onChange={(e) => changeModel(e.target.value)}
              >
                {info.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </SelectInput>
            </div>
          ) : null}
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
              question={`Votre clé est effacée de Grand Oral Studio. Elle reste valable dans ${copy.consolePlace}. Si ${info.label} rédige le jour J, choisissez ensuite un autre rédacteur.`}
              confirmLabel="Supprimer la clé"
              onConfirm={async () => {
                const result = await deleteConnection({ provider });
                if (!result.ok) return failureMessage(result);
                setReplacing(false);
                setAnnounce("Votre clé a été supprimée.");
                router.refresh();
                return null;
              }}
              onDone={() => focusLater([ids.key])}
            />
          </div>
          <FormStatus state={summaryStatus} />
        </div>
      ) : null}

      {showForm ? (
        <form
          id={ids.form}
          ref={formRef}
          noValidate
          aria-label={`Connecter ${info.label} avec votre clé API`}
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
              <a href={info.consoleUrl} className="opale-link font-semibold" target="_blank" rel="noopener noreferrer">
                {copy.consoleLink}
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
              , puis collez-la ci-dessous.
            </p>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={ids.key} className="opale-field__label">
                  Clé API {info.apiName}
                </label>
                <ChoiceInfo label="Votre clé API" items={copy.keyInfo} />
              </div>
              <PasswordInput
                id={ids.key}
                name="apiKey"
                autoComplete="off"
                data-1p-ignore=""
                data-lpignore="true"
                spellCheck={false}
                placeholder={copy.placeholder}
                maxLength={PROVIDER_KEY_MAX_LENGTH}
                onChange={(e) => setKeyTyped(e.target.value !== "")}
                {...errorProps(state.fieldErrors, "apiKey", `${ids.key}-err`, ids.hint)}
              />
              {/* Le format, lu avec le champ ; le détail (crédits, sécurité) est derrière le « i ». */}
              <p id={ids.hint} className="sr-only">
                {copy.formatHint}
              </p>
              <FieldError id={`${ids.key}-err`} message={keyError} />
            </div>
            {pickModel ? (
              <div>
                <label htmlFor={ids.model} className="opale-field__label">
                  Modèle
                </label>
                <SelectInput
                  id={ids.model}
                  name="model"
                  defaultValue={connection?.model ?? info.defaultModel}
                  {...errorProps(state.fieldErrors, "model", `${ids.model}-err`)}
                >
                  {info.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </SelectInput>
                <FieldError id={`${ids.model}-err`} message={modelError} />
              </div>
            ) : null}
            <div>
              <Button type="submit" aria-disabled={pending || undefined}>
                <ButtonLabel idle="Vérifier et activer" busy="Vérification de la clé…" isBusy={pending} />
              </Button>
            </div>
          </div>
          <FormStatus state={state.status} className="mt-4" />
          <LiveRegion className="sr-only">{pending ? `Vérification de la clé auprès ${fromName(info.apiName)}…` : null}</LiveRegion>
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
