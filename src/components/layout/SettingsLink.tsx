"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Roue crantée de l'en-tête ; signale la page courante sur /parametres. */
export function SettingsLink() {
  const current = usePathname() === "/parametres";
  return (
    <Link
      href="/parametres"
      aria-current={current ? "page" : undefined}
      className="btn btn-ghost btn-icon aria-[current=page]:bg-surface-2 aria-[current=page]:ring-1 aria-[current=page]:ring-border-strong"
    >
      <GearIcon />
      <span className="sr-only">Paramètres</span>
    </Link>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.2h3.4l.5 2.4a7 7 0 0 1 1.9 1.1l2.3-.8 1.7 2.9-1.8 1.6a7 7 0 0 1 0 2.2l1.8 1.6-1.7 2.9-2.3-.8a7 7 0 0 1-1.9 1.1l-.5 2.4h-3.4l-.5-2.4a7 7 0 0 1-1.9-1.1l-2.3.8-1.7-2.9 1.8-1.6a7 7 0 0 1 0-2.2L4 8.8l1.7-2.9 2.3.8a7 7 0 0 1 1.9-1.1Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}
