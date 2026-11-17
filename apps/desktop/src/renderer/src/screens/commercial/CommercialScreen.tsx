/**
 * Área "Comercial" (specs/005, US3, FR-013, FR-018, FR-020, FR-021, FR-025; research R-14):
 *
 * - "Envios": a lista dos envios, com o resultado de cada um, e o acompanhamento;
 * - "Retornos a validar": as reservas com retorno do Comercial aguardando validação, com
 *   confirmação individual, em lote e recusa;
 * - "Retornos com problema": os retornos incompletos ou ilegíveis e os casos da planilha;
 * - "Planilha": a situação da integração, as pendências e desde quando, a última leitura, a falha
 *   atual (mensagem genérica) e "Ler retornos agora".
 *
 * O perfil consulta vê tudo e não tem nenhuma ação.
 */
import { Tabs, Title, Stack } from '@mantine/core';
import { useState } from 'react';
import { DispatchesTab } from './DispatchesTab';
import { ProblemsTab } from './ProblemsTab';
import { ReturnsTab } from './ReturnsTab';
import { SheetTab } from './SheetTab';

type Tab = 'dispatches' | 'returns' | 'problems' | 'sheet';

export function CommercialScreen() {
  const [tab, setTab] = useState<Tab>('dispatches');
  return (
    <Stack gap="md">
      <Title order={2}>Comercial</Title>
      <Tabs value={tab} onChange={(value) => setTab((value as Tab | null) ?? 'dispatches')}>
        <Tabs.List>
          <Tabs.Tab value="dispatches">Envios</Tabs.Tab>
          <Tabs.Tab value="returns">Retornos a validar</Tabs.Tab>
          <Tabs.Tab value="problems">Retornos com problema</Tabs.Tab>
          <Tabs.Tab value="sheet">Planilha</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="dispatches" pt="md">
          {tab === 'dispatches' && <DispatchesTab />}
        </Tabs.Panel>
        <Tabs.Panel value="returns" pt="md">
          {tab === 'returns' && <ReturnsTab />}
        </Tabs.Panel>
        <Tabs.Panel value="problems" pt="md">
          {tab === 'problems' && <ProblemsTab />}
        </Tabs.Panel>
        <Tabs.Panel value="sheet" pt="md">
          {tab === 'sheet' && <SheetTab />}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
