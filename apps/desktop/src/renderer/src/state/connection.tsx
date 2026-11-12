/**
 * Estado da conexão na interface (specs/002, FR-004, FR-005, data-model §4.1): vem do processo
 * principal pelo evento `connection.onState`. Quando o servidor volta a responder, as consultas da
 * tela são refeitas sozinhas (SC-006).
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ClientIdentity, ConnectionState } from '../../../shared/ipc-types';
import { useHunit } from '../hunit';

export interface ConnectionContextValue {
  /** `null` enquanto o principal não informou o estado. */
  state: ConnectionState | null;
  client: ClientIdentity | null;
  isOnline: boolean;
  /** Ações de operador (iniciar, token, cancelar, retomar) só aparecem para este perfil. */
  isOperator: boolean;
}

const ConnectionContext = createContext<ConnectionContextValue>({
  state: null,
  client: null,
  isOnline: false,
  isOperator: false,
});

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState | null>(null);
  const wasOnline = useRef(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = hunit.connection.onState((next) => setState(next));
    void hunit.connection.getState().then((result) => {
      if (active && result.ok) setState((previous) => previous ?? result.data);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [hunit]);

  useEffect(() => {
    const online = state?.status === 'online';
    if (online && !wasOnline.current) void queryClient.invalidateQueries();
    wasOnline.current = online;
  }, [state, queryClient]);

  const value = useMemo<ConnectionContextValue>(() => {
    const client = state?.status === 'online' ? state.client : null;
    return {
      state,
      client,
      isOnline: state?.status === 'online',
      isOperator: client?.role === 'operator',
    };
  }, [state]);

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  return useContext(ConnectionContext);
}
