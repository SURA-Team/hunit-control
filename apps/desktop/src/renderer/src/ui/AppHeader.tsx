/**
 * Cabeçalho do app (specs/006, FR-002, FR-003; "Cabeçalho do app", node `21:202`): transparente
 * sobre o fundo, com a marca e "HUNIT Control" à esquerda e, à direita, o cliente da API e o perfil num
 * selo branco (Operador em lima, Consulta em cinza). Sem conexão confirmada, só a marca.
 */
import { BrandMark } from './icons';
import classes from './navigation.module.css';
import { StatusBadge } from './StatusBadge';

export type HeaderProfile = 'operator' | 'reader';

export interface AppHeaderProps {
  clientName?: string | null;
  profile?: HeaderProfile | null;
}

export function AppHeader({ clientName = null, profile = null }: AppHeaderProps) {
  return (
    <header className={classes.header}>
      <div className={classes.brand}>
        <BrandMark />
        <span className={classes.appName}>HUNIT Control</span>
      </div>
      {clientName && profile && (
        <div className={classes.client}>
          <span className={classes.clientName} title={clientName}>
            {clientName}
          </span>
          <StatusBadge tone={profile === 'operator' ? 'lime' : 'gray'} size="md">
            {profile === 'operator' ? 'Operador' : 'Consulta'}
          </StatusBadge>
        </div>
      )}
    </header>
  );
}
