/**
 * Módulo de Relatórios na interface (specs/007, T012, T013, T016 a T018, T020, T022 e T024; telas 8.1
 * a 8.7), com a ponte simulada: os números no formato brasileiro, os atalhos do período sem
 * confirmação, o ranking e as gavetas, a ida para Reservas com os filtros, os estados de carregamento,
 * vazio e servidor indisponível e o perfil consulta. Dados fictícios.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ReportsScreen,
  defaultReportPeriod,
  type ReportPeriod,
} from '../../src/renderer/src/screens/reports/ReportsScreen';
import type { ReservationsPreset } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import type { Reservation, ReportOverview } from '../../src/shared/ipc-types';
import { overview } from './report-fixtures';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_OPERATOR,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';

/** O número sem os espaços do formato (o "R$" usa espaço fixo). */
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ');

function Host({
  onOpenReservations,
}: {
  onOpenReservations: (preset: ReservationsPreset) => void;
}) {
  const [period, setPeriod] = useState<ReportPeriod>(defaultReportPeriod);
  return (
    <ReportsScreen
      period={period}
      onPeriodChange={setPeriod}
      onOpenReservations={onOpenReservations}
    />
  );
}

function setup(report: ReportOverview | null = overview(), hunit: FakeHunit = fakeHunit()) {
  if (report) {
    mocked(hunit.api.reports.overview).mockImplementation((input) =>
      okResult({ ...report, period: { from: input.checkInFrom, to: input.checkInTo } }),
    );
  }
  current = hunit;
  const onOpenReservations = vi.fn<(preset: ReservationsPreset) => void>();
  const result = renderWithApp(<Host onOpenReservations={onOpenReservations} />, hunit);
  return { ...result, onOpenReservations };
}

/**
 * Espera o relatório na tela. Ao ficar on-line, o app refaz todas as consultas (state/connection):
 * a área aberta junto com a conexão consulta duas vezes.
 */
let current: FakeHunit | null = null;

async function loaded() {
  await waitFor(() =>
    expect(
      mocked(current?.api.reports.overview ?? vi.fn()).mock.calls.length,
    ).toBeGreaterThanOrEqual(2),
  );
  await screen.findByTestId('report-loaded');
}

