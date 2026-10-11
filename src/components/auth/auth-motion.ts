/** Durée commune aux transitions d’entrée et de sortie, remplissage final inclus. */
export const AUTH_TRANSITION_MS = 1100;
export const AUTH_COMPLETION_MS = 260;

/** Temps de lecture des états du bouton, supprimé en mouvement réduit. */
export const AUTH_BUTTON_PENDING_MS = 320;
export const AUTH_BUTTON_SUCCESS_MS = 560;

export function authMotionReduced(): boolean {
  return document.documentElement.dataset.motion === "reduced"
    || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/** Attente annulable ; réduire les mouvements de l’appareil l’interrompt aussi. */
export function waitForAuthMotion(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || authMotionReduced() || delay <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const finish = () => {
      window.clearTimeout(timer);
      media?.removeEventListener?.("change", onMotionChange);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const onMotionChange = () => { if (media?.matches) finish(); };
    const timer = window.setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
    media?.addEventListener?.("change", onMotionChange);
  });
}
