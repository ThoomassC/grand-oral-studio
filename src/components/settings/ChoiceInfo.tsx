"use client";

import { Icon, Popover, PopoverContent, PopoverTrigger } from "@thomascaron/opale-ui";
import { useId, type ReactNode } from "react";

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
  return (
    <Popover>
      <PopoverTrigger
        className="choice-info-trigger"
        aria-label={`En savoir plus : ${label}`}
      >
        <Icon name="info" />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom"
        align="end"
        aria-labelledby={titleId}
        className="choice-info-panel w-[min(22rem,calc(100vw-2rem))] p-4 text-sm"
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
