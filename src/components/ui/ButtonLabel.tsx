/**
 * Libellé de bouton à largeur stable : les deux libellés (repos / en cours)
 * occupent la même cellule de grille, seul l'actif est visible et exposé
 * aux technologies d'assistance.
 */
export function ButtonLabel({ idle, busy, isBusy }: { idle: React.ReactNode; busy: React.ReactNode; isBusy: boolean }) {
  return (
    <span className="inline-grid">
      <span className={`[grid-area:1/1] ${isBusy ? "invisible" : ""}`} aria-hidden={isBusy || undefined}>
        {idle}
      </span>
      <span className={`[grid-area:1/1] ${isBusy ? "" : "invisible"}`} aria-hidden={!isBusy || undefined}>
        {busy}
      </span>
    </span>
  );
}
