/**
 * Resumo de uma ação em lote (specs/006, T042, FR-024; "Resumo do lote" da tela 4.6, node `88:3565`):
 * - `BatchSummary`: as linhas e as caixas do resumo, uma embaixo da outra;
 * - `SummaryLine`: o ícone num círculo do tom (verde com ✓ para as aceitas; âmbar com ! para as
 *   ignoradas e o que pede atenção; vermelho com ! para as que falharam) e o texto, que sempre diz o
 *   grupo e a quantidade: a cor não é a única informação (FR-006);
 * - `ReasonList`: a caixa cinza com cada reserva que fica de fora e o motivo.
 */
import type { ReactNode } from 'react';
import { AttentionIcon, CheckIcon } from './icons';
import classes from './status.module.css';

export function BatchSummary({
  children,
  'data-testid': testId,
}: {
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div className={classes.batchSummary} data-testid={testId}>
      {children}
    </div>
  );
}

export type SummaryTone = 'green' | 'amber' | 'red';

export interface SummaryLineProps {
  tone: SummaryTone;
  /** "3 reservas aceitam o documento — total de R$ 2.515,00". */
  children: ReactNode;
}

export function SummaryLine({ tone, children }: SummaryLineProps) {
  const Icon = tone === 'green' ? CheckIcon : AttentionIcon;
  return (
    <div className={classes.summaryLine} data-tone={tone}>
      <span className={classes.summaryIcon}>
        <Icon size={14} />
      </span>
      <span>{children}</span>
    </div>
  );
}

export interface ReasonItem {
  key: string;
  /** "104-1015 (hotel 104)". */
  title: string;
  /** "Esta reserva não exige cobrança." */
  reason: string;
}

export function ReasonList({ label, items }: { label: string; items: readonly ReasonItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className={classes.reasonList} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={classes.reasonItem}>
          <span className={classes.reasonTitle}>{item.title}</span>
          <span>{item.reason}</span>
        </li>
      ))}
    </ul>
  );
}
