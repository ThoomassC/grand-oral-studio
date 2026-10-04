"use client";

import { Notice } from "@/components/ui/Notice";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Badge, type BadgeTone, Button } from "@thomascaron/opale-ui";
import { useState, useTransition } from "react";
import type { PromptTemplate } from "@/domain/schemas";
import { generateAllSkeletons, generateSkeleton } from "@/server/actions/generation";
import { SlidePreview, type SlideBrand, type SlidePreviewData } from "@/components/slides/SlidePreview";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { ElapsedTime } from "@/components/ui/ElapsedTime";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { EngineBadge, type DeckEngine } from "@/components/decks/EngineBadge";

export interface SkeletonThemeItem {
  id: string;
  name: string;
  skeleton: {
    deckId: string;
    engine: DeckEngine | null;
    slideCount: number;
    updatedAtLabel: string;
    cover: SlidePreviewData;
    /** Le squelette ne suit plus le gabarit actuel (raison affichable) ; null s'il est à jour. */
    staleReason: string | null;
  } | null;
}

type RunState = { kind: "running" } | { kind: "error"; message: string } | { kind: "done"; warnings: string[] };
type Display = "running" | "error" | "ready" | "stale" | "todo";
type BatchMode = "missing" | "all";

const NETWORK_ERROR = "La connexion a été interrompue. Relancez la génération.";

const STATUS_LABEL: Record<Display, string> = {
  running: "En cours",
  error: "Erreur",
  ready: "Généré",
  stale: "À régénérer",
  todo: "À générer",
};

const STATUS_TONE: Record<Display, BadgeTone> = {
  running: "info",
  error: "error",
  ready: "success",
  stale: "warning",
  todo: "neutral",
};

