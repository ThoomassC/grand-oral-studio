"use client";

import { Icon } from "@thomascaron/opale-ui";
import { useState } from "react";
import { SiteSettingsPanel } from "./SiteSettingsPanel";

/**
 * Bouton « Réglages » de l'en-tête, à côté du bouton soleil / lune et de même
 * boîte (`.header-control--square`). Ouvre le panneau des réglages du site
 * (`aria-haspopup="dialog"`, `aria-expanded` = panneau ouvert) ; à la
 * fermeture, le `SidePanel` d'Opale rend le focus à ce bouton.
 */
export function SiteSettingsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="header-control header-control--square"
        aria-label="Réglages"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" className="header-control__settings flex">
          <Icon name="settings" />
        </span>
      </button>
      <SiteSettingsPanel open={open} onOpenChange={setOpen} />
    </>
  );
}
