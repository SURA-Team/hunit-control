/**
 * Diálogo padrão do app (specs/006, FR-042, FR-047, research R-14; telas 2.4, 3.3, 4.6, 7.1, 7.6):
 * - só duas larguras: `sm` (520 px) e `lg` (780 px), sempre com 24 px de margem da janela;
 * - 24 px de espaçamento interno, título no estilo "Título do diálogo", fechar no topo;
 * - limitado à altura visível: rola por dentro e o cabeçalho com o fechar fica fixo;
 * - rodapé com as ações à direita: "Cancelar" (texto, por `onCancel`) à esquerda da principal;
 * - `dark`: superfície escura (o token), onde a principal fica lima.
 * O conteúdo é um bloco: no máximo uma ação principal (FR-007). Os botões do rodapé usam `size="sm"`.
 */
import { Modal } from '@mantine/core';
import type { ReactNode } from 'react';
import { Action } from './Action';
import { CloseIcon } from './icons';
import classes from './structure.module.css';
import { Surface } from './Surface';
import { colors, layout, overlay } from './tokens';

export interface AppDialogProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'lg';
  dark?: boolean;
  /** Ações do rodapé, com a principal por último. */
  actions?: ReactNode;
  /** Mostra "Cancelar" (texto) à esquerda das ações. */
  onCancel?: () => void;
  cancelLabel?: string;
  withCloseButton?: boolean;
  closeOnClickOutside?: boolean;
  closeOnEscape?: boolean;
  'data-testid'?: string;
}

export function AppDialog({
  opened,
  onClose,
  title,
  children,
  size = 'sm',
  dark = false,
  actions,
  onCancel,
  cancelLabel = 'Cancelar',
  withCloseButton = true,
  closeOnClickOutside = true,
  closeOnEscape = true,
  'data-testid': testId,
}: AppDialogProps) {
  return (
    <Modal.Root
      opened={opened}
      onClose={onClose}
      size={size === 'lg' ? layout.dialogLg : layout.dialogSm}
      centered
      xOffset={24}
      yOffset={24}
      padding={24}
      closeOnClickOutside={closeOnClickOutside}
      closeOnEscape={closeOnEscape}
    >
      <Modal.Overlay
        color={colors['sobreposição']}
        backgroundOpacity={overlay.opacity}
        blur={overlay.blur}
      />
      <Modal.Content
        className={classes.dialogContent}
        data-block={typeof title === 'string' ? title : 'diálogo'}
        data-size={size}
        data-dark={dark || undefined}
        data-testid={testId}
      >
        <Modal.Header className={classes.dialogHeader}>
          <Modal.Title className={classes.dialogTitle}>{title}</Modal.Title>
          {withCloseButton && (
            <Modal.CloseButton className={classes.close} icon={<CloseIcon />} aria-label="Fechar" />
          )}
        </Modal.Header>
        <Modal.Body className={classes.dialogBody}>
          <Surface dark={dark}>
            {children}
            {(actions || onCancel) && (
              <div className={classes.dialogFooter}>
                {onCancel && (
                  <Action variant="text" size="sm" onClick={onCancel}>
                    {cancelLabel}
                  </Action>
                )}
                {actions}
              </div>
            )}
          </Surface>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
