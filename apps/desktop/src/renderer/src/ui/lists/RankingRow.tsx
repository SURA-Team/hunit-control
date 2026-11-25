/**
 * Linha do ranking de hotéis (specs/007, T015; research R-10; telas 8.1 e 8.7): número em pílula
 * ("01"), nome do hotel numa linha (inteiro na dica e na gaveta), a barra, o valor à direita e a seta
 * que indica que a linha abre o detalhe. A linha inteira é um botão.
 */
import type { ReactNode } from 'react';
import { ChevronRightIcon } from '../icons';
import classes from './lists.module.css';

export interface RankingListProps {
  children: ReactNode;
  label: string;
  /** Altura máxima em px: acima dela a lista rola dentro do card (FR-019). */
  maxHeight?: number;
}

/** Lista de `RankingRow`, com rolagem própria quando passa da altura. */
export function RankingList({ children, label, maxHeight }: RankingListProps) {
  return (
    <ul
      className={classes.rankingList}
      aria-label={label}
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      {children}
    </ul>
  );
}

export interface RankingRowProps {
  position: number;
  name: string;
  bar: ReactNode;
  /** Já formatado: "R$ 25.831,60". */
  value: string;
  onOpen: () => void;
  disabled?: boolean;
}

export function RankingRow({
  position,
  name,
  bar,
  value,
  onOpen,
  disabled = false,
}: RankingRowProps) {
  return (
    <li>
      <button
        type="button"
        className={classes.ranking}
        onClick={onOpen}
        disabled={disabled}
        aria-label={`Abrir o detalhe de ${name}`}
      >
        <span className={classes.rankingPosition} aria-hidden="true">
          {String(position).padStart(2, '0')}
        </span>
        <span className={classes.rankingName} title={name}>
          {name}
        </span>
        <span className={classes.rankingBar}>{bar}</span>
        <span className={classes.rankingValue} data-no-truncate="">
          {value}
        </span>
        <span className={classes.rankingArrow} aria-hidden="true">
          <ChevronRightIcon />
        </span>
      </button>
    </li>
  );
}
