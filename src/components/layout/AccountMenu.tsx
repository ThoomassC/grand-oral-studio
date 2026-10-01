"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useSignOut } from "@/components/auth/useSignOut";
import { LiveRegion } from "@/components/ui/LiveRegion";

/**
 * Menu du compte (`DropdownMenu` d'Opale, motif APG « menu button » :
 * Entrée / Espace / flèches pour ouvrir et parcourir, Échap ou Tab pour
 * fermer, focus rendu au bouton). Le titre — nom et e-mail — est la légende
 * du groupe d'actions (`role="group"`), non interactive.
 *
 * Opale n'a pas d'élément de menu-lien : « Informations du profil » navigue
 * par le routeur à l'activation.
 */
export function AccountMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const { pending, failed, signOut } = useSignOut();

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Compte : ${email}`}
          className="opale-button opale-button--text opale-icon-action-button"
        >
          <span aria-hidden="true" className="inline-flex">
            <Icon name="user" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Compte" placement="bottom" align="end" className="min-w-[16rem] max-w-[min(20rem,calc(100vw-2rem))]">
          <DropdownMenuGroup
            label={
              <span className="block px-1 py-1">
                {name ? <span className="block truncate font-semibold text-text">{name}</span> : null}
                <span className="block truncate text-sm text-muted">{email}</span>
              </span>
            }
          >
            <DropdownMenuItem value="profil" onSelect={() => router.push("/profil")}>
              Informations du profil
            </DropdownMenuItem>
            <DropdownMenuItem value="deconnexion" closeOnSelect={false} disabled={pending} onSelect={signOut}>
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
