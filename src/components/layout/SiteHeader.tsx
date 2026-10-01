import { Icon, Topbar, TopbarActions, TopbarBrand } from "@thomascaron/opale-ui";
import Link from "next/link";
import { getUser } from "@/server/session";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { BrandMark } from "./BrandMark";
import { MainNav } from "./MainNav";

/**
 * En-tête global : la `Topbar` d'Opale (parties nommées : Server Component).
 * Ordre de tabulation : logo → Projets → Paramètres → thème → Se déconnecter
 * (le compte, entre les deux, est un texte).
 */
export async function SiteHeader() {
  const user = await getUser();

  return (
    <Topbar className="h-auto min-h-16 flex-wrap gap-x-4 gap-y-1 px-4 py-1 sm:px-6">
      <TopbarBrand>
        <Link
          href={user ? "/programmes" : "/"}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-md font-title text-lg font-semibold tracking-tight text-text no-underline"
        >
          <BrandMark />
          <span>
            Grand Oral <span className="font-normal text-muted">Studio</span>
          </span>
        </Link>
      </TopbarBrand>
      {user ? <MainNav /> : null}
      <TopbarActions className="ml-auto flex-wrap">
        <ThemeToggle />
        {user ? (
          <>
            {/* Le compte : l'icône de profil (décorative) et l'adresse, masquée à l'œil sur mobile mais toujours lue. */}
            <p className="flex min-w-0 items-center gap-1.5 px-1 text-sm text-muted" title={user.email}>
              <Icon name="user" aria-hidden="true" />
              <span className="max-w-[14rem] truncate max-md:sr-only">{user.email}</span>
            </p>
            <SignOutButton />
          </>
        ) : (
          <>
            <ButtonLink href="/connexion" variant="text" size="small">
              Connexion
            </ButtonLink>
            <ButtonLink href="/inscription" size="small">
              <span className="sm:hidden">Inscription</span>
              <span className="hidden sm:inline">Créer un compte</span>
            </ButtonLink>
          </>
        )}
      </TopbarActions>
    </Topbar>
  );
}
