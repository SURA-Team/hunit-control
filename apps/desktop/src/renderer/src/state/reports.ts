/**
 * Resumo do período do módulo de Relatórios (specs/007, research R-06): uma consulta por período, sem
 * atualização automática (só ao abrir, trocar o período ou "Atualizar dados") e sem mostrar os dados
 * de outro período no lugar (FR-009): troca rápida mostra o carregamento, e uma resposta antiga nunca
 * entra na tela de outro período.
 */
import { useQuery } from '@tanstack/react-query';
import type { Period } from '../ui';
import { unwrap, useHunit } from '../hunit';

export const reportKey = (from: string, to: string) => ['reports', 'overview', from, to] as const;

export function useReportOverview(period: { from: string; to: string }, enabled = true) {
  const hunit = useHunit();
  return useQuery({
    queryKey: reportKey(period.from, period.to),
    queryFn: () =>
      unwrap(hunit.reports.overview({ checkInFrom: period.from, checkInTo: period.to })),
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

/** Período completo (as duas datas) a partir do valor do calendário. */
export function completePeriod(period: Period): { from: string; to: string } | null {
  return period.from && period.to ? { from: period.from, to: period.to } : null;
}
