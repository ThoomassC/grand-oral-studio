const ORIGIN = "http://interne.invalid";

/**
 * Destination après connexion : chemin interne uniquement. On laisse le parseur
 * d'URL trancher (il ignore tabulations et sauts de ligne, d'où `/\t/evil.example`)
 * et on refuse tout ce qui ne reste pas sur la même origine.
 */
export function safeNextPath(raw: string | string[] | undefined, fallback = "/projets"): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || /[\u0000-\u001f\\]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, ORIGIN);
  } catch {
    return fallback;
  }
  // La normalisation des segments (`/.//x`, `/a/..//x`) peut produire `//hôte` : refusé aussi.
  if (url.origin !== ORIGIN || url.pathname.startsWith("//")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Évite de revenir à une entrée d'authentification après la transition. */
export function postLoginDestination(raw: string | string[] | undefined): string {
  const safe = safeNextPath(raw);
  let pathname = new URL(safe, ORIGIN).pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return "/projets";
  }
  pathname = pathname.replace(/\/+$/, "");
  return pathname === "/connexion" || pathname === "/connexion/chargement" || pathname === "/inscription"
    ? "/projets"
    : safe;
}

/** Point d'arrivée commun au mot de passe, à Google et à la confirmation d'adresse. */
export function postLoginPath(next: string): string {
  const safe = postLoginDestination(next);
  return safe === "/projets" ? "/connexion/chargement" : `/connexion/chargement?next=${encodeURIComponent(safe)}`;
}

/**
 * Destination du lien de confirmation d'adresse (Better Auth y ajoute
 * `?error=TOKEN_EXPIRED` en cas d'échec) : la page de connexion, qui affiche
 * l'erreur, ou redirige vers `next` quand la vérification a ouvert la session.
 */
export function verificationCallbackPath(next: string): string {
  const safe = safeNextPath(next);
  return safe === "/projets" ? "/connexion" : `/connexion?next=${encodeURIComponent(safe)}`;
}
