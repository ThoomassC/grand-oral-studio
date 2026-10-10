"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon } from "@thomascaron/opale-ui";
import { useRef } from "react";
import { CreateProgramDialog } from "./CreateProgramDialog";
import { ProjectListActions } from "./ProjectListActions";
import styles from "@/components/projects/project-gallery.module.css";

/** Les trois points de départ utilisent les formulaires et actions existants. */
export function ProjectStartMenu({ label = "Créer un projet" }: { label?: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <CreateProgramDialog returnFocusRef={triggerRef} renderTrigger={(showCreate) => (
      <ProjectListActions returnFocusRef={triggerRef} renderActions={({ showImport, startFromExample, creating }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            ref={triggerRef}
            className={`opale-button opale-button--primary opale-button--small ${styles.startTrigger}`}
            aria-busy={creating || undefined}
            disabled={creating}
          >
            <Icon name="plus" />
            <span>{creating ? "Création de l’exemple…" : label}</span>
            <Icon name="chevron-down" />
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label="Créer un projet" align="end" placement="bottom" className="header-menu min-w-[15rem] max-w-[calc(100vw-2rem)]">
            <DropdownMenuItem className="header-menu__item" value="blank" onSelect={showCreate}>Projet vierge</DropdownMenuItem>
            <DropdownMenuItem className="header-menu__item" value="example" onSelect={startFromExample}>Partir de l&apos;exemple</DropdownMenuItem>
            <DropdownMenuItem className="header-menu__item" value="import" onSelect={showImport}>Importer un projet (.json)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )} />
    )} />
  );
}
