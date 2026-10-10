import { Button, Icon } from "@thomascaron/opale-ui";
import styles from "./LoginSubmitButton.module.css";

type LoginPhase = "idle" | "loading" | "success";

const LABELS: Record<LoginPhase, string> = {
  idle: "Se connecter",
  loading: "Connexion…",
  success: "Connecté",
};

/** Les trois libellés partagent leur place : aucun changement de taille ou de focus. */
export function LoginSubmitButton({ phase, blocked, studio }: {
  phase: LoginPhase;
  blocked: boolean;
  studio: boolean;
}) {
  return (
    <Button
      type="submit"
      fullWidth
      className={`${studio ? "auth-submit " : ""}${styles.button}`}
      data-phase={phase}
      aria-label={LABELS[phase]}
      aria-busy={phase === "loading" || undefined}
      aria-disabled={blocked || undefined}
    >
      <span className={styles.labels} aria-hidden="true">
        <span className={`${styles.label} ${styles.idle}`}>{LABELS.idle}</span>
        <span className={`${styles.label} ${styles.loading}`}>{LABELS.loading}</span>
        <span className={`${styles.label} ${styles.success}`}>{LABELS.success}</span>
      </span>
      <span className={styles.icons} aria-hidden="true">
        <Icon name="arrow-right" className={`${styles.icon} ${styles.arrow}`} />
        <svg className={`${styles.icon} ${styles.spinner}`} viewBox="0 0 24 24" fill="none" focusable="false">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        <Icon name="check-circle" data-verified className={`${styles.icon} ${styles.verified}`} />
      </span>
    </Button>
  );
}
