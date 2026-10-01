import type { ComponentProps } from "react";

/*
 * Contrôles natifs dans la coquille des champs d'Opale (`.opale-input-shell`
 * + `.opale-input` / `.opale-select`) : le rendu exact d'`Input`, `Select` et
 * `Textarea` d'Opale, mais avec NOTRE balisage de libellé, d'aide et d'erreur.
 *
 * Pourquoi pas les composants eux-mêmes : ils annoncent chaque erreur de champ
 * en `role="alert"` et remplacent l'aide par l'erreur. Nos formulaires
 * annoncent UN résumé (« 2 champs sont à corriger ») et placent le focus sur
 * le premier champ invalide, qui garde son aide et son erreur dans
 * `aria-describedby` : plusieurs alertes simultanées seraient du bruit.
 *
 * `className` va au contrôle natif, `shellClassName` à la coquille (marges,
 * largeur). Tout le reste (id, name, aria-*, ref…) va au contrôle natif.
 */

type Shell = { shellClassName?: string };

export function TextInput({ className = "", shellClassName = "", ...props }: ComponentProps<"input"> & Shell) {
  return (
    <div className={`opale-input-shell ${shellClassName}`}>
      <input {...props} className={`opale-input ${className}`} />
    </div>
  );
}

export function TextArea({ className = "", shellClassName = "", ...props }: ComponentProps<"textarea"> & Shell) {
  return (
    <div className={`opale-input-shell opale-input-shell--textarea ${shellClassName}`}>
      <textarea {...props} className={`opale-input ${className}`} />
    </div>
  );
}

export function SelectInput({ className = "", shellClassName = "", ...props }: ComponentProps<"select"> & Shell) {
  return (
    <div className={`opale-input-shell ${shellClassName}`}>
      <select {...props} className={`opale-select ${className}`} />
    </div>
  );
}
