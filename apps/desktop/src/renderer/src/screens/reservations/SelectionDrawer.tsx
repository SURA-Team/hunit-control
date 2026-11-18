/**
 * Lista completa das reservas selecionadas para o lote (specs/003, US3 cenário 5, FR-006a):
 * mostra também as que não estão no resultado da pesquisa atual, e permite desmarcar uma a uma ou
 * limpar tudo.
 *
 * Desde a 006 (T042; tela 4.5, node `71:10360`): gaveta padrão "Reservas selecionadas", o resumo
 * "N reservas — total de R$ X" com "Limpar seleção" em texto e cada reserva numa linha compacta
 * (hóspede, número · hotel, valor, situação e o X para desmarcar).
 */
import { Group, Text } from '@mantine/core';
import { formatMoney, sumMoney } from '../../presentation/format';
import { situationBadges } from '../../presentation/reservations';
import { useSelection, type SelectedReservation } from '../../state/selection';
import { Action, AppDrawer, CompactReservationRow, RowList, SituationBadges } from '../../ui';

function badgesOf(item: SelectedReservation) {
  return situationBadges({
    reservationStatus: item.reservationStatus,
    treatment: { detailedSituation: item.detailedSituation, needsReview: item.needsReview },
  });
}

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
    <AppDrawer
      opened={opened}
      onClose={onClose}
      title="Reservas selecionadas"
      closeLabel="Fechar seleção"
    >
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Text size="sm">
          {items.length} {items.length === 1 ? 'reserva' : 'reservas'} — total de{' '}
          <b>{formatMoney(sumMoney(items.map((item) => item.totalAmount)))}</b>
        </Text>
        <Action
          variant="text"
          size="xs"
          onClick={() => selection.clear()}
          disabled={items.length === 0}
        >
          Limpar seleção
        </Action>
      </Group>

      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nenhuma reserva selecionada.
        </Text>
      ) : (
        <RowList label="Reservas selecionadas">
          {items.map((item) => (
            <CompactReservationRow
              key={`${item.hotelCode}/${item.reservationNumber}`}
              guestName={item.guestName ?? 'nome anonimizado'}
              detail={`${item.reservationNumber} · ${hotelNames.get(item.hotelCode) ?? item.hotelCode}`}
              amount={formatMoney(item.totalAmount)}
              situation={<SituationBadges items={badgesOf(item)} />}
              removeLabel={`Desmarcar a reserva ${item.reservationNumber}`}
              onRemove={() => selection.remove([item])}
            />
          ))}
        </RowList>
      )}
    </AppDrawer>
  );
}
