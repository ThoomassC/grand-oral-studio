"use client";

import { Notice } from "@/components/ui/Notice";
import { SelectInput, TextArea } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { ButtonLink } from "@/components/ui/ButtonLink";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ClassificationOutcome } from "@/domain/contracts";
import { ProblemInputSchema } from "@/domain/schemas";
import { classifyProblem, generateFinalDeck } from "@/server/actions/generation";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { pageHref } from "@/components/projects/steps";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ElapsedTime, useElapsed } from "@/components/ui/ElapsedTime";
import { FieldError } from "@/components/ui/FieldError";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Meter } from "@/components/ui/Meter";
import { NONE, OTHER, parseDraft, restoreDraft, selectedSubject, subjectMode, type Draft } from "./journey";

/** Sujet du projet proposé le jour J (identifiant de code historique : « theme »). */
export interface DayTheme {
  id: string;
  name: string;
}

export interface RecentDeck {
  id: string;
  title: string;
  minutesAgo: number;
}

/** Horloge lue dans les gestionnaires d'événements uniquement. */
const clock = () => Date.now();
const PROBLEM_MAX = 1500;
const SLOW_AFTER_MS = 3 * 60 * 1000;
const NETWORK_ERROR = "La connexion a été interrompue. Votre problématique est conservée : relancez la génération.";
const NONE_LABEL = "Sans sujet (problématique et trame seules)";

