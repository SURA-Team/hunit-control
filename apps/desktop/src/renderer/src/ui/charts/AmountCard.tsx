/**
 * Card de valor do módulo de Relatórios (specs/007, research R-10; tela 8.1): rótulo, o valor em
 * destaque, a frase de apoio, a ação no canto (no máximo uma, FR-007 da 006) e o conteúdo (barra e
 * legenda). `dark` = o card "Valor em aberto", na superfície escura (a ação principal fica lima).
 */
import type { ReactNode } from 'react';
import { Surface } from '../Surface';
import classes from './charts.module.css';

export interface AmountCardProps {
  label: string;
  /** Já formatado: "R$ 211.120,47". */
  amount: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  dark?: boolean;
  children?: ReactNode;
}

export function AmountCard({
  label,
  amount,
  description,
  action,
  dark = false,
  children,
}: AmountCardProps) {
  return (
    <Surface dark={dark}>
      <section
        className={classes.amountCard}
        data-surface={dark ? 'dark' : 'light'}
        data-block={label}
        aria-label={label}
      >
        <div className={classes.amountHead}>
          <p className={classes.amountLabel}>{label}</p>
          {action}
        </div>
        <p className={classes.amountValue} data-no-truncate="">
          {amount}
        </p>
        {description && <p className={classes.amountDescription}>{description}</p>}
        {children}
      </section>
    </Surface>
  );
}
