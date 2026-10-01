import Link from "next/link";
import { cookies } from "next/headers";
import { getUser } from "@/server/session";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { parseExplicitTheme, THEME_COOKIE } from "@/components/theme/theme";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BrandMark } from "./BrandMark";
import { SettingsLink } from "./SettingsLink";

/** En-tête global : identité de l'app, thème, paramètres et état de connexion. */
export async function SiteHeader() {
  const [user, cookieStore] = await Promise.all([getUser(), cookies()]);
  // Choix explicite (cookie) : aria-pressed du bouton juste dès le rendu serveur.
  const serverTheme = parseExplicitTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <Link
          href={user ? "/programmes" : "/"}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-md font-display text-lg font-extrabold tracking-tight"
        >
          <BrandMark />
          <span>
            Grand Oral <span className="font-semibold text-muted">Studio</span>
          </span>
        </Link>
        <nav aria-label="Compte" className="ml-auto flex items-center gap-1 sm:gap-2">
          {user ? (
            <>
              <Link href="/programmes" className="btn btn-ghost btn-sm hidden sm:inline-flex">
                Mes programmes
              </Link>
              <span className="hidden max-w-[16rem] truncate px-1 text-sm text-muted lg:inline" title={user.email}>
                {user.email}
              </span>
              <ThemeToggle serverTheme={serverTheme} />
              <SettingsLink />
              <SignOutButton />
            </>
          ) : (
            <>
              <ThemeToggle serverTheme={serverTheme} />
              <Link href="/connexion" className="btn btn-ghost btn-sm">
                Connexion
              </Link>
              <Link href="/inscription" className="btn btn-primary btn-sm">
                <span className="sm:hidden">Inscription</span>
                <span className="hidden sm:inline">Créer un compte</span>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
