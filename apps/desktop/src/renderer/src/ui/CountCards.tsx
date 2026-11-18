/**
 * Números em destaque (specs/006, FR-004, US1-3):
 * - `CountCard` ("Card de contagem", node `21:153`): caixa cinza com o rótulo no tom (âmbar, vermelho,
 *   verde) e o número grande, para as contagens por classificação;
 * - `IndicatorCard` ("Card de indicador", node `91:73`): card branco com rótulo, número grande e ajuda.
 */
import type { ReactNode } from 'react';
import classes from './status.module.css';

export interface CountCardProps {
  tone: 'amber' | 'red' | 'green';
  label: string;
  value: ReactNode;
}

export function CountCard({ tone, label, value }: CountCardProps) {
  return (
    <div className={classes.countCard} data-tone={tone}>
      <span className={classes.countLabel}>{label}</span>
      <span className={classes.countNumber} data-no-truncate="">
        {value}
      </span>
    </div>
  );
}

export interface IndicatorCardProps {
  label: string;
  value: ReactNode;
  help?: ReactNode;
}

export function IndicatorCard({ label, value, help }: IndicatorCardProps) {
  return (
    <div className={classes.indicator}>
      <span className={classes.indicatorLabel}>{label}</span>
      <span className={classes.countNumber} data-no-truncate="">
        {value}
      </span>
      {help && <span className={classes.indicatorHelp}>{help}</span>}
    </div>
  );
}
