import { getUser } from "@/server/session";
import { SiteSettingsButton } from "@/components/preferences/SiteSettingsButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { AccountMenu } from "./AccountMenu";
import { BrandMark } from "./BrandMark";
import { GuardedLink } from "./GuardedLink";
import { MainNav } from "./MainNav";

/**
 * En-tête global, dans la même grille et la même palette que l’accueil.
 * Ordre de tabulation : logo → Projets → Configuration IA → Notes de version
 * (seul onglet sans compte) → thème (soleil / lune) → Réglages (panneau des réglages du site, aussi sans compte) → menu
 * du compte (e-mail, informations du profil, déconnexion) ou, sans compte,
 * Connexion → Créer un compte. Le logo, les onglets et le
 * menu du compte passent par la garde « modifications non enregistrées ».
 * Marque à gauche, navigation au centre et contrôles à droite ; la navigation
 * passe sur une seconde ligne lorsque les trois groupes ne tiennent plus.
 */
export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="studio-header">
      <div className="studio-header__inner">
        <GuardedLink
          href={user ? "/projets" : "/"}
          className="studio-brand"
        >
          <span className="studio-brand-mark"><BrandMark /></span>
          <span>
            Grand Oral <span className="font-normal text-muted">Studio</span>
          </span>
        </GuardedLink>
        <MainNav
          signedIn={user !== null}
          className="studio-header__nav"
        />
        <div className="studio-header__actions">
          <ThemeToggle />
          <SiteSettingsButton />
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
        </div>
      </div>
    </header>
  );
}
