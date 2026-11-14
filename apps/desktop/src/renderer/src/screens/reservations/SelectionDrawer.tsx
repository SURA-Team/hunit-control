/**
 * Lista completa das reservas selecionadas para o lote (specs/003, US3 cenário 5, FR-006a):
 * mostra também as que não estão no resultado da pesquisa atual, e permite desmarcar uma a uma ou
 * limpar tudo.
 */
import { Button, CloseButton, Drawer, Group, Stack, Table, Text, Title } from '@mantine/core';
import { StatusBadge } from '../../components/StatusBadge';
import { TreatmentBadge } from '../../components/TreatmentBadge';
import { formatMoney, sumMoney } from '../../presentation/format';
import { CLASSIFICATION_LABELS } from '../../presentation/labels';
import { useSelection } from '../../state/selection';

export function SelectionDrawer({
  opened,
  onClose,
  hotelNames,
}: {
  opened: boolean;
  onClose: () => void;
  hotelNames: ReadonlyMap<string, string>;
}) {
  const selection = useSelection();
  const { items } = selection;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      title={<Title order={3}>Reservas selecionadas</Title>}
      closeButtonProps={{ 'aria-label': 'Fechar seleção' }}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm">
            <b>{items.length}</b> {items.length === 1 ? 'reserva' : 'reservas'} — total de{' '}
            <b>{formatMoney(sumMoney(items.map((item) => item.totalAmount)))}</b>
          </Text>
          <Button
            variant="default"
            size="xs"
            onClick={() => selection.clear()}
            disabled={items.length === 0}
          >
            Limpar seleção
          </Button>
        </Group>

        {items.length === 0 ? (
          <Text c="dimmed">Nenhuma reserva selecionada.</Text>
        ) : (
          <Table verticalSpacing={4} aria-label="Reservas selecionadas">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Hotel</Table.Th>
                <Table.Th>Número</Table.Th>
                <Table.Th>Hóspede</Table.Th>
                <Table.Th>Valor total</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={`${item.hotelCode}/${item.reservationNumber}`}>
                  <Table.Td>{hotelNames.get(item.hotelCode) ?? item.hotelCode}</Table.Td>
                  <Table.Td>{item.reservationNumber}</Table.Td>
                  <Table.Td>
                    {item.guestName ?? (
                      <Text span fs="italic" c="dimmed" size="sm">
                        nome anonimizado
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{formatMoney(item.totalAmount)}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <StatusBadge label={CLASSIFICATION_LABELS[item.classification]} size="xs" />
                      <TreatmentBadge status={item.treatmentStatus} size="xs" />
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <CloseButton
                      size="sm"
                      aria-label={`Desmarcar a reserva ${item.reservationNumber}`}
                      onClick={() => selection.remove([item])}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Drawer>
  );
}