describe('panorama do período (US1, tela 8.1)', () => {
  it('abre nos últimos 30 dias, com os três grupos de indicadores no formato brasileiro', async () => {
    const { hunit } = setup();
    await loaded();
    const period = defaultReportPeriod();
    expect(hunit.api.reports.overview).toHaveBeenCalledWith({
      checkInFrom: period.from,
      checkInTo: period.to,
    });
    expect(screen.getByText('34.526')).toBeInTheDocument();
    expect(screen.getByText('1.161')).toBeInTheDocument();
    expect(screen.getByText('79 de 83')).toBeInTheDocument();
    const open = screen.getByRole('region', { name: 'Valor em aberto' });
    expect(plain(within(open).getByText(/211\.120,47/).textContent)).toBe('R$ 211.120,47');
    expect(within(open).getByText('com tratativa enviada · 35%')).toBeInTheDocument();
    expect(within(open).getByText('sem tratativa · 65%')).toBeInTheDocument();
    const charged = screen.getByRole('region', { name: 'Valor já cobrado' });
    expect(within(charged).getByText('Cobrado anteriormente')).toBeInTheDocument();
    expect(within(charged).getByText('sem precisar de tratativa')).toBeInTheDocument();
    expect(within(charged).getByText('cobrado depois da tratativa')).toBeInTheDocument();
    expect(plain(screen.getByTestId('report-range-count').textContent)).toBe(
      '34.526 reservas no recorte',
    );
    expect(
      screen.getByText(/Última verificação das reservas: \d{2}\/11\/2026 às \d{2}:\d{2}/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/dados do servidor atualizados em 16\/11\/2026 às \d{2}:\d{2}/),
    ).toBeInTheDocument();
  });

  it('distribuição dos valores: quatro faixas com valor e percentual, somando 100 %', async () => {
    setup();
    await loaded();
    const legend = screen.getByRole('list', { name: 'Distribuição dos valores' });
    const rows = within(legend).getAllByRole('listitem');
    expect(rows.map((row) => plain(row.textContent))).toEqual([
      'Cobrado anteriormenteR$ 13.323.685,8996,6%',
      'RecuperadoR$ 257.257,991,9%',
      'PendenteR$ 137.232,321,0%',
      'SolicitadoR$ 73.888,150,5%',
    ]);
    expect(plain(screen.getByText(/Do total de/).textContent)).toBe(
      'Do total de R$ 13.792.064,35 em cartão virtual',
    );
  });

  it('fatia menor que 0,1 % aparece como "<0,1%"', async () => {
    setup(
      overview({
        charged: { amount: '1000000.00', previous: '999999.00', recovered: '1.00' },
        open: { amount: '0.00', count: 0, requested: '0.00', pending: '0.00' },
      }),
    );
    await loaded();
    const legend = screen.getByRole('list', { name: 'Distribuição dos valores' });
    expect(within(legend).getByText('<0,1%')).toBeInTheDocument();
  });

  it('nada em aberto: R$ 0,00, barra vazia e o botão desabilitado com a explicação', async () => {
    setup(overview({ open: { amount: '0.00', count: 0, requested: '0.00', pending: '0.00' } }));
    await loaded();
    const open = screen.getByRole('region', { name: 'Valor em aberto' });
    expect(within(open).getByRole('button', { name: 'Ver reservas em aberto' })).toBeDisabled();
    expect(within(open).getByText('Nada em aberto neste período')).toBeInTheDocument();
  });

  it('"Atualizar dados" consulta de novo', async () => {
    const { hunit } = setup();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar dados' }));
    await waitFor(() => expect(hunit.api.reports.overview).toHaveBeenCalledTimes(3));
    await loaded();
  });
});

