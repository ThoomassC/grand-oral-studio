"use client";

import { useEffect } from "react";

/**
 * Place le focus sur l'élément `targetId` (qui doit être focalisable, ex.
 * `tabIndex={-1}`) au montage : après une navigation qui aboutit (deck tout
 * juste généré), le lecteur d'écran annonce la nouvelle page au lieu de
 * laisser le focus sur <body>. Synchronisation avec le DOM, sans rendu.
 */
export function FocusOnMount({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.focus();
  }, [targetId]);
  return null;
}
