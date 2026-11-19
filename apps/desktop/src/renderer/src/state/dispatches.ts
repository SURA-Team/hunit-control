/**
 * Estado de um envio ao Comercial na interface (specs/005, research R-14): como as execuções
 * (`state/executions.ts`), vem sempre do GET; os eventos do servidor só avisam que é hora de buscar
 * de novo — no máximo uma vez por segundo, com uma última busca depois da rajada. Enquanto a tela
 * mostra o envio, o principal acompanha o fluxo de eventos dele (`watch`/`unwatch`).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { unwrap, useHunit } from '../hunit';

const REFRESH_INTERVAL_MS = 1_000;

export const dispatchKey = (dispatchId: string) => ['dispatch', dispatchId] as const;

export function useDispatch(dispatchId: string | null) {
  const hunit = useHunit();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: dispatchKey(dispatchId ?? ''),
    queryFn: () => unwrap(hunit.dispatches.get(dispatchId ?? '')),
    enabled: dispatchId !== null,
  });

  useEffect(() => {
    if (dispatchId === null) return;
    void hunit.dispatches.watch(dispatchId);

    let lastRefresh = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      lastRefresh = Date.now();
      void queryClient.invalidateQueries({ queryKey: dispatchKey(dispatchId) });
    };
    const unsubscribe = hunit.dispatches.onChanged((event) => {
      if (event.dispatchId !== dispatchId) return;
      const wait = lastRefresh + REFRESH_INTERVAL_MS - Date.now();
      if (wait <= 0) {
        refresh();
      } else if (trailing === null) {
        trailing = setTimeout(() => {
          trailing = null;
          refresh();
        }, wait);
      }
    });

    return () => {
      unsubscribe();
      if (trailing !== null) clearTimeout(trailing);
      void hunit.dispatches.unwatch(dispatchId);
    };
  }, [dispatchId, hunit, queryClient]);

  return query;
}
