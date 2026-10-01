"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ClassificationOutcome } from "@/domain/contracts";
import { ProblemInputSchema } from "@/domain/schemas";
import { classifyProblem, generateFinalDeck } from "@/server/actions/generation";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ElapsedTime, useElapsed } from "@/components/ui/ElapsedTime";
import { FieldError } from "@/components/ui/FieldError";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Meter } from "@/components/ui/Meter";

export interface DayTheme {
  id: string;
  name: string;
  hasSkeleton: boolean;
}

export interface RecentDeck {
  id: string;
  title: string;
  minutesAgo: number;
}

const OTHER = "__other__";
/** Horloge lue dans les gestionnaires d'événements uniquement. */
const clock = () => Date.now();
const PROBLEM_MAX = 1500;
const SLOW_AFTER_MS = 3 * 60 * 1000;
const NETWORK_ERROR = "La connexion a été interrompue. Votre problématique est conservée : relancez la génération.";

/** Ce qui est conservé dans sessionStorage (rechargement, onglet fermé par erreur). */
interface Draft {
  problem: string;
  hintedThemeId: string;
  stage: "input" | "chosen";
  result: ClassificationOutcome | null;
  choice: string;
  otherThemeId: string;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const d = value as Partial<Draft>;
    if (typeof d.problem !== "string") return null;
    return {
      problem: d.problem,
      hintedThemeId: typeof d.hintedThemeId === "string" ? d.hintedThemeId : "",
      stage: d.stage === "chosen" ? "chosen" : "input",
      result:
        d.result && Array.isArray(d.result.ranked)
          ? {
              ...d.result,
              // Brouillon antérieur au moteur gratuit : reconnaissance par IA, sans repli.
              source: d.result.source === "free" ? "free" : "ai",
              fallbackReason: typeof d.result.fallbackReason === "string" ? d.result.fallbackReason : null,
            }
          : null,
      choice: typeof d.choice === "string" ? d.choice : "",
      otherThemeId: typeof d.otherThemeId === "string" ? d.otherThemeId : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft | null): void {
  try {
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Stockage indisponible (navigation privée, quota) : la saisie reste en mémoire.
  }
}

function StepTitle({ n, children, id, state }: { n: number; children: React.ReactNode; id: string; state: "current" | "done" | "todo" }) {
  return (
    <h2 id={id} tabIndex={-1} className="flex items-center gap-3 text-xl focus:outline-none sm:text-2xl">
      <span
        aria-hidden="true"
        className={`num flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${
          state === "current"
            ? "hl ring-2 ring-on-highlight ring-offset-2 ring-offset-surface"
            : state === "done"
              ? "bg-success-soft text-success ring-1 ring-success"
              : "bg-surface-2 text-muted ring-1 ring-border-strong"
        }`}
      >
        {state === "done" ? "✓" : n}
      </span>
      <span>
        <span className="sr-only">Étape {n} sur 3 : </span>
        {children}
        {state === "done" ? <span className="sr-only"> (terminée)</span> : null}
      </span>
    </h2>
  );
}

interface DayJourneyProps {
  programId: string;
  themes: DayTheme[];
  recentDeck: RecentDeck | null;
  /**
   * Moteur qui rédigera le deck : libellé prêt à afficher (ex. « Ollama · mistral »)
   * et `outlineOnly` pour le moteur gratuit (trame à compléter, pas de rédaction).
   */
  writer: { label: string; outlineOnly: boolean };
}

const draftKey = (programId: string) => `grand-oral-studio:jour-j:${programId}`;
const noopSubscribe = () => () => {};

/**
 * Le brouillon vit dans sessionStorage, inconnu du serveur : le rendu serveur
 * et l'hydratation partent d'un état vide, puis, une fois côté client, le
 * parcours est remonté (clé) avec le brouillon restauré comme état initial.
 */
export function DayJourney(props: DayJourneyProps) {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <DayJourneyInner
      key={hydrated ? "client" : "server"}
      {...props}
      initialDraft={hydrated ? readDraft(draftKey(props.programId)) : null}
    />
  );
}

