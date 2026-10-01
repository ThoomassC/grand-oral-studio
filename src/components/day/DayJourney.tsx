"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import type { ClassificationResult } from "@/domain/contracts";
import { ProblemInputSchema } from "@/domain/schemas";
import { classifyProblem, generateFinalDeck } from "@/server/actions/generation";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ElapsedTime } from "@/components/ui/ElapsedTime";
import { FieldError } from "@/components/ui/FieldError";
import { Meter } from "@/components/ui/Meter";

export interface DayTheme {
  id: string;
  name: string;
  hasSkeleton: boolean;
}

const OTHER = "__other__";

function StepTitle({
  n,
  children,
  id,
  headingRef,
  done = false,
}: {
  n: number;
  children: React.ReactNode;
  id: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  done?: boolean;
}) {
  return (
    <h2 id={id} ref={headingRef} tabIndex={-1} className="flex items-center gap-3 text-xl font-semibold focus:outline-none">
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-base font-bold ${
          done ? "bg-accent text-on-accent" : "bg-accent-soft text-accent-strong"
        }`}
      >
        {n}
      </span>
      <span>
        <span className="sr-only">Étape {n} sur 3 : </span>
        {children}
      </span>
    </h2>
  );
}

export function DayJourney({ programId, themes }: { programId: string; themes: DayTheme[] }) {
  const router = useRouter();
  const ids = { problem: useId(), hint: useId(), other: useId(), s1: useId(), s2: useId(), s3: useId() };
  const step2Ref = useRef<HTMLHeadingElement>(null);
  const generatingRef = useRef<HTMLDivElement>(null);
  const submittedRef = useRef(false);

  const [problem, setProblem] = useState("");
  const [hintedThemeId, setHintedThemeId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [otherThemeId, setOtherThemeId] = useState("");
  const [generation, setGeneration] = useState<
    { kind: "idle" } | { kind: "running"; startedAt: number } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [classifying, startClassify] = useTransition();
  const [, startGenerate] = useTransition();

  const themeById = new Map(themes.map((t) => [t.id, t]));
  const selectedThemeId = choice === OTHER ? otherThemeId : choice;
  const selectedTheme = selectedThemeId ? themeById.get(selectedThemeId) : undefined;
  const generating = generation.kind === "running";

  function classify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (classifying) return;
    setClassifyError(null);
    const checked = validateWith(ProblemInputSchema, { problem, hintedThemeId: hintedThemeId || null });
    if (!checked.ok) {
      // Message plus direct que celui de zod pour la longueur (cas le plus fréquent).
      const length = problem.trim().length;
      setFieldErrors(
        length < 10 || length > 1500
          ? { problem: [length < 10 ? "Saisissez la problématique complète (10 caractères au moins)." : "La problématique dépasse 1 500 caractères."] }
          : checked.fieldErrors,
      );
      document.getElementById(ids.problem)?.focus();
      return;
    }
    setFieldErrors({});
    startClassify(async () => {
      const res = await classifyProblem(programId, checked.data);
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        setClassifyError(res.error);
        return;
      }
      setResult(res.data);
      const first = res.data.ranked[0]?.themeId;
      const fallback = hintedThemeId || themes[0]?.id || "";
      setChoice(first ?? OTHER);
      setOtherThemeId(first ? "" : fallback);
      requestAnimationFrame(() => step2Ref.current?.focus());
    });
  }

  function editProblem() {
    setResult(null);
    setChoice("");
    setOtherThemeId("");
    setGeneration({ kind: "idle" });
    requestAnimationFrame(() => document.getElementById(ids.problem)?.focus());
  }

  function generate() {
    if (submittedRef.current || !selectedThemeId) return;
    submittedRef.current = true;
    setGeneration({ kind: "running", startedAt: Date.now() });
    requestAnimationFrame(() => generatingRef.current?.focus());
    startGenerate(async () => {
      const res = await generateFinalDeck(programId, selectedThemeId, problem.trim());
      if (!res.ok) {
        submittedRef.current = false;
        setGeneration({ kind: "error", message: res.error });
        return;
      }
      // On garde l'état « en cours » jusqu'à l'arrivée sur la page du deck.
      router.push(`/programmes/${programId}/decks/${res.data.deckId}`);
    });
  }

  if (themes.length === 0) {
    return (
      <div className="card border-dashed p-6">
        <h2 className="font-display text-lg font-semibold">Aucun thème dans ce programme</h2>
        <p className="mt-1 text-muted">La reconnaissance a besoin des thèmes du programme. Ajoutez-les d&apos;abord.</p>
        <Link href={`/programmes/${programId}`} className="btn btn-primary mt-4">
          Ajouter des thèmes
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Étape 1 */}
      <section aria-labelledby={ids.s1} className="card p-5 sm:p-6">
        <StepTitle n={1} id={ids.s1} done={result !== null}>
          La problématique
        </StepTitle>
        {result === null ? (
          <form noValidate onSubmit={classify} className="mt-4 flex flex-col gap-4">
            <div>
              <label htmlFor={ids.problem} className="field-label">
                Problématique tirée au sort
              </label>
              <textarea
                id={ids.problem}
                className="input text-lg"
                rows={4}
                value={problem}
                maxLength={1500}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="Recopiez l'intitulé exact"
                {...errorProps(fieldErrors, "problem", `${ids.problem}-err`)}
              />
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
                onChange={(e) => setHintedThemeId(e.target.value)}
              >
                <option value="">Aucun thème indiqué</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div role="alert">
              {classifyError ? (
                <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                  {classifyError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-primary" disabled={classifying}>
                {classifying ? "Reconnaissance en cours…" : "Reconnaître le thème"}
              </button>
              <p role="status" className="text-sm text-muted">
                {classifying ? "Analyse de la problématique, quelques secondes…" : ""}
              </p>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <blockquote className="border-l-4 border-accent pl-4 text-lg">{problem.trim()}</blockquote>
            <div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={editProblem} disabled={generating}>
                Modifier la problématique
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Étape 2 */}
      {result ? (
        <section aria-labelledby={ids.s2} className="card p-5 sm:p-6">
          <StepTitle n={2} id={ids.s2} headingRef={step2Ref} done={selectedThemeId !== ""}>
            Le thème
          </StepTitle>
          <div className="mt-4 rounded-lg bg-surface-2 p-3">
            <p className="text-sm font-semibold text-muted">Problématique reformulée</p>
            <p className="mt-1">{result.reformulatedProblem}</p>
          </div>

          <fieldset className="mt-5" disabled={generating}>
            <legend className="field-label">Thème retenu pour le diaporama</legend>
            {result.ranked.length === 0 ? (
              <p className="mb-3 text-sm text-muted">
                Aucun thème n&apos;a été reconnu avec assez de confiance. Choisissez-le dans la liste.
              </p>
            ) : null}
            <div className="flex flex-col gap-3">
              {result.ranked.map((r, i) => {
                const checked = choice === r.themeId;
                const theme = themeById.get(r.themeId);
                const pct = Math.round(r.confidence * 100);
                return (
                  <label
                    key={r.themeId}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                      checked ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border hover:border-border-strong"
                    }`}
                  >
                    <input
                      type="radio"
                      name="theme-choice"
                      value={r.themeId}
                      checked={checked}
                      onChange={() => setChoice(r.themeId)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold">
                          {i === 0 ? <span className="sr-only">Le plus probable : </span> : null}
                          {r.themeName}
                        </span>
                        <span className="text-sm font-semibold tabular-nums">Confiance {pct} %</span>
                      </span>
                      <Meter
                        className="mt-2"
                        value={r.confidence}
                        label={`Confiance pour ${r.themeName}`}
                        valueText={`${pct} %`}
                      />
                      {r.rationale ? <span className="mt-2 block text-sm text-muted">{r.rationale}</span> : null}
                      {theme && !theme.hasSkeleton ? (
                        <span className="mt-2 block text-sm font-medium text-warning">
                          Pas de squelette pour ce thème : la génération partira de zéro.
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}

              <div
                className={`rounded-lg border p-4 ${choice === OTHER ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border"}`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="theme-choice"
                    value={OTHER}
                    checked={choice === OTHER}
                    onChange={() => {
                      setChoice(OTHER);
                      if (!otherThemeId) setOtherThemeId(themes[0]?.id ?? "");
                    }}
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="font-semibold">Un autre thème du programme</span>
                </label>
                {choice === OTHER ? (
                  <div className="mt-3 pl-7">
                    <label htmlFor={ids.other} className="text-sm font-semibold">
                      Thème
                    </label>
                    <select
                      id={ids.other}
                      className="input mt-1"
                      value={otherThemeId}
                      onChange={(e) => setOtherThemeId(e.target.value)}
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
        </section>
      ) : null}

      {/* Étape 3 */}
      {result ? (
        <section aria-labelledby={ids.s3} className="card p-5 sm:p-6">
          <StepTitle n={3} id={ids.s3}>
            Le diaporama
          </StepTitle>
          {selectedTheme ? (
            <p className="mt-3">
              Deck complet avec notes d&apos;orateur pour le thème <strong>{selectedTheme.name}</strong>
              {selectedTheme.hasSkeleton ? ", à partir de son squelette." : "."}
            </p>
          ) : null}
          {selectedTheme && !selectedTheme.hasSkeleton ? (
            <p className="mt-2 rounded-lg border border-warning/60 bg-warning-soft px-3 py-2 text-sm">
              <strong className="text-warning">Ce thème n&apos;a pas de squelette.</strong> La génération fonctionne
              quand même, mais sans votre travail de préparation.
            </p>
          ) : null}

          <div className="mt-4">
            <button
              type="button"
              className="btn btn-primary min-h-12 px-6 text-base"
              onClick={generate}
              disabled={generating || !selectedThemeId}
              aria-describedby={generating ? `${ids.s3}-progress` : undefined}
            >
              {generating ? "Génération en cours…" : "Générer le diaporama"}
            </button>
          </div>

          <div ref={generatingRef} tabIndex={-1} role="status" aria-live="polite" className="mt-4 focus:outline-none">
            {generation.kind === "running" ? (
              <div id={`${ids.s3}-progress`} className="rounded-lg border border-accent/40 bg-accent-soft p-4">
                <p className="font-semibold text-accent-strong">
                  Génération du diaporama en cours. Cela prend en général 1 à 3 minutes.
                </p>
                <p className="mt-1 text-sm">
                  Ne fermez pas cette page : vous serez redirigé vers le deck dès qu&apos;il sera prêt. En attendant,
                  relisez votre problématique et préparez votre plan.
                </p>
                <p className="mt-2 text-sm" aria-hidden="true">
                  Temps écoulé : <ElapsedTime since={generation.startedAt} />
                </p>
              </div>
            ) : null}
          </div>
          <div role="alert">
            {generation.kind === "error" ? (
              <div className="mt-2 rounded-lg border border-danger/40 bg-danger-soft p-4 text-danger">
                <p className="font-semibold">{generation.message}</p>
                <p className="mt-1 text-sm">Votre problématique et votre choix sont conservés : relancez la génération.</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
