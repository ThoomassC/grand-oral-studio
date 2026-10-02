import { Topbar, TopbarActions, TopbarBrand } from "@thomascaron/opale-ui";
import { getUser } from "@/server/session";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { AccountMenu } from "./AccountMenu";
import { BrandMark } from "./BrandMark";
import { GuardedLink } from "./GuardedLink";
import { MainNav } from "./MainNav";

/**
 * En-tête global : la `Topbar` d'Opale (parties nommées : Server Component).
 * Ordre de tabulation : logo → Projets → Paramètres → thème → menu du compte
 * (e-mail, informations du profil, déconnexion). Le logo, les onglets et le
 * menu du compte passent par la garde « modifications non enregistrées ».
 * Grille à trois colonnes : marque à gauche, onglets centrés dans la barre,
 * actions à droite ; sous 640 px, les onglets passent sur une seconde ligne.
 */
export async function SiteHeader() {
  const user = await getUser();

  return (
    <Topbar className="grid h-auto min-h-16 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2 sm:grid-cols-[1fr_auto_1fr] sm:px-6">
      <TopbarBrand className="min-w-0 justify-self-start">
        <GuardedLink
          href={user ? "/projets" : "/"}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-md font-title text-lg font-semibold tracking-tight text-text no-underline"
        >
          <BrandMark />
          <span>
            Grand Oral <span className="font-normal text-muted">Studio</span>
          </span>
        </GuardedLink>
      </TopbarBrand>
      {user ? <MainNav className="col-span-2 row-start-2 justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1" /> : null}
      <TopbarActions className="flex-wrap justify-self-end sm:col-start-3">
        <ThemeToggle />
        {user ? (
          <AccountMenu name={user.name} email={user.email} />
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
