"use client";

import { SelectInput } from "@/components/ui/Field";
import { Button, Radio, RadioGroup } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useRef, useState, type ReactNode } from "react";
import { setAiEngine } from "@/server/actions/settings";
import { firstError, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";

type Engine = "claude" | "ollama" | "free";

/** Moteurs disponibles et choix enregistré, tels que lus par le serveur (DTO). */
export interface EngineStatus {
  selected: Engine | null;
  effective: Engine | "mock";
  available: {
    claude: boolean;
    ollama: { configured: boolean; reachable: boolean; models: string[]; selectedModel: string | null };
    free: true;
  };
}

interface SaveState {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const INITIAL: SaveState = { status: IDLE, fieldErrors: {} };

/** Libellé du moteur effectif (« Moteur utilisé : … »). */
export function engineLabel(engine: Engine | "mock", ollamaModel?: string | null): string {
  switch (engine) {
    case "claude":
      return "Claude (Anthropic)";
    case "ollama":
      return ollamaModel ? `Modèle local (Ollama · ${ollamaModel})` : "Modèle local (Ollama)";
    case "free":
      return "Gratuit (sans IA)";
    case "mock":
      return "Démo (contenus factices)";
  }
}

function initialChoice(status: EngineStatus): Engine {
  if (status.selected) return status.selected;
  if (status.effective !== "mock") return status.effective;
  return status.available.claude ? "claude" : "free";
}

/**
 * Choix du moteur de rédaction : trois cartes radio. Un moteur indisponible
 * reste visible, désactivé, avec la raison et la marche à suivre (reliées au
 * bouton radio par aria-describedby).
 */
export function EngineSettings({ status }: { status: EngineStatus }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();
  const [choice, setChoice] = useState<Engine>(() => initialChoice(status));
  /** Le moteur enregistré : mis à jour avec le message de succès, avant le rafraîchissement de la page. */
  const [savedChoice, setSavedChoice] = useState<Engine>(() => initialChoice(status));
  useUnsavedChanges(choice !== savedChoice);
  const { ollama } = status.available;
  const ollamaUsable = ollama.configured && ollama.reachable && ollama.models.length > 0;
  const ollamaNote = !ollama.configured ? (
    <>Indisponible : Ollama n&apos;est pas configuré sur ce serveur (voir README).</>
  ) : !ollama.reachable ? (
    <>
      Indisponible : Ollama ne répond pas. Lancez <code className="num rounded-sm bg-surface-2 px-1">ollama serve</code>.
    </>
  ) : ollama.models.length === 0 ? (
    <>
      Indisponible : aucun modèle installé. Lancez <code className="num rounded-sm bg-surface-2 px-1">ollama pull mistral</code>.
    </>
  ) : null;

  const [state, submit, saving] = useActionState<SaveState, FormData>(async (_prev, formData) => {
    // Un bouton radio désactivé (moteur devenu indisponible) n'est pas envoyé : on le signale.
    const raw = formData.get("engine");
    const engine: Engine | null = raw === "claude" || raw === "ollama" || raw === "free" ? raw : null;
    const ollamaModel = String(formData.get("ollamaModel") ?? "").trim();
    if (!engine) {
      const message = "Choisissez un moteur disponible.";
      // Le choix coché est désactivé : focus sur le premier moteur utilisable.
      formRef.current?.querySelector<HTMLInputElement>('input[name="engine"]:not(:disabled)')?.focus();
      return { status: { kind: "error", message }, fieldErrors: { engine: [message] } };
    }
    if (engine === "ollama" && !ollamaModel) {
      focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: "Choisissez un modèle Ollama." }, fieldErrors: { ollamaModel: ["Choisissez un modèle Ollama."] } };
    }
    const input =
      engine === "ollama" ? { engine, ollamaModel } : engine === "claude" ? { engine } : { engine };
    let result: Awaited<ReturnType<typeof setAiEngine>>;
    try {
      result = await setAiEngine(input);
    } catch {
      return { status: { kind: "error", message: "La connexion a été interrompue. Réessayez." }, fieldErrors: {} };
    }
    if (!result.ok) {
      const fieldErrors = result.fieldErrors ?? {};
      if (firstError(fieldErrors, "ollamaModel")) focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: result.error }, fieldErrors };
    }
    setSavedChoice(engine);
    router.refresh();
    const label = engineLabel(engine, engine === "ollama" ? ollamaModel : null);
    return { status: { kind: "success", message: `Moteur enregistré : ${label}.` }, fieldErrors: {} };
  }, INITIAL);

  const engineError = firstError(state.fieldErrors, "engine");
  const modelError = firstError(state.fieldErrors, "ollamaModel");
  const modelId = `${baseId}-model`;

  const options: { value: Engine; title: string; text: string; disabled: boolean; note: ReactNode; extra?: ReactNode }[] = [
    {
      value: "free",
      title: "Gratuit (sans IA)",
      text: "Reconnaissance du thème et trame du diaporama construites à partir de vos thèmes et de votre gabarit. Instantané, illimité. Le contenu est à compléter : rien n'est inventé.",
      disabled: false,
      note: null,
    },
    {
      value: "claude",
      title: "Claude (Anthropic)",
      text: "Rédaction complète, notes d'orateur. Nécessite une clé API (ci-dessous) ou celle du serveur.",
      disabled: !status.available.claude,
      note: status.available.claude ? null : (
        <>
          Indisponible : aucune clé API.{" "}
          <a href="#cle-api" className="opale-link font-semibold">
            Ajouter une clé API
          </a>
        </>
      ),
    },
    {
      value: "ollama",
      title: "Modèle local (Ollama)",
      text: "Gratuit et privé, exécuté sur la machine du serveur. Plus lent, qualité variable selon le modèle.",
      disabled: !ollamaUsable,
      note: ollamaNote,
      extra:
        ollamaUsable && choice === "ollama" ? (
          <div>
            <label htmlFor={modelId} className="opale-field__label">
              Modèle Ollama
            </label>
            <SelectInput
              id={modelId}
              name="ollamaModel"
              defaultValue={
                ollama.selectedModel && ollama.models.includes(ollama.selectedModel) ? ollama.selectedModel : ollama.models[0]
              }
              aria-invalid={Boolean(modelError)}
              aria-describedby={modelError ? `${modelId}-err` : undefined}
            >
              {ollama.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectInput>
            <FieldError id={`${modelId}-err`} message={modelError} />
          </div>
        ) : null,
    },
  ];

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (saving) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => submit(data));
      }}
    >
      <div className="rounded-lg border border-border bg-surface-2 p-4">
        <p>
          Moteur utilisé :{" "}
          <strong>{engineLabel(status.effective, status.effective === "ollama" ? ollama.selectedModel : null)}</strong>
        </p>
        {status.selected === null ? (
          <p className="mt-1 text-sm text-muted">Par défaut : Claude si une clé est disponible, sinon Gratuit.</p>
        ) : null}
      </div>

      <RadioGroup
        label="Choix du moteur"
        name="engine"
        value={choice}
        onValueChange={(value) => {
          if (value === "claude" || value === "ollama" || value === "free") setChoice(value);
        }}
        aria-describedby={engineError ? `${baseId}-engine-err` : undefined}
      >
        {options.map((o) => (
          <Radio
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            label={o.title}
            description={
              <>
                {o.text}
                {o.note ? <span className="mt-1 block font-semibold text-text">{o.note}</span> : null}
              </>
            }
          />
        ))}
      </RadioGroup>
      {options.map((o) => (o.extra ? <div key={o.value}>{o.extra}</div> : null))}
      <FieldError id={`${baseId}-engine-err`} message={engineError} />

      <FormStatus state={state.status} />
      <div>
        <Button type="submit" aria-disabled={saving || undefined}>
          <ButtonLabel idle="Enregistrer le moteur" busy="Enregistrement…" isBusy={saving} />
        </Button>
      </div>
    </form>
  );
}
