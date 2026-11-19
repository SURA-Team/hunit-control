/**
 * Card de lista com cabeçalho de colunas (specs/006, FR-014, research R-08; "Cabeçalho — lista de
 * reservas", node `53:94`, e "… de execuções", `53:126`). A lista é uma tabela (papéis `row` e `cell`
 * para o leitor de tela e os testes), com as larguras das colunas do design; o card mede o próprio
 * espaço (`@container`) para reorganizar as colunas em conteúdo estreito (research R-07).
 */
import type { ReactNode } from 'react';
import classes from './lists.module.css';

/** Colunas conhecidas (as larguras ficam em lists.module.css). */
export type ListColumnKey =
  | 'select'
  | 'guest'
  | 'hotel'
  | 'period'
  | 'amount'
  | 'situation'
  | 'execution'
  | 'result'
  | 'status'
  | 'arrow'
  | 'reservation'
  | 'chargeHotel'
  | 'amounts'
  | 'difference'
  | 'responsible'
  | 'actions'
  | 'problem'
  | 'message'
  | 'when'
  | 'count';

export interface ListColumn {
  key: ListColumnKey;
  label: ReactNode;
}

/** Colunas da lista de reservas (tela 4.1). */
export const RESERVATION_COLUMNS: readonly ListColumn[] = [
  { key: 'guest', label: 'Hóspede' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'period', label: 'Período' },
  { key: 'amount', label: 'Valor' },
  { key: 'situation', label: 'Situação da reserva' },
];

/** Colunas da lista de execuções e de envios (telas 3.1 e 7.7). */
export const EXECUTION_COLUMNS: readonly ListColumn[] = [
  { key: 'execution', label: 'Execução' },
  { key: 'result', label: 'Resultado' },
  { key: 'status', label: 'Situação' },
];

/** Colunas da lista de envios ao Comercial (tela 7.7): as de execuções, com "Envio". */
export const DISPATCH_COLUMNS: readonly ListColumn[] = [
  { key: 'execution', label: 'Envio' },
  { key: 'result', label: 'Resultado' },
  { key: 'status', label: 'Situação' },
];

export interface ListHeaderProps {
  columns: readonly ListColumn[];
  /** Conteúdo da coluna de seleção (a caixa "selecionar todas da página"); sem ele, não há coluna. */
  select?: ReactNode;
  /** Coluna vazia da seta, quando as linhas abrem um detalhe. */
  withArrow?: boolean;
}

export function ListHeader({ columns, select, withArrow = true }: ListHeaderProps) {
  return (
    <thead>
      <tr>
        {select !== undefined && <th data-col="select">{select}</th>}
        {columns.map((column) => (
          <th key={column.key} scope="col" data-col={column.key}>
            {column.label}
          </th>
        ))}
        {withArrow && <td data-col="arrow" />}
      </tr>
    </thead>
  );
}

export interface ListCardProps {
  /** Nome da lista para o leitor de tela (ex.: "Reservas"). */
  label: string;
  header: ReactNode;
  /** As linhas (`ReservationRow`, `ExecutionRow`, `ListRow`). */
  children: ReactNode;
  /** Faixa cinza acima do cabeçalho com as ações da lista ("Confirmar marcados", tela 7.8). */
  toolbar?: ReactNode;
}

export function ListCard({ label, header, children, toolbar }: ListCardProps) {
  return (
    <div className={classes.card}>
      {toolbar && <div className={classes.toolbar}>{toolbar}</div>}
      <table className={classes.table} aria-label={label}>
        {header}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Lista em tabela dentro de uma caixa cinza, para diálogos (telas 7.12 e 7.13): as mesmas colunas e
 * linhas (`ListHeader`, `ListRow`) das listas, sem o card. Mede o próprio espaço, como o card, para
 * as colunas que somem em conteúdo estreito.
 */
export function InsetList({
  label,
  header,
  children,
}: {
  label: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={classes.inset}>
      <table className={classes.table} aria-label={label}>
        {header}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Lista de linhas simples (`HotelRow`, `CompactReservationRow`). */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className={classes.rowList} aria-label={label}>
      {children}
    </ul>
  );
}
