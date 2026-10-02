"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useGuardedNavigation } from "./useGuardedNavigation";

type GuardedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/**
 * Un `<Link>` interne soumis à la garde « modifications non enregistrées »,
 * pour un parent Server Component (le logo de l'en-tête) : la feuille
 * interactive est seule à passer côté client.
 */
export function GuardedLink({ href, onClick, ...rest }: GuardedLinkProps) {
  const { onLinkClick } = useGuardedNavigation();
  return (
    <Link
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        onLinkClick(e, href);
      }}
    />
  );
}
