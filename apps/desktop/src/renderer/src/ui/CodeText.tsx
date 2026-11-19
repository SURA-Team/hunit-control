/** Código em fonte monoespaçada, que quebra em qualquer ponto (impressão digital do certificado, tela 1.2). */
import type { ReactNode } from 'react';
import classes from './status.module.css';

export function CodeText({ children }: { children: ReactNode }) {
  return <code className={classes.code}>{children}</code>;
}
