/**
 * Chip de filtro rápido com contagem (specs/006, FR-015, research R-09; "Chip de filtro" do design,
 * node `53:58`). Ativo em preto com a contagem em lima; `aria-pressed` diz qual está em vigor. A
 * contagem grande aparece abreviada ("12,3 mil"), com o número inteiro na dica. Sem contagem (ainda
 * carregando ou indisponível), só o rótulo.
 */
import type { ComponentPropsWithoutRef } from 'react';
import { formatCount, formatInteger } from '../presentation/format';
import classes from './FilterChip.module.css';

export interface FilterChipProps extends Omit<
  ComponentPropsWithoutRef<'button'>,
  'children' | 'style' | 'className'
> {
  label: string;
  count?: number | null;
  active: boolean;
}

export function FilterChip({ label, count = null, active, ...props }: FilterChipProps) {
  const withCount = count !== null;
  return (
    <button
      type="button"
      className={classes.root}
      aria-pressed={active}
      data-with-count={withCount || undefined}
      data-no-truncate=""
      {...props}
    >
      {label}
      {withCount && (
        <span className={classes.count} title={formatInteger(count)}>
          {formatCount(count)}
        </span>
      )}
    </button>
  );
}
