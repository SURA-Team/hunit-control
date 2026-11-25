/**
 * Filtros do relatório (specs/007, FR-005a, research R-14): o botão "Filtros" ao lado dos atalhos
 * abre o painel da área Reservas, sem o período, sem as três situações que ficam fora do relatório e
 * com a Origem; cada filtro refaz o resumo na hora, vira um chip removível, vale para a gaveta do
 * hotel e segue para Reservas. Com filtros e sem reservas, o estado vazio oferece "Limpar filtros".
 * Dados fictícios.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_REPORT_FILTERS,
  type ReportFilterState,
} from '../../src/renderer/src/screens/reports/ReportFilters';
import {
  ReportsScreen,
  defaultReportPeriod,
  type ReportPeriod,
} from '../../src/renderer/src/screens/reports/ReportsScreen';
import type { ReservationsPreset } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import type { ReportOverview, ReportOverviewInput } from '../../src/shared/ipc-types';
import { overview } from './report-fixtures';
import { fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';

type User = ReturnType<typeof userEvent.setup>;

function Host({
  onOpenReservations,
}: {
  onOpenReservations: (preset: ReservationsPreset) => void;
}) {
  const [period, setPeriod] = useState<ReportPeriod>(defaultReportPeriod);
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_REPORT_FILTERS);
  return (
    <ReportsScreen
      period={period}
      onPeriodChange={setPeriod}
      filters={filters}
      onFiltersChange={setFilters}
      onOpenReservations={onOpenReservations}
    />
  );
}

/** `report(input)` decide o resumo de cada consulta (por padrão, o do design). */
function setup(report: (input: ReportOverviewInput) => ReportOverview = () => overview()) {
  const hunit: FakeHunit = fakeHunit();
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([
      { code: '31', name: 'Hotel Praia Azul', available: true, lastSeenAt: '' },
      { code: '32', name: 'Pousada Serra Verde', available: true, lastSeenAt: '' },
    ]),
  );
  mocked(hunit.api.reservations.channels).mockImplementation(() =>
    okResult(['Booking.com', 'Expedia']),
  );
  mocked(hunit.api.reports.overview).mockImplementation((input) =>
    okResult({ ...report(input), period: { from: input.checkInFrom, to: input.checkInTo } }),
  );
  const onOpenReservations = vi.fn<(preset: ReservationsPreset) => void>();
  renderWithApp(<Host onOpenReservations={onOpenReservations} />, hunit);
  return { hunit, onOpenReservations, user: userEvent.setup() };
}

const lastInput = (hunit: FakeHunit) => mocked(hunit.api.reports.overview).mock.lastCall?.[0];

