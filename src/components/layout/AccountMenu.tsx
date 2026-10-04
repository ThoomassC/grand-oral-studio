"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@thomascaron/opale-ui";
import { useRef, useState } from "react";
import { useSignOut } from "@/components/auth/useSignOut";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { useGuardedNavigation } from "./useGuardedNavigation";

/**
 * Menu du compte (`DropdownMenu` d'Opale, motif APG « menu button » :
 * Entrée / Espace / flèches pour ouvrir et parcourir, Échap ou Tab pour
 * fermer, focus rendu au bouton). Le titre — nom et e-mail — est la légende
 * du groupe d'actions (`role="group"`), non interactive.
 *
 * Apparence : celle du sélecteur de langue de l'en-tête d'Opale (boîte
 * encadrée + chevron, liste en carte) — voir `.header-control` et
 * `.header-menu` dans globals.css.
 *
 * Opale n'a pas d'élément de menu-lien : « Informations du profil » navigue
 * par le routeur à l'activation. Les deux actions quittent la page : elles
 * passent par la garde « modifications non enregistrées » (le focus revient
 * au bouton du menu si l'on reste). La déconnexion garde le menu ouvert
 * (« Déconnexion… ») ; retenue, elle le ferme pour laisser place à la
 * confirmation.
 */
export function AccountMenu({ name, email }: { name: string; email: string }) {
  const { pending, failed, signOut } = useSignOut();
  const { go, runOrHold } = useGuardedNavigation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger ref={triggerRef} aria-label={`Compte : ${email}`} className="header-control header-control--menu">
          <span aria-hidden="true" className="inline-flex">
            <Icon name="user" />
          </span>
          <span aria-hidden="true" className="header-control__caret" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          aria-label="Compte"
          placement="bottom"
          align="end"
          className="header-menu min-w-[16rem] max-w-[min(20rem,calc(100vw-2rem))]"
        >
          <DropdownMenuGroup
            className="grid gap-[var(--opale-space-2xs)]"
            label={
              <span className="header-menu__title block">
                {name ? <span className="block truncate font-semibold text-text">{name}</span> : null}
                <span className="block truncate text-sm font-normal text-muted">{email}</span>
              </span>
            }
          >
            <DropdownMenuItem className="header-menu__item" value="profil" onSelect={() => go("/profil", triggerRef.current)}>
              Informations du profil
            </DropdownMenuItem>
            <DropdownMenuItem
              className="header-menu__item"
              value="deconnexion"
              closeOnSelect={false}
              disabled={pending}
              onSelect={() => {
                if (runOrHold(signOut, triggerRef.current)) setOpen(false);
              }}
            >
              {pending ? "Déconnexion…" : "Se déconnecter"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <LiveRegion role="alert" className="text-sm font-medium text-danger">
        {failed ? "La déconnexion a échoué. Réessayez." : null}
      </LiveRegion>
    </div>
  );
}
