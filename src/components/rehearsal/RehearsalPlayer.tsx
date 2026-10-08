"use client";

import { Badge, Button, type BadgeTone } from "@thomascaron/opale-ui";
import { useEffect, useEffectEvent, useId, useState } from "react";
import { formatDelta, MAX_REHEARSAL_SECONDS, summarizeRehearsal } from "@/domain/rehearsal";
import { NOTES_TIMING } from "@/domain/deck";
import type { PromptTemplate, SlideLayout } from "@/domain/schemas";
import { formatSeconds } from "@/domain/slides";
import { SlidePreview, type SlideBrand } from "@/components/slides/SlidePreview";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { saveRehearsal } from "@/server/actions/practice";

/** Diapo telle que la répétition l'affiche : rien d'autre ne traverse vers le client. */
export interface RehearsalSlide {
  layout: SlideLayout;
  title: string;
  subtitle: string;
  bullets: string[];
  notes: string;
}

type Phase = "ready" | "running" | "paused" | "done";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "skipped"; message: string };

/** Rafraîchissement de l'affichage du minuteur (le temps compté vient de Date.now(), pas du nombre de tics). */
const TICK_MS = 250;

/**
 * Horodatage courant, rafraîchi tant que `active` : synchronisation avec
 * l'horloge (timer), nettoyée à l'arrêt ou au démontage.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

/** Notes à dire, sans le repère de minutage de tête (le minuteur l'affiche déjà). */
const spokenNotes = (notes: string) => notes.replace(NOTES_TIMING, "").trim();

/** Secondes entières d'une durée en millisecondes. */
const toSeconds = (ms: number) => Math.round(Math.max(0, ms) / 1000);

/** Ton du badge d'écart : en avance ou à l'heure, léger dépassement, dépassement au-delà de la tolérance du bilan. */
function deltaTone(planned: number, actual: number): BadgeTone {
  if (actual <= planned) return "success";
  return summarizeRehearsal([planned], [actual]).overruns.length > 0 ? "danger" : "warning";
}

/** Une touche tapée dans un champ, ou Espace / Entrée sur un contrôle, garde son effet natif. */
function isNativeTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("input, textarea, select")) return true;
  return (event.key === " " || event.key === "Enter") && target.closest("button, a, summary") !== null;
}

/**
 * Mode répétition d'un diaporama : une diapo à la fois avec ses notes en grand,
 * minuteur global et par diapo comparés au minutage prévu (`planned`), écart en
 * direct, navigation par boutons, vignettes et clavier (flèches, Espace, Page
 * précédente / suivante). « Terminer » affiche le bilan et enregistre la
 * répétition ; « Recommencer » repart de la première diapo.
 *
 * Le temps de chaque diapo est cumulé à chaque changement de diapo (horodatages
 * Date.now()) : un onglet en arrière-plan, dont les minuteurs ralentissent, ne
 * fausse pas le compte. La pause ne compte pas.
 */
