/**
 * Aviso dentro da tela (specs/006; "Alerta" do design, node `21:163`): título no tom e a mensagem em
 * texto padrão, sobre o fundo do tom. Ícone e ação são opcionais; o ícone fica num círculo cheio do tom
 * (o "!" do alerta "Verificar", tela 4.9) e a ação, à direita. Por padrão é anunciado como `alert`,
 * como o Alert do Mantine que ele substitui. Com `block`, o aviso é um bloco à parte para a regra de
 * uma ação principal por bloco (o "Confirmar" do "Verificar" dentro do card "Tratativa").
 */
import type { ReactNode } from 'react';
import classes from './status.module.css';

/** `gray`: nota neutra, em caixa cinza com borda, texto de descrição e o ícone sem círculo (008). */
export type NoticeTone = 'lime' | 'green' | 'red' | 'amber' | 'gray';

export interface NoticeProps {
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  role?: 'alert' | 'status' | 'none';
  /** Só o texto, em negrito no tom, para avisos curtos ao lado do título ("dados de 14:05 — …"). */
  compact?: boolean;
  /** Nome do bloco (`data-block`), quando o aviso tem a ação principal dele. */
  block?: string;
  'data-testid'?: string;
}

export function Notice({
  tone,
  title,
  children,
  icon,
  action,
  role = 'alert',
  compact = false,
  block,
  ...rest
}: NoticeProps) {
  return (
    <div
      className={classes.notice}
      data-tone={tone}
      data-compact={compact || undefined}
      data-block={block}
      role={role === 'none' ? undefined : role}
      {...rest}
    >
      {icon && <span className={classes.noticeIcon}>{icon}</span>}
      <div className={classes.noticeText}>
        {title && <div className={classes.noticeTitle}>{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}
