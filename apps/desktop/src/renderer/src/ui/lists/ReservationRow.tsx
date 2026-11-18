/**
 * Linha da lista de reservas (specs/006, FR-014, FR-018, research R-08; "Linha de reserva", node
 * `53:93`): caixa de seleção, Hóspede (nome; número · canal), Hotel, Período (datas; noites), Valor
 * (total; "cobrado R$ X · Hunit/manual" só quando houver), selos da situação e a seta.
 *
 * A linha inteira abre o detalhe (clique ou Enter com o foco nela); a seta é o botão "Abrir a reserva
 * N" para o leitor de tela. A caixa de seleção não abre a reserva. Aberta ou marcada, a linha fica em
 * lima suave. Nomes cortam em até duas linhas, com o texto inteiro na dica; valores nunca cortam. Em
 * conteúdo estreito, o hotel vai para a segunda linha do hóspede.
 *
 * Os textos chegam prontos (formatação em presentation/): a linha não conhece regra de negócio.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { SelectionBox } from '../fields/SelectionBox';
import { ChevronRightIcon } from '../icons';
import classes from './lists.module.css';

export interface ReservationRowProps {
  reservationNumber: string;
  guestName: string;
  /** Segunda linha do hóspede: "101-1000 · Booking.com". */
  detail: string;
  hotelName: string;
  /** "17/11 → 19/11/2026". */
  period: string;
  /** "2 noites". */
  nights: string;
  /** "R$ 380,00". */
  amount: string;
  /** "cobrado R$ 1.280,00 · Hunit"; sem valor cobrado, nada. */
  chargedAmount?: string | null;
  /** Os selos (`SituationBadges`). */
  situation: ReactNode;
  /** Selo ao lado do nome ("Sistema anterior"). */
  nameBadge?: ReactNode;
  /** Com a coluna de seleção do lote. */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** Aberta na gaveta. */
  opened?: boolean;
  onOpen: () => void;
}

export function ReservationRow({
  reservationNumber,
  guestName,
  detail,
  hotelName,
  period,
  nights,
  amount,
  chargedAmount = null,
  situation,
  nameBadge,
  selectable = false,
  selected = false,
  onSelectedChange,
  opened = false,
  onOpen,
}: ReservationRowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) onOpen();
  };
  return (
    <tr
      className={classes.row}
      data-selected={selected || opened || undefined}
      data-opened={opened || undefined}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {selectable && (
        <td data-col="select" onClick={(event) => event.stopPropagation()}>
          <SelectionBox
            checked={selected}
            onChange={(event) => onSelectedChange?.(event.currentTarget.checked)}
            aria-label={`Selecionar a reserva ${reservationNumber}`}
          />
        </td>
      )}
      <td data-col="guest">
        <div className={classes.nameLine}>
          <span className={`${classes.strong} ${classes.clamp}`} title={guestName}>
            {guestName}
          </span>
          {nameBadge}
        </div>
        <div className={classes.secondary}>
          {detail}
          <span className={classes.hotelInline}> · {hotelName}</span>
        </div>
      </td>
      <td data-col="hotel">
        <span className={`${classes.primary} ${classes.clamp}`} title={hotelName}>
          {hotelName}
        </span>
      </td>
      <td data-col="period">
        <div className={classes.primary}>
          <span className={classes.value} data-no-truncate="">
            {period}
          </span>
        </div>
        <div className={classes.secondary}>{nights}</div>
      </td>
      <td data-col="amount">
        <div className={classes.strong}>
          <span className={classes.value} data-no-truncate="">
            {amount}
          </span>
        </div>
        {chargedAmount && <div className={classes.secondary}>{chargedAmount}</div>}
      </td>
      <td data-col="situation">{situation}</td>
      <td data-col="arrow">
        <button
          type="button"
          className={classes.arrow}
          aria-label={`Abrir a reserva ${reservationNumber}`}
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
