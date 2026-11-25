/**
 * Legenda das barras (specs/007, research R-10; FR-015, FR-017): marcador de cor, nome, detalhe,
 * valor e percentual. Variantes do design (8.1): `rows` (distribuição dos valores, com separador),
 * `boxes` (card "Valor já cobrado"), `split` (as duas partes do card "Valor em aberto") e `inline`
 * (legenda do ranking).
 */
import type { ReactNode } from 'react';
import { useSurface } from '../Surface';
import classes from './charts.module.css';
import type { ChartTone } from './StackedBar';

export interface LegendItem {
  tone: ChartTone;
  name: string;
  detail?: ReactNode;
  value?: string;
  percent?: string;
}

export interface LegendListProps {
  items: readonly LegendItem[];
  variant?: 'rows' | 'boxes' | 'split' | 'inline';
  label?: string;
}

function ItemContent({ item, variant }: { item: LegendItem; variant: LegendListProps['variant'] }) {
  if (variant === 'inline') return <span>{item.name}</span>;
  if (variant === 'split') {
    return (
      <>
        <span className={classes.itemName}>{item.name}</span>
        {item.value && <span className={classes.itemValue}>{item.value}</span>}
        {item.detail && <span className={classes.itemDetail}>{item.detail}</span>}
      </>
    );
  }
  if (variant === 'rows') {
    return (
      <>
        <span className={classes.itemText}>
          <span className={classes.itemName}>{item.name}</span>
          {item.value && <span className={classes.itemDetail}>{item.value}</span>}
        </span>
        {item.percent && <span className={classes.itemPercent}>{item.percent}</span>}
      </>
    );
  }
  return (
    <>
      <span className={classes.itemText}>
        <span className={classes.itemName}>{item.name}</span>
        {item.detail && <span className={classes.itemDetail}>{item.detail}</span>}
      </span>
      {item.value && <span className={classes.itemValue}>{item.value}</span>}
    </>
  );
}

export function LegendList({ items, variant = 'rows', label }: LegendListProps) {
  const surface = useSurface();
  return (
    <ul className={classes.legend} data-variant={variant} data-surface={surface} aria-label={label}>
      {items.map((item) => (
        <li key={item.tone}>
          <span className={classes.dot} data-tone={item.tone} aria-hidden="true" />
          <ItemContent item={item} variant={variant} />
        </li>
      ))}
    </ul>
  );
}
