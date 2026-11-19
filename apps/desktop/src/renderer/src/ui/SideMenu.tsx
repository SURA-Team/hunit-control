/**
 * Menu lateral flutuante (specs/006, FR-002, FR-044, US9-4; "Menu/Item", node `21:140`): card branco
 * de 196 px com a área ativa em pílula preta e ícone lima (`aria-current="page"`). Com a janela abaixo
 * de 1 180 px, só os ícones (64 px), com o nome no `aria-label` e numa dica ao passar o mouse — só CSS,
 * sem estado (research R-07).
 */
import type { ReactNode } from 'react';
import classes from './navigation.module.css';

export function SideMenu({
  children,
  label = 'Áreas do app',
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <nav className={classes.menu} aria-label={label}>
      <ul className={classes.menuList}>{children}</ul>
    </nav>
  );
}

export interface SideMenuItemProps {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

export function SideMenuItem({ label, icon, active, onClick }: SideMenuItemProps) {
  return (
    <li>
      <button
        type="button"
        className={classes.item}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        data-tooltip={label}
        onClick={onClick}
      >
        <span className={classes.itemIcon}>{icon}</span>
        <span className={classes.itemLabel}>{label}</span>
      </button>
    </li>
  );
}
