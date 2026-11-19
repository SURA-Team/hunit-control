/**
 * Linha genérica das listas em tabela (specs/006, T052; telas 7.8 e 7.9): uma célula por coluna do
 * cabeçalho (`ListHeader`), na mesma ordem, com a caixa de seleção opcional à esquerda e a seta
 * opcional à direita. As listas de reservas e de execuções têm linhas próprias (`ReservationRow`,
 * `ExecutionRow`); esta serve às da área Comercial.
 *
 * - `ListCell`: o texto da célula em duas linhas (principal e apoio), como as do design; `narrow` e
 *   `compact` são o que entra na célula quando a coluna de onde vieram some (conteúdo abaixo de 1 000
 *   e de 720 px, research R-07): o responsável vai para a linha da reserva e a diferença para a dos
 *   valores, por exemplo;
 * - `ListActions`: as ações da linha, lado a lado; abaixo de 820 px, uma embaixo da outra.
 *
 * Uma linha com ação principal própria ("Confirmar" em cada retorno) é um bloco (`block`): a regra
 * de uma principal por bloco vale por linha (FR-007).
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronRightIcon } from '../icons';
import type { ListColumn, ListColumnKey } from './ListCard';
import classes from './lists.module.css';

export interface ListRowProps {
  columns: readonly ListColumn[];
  cells: Partial<Record<ListColumnKey, ReactNode>>;
  /** Conteúdo da coluna de seleção (a caixa); sem ele, não há coluna. */
  select?: ReactNode;
  /** A seta e o clique na linha abrem o detalhe. */
  onOpen?: () => void;
  /** Nome do botão da seta, ex.: "Abrir a reserva 101-1005". */
  openLabel?: string;
  /** A linha tem uma coluna de seta vazia (as outras linhas da lista abrem um detalhe). */
  withArrow?: boolean;
  selected?: boolean;
  /** Nome do bloco, quando a linha tem a ação principal dela. */
  block?: string;
}

export function ListRow({
  columns,
  cells,
  select,
  onOpen,
  openLabel,
  withArrow = onOpen !== undefined,
  selected = false,
  block,
}: ListRowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (onOpen && event.key === 'Enter' && event.target === event.currentTarget) onOpen();
  };
  return (
    <tr
      className={classes.row}
      data-kind="list"
      data-clickable={onOpen ? '' : undefined}
      data-selected={selected || undefined}
      data-block={block}
      {...(onOpen && { tabIndex: 0, onClick: onOpen, onKeyDown })}
    >
      {select !== undefined && <td data-col="select">{select}</td>}
      {columns.map((column) => (
        <td key={column.key} data-col={column.key}>
          {cells[column.key]}
        </td>
      ))}
      {withArrow && (
        <td data-col="arrow">
          {onOpen && (
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
          )}
        </td>
      )}
    </tr>
  );
}

export interface ListCellProps {
  primary: ReactNode;
  secondary?: ReactNode;
  /** Mostrado só no conteúdo abaixo de 1 000 px (a coluna de onde veio some). */
  narrow?: ReactNode;
  /** Mostrado só no conteúdo abaixo de 720 px. */
  compact?: ReactNode;
  /** Texto principal em negrito (número da reserva, data do envio). */
  strong?: boolean;
  /** O texto principal vira um botão que abre o detalhe (o número da reserva, tela 7.8). */
  onOpen?: () => void;
  /** Nome do botão, ex.: "Abrir a reserva 101-1002". */
  openLabel?: string;
}

export function ListCell({
  primary,
  secondary,
  narrow,
  compact,
  strong = false,
  onOpen,
  openLabel,
}: ListCellProps) {
  return (
    <>
      <div className={strong ? classes.strong : classes.primary}>
        {onOpen ? (
          <button
            type="button"
            className={classes.cellButton}
            aria-label={openLabel}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {primary}
          </button>
        ) : (
          primary
        )}
      </div>
      {secondary && <div className={classes.secondary}>{secondary}</div>}
      {narrow && <div className={`${classes.secondary} ${classes.narrowOnly}`}>{narrow}</div>}
      {compact && <div className={`${classes.secondary} ${classes.compactOnly}`}>{compact}</div>}
    </>
  );
}

/** As ações da linha: lado a lado; abaixo de 820 px, uma embaixo da outra. */
export function ListActions({ children }: { children: ReactNode }) {
  return <div className={classes.rowActions}>{children}</div>;
}
