"use client";

import { Badge, Button, Radio, RadioGroup } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useRef, useState, useTransition } from "react";
import { firstError, type FieldErrors } from "@/components/forms/validation";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { SelectInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, focusLater } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { setAiEngine, testAnthropicApiKey } from "@/server/actions/settings";
import { isReady, writerLabel, type AiSetupStatus, type EngineId } from "./ai-status";
import { ClaudeConnect } from "./ClaudeConnect";

const NETWORK_ERROR = "La connexion a été interrompue. Réessayez.";

interface SaveState {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const INITIAL: SaveState = { status: IDLE, fieldErrors: {} };

/** Choix en vigueur : l'enregistré, sinon celui que le serveur applique par défaut. */
function savedEngine(status: AiSetupStatus): EngineId {
  if (status.selected) return status.selected;
  if (status.effective !== "mock") return status.effective;
  return status.claude.available ? "claude" : "free";
}

function choiceLabel(engine: EngineId, model: string | null): string {
  if (engine === "free") return "Sans IA";
  if (engine === "claude") return "Claude";
  return model ? `Ollama · ${model}` : "Ollama";
}

const SAVE_LABEL: Record<EngineId, string> = {
  free: "Choisir Sans IA",
  claude: "Choisir Claude",
  ollama: "Choisir ce modèle",
};

/**
 * Configuration IA guidée : un bandeau d'état (qui rédige le jour J, prêt ou
 * à connecter), la question 1 « Qui rédige le jour J ? » et, si Claude est
 * coché, la question 2 « Connecter Claude ». Un seul bouton d'enregistrement
 * visible à la fois, et aucun quand le choix coché est déjà enregistré.
 */
export function AiSetup({ status }: { status: AiSetupStatus }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();
  const ids = { q1: `${baseId}-q1`, q2: `${baseId}-q2`, model: `${baseId}-model` };
  /** Id du radio d'un moteur : cible du focus quand le bouton « Choisir … » disparaît. */
  const radioId = (engine: EngineId) => `${baseId}-engine-${engine}`;
  const { ollama } = status;
  const ollamaUsable = ollama !== null && ollama.reachable && ollama.models.length > 0;

  /** Choix enregistré : mis à jour au succès, avant le rafraîchissement de la page. */
  const [saved, setSaved] = useState<{ engine: EngineId; model: string | null }>(() => ({
    engine: savedEngine(status),
    model: ollama?.selectedModel ?? null,
  }));
  // Un modèle local enregistré mais plus proposé par le serveur : rien d'invisible ne reste coché.
  const [choice, setChoice] = useState<EngineId>(() => (saved.engine === "ollama" && ollama === null ? "free" : saved.engine));
  const [model, setModel] = useState<string | null>(() =>
    ollama?.selectedModel && ollama.models.includes(ollama.selectedModel) ? ollama.selectedModel : (ollama?.models[0] ?? null),
  );

  const choiceSaved = choice === saved.engine && (choice !== "ollama" || model === saved.model);
  const choiceUsable = choice === "free" || (choice === "claude" ? status.claude.available : ollamaUsable);
  useUnsavedChanges(!choiceSaved);

  const [state, submit, saving] = useActionState<SaveState, FormData>(async (_prev, formData) => {
    // Lu dans le formulaire envoyé, pas dans l'état : la valeur exacte au moment du clic.
    const raw = formData.get("engine");
    const engine: EngineId | null = raw === "claude" || raw === "ollama" || raw === "free" ? raw : null;
    if (!engine) return { status: { kind: "error", message: "Choisissez qui rédige le jour J." }, fieldErrors: {} };
    const ollamaModel = String(formData.get("ollamaModel") ?? "");
    const input = engine === "ollama" ? { engine, ollamaModel } : { engine };
    let result: Awaited<ReturnType<typeof setAiEngine>>;
    try {
      result = await setAiEngine(input);
    } catch {
      return { status: { kind: "error", message: NETWORK_ERROR }, fieldErrors: {} };
    }
    if (!result.ok) {
      const fieldErrors = result.fieldErrors ?? {};
      if (firstError(fieldErrors, "ollamaModel")) focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: result.error }, fieldErrors };
    }
    setSaved((prev) => ({ engine, model: engine === "ollama" ? ollamaModel : prev.model }));
    // Le bouton « Choisir … », qui a le focus, disparaît : le focus passe au radio du choix
    // enregistré (coché, juste au-dessus), pas sur la page. La confirmation reste annoncée.
    focusLater([radioId(engine)]);
    router.refresh();
    return { status: { kind: "success", message: `Choix enregistré : ${choiceLabel(engine, ollamaModel)}.` }, fieldErrors: {} };
  }, INITIAL);

  const [testing, startTest] = useTransition();
  const [testStatus, setTestStatus] = useState<FormStatusState>(IDLE);
  const canTest = status.effective === "claude" && (status.claude.source === "user" || status.claude.source === "server");

  function test() {
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

  const ready = isReady(status);
  const engineError = firstError(state.fieldErrors, "engine");
  const modelError = firstError(state.fieldErrors, "ollamaModel");
  const ollamaNote =
    ollama === null || ollamaUsable
      ? null
      : !ollama.reachable
        ? "Le modèle local ne répond pas pour le moment."
        : "Aucun modèle n'est installé sur ce serveur.";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1">
            Le jour J, vos diaporamas sont rédigés par <strong>{writerLabel(status)}</strong>.
          </p>
          <Badge tone={ready ? "success" : "warning"}>{ready ? "Prêt" : "À connecter"}</Badge>
          {canTest ? (
            <Button type="button" variant="ghost" size="small" onClick={test} aria-disabled={testing || undefined}>
              <ButtonLabel idle="Tester" busy="Test en cours…" isBusy={testing} />
            </Button>
          ) : null}
        </div>
        <FormStatus state={testStatus} />
      </div>

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
            onValueChange={(value) => {
              if (value === "claude" || value === "ollama" || value === "free") setChoice(value);
            }}
            error={engineError}
          >
            <Radio
              id={radioId("free")}
              value="free"
              label="Sans IA"
              description="La trame remplie avec vos notes : le texte reste à écrire. Gratuit et instantané."
            />
            <Radio
              id={radioId("claude")}
              value="claude"
              label="Claude"
              description="Rédaction complète et notes d'orateur. Quelques centimes par diaporama."
            />
            {ollama !== null ? (
              <Radio
                id={radioId("ollama")}
                value="ollama"
                label="Modèle local (Ollama)"
                disabled={!ollamaUsable}
                description={
                  <>
                    Gratuit et privé, exécuté sur ce serveur. Plus lent, qualité variable selon le modèle.
                    {ollamaNote ? <span className="mt-1 block font-semibold text-text">{ollamaNote}</span> : null}
                  </>
                }
              />
            ) : null}
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
                <ButtonLabel idle={SAVE_LABEL[choice]} busy="Enregistrement…" isBusy={saving} />
              </Button>
            </div>
          ) : null}
        </form>
      </section>

      {choice === "claude" ? (
        <section aria-labelledby={ids.q2} className="opale-card opale-card--e1 block p-5 sm:p-6">
          <h2 id={ids.q2} className="text-2xl">
            2. Connecter Claude
          </h2>
          <div className="mt-5">
            <ClaudeConnect claude={status.claude} onActivated={() => setSaved((s) => ({ ...s, engine: "claude" }))} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
