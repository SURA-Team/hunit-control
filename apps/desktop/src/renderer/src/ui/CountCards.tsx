/**
 * Números em destaque (specs/006, FR-004, US1-3):
 * - `CountCard` ("Card de contagem", node `21:153`): caixa cinza com o rótulo no tom (âmbar, vermelho,
 *   verde) e o número grande, para as contagens por classificação;
 * - `IndicatorCard` ("Card de indicador", node `91:73`): card branco com rótulo, número grande e ajuda.
 */
import type { ReactNode } from 'react';
import classes from './status.module.css';

export interface CountCardProps {
  /** `gray` para as situações neutras (cancelada sem cobrança, ignorada). */
  tone: 'amber' | 'red' | 'green' | 'gray';
  label: string;
  value: ReactNode;
  'data-testid'?: string;
}

export function CountCard({ tone, label, value, 'data-testid': testId }: CountCardProps) {
  return (
    <div className={classes.countCard} data-tone={tone} data-testid={testId}>
      <span className={classes.countLabel}>{label}</span>
      <span className={classes.countNumber} data-no-truncate="">
        {value}
      </span>
    </div>
  );
}

/**
 * Grade dos cards de contagem (telas 2.7 e 3.4): cinco por linha, como no design; quatro abaixo de
 * 640 px de largura e três abaixo de 480 px (mede o próprio espaço).
 */
export function CountGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className={classes.countGridFrame}>
      <div className={classes.countGrid} role="group" aria-label={label}>
        {children}
      </div>
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
