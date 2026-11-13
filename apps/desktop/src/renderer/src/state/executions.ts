/**
 * Estado de uma execução na interface (specs/002, FR-016, research R-06): vem sempre do GET; os
 * eventos do servidor só avisam que é hora de buscar de novo — no máximo uma vez por segundo, com
 * uma última busca depois da rajada. Enquanto a tela mostra a execução, o principal acompanha o
 * fluxo de eventos dela (`watch`/`unwatch`).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { unwrap, useHunit } from '../hunit';

const REFRESH_INTERVAL_MS = 1_000;

export const executionKey = (executionId: string) => ['execution', executionId] as const;

export function useExecution(executionId: string | null) {
  const hunit = useHunit();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: executionKey(executionId ?? ''),
    queryFn: () => unwrap(hunit.executions.get(executionId ?? '')),
    enabled: executionId !== null,
  });

  useEffect(() => {
    if (executionId === null) return;
    void hunit.executions.watch(executionId);

    let lastRefresh = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      lastRefresh = Date.now();
      void queryClient.invalidateQueries({ queryKey: executionKey(executionId) });
    };
    const unsubscribe = hunit.executions.onChanged((event) => {
      if (event.executionId !== executionId) return;
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
      void hunit.executions.unwatch(executionId);
    };
  }, [executionId, hunit, queryClient]);

  return query;
}
