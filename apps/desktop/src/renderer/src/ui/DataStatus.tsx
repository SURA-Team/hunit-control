/**
 * Selo do estado dos dados (specs/007, US5, FR-004; telas 8.1 e 8.5): verde "Dados atualizados",
 * lima "Atualizando…" e âmbar "dados de HH:MM — servidor indisponível". Anunciado como `status`.
 */
import classes from './status.module.css';

export interface DataStatusProps {
  tone: 'green' | 'lime' | 'amber';
  children: string;
}

export function DataStatus({ tone, children }: DataStatusProps) {
  return (
    <span className={classes.dataStatus} data-tone={tone} role="status" data-no-truncate="">
      {children}
    </span>
  );
}
