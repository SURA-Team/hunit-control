/**
 * Seleção do lote na tela Reservas (specs/003, T037 e T042; US3 cenários 4 a 6, US4, FR-006a,
 * FR-015): as marcas se mantêm entre pesquisas, filtros e páginas, a lista da seleção mostra
 * também o que saiu do resultado, e depois do lote só as que falharam continuam marcadas. Inclui o
 * atalho "Falta cobrar", o filtro de tratativa e o perfil consulta. Desde a 006 (T036, T041): busca
 * única, filtros rápidos, painel "Filtros avançados" e os menus "Anexar ▾" e "Confirmar ▾" da barra.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import {
  SelectionProvider,
  SELECTION_LIMIT,
  useSelection,
} from '../../src/renderer/src/state/selection';
import type { Reservation, ReservationListInput } from '../../src/shared/ipc-types';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import {
  check,
  document,
  outcome,
  pendingReservation,
  pickedFile,
  treatment,
} from './treatment-fixtures';
import { render, renderHook } from '@testing-library/react';
import {
  chooseFromMenu,
  findRow,
  openFiltersPanel,
  quickFilterChip,
  typeSearch,
} from './reservations-helpers';

let hunit: FakeHunit;

/** O servidor simulado devolve a reserva cujo número foi pesquisado; sem busca, as duas primeiras. */
function serveByNumber(extra: Record<string, Partial<Reservation>> = {}) {
  mocked(hunit.api.reservations.list).mockImplementation((input: ReservationListInput) => {
    if (input.cursor === 'pagina-2') {
      return okResult({ items: [pendingReservation('7003', extra['7003'])], nextCursor: null });
    }
    if (input.q) {
      return okResult({ items: [pendingReservation(input.q, extra[input.q])], nextCursor: null });
    }
    return okResult({
      items: [pendingReservation('7001', extra['7001']), pendingReservation('7002', extra['7002'])],
      nextCursor: 'pagina-2',
    });
  });
}

beforeEach(() => {
  hunit = fakeHunit();
  URL.createObjectURL = vi.fn(() => 'blob:teste');
  URL.revokeObjectURL = vi.fn();
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([{ code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '' }]),
  );
  serveByNumber();
});

function lastQuery(): ReservationListInput {
  return mocked(hunit.api.reservations.list).mock.calls.at(-1)?.[0] ?? {};
}

const checkbox = (number: string) =>
  screen.findByRole('checkbox', { name: `Selecionar a reserva ${number}` });

async function searchFor(user: ReturnType<typeof userEvent.setup>, number: string) {
  await typeSearch(user, number);
  await waitFor(() => expect(lastQuery()).toMatchObject({ q: number }));
  await findRow(number);
}

