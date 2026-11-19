/**
 * Linha das listas de execuções e de envios (specs/006, FR-019; "Linha de execução", node `53:125`):
 * quando (data e hora; período e cliente), resultado, situação e a seta. A linha inteira abre o
 * detalhe, como a de reservas.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronRightIcon } from '../icons';
import classes from './lists.module.css';

export interface ExecutionRowProps {
  /** "11/11/2026 · 08:40". */
  when: string;
  /** "Check-in 11/11 a 17/11/2026 · Recepção — PC 1 (esta máquina)". */
  detail?: string;
  /** "Encerrada às 08:47 · 7 min". */
  result: ReactNode;
  /** O selo da situação. */
  status: ReactNode;
  /** Nome do botão da seta, ex.: "Abrir a execução de 11/11/2026 · 08:40". */
  openLabel: string;
  opened?: boolean;
  onOpen: () => void;
}

export function ExecutionRow({
  when,
  detail,
  result,
  status,
  openLabel,
  opened = false,
  onOpen,
}: ExecutionRowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) onOpen();
  };
  return (
    <tr
      className={classes.row}
      data-kind="execution"
      data-selected={opened || undefined}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <td data-col="execution">
        <div className={classes.strong}>{when}</div>
        {detail && <div className={classes.secondary}>{detail}</div>}
      </td>
      <td data-col="result">
        <div className={classes.result}>{result}</div>
      </td>
      <td data-col="status">{status}</td>
      <td data-col="arrow">
        <button
          type="button"
          className={classes.arrow}
          aria-label={openLabel}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ChevronRightIcon />
        </button>
      </td>
    </tr>
  );
}
