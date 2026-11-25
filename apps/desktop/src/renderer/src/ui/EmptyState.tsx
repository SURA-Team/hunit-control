/**
 * Lista sem resultado (specs/006, FR-021; tela 4.3): ícone, título, explicação e, quando há busca ou
 * filtro em vigor (`onClear`), "Limpar busca e filtros". Ocupa o lugar do card da lista.
 */
import type { ReactNode } from 'react';
import { Action } from './Action';
import { SearchEmptyIcon } from './icons';
import classes from './status.module.css';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Com busca ou filtro em vigor: mostra "Limpar busca e filtros". */
  onClear?: () => void;
  /** Texto do botão de `onClear` (specs/007: "Ver os últimos 30 dias", "Limpar busca"). */
  clearLabel?: string;
  /** Ícone no lugar da lupa. */
  icon?: ReactNode;
}

export function EmptyState({
  title,
  description,
  onClear,
  clearLabel = 'Limpar busca e filtros',
  icon,
}: EmptyStateProps) {
  return (
    <div className={classes.empty} data-block="estado vazio">
      <span className={classes.emptyIcon}>{icon ?? <SearchEmptyIcon />}</span>
      <p className={classes.emptyTitle}>{title}</p>
      {description && <p className={classes.emptyText}>{description}</p>}
      {onClear && (
        <Action variant="secondary" onClick={onClear}>
          {clearLabel}
        </Action>
      )}
    </div>
  );
}