describe('seleção que não se perde (US3 cenários 4 e 5)', () => {
  it('pesquisar outra reserva não desmarca a anterior, e ela volta marcada', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();

    await user.click(await checkbox('7001'));
    await searchFor(user, '8001');
    await user.click(await checkbox('8001'));
    await searchFor(user, '9001');
    await user.click(await checkbox('9001'));

    // As três continuam selecionadas, embora só a 9001 esteja no resultado.
    expect(screen.queryByRole('row', { name: /7001/ })).not.toBeInTheDocument();
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('3 reservas selecionadas');
    expect(bar.textContent?.replace(/\u00a0/g, ' ')).toContain('total de R$ 300,00');

    // Voltar à primeira pesquisa: a reserva reaparece já marcada.
    await searchFor(user, '7001');
    expect(await checkbox('7001')).toBeChecked();
  }, 30_000); // Cenário longo (várias pesquisas): na rodada completa em paralelo passa dos 15 s padrão.

  it('trocar filtros, limpar a busca e carregar mais mantêm as marcas', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await user.click(await checkbox('7002'));

    await user.click(quickFilterChip('Falta cobrar'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ quickFilter: 'pending_charge' }));
    expect(await checkbox('7002')).toBeChecked();

    await user.click(quickFilterChip('Todas'));
    await waitFor(() => expect(lastQuery()).not.toHaveProperty('quickFilter'));
    expect(await checkbox('7002')).toBeChecked();

    await user.click(await screen.findByRole('button', { name: /carregar mais/i }));
    await findRow('7003');
    expect(await checkbox('7002')).toBeChecked();
    expect(await checkbox('7003')).not.toBeChecked();
  });

  it('"Ver seleção" lista também as que não estão no resultado, e deixa desmarcar e limpar', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await user.click(await checkbox('7001'));
    await searchFor(user, '8001');
    await user.click(await checkbox('8001'));

    await user.click(screen.getByRole('button', { name: 'Ver seleção' }));

    // Tela 4.5: linhas compactas com hóspede, "número · hotel", valor, situação e o X.
    const list = await screen.findByRole('list', { name: 'Reservas selecionadas' });
    const item = (number: string) =>
      within(list)
        .queryAllByRole('listitem')
        .find((row) => row.textContent?.includes(`${number} · `));
    expect(item('7001')).toHaveTextContent('7001 · Hotel Praia');
    expect(item('8001')).toHaveTextContent('Pendente de cobrança');
    expect(screen.getByRole('dialog', { name: 'Reservas selecionadas' })).toHaveTextContent(
      '2 reservas — total de',
    );

    await user.click(screen.getByRole('button', { name: 'Desmarcar a reserva 7001' }));
    expect(item('7001')).toBeUndefined();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('1 reserva selecionada');

    await user.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    expect(await screen.findByText('Nenhuma reserva selecionada.')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('a caixa do cabeçalho marca e desmarca as reservas listadas', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    const all = await screen.findByRole('checkbox', {
      name: 'Selecionar todas as reservas listadas',
    });

    await user.click(all);
    expect(await checkbox('7001')).toBeChecked();
    expect(await checkbox('7002')).toBeChecked();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 reservas selecionadas');

    await user.click(all);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('clicar na caixa não abre o detalhe da reserva', async () => {
    renderWithApp(<ReservationsScreen />, hunit);

    await userEvent.click(await checkbox('7001'));

    expect(screen.queryByTestId('reservation-detail')).not.toBeInTheDocument();
  });
});

describe('aplicar em lote (US3 cenários 1, 2 e 6)', () => {
  it('envia a seleção inteira e, depois, só as que falharam continuam marcadas', async () => {
    mocked(hunit.api.treatments.pickFile).mockImplementation(() => okResult(pickedFile()));
    mocked(hunit.api.treatments.check).mockImplementation((input) =>
      okResult(
        check(
          input.reservations.map((key) => outcome(key.reservationNumber)),
          '200.00',
        ),
      ),
    );
    mocked(hunit.api.treatments.apply).mockImplementation(() =>
      okResult({
        items: [outcome('7001'), outcome('8001', { outcome: 'failed' })],
        failedKeys: [{ hotelCode: '31', reservationNumber: '8001' }],
        retryable: false,
      }),
    );
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await user.click(await checkbox('7001'));
    await searchFor(user, '8001');
    await user.click(await checkbox('8001'));

    await chooseFromMenu(user, 'Anexar', 'Anexar comprovante');

    const dialog = await screen.findByRole('dialog', { name: /anexar comprovante a 2 reservas/i });
    expect(dialog).toBeVisible();
    await screen.findByTestId('attach-summary');
    expect(mocked(hunit.api.treatments.check).mock.calls[0]?.[0]).toEqual({
      kind: 'proof',
      reservations: [
        { hotelCode: '31', reservationNumber: '7001' },
        { hotelCode: '31', reservationNumber: '8001' },
      ],
    });

    // "Confirmar" do diálogo (a barra também tem o menu "Confirmar").
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await screen.findByTestId('attach-result');
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));

    // A que foi registrada sai da seleção; a que falhou fica, para repetir (FR-006a).
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('1 reserva selecionada');
    expect(await checkbox('8001')).toBeChecked();
  });

  it('"Anexar tratativa" abre o lote com o tipo certo; cancelar mantém a seleção', async () => {
    mocked(hunit.api.treatments.pickFile).mockImplementation(() => okResult(null));
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await user.click(await checkbox('7001'));

    await chooseFromMenu(user, 'Anexar', 'Anexar tratativa');

    await waitFor(() =>
      expect(hunit.api.treatments.pickFile).toHaveBeenCalledWith({ kind: 'request' }),
    );
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('1 reserva selecionada');
  });
});

