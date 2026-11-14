/**
 * Seleção do lote na tela Reservas (specs/003, T037 e T042; US3 cenários 4 a 6, US4, FR-006a,
 * FR-015): as marcas se mantêm entre pesquisas, filtros e páginas, a lista da seleção mostra
 * também o que saiu do resultado, e depois do lote só as que falharam continuam marcadas. Inclui o
 * atalho "Falta cobrar", o filtro de tratativa e o perfil consulta.
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
  const field = screen.getByLabelText(/busca livre/i);
  await user.clear(field);
  await user.type(field, number);
  await user.click(screen.getByRole('button', { name: /^buscar$/i }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ q: number }));
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
    expect(screen.queryByText('7001')).not.toBeInTheDocument();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent(
      '3 reservas selecionadas — total de R$ 300,00',
    );

    // Voltar à primeira pesquisa: a reserva reaparece já marcada.
    await searchFor(user, '7001');
    expect(await checkbox('7001')).toBeChecked();
  });

  it('trocar filtros, limpar a busca e carregar mais mantêm as marcas', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await user.click(await checkbox('7002'));

    await user.click(screen.getByRole('button', { name: 'Falta cobrar' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ pendingCharge: true }));
    expect(await checkbox('7002')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(lastQuery()).not.toHaveProperty('pendingCharge'));
    expect(await checkbox('7002')).toBeChecked();

    await user.click(await screen.findByRole('button', { name: /carregar mais/i }));
    await screen.findByText('7003');
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

    const list = within(await screen.findByRole('table', { name: 'Reservas selecionadas' }));
    expect(list.getByRole('row', { name: /7001/ })).toHaveTextContent('Hotel Praia');
    expect(list.getByRole('row', { name: /8001/ })).toHaveTextContent('Pendente de cobrança');

    await user.click(screen.getByRole('button', { name: 'Desmarcar a reserva 7001' }));
    expect(list.queryByRole('row', { name: /7001/ })).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Anexar comprovante' }));

    expect(
      await screen.findByRole('dialog', { name: /anexar comprovante a 2 reservas/i }),
    ).toBeVisible();
    await screen.findByTestId('attach-summary');
    expect(mocked(hunit.api.treatments.check).mock.calls[0]?.[0]).toEqual({
      kind: 'proof',
      reservations: [
        { hotelCode: '31', reservationNumber: '7001' },
        { hotelCode: '31', reservationNumber: '8001' },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await screen.findByTestId('attach-result');
    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    // A que foi registrada sai da seleção; a que falhou fica, para repetir (FR-006a).
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('1 reserva selecionada');
    expect(await checkbox('8001')).toBeChecked();
  });

  it('"Anexar tratativa" abre o lote com o tipo certo; cancelar mantém a seleção', async () => {
    mocked(hunit.api.treatments.pickFile).mockImplementation(() => okResult(null));
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await user.click(await checkbox('7001'));

    await user.click(screen.getByRole('button', { name: 'Anexar tratativa' }));

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
  it('mostra "Enviada" e "Cobrada" em cada linha', async () => {
    serveByNumber({
      '7001': { treatment: treatment({ status: 'sent', request: document({ kind: 'request' }) }) },
      '7002': { treatment: treatment({ status: 'charged', proof: document() }) },
    });
    renderWithApp(<ReservationsScreen />, hunit);

    expect(await screen.findByRole('row', { name: /7001/ })).toHaveTextContent('Enviada');
    expect(screen.getByRole('row', { name: /7002/ })).toHaveTextContent('Cobrada');
  });

  it('"Falta cobrar" vale na hora e só envia o pedido: a regra é do servidor', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await screen.findByText('7001');
    const shortcut = screen.getByRole('button', { name: 'Falta cobrar' });
    expect(shortcut).toHaveAttribute('aria-pressed', 'false');

    await user.click(shortcut);

    await waitFor(() => expect(lastQuery()).toMatchObject({ pendingCharge: true }));
    // A tela não monta a lista de classificações por conta própria.
    expect(lastQuery()).not.toHaveProperty('classification');
    expect(lastQuery()).not.toHaveProperty('treatmentStatus');
    expect(shortcut).toHaveAttribute('aria-pressed', 'true');

    await user.click(shortcut);
    await waitFor(() => expect(lastQuery()).not.toHaveProperty('pendingCharge'));
  });

  it('o filtro "Tratativa" aceita mais de uma situação e vai como treatmentStatus', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await screen.findByText('7001');

    await user.click(screen.getByPlaceholderText('Com ou sem tratativa'));
    await user.click(await screen.findByRole('option', { name: 'Sem tratativa' }));
    await user.click(await screen.findByRole('option', { name: 'Enviada' }));
    await user.click(screen.getByRole('button', { name: /^buscar$/i }));

    await waitFor(() => expect(lastQuery()).toMatchObject({ treatmentStatus: ['none', 'sent'] }));
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

    expect(await screen.findByRole('row', { name: /7001/ })).toHaveTextContent('Cobrada');
    expect(screen.queryByRole('checkbox', { name: /selecionar/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    // Os filtros de consulta continuam disponíveis.
    expect(screen.getByRole('button', { name: 'Falta cobrar' })).toBeInTheDocument();
  });
});
