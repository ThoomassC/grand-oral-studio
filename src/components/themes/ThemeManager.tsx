"use client";

import { Notice } from "@/components/ui/Notice";
import { Button } from "@thomascaron/opale-ui";
import { useOptimistic, useRef, useState, useTransition } from "react";
import type { ThemeInput } from "@/domain/schemas";
import { addTheme, deleteTheme, reorderThemes, updateTheme } from "@/server/actions/themes";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { plural } from "@/components/ui/format";
import { ThemeForm } from "./ThemeForm";
import { ThemeImport } from "./ThemeImport";

/** Sujet du projet tel qu'affiché (identifiant de code historique : « theme »). */
export interface ThemeItem {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  /** Chiffres, exemples, sources de l'utilisateur ("" si aucune). */
  notes: string;
  /** Nombre de diaporamas du jour J rattachés au sujet (supprimés avec lui). */
  finalDeckCount: number;
  /** Version enregistrée (ISO) : jeton de concurrence renvoyé à l'enregistrement du sujet. */
  updatedAt: string;
}

/** La plus récente de deux versions ISO (la page rafraîchie peut être en retard ou en avance sur notre dernier enregistrement). */
function latestVersion(fromPage: string, fromSave: string | undefined): string {
  if (fromSave === undefined) return fromPage;
  return new Date(fromSave).getTime() > new Date(fromPage).getTime() ? fromSave : fromPage;
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
  const n = theme.finalDeckCount;
  const consequence =
    n === 0
      ? "Cette action est définitive."
      : n === 1
        ? "Son diaporama du jour J sera aussi supprimé."
        : `Ses ${n} diaporamas du jour J seront aussi supprimés.`;
  return {
    question: `Supprimer le sujet « ${theme.name} » ? ${consequence}`,
    confirm: n > 0 ? `Supprimer le sujet et ${n === 1 ? "son diaporama" : "ses diaporamas"}` : "Supprimer le sujet",
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
  // Le bloc « Importer des sujets depuis un texte », au-dessus, est la voie
  // principale : la saisie manuelle et l'import de liste restent à un clic.
  const [panel, setPanel] = useState<"none" | "add" | "import">("none");
  const [announce, setAnnounce] = useState("");
  const [reorderError, setReorderError] = useState<string | null>(null);
  /** Un ordre est en cours d'enregistrement : quitter ou recharger la page le perdrait. */
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderSaved, setOrderSaved] = useState(false);
  const [, startTransition] = useTransition();
  /** Version renvoyée par notre dernier enregistrement de chaque sujet (concurrence optimiste). */
  const [savedVersions, setSavedVersions] = useState<Record<string, string>>({});
  /**
   * Enregistrement de l'ordre, sérialisé côté client : une seule requête à la
   * fois, et des déplacements rapides n'envoient ensuite que le DERNIER ordre.
   * (Next.js expédie déjà les Server Actions une à une ; on ne s'appuie pas sur
   * ce détail et on évite les requêtes intermédiaires inutiles.)
   */
  const orderQueue = useRef<{ running: boolean; latest: string[] | null; waiters: (() => void)[] }>({
    running: false,
    latest: null,
    waiters: [],
  });
  useUnsavedChanges(savingOrder);

  /** Résout quand l'ordre demandé (ou un ordre plus récent) est enregistré ou a échoué. */
  async function saveOrder(ids: string[]): Promise<void> {
    const queue = orderQueue.current;
    queue.latest = ids;
    if (queue.running) return new Promise<void>((resolve) => queue.waiters.push(resolve));
    queue.running = true;
    let error: string | null = null;
    while (queue.latest) {
      const order = queue.latest;
      queue.latest = null;
      try {
        const result = await reorderThemes(programId, order);
        if (!result.ok) error = `Le nouvel ordre n'a pas été enregistré : ${result.error}`;
      } catch {
        error = "Le nouvel ordre n'a pas été enregistré : la connexion a été interrompue. Réessayez.";
      }
      // Après un échec, l'ordre en attente n'est pas envoyé : la liste revient à l'ordre enregistré.
      if (error) queue.latest = null;
    }
    queue.running = false;
    setSavingOrder(false);
    if (error) {
      setReorderError(error);
      setAnnounce("");
    } else {
      setOrderSaved(true);
    }
    for (const resolve of queue.waiters.splice(0)) resolve();
  }

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
    setOrderSaved(false);
    // Hors transition : la garde doit être armée tout de suite, pas à la fin de l'enregistrement.
    setSavingOrder(true);
    setAnnounce(`« ${moved.name} » déplacé en position ${target + 1} sur ${next.length}.`);

    // Le bouton déplacé change de place dans le DOM : on lui rend le focus,
    // ou à son voisin s'il devient inactif (premier / dernier rang).
    const atEdge = target === 0 || target === next.length - 1;
    const focusDir = atEdge ? (dir === "up" ? "down" : "up") : dir;
    focusLater([moveButtonId(moved.id, focusDir)]);

    startTransition(async () => {
      setOptimisticThemes(next);
      await saveOrder(next.map((t) => t.id));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* Sous-bloc de la page Sujets (h2) : h3, et ses panneaux et sujets en h4. */}
          <h3 id={IDS.listTitle} tabIndex={-1} className="text-2xl focus:outline-none">
            Vos sujets
          </h3>
          <p className="max-w-3xl text-sm text-muted">
            Saisissez-les un par un ou collez une liste. L&apos;ordre des sujets est celui de votre projet ; les
            mots-clés aident à reconnaître le sujet d&apos;une problématique.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id={IDS.addButton}
            variant={panel === "add" ? "ghost" : "secondary"}
            aria-expanded={panel === "add"}
            aria-controls={panel === "add" ? "panel-ajout-theme" : undefined}
            onClick={() => openPanel("add")}
          >
            Ajouter un sujet
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
          <h4 id="titre-ajout-theme" className="text-lg font-semibold">
            Nouveau sujet
          </h4>
          <div className="mt-4">
            <ThemeForm
              nameId={IDS.addName}
              submitLabel="Ajouter le sujet"
              pendingLabel="Ajout…"
              successMessage="Sujet ajouté. Vous pouvez en saisir un autre."
              resetOnSuccess
              onSubmit={(value: ThemeInput) => addTheme(programId, value)}
              onCancel={closePanel}
            />
          </div>
        </section>
      ) : null}

      {panel === "import" ? (
        <section id="panel-import-themes" aria-labelledby="titre-import-themes" className="opale-card opale-card--e1 block p-5">
          <h4 id="titre-import-themes" className="text-lg font-semibold">
            Importer des sujets
          </h4>
          <ThemeImport programId={programId} textareaId={IDS.importText} onClose={closePanel} />
        </section>
      ) : null}

      <LiveRegion>{announce}</LiveRegion>
      {/* Visible, mais seule la fin est annoncée : l'annonce « déplacé » reste la première entendue. */}
      {savingOrder ? (
        <p aria-hidden="true" className="text-sm text-muted">
          Enregistrement de l&apos;ordre…
        </p>
      ) : null}
      <LiveRegion className="text-sm text-muted">{orderSaved && !savingOrder ? "Ordre enregistré." : ""}</LiveRegion>
      <LiveRegion role="alert">
        {reorderError ? (
          <Notice tone="error">
            {reorderError}
          </Notice>
        ) : null}
      </LiveRegion>

      {optimisticThemes.length === 0 ? (
        <div className="opale-card opale-card--e0 block border-dashed border-border-strong p-6">
          <p className="font-display text-lg font-semibold">Aucun sujet</p>
          <p className="mt-1 text-muted">
            Les sujets sont facultatifs : sans sujet, le diaporama du jour J part de la problématique et de la trame.
            Si votre oral porte sur des sujets connus d&apos;avance, importez-les depuis un texte ci-dessus, ajoutez-les
            un par un (« Ajouter un sujet ») ou collez une liste (« Importer une liste »).
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Sujets du projet">
          {optimisticThemes.map((theme, index) => {
            const neighbour = optimisticThemes[index + 1] ?? optimisticThemes[index - 1];
            const { question, confirm } = deleteQuestion(theme);
            return (
              <li key={theme.id} className="opale-card opale-card--e1 block p-4 pt-6 sm:p-5 sm:pt-7">
                {editingId === theme.id ? (
                  <section aria-label={`Modifier ${theme.name}`}>
                    <ThemeForm
                      nameId={`edit-name-${theme.id}`}
                      initial={{ name: theme.name, description: theme.description, keywords: theme.keywords, notes: theme.notes }}
                      submitLabel="Enregistrer le sujet"
                      pendingLabel="Enregistrement…"
                      onSubmit={async (value) => {
                        // Sujet enregistré entre-temps (autre onglet, autre membre) : échec CONFLICT,
                        // affiché par le formulaire, qui invite à recharger la page.
                        const result = await updateTheme(theme.id, value, latestVersion(theme.updatedAt, savedVersions[theme.id]));
                        if (result.ok) setSavedVersions((prev) => ({ ...prev, [theme.id]: result.data.updatedAt }));
                        return result;
                      }}
                      onSaved={(name) => {
                        setAnnounce(`Sujet « ${name} » enregistré.`);
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
                        <h4 className="pt-1 text-lg">
                          <span className="sr-only">Sujet {index + 1} : </span>
                          {theme.name}
                        </h4>
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
                        {theme.notes.trim() ? (
                          <div className="mt-2">
                            <p className="text-sm font-semibold">Notes</p>
                            <p className="line-clamp-2 text-sm whitespace-pre-line text-muted">{theme.notes}</p>
                          </div>
                        ) : null}
                        <p className="mt-2 text-sm text-muted">
                          {theme.finalDeckCount === 0
                            ? "Aucun diaporama du jour J"
                            : `${plural(theme.finalDeckCount, "diaporama")} du jour J`}
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
                        title="Supprimer le sujet ?"
                        question={question}
                        confirmLabel={confirm}
                        onConfirm={async () => {
                          const result = await deleteTheme(theme.id);
                          if (result.ok) setAnnounce(`Sujet « ${theme.name} » supprimé.`);
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