function DayJourneyInner({ programId, themes, recentDeck, writer, initialDraft }: DayJourneyProps & { initialDraft: Draft | null }) {
  const router = useRouter();
  const baseId = useId();
  const ids = {
    problem: `${baseId}-problem`,
    hint: `${baseId}-hint`,
    other: `${baseId}-other`,
    direct: `${baseId}-direct`,
    s1: `${baseId}-s1`,
    s2: `${baseId}-s2`,
    s3: `${baseId}-s3`,
    generate: `${baseId}-generate`,
    counter: `${baseId}-counter`,
  };
  const storageKey = draftKey(programId);
  const submittedRef = useRef(false);

  const [problem, setProblem] = useState(initialDraft?.problem ?? "");
  const [hintedThemeId, setHintedThemeId] = useState(initialDraft?.hintedThemeId ?? "");
  const [stage, setStage] = useState<"input" | "chosen">(initialDraft?.stage ?? "input");
  const [result, setResult] = useState<ClassificationOutcome | null>(initialDraft?.result ?? null);
  const [choice, setChoice] = useState<string>(initialDraft?.choice ?? "");
  const [otherThemeId, setOtherThemeId] = useState(initialDraft?.otherThemeId ?? "");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<
    { kind: "idle" } | { kind: "running"; startedAt: number } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [classifying, startClassify] = useTransition();
  const [, startGenerate] = useTransition();


  const generating = generation.kind === "running";
  const elapsed = useElapsed(generation.kind === "running" ? generation.startedAt : null);
  const themeById = new Map(themes.map((t) => [t.id, t]));
  const selectedThemeId = choice === OTHER ? otherThemeId : choice;
  const selectedTheme = selectedThemeId ? themeById.get(selectedThemeId) : undefined;
  const hintedTheme = hintedThemeId ? themeById.get(hintedThemeId) : undefined;
  const problemLength = problem.trim().length;

  /** Met à jour l'état et le brouillon en une fois (pas d'effet de synchronisation). */
  function update(next: Partial<Draft>) {
    const draft: Draft = { problem, hintedThemeId, stage, result, choice, otherThemeId, ...next };
    if (next.problem !== undefined) setProblem(next.problem);
    if (next.hintedThemeId !== undefined) setHintedThemeId(next.hintedThemeId);
    if (next.stage !== undefined) setStage(next.stage);
    if (next.result !== undefined) setResult(next.result);
    if (next.choice !== undefined) setChoice(next.choice);
    if (next.otherThemeId !== undefined) setOtherThemeId(next.otherThemeId);
    writeDraft(storageKey, draft);
  }

  function validateProblem(): boolean {
    const checked = validateWith(ProblemInputSchema, { problem, hintedThemeId: hintedThemeId || null });
    if (checked.ok) {
      setFieldErrors({});
      return true;
    }
    setFieldErrors(
      problemLength < 10 || problemLength > PROBLEM_MAX
        ? {
            problem: [
              problemLength < 10
                ? "Saisissez la problématique complète (10 caractères au moins)."
                : "La problématique dépasse 1 500 caractères.",
            ],
          }
        : checked.fieldErrors,
    );
    focusLater([ids.problem]);
    return false;
  }

  function classify() {
    if (classifying || generating) return;
    setClassifyError(null);
    if (!validateProblem()) return;
    startClassify(async () => {
      let res: Awaited<ReturnType<typeof classifyProblem>>;
      try {
        res = await classifyProblem(programId, { problem, hintedThemeId: hintedThemeId || null });
      } catch {
        setClassifyError("La connexion a été interrompue. Votre problématique est conservée : réessayez.");
        return;
      }
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        setClassifyError(res.error);
        return;
      }
      const first = res.data.ranked[0]?.themeId;
      update({
        stage: "chosen",
        result: res.data,
        choice: first ?? OTHER,
        otherThemeId: first ? "" : hintedThemeId || themes[0]?.id || "",
      });
      focusLater([ids.s2]);
    });
  }

  /** Thème indiqué sur le sujet : on passe directement à la génération. */
  function continueWithHint() {
    if (classifying || generating || !hintedTheme) return;
    if (!validateProblem()) return;
    update({ stage: "chosen", result: null, choice: OTHER, otherThemeId: hintedTheme.id });
    focusLater([ids.generate]);
  }

  function editProblem() {
    if (generating) return;
    update({ stage: "input", result: null, choice: "", otherThemeId: "" });
    setGeneration({ kind: "idle" });
    focusLater([ids.problem]);
  }

  function generate() {
    if (submittedRef.current || !selectedThemeId) return;
    submittedRef.current = true;
    setGeneration({ kind: "running", startedAt: clock() });
    startGenerate(async () => {
      let res: Awaited<ReturnType<typeof generateFinalDeck>>;
      try {
        res = await generateFinalDeck(programId, selectedThemeId, problem.trim());
      } catch {
        submittedRef.current = false;
        setGeneration({ kind: "error", message: NETWORK_ERROR });
        return;
      }
      if (!res.ok) {
        submittedRef.current = false;
        setGeneration({ kind: "error", message: res.error });
        return;
      }
      writeDraft(storageKey, null);
      // L'état « en cours » est conservé jusqu'à l'arrivée sur la page du deck.
      router.push(`/programmes/${programId}/decks/${res.data.deckId}?nouveau=1`);
    });
  }

  if (themes.length === 0) {
    return (
      <div className="card-empty p-6">
        <h2 className="font-display text-lg font-semibold">Aucun thème dans ce programme</h2>
        <p className="mt-1 text-muted">La reconnaissance a besoin des thèmes du programme. Ajoutez-les d&apos;abord.</p>
        <Link href={`/programmes/${programId}`} className="btn btn-primary mt-4">
          Ajouter des thèmes
        </Link>
      </div>
    );
  }

  const step1State = stage === "chosen" ? "done" : "current";
  const step2State = stage === "chosen" ? (selectedThemeId ? "done" : "current") : "todo";
  const step3State = stage === "chosen" && selectedThemeId ? "current" : "todo";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {recentDeck ? (
        <div className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Votre dernier diaporama (« {recentDeck.title} », il y a{" "}
            {recentDeck.minutesAgo < 1 ? "moins d'une minute" : `${recentDeck.minutesAgo} min`}) est prêt.
          </p>
          <Link href={`/programmes/${programId}/decks/${recentDeck.id}`} className="btn btn-secondary btn-sm shrink-0">
            Ouvrir le diaporama
          </Link>
        </div>
      ) : null}

      {/* Étape 1 */}
      <section aria-labelledby={ids.s1} className="card p-5 sm:p-6">
        <StepTitle n={1} id={ids.s1} state={step1State}>
          La problématique
        </StepTitle>
        {stage === "input" ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (hintedTheme) continueWithHint();
              else classify();
            }}
            className="mt-4 flex flex-col gap-4"
          >
            <div>
              <label htmlFor={ids.problem} className="field-label">
                Problématique tirée au sort
              </label>
              <textarea
                id={ids.problem}
                className="input text-lg"
                rows={4}
                value={problem}
                maxLength={PROBLEM_MAX}
                onChange={(e) => update({ problem: e.target.value })}
                placeholder="Recopiez l'intitulé exact"
                {...errorProps(fieldErrors, "problem", `${ids.problem}-err`, ids.counter)}
              />
              <p id={ids.counter} className="field-hint tabular-nums">
                {problem.length.toLocaleString("fr-FR")}/{PROBLEM_MAX.toLocaleString("fr-FR")} caractères
              </p>
              <FieldError id={`${ids.problem}-err`} message={firstError(fieldErrors, "problem")} />
            </div>
            <div>
              <label htmlFor={ids.hint} className="field-label">
                Thème indiqué sur le sujet <span className="font-normal text-muted">(facultatif)</span>
              </label>
              <select
                id={ids.hint}
                className="input"
                value={hintedThemeId}
                onChange={(e) => update({ hintedThemeId: e.target.value })}
              >
                <option value="">Aucun thème indiqué</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <LiveRegion role="alert">
              {classifyError ? (
                <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                  {classifyError}
                </p>
              ) : null}
            </LiveRegion>
            <div className="flex flex-wrap items-center gap-3">
              {hintedTheme ? (
                <>
                  <button type="submit" className="btn btn-primary" aria-disabled={classifying || undefined}>
                    Continuer avec ce thème
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={classify}
                    aria-disabled={classifying || undefined}
                  >
                    <ButtonLabel idle="Vérifier avec l'IA" busy="Vérification…" isBusy={classifying} />
                  </button>
                </>
              ) : (
                <button type="submit" className="btn btn-primary" aria-disabled={classifying || undefined}>
                  <ButtonLabel idle="Reconnaître le thème" busy="Reconnaissance en cours…" isBusy={classifying} />
                </button>
              )}
              <LiveRegion className="text-sm text-muted">
                {classifying ? "Analyse de la problématique, quelques secondes…" : null}
              </LiveRegion>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <blockquote className="border-l-4 border-accent pl-4 text-lg">{problem.trim()}</blockquote>
            <div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={editProblem}
                aria-disabled={generating || undefined}
              >
                Modifier la problématique
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Étape 2 */}
      {stage === "chosen" ? (
        <section aria-labelledby={ids.s2} className="card p-5 sm:p-6">
          <StepTitle n={2} id={ids.s2} state={step2State}>
            Le thème
          </StepTitle>

          {result ? (
            <>
              <div className="mt-4 rounded-lg bg-surface-2 p-3">
                <p className="text-sm font-semibold text-muted">Problématique reformulée</p>
                <p className="mt-1">{result.reformulatedProblem}</p>
              </div>

              {result.source === "free" && result.fallbackReason ? (
                <p className="mt-4 flex gap-2 rounded-lg border border-border-strong bg-surface p-3 text-sm">
                  <InfoIcon />
                  <span>
                    Reconnaissance sans IA : {result.fallbackReason} Vérifiez le thème proposé.
                  </span>
                </p>
              ) : result.source === "free" ? (
                <p className="mt-3 text-sm text-muted">Reconnaissance sans IA, par mots-clés</p>
              ) : null}

              <fieldset className="mt-5">
                <legend className="field-label">Thème retenu pour le diaporama</legend>
                {result.ranked.length === 0 ? (
                  <p className="mb-3 text-sm text-muted">
                    Aucun thème n&apos;a été reconnu avec assez de confiance. Choisissez-le dans la liste.
                  </p>
                ) : null}
                <div className="flex flex-col gap-3">
                  {result.ranked.map((r) => {
                    const checked = choice === r.themeId;
                    const theme = themeById.get(r.themeId);
                    const pct = Math.round(r.confidence * 100);
                    const isHinted = r.themeId === hintedThemeId;
                    const showMeter = !isHinted || r.confidence > 0;
                    const cid = `${baseId}-c-${r.themeId}`;
                    return (
                      <label
                        key={r.themeId}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                          checked ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border-strong hover:border-text"
                        }`}
                      >
                        <input
                          type="radio"
                          name="theme-choice"
                          value={r.themeId}
                          checked={checked}
                          onChange={() => {
                            if (!generating) update({ choice: r.themeId });
                          }}
                          aria-disabled={generating || undefined}
                          aria-labelledby={`${cid}-name ${showMeter ? `${cid}-pct` : `${cid}-badge`}`}
                          aria-describedby={[r.rationale ? `${cid}-why` : null, theme && !theme.hasSkeleton ? `${cid}-noskel` : null]
                            .filter(Boolean)
                            .join(" ") || undefined}
                          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span id={`${cid}-name`} className="font-semibold">
                              {r.themeName}
                            </span>
                            {isHinted ? (
                              <span
                                id={`${cid}-badge`}
                                className="rounded-full bg-surface px-2 py-0.5 text-sm font-semibold text-accent-strong ring-1 ring-accent/40"
                              >
                                Indiqué sur votre sujet
                              </span>
                            ) : null}
                            {showMeter ? (
                              <span id={`${cid}-pct`} className="text-sm font-semibold tabular-nums">
                                Confiance {pct} %
                              </span>
                            ) : null}
                          </span>
                          {showMeter ? (
                            <span aria-hidden="true" className="block">
                              <Meter className="mt-2" value={r.confidence} label={`Confiance pour ${r.themeName}`} valueText={`${pct} %`} />
                            </span>
                          ) : null}
                          {r.rationale ? (
                            <span id={`${cid}-why`} className="mt-2 block text-sm text-muted">
                              {r.rationale}
                            </span>
                          ) : null}
                          {theme && !theme.hasSkeleton ? (
                            <span id={`${cid}-noskel`} className="mt-2 block text-sm font-medium text-warning">
                              Pas de squelette pour ce thème : la génération partira de zéro.
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}

                  <div
                    className={`rounded-lg border p-4 ${choice === OTHER ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border-strong"}`}
                  >
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="radio"
                        name="theme-choice"
                        value={OTHER}
                        checked={choice === OTHER}
                        onChange={() => {
                          if (generating) return;
                          update({ choice: OTHER, otherThemeId: otherThemeId || themes[0]?.id || "" });
                        }}
                        aria-disabled={generating || undefined}
                        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      <span className="font-semibold">Un autre thème du programme</span>
                    </label>
                    {choice === OTHER ? (
                      <div className="mt-3 pl-7">
                        <label htmlFor={ids.other} className="field-label">
                          Thème
                        </label>
                        <select
                          id={ids.other}
                          className="input"
                          value={otherThemeId}
                          onChange={(e) => {
                            if (!generating) update({ otherThemeId: e.target.value });
                          }}
                        >
                          {themes.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.hasSkeleton ? "" : " (sans squelette)"}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                </div>
              </fieldset>
            </>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label htmlFor={ids.direct} className="field-label">
                  Thème indiqué sur votre sujet
                </label>
                <select
                  id={ids.direct}
                  className="input"
                  value={otherThemeId}
                  onChange={(e) => {
                    if (!generating) update({ otherThemeId: e.target.value, choice: OTHER });
                  }}
                >
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.hasSkeleton ? "" : " (sans squelette)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (generating) return;
                    update({ stage: "input" });
                    window.setTimeout(classify, 0);
                  }}
                  aria-disabled={generating || undefined}
                >
                  Vérifier avec l&apos;IA
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* Étape 3 */}
      {stage === "chosen" ? (
        <section aria-labelledby={ids.s3} className="card p-5 sm:p-6">
          <StepTitle n={3} id={ids.s3} state={step3State}>
            Le diaporama
          </StepTitle>
          {selectedTheme ? (
            <p className="mt-3">
              {writer.outlineOnly
                ? "Trame du diaporama, à compléter, pour le thème "
                : "Deck complet avec notes d'orateur pour le thème "}
              <strong>{selectedTheme.name}</strong>
              {selectedTheme.hasSkeleton ? ", à partir de son squelette." : "."}
            </p>
          ) : null}
          {selectedTheme && !selectedTheme.hasSkeleton ? (
            <p className="mt-2 rounded-lg border border-warning/60 bg-warning-soft px-3 py-2 text-sm">
              <strong className="text-warning">Ce thème n&apos;a pas de squelette.</strong> La génération fonctionne
              quand même, mais sans votre travail de préparation.
            </p>
          ) : null}

          <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span>
              <span className="text-muted">Rédaction : </span>
              <strong>{writer.label}</strong>
            </span>
            <Link href="/parametres" className="link">
              Changer<span className="sr-only"> le moteur de rédaction</span>
            </Link>
          </p>

          <div className="mt-4">
            <button
              id={ids.generate}
              type="button"
              className="btn btn-primary min-h-12 px-6 text-lg"
              onClick={generate}
              aria-disabled={generating || !selectedThemeId || undefined}
              aria-describedby={generating ? `${ids.s3}-progress` : undefined}
            >
              <ButtonLabel idle="Générer le diaporama" busy="Génération en cours…" isBusy={generating} />
            </button>
          </div>

          <LiveRegion className="mt-4">
            {generating ? (
              <div className="rounded-lg border border-accent/40 bg-accent-soft p-4">
                <p id={`${ids.s3}-progress`} className="font-semibold text-accent-strong">
                  Génération du diaporama en cours. Cela prend en général 1 à 3 minutes.
                </p>
                <p className="mt-1 text-sm">
                  Ne fermez pas cette page : vous serez redirigé vers le deck dès qu&apos;il sera prêt. En attendant,
                  relisez votre problématique et préparez votre plan.
                </p>
                {elapsed > SLOW_AFTER_MS ? (
                  <p className="mt-2 text-sm font-medium">
                    La génération prend plus de temps que d&apos;habitude. Vous pouvez patienter ou relancer : votre
                    problématique est conservée.
                  </p>
                ) : null}
              </div>
            ) : null}
          </LiveRegion>
          {generation.kind === "running" ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted">
                Temps écoulé : <ElapsedTime since={generation.startedAt} />
              </p>
              {elapsed > SLOW_AFTER_MS ? (
                // Une Server Action en cours ne s'annule pas : on recharge la page, la saisie est restaurée
                // depuis sessionStorage et un deck terminé entre-temps apparaît dans le bandeau.
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
                  Relancer
                </button>
              ) : null}
            </div>
          ) : null}
          <LiveRegion role="alert" className="mt-2">
            {generation.kind === "error" ? (
              <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-danger">
                <p className="font-semibold">{generation.message}</p>
                <p className="mt-1 text-sm">
                  Votre problématique et votre choix sont conservés : relancez la génération, ou{" "}
                  <Link href="/parametres" className="font-semibold underline underline-offset-2">
                    changez de moteur dans les Paramètres
                  </Link>
                  .
                </p>
              </div>
            ) : null}
          </LiveRegion>
        </section>
      ) : null}
    </div>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5M10 6.2v.1" />
    </svg>
  );
}
