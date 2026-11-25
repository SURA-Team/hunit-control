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
 *
 * Desde a 006 (T052; telas 7.7 a 7.10, FR-039): o título com a explicação da área e as abas no
 * visual novo, com a contagem dos retornos a validar e dos retornos com problema (as da situação da
 * planilha, que a área já lê).
 *
 * Desde a 008 (tela 7.7): a aba "Cobradas no Hunit" (tela 7.15) com a contagem da fila; desde a
 * homologação, as "Cancelada" do Comercial contam em "Retornos a validar" (R-19).
 */
import { Stack } from '@mantine/core';
import { useState } from 'react';
import { PageHeader, TabPanel, Tabs } from '../../ui';
import { DispatchesTab } from './DispatchesTab';
import { HunitChargesTab } from './HunitChargesTab';
import { ProblemsTab } from './ProblemsTab';
import { ReturnsTab } from './ReturnsTab';
import { SheetTab, useSheetStatus } from './SheetTab';

type Tab = 'dispatches' | 'returns' | 'hunit' | 'problems' | 'sheet';

export function CommercialScreen() {
  const [tab, setTab] = useState<Tab>('dispatches');
  const sheet = useSheetStatus().data;
  const counted = sheet?.configured === true;

  return (
    <Stack gap={16}>
      <PageHeader
        title="Comercial"
        subtitle="Envios das reservas para a planilha do Comercial e os retornos que ele preenche."
      />
      <Tabs
        aria-label="Áreas do Comercial"
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        items={[
          { value: 'dispatches', label: 'Envios' },
          {
            value: 'returns',
            label: 'Retornos a validar',
            count: counted ? sheet.awaitingValidation : null,
          },
          {
            value: 'problems',
            label: 'Retornos com problema',
            count: counted ? sheet.problems.length : null,
          },
          // Depois de "Retornos com problema", como nas telas 7.7 e 7.15 do design.
          {
            value: 'hunit',
            label: 'Cobradas no Hunit',
            count: counted ? sheet.hunitQueueCount : null,
          },
          { value: 'sheet', label: 'Planilha' },
        ]}
      >
        <TabPanel value="dispatches">{tab === 'dispatches' && <DispatchesTab />}</TabPanel>
        <TabPanel value="returns">{tab === 'returns' && <ReturnsTab />}</TabPanel>
        <TabPanel value="hunit">{tab === 'hunit' && <HunitChargesTab />}</TabPanel>
        <TabPanel value="problems">{tab === 'problems' && <ProblemsTab />}</TabPanel>
        <TabPanel value="sheet">{tab === 'sheet' && <SheetTab />}</TabPanel>
      </Tabs>
    </Stack>
  );
}
