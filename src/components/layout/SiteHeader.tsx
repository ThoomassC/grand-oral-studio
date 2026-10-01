import Link from "next/link";
import { getUser } from "@/server/session";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BrandMark } from "./BrandMark";

/** En-tête global : identité de l'app, thème, paramètres et état de connexion. */
export async function SiteHeader() {
  const user = await getUser();

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
              <ThemeToggle />
              <Link href="/parametres" className="btn btn-ghost btn-icon">
                <GearIcon />
                <span className="sr-only">Paramètres</span>
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <ThemeToggle />
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

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.2h3.4l.5 2.4a7 7 0 0 1 1.9 1.1l2.3-.8 1.7 2.9-1.8 1.6a7 7 0 0 1 0 2.2l1.8 1.6-1.7 2.9-2.3-.8a7 7 0 0 1-1.9 1.1l-.5 2.4h-3.4l-.5-2.4a7 7 0 0 1-1.9-1.1l-2.3.8-1.7-2.9 1.8-1.6a7 7 0 0 1 0-2.2L4 8.8l1.7-2.9 2.3.8a7 7 0 0 1 1.9-1.1Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}
