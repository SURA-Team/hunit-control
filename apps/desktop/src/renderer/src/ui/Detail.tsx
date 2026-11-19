/**
 * Peças do detalhe numa gaveta (specs/006, T044; telas 4.2, 4.7, 4.9 e 4.11, node `71:9897`):
 * - `DetailHeader`: "Reserva 101-1002" (estilo "Título da seção"), a linha de apoio ("hotel 101") e os
 *   selos à direita, lado a lado; quebra linha quando não cabe;
 * - `DataGrid` e `DataField`: os dados em três colunas (rótulo pequeno e apagado em cima, valor
 *   embaixo), 16 px entre colunas e 12 px entre linhas; com menos de 520 px de largura, duas colunas.
 *   Valores longos quebram linha, nunca saem da coluna;
 * - `CardHeader`: o título do card (estilo "Corpo forte", como "Tratativa" e "Cobrança"), o que vai
 *   ao lado dele (selo ou "Sem tratativa") e as ações à direita.
 */
import type { ReactNode } from 'react';
import { StatusBadge, type SituationBadgeItem } from './StatusBadge';
import classes from './structure.module.css';

export interface DetailHeaderProps {
  title: string;
  /** "hotel 101". */
  subtitle?: string;
  /** Selos à direita, na ordem: situação, "Verificar", "Não identificada", ativa ou cancelada. */
  badges?: readonly SituationBadgeItem[];
}

export function DetailHeader({ title, subtitle, badges = [] }: DetailHeaderProps) {
  return (
    <div className={classes.detailHeader}>
      <h3 className={classes.detailTitle}>
        {title}
        {/* O espaço fica fora do span: o nome acessível é "Reserva 101-1002 hotel 101". */}
        {subtitle && (
          <>
            {' '}
            <span className={classes.detailSubtitle}>{subtitle}</span>
          </>
        )}
      </h3>
      {badges.length > 0 && (
        <span className={classes.detailBadges}>
          {badges.map((badge) => (
            <StatusBadge key={badge.label} tone={badge.tone} title={badge.title}>
              {badge.label}
            </StatusBadge>
          ))}
        </span>
      )}
    </div>
  );
}

export function DataGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className={classes.dataGridFrame}>
      <dl className={classes.dataGrid} aria-label={label}>
        {children}
      </dl>
    </div>
  );
}

export interface DataFieldProps {
  label: string;
  /** Sem valor, "—". */
  children?: ReactNode;
}

export function DataField({ label, children }: DataFieldProps) {
  return (
    <div className={classes.dataField}>
      <dt className={classes.dataLabel}>{label}</dt>
      <dd className={classes.dataValue}>{children ?? '—'}</dd>
    </div>
  );
}

export interface CardHeaderProps {
  title: string;
  /** Ao lado do título: o selo da situação ou um texto curto ("Sem tratativa"). */
  aside?: ReactNode;
  /** À direita; quebram para a linha de baixo quando não cabem. */
  actions?: ReactNode;
}

export function CardHeader({ title, aside, actions }: CardHeaderProps) {
  return (
    <div className={classes.cardHeader}>
      <div className={classes.cardTitleLine}>
        <h4 className={classes.cardTitle}>{title}</h4>
        {aside}
      </div>
      {actions && <div className={classes.cardActions}>{actions}</div>}
    </div>
  );
}

/** Texto curto ao lado do título do card, apagado ("Sem tratativa"). */
export function CardAside({ children }: { children: ReactNode }) {
  return <span className={classes.cardAside}>{children}</span>;
}

/**
 * Caixas de indicadores (tela 7.10, "Situação da planilha"): caixas cinza lado a lado, cada uma com o
 * rótulo pequeno e o valor em negrito; quebram linha quando não cabem (no mínimo 150 px cada).
 */
export function DataTiles({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className={classes.dataTiles} aria-label={label}>
      {children}
    </dl>
  );
}

export function DataTile({ label, children }: DataFieldProps) {
  return (
    <div className={classes.dataTile}>
      <dt className={classes.dataLabel}>{label}</dt>
      <dd className={classes.dataTileValue}>{children ?? '—'}</dd>
    </div>
  );
}
