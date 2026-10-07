"use client";

import { Button, Radio, RadioGroup } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { firstError, type FieldErrors } from "@/components/forms/validation";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { SelectInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, focusLater } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { isCloudProvider, PROVIDER_INFO, type CloudProvider } from "@/domain/ai-providers";
import { selectWriter } from "@/server/actions/settings";
import { failureMessage } from "./action-error";
import { parseChoice, teamChoice, teamProvider, type AiSetupStatus, type WriterChoice } from "./ai-status";
import type { ChoiceInfoItem } from "./ChoiceInfo";
import { ConnectionList } from "./ConnectionList";
import { ProviderConnect } from "./ProviderConnect";

const NETWORK_ERROR = "La connexion a été interrompue. Réessayez.";

/** Fournisseurs à clé personnelle, dans l'ordre des cartes. */
const OWN_KEY_CARDS: readonly CloudProvider[] = ["mistral", "gemini", "claude", "openai"];

interface SaveState {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const INITIAL: SaveState = { status: IDLE, fieldErrors: {} };

/** Nom d'une carte (et de son radio) : court, le détail est dans la carte. */
function cardLabel(choice: WriterChoice): string {
  if (choice === "free") return "Sans IA";
  if (choice === "ollama") return "Modèle local (Ollama)";
  if (isCloudProvider(choice)) return PROVIDER_INFO[choice].label;
  const team = teamProvider(choice);
  return team ? `${PROVIDER_INFO[team].label}, clé de l'équipe` : choice;
}

function choiceLabel(choice: WriterChoice, model: string | null): string {
  if (choice === "ollama") return model ? `Ollama · ${model}` : "Ollama";
  return cardLabel(choice);
}

function saveLabel(choice: WriterChoice): string {
  return choice === "ollama" ? "Choisir ce modèle" : `Choisir ${cardLabel(choice)}`;
}

/** Ce que l'action attend pour un choix de la question 1. */
function writerInput(choice: WriterChoice, ollamaModel: string): Parameters<typeof selectWriter>[0] {
  if (choice === "free") return { engine: "free" };
  if (choice === "ollama") return { engine: "ollama", ollamaModel };
  if (isCloudProvider(choice)) return { engine: choice, keySource: "user" };
  const team = teamProvider(choice);
  return team ? { engine: team, keySource: "server" } : { engine: "free" };
}

const DRAFTED: ChoiceInfoItem = {
  term: "Ce que vous obtenez",
  detail: "Un diaporama rédigé diapo par diapo, avec des notes d'orateur, à relire avant l'oral.",
};

/** Société qui reçoit le texte envoyé pour la rédaction. */
const RECIPIENT: Readonly<Record<CloudProvider, string>> = {
  claude: "Anthropic",
  mistral: "Mistral AI",
  gemini: "Google",
  openai: "OpenAI",
};

/** Coût avec sa propre clé. */
const OWN_KEY_COST: Readonly<Record<CloudProvider, string>> = {
  claude:
    "Quelques centimes par diaporama, facturés à l'usage sur votre compte Anthropic (crédits prépayés, rubrique Billing de la console). Un abonnement Claude.ai (Pro, Max) ne donne pas de crédits API.",
  mistral: "Gratuit avec le palier « Experiment » de Mistral, au débit limité ; au-delà, facturé à l'usage sur votre compte Mistral.",
  gemini: "Gratuit avec le palier gratuit de Google AI Studio, au débit limité ; au-delà, facturé à l'usage sur votre compte Google.",
  openai:
    "Quelques centimes par diaporama, facturés à l'usage sur votre compte OpenAI (crédits prépayés, rubrique Billing de la console). Un abonnement ChatGPT (Plus, Pro) ne donne pas de crédits API.",
};

/** Hébergement et entraînement, tirés de la fiche du fournisseur (src/domain/ai-providers.ts). */
function dataDetail(provider: CloudProvider, ownKey: boolean): string {
  const { hosting, training } = PROVIDER_INFO[provider].data;
  const key = ownKey ? " Votre clé est chiffrée et n'est jamais réaffichée." : "";
  return `La problématique, la trame et les notes du sujet sont envoyées à ${RECIPIENT[provider]} pour la rédaction. ${hosting} ${training}${key}`;
}

/** Résumé d'une carte à clé personnelle, sous le nom du radio. */
function ownKeySummary(provider: CloudProvider): string {
  const { free, data } = PROVIDER_INFO[provider];
  return `${free ? "Palier gratuit" : "Quelques centimes par diaporama"}${data.euHosted ? ", hébergé dans l'UE" : ""}.`;
}

const FREE_INFO: readonly ChoiceInfoItem[] = [
  {
    term: "Ce que vous obtenez",
    detail:
      "Un diaporama construit à partir de votre trame et des notes du sujet. Le texte des diapos et les notes d'orateur restent à écrire.",
  },
  { term: "Coût", detail: "Gratuit et instantané." },
  { term: "Vos données", detail: "Rien n'est envoyé à un service externe." },
];

const OLLAMA_INFO: readonly ChoiceInfoItem[] = [
  {
    term: "Ce que vous obtenez",
    detail: "Un diaporama rédigé par un modèle installé sur le serveur. Qualité variable : vérifiez les chiffres.",
  },
  { term: "Coût", detail: "Gratuit. Plus lent : comptez plusieurs minutes par diaporama." },
  { term: "Vos données", detail: "Tout reste sur le serveur : rien n'est envoyé à un service externe." },
];

/** Le détail de chaque choix, écrit dans sa carte : résultat, coût, devenir des données. */
function engineInfo(choice: WriterChoice): readonly ChoiceInfoItem[] {
  if (choice === "free") return FREE_INFO;
  if (choice === "ollama") return OLLAMA_INFO;
  if (isCloudProvider(choice)) {
    return [DRAFTED, { term: "Coût", detail: OWN_KEY_COST[choice] }, { term: "Vos données", detail: dataDetail(choice, true) }];
  }
  const team = teamProvider(choice);
  if (team) {
    return [
      DRAFTED,
      {
        term: "Coût",
        detail:
          "Rien à payer de votre côté : l'usage est facturé à l'équipe qui administre Grand Oral Studio, dans la limite d'un quota de générations.",
      },
      { term: "Vos données", detail: dataDetail(team, false) },
    ];
  }
  return FREE_INFO;
}

/**
 * Un choix de la question 1 en carte : le radio (nom court + coût), puis le détail
 * (résultat, coût, données) écrit dans la carte. Un clic n'importe où dans la carte
 * coche le choix (le clavier passe par le radio). Sous 640 px, le détail se replie
 * derrière « Afficher le détail » (globals.css `.engine-card`).
 */
function EngineCard({
  engine,
  label,
  checked,
  disabled = false,
  info,
  onPick,
  children,
}: {
  engine: WriterChoice;
  label: string;
  checked: boolean;
  disabled?: boolean;
  info: readonly ChoiceInfoItem[];
  onPick: (engine: WriterChoice) => void;
  children: ReactNode;
}) {
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  return (
    // Le clic sur la carte est un raccourci de souris : le radio reste la commande (clavier, lecteur d'écran).
    <div
      data-engine-card=""
      data-checked={checked}
      data-disabled={disabled || undefined}
      className="engine-card"
      onClick={(e) => {
        if (disabled || (e.target as HTMLElement).closest("button, input, label, a, select")) return;
        onPick(engine);
      }}
    >
      {children}
      <button
        type="button"
        className="engine-card__toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        // Nom = texte visible + le choix concerné (le texte visible reste au début du nom).
        aria-label={`${open ? "Masquer le détail" : "Afficher le détail"} : ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Masquer le détail" : "Afficher le détail"}
      </button>
      <dl id={detailsId} data-open={open} className="engine-card__details">
        {info.map((item) => (
          <div key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Vrai si l'utilisateur a demandé moins d'animations (système ou panneau Réglages). */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return (
    document.documentElement.getAttribute("data-motion") === "reduced" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Rédaction IA guidée : la question 1 « Qui rédige le jour J ? » (Sans IA, clés
 * de l'équipe, fournisseurs à clé personnelle, modèle local) ; si un
 * fournisseur à clé personnelle est coché, la question 2 « Connecter … » ; puis
 * « Mes connexions ». Un seul bouton d'enregistrement visible à la fois, et
 * aucun quand le choix coché est déjà enregistré.
 */
export function AiSetup({ status }: { status: AiSetupStatus }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();
  const ids = { q1: `${baseId}-q1`, q2: `${baseId}-q2`, q3: `${baseId}-q3`, model: `${baseId}-model` };
  /** Id du radio d'un choix : cible du focus quand le bouton « Choisir … » disparaît. */
  const radioId = (choice: WriterChoice) => `${baseId}-engine-${choice}`;
  const { ollama, team, connections } = status;
  const ollamaUsable = ollama !== null && ollama.reachable && ollama.models.length > 0;
  const connectionOf = (provider: CloudProvider) => connections.find((c) => c.provider === provider) ?? null;

  /** Cartes proposées : Sans IA, les clés d'équipe, les fournisseurs, le modèle local s'il est configuré. */
  const cards: WriterChoice[] = ["free", ...team.map(teamChoice), ...OWN_KEY_CARDS, ...(ollama !== null ? (["ollama"] as const) : [])];

  /** Choix enregistré : mis à jour au succès, avant le rafraîchissement de la page. */
  const [saved, setSaved] = useState<{ choice: WriterChoice; model: string | null }>(() => ({
    choice: status.saved,
    model: ollama?.selectedModel ?? null,
  }));
  // Un choix enregistré dont la carte n'est plus proposée (clé d'équipe retirée, Ollama arrêté) : rien d'invisible ne reste coché.
  const [choice, setChoice] = useState<WriterChoice>(() => (cards.includes(saved.choice) ? saved.choice : "free"));
  const [model, setModel] = useState<string | null>(() =>
    ollama?.selectedModel && ollama.models.includes(ollama.selectedModel) ? ollama.selectedModel : (ollama?.models[0] ?? null),
  );
  /** « Remplacer » de Mes connexions : rouvre la question 2 de ce fournisseur, champ révélé (nonce : nouvelle demande). */
  const [replaceRequest, setReplaceRequest] = useState<{ provider: CloudProvider; nonce: number } | null>(null);

  /**
   * La question 2 apparaît en douceur (déroulé + fondu, globals.css `.step-reveal`) quand
   * l'utilisateur coche un fournisseur ; pas d'animation si elle est déjà là au chargement.
   */
  const [reveal, setReveal] = useState<"idle" | "enter">("idle");
  const q2Ref = useRef<HTMLElement>(null);

  // Synchronisation avec la fenêtre : si la question 2 vient d'apparaître hors de la vue
  // (téléphone), on la fait monter juste assez pour voir son titre.
  useEffect(() => {
    if (reveal !== "enter") return;
    const section = q2Ref.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top;
    if (top < window.innerHeight * 0.8) return;
    window.scrollBy({ top: top - window.innerHeight * 0.4, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [reveal]);

  /** Fournisseur à clé personnelle coché (question 2), null sinon. */
  const connecting: CloudProvider | null = isCloudProvider(choice) ? choice : null;
  const choiceSaved = choice === saved.choice && (choice !== "ollama" || model === saved.model);
  const choiceUsable =
    choice === "free" ||
    teamProvider(choice) !== null ||
    (choice === "ollama" ? ollamaUsable : connecting !== null && connectionOf(connecting) !== null);
  useUnsavedChanges(!choiceSaved);

  const [state, submit, saving] = useActionState<SaveState, FormData>(async (_prev, formData) => {
    // Lu dans le formulaire envoyé, pas dans l'état : la valeur exacte au moment du clic.
    const picked = parseChoice(formData.get("engine"));
    if (!picked) return { status: { kind: "error", message: "Choisissez qui rédige le jour J." }, fieldErrors: {} };
    const ollamaModel = String(formData.get("ollamaModel") ?? "");
    let result: Awaited<ReturnType<typeof selectWriter>>;
    try {
      result = await selectWriter(writerInput(picked, ollamaModel));
    } catch {
      return { status: { kind: "error", message: NETWORK_ERROR }, fieldErrors: {} };
    }
    if (!result.ok) {
      const fieldErrors = result.fieldErrors ?? {};
      if (firstError(fieldErrors, "ollamaModel")) focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: failureMessage(result) }, fieldErrors };
    }
    setSaved((prev) => ({ choice: picked, model: picked === "ollama" ? ollamaModel : prev.model }));
    // Le bouton « Choisir … », qui a le focus, disparaît : le focus passe au radio du choix
    // enregistré (coché, juste au-dessus), pas sur la page. La confirmation reste annoncée.
    focusLater([radioId(picked)]);
    router.refresh();
    return { status: { kind: "success", message: `Choix enregistré : ${choiceLabel(picked, ollamaModel)}.` }, fieldErrors: {} };
  }, INITIAL);

  /** Coche un choix (radio ou clic sur sa carte) ; la question 2 apparaît en douceur pour un fournisseur. */
  function pick(value: WriterChoice) {
    if (isCloudProvider(value) && value !== choice) setReveal("enter");
    if (!isCloudProvider(value)) setReveal("idle");
    if (replaceRequest && replaceRequest.provider !== value) setReplaceRequest(null);
    setChoice(value);
  }

  /** « Remplacer » de Mes connexions : coche le fournisseur et ouvre sa question 2, champ révélé. */
  function replaceKey(provider: CloudProvider) {
    pick(provider);
    setReplaceRequest((prev) => ({ provider, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  const engineError = firstError(state.fieldErrors, "engine") ?? firstError(state.fieldErrors, "keySource");
  const modelError = firstError(state.fieldErrors, "ollamaModel");
  const ollamaNote =
    ollama === null || ollamaUsable
      ? null
      : !ollama.reachable
        ? "Le modèle local ne répond pas pour le moment."
        : "Aucun modèle n'est installé sur ce serveur.";

  function cardDescription(card: WriterChoice): ReactNode {
    if (card === "free") return "Gratuit et instantané.";
    if (card === "ollama") {
      return (
        <>
          Gratuit, sur ce serveur.
          {ollamaNote ? <span className="mt-1 block font-semibold text-text">{ollamaNote}</span> : null}
        </>
      );
    }
    if (isCloudProvider(card)) return ownKeySummary(card);
    return "Clé fournie par votre équipe.";
  }

  const activeOwnKey = isCloudProvider(saved.choice) ? saved.choice : null;
  const replacing = connecting !== null && replaceRequest?.provider === connecting ? replaceRequest : null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={ids.q1} className="opale-card opale-card--e1 block p-5 sm:p-6">
        <h2 id={ids.q1} className="text-2xl">
          1. Qui rédige le jour J ?
        </h2>
        <form
          ref={formRef}
          noValidate
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (saving || choiceSaved || !choiceUsable) return;
            startTransition(() => submit(new FormData(e.currentTarget)));
          }}
        >
          <RadioGroup
            aria-labelledby={ids.q1}
            name="engine"
            value={choice}
            className="engine-cards"
            onValueChange={(value) => {
              const picked = parseChoice(value);
              if (picked && cards.includes(picked)) pick(picked);
            }}
            error={engineError}
          >
            {cards.map((card) => {
              const label = cardLabel(card);
              const disabled = card === "ollama" && !ollamaUsable;
              return (
                <EngineCard
                  key={card}
                  engine={card}
                  label={label}
                  checked={choice === card}
                  disabled={disabled}
                  info={engineInfo(card)}
                  onPick={pick}
                >
                  <Radio id={radioId(card)} value={card} label={label} disabled={disabled} description={cardDescription(card)} />
                </EngineCard>
              );
            })}
          </RadioGroup>

          {choice === "ollama" && ollamaUsable ? (
            <div>
              <label htmlFor={ids.model} className="opale-field__label">
                Modèle
              </label>
              <SelectInput
                id={ids.model}
                name="ollamaModel"
                value={model ?? ""}
                onChange={(e) => setModel(e.target.value)}
                aria-invalid={Boolean(modelError)}
                aria-describedby={modelError ? `${ids.model}-err` : undefined}
              >
                {ollama.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </SelectInput>
              <FieldError id={`${ids.model}-err`} message={modelError} />
            </div>
          ) : null}

          <FormStatus state={state.status} />
          {!choiceSaved && choiceUsable ? (
            <div>
              <Button type="submit" aria-disabled={saving || undefined}>
                <ButtonLabel idle={saveLabel(choice)} busy="Enregistrement…" isBusy={saving} />
              </Button>
            </div>
          ) : null}
        </form>
      </section>

      <LiveRegion className="sr-only">
        {reveal === "enter" && connecting ? `Étape 2 affichée plus bas : connectez ${PROVIDER_INFO[connecting].label}.` : null}
      </LiveRegion>
      {connecting ? (
        <div
          className="step-reveal"
          data-reveal={reveal === "enter" ? "enter" : undefined}
          onAnimationEnd={(e) => {
            // Fin du déroulé (l'animation du conteneur, pas celles des enfants) : plus de découpe.
            if (e.target === e.currentTarget) setReveal("idle");
          }}
        >
          <section ref={q2Ref} aria-labelledby={ids.q2} className="opale-card opale-card--e1 block p-5 sm:p-6">
            <h2 id={ids.q2} className="text-2xl">
              2. Connecter {PROVIDER_INFO[connecting].label}
            </h2>
            <div className="mt-5">
              <ProviderConnect
                // Un fournisseur, un formulaire : changer de carte (ou redemander « Remplacer ») repart à neuf.
                key={`${connecting}-${replacing?.nonce ?? 0}`}
                provider={connecting}
                connection={connectionOf(connecting)}
                startReplacing={replacing !== null}
                onActivated={() => setSaved((s) => ({ ...s, choice: connecting }))}
              />
            </div>
          </section>
        </div>
      ) : null}

      <section aria-labelledby={ids.q3} className="opale-card opale-card--e1 block p-5 sm:p-6">
        <h2 id={ids.q3} tabIndex={-1} className="text-2xl">
          Mes connexions
        </h2>
        <ConnectionList
          connections={connections}
          active={activeOwnKey}
          headingId={ids.q3}
          onUsed={(provider) => {
            setSaved((s) => ({ ...s, choice: provider }));
            pick(provider);
          }}
          onReplace={replaceKey}
        />
      </section>
    </div>
  );
}
