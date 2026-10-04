const dateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

/** « 1 thème », « 3 thèmes » ; `plural` par défaut = singulier + s. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

const sizeFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Poids d'un fichier tel qu'on le lit : « 350 Ko », « 2,4 Mo ». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} octets`;
  if (bytes < 1024 * 1024) return `${sizeFormatter.format(Math.round(bytes / 1024))} Ko`;
  return `${sizeFormatter.format(bytes / (1024 * 1024))} Mo`;
}

/** « 20 000 » : grand nombre lisible, espace insécable fine comme séparateur. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}
