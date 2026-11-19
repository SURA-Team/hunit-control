/**
 * Cabeçalho da página (specs/006; telas 4.1 e 7.7a): título de 34 px, subtítulo opcional e, à
 * direita, a ação da página ("Copiar para e-mail") e avisos como "dados de HH:MM — servidor
 * indisponível". Também o título de seção ("Histórico") dentro do conteúdo.
 */
import type { ReactNode } from 'react';
import classes from './structure.module.css';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Ação e avisos à direita do título. */
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className={classes.pageHeader}>
      <div className={classes.pageTitles}>
        <h1 className={classes.pageTitle}>{title}</h1>
        {subtitle && <p className={classes.pageSubtitle}>{subtitle}</p>}
      </div>
      {action && <div className={classes.pageActions}>{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, order = 2 }: { children: ReactNode; order?: 2 | 3 }) {
  const Heading = order === 2 ? 'h2' : 'h3';
  return <Heading className={classes.sectionTitle}>{children}</Heading>;
}
