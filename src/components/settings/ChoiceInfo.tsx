"use client";

import { Icon, Popover, PopoverContent, PopoverTrigger } from "@thomascaron/opale-ui";
import { useId, useState, type ReactNode } from "react";

/** Largeur du panneau, en rem (suit la taille du texte des Réglages) : au plus, et au moins dans la marge. */
const PANEL_WIDTH_REM = 16.5;
const PANEL_MIN_WIDTH_REM = 10.5;
/** Écart entre la carte (ou le bouton) et le panneau, en px. */
const PANEL_GAP = 12;
/** Marge minimale au bord de l'écran, celle du Popover d'Opale, en px. */
const SCREEN_MARGIN = 8;

export type InfoPlacement = { side: "right"; offset: number; width: number } | { side: "bottom" };

/**
 * Côté du panneau : dans la marge droite de la page, juste après le bord de la
 * carte blanche, pour ne jamais couvrir le contenu principal. Le panneau
 * rétrécit pour tenir dans la marge (jusqu'à 10,5 rem) ; plus étroite, la marge
 * ne suffit pas (tablette, téléphone) et le panneau passe sous le bouton.
 * `offset` est l'écart compté depuis le bouton, comme l'attend le Popover d'Opale.
 */
export function infoPlacement({
  triggerRight,
  cardRight,
  viewportWidth,
  rootFontSize,
}: {
  triggerRight: number;
  cardRight: number;
  viewportWidth: number;
  rootFontSize: number;
}): InfoPlacement {
  const room = Math.floor(viewportWidth - cardRight - PANEL_GAP - SCREEN_MARGIN);
  if (room < PANEL_MIN_WIDTH_REM * rootFontSize) return { side: "bottom" };
  return {
    side: "right",
    offset: Math.round(cardRight - triggerRight + PANEL_GAP),
    width: Math.min(Math.round(PANEL_WIDTH_REM * rootFontSize), room),
  };
}

export interface ChoiceInfoItem {
  term: string;
  detail: ReactNode;
}

/**
 * Le bouton « i » en bout de ligne d'un choix : un panneau (Popover d'Opale) qui
 * détaille le choix en quelques lignes (résultat, coût, données). Un clic, un
 * toucher ou Entrée l'ouvre ; Échap ou un clic ailleurs le ferme et rend le
 * focus au bouton. Placé HORS du `<label>` du radio : il ne change pas son nom
 * et ne le coche pas.
 */
export function ChoiceInfo({ label, items }: { label: string; items: readonly ChoiceInfoItem[] }) {
  const titleId = useId();
  const [placement, setPlacement] = useState<InfoPlacement>({ side: "bottom" });
  return (
    <Popover>
      <PopoverTrigger
        className="choice-info-trigger"
        aria-label={`En savoir plus : ${label}`}
        // Mesuré à chaque ouverture (clic, toucher, Entrée) : la fenêtre a pu changer de taille.
        onClick={(e) => {
          const trigger = e.currentTarget.getBoundingClientRect();
          // La carte blanche qui contient le bouton (à défaut, le bouton lui-même).
          const card = e.currentTarget.closest(".opale-card")?.getBoundingClientRect() ?? trigger;
          setPlacement(
            infoPlacement({
              triggerRight: trigger.right,
              cardRight: card.right,
              viewportWidth: document.documentElement.clientWidth,
              rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
            }),
          );
        }}
      >
        <Icon name="info" />
      </PopoverTrigger>
      <PopoverContent
        placement={placement.side}
        align={placement.side === "right" ? "start" : "end"}
        offset={placement.side === "right" ? placement.offset : PANEL_GAP}
        aria-labelledby={titleId}
        style={placement.side === "right" ? { width: placement.width } : undefined}
        className={`choice-info-panel p-4 text-sm ${placement.side === "right" ? "" : "w-[min(16.5rem,calc(100vw-2rem))]"}`}
      >
        <p id={titleId} className="font-title text-base font-semibold">
          {label}
        </p>
        <dl className="mt-2 flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.term}>
              <dt className="font-semibold">{item.term}</dt>
              <dd className="text-muted">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
