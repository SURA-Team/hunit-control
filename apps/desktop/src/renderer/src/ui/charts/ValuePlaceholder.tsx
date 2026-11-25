/**
 * Número ainda carregando (specs/007, FR-009): uma faixa cinza no lugar do valor, com "Carregando"
 * para o leitor de tela. Nunca um zero que pareça dado.
 */
import classes from './charts.module.css';

export function ValuePlaceholder({ width = 120 }: { width?: number }) {
  return (
    <span
      className={classes.placeholder}
      style={{ ['--placeholder-width' as string]: `${width}px` }}
      aria-busy="true"
    >
      <span className={classes.visuallyHidden}>Carregando</span>
    </span>
  );
}
