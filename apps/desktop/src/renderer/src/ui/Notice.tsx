/**
 * Aviso dentro da tela (specs/006; "Alerta" do design, node `21:163`): título no tom e a mensagem em
 * texto padrão, sobre o fundo do tom. Ícone e ação são opcionais (o design não os desenha; a ação fica
 * à direita). Por padrão é anunciado como `alert`, como o Alert do Mantine que ele substitui.
 */
import type { ReactNode } from 'react';
import classes from './status.module.css';

export type NoticeTone = 'lime' | 'green' | 'red' | 'amber';

export interface NoticeProps {
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  role?: 'alert' | 'status' | 'none';
  'data-testid'?: string;
}

export function Notice({
  tone,
  title,
  children,
  icon,
  action,
  role = 'alert',
  ...rest
}: NoticeProps) {
  return (
    <div
      className={classes.notice}
      data-tone={tone}
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