describe('limite da seleção (FR-006a)', () => {
  it('marca até 2 000 e diz quantas ficaram de fora', () => {
    const { result } = renderHook(() => useSelection(), {
      wrapper: ({ children }) => <SelectionProvider>{children}</SelectionProvider>,
    });
    const many = Array.from({ length: SELECTION_LIMIT + 5 }, (_unused, index) =>
      pendingReservation(`N${index}`),
    );

    let skipped = 0;
    act(() => {
      skipped = result.current.add(many).skipped;
    });

    expect(SELECTION_LIMIT).toBe(2000);
    expect(skipped).toBe(5);
    expect(result.current.items).toHaveLength(2000);
    // Marcar de novo o que já está marcado não conta como excesso.
    act(() => {
      skipped = result.current.add(many.slice(0, 10)).skipped;
    });
    expect(skipped).toBe(0);
  });

  it('a tela avisa quando a seleção passa do limite', async () => {
    function Fill() {
      const selection = useSelection();
      return (
        <button
          onClick={() =>
            selection.add(
              Array.from({ length: SELECTION_LIMIT }, (_unused, index) =>
                pendingReservation(`N${index}`),
              ),
            )
          }
        >
          Encher a seleção
        </button>
      );
    }
    renderWithApp(
      <>
        <Fill />
        <ReservationsScreen />
      </>,
      hunit,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Encher a seleção' }));

    await user.click(await checkbox('7001'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Selecione no máximo 2.000 reservas.',
    );
    expect(await checkbox('7001')).not.toBeChecked();
  });

  it('fora do provedor, a seleção fica vazia e não quebra', () => {
    function Probe() {
      return <span>{useSelection().items.length} selecionadas</span>;
    }
    render(<Probe />);

    expect(screen.getByText('0 selecionadas')).toBeInTheDocument();
  });
});

describe('tratativas na lista (US4, FR-015)', () => {
  it('mostra a situação da reserva numa coluna só, com o alerta "Verificar" (FR-002, FR-002a)', async () => {
    mocked(hunit.api.reservations.list).mockImplementation(() =>
      okResult({
        items: [
          pendingReservation('7001', {
            treatment: treatment({ status: 'sent', request: document({ kind: 'request' }) }),
          }),
          pendingReservation('7002', {
            treatment: treatment({ status: 'charged', proof: document() }),
          }),
          pendingReservation('7003', {
            classification: 'virtual_card_already_charged',
            treatment: treatment({
              status: 'sent',
              situation: 'virtual_card_already_charged',
              needsReview: true,
              request: document({ kind: 'request' }),
            }),
          }),
        ],
        nextCursor: null,
      }),
    );
    renderWithApp(<ReservationsScreen />, hunit);

    expect(
      await screen.findByRole('columnheader', { name: 'Situação da reserva' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Tratativa' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Situação de cobrança' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /7001/ })).toHaveTextContent('Tratativa enviada');
    expect(screen.getByRole('row', { name: /7002/ })).toHaveTextContent('Comprovante enviado');
    const review = screen.getByRole('row', { name: /7003/ });
    expect(review).toHaveTextContent('Já cobrada');
    expect(review).toHaveTextContent('Verificar');
    expect(screen.getByRole('row', { name: /7001/ })).not.toHaveTextContent('Verificar');
  });

  it('"Falta cobrar" vale na hora e só envia o pedido: a regra é do servidor', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    expect(quickFilterChip('Falta cobrar')).toHaveAttribute('aria-pressed', 'false');

    await user.click(quickFilterChip('Falta cobrar'));

    await waitFor(() => expect(lastQuery()).toMatchObject({ quickFilter: 'pending_charge' }));
    // A tela não monta a lista de classificações por conta própria.
    expect(lastQuery()).not.toHaveProperty('classification');
    expect(lastQuery()).not.toHaveProperty('treatmentStatus');
    expect(lastQuery()).not.toHaveProperty('detailedSituation');
    expect(quickFilterChip('Falta cobrar')).toHaveAttribute('aria-pressed', 'true');

    await user.click(quickFilterChip('Falta cobrar'));
    await waitFor(() => expect(lastQuery()).not.toHaveProperty('quickFilter'));
  });

  it('o filtro único "Situação da reserva" aceita mais de uma e vai como detailedSituation (FR-015; specs/005)', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    const panel = await openFiltersPanel(user);

    expect(screen.queryByPlaceholderText('Com ou sem tratativa')).not.toBeInTheDocument();
    expect(within(panel).getByText('Ativa ou cancelada')).toBeInTheDocument();
    await user.click(within(panel).getByPlaceholderText('Todas as situações'));
    await user.click(await screen.findByRole('option', { name: 'Tratativa enviada' }));
    await user.click(await screen.findByRole('option', { name: 'Comprovante enviado' }));

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ detailedSituation: ['treatment_sent', 'proof_sent'] }),
    );
    expect(lastQuery()).not.toHaveProperty('classification');
    expect(lastQuery()).not.toHaveProperty('treatmentStatus');
  });

  it('"A verificar" vale na hora e só envia o pedido (FR-002a; specs/006, FR-016)', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');

    await user.click(quickFilterChip('A verificar'));

    await waitFor(() => expect(lastQuery()).toMatchObject({ quickFilter: 'to_review' }));
    expect(lastQuery()).not.toHaveProperty('needsReview');
    expect(quickFilterChip('A verificar')).toHaveAttribute('aria-pressed', 'true');
    await user.click(quickFilterChip('A verificar'));
    await waitFor(() => expect(lastQuery()).not.toHaveProperty('quickFilter'));
  });
});

describe('perfil consulta (FR-014, FR-017)', () => {
  it('vê a tratativa de cada reserva, sem caixas de seleção nem barra de lote', async () => {
    hunit = fakeHunit(ONLINE_READER);
    mocked(hunit.api.reservations.list).mockImplementation(() =>
      okResult({
        items: [
          pendingReservation('7001', {
            treatment: treatment({ status: 'charged', proof: document() }),
          }),
        ],
        nextCursor: null,
      }),
    );
    renderWithApp(<ReservationsScreen />, hunit);

    expect(await screen.findByRole('row', { name: /7001/ })).toHaveTextContent(
      'Comprovante enviado',
    );
    expect(screen.queryByRole('checkbox', { name: /selecionar/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    // Os filtros de consulta continuam disponíveis.
    expect(quickFilterChip('Falta cobrar')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Selecionar todas do filtro' }),
    ).not.toBeInTheDocument();
  });
});
