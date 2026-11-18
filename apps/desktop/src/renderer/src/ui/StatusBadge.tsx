/**
 * Selo de situação (specs/006, FR-005, FR-006; "Badge" do design, node `21:102`). O tom diz o tipo e
 * o texto sempre acompanha (nenhuma informação só por cor):
 * - `lime`: em andamento, destaque; `amber`: atenção, pendente; `green`: concluído, aceito;
 * - `red`: erro; `gray`: neutro, enviado;
 * - `alert`: âmbar cheio, só para o que pede ação ("Verificar").
 * Em maiúsculas pelo estilo; o texto da página continua como foi escrito. Nunca é cortado.
 */
import classes from './status.module.css';

export type BadgeTone = 'lime' | 'amber' | 'green' | 'red' | 'gray' | 'alert';

export interface StatusBadgeProps {
  tone: BadgeTone;
  children: string;
  /** Explicação ao passar o mouse. */
  title?: string;
  /** `md` (20 px): o selo do perfil no cabeçalho. */
  size?: 'sm' | 'md';
}

export function StatusBadge({ tone, children, title, size = 'sm' }: StatusBadgeProps) {
  return (
    <span
      className={classes.badge}
      data-tone={tone}
      data-size={size}
      title={title}
      data-no-truncate=""
    >
      {children}
    </span>
  );
}

export interface SituationBadgeItem {
  label: string;
  tone: BadgeTone;
  title?: string;
}

/**
 * Pilha de selos da reserva (specs/006, FR-014; "Linha de reserva", node `53:93`): a situação e,
 * quando houver, "Verificar", "Sistema anterior" e "Não identificada", um embaixo do outro.
 */
export function SituationBadges({ items }: { items: readonly SituationBadgeItem[] }) {
  return (
    <span className={classes.stack}>
      {items.map((item) => (
        <StatusBadge key={item.label} tone={item.tone} title={item.title}>
          {item.label}
        </StatusBadge>
      ))}
    </span>
  );
}
