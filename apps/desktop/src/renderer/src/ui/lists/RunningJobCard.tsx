/**
 * Card escuro do que está em andamento (specs/006, FR-019, FR-039, research R-13; "Card — execução em
 * andamento", node `53:131`, e a tela 7.7a, aprovada pela UX em 2026-11-18): o selo "Em andamento",
 * quando começou, a linha de apoio, "N de M …" com a barra e o percentual em lima e a ação principal
 * em lima ("Ver detalhes" na execução, "Ver envio" no envio ao Comercial).
 */
import { Action } from '../Action';
import { ProgressBar } from '../ProgressBar';
import { StatusBadge } from '../StatusBadge';
import { Surface } from '../Surface';
import classes from './lists.module.css';

export interface RunningJobCardProps {
  /** "Iniciada em 13/11/2026 · 15:46". */
  title: string;
  /** "Check-in 13/11 a 19/11/2026 · Recepção — PC 1 (esta máquina)". */
  detail?: string;
  /** "2 de 4 hotéis concluídos". */
  progressLabel: string;
  /** De 0 a 100. */
  percent: number;
  actionLabel: string;
  onAction: () => void;
  badge?: string;
}

export function RunningJobCard({
  title,
  detail,
  progressLabel,
  percent,
  actionLabel,
  onAction,
  badge = 'Em andamento',
}: RunningJobCardProps) {
  const rounded = Math.round(Math.max(0, Math.min(100, percent)));
  return (
    <Surface dark>
      <section className={classes.job} data-block={title} aria-label={`${badge}: ${title}`}>
        <div className={classes.jobMain}>
          <StatusBadge tone="lime">{badge}</StatusBadge>
          <p className={classes.jobTitle}>{title}</p>
          {detail && <p className={classes.jobDetail}>{detail}</p>}
        </div>
        <div className={classes.jobProgress}>
          <div className={classes.jobLegend}>
            <span>{progressLabel}</span>
            <span className={classes.jobPercent} data-no-truncate="">
              {rounded}%
            </span>
          </div>
          <ProgressBar value={rounded} label={progressLabel} />
        </div>
        <Action variant="primary" onClick={onAction}>
          {actionLabel}
        </Action>
      </section>
    </Surface>
  );
}

export interface ProgressStripProps {
  /** "2 de 4 hotéis concluídos". */
  label: string;
  /** De 0 a 100. */
  percent: number;
}

/**
 * Faixa escura de progresso (telas 2.6 e 3.2): o texto à esquerda, a barra lima e o percentual em
 * lima, dentro do detalhe e do resultado da execução enquanto ela roda.
 */
export function ProgressStrip({ label, percent }: ProgressStripProps) {
  const rounded = Math.round(Math.max(0, Math.min(100, percent)));
  return (
    <Surface dark>
      <div className={classes.strip}>
        <span className={classes.stripLabel}>{label}</span>
        <div className={classes.stripBar}>
          <ProgressBar value={rounded} label={label} />
        </div>
        <span className={classes.jobPercent} data-no-truncate="">
          {rounded}%
        </span>
      </div>
    </Surface>
  );
}