async function loaded(hunit: FakeHunit) {
  await waitFor(() =>
    expect(mocked(hunit.api.reports.overview).mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  await screen.findByTestId('report-loaded');
}

async function openPanel(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Filtros' }));
  return screen.findByRole('region', { name: 'Filtros avançados' });
}

/** Foca o campo, digita e escolhe a primeira opção (a lista de várias fecha com Esc). */
async function choose(user: User, input: HTMLElement, text: string, multi = false) {
  act(() => input.focus());
  await user.keyboard(text);
  await user.keyboard(multi ? '{ArrowDown}{Enter}{Escape}' : '{ArrowDown}{Enter}');
}

describe('filtros do relatório (FR-005a)', () => {
  it('"Filtros" fica no card do período e abre o painel sem o período e com a Origem', async () => {
    const { hunit, user } = setup();
    await loaded(hunit);
    const button = screen.getByRole('button', { name: 'Filtros' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // No card do período, depois dos atalhos.
    const periodCard = button.closest('[data-block="período"]');
    expect(periodCard).not.toBeNull();
    const custom = within(periodCard as HTMLElement).getByRole('button', { name: 'Personalizado' });
    expect(custom.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const panel = await openPanel(user);
    expect(within(panel).getByPlaceholderText('Todos os hotéis')).toBeInTheDocument();
    expect(within(panel).getByPlaceholderText('Todas as situações')).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: 'Ativa ou cancelada' })).toBeInTheDocument();
    expect(within(panel).getByPlaceholderText('Todos os canais')).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: 'Origem' })).toBeInTheDocument();
    expect(
      within(panel).getByRole('checkbox', { name: 'Só as não encontradas na última verificação' }),
    ).toBeInTheDocument();
    expect(within(panel).queryByPlaceholderText('Qualquer data')).not.toBeInTheDocument();

    // As três situações fora do relatório (FR-008a) não são oferecidas.
    await user.click(within(panel).getByPlaceholderText('Todas as situações'));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toContain('Pendente de cobrança');
    expect(options).not.toContain('Faturada');
    expect(options.some((text) => text?.startsWith('Ignorada'))).toBe(false);
    expect(options.some((text) => text?.startsWith('A revisar'))).toBe(false);
  }, 30_000); // Cenário longo (digitação nos seletores): na rodada completa em paralelo passa dos 15 s padrão.

  it('cada filtro refaz o resumo na hora e vira um chip; "Limpar filtros" volta tudo', async () => {
    const { hunit, user } = setup();
    await loaded(hunit);
    const period = defaultReportPeriod();
    const panel = await openPanel(user);

    await choose(user, within(panel).getByPlaceholderText('Todos os hotéis'), 'pousada', true);
    await waitFor(() => expect(lastInput(hunit)).toMatchObject({ hotelCode: ['32'] }));
    await choose(
      user,
      within(panel).getByRole('combobox', { name: 'Ativa ou cancelada' }),
      'so ativas',
    );
    await choose(user, within(panel).getByPlaceholderText('Todos os canais'), 'expe');
    await choose(user, within(panel).getByRole('combobox', { name: 'Origem' }), 'sistema');
    await waitFor(() =>
      expect(lastInput(hunit)).toEqual({
        checkInFrom: period.from,
        checkInTo: period.to,
        hotelCode: ['32'],
        reservationStatus: ['active'],
        channel: 'Expedia',
        fromLegacy: true,
      }),
    );

    const applied = screen.getByRole('group', { name: 'Filtros aplicados' });
    expect(within(applied).getByText('Pousada Serra Verde')).toBeInTheDocument();
    expect(within(applied).getByText('Só ativas')).toBeInTheDocument();
    expect(within(applied).getByText('Canal: Expedia')).toBeInTheDocument();
    expect(within(applied).getByText('Origem: Sistema anterior')).toBeInTheDocument();

    // Recortes já consultados vêm do cache (staleTime infinito), sem nova consulta.
    await user.click(within(applied).getByRole('button', { name: 'Tirar o filtro de origem' }));
    await waitFor(() =>
      expect(within(applied).queryByText('Origem: Sistema anterior')).not.toBeInTheDocument(),
    );
    expect(within(applied).getByText('Canal: Expedia')).toBeInTheDocument();

    await user.click(within(applied).getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Filtros aplicados' })).not.toBeInTheDocument(),
    );
    expect(
      mocked(hunit.api.reports.overview).mock.calls.filter(
        ([input]) => Object.keys(input).length === 2,
      ).length,
    ).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('a gaveta do hotel e a ida para Reservas levam os filtros', async () => {
    const { hunit, user, onOpenReservations } = setup();
    mocked(hunit.api.reservations.list).mockImplementation(() =>
      okResult({ items: [], nextCursor: null }),
    );
    await loaded(hunit);
    const panel = await openPanel(user);
    await choose(user, within(panel).getByPlaceholderText('Todos os canais'), 'booking');
    await user.click(
      within(panel).getByRole('checkbox', { name: 'Só as não encontradas na última verificação' }),
    );
    await waitFor(() =>
      expect(lastInput(hunit)).toMatchObject({ channel: 'Booking.com', notFound: true }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Fechar os filtros' }));
    await screen.findByTestId('report-loaded');

    await user.click(screen.getByRole('button', { name: 'Ver reservas em aberto' }));
    const period = defaultReportPeriod();
    expect(onOpenReservations).toHaveBeenLastCalledWith({
      checkInFrom: period.from,
      checkInTo: period.to,
      quickFilter: 'pending_charge',
      expectedCount: 57,
      filters: { situations: [], status: 'all', channel: 'Booking.com', notFound: true },
    });

    await user.click(screen.getByRole('button', { name: 'Abrir o detalhe de Hotel Praia Azul' }));
    await screen.findByTestId('report-hotel-drawer');
    await waitFor(() =>
      expect(hunit.api.reservations.list).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelCode: ['31'],
          channel: 'Booking.com',
          notFound: true,
          quickFilter: 'pending_charge',
        }),
      ),
    );
  }, 30_000);

  it('com filtros e sem reservas: "Nenhuma reserva com estes filtros" e "Limpar filtros"', async () => {
    const empty = overview({
      reservations: 0,
      treatmentsSent: 0,
      hotels: { withData: 0, total: 1 },
      open: { amount: '0.00', count: 0, requested: '0.00', pending: '0.00' },
      charged: { amount: '0.00', previous: '0.00', recovered: '0.00' },
      hotelRows: [],
      lastVerifiedAt: null,
    });
    const { hunit, user } = setup((input) => (input.hotelCode ? empty : overview()));
    await loaded(hunit);
    const panel = await openPanel(user);
    await choose(user, within(panel).getByPlaceholderText('Todos os hotéis'), 'praia', true);
    await user.click(within(panel).getByRole('button', { name: 'Fechar os filtros' }));
    expect(await screen.findByText('Nenhuma reserva com estes filtros')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma reserva neste período')).not.toBeInTheDocument();
    // O último "Limpar filtros" é o do estado vazio (o primeiro é o da linha "Filtros aplicados").
    const clear = screen.getAllByRole('button', { name: 'Limpar filtros' });
    expect(clear).toHaveLength(2);
    await user.click(clear[1] as HTMLElement);
    expect(await screen.findByText('34.526')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filtros aplicados' })).not.toBeInTheDocument();
  }, 30_000);
});
