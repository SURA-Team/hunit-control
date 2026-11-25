/**
 * Ação sobre um documento anexado (specs/006, FR-009, FR-010; "Ação de documento" do design, node
 * `80:89`). O tipo fixa a cor e o ícone, para "Baixar", "Reverter" e "Desfazer" nunca se confundirem:
 * - `download` (Baixar): neutra, segura;
 * - `revert` (Reverter): restaura a versão anterior, âmbar;
 * - `undo` (Desfazer) e `remove` (Remover valor): destrutivas, vermelho suave.
 * O rótulo padrão de cada tipo pode ser trocado (ex.: "Baixar comprovante").
 */
import { Button } from '@mantine/core';
import type { ComponentPropsWithoutRef, ComponentType, ReactNode, Ref } from 'react';
import classes from './DocumentAction.module.css';
import { DownloadIcon, RemoveIcon, RevertIcon, UndoIcon, type IconProps } from './icons';

export type DocumentActionKind = 'download' | 'revert' | 'undo' | 'remove';

const KINDS: Record<DocumentActionKind, { label: string; Icon: ComponentType<IconProps> }> = {
  download: { label: 'Baixar', Icon: DownloadIcon },
  revert: { label: 'Reverter', Icon: RevertIcon },
  undo: { label: 'Desfazer', Icon: UndoIcon },
  remove: { label: 'Remover valor', Icon: RemoveIcon },
};

export interface DocumentActionProps extends Omit<
  ComponentPropsWithoutRef<'button'>,
  'color' | 'style' | 'className' | 'children'
> {
  kind: DocumentActionKind;
  /** Rótulo no lugar do padrão do tipo. */
  children?: ReactNode;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function DocumentAction({ kind, children, ref, ...props }: DocumentActionProps) {
  const { label, Icon } = KINDS[kind];
  return (
    <Button
      ref={ref}
      variant="document"
      classNames={{ root: classes.root, section: classes.section }}
      leftSection={<Icon size={16} />}
      data-kind={kind}
      data-no-truncate=""
      {...props}
    >
      {children ?? label}
    </Button>
  );
}
