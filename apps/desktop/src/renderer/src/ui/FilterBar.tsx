/**
 * Barra de busca e filtros da lista (specs/006, FR-016, FR-034, research R-10 e R-11; tela 4.1, node
 * `71:9228`, e 4.12, node `125:3670`):
 * - `FilterBar`: card branco com a busca, a "Origem" e o botão "Filtros", em uma linha que quebra
 *   quando não cabe (FR-044); o painel abre preso a ela;
 * - `FilterPanel`: "Filtros avançados", card flutuante à direita, abaixo da barra, com os campos em
 *   duas colunas. Os campos valem na hora (não há "Aplicar"). Não é um diálogo: a lista continua
 *   usável; fecha pelo X, por Esc ou pelo botão que o abriu. Não fecha ao clicar fora, porque os
 *   seletores e o calendário de dentro abrem as próprias listas fora do painel;
 * - `AppliedFilters` e `RemovableChip`: a linha "Filtros aplicados", um chip por filtro do painel em
 *   vigor, cada um com o X para tirá-lo.
 */
import type { ReactNode } from 'react';
import { Action } from './Action';
import { Card } from './Card';
import classes from './FilterBar.module.css';
import { CloseIcon } from './icons';

export interface FilterBarProps {
  /** Busca, Origem e o botão "Filtros". */
  children: ReactNode;
  /** O painel, que se posiciona abaixo da barra. */
  panel?: ReactNode;
}

export function FilterBar({ children, panel }: FilterBarProps) {
  return (
    <div className={classes.anchor}>
      <Card padding={12} block="busca e filtros">
        <div className={classes.row}>{children}</div>
      </Card>
      {panel}
    </div>
  );
}

/** A busca ocupa o espaço que sobra na linha da barra. */
export function FilterBarSearch({ children }: { children: ReactNode }) {
  return <div className={classes.search}>{children}</div>;
}

export interface FilterPanelProps {
  id: string;
  opened: boolean;
  onClose: () => void;
  title?: string;
  /** Os campos, em duas colunas; `FilterPanelWide` ocupa a linha inteira. */
  children: ReactNode;
}

export function FilterPanel({
  id,
  opened,
  onClose,
  title = 'Filtros avançados',
  children,
}: FilterPanelProps) {
  if (!opened) return null;
  return (
    <section
      id={id}
      className={classes.panel}
      aria-label={title}
      data-block={title}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // Esc numa lista aberta (seletor, calendário) fecha só a lista. As listas abrem fora do
        // painel (o evento chega pela árvore do React) ou ainda marcam o campo como aberto.
        const target = event.target as HTMLElement;
        const fromList =
          !event.currentTarget.contains(target) || target.getAttribute('aria-expanded') === 'true';
        if (!fromList) onClose();
      }}
    >
      <div className={classes.panelHeader}>
        <h2 className={classes.panelTitle}>{title}</h2>
        <button
          type="button"
          className={classes.iconButton}
          aria-label="Fechar os filtros"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className={classes.grid}>{children}</div>
    </section>
  );
}

/** Campo do painel que ocupa as duas colunas ("Só as não encontradas…"). */
export function FilterPanelWide({ children }: { children: ReactNode }) {
  return <div className={classes.wide}>{children}</div>;
}

export interface RemovableChipProps {
  label: string;
  /** Nome do filtro para o leitor de tela: "Tirar o filtro {removeLabel}". */
  removeLabel?: string;
  onRemove: () => void;
}

export function RemovableChip({ label, removeLabel = label, onRemove }: RemovableChipProps) {
  return (
    <span className={classes.chip}>
      <span className={classes.chipLabel} title={label}>
        {label}
      </span>
      <button
        type="button"
        className={classes.chipRemove}
        aria-label={`Tirar o filtro ${removeLabel}`}
        onClick={onRemove}
      >
        <CloseIcon size={14} />
      </button>
    </span>
  );
}

export interface AppliedFiltersProps {
  /** Os `RemovableChip`. */
  children: ReactNode;
  /** "Limpar busca e filtros" (FR-021). */
  onClearAll?: () => void;
}

export function AppliedFilters({ children, onClearAll }: AppliedFiltersProps) {
  return (
    <div className={classes.applied} role="group" aria-label="Filtros aplicados">
      <span className={classes.appliedLabel}>Filtros aplicados</span>
      {children}
      {onClearAll && (
        <Action variant="text" size="xs" onClick={onClearAll}>
          Limpar busca e filtros
        </Action>
      )}
    </div>
  );
}
