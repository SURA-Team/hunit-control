/**
 * Linhas simples (specs/006, FR-020):
 * - `HotelRow` ("Linha de hotel", node `55:2262`): nome, uma linha de resumo e a situação; também para
 *   os documentos da reserva, com o ícone num quadrado cinza e as ações à direita;
 * - `CompactReservationRow` ("Linha de reserva compacta", node `76:223`): a reserva na seleção do
 *   lote e nos diálogos de lote, com o botão de tirar da seleção.
 * Vão dentro de `RowList`.
 */
import type { ReactNode } from 'react';
import { CloseIcon } from '../icons';
import classes from './lists.module.css';

export interface HotelRowProps {
  title: string;
  /** "Código 101 · 6 reservas · 42 s"; para documentos, "Nenhum arquivo anexado". */
  summary: ReactNode;
  /** O selo da situação. */
  status?: ReactNode;
  /** Ícone num quadrado cinza de 40 px (documentos). */
  icon?: ReactNode;
  actions?: ReactNode;
  'data-testid'?: string;
}

export function HotelRow({
  title,
  summary,
  status,
  icon,
  actions,
  'data-testid': testId,
}: HotelRowProps) {
  return (
    <li className={classes.simpleRow} data-with-icon={icon ? '' : undefined} data-testid={testId}>
      {icon && <span className={classes.iconTile}>{icon}</span>}
      <div className={classes.simpleMain}>
        <span className={`${classes.strong} ${classes.clamp}`} title={title}>
          {title}
        </span>
        <span className={classes.secondary}>{summary}</span>
      </div>
      {status}
      {actions && <div className={classes.simpleActions}>{actions}</div>}
    </li>
  );
}

export interface CompactReservationRowProps {
  guestName: string;
  /** "101-1002 · Hotel Praia Azul". */
  detail: string;
  /** "R$ 655,00". */
  amount: string;
  /** O selo da situação. */
  situation: ReactNode;
  /** Tira a reserva da seleção; sem ele, a linha não tem o botão. */
  onRemove?: () => void;
  /** Nome do botão, ex.: "Tirar a reserva 101-1002 da seleção". */
  removeLabel?: string;
}

export function CompactReservationRow({
  guestName,
  detail,
  amount,
  situation,
  onRemove,
  removeLabel = 'Tirar da seleção',
}: CompactReservationRowProps) {
  return (
    <li className={classes.simpleRow}>
      <div className={classes.simpleMain}>
        <span className={`${classes.strong} ${classes.clamp}`} title={guestName}>
          {guestName}
        </span>
        <span className={classes.secondary}>{detail}</span>
      </div>
      <span className={`${classes.strong} ${classes.compactAmount}`}>
        <span className={classes.value} data-no-truncate="">
          {amount}
        </span>
      </span>
      <span className={classes.compactSituation}>{situation}</span>
      {onRemove && (
        <button type="button" className={classes.arrow} aria-label={removeLabel} onClick={onRemove}>
          <CloseIcon />
        </button>
      )}
    </li>
  );
}
