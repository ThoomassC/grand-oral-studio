"use client";

import { Button } from "@thomascaron/opale-ui";
import { useEffect, useRef } from "react";

/** Contenu commun des fichiers error.tsx : message, référence, bouton Réessayer. */
export function ErrorPanel({
  title = "Cette page n'a pas pu être chargée",
  level = 1,
  error,
  retry,
}: {
  title?: string;
  /** Niveau du titre : 2 sous le layout d'un projet (qui porte déjà le h1). */
  level?: 1 | 2;
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Synchronisation avec le DOM : on place le focus sur le titre pour annoncer l'erreur.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const Heading = level === 1 ? "h1" : "h2";

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="opale-card opale-card--e1 block border-danger/40 p-6">
        <Heading ref={headingRef} tabIndex={-1} className="text-xl font-bold focus:outline-none">
          {title}
        </Heading>
        <p className="mt-2 text-muted">
          Une erreur est survenue pendant le chargement. Vos données ne sont pas perdues : réessayez dans un instant.
        </p>
        {error.digest ? (
          <p className="mt-2 text-sm text-muted">
            Référence : <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
        <Button type="button" className="mt-5" onClick={() => retry()}>
          Réessayer
        </Button>
      </div>
    </div>
  );
}
