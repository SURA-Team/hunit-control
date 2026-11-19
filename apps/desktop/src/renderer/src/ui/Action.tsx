/**
 * Botão do app (specs/006, FR-007 a FR-013, research R-06; "Botão" do design, node `21:75`). Só as
 * variantes da hierarquia, sem cor livre:
 * - `primary`: a ação principal do bloco (no máximo uma por bloco ou diálogo); preta, e lima dentro de
 *   uma superfície escura (`<Surface dark>`);
 * - `secondary`: contorno, para ações seguras e equivalentes (Filtros, Substituir, Testar);
 * - `text`: Cancelar, Sair, Desmarcar todas;
 * - `warning`: atenção (âmbar);
 * - `danger-light`: destrutiva (Limpar acesso, Desfazer, Remover valor);
 * - `danger`: destrutiva confirmada ("Sim, cancelar").
 *
 * Tamanhos: `xs` (30 px, dentro dos cards da gaveta), `sm` (36 px, rodapé de diálogos e gavetas),
 * `md` (40 px, padrão) e `lg` (48 px). O elemento leva `data-variant` (o teste de hierarquia conta os
 * `primary` por bloco) e `data-no-truncate` (o rótulo nunca é cortado, FR-045).
 */
import { Button, type ButtonProps } from '@mantine/core';
import type { ComponentPropsWithoutRef, Ref } from 'react';
import classes from './Action.module.css';
import { useSurface } from './Surface';

export type ActionVariant =
  'primary' | 'secondary' | 'text' | 'warning' | 'danger-light' | 'danger';
export type ActionSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ActionProps
  extends
    Omit<ComponentPropsWithoutRef<'button'>, 'color' | 'style' | 'className'>,
    Pick<ButtonProps, 'leftSection' | 'rightSection' | 'loading' | 'fullWidth'> {
  variant: ActionVariant;
  size?: ActionSize;
  ref?: Ref<HTMLButtonElement>;
}

export function Action({ variant, size = 'md', ref, children, ...props }: ActionProps) {
  const surface = useSurface();
  return (
    <Button
      ref={ref}
      variant={variant}
      classNames={{ root: classes.root, section: classes.section }}
      data-size={size}
      data-surface={surface}
      data-no-truncate=""
      {...props}
    >
      {children}
    </Button>
  );
}
