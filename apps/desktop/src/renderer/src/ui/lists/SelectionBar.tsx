/**
 * Barra de seleção do lote (specs/006, FR-022 a FR-024; "Barra de seleção em lote", node `76:117`):
 * escura, com o indicador de seleção parcial, "N reservas selecionadas" e o total, as ações do lote e
 * "Desmarcar todas". É uma superfície escura: a principal ("Enviar ao Comercial") fica lima e os
 * secundários continuam brancos. As ações chegam prontas da tela (`Action`, `MenuButton`).
 */
import type { ReactNode } from 'react';
import { Action } from '../Action';
import { MinusIcon } from '../icons';
import { Surface } from '../Surface';
import classes from './lists.module.css';

export interface SelectionBarProps {
  count: number;
  /** Total já formatado: "R$ 4.957,50". */
  total: string;
  /** Ver seleção, Anexar ▾, Confirmar ▾, Enviar ao Comercial. */
  actions: ReactNode;
  onClearAll: () => void;
}

export function SelectionBar({ count, total, actions, onClearAll }: SelectionBarProps) {
  return (
    <Surface dark>
      <section
        className={classes.bar}
        data-block="seleção do lote"
        data-testid="selection-bar"
        aria-label="Seleção do lote"
      >
        <span className={classes.partialBox} aria-hidden="true">
          <MinusIcon />
        </span>
        <p className={classes.barSummary}>
          <span className={classes.barCount}>
            {count === 1 ? '1 reserva selecionada' : `${count} reservas selecionadas`}
          </span>
          <span className={classes.barTotal} data-no-truncate="">
            total de {total}
          </span>
        </p>
        {actions}
        <Action variant="text" onClick={onClearAll}>
          Desmarcar todas
        </Action>
      </section>
    </Surface>
  );
}
