"use client";

import { Icon, Popover, PopoverContent, PopoverTrigger } from "@thomascaron/opale-ui";
import { useId, useState, type ReactNode } from "react";

/** Largeur du panneau, en rem (suit la taille du texte des Réglages). */
const PANEL_WIDTH_REM = 16.5;
/** Écart entre le bouton et le panneau, et marge minimale au bord de l'écran, en px. */
const PANEL_OFFSET = 12;
const SCREEN_MARGIN = 16;

/**
 * Côté du panneau : à droite du bouton, hors de la carte, pour laisser lisible le
 * contenu principal ; en dessous quand il n'y tient pas (téléphone, fenêtre étroite).
 * Le Popover d'Opale basculerait sinon à gauche, par-dessus le texte des choix.
 */
export function infoPlacement({
  triggerRight,
  viewportWidth,
  rootFontSize,
}: {
  triggerRight: number;
  viewportWidth: number;
  rootFontSize: number;
}): "right" | "bottom" {
  const need = PANEL_WIDTH_REM * rootFontSize + PANEL_OFFSET + SCREEN_MARGIN;
  return viewportWidth - triggerRight >= need ? "right" : "bottom";
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
  const [placement, setPlacement] = useState<"right" | "bottom">("bottom");
  return (
    <Popover>
      <PopoverTrigger
        className="choice-info-trigger"
        aria-label={`En savoir plus : ${label}`}
        // Mesuré à chaque ouverture (clic, toucher, Entrée) : la fenêtre a pu changer de taille.
        onClick={(e) => {
          setPlacement(
            infoPlacement({
              triggerRight: e.currentTarget.getBoundingClientRect().right,
              viewportWidth: document.documentElement.clientWidth,
              rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
            }),
          );
        }}
      >
        <Icon name="info" />
      </PopoverTrigger>
      <PopoverContent
        placement={placement}
        align={placement === "right" ? "start" : "end"}
        offset={PANEL_OFFSET}
        aria-labelledby={titleId}
        className="choice-info-panel w-[min(16.5rem,calc(100vw-2rem))] p-4 text-sm"
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