export function RehearsalPlayer({
  deckId,
  deckTitle,
  slides,
  planned,
  brand,
  format,
  backHref,
}: {
  deckId: string;
  deckTitle: string;
  slides: RehearsalSlide[];
  /** Secondes prévues par diapo (plannedSecondsPerSlide), même longueur que `slides`. */
  planned: number[];
  brand: SlideBrand;
  format: PromptTemplate["format"];
  /** Page du diaporama (retour). */
  backHref: string;
}) {
  const baseId = useId();
  const count = slides.length;
  const zeros = () => slides.map(() => 0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [current, setCurrent] = useState(0);
  /** Millisecondes déjà comptées par diapo (segments terminés). */
  const [spent, setSpent] = useState<number[]>(zeros);
  /** Début du segment en cours (diapo `current`), ou null hors chronométrage. */
  const [segmentStart, setSegmentStart] = useState<number | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const now = useNow(phase === "running");

  const ids = {
    position: `${baseId}-position`,
    next: `${baseId}-next`,
    start: `${baseId}-start`,
    summary: `${baseId}-summary`,
  };

  // Valeurs dérivées, recalculées à chaque rendu.
  const live = segmentStart === null ? 0 : Math.max(0, now - segmentStart);
  const slideSeconds = toSeconds((spent[current] ?? 0) + live);
  const totalSeconds = toSeconds(spent.reduce((a, b) => a + b, 0) + live);
  const plannedTotal = planned.reduce((a, b) => a + b, 0);
  const plannedSlide = planned[current] ?? 0;
  const slide = slides[current];

  /** Temps par diapo, segment en cours compris, arrêté à `at`. */
  function settle(at: number): number[] {
    if (segmentStart === null) return spent;
    return spent.map((value, i) => (i === current ? value + Math.max(0, at - segmentStart) : value));
  }

  function goTo(index: number) {
    if (phase === "done" || index < 0 || index >= count || index === current) return;
    if (phase === "running") {
      const at = Date.now();
      setSpent(settle(at));
      setSegmentStart(at);
    }
    setCurrent(index);
  }

  function start() {
    setSpent(zeros());
    setSegmentStart(Date.now());
    setPhase("running");
    setSave({ kind: "idle" });
    focusLater([ids.next]);
  }

  function pause() {
    setSpent(settle(Date.now()));
    setSegmentStart(null);
    setPhase("paused");
  }

  function resume() {
    setSegmentStart(Date.now());
    setPhase("running");
  }

  async function persist(perSlideMs: number[]) {
    const perSlide = perSlideMs.map(toSeconds);
    const total = toSeconds(perSlideMs.reduce((a, b) => a + b, 0));
    if (total < 1) {
      setSave({ kind: "skipped", message: "Répétition trop courte pour être enregistrée (moins d'une seconde)." });
      return;
    }
    if (total > MAX_REHEARSAL_SECONDS) {
      setSave({ kind: "skipped", message: "Répétition trop longue pour être enregistrée (plus de 2 heures)." });
      return;
    }
    setSave({ kind: "saving" });
    try {
      const result = await saveRehearsal(deckId, { totalSeconds: total, perSlide });
      setSave(result.ok ? { kind: "saved" } : { kind: "error", message: result.error });
    } catch {
      // Réseau coupé ou serveur injoignable : sans réponse, on ne sait pas si l'enregistrement
      // a abouti. Le bilan reste affiché, avec « Réessayer l'enregistrement ».
      setSave({ kind: "error", message: "La connexion a été interrompue : la répétition n'a peut-être pas été enregistrée." });
    }
  }

  function finish() {
    const final = settle(Date.now());
    setSpent(final);
    setSegmentStart(null);
    setPhase("done");
    focusLater([ids.summary]);
    void persist(final);
  }

  function restart() {
    setPhase("ready");
    setCurrent(0);
    setSpent(zeros());
    setSegmentStart(null);
    setSave({ kind: "idle" });
    focusLater([ids.start]);
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (phase === "done" || event.altKey || event.ctrlKey || event.metaKey || isNativeTarget(event)) return;
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      goTo(current + 1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      goTo(current - 1);
    }
  });

  // Synchronisation avec le clavier du document (raccourcis de présentation).
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (phase === "done") {
    const perSlide = spent.map(toSeconds);
    const summary = summarizeRehearsal(planned, perSlide);
    return (
      <RehearsalSummary
        headingId={ids.summary}
        slides={slides}
        planned={planned}
        actual={perSlide}
        summary={summary}
        save={save}
        onRetry={() => void persist(spent)}
        onRestart={restart}
        backHref={backHref}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        role="group"
        aria-label="Minuteurs"
        className="opale-card opale-card--e1 flex flex-wrap items-center gap-x-8 gap-y-3 p-4 sm:p-5"
      >
        <p className="flex flex-col">
          <span className="text-sm text-muted">Temps total</span>
          <span className="text-2xl font-bold">
            <span className="num tabular-nums">{formatSeconds(totalSeconds)}</span>
            <span className="text-base font-normal text-muted">
              {" "}
              / prévu <span className="num">{formatSeconds(plannedTotal)}</span>
            </span>
          </span>
        </p>
        <p className="flex flex-col">
          <span className="text-sm text-muted">Cette diapo</span>
          <span className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            <span className="num tabular-nums">{formatSeconds(slideSeconds)}</span>
            <span className="text-base font-normal text-muted">
              / prévu <span className="num">{formatSeconds(plannedSlide)}</span>
            </span>
            {phase === "ready" ? null : (
              <Badge tone={deltaTone(plannedSlide, slideSeconds)}>
                <span className="sr-only">Écart sur cette diapo : </span>
                {formatDelta(slideSeconds - plannedSlide)}
              </Badge>
            )}
          </span>
        </p>
        {phase === "paused" ? <Badge tone="neutral">En pause</Badge> : null}
      </div>

      {slide ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p id={ids.position} className="mb-2 text-sm font-semibold text-muted">
              Diapo {current + 1} sur {count}
            </p>
            <SlidePreview
              slide={slide}
              brand={brand}
              format={format}
              number={current + 1}
              deckTitle={deckTitle}
            />
          </div>
          <section aria-labelledby={`${baseId}-notes`} className="opale-card opale-card--e0 block p-4 sm:p-6">
            <h3 id={`${baseId}-notes`} className="text-sm font-semibold text-muted">
              Notes d&apos;orateur
            </h3>
            {spokenNotes(slide.notes) ? (
              <p className="mt-2 text-xl leading-relaxed whitespace-pre-line">{spokenNotes(slide.notes)}</p>
            ) : (
              <p className="mt-2 text-muted">Aucune note pour cette diapo.</p>
            )}
          </section>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {phase === "ready" ? (
          <Button id={ids.start} type="button" onClick={start}>
            Commencer la répétition
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => goTo(current - 1)}
              aria-disabled={current === 0 || undefined}
            >
              Précédente
            </Button>
            <Button
              id={ids.next}
              type="button"
              onClick={() => goTo(current + 1)}
              aria-disabled={current === count - 1 || undefined}
            >
              Suivante
            </Button>
            {phase === "paused" ? (
              <Button type="button" variant="ghost" onClick={resume}>
                Reprendre
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={pause}>
                Pause
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={finish}>
              Terminer
            </Button>
          </>
        )}
        <p className="text-sm text-muted">Clavier : flèches ou Espace pour changer de diapo.</p>
      </div>

      <nav aria-label="Diapos du diaporama">
        <ol className="flex gap-3 overflow-x-auto pb-2">
          {slides.map((s, index) => (
            <li key={index} className="w-28 shrink-0">
              <button
                type="button"
                onClick={() => goTo(index)}
                aria-current={index === current ? "step" : undefined}
                className={`block w-full rounded-md border-2 p-1 text-left ${
                  index === current ? "border-primary" : "border-transparent hover:border-border-strong"
                }`}
              >
                <span className="sr-only">
                  Diapo {index + 1} : {s.title}
                </span>
                <SlidePreview slide={s} brand={brand} format={format} clamp decorative />
                <span aria-hidden="true" className="num mt-1 block text-center text-xs text-muted">
                  {index + 1}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

function RehearsalSummary({
  headingId,
  slides,
  planned,
  actual,
  summary,
  save,
  onRetry,
  onRestart,
  backHref,
}: {
  headingId: string;
  slides: RehearsalSlide[];
  planned: number[];
  actual: number[];
  summary: ReturnType<typeof summarizeRehearsal>;
  save: SaveState;
  onRetry: () => void;
  onRestart: () => void;
  backHref: string;
}) {
  const overrunsId = `${headingId}-overruns`;
  const saving = save.kind === "saving";
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h3 id={headingId} tabIndex={-1} className="text-xl focus:outline-none">
        Bilan de la répétition
      </h3>

      <dl className="opale-card opale-card--e1 grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
        <div>
          <dt className="text-sm text-muted">Durée</dt>
          <dd className="num text-2xl font-bold">{formatSeconds(summary.totalSeconds)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Prévu</dt>
          <dd className="num text-2xl font-bold">{formatSeconds(summary.plannedTotal)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Écart</dt>
          <dd className="num text-2xl font-bold">{formatDelta(summary.totalDelta)}</dd>
        </div>
      </dl>

      <div>
        <h4 id={overrunsId} className="font-semibold">
          Diapos en dépassement
        </h4>
        {summary.overruns.length > 0 ? (
          <ul aria-labelledby={overrunsId} className="mt-2 list-disc space-y-1 pl-5">
            {summary.overruns.map(({ index, delta }) => (
              <li key={index}>
                Diapo {index + 1} · {slides[index]?.title} : <span className="num font-semibold">{formatDelta(delta)}</span>
                <span className="text-muted">
                  {" "}
                  ({formatSeconds(actual[index] ?? 0)} pour {formatSeconds(planned[index] ?? 0)} prévues)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">Aucune diapo en dépassement : le rythme est tenu.</p>
        )}
      </div>

      <LiveRegion className="text-sm font-medium text-success">
        {save.kind === "saved" ? "Répétition enregistrée." : saving ? "Enregistrement de la répétition…" : null}
      </LiveRegion>
      <LiveRegion role="alert" className="text-sm font-medium text-danger">
        {save.kind === "error" ? save.message : null}
      </LiveRegion>
      {save.kind === "skipped" ? <p className="text-sm text-muted">{save.message}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onRestart}>
          Recommencer
        </Button>
        {save.kind === "error" ? (
          <Button type="button" variant="ghost" onClick={onRetry}>
            Réessayer l&apos;enregistrement
          </Button>
        ) : null}
        <ButtonLink href={backHref} variant="ghost">
          Retour au diaporama
        </ButtonLink>
      </div>
    </section>
  );
}
