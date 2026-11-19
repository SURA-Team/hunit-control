/**
 * Painel "Filtros avançados", "Origem" e "Filtros aplicados" (specs/006, T036; telas 4.1 e 4.12,
 * research R-11, FR-034): os campos valem na hora, cada filtro do painel vira um chip removível, a
 * Origem fica só na barra e "Limpar busca e filtros" volta tudo ao início.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import { fakeHunit, renderWithApp, type FakeHunit } from './render';
import {
  findRow,
  lastListQuery,
  openFiltersPanel,
  quickFilterChip,
  serveReservations,
  typeSearch,
} from './reservations-helpers';

const EXECUTION = '11111111-1111-4111-8111-111111111111';

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
  serveReservations(hunit);
});

function applied() {
  return screen.queryByRole('group', { name: 'Filtros aplicados' });
}

describe('painel "Filtros avançados" (tela 4.12)', () => {
  it('abre pelo botão "Filtros" e fecha pelo X e por Esc', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    const button = screen.getByRole('button', { name: 'Filtros' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    const panel = await openFiltersPanel(user);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Hotéis', 'Período de check-in', 'Situação da reserva', 'Canal']) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }
    expect(within(panel).getByRole('checkbox', { name: /não encontradas/ })).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Fechar os filtros' }));
    expect(screen.queryByRole('region', { name: 'Filtros avançados' })).not.toBeInTheDocument();

    // Esc numa lista aberta do painel fecha só a lista.
    const again = await openFiltersPanel(user);
    await user.click(within(again).getByRole('combobox', { name: 'Ativa ou cancelada' }));
    await screen.findByRole('option', { name: /Só ativas/ });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Só ativas/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('region', { name: 'Filtros avançados' })).toBeInTheDocument();

    await user.click(within(again).getByRole('checkbox', { name: /não encontradas/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Filtros avançados' })).not.toBeInTheDocument();
  });

  it('hotel, situação, "Só canceladas", canal e "não encontradas" valem na hora', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    const panel = await openFiltersPanel(user);

    await user.click(within(panel).getByPlaceholderText('Todos os hotéis'));
    await user.click(await screen.findByRole('option', { name: /Pousada Serra/ }));
    await user.click(within(panel).getByPlaceholderText('Todas as situações'));
    await user.click(await screen.findByRole('option', { name: 'Pendente de cobrança' }));
    await user.click(within(panel).getByRole('combobox', { name: 'Ativa ou cancelada' }));
    await user.click(await screen.findByRole('option', { name: /Só canceladas/ }));
    await user.click(within(panel).getByPlaceholderText('Todos os canais'));
    await user.click(await screen.findByRole('option', { name: 'Expedia' }));
    await user.click(within(panel).getByRole('checkbox', { name: /não encontradas/ }));

    await waitFor(() =>
      expect(lastListQuery(hunit)).toMatchObject({
        hotelCode: ['32'],
        detailedSituation: ['virtual_card_pending_charge'],
        reservationStatus: ['cancelled'],
        channel: 'Expedia',
        notFound: true,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();
  });

  it('"Ativa ou cancelada" tem as opções do design e "Só não identificadas" (research UX-3)', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    const panel = await openFiltersPanel(user);

    await user.click(within(panel).getByRole('combobox', { name: 'Ativa ou cancelada' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Ativas e canceladasTodas as reservas',
      'Só ativasEsconde as canceladas',
      'Só canceladasMostra só as canceladas',
      'Só não identificadasSem a situação no Hunit',
    ]);
    await user.click(await screen.findByRole('option', { name: /Só não identificadas/ }));

    await waitFor(() =>
      expect(lastListQuery(hunit)).toMatchObject({ reservationStatus: ['unknown'] }),
    );
  });

  it('o período só vale com início e fim; só o início mostra o aviso', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
    try {
      renderWithApp(<ReservationsScreen />, hunit);
      const user = userEvent.setup();
      await findRow('7001');
      const panel = await openFiltersPanel(user);

      await user.click(within(panel).getByLabelText('Período de check-in'));
      const [first] = await screen.findAllByRole('button', { name: '1 novembro 2026' });
      if (first) await user.click(first);
      expect(
        await screen.findByText('Escolha também o fim do período (ou limpe o período).'),
      ).toBeInTheDocument();
      expect(lastListQuery(hunit)).not.toHaveProperty('checkInFrom');

      const [last] = await screen.findAllByRole('button', { name: '7 novembro 2026' });
      if (last) await user.click(last);
      await waitFor(() =>
        expect(lastListQuery(hunit)).toMatchObject({
          checkInFrom: '2026-11-01',
          checkInTo: '2026-11-07',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('"Filtros aplicados" e "Origem" (R-11, FR-034)', () => {
  it('um chip por filtro do painel; tirar um chip tira o filtro', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    expect(applied()).not.toBeInTheDocument();
    const panel = await openFiltersPanel(user);
    await user.click(within(panel).getByPlaceholderText('Todos os canais'));
    await user.click(await screen.findByRole('option', { name: 'Expedia' }));
    await user.click(within(panel).getByRole('checkbox', { name: /não encontradas/ }));

    const row = await screen.findByRole('group', { name: 'Filtros aplicados' });
    expect(row).toHaveTextContent('Canal: Expedia');
    expect(row).toHaveTextContent('Não encontradas na última verificação');

    await user.click(within(row).getByRole('button', { name: 'Tirar o filtro de canal' }));
    await waitFor(() => expect(lastListQuery(hunit)).not.toHaveProperty('channel'));
    expect(lastListQuery(hunit)).toMatchObject({ notFound: true });
  });

  it('"Origem" fica na barra e não se repete nos filtros aplicados', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');

    await user.click(screen.getByRole('combobox', { name: 'Origem' }));
    await user.click(await screen.findByRole('option', { name: 'Sistema anterior' }));

    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ fromLegacy: true }));
    expect(applied()).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        'Mostrando 1 de 12 reservas · origem: sistema anterior (importadas do sistema anterior)',
      ),
    ).toBeInTheDocument();
  });

  it('o filtro da execução vem do detalhe dela e pode ser tirado', async () => {
    renderWithApp(<ReservationsScreen initialExecutionId={EXECUTION} />, hunit);
    const user = userEvent.setup();

    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ executionId: EXECUTION }));
    const row = await screen.findByRole('group', { name: 'Filtros aplicados' });
    expect(row).toHaveTextContent('Execução 11111111');

    await user.click(within(row).getByRole('button', { name: 'Tirar o filtro da execução' }));
    await waitFor(() => expect(lastListQuery(hunit)).not.toHaveProperty('executionId'));
  });

  it('"Limpar busca e filtros" tira a busca, o painel, a Origem e o filtro rápido', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    await typeSearch(user, 'joao');
    await user.click(screen.getByRole('combobox', { name: 'Origem' }));
    await user.click(await screen.findByRole('option', { name: 'HUNIT Control' }));
    await user.click(quickFilterChip('Falta cobrar'));
    const panel = await openFiltersPanel(user);
    await user.click(within(panel).getByRole('checkbox', { name: /não encontradas/ }));
    await waitFor(() =>
      expect(lastListQuery(hunit)).toMatchObject({
        q: 'joao',
        fromLegacy: false,
        quickFilter: 'pending_charge',
        notFound: true,
      }),
    );

    const row = await screen.findByRole('group', { name: 'Filtros aplicados' });
    await user.click(within(row).getByRole('button', { name: 'Limpar busca e filtros' }));

    await waitFor(() =>
      expect(lastListQuery(hunit)).toEqual({ order: 'hotel_check_in', limit: 50 }),
    );
    expect(applied()).not.toBeInTheDocument();
    expect(quickFilterChip('Todas')).toHaveAttribute('aria-pressed', 'true');
  });
});