describe('período (US2)', () => {
  it('cada atalho troca o relatório na hora, sem botão de confirmação', async () => {
    const { hunit } = setup();
    await loaded();
    expect(screen.queryByRole('button', { name: 'Aplicar filtros' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Últimos 7 dias' }));
    await waitFor(() =>
      expect(mocked(hunit.api.reports.overview).mock.lastCall?.[0]).toMatchObject({
        checkInTo: defaultReportPeriod().to,
      }),
    );
    const [last] = mocked(hunit.api.reports.overview).mock.lastCall ?? [];
    const days =
      (Date.parse(`${last?.checkInTo}T00:00:00Z`) - Date.parse(`${last?.checkInFrom}T00:00:00Z`)) /
      86_400_000;
    expect(days).toBe(6);
    await userEvent.click(screen.getByRole('button', { name: 'Este mês' }));
    await waitFor(() =>
      expect(mocked(hunit.api.reports.overview).mock.lastCall?.[0].checkInFrom).toMatch(/-01$/),
    );
  });

  it('uma reserva só: "1 reserva no recorte"', async () => {
    setup(overview({ reservations: 1 }));
    await loaded();
    expect(screen.getByTestId('report-range-count')).toHaveTextContent('1 reserva no recorte');
  });

  it('"Personalizado" abre o calendário', async () => {
    setup();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    expect(await screen.findByText('Ir para hoje')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Personalizado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Fechado sem escolher: o atalho do período em vigor volta a ficar ativo.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Ir para hoje')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Últimos 30 dias' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('ranking e detalhe do hotel (US3, telas 8.1 e 8.3)', () => {
  const reservation = (number: string, amount: string): Reservation =>
    ({
      hotelCode: '31',
      reservationNumber: number,
      guestName: 'Ana Ribeiro',
      checkIn: '2026-11-03',
      checkOut: '2026-11-08',
      reservationStatus: 'active',
      amountToCharge: amount,
      treatment: { detailedSituation: 'treatment_sent', needsReview: false },
    }) as unknown as Reservation;

  it('só os hotéis com valor em aberto, numerados do maior para o menor, sem rede', async () => {
    setup();
    await loaded();
    const ranking = screen.getByRole('list', { name: 'Hotéis com mais valor em aberto' });
    const rows = within(ranking).getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Abrir o detalhe de Hotel Praia Azul',
      'Abrir o detalhe de Pousada Serra Verde',
    ]);
    expect(rows[0]).toHaveTextContent('01');
    expect(screen.getByText('Solicitado + pendente · maiores primeiro')).toBeInTheDocument();
    expect(screen.queryByText(/Rede/)).not.toBeInTheDocument();
  });

  it('gaveta do hotel: resumo, reservas em aberto maiores primeiro e a ida para Reservas', async () => {
    const hunit = fakeHunit();
    mocked(hunit.api.reservations.list).mockImplementation(() =>
      okResult({ items: [reservation('101-2001', '2480.00')], nextCursor: null }),
    );
    const { onOpenReservations } = setup(overview(), hunit);
    await loaded();
    await userEvent.click(
      screen.getByRole('button', { name: 'Abrir o detalhe de Hotel Praia Azul' }),
    );
    const drawer = await screen.findByTestId('report-hotel-drawer');
    expect(
      within(drawer).getByText(/1º com mais valor em aberto · check-in de/),
    ).toBeInTheDocument();
    expect(await within(drawer).findByText('Ana Ribeiro')).toBeInTheDocument();
    expect(within(drawer).getByText('Reservas em aberto (37)')).toBeInTheDocument();
    expect(hunit.api.reservations.list).toHaveBeenCalledWith(
      expect.objectContaining({
        hotelCode: ['31'],
        quickFilter: 'pending_charge',
        order: 'amount_desc',
      }),
    );
    await userEvent.click(
      within(drawer).getByRole('button', { name: 'Ver as 37 reservas em Reservas' }),
    );
    const period = defaultReportPeriod();
    expect(onOpenReservations).toHaveBeenCalledWith({
      hotelCodes: ['31'],
      checkInFrom: period.from,
      checkInTo: period.to,
      quickFilter: 'pending_charge',
      expectedCount: 37,
    });
  });

  it('"Ver reservas em aberto" leva todos os hotéis com a quantidade do card', async () => {
    const { onOpenReservations } = setup();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'Ver reservas em aberto' }));
    expect(onOpenReservations).toHaveBeenCalledWith(
      expect.objectContaining({ quickFilter: 'pending_charge', expectedCount: 57 }),
    );
    expect(onOpenReservations.mock.lastCall?.[0]).not.toHaveProperty('hotelCodes');
  });
});

describe('todos os hotéis (US4, tela 8.7)', () => {
  it('inclui os de R$ 0,00 no fim; busca sem acento; ordenações; abre o detalhe', async () => {
    setup();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'Ver todos os hotéis' }));
    const drawer = await screen.findByTestId('report-all-hotels');
    const names = () =>
      within(within(drawer).getByRole('list', { name: 'Todos os hotéis' }))
        .getAllByRole('button')
        .map((row) => row.getAttribute('aria-label')?.replace('Abrir o detalhe de ', ''));
    expect(names()).toEqual(['Hotel Praia Azul', 'Pousada Serra Verde', 'Hotel Centro Histórico']);

    await userEvent.click(within(drawer).getByRole('button', { name: 'Mais pendente' }));
    expect(names()).toEqual(['Pousada Serra Verde', 'Hotel Praia Azul', 'Hotel Centro Histórico']);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Nome A-Z' }));
    expect(names()).toEqual(['Hotel Centro Histórico', 'Hotel Praia Azul', 'Pousada Serra Verde']);

    await userEvent.type(within(drawer).getByLabelText('Buscar hotel pelo nome'), 'historico');
    expect(names()).toEqual(['Hotel Centro Histórico']);

    await userEvent.clear(within(drawer).getByLabelText('Buscar hotel pelo nome'));
    await userEvent.type(within(drawer).getByLabelText('Buscar hotel pelo nome'), 'xyz');
    expect(within(drawer).getByText('Nenhum hotel encontrado')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Limpar busca' }));
    expect(names()).toHaveLength(3);

    await userEvent.click(
      within(drawer).getByRole('button', { name: 'Abrir o detalhe de Hotel Centro Histórico' }),
    );
    const detail = await screen.findByTestId('report-hotel-drawer');
    expect(within(detail).getByText('Nada em aberto neste hotel no período.')).toBeInTheDocument();
    expect(within(detail).queryByText(/com mais valor em aberto/)).not.toBeInTheDocument();
  });
});

describe('estados (US5, telas 8.4 e 8.5)', () => {
  it('carregando: sem números e o selo "Atualizando…"', async () => {
    const hunit = fakeHunit();
    mocked(hunit.api.reports.overview).mockImplementation(() => new Promise(() => undefined));
    setup(null, hunit);
    expect(await screen.findByText('Atualizando…')).toBeInTheDocument();
    expect(screen.getAllByText('Carregando').length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });

  it('período sem reservas: o estado vazio e "Ver os últimos 30 dias"', async () => {
    const { hunit } = setup(
      overview({
        reservations: 0,
        treatmentsSent: 0,
        hotels: { withData: 0, total: 83 },
        open: { amount: '0.00', count: 0, requested: '0.00', pending: '0.00' },
        charged: { amount: '0.00', previous: '0.00', recovered: '0.00' },
        hotelRows: [],
        lastVerifiedAt: null,
      }),
    );
    await loaded();
    expect(screen.getByText('Nenhuma reserva neste período')).toBeInTheDocument();
    expect(screen.getByTestId('report-range-count')).toHaveTextContent('0 reservas no recorte');
    await userEvent.click(screen.getByRole('button', { name: 'Este mês' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ver os últimos 30 dias' }));
    // O período volta aos últimos 30 dias (já consultado: vem do cache, sem nova consulta).
    const period = defaultReportPeriod();
    const day = (iso: string) => iso.split('-').reverse().join('/');
    expect(await screen.findByText(`${day(period.from)} a ${day(period.to)}`)).toBeInTheDocument();
    expect(
      mocked(hunit.api.reports.overview).mock.calls.some(([input]) =>
        input.checkInFrom.endsWith('-01'),
      ),
    ).toBe(true);
  });

  it('servidor indisponível com dados: "dados de HH:MM", números legíveis e ações desabilitadas', async () => {
    const { hunit } = setup();
    await loaded();
    act(() => hunit.emit.connectionState({ ...ONLINE_OPERATOR, status: 'offline', client: null }));
    expect(
      await screen.findByText(/dados de \d{2}:\d{2} — servidor indisponível/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Dados atualizados')).not.toBeInTheDocument();
    expect(screen.getByText('34.526')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar dados' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver reservas em aberto' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Abrir o detalhe de Hotel Praia Azul' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver todos os hotéis' })).toBeEnabled();
    expect(screen.getByText(/dados obtidos às \d{2}:\d{2} de 16\/11\/2026/)).toBeInTheDocument();
  });

  it('servidor indisponível ao abrir: nenhum número', async () => {
    const hunit = fakeHunit({ ...ONLINE_OPERATOR, status: 'offline', client: null });
    mocked(hunit.api.reports.overview).mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'offline' } }),
    );
    setup(null, hunit);
    await waitFor(() => expect(hunit.api.reports.overview).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Atualizando…')).not.toBeInTheDocument());
    expect(screen.queryByText('Valor em aberto')).not.toBeInTheDocument();
    expect(screen.queryByText(/reservas no recorte/)).not.toBeInTheDocument();
  });
});

describe('perfil consulta (US6, tela 8.6)', () => {
  it('o mesmo relatório, com o ranking e a ida para Reservas', async () => {
    const { onOpenReservations } = setup(overview(), fakeHunit(ONLINE_READER));
    await loaded();
    expect(screen.getByText('34.526')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver reservas em aberto' }));
    expect(onOpenReservations).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Abrir o detalhe de Hotel Praia Azul' }),
    ).toBeEnabled();
  });
});
