/**
 * Diálogo padrão do app (specs/006, FR-042, FR-047, research R-14; telas 2.4, 3.3, 4.6, 7.1, 7.6):
 * - só duas larguras: `sm` (520 px) e `lg` (780 px), sempre com 24 px de margem da janela;
 * - 24 px de espaçamento interno, título no estilo "Título do diálogo", fechar no topo ("Fechar o
 *   diálogo", diferente de um "Fechar" no rodapé);
 * - limitado à altura visível: rola por dentro e o cabeçalho com o fechar fica fixo;
 * - rodapé com as ações à direita: "Cancelar" (texto, por `onCancel`) à esquerda da principal;
 * - `dark`: superfície escura (o token), onde a principal fica lima.
 * O conteúdo é um bloco: no máximo uma ação principal (FR-007). Os botões do rodapé usam `size="sm"`.
 * Com `onSubmit`, o conteúdo e o rodapé formam um formulário (Enter envia; a principal é `type="submit"`).
 */
import { Modal } from '@mantine/core';
import type { FormEvent, ReactNode } from 'react';
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
  /** Linha abaixo do título (ex.: "Envio ao Comercial" no diálogo do token). */
  subtitle?: ReactNode;
  /** Camada acima de painéis e diálogos abertos (o token tem prazo curto). */
  zIndex?: number;
  /** Abre e fecha sem animação. */
  instant?: boolean;
  /** Conteúdo e rodapé num formulário, enviado por esta função. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
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
  subtitle,
  zIndex,
  instant = false,
  onSubmit,
  'data-testid': testId,
}: AppDialogProps) {
  const body = (
    <>
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
    </>
  );
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
      {...(zIndex !== undefined && { zIndex })}
      {...(instant && { transitionProps: { duration: 0 } })}
      // Classes pelo Root: no Mantine 9, `className` no Modal.Content também vai para o contêiner de
      // tela cheia (`inner`), que ficaria branco por cima da sobreposição.
      classNames={{
        content: classes.dialogContent,
        header: classes.dialogHeader,
        title: classes.dialogTitle,
        close: classes.close,
        body: classes.dialogBody,
      }}
    >
      <Modal.Overlay
        color={colors['sobreposição']}
        backgroundOpacity={overlay.opacity}
        blur={overlay.blur}
      />
      <Modal.Content
        data-block={typeof title === 'string' ? title : 'diálogo'}
        data-size={size}
        data-dark={dark || undefined}
        data-testid={testId}
      >
        <Modal.Header>
          <Modal.Title>
            {title}
            {subtitle && <span className={classes.dialogSubtitle}>{subtitle}</span>}
          </Modal.Title>
          {withCloseButton && (
            <Modal.CloseButton icon={<CloseIcon />} aria-label="Fechar o diálogo" />
          )}
        </Modal.Header>
        <Modal.Body>
          <Surface dark={dark}>
            {onSubmit ? (
              <form className={classes.dialogForm} onSubmit={onSubmit}>
                {body}
              </form>
            ) : (
              body
            )}
          </Surface>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
