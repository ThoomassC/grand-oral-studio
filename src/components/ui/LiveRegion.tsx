/**
 * Région d'annonce toujours présente dans le DOM (condition pour être lue),
 * mais retirée du flux quand elle est vide : pas d'espace fantôme dans les
 * piles flex/grid (un élément en position absolue n'occupe pas de `gap`).
 */
export function LiveRegion({
  role = "status",
  children,
  className = "",
  id,
}: {
  role?: "status" | "alert";
  children?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const empty = children === null || children === undefined || children === false || children === "";
  return (
    <div id={id} role={role} aria-atomic="true" className={empty ? "sr-only" : className}>
      {children}
    </div>
  );
}
