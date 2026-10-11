import type { ReactNode } from "react";

export function PageHeading({
  title,
  children,
  actions,
  level = 1,
  id,
  tabIndex,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2;
  id?: string;
  tabIndex?: number;
}) {
  const Heading = level === 2 ? "h2" : "h1";
  return (
    <div className="studio-page-heading">
      <div className="studio-page-heading__copy">
        <Heading id={id} tabIndex={tabIndex} className="studio-page-heading__title focus:outline-none">{title}</Heading>
        {children ? <p className="studio-page-heading__description">{children}</p> : null}
      </div>
      {actions ? <div className="studio-page-heading__actions">{actions}</div> : null}
    </div>
  );
}
