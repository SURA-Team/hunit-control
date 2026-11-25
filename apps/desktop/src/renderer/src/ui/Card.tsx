/**
 * Card branco do design (specs/006, FR-001; "Cards e relatórios", node `135:1466`): cantos de 20 px e
 * sombra suave, sem borda. Cada card é um bloco (`data-block`): no máximo uma ação principal dentro
 * dele (FR-007). Espaçamento interno de 16 px (formulários, gaveta), 24, 12 (barra de busca) ou 0
 * (listas). `tone="subtle"` é a caixa cinza sem sombra usada dentro de cards e da gaveta.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import classes from './structure.module.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'style'> {
  children: ReactNode;
  padding?: 0 | 12 | 16 | 24;
  tone?: 'default' | 'subtle';
  /** Nome do bloco, para as mensagens do teste de hierarquia. */
  block?: string;
  component?: 'div' | 'section' | 'form';
}

export function Card({
  children,
  padding = 16,
  tone = 'default',
  block = '',
  component: Component = 'div',
  ...props
}: CardProps) {
  return (
    <Component
      className={classes.card}
      data-padding={padding}
      data-tone={tone}
      data-block={block}
      {...props}
    >
      {children}
    </Component>
  );
}
