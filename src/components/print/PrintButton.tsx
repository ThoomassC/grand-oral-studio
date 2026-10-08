"use client";

import { Button } from "@thomascaron/opale-ui";

/**
 * Ouvre la boîte d'impression du navigateur, qui propose aussi « Enregistrer au
 * format PDF » : aucune bibliothèque, la fiche est mise en page par
 * print-sheet.css. Le bouton lui-même ne s'imprime pas.
 */
export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <Button type="button" className={`print:hidden ${className}`} onClick={() => window.print()}>
      Imprimer ou enregistrer en PDF
    </Button>
  );
}
