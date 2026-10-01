"use client";

import { Notice } from "@/components/ui/Notice";
import { Button } from "@thomascaron/opale-ui";
import { useOptimistic, useState, useTransition } from "react";
import type { ThemeInput } from "@/domain/schemas";
import { addTheme, deleteTheme, reorderThemes, updateTheme } from "@/server/actions/themes";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { ThemeForm } from "./ThemeForm";
import { ThemeImport } from "./ThemeImport";

export interface ThemeItem {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  hasSkeleton: boolean;
  /** Nombre de diaporamas du jour J rattachés au thème (supprimés avec lui). */
  finalDeckCount: number;
}

const IDS = {
  addButton: "themes-add-button",
  importButton: "themes-import-button",
  addName: "themes-add-name",
  importText: "themes-import-text",
  listTitle: "themes-list-title",
};

const moveButtonId = (themeId: string, dir: "up" | "down") => `move-${dir}-${themeId}`;
const editButtonId = (themeId: string) => `edit-${themeId}`;

function deleteQuestion(theme: ThemeItem): { question: string; confirm: string } {
  const parts = [theme.hasSkeleton ? "son squelette" : null];
  const n = theme.finalDeckCount;
  if (n > 0) parts.push(`${n === 1 ? "son diaporama" : `ses ${n} diaporamas`} du jour J`);
  const what = parts.filter(Boolean).join(" et ");
  return {
    question: `Supprimer « ${theme.name} »${what ? `, ${what}` : ""} ? Cette action est définitive.`,
    confirm: n > 0 ? `Supprimer le thème et ${n === 1 ? "son diaporama" : "ses diaporamas"}` : "Supprimer le thème",
  };
}

function ArrowIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d={dir === "up" ? "M8 13V3M3.5 7.5L8 3l4.5 4.5" : "M8 3v10M3.5 8.5L8 13l4.5-4.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeManager({ programId, themes }: { programId: string; themes: ThemeItem[] }) {
  const [optimisticThemes, setOptimisticThemes] = useOptimistic(themes);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "add" | "import">(themes.length === 0 ? "add" : "none");
  const [announce, setAnnounce] = useState("");
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function openPanel(next: "add" | "import") {
    if (panel === next) {
      closePanel();
      return;
    }
    setPanel(next);
    focusLater([next === "add" ? IDS.addName : IDS.importText]);
  }

  function closePanel() {
    const from = panel;
    setPanel("none");
    focusLater([from === "import" ? IDS.importButton : IDS.addButton]);
  }

  function closeEditor(themeId: string) {
    setEditingId(null);
    focusLater([editButtonId(themeId)]);
  }

  function move(index: number, dir: "up" | "down") {
    const target = dir === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= optimisticThemes.length) return;
    const next = [...optimisticThemes];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setReorderError(null);
    setAnnounce(`« ${moved.name} » déplacé en position ${target + 1} sur ${next.length}.`);

    // Le bouton déplacé change de place dans le DOM : on lui rend le focus,
    // ou à son voisin s'il devient inactif (premier / dernier rang).
    const atEdge = target === 0 || target === next.length - 1;
    const focusDir = atEdge ? (dir === "up" ? "down" : "up") : dir;
    focusLater([moveButtonId(moved.id, focusDir)]);

    startTransition(async () => {
      setOptimisticThemes(next);
      try {
        const result = await reorderThemes(
          programId,
          next.map((t) => t.id),
        );
        if (!result.ok) {
          setReorderError(`Le nouvel ordre n'a pas été enregistré : ${result.error}`);
          setAnnounce("");
        }
      } catch {
        setReorderError("Le nouvel ordre n'a pas été enregistré : la connexion a été interrompue. Réessayez.");
        setAnnounce("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={IDS.listTitle} tabIndex={-1} className="text-2xl focus:outline-none">
            Thèmes
          </h2>
          <p className="text-sm text-muted">
            L&apos;ordre des thèmes est celui de votre projet. Les mots-clés aident l&apos;IA à reconnaître le
            thème d&apos;une problématique.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id={IDS.addButton}
            variant={panel === "add" ? "ghost" : "primary"}
            aria-expanded={panel === "add"}
            aria-controls={panel === "add" ? "panel-ajout-theme" : undefined}
            onClick={() => openPanel("add")}
          >
            Ajouter un thème
          </Button>
          <Button
            id={IDS.importButton}
            type="button"
            variant="ghost"
            aria-expanded={panel === "import"}
            aria-controls={panel === "import" ? "panel-import-themes" : undefined}
            onClick={() => openPanel("import")}
          >
            Importer une liste
          </Button>
        </div>
      </div>

      {panel === "add" ? (
        <section id="panel-ajout-theme" aria-labelledby="titre-ajout-theme" className="opale-card opale-card--e1 block p-5">
          <h3 id="titre-ajout-theme" className="text-lg font-semibold">
            Nouveau thème
          </h3>
          <div className="mt-4">
            <ThemeForm
              nameId={IDS.addName}
              submitLabel="Ajouter le thème"
              pendingLabel="Ajout…"
              successMessage="Thème ajouté. Vous pouvez en saisir un autre."
              resetOnSuccess
              onSubmit={(value: ThemeInput) => addTheme(programId, value)}
              onCancel={closePanel}
            />
          </div>
        </section>
      ) : null}

      {panel === "import" ? (
        <section id="panel-import-themes" aria-labelledby="titre-import-themes" className="opale-card opale-card--e1 block p-5">
          <h3 id="titre-import-themes" className="text-lg font-semibold">
            Importer des thèmes
          </h3>
          <ThemeImport programId={programId} textareaId={IDS.importText} onClose={closePanel} />
        </section>
      ) : null}

      <LiveRegion>{announce}</LiveRegion>
      <LiveRegion role="alert">
        {reorderError ? (
          <Notice tone="error">
            {reorderError}
          </Notice>
        ) : null}
      </LiveRegion>

      {optimisticThemes.length === 0 ? (
        <div className="opale-card opale-card--e0 block border-dashed border-border-strong p-6">
          <p className="font-display text-lg font-semibold">Aucun thème</p>
          <p className="mt-1 text-muted">
            Ajoutez les thèmes de votre projet un par un, ou importez-les en une fois depuis une liste.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Thèmes du projet">
          {optimisticThemes.map((theme, index) => {
            const neighbour = optimisticThemes[index + 1] ?? optimisticThemes[index - 1];
            const { question, confirm } = deleteQuestion(theme);
            return (
              <li key={theme.id} className="opale-card opale-card--e1 block p-4 pt-6 sm:p-5 sm:pt-7">
                {editingId === theme.id ? (
                  <section aria-label={`Modifier ${theme.name}`}>
                    <ThemeForm
                      nameId={`edit-name-${theme.id}`}
                      initial={{ name: theme.name, description: theme.description, keywords: theme.keywords }}
                      submitLabel="Enregistrer le thème"
                      pendingLabel="Enregistrement…"
                      onSubmit={(value) => updateTheme(theme.id, value)}
                      onSaved={(name) => {
                        setAnnounce(`Thème « ${name} » enregistré.`);
                        closeEditor(theme.id);
                      }}
                      onCancel={() => closeEditor(theme.id)}
                    />
                  </section>
                ) : (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className="num flex h-8 min-w-8 shrink-0 items-center justify-center rounded-sm border border-border-strong px-1 text-sm font-bold"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="pt-1 text-lg">
                          <span className="sr-only">Thème {index + 1} : </span>
                          {theme.name}
                        </h3>
                        {theme.description ? <p className="mt-1 text-muted">{theme.description}</p> : null}
                        {theme.keywords.length > 0 ? (
                          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Mots-clés">
                            {theme.keywords.map((kw) => (
                              <li key={kw} className="rounded-sm bg-surface-2 px-2 py-0.5 text-sm ring-1 ring-inset ring-border">
                                {kw}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <p className="mt-2 text-sm text-muted">
                          Squelette : {theme.hasSkeleton ? "généré" : "à générer"}
                          {theme.finalDeckCount > 0
                            ? ` · ${theme.finalDeckCount} diaporama${theme.finalDeckCount > 1 ? "s" : ""} du jour J`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start gap-2 sm:justify-end">
                      <div className="flex gap-1" role="group" aria-label={`Ordre de ${theme.name}`}>
                        <Button
                          id={moveButtonId(theme.id, "up")}
                          type="button"
                          variant="ghost" className="opale-icon-action-button"
                          onClick={() => move(index, "up")}
                          disabled={index === 0}
                          aria-label={`Monter ${theme.name}`}
                        >
                          <ArrowIcon dir="up" />
                        </Button>
                        <Button
                          id={moveButtonId(theme.id, "down")}
                          type="button"
                          variant="ghost" className="opale-icon-action-button"
                          onClick={() => move(index, "down")}
                          disabled={index === optimisticThemes.length - 1}
                          aria-label={`Descendre ${theme.name}`}
                        >
                          <ArrowIcon dir="down" />
                        </Button>
                      </div>
                      <Button
                        id={editButtonId(theme.id)}
                        type="button"
                        variant="ghost" size="small"
                        onClick={() => {
                          setEditingId(theme.id);
                          focusLater([`edit-name-${theme.id}`]);
                        }}
                        aria-label={`Modifier ${theme.name}`}
                      >
                        Modifier
                      </Button>
                      <ConfirmAction
                        triggerLabel="Supprimer"
                        triggerAccessibleLabel={`Supprimer ${theme.name}`}
                        question={question}
                        confirmLabel={confirm}
                        onConfirm={async () => {
                          const result = await deleteTheme(theme.id);
                          if (result.ok) setAnnounce(`Thème « ${theme.name} » supprimé.`);
                          return result.ok ? null : result.error;
                        }}
                        onDone={() =>
                          focusLater([neighbour ? editButtonId(neighbour.id) : null, IDS.listTitle])
                        }
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
