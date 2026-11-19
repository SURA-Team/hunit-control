/**
 * Listas de ui/ (specs/006, T014, FR-014, FR-018 a FR-020, research R-08): a linha da reserva abre
 * pelo clique e pelo Enter, a caixa de seleção não abre, a segunda linha do valor só com valor
 * cobrado, nomes longos com a dica; as linhas simples, a barra de lote e o card escuro.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Action,
  CompactReservationRow,
  ExecutionRow,
  EXECUTION_COLUMNS,
  HotelRow,
  ListActions,
  ListCard,
  ListCell,
  ListHeader,
  ListRow,
  RESERVATION_COLUMNS,
  ReservationRow,
  RowList,
  RunningJobCard,
  SelectionBar,
  SituationBadges,
  StatusBadge,
  type ReservationRowProps,
} from '../../src/renderer/src/ui';
import { renderUi } from './render';

const LONG_NAME = 'Maria Aparecida dos Santos Oliveira de Albuquerque Cavalcanti';

function reservationList(overrides: Partial<ReservationRowProps> = {}) {
  const props: ReservationRowProps = {
    reservationNumber: '101-1000',
    guestName: 'Ana Ribeiro',
    detail: '101-1000 · Booking.com',
    hotelName: 'Hotel Praia Azul',
    period: '17/11 → 19/11/2026',
    nights: '2 noites',
    amount: 'R$ 380,00',
    situation: <SituationBadges items={[{ label: 'Pendente de cobrança', tone: 'amber' }]} />,
    selectable: true,
    onOpen: vi.fn(),
    onSelectedChange: vi.fn(),
    ...overrides,
  };
  renderUi(
    <ListCard label="Reservas" header={<ListHeader columns={RESERVATION_COLUMNS} select="" />}>
      <ReservationRow {...props} />
    </ListCard>,
  );
  return props;
}

describe('ReservationRow', () => {
  it('as colunas do design no cabeçalho', () => {
    reservationList();
    const table = screen.getByRole('table', { name: 'Reservas' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
        .filter(Boolean),
    ).toEqual(['Hóspede', 'Hotel', 'Período', 'Valor', 'Situação da reserva']);
  });

  it('o clique na linha abre a reserva; o clique na caixa só marca', async () => {
    const user = userEvent.setup();
    const props = reservationList();
    await user.click(screen.getByText('Hotel Praia Azul'));
    expect(props.onOpen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar a reserva 101-1000' }));
    expect(props.onSelectedChange).toHaveBeenCalledWith(true);
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('Enter com o foco na linha abre; a seta abre uma vez só', async () => {
    const user = userEvent.setup();
    const props = reservationList();
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    row.focus();
    await user.keyboard('{Enter}');
    expect(props.onOpen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Abrir a reserva 101-1000' }));
    expect(props.onOpen).toHaveBeenCalledTimes(2);
  });

  it('a segunda linha do valor só aparece com valor cobrado', () => {
    reservationList();
    expect(screen.queryByText(/cobrado/)).toBeNull();
  });

  it('com valor cobrado, a segunda linha mostra o valor e a origem', () => {
    reservationList({ chargedAmount: 'cobrado R$ 1.280,00 · Hunit' });
    expect(screen.getByText('cobrado R$ 1.280,00 · Hunit')).toBeInTheDocument();
  });

  it('nome longo cortado com o texto inteiro na dica; valor nunca cortado', () => {
    reservationList({ guestName: LONG_NAME });
    expect(screen.getByText(LONG_NAME)).toHaveAttribute('title', LONG_NAME);
    expect(screen.getByText('R$ 380,00')).toHaveAttribute('data-no-truncate');
  });

  it('marcada ou aberta, a linha fica destacada', () => {
    reservationList({ opened: true });
    expect(screen.getAllByRole('row')[1]).toHaveAttribute('data-selected');
  });
});

describe('ExecutionRow, HotelRow e CompactReservationRow', () => {
  it('a linha da execução abre o detalhe', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderUi(
      <ListCard label="Histórico" header={<ListHeader columns={EXECUTION_COLUMNS} />}>
        <ExecutionRow
          when="11/11/2026 · 08:40"
          detail="Check-in 11/11 a 17/11/2026 · Recepção — PC 1"
          result="Encerrada às 08:47 · 7 min"
          status={<StatusBadge tone="green">Concluída</StatusBadge>}
          openLabel="Abrir a execução de 11/11/2026 · 08:40"
          onOpen={onOpen}
        />
      </ListCard>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Abrir a execução de 11/11/2026 · 08:40' }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('linhas simples: hotel, documento e reserva da seleção com o botão de tirar', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderUi(
      <RowList label="Hotéis">
        <HotelRow
          title="Hotel Praia Azul"
          summary="Código 101 · 6 reservas · 42 s"
          status={<StatusBadge tone="green">Concluído</StatusBadge>}
        />
        <CompactReservationRow
          guestName="Carla Mendes"
          detail="101-1002 · Hotel Praia Azul"
          amount="R$ 655,00"
          situation={<StatusBadge tone="red">Erro na cobrança</StatusBadge>}
          onRemove={onRemove}
          removeLabel="Tirar a reserva 101-1002 da seleção"
        />
      </RowList>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Código 101 · 6 reservas · 42 s')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tirar a reserva 101-1002 da seleção' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('SelectionBar e RunningJobCard', () => {
  it('a barra de lote resume a seleção e a principal fica lima', async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    renderUi(
      <SelectionBar
        count={4}
        total="R$ 4.957,50"
        onClearAll={onClearAll}
        actions={<Action variant="primary">Enviar ao Comercial</Action>}
      />,
    );
    const bar = screen.getByRole('region', { name: 'Seleção do lote' });
    expect(bar).toHaveTextContent('4 reservas selecionadas');
    expect(bar).toHaveTextContent('total de R$ 4.957,50');
    expect(screen.getByRole('button', { name: 'Enviar ao Comercial' })).toHaveAttribute(
      'data-surface',
      'dark',
    );
    await user.click(screen.getByRole('button', { name: 'Desmarcar todas' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('o card escuro mostra o andamento e a ação em lima', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderUi(
      <RunningJobCard
        title="Iniciada em 13/11/2026 · 15:46"
        detail="Check-in 13/11 a 19/11/2026 · Recepção — PC 1 (esta máquina)"
        progressLabel="2 de 4 hotéis concluídos"
        percent={50}
        actionLabel="Ver detalhes"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('Em andamento')).toHaveAttribute('data-tone', 'lime');
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '2 de 4 hotéis concluídos' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    const action = screen.getByRole('button', { name: 'Ver detalhes' });
    expect(action).toHaveAttribute('data-surface', 'dark');
    await user.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('ListRow, ListCell e ListActions (T052; telas 7.8 e 7.9)', () => {
  const columns = [
    { key: 'reservation', label: 'Reserva' },
    { key: 'problem', label: 'Problema' },
  ] as const;

  it('uma célula por coluna, na ordem do cabeçalho; a linha com ação própria é um bloco', () => {
    renderUi(
      <ListCard label="Retornos" header={<ListHeader columns={columns} withArrow={false} />}>
        <ListRow
          columns={columns}
          withArrow={false}
          block="Retorno 101-1002"
          cells={{
            problem: <StatusBadge tone="amber">Retorno incompleto</StatusBadge>,
            reservation: <ListCell strong primary="101-1002" secondary="AUT-55210" />,
          }}
        />
      </ListCard>,
    );
    const row = within(screen.getByRole('table', { name: 'Retornos' })).getAllByRole('row')[1];
    expect(
      [...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.getAttribute('data-col')),
    ).toEqual(['reservation', 'problem']);
    expect(row).toHaveTextContent('101-1002AUT-55210Retorno incompleto');
    expect(row).toHaveAttribute('data-block', 'Retorno 101-1002');
    expect(row).not.toHaveAttribute('tabindex');
  });

  it('com onOpen, a seta e o clique na linha abrem; o texto da célula pode abrir também', async () => {
    const onOpen = vi.fn();
    const onCell = vi.fn();
    renderUi(
      <ListCard label="Problemas" header={<ListHeader columns={columns} />}>
        <ListRow
          columns={columns}
          onOpen={onOpen}
          openLabel="Abrir a reserva 101-1005"
          cells={{
            reservation: (
              <ListCell
                primary="101-1005"
                onOpen={onCell}
                openLabel="Abrir o detalhe de 101-1005"
                narrow="Paula (Comercial)"
                compact="17/11/2026 16:34"
              />
            ),
          }}
        />
      </ListCard>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir a reserva 101-1005' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Abrir o detalhe de 101-1005' }));
    expect(onCell).toHaveBeenCalledTimes(1);
    // O botão da célula não abre a linha junto.
    expect(onOpen).toHaveBeenCalledTimes(1);
    // O que vem de colunas que somem no estreito fica na célula (o CSS mostra conforme a largura).
    expect(screen.getByText('Paula (Comercial)')).toBeInTheDocument();
    expect(screen.getByText('17/11/2026 16:34')).toBeInTheDocument();
  });

  it('ListActions agrupa as ações da linha', () => {
    renderUi(
      <ListActions>
        <Action variant="primary" size="xs">
          Confirmar
        </Action>
        <Action variant="danger-light" size="xs">
          Recusar
        </Action>
      </ListActions>,
    );
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirm.parentElement).toContainElement(screen.getByRole('button', { name: 'Recusar' }));
  });
});