function StatusIcon({ kind }: { kind: Display }) {
  const common = { viewBox: "0 0 16 16", "aria-hidden": true } as const;
  switch (kind) {
    case "ready":
      return (
        <svg {...common} className="h-3.5 w-3.5">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "error":
    case "stale":
      return (
        <svg {...common} className="h-3.5 w-3.5">
          <path d="M8 3.5v5.5M8 12v.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "running":
      return (
        <svg {...common} className="h-3.5 w-3.5 animate-spin">
          <path d="M8 2a6 6 0 1 1-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="h-3.5 w-3.5">
          <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.5 2" />
        </svg>
      );
  }
}

const regenButtonId = (themeId: string) => `regen-${themeId}`;
const REGEN_ALL_ID = "skeletons-regen-all";
const MISSING_ID = "skeletons-generate-missing";

export function SkeletonBoard({
  programId,
  themes,
  brand,
  format,
}: {
  programId: string;
  themes: SkeletonThemeItem[];
  brand: SlideBrand;
  format: PromptTemplate["format"];
}) {
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [batch, setBatch] = useState<{
    running: boolean;
    count: number;
    startedAt: number;
    summary: string | null;
    error: string | null;
  }>({ running: false, count: 0, startedAt: 0, summary: null, error: null });
  const [announce, setAnnounce] = useState("");
  const [, startTransition] = useTransition();

  const missing = themes.filter((t) => t.skeleton === null);
  const readyCount = themes.length - missing.length;
  const failed = themes.filter((t) => runs[t.id]?.kind === "error");
  const anyRunning = batch.running || Object.values(runs).some((r) => r.kind === "running");

  function displayOf(theme: SkeletonThemeItem): Display {
    const run = runs[theme.id];
    if (run?.kind === "running") return "running";
    if (run?.kind === "error") return "error";
    if (!theme.skeleton) return "todo";
    // Régénéré à l'instant : à jour, même avant le rafraîchissement de la page.
    if (run?.kind === "done") return "ready";
    return theme.skeleton.staleReason ? "stale" : "ready";
  }

  function runBatch(mode: BatchMode) {
    const targets = mode === "missing" ? missing : themes;
    if (anyRunning || targets.length === 0) return;
    // Le bouton « manquants » disparaît quand tout est généré : on ne perd pas le focus.
    const hadFocus = document.activeElement?.id === MISSING_ID;
    setRuns((r) => ({ ...r, ...Object.fromEntries(targets.map((t) => [t.id, { kind: "running" } satisfies RunState])) }));
    setBatch({ running: true, count: targets.length, startedAt: Date.now(), summary: null, error: null });
    setAnnounce(
      `Génération de ${targets.length} squelette${targets.length > 1 ? "s" : ""} lancée. Cela peut prendre plusieurs minutes.`,
    );
    startTransition(async () => {
      const reset = () =>
        setRuns((r) => {
          const next = { ...r };
          for (const t of targets) delete next[t.id];
          return next;
        });
      let result: Awaited<ReturnType<typeof generateAllSkeletons>>;
      try {
        result = await generateAllSkeletons(programId, mode);
      } catch {
        reset();
        setBatch({ running: false, count: 0, startedAt: 0, summary: null, error: NETWORK_ERROR });
        setAnnounce(NETWORK_ERROR);
        return;
      }
      if (!result.ok) {
        reset();
        setBatch({ running: false, count: 0, startedAt: 0, summary: null, error: result.error });
        setAnnounce(`La génération a échoué : ${result.error}`);
        return;
      }
      const next: Record<string, RunState> = {};
      for (const item of result.data) {
        next[item.themeId] = item.ok ? { kind: "done", warnings: item.warnings } : { kind: "error", message: item.error };
      }
      const ok = result.data.filter((r) => r.ok).length;
      const ko = result.data.length - ok;
      const summary =
        result.data.length === 0
          ? "Aucun squelette à générer."
          : ko === 0
            ? `${ok} squelette${ok > 1 ? "s" : ""} généré${ok > 1 ? "s" : ""}.`
            : `${ok} généré${ok > 1 ? "s" : ""}, ${ko} en échec. Relancez les thèmes en erreur un par un.`;
      setRuns((r) => ({ ...r, ...next }));
      setBatch({ running: false, count: 0, startedAt: 0, summary, error: null });
      setAnnounce(`Génération terminée : ${summary}`);
      if (hadFocus) focusLater([MISSING_ID, REGEN_ALL_ID]);
    });
  }

  function runOne(theme: SkeletonThemeItem) {
    if (runs[theme.id]?.kind === "running" || batch.running) return;
    setRuns((r) => ({ ...r, [theme.id]: { kind: "running" } }));
    setAnnounce(`Génération du squelette « ${theme.name} » lancée.`);
    startTransition(async () => {
      try {
        const result = await generateSkeleton(theme.id);
        if (!result.ok) {
          setRuns((r) => ({ ...r, [theme.id]: { kind: "error", message: result.error } }));
          setAnnounce(`Échec pour « ${theme.name} » : ${result.error}`);
          return;
        }
        setRuns((r) => ({ ...r, [theme.id]: { kind: "done", warnings: result.data.warnings } }));
        setAnnounce(`Squelette « ${theme.name} » généré.`);
      } catch {
        setRuns((r) => ({ ...r, [theme.id]: { kind: "error", message: NETWORK_ERROR } }));
        setAnnounce(`Échec pour « ${theme.name} » : ${NETWORK_ERROR}`);
      }
    });
  }

  if (themes.length === 0) {
    return (
      <div className="opale-card opale-card--e0 block border-dashed border-border-strong p-6">
        <h2 className="font-display text-lg font-semibold">Aucun thème à préparer</h2>
        <p className="mt-1 text-muted">Ajoutez d&apos;abord les thèmes du projet : un squelette sera généré pour chacun.</p>
        <ButtonLink href={`/projets/${programId}`} className="mt-4">
          Ajouter des thèmes
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-2xl">Squelettes</h2>
          <p className="text-sm text-muted">
            Un diaporama générique par thème, à relire et compléter avant le jour J. Le deck final s&apos;appuie dessus.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2 md:justify-end">
          {missing.length > 0 ? (
            <Button
              id={MISSING_ID}
              type="button"
              onClick={() => runBatch("missing")}
              aria-disabled={anyRunning || undefined}
            >
              {batch.running ? "Génération en cours…" : `Générer les squelettes manquants (${missing.length})`}
            </Button>
          ) : null}
          {readyCount > 0 ? (
            <ConfirmAction
              triggerId={REGEN_ALL_ID}
              triggerLabel="Régénérer tous les squelettes"
              title="Régénérer tous les squelettes ?"
              triggerVariant="ghost"
              size="medium"
              triggerDisabled={anyRunning}
              question={`Remplacer les ${readyCount} squelette${readyCount > 1 ? "s" : ""} existant${readyCount > 1 ? "s" : ""}, y compris vos modifications ?`}
              confirmLabel="Remplacer les squelettes"
              pendingLabel="Lancement…"
              onConfirm={async () => {
                runBatch("all");
                return null;
              }}
              onDone={() => focusLater([REGEN_ALL_ID])}
            />
          ) : null}
        </div>
      </div>

      <LiveRegion className="sr-only">{announce}</LiveRegion>

      {batch.running ? (
        <Notice tone="info">
          <p className="font-semibold text-accent-strong">
            Génération de {batch.count} squelette{batch.count > 1 ? "s" : ""}, trois à la fois.
          </p>
          <p className="mt-1 text-sm">
            Cela peut prendre plusieurs minutes. Restez sur cette page : le résultat de chaque thème s&apos;affichera à la
            fin. Temps écoulé : <ElapsedTime since={batch.startedAt} />
          </p>
        </Notice>
      ) : null}
      {batch.summary ? (
        <div
          className={`rounded-lg border p-4 ${failed.length > 0 ? "border-warning/60 bg-warning-soft" : "border-success/40 bg-success-soft"}`}
        >
          <p className="font-semibold">{batch.summary}</p>
          {failed.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {failed.map((t) => {
                const run = runs[t.id];
                return (
                  <li key={t.id}>
                    {t.name} : {run?.kind === "error" ? run.message : ""}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      <LiveRegion role="alert">
        {batch.error ? (
          <Notice tone="error">
            <p className="font-semibold">{batch.error}</p>
          </Notice>
        ) : null}
      </LiveRegion>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {themes.map((theme) => {
          const display = displayOf(theme);
          const run = runs[theme.id];
          const busy = display === "running" || batch.running;
          return (
            <li key={theme.id} className="opale-card opale-card--e1 flex flex-col gap-0 overflow-hidden p-0">
              <div className="border-b border-border bg-surface-2 p-4">
                {theme.skeleton ? (
                  <SlidePreview slide={theme.skeleton.cover} brand={brand} format={format} clamp decorative />
                ) : (
                  <div
                    className="flex items-center justify-center rounded-md border border-dashed border-border-strong text-sm text-muted"
                    style={{ aspectRatio: format === "4:3" ? "4 / 3" : "16 / 9" }}
                  >
                    Pas encore de squelette
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg">{theme.name}</h3>
                  <Badge tone={STATUS_TONE[display]} className="shrink-0">
                    <StatusIcon kind={display} />
                    {STATUS_LABEL[display]}
                  </Badge>
                </div>
                {theme.skeleton?.engine ? <EngineBadge engine={theme.skeleton.engine} className="self-start" /> : null}
                {theme.skeleton ? (
                  <p className="text-sm text-muted">
                    <span className="num font-semibold text-text">{theme.skeleton.slideCount} diapos</span> ·{" "}
                    {theme.skeleton.updatedAtLabel}
                  </p>
                ) : null}
                {display === "stale" && theme.skeleton?.staleReason ? (
                  <p className="text-sm text-warning">{theme.skeleton.staleReason}</p>
                ) : null}
                {run?.kind === "error" ? <p className="text-sm font-medium text-danger">{run.message}</p> : null}
                {run?.kind === "done" && run.warnings.length > 0 ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-warning">
                      {run.warnings.length} écart{run.warnings.length > 1 ? "s" : ""} au gabarit
                    </summary>
                    <ul className="mt-1 list-disc pl-5 text-muted">
                      {run.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="mt-auto flex flex-wrap items-start gap-2">
                  {theme.skeleton ? (
                    <ButtonLink
                      href={`/projets/${programId}/squelettes/${theme.skeleton.deckId}`}
                      variant="ghost" size="small"
                    >
                      Ouvrir<span className="sr-only"> le squelette {theme.name}</span>
                    </ButtonLink>
                  ) : null}
                  {theme.skeleton && display !== "error" ? (
                    <ConfirmAction
                      triggerId={regenButtonId(theme.id)}
                      triggerLabel={display === "running" ? "Génération…" : "Régénérer"}
                      triggerAccessibleLabel={
                        display === "running" ? `Génération du squelette ${theme.name} en cours` : `Régénérer le squelette ${theme.name}`
                      }
                      triggerVariant="text"
                      triggerDisabled={busy}
                      title="Régénérer le squelette ?"
                      question={`Remplacer le squelette de « ${theme.name} », y compris vos modifications ?`}
                      confirmLabel="Remplacer le squelette"
                      pendingLabel="Lancement…"
                      onConfirm={async () => {
                        runOne(theme);
                        return null;
                      }}
                      onDone={() => focusLater([regenButtonId(theme.id)])}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost" size="small"
                      onClick={() => runOne(theme)}
                      aria-disabled={busy || undefined}
                    >
                      {display === "running" ? "Génération…" : display === "error" ? "Relancer" : "Générer"}
                      <span className="sr-only"> le squelette {theme.name}</span>
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