function readDraft(key: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? parseDraft(JSON.parse(raw)) : null;
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

function StepTitle({
  n,
  total,
  children,
  id,
  state,
}: {
  n: number;
  total: number;
  children: React.ReactNode;
  id: string;
  state: "current" | "done" | "todo";
}) {
  return (
    <h2 id={id} tabIndex={-1} className="flex items-center gap-3 text-xl focus:outline-none sm:text-2xl">
      <span
        aria-hidden="true"
        className={`num flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${
          state === "current"
            ? "bg-highlight text-on-highlight ring-2 ring-highlight ring-offset-2 ring-offset-surface"
            : state === "done"
              ? "bg-success-soft text-success ring-1 ring-success"
              : "bg-surface-2 text-muted ring-1 ring-border-strong"
        }`}
      >
        {state === "done" ? "✓" : n}
      </span>
      <span>
        <span className="sr-only">
          Étape {n} sur {total} :{" "}
        </span>
        {children}
        {state === "done" ? <span className="sr-only"> (terminée)</span> : null}
      </span>
    </h2>
  );
}

/** Cadre d'une option à cocher : le choix coché se lit à la bordure ET à la case cochée. */
function optionClass(checked: boolean): string {
  return `rounded-lg border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
    checked ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border-strong hover:border-text"
  }`;
}

const RADIO_CLASS = "h-4 w-4 shrink-0 accent-[var(--opale-primary)]";

interface DayJourneyProps {
  programId: string;
  themes: DayTheme[];
  recentDeck: RecentDeck | null;
  /**
   * Moteur qui rédigera le deck : libellé prêt à afficher (ex. « Ollama · mistral »)
   * et `outlineOnly` pour le moteur sans IA (trame remplie avec les notes, texte à
   * compléter) ; `waitHint` : durée d'attente annoncée, qui dépend du moteur
   * (cf. generationWaitHint).
   */
  writer: { label: string; outlineOnly: boolean; waitHint: string };
}

const draftKey = (programId: string) => `grand-oral-studio:jour-j:${programId}`;
const noopSubscribe = () => () => {};

/**
 * Le brouillon vit dans sessionStorage, inconnu du serveur : le rendu serveur
 * et l'hydratation partent d'un état vide, puis, une fois côté client, le
 * parcours est remonté (clé) avec le brouillon restauré comme état initial
 * (confronté aux sujets actuels : un sujet supprimé ramène à l'étape 1).
 */
export function DayJourney(props: DayJourneyProps) {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <DayJourneyInner
      key={hydrated ? "client" : "server"}
      {...props}
      initialDraft={
        hydrated
          ? restoreDraft(
              readDraft(draftKey(props.programId)),
              props.themes.map((t) => t.id),
            )
          : null
      }
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
    s1: `${baseId}-s1`,
    s2: `${baseId}-s2`,
    s3: `${baseId}-s3`,
    generate: `${baseId}-generate`,
    counter: `${baseId}-counter`,
  };
  const storageKey = draftKey(programId);
  const submittedRef = useRef(false);
  const mode = subjectMode(themes.length);
  const totalSteps = mode === "none" ? 2 : 3;

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
  const subjectId = selectedSubject(choice, otherThemeId);
  const selectedTheme = subjectId ? themeById.get(subjectId) : undefined;
  const hintedTheme = mode === "many" && hintedThemeId ? themeById.get(hintedThemeId) : undefined;
  /** Sujet proposé sans reconnaissance : le seul du projet, ou celui indiqué sur l'énoncé. */
  const directTheme =
    mode === "single" ? themes[0] : (hintedTheme ?? (choice !== OTHER && choice !== NONE ? themeById.get(choice) : undefined));
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

  /** Reconnaissance du sujet : seulement à partir de deux sujets (le serveur la refuse sans sujet). */
  function classify() {
    if (mode !== "many" || classifying || generating) return;
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

  /**
   * Sans reconnaissance : sans sujet (directement au diaporama), avec le seul
   * sujet du projet, ou avec le sujet indiqué sur l'énoncé.
   */
  function continueDirect() {
    if (classifying || generating) return;
    if (!validateProblem()) return;
    if (mode === "none") {
      update({ stage: "chosen", result: null, choice: NONE, otherThemeId: "" });
      focusLater([ids.generate]);
      return;
    }
    const theme = mode === "single" ? themes[0] : hintedTheme;
    if (!theme) return;
    update({ stage: "chosen", result: null, choice: theme.id, otherThemeId: "" });
    focusLater([ids.s2]);
  }

  function editProblem() {
    if (generating) return;
    update({ stage: "input", result: null, choice: "", otherThemeId: "" });
    setGeneration({ kind: "idle" });
    focusLater([ids.problem]);
  }

  function generate() {
    if (submittedRef.current || subjectId === undefined) return;
    submittedRef.current = true;
    setGeneration({ kind: "running", startedAt: clock() });
    startGenerate(async () => {
      let res: Awaited<ReturnType<typeof generateFinalDeck>>;
      try {
        res = await generateFinalDeck(programId, subjectId, problem.trim());
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
      router.push(`/projets/${programId}/decks/${res.data.deckId}?nouveau=1`);
    });
  }

  function pick(next: string) {
    if (!generating) update({ choice: next });
  }

  const chosen = stage === "chosen";
  const step1State = chosen ? "done" : "current";
  const step2State = chosen ? (subjectId !== undefined ? "done" : "current") : "todo";
  const lastState = chosen && subjectId !== undefined ? "current" : "todo";

  /** Ce que produira la génération, selon le moteur et le sujet retenu. */
  const outcomeText = selectedTheme ? (
    <>
      {writer.outlineOnly
        ? "Trame du diaporama remplie avec vos notes, texte à compléter, pour le sujet "
        : "Deck complet avec notes d'orateur pour le sujet "}
      <strong>{selectedTheme.name}</strong>, à partir de la trame et des notes du sujet.
    </>
  ) : subjectId === null ? (
    writer.outlineOnly ? (
      "Trame du diaporama, texte à compléter, sans sujet : à partir de la problématique et de la trame."
    ) : (
      "Deck complet avec notes d'orateur, sans sujet : à partir de la problématique et de la trame."
    )
  ) : null;

  const noneOption = (
    <label className={`flex cursor-pointer items-center gap-3 ${optionClass(choice === NONE)}`}>
      <input
        type="radio"
        name="theme-choice"
        value={NONE}
        checked={choice === NONE}
        onChange={() => pick(NONE)}
        aria-disabled={generating || undefined}
        className={RADIO_CLASS}
      />
      <span className="font-semibold">{NONE_LABEL}</span>
    </label>
  );

  const otherOption =
    mode === "many" ? (
      <div className={optionClass(choice === OTHER)}>
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
            className={RADIO_CLASS}
          />
          <span className="font-semibold">Un autre sujet du projet</span>
        </label>
        {choice === OTHER ? (
          <div className="mt-3 pl-7">
            <label htmlFor={ids.other} className="opale-field__label">
              Sujet
            </label>
            <SelectInput
              id={ids.other}
              value={otherThemeId}
              onChange={(e) => {
                if (!generating) update({ otherThemeId: e.target.value });
              }}
            >
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectInput>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {recentDeck ? (
        <div className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Votre dernier diaporama (« {recentDeck.title} », il y a{" "}
            {recentDeck.minutesAgo < 1 ? "moins d'une minute" : `${recentDeck.minutesAgo} min`}) est prêt.
          </p>
          <ButtonLink href={`/projets/${programId}/decks/${recentDeck.id}`} variant="ghost" size="small" className="shrink-0">
            Ouvrir le diaporama
          </ButtonLink>
        </div>
      ) : null}

      {/* Étape 1 */}
      <section aria-labelledby={ids.s1} className="opale-card opale-card--e1 block p-5 sm:p-6">
        <StepTitle n={1} total={totalSteps} id={ids.s1} state={step1State}>
          La problématique
        </StepTitle>
        {stage === "input" ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "many" && !hintedTheme) classify();
              else continueDirect();
            }}
            className="mt-4 flex flex-col gap-4"
          >
            <div>
              <label htmlFor={ids.problem} className="opale-field__label">
                Problématique tirée au sort
              </label>
              <TextArea
                id={ids.problem}
                className="text-lg"
                rows={4}
                value={problem}
                maxLength={PROBLEM_MAX}
                onChange={(e) => update({ problem: e.target.value })}
                placeholder="Recopiez l'intitulé exact"
                {...errorProps(fieldErrors, "problem", `${ids.problem}-err`, ids.counter)}
              />
              <p id={ids.counter} className="opale-field__helper tabular-nums">
                {problem.length.toLocaleString("fr-FR")}/{PROBLEM_MAX.toLocaleString("fr-FR")} caractères
              </p>
              <FieldError id={`${ids.problem}-err`} message={firstError(fieldErrors, "problem")} />
            </div>
            {mode === "none" ? (
              <p className="flex gap-2 rounded-lg border border-border-strong bg-surface p-3 text-sm">
                <InfoIcon />
                <span>
                  Sans sujet : le diaporama part de la problématique et de la trame.{" "}
                  <Link href={pageHref(programId, "subjects")} className="opale-link">
                    Ajouter des sujets
                  </Link>
                </span>
              </p>
            ) : null}
            {mode === "many" ? (
              <div>
                <label htmlFor={ids.hint} className="opale-field__label">
                  Sujet indiqué sur l&apos;énoncé <span className="font-normal text-muted">(facultatif)</span>
                </label>
                <SelectInput
                  id={ids.hint}
                  value={hintedThemeId}
                  onChange={(e) => update({ hintedThemeId: e.target.value })}
                >
                  <option value="">Aucun sujet indiqué</option>
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </SelectInput>
              </div>
            ) : null}
            <LiveRegion role="alert">
              {classifyError ? (
                <Notice tone="error">
                  {classifyError}
                </Notice>
              ) : null}
            </LiveRegion>
            <div className="flex flex-wrap items-center gap-3">
              {mode !== "many" ? (
                <Button type="submit">Continuer</Button>
              ) : hintedTheme ? (
                <>
                  <Button type="submit" aria-disabled={classifying || undefined}>
                    Continuer avec ce sujet
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={classify}
                    aria-disabled={classifying || undefined}
                  >
                    <ButtonLabel idle="Reconnaître le sujet" busy="Reconnaissance en cours…" isBusy={classifying} />
                  </Button>
                </>
              ) : (
                <Button type="submit" aria-disabled={classifying || undefined}>
                  <ButtonLabel idle="Reconnaître le sujet" busy="Reconnaissance en cours…" isBusy={classifying} />
                </Button>
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
              <Button
                type="button"
                variant="text" size="small"
                onClick={editProblem}
                aria-disabled={generating || undefined}
              >
                Modifier la problématique
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Étape 2 : le sujet (absente quand le projet n'a pas de sujet) */}
      {chosen && mode !== "none" ? (
        <section aria-labelledby={ids.s2} className="opale-card opale-card--e1 block p-5 sm:p-6">
          <StepTitle n={2} total={totalSteps} id={ids.s2} state={step2State}>
            Le sujet
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
                    Reconnaissance sans IA : {result.fallbackReason} Vérifiez le sujet proposé.
                  </span>
                </p>
              ) : result.source === "free" ? (
                <p className="mt-3 text-sm text-muted">Reconnaissance sans IA, par mots-clés</p>
              ) : null}
            </>
          ) : null}

          <fieldset className="mt-5">
            <legend className="opale-field__label">Sujet retenu pour le diaporama</legend>
            {result && result.ranked.length === 0 ? (
              <p className="mb-3 text-sm text-muted">
                Aucun sujet n&apos;a été reconnu avec assez de confiance. Choisissez-le dans la liste, ou continuez
                sans sujet.
              </p>
            ) : null}
            <div className="flex flex-col gap-3">
              {result
                ? result.ranked.map((r) => {
                    const checked = choice === r.themeId;
                    const pct = Math.round(r.confidence * 100);
                    const isHinted = r.themeId === hintedThemeId;
                    const showMeter = !isHinted || r.confidence > 0;
                    const cid = `${baseId}-c-${r.themeId}`;
                    return (
                      <label key={r.themeId} className={`flex cursor-pointer gap-3 transition-colors ${optionClass(checked)}`}>
                        <input
                          type="radio"
                          name="theme-choice"
                          value={r.themeId}
                          checked={checked}
                          onChange={() => pick(r.themeId)}
                          aria-disabled={generating || undefined}
                          aria-labelledby={`${cid}-name ${showMeter ? `${cid}-pct` : `${cid}-badge`}`}
                          aria-describedby={r.rationale ? `${cid}-why` : undefined}
                          className={`mt-1 ${RADIO_CLASS}`}
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
                                Indiqué sur l&apos;énoncé
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
                        </span>
                      </label>
                    );
                  })
                : directTheme ? (
                    <label className={`flex cursor-pointer flex-wrap items-center gap-3 ${optionClass(choice === directTheme.id)}`}>
                      <input
                        type="radio"
                        name="theme-choice"
                        value={directTheme.id}
                        checked={choice === directTheme.id}
                        onChange={() => pick(directTheme.id)}
                        aria-disabled={generating || undefined}
                        className={RADIO_CLASS}
                      />
                      <span className="font-semibold">{directTheme.name}</span>
                      {directTheme.id === hintedThemeId ? (
                        <span className="rounded-full bg-surface px-2 py-0.5 text-sm font-semibold text-accent-strong ring-1 ring-accent/40">
                          Indiqué sur l&apos;énoncé
                        </span>
                      ) : mode === "single" ? (
                        <span className="text-sm text-muted">Le seul sujet du projet</span>
                      ) : null}
                    </label>
                  ) : null}
              {otherOption}
              {noneOption}
            </div>
          </fieldset>

          {!result && mode === "many" ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="text" size="small"
                onClick={() => {
                  if (generating) return;
                  update({ stage: "input" });
                  window.setTimeout(classify, 0);
                }}
                aria-disabled={generating || undefined}
              >
                Reconnaître le sujet
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Dernière étape : le diaporama */}
      {chosen ? (
        <section aria-labelledby={ids.s3} className="opale-card opale-card--e1 block p-5 sm:p-6">
          <StepTitle n={totalSteps} total={totalSteps} id={ids.s3} state={lastState}>
            Le diaporama
          </StepTitle>
          {outcomeText ? <p className="mt-3">{outcomeText}</p> : null}

          <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span>
              <span className="text-muted">Rédaction : </span>
              <strong>{writer.label}</strong>
            </span>
            <Link href="/configuration-ia" className="opale-link">
              Changer<span className="sr-only"> qui rédige le jour J</span>
            </Link>
          </p>

          <div className="mt-4">
            <Button
              id={ids.generate}
              type="button"
              size="large"
              onClick={generate}
              aria-disabled={generating || subjectId === undefined || undefined}
              aria-describedby={generating ? `${ids.s3}-progress` : undefined}
            >
              <ButtonLabel idle="Générer le diaporama" busy="Génération en cours…" isBusy={generating} />
            </Button>
          </div>

          <LiveRegion className="mt-4">
            {generating ? (
              <Notice tone="info">
                <p id={`${ids.s3}-progress`} className="font-semibold text-accent-strong">
                  Génération du diaporama en cours. {writer.waitHint}
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
              </Notice>
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
                <Button type="button" variant="ghost" size="small" onClick={() => window.location.reload()}>
                  Relancer
                </Button>
              ) : null}
            </div>
          ) : null}
          <LiveRegion role="alert" className="mt-2">
            {generation.kind === "error" ? (
              <Notice tone="error">
                <p className="font-semibold">{generation.message}</p>
                <p className="mt-1 text-sm">
                  Votre problématique et votre choix sont conservés : relancez la génération, ou{" "}
                  <Link href="/configuration-ia" className="font-semibold underline underline-offset-2">
                    changez qui rédige dans la Configuration IA
                  </Link>
                  .
                </p>
              </Notice>
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
