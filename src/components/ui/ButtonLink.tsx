import type { ButtonVariant } from "@thomascaron/opale-ui";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "className" | "children"> & {
  variant?: ButtonVariant;
  size?: "small" | "medium" | "large";
  fullWidth?: boolean;
  /** Bouton carré à icône seule (nommer le lien par un texte `sr-only`). */
  iconOnly?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Un lien de navigation Next.js habillé en `Button` d'Opale. Opale ne rend
 * `Button` qu'en `<button>` : un lien qui ressemble à un bouton reste un lien
 * (rôle, ouverture dans un onglet), avec les mêmes classes et la même
 * structure (`<span>` du libellé) que le composant.
 */
export function ButtonLink({
  variant = "primary",
  size = "medium",
  fullWidth = false,
  iconOnly = false,
  className = "",
  children,
  ...linkProps
}: ButtonLinkProps) {
  const classes = [
    "opale-button",
    `opale-button--${variant}`,
    size !== "medium" ? `opale-button--${size}` : "",
    fullWidth ? "opale-button--full" : "",
    iconOnly ? "opale-icon-action-button" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Link {...linkProps} className={classes}>
      <span className="inline-flex items-center gap-2">{children}</span>
    </Link>
  );
}

/** Classe à ajouter à un `Button variant="ghost"` d'Opale pour une action destructive secondaire. */
export const DANGER_OUTLINE = "danger-outline";
