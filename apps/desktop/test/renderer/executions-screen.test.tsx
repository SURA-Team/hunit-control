/**
 * Tela Execuções (specs/002, T054, US2, FR-015 a FR-019, FR-016a): lista com quem iniciou, detalhe
 * com andamento, estimativa, contagens e avisos, cancelar com confirmação, retomar usando o cofre,
 * ligação entre a original e a retomada e campo de token para o perfil operador. Desde a 006 (T055 e
 * T056; telas 3.1 a 3.4): a em andamento num card escuro e as demais no "Histórico"; no detalhe, a
 * faixa de progresso, as contagens em caixas e os hotéis em linhas.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionsScreen } from '../../src/renderer/src/screens/executions/ExecutionsScreen';
import type { Execution, ExecutionSummary } from '../../src/shared/ipc-types';
import {
  errorResult,
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';

const RUNNING = '11111111-1111-4111-8111-111111111111';
const FAILED = '22222222-2222-4222-8222-222222222222';
const RESUMED = '33333333-3333-4333-8333-333333333333';

const SUMMARIES: ExecutionSummary[] = [
  {
    id: RUNNING,
    status: 'running',
    period: { from: '2026-11-01', to: '2026-11-07' },
    createdAt: '2026-11-12T12:00:00.000Z',
    requestedClient: 'desktop-financeiro',
    endReason: null,
    finishedAt: null,
  },
  {
    id: FAILED,
    status: 'failed',
    period: { from: '2026-10-01', to: '2026-10-31' },
    createdAt: '2026-11-11T09:00:00.000Z',
    requestedClient: 'desktop-controladoria',
    endReason: 'server_restarted',
    finishedAt: '2026-11-11T09:20:00.000Z',
  },
];

function detail(summary: ExecutionSummary, overrides: Partial<Execution> = {}): Execution {
  return {
    ...summary,
    twoFactorDeadline: null,
    current: null,
    hotels: [],
    counts: {},
    recentEvents: [],
    warnings: [],
    ...overrides,
  };
}

const RUNNING_DETAIL = detail(SUMMARIES[0] as ExecutionSummary, {
  current: { hotelCode: '31', page: 2, pagesTotal: 5, reservationNumber: '3107' },
  timing: { avgSecondsPerReservation: 0.3, avgSecondsPerHotel: 60, estimatedRemainingSeconds: 750 },
  counts: { virtual_card_pending_charge: 4 },
  hotels: [
    {
      hotelCode: '31',
      hotelName: 'Hotel Praia',
      status: 'running',
      pagesDone: 1,
      pagesTotal: 5,
      reservationsSeen: 57,
      durationSeconds: null,
      counts: { virtual_card_pending_charge: 4 },
      failureReason: null,
    },
    {
      hotelCode: '32',
      hotelName: 'Pousada Serra',
      status: 'pending',
      pagesDone: null,
      pagesTotal: null,
      reservationsSeen: 0,
      durationSeconds: null,
      counts: {},
      failureReason: 'A conta do Hunit usada não acessa este hotel.',
    },
  ],
  warnings: [
    {
      id: '91',
      at: '2026-11-12T12:05:00.000Z',
      type: 'warning',
      hotelCode: '31',
      message: 'Hotel Praia: o Hunit não respondeu. Nova tentativa 2 de 5 em 5 s.',
    },
    {
      id: '90',
      at: '2026-11-12T12:04:50.000Z',
      type: 'warning',
      hotelCode: '31',
      message: 'Hotel Praia: o Hunit não respondeu. Nova tentativa 1 de 5 em 2 s.',
    },
  ],
});

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
  mocked(hunit.api.executions.list).mockImplementation(() =>
    okResult({ items: SUMMARIES, nextCursor: null }),
  );
  mocked(hunit.api.executions.get).mockImplementation((id: string) =>
    okResult(id === RUNNING ? RUNNING_DETAIL : detail(SUMMARIES[1] as ExecutionSummary)),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Abre o detalhe da execução cujo texto bate com `name`: a em andamento pelo "Ver detalhes" do card
 * escuro (tela 3.1), as encerradas pela linha do "Histórico".
 */
async function openDetail(name: RegExp) {
  await screen.findByText(/desktop-controladoria/);
  const card = screen
    .queryAllByRole('region')
    .find((candidate) => name.test(candidate.textContent ?? ''));
  if (card) {
    await userEvent.click(within(card).getByRole('button', { name: 'Ver detalhes' }));
  } else {
    const row = screen
      .getAllByRole('row')
      .find((candidate) => name.test(candidate.textContent ?? ''));
    if (!row) throw new Error('execução não encontrada');
    await userEvent.click(row);
  }
  return screen.findByTestId('execution-detail');
}

describe('lista de execuções (FR-015)', () => {
  it('a em andamento num card escuro; as encerradas no "Histórico", com quem iniciou e o resultado', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);

    const card = await screen.findByRole('region', { name: /^Em andamento: Iniciada em/ });
    expect(card).toHaveTextContent(
      'Check-in 01/11 a 07/11/2026 · desktop-financeiro (esta máquina)',
    );
    expect(within(card).getByRole('button', { name: 'Ver detalhes' })).toBeInTheDocument();

    const history = screen.getByRole('table', { name: 'Histórico das execuções' });
    expect(screen.getByRole('heading', { name: 'Histórico' })).toBeInTheDocument();
    const rows = within(history).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('desktop-controladoria');
    expect(rows[0]).toHaveTextContent('Falhou');
    expect(rows[0]).toHaveTextContent('O servidor reiniciou durante a execução');
    expect(screen.getByText('2 execuções · as mais recentes primeiro')).toBeInTheDocument();
  });

  it('atualiza a lista a cada 10 s enquanto está na tela', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithApp(<ExecutionsScreen />, hunit);
    await screen.findAllByRole('row');
    const calls = mocked(hunit.api.executions.list).mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(10_500));

    await waitFor(() =>
      expect(mocked(hunit.api.executions.list).mock.calls.length).toBeGreaterThan(calls),
    );
  });
});

describe('detalhe da execução (FR-016, FR-016a)', () => {
  it('mostra estado, hotel atual, progresso de cada hotel, estimativa e contagens', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-financeiro/));

    expect(await panel.findByText(/Hotel atual/)).toBeInTheDocument();
    expect(panel.getByText(/página 2 de 5/i)).toBeInTheDocument();
    expect(panel.getByText(/12 min 30 s/)).toBeInTheDocument();
    expect(panel.getByTestId('count-virtual_card_pending_charge')).toHaveTextContent('4');
    expect(panel.getByTestId('hotel-31')).toHaveTextContent(
      'Código 31 · lendo reservas · página 1 de 5',
    );
    expect(panel.getByText('A conta do Hunit usada não acessa este hotel.')).toBeInTheDocument();
  });

  it('mostra os avisos com horário, hotel e mensagem, e o mais recente junto do hotel em andamento', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-financeiro/));

    const warnings = within(await panel.findByTestId('execution-warnings'));
    const items = warnings.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Nova tentativa 2 de 5');
    expect(items[1]).toHaveTextContent('Nova tentativa 1 de 5');
    const hotelRow = panel.getByTestId('hotel-31');
    expect(hotelRow).toHaveTextContent('Nova tentativa 2 de 5');
  });

  it('sem avisos, a seção não aparece', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-controladoria/));

    await panel.findByText('Falhou');
    expect(panel.queryByTestId('execution-warnings')).not.toBeInTheDocument();
  });

  it('abrir acompanha a execução (watch) e fechar deixa de acompanhar (unwatch)', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);
    await openDetail(/desktop-financeiro/);

    expect(hunit.api.executions.watch).toHaveBeenCalledWith(RUNNING);
    await userEvent.click(screen.getByRole('button', { name: /fechar detalhe/i }));
    await waitFor(() => expect(hunit.api.executions.unwatch).toHaveBeenCalledWith(RUNNING));
  });

  it('a cada evento do servidor, busca o estado de novo e mostra a mudança (FR-016)', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-financeiro/));
    await panel.findByText(/página 2 de 5/i);

    mocked(hunit.api.executions.get).mockImplementation(() =>
      okResult({ ...RUNNING_DETAIL, current: { hotelCode: '31', page: 3, pagesTotal: 5 } }),
    );
    act(() => hunit.emit.executionChanged({ executionId: RUNNING }));

    expect(await panel.findByText(/página 3 de 5/i, {}, { timeout: 5_000 })).toBeInTheDocument();
  });
});

describe('ações do operador (FR-017, FR-018)', () => {
  it('cancelar pede confirmação', async () => {
    mocked(hunit.api.executions.cancel).mockImplementation(() =>
      okResult({ ...RUNNING_DETAIL, status: 'running' }),
    );
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-financeiro/));

    const cancelButton = await panel.findByRole('button', { name: /cancelar execução/i });
    // Sem o "Leve" (specs/006, FR-013): destrutiva em vermelho suave.
    expect(cancelButton).toHaveAttribute('data-variant', 'danger-light');
    await userEvent.click(cancelButton);
    expect(hunit.api.executions.cancel).not.toHaveBeenCalled();
    // Tela 3.3: "Não" em contorno e "Sim, cancelar" em vermelho cheio (FR-009).
    const confirm = within(await screen.findByRole('dialog', { name: 'Cancelar a execução?' }));
    expect(confirm.getByRole('button', { name: 'Não' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    const yes = confirm.getByRole('button', { name: /sim, cancelar/i });
    expect(yes).toHaveAttribute('data-variant', 'danger');
    await userEvent.click(yes);

    await waitFor(() => expect(hunit.api.executions.cancel).toHaveBeenCalledWith(RUNNING));
  });

  it('retomar usa o cofre; vazio, pede o acesso e tenta de novo', async () => {
    mocked(hunit.api.executions.resume)
      .mockImplementationOnce(() => errorResult('credentials_missing'))
      .mockImplementation(() =>
        okResult(
          detail({
            ...(SUMMARIES[1] as ExecutionSummary),
            id: RESUMED,
            status: 'queued',
            parentExecutionId: FAILED,
          }),
        ),
      );
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-controladoria/));
    const user = userEvent.setup();

    await user.click(await panel.findByRole('button', { name: /^retomar$/i }));
    await user.type(await screen.findByLabelText(/usuário do hunit/i), 'op@hotel.test');
    await user.type(screen.getByLabelText(/senha do hunit/i), 'SENHA-MARCADOR-RESUME');
    await user.click(screen.getByRole('button', { name: /guardar e retomar/i }));

    await waitFor(() => expect(hunit.api.executions.resume).toHaveBeenCalledTimes(2));
    expect(hunit.api.credentials.set).toHaveBeenCalledWith({
      username: 'op@hotel.test',
      password: 'SENHA-MARCADOR-RESUME',
    });
    expect(await screen.findByRole('button', { name: /abrir a retomada/i })).toBeInTheDocument();
  });

  it('mostra a ligação entre a retomada e a original', async () => {
    mocked(hunit.api.executions.get).mockImplementation((id: string) =>
      okResult(
        id === RUNNING
          ? { ...RUNNING_DETAIL, parentExecutionId: FAILED }
          : detail(SUMMARIES[1] as ExecutionSummary),
      ),
    );
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-financeiro/));

    await userEvent.click(await panel.findByRole('button', { name: /retomada de/i }));

    await waitFor(() => expect(hunit.api.executions.get).toHaveBeenCalledWith(FAILED));
  });

  it('perfil operador vê o campo de token numa execução de outra máquina que aguarda token', async () => {
    mocked(hunit.api.executions.get).mockImplementation(() =>
      okResult({
        ...RUNNING_DETAIL,
        status: 'awaiting_2fa',
        requestedClient: 'desktop-controladoria',
        twoFactorDeadline: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    renderWithApp(<ExecutionsScreen />, hunit);
    const panel = within(await openDetail(/desktop-financeiro/));
    const user = userEvent.setup();

    await user.type(await panel.findByLabelText(/token do autenticador/i), '123456');
    await user.click(panel.getByRole('button', { name: /enviar token/i }));

    expect(hunit.api.executions.sendToken).toHaveBeenCalledWith({
      executionId: RUNNING,
      token: '123456',
    });
  });

  it('perfil consulta não vê cancelar, retomar nem token (SC-009)', async () => {
    const reader = fakeHunit(ONLINE_READER);
    mocked(reader.api.executions.list).mockImplementation(() =>
      okResult({ items: SUMMARIES, nextCursor: null }),
    );
    mocked(reader.api.executions.get).mockImplementation(() =>
      okResult({
        ...RUNNING_DETAIL,
        status: 'awaiting_2fa',
        twoFactorDeadline: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    renderWithApp(<ExecutionsScreen />, reader);
    const panel = within(await openDetail(/desktop-financeiro/));

    await panel.findByText('Aguardando token');
    expect(panel.queryByRole('button', { name: /cancelar execução/i })).not.toBeInTheDocument();
    expect(panel.queryByRole('button', { name: /^retomar$/i })).not.toBeInTheDocument();
    expect(panel.queryByLabelText(/token do autenticador/i)).not.toBeInTheDocument();
  });

  it('abre direto a execução pedida por outra tela', async () => {
    renderWithApp(<ExecutionsScreen initialExecutionId={RUNNING} />, hunit);

    expect(await screen.findByTestId('execution-detail')).toBeInTheDocument();
    expect(hunit.api.executions.get).toHaveBeenCalledWith(RUNNING);
  });
});

describe('visual novo de Execuções (specs/006, T055 e T056; telas 3.1 a 3.4)', () => {
  const summary = (id: string, client: string): ExecutionSummary => ({
    ...(SUMMARIES[0] as ExecutionSummary),
    id,
    requestedClient: client,
  });

  it('duas em andamento (contas diferentes): um card para cada, com o andamento dos hotéis', async () => {
    const other = '44444444-4444-4444-8444-444444444444';
    mocked(hunit.api.executions.list).mockImplementation(() =>
      okResult({
        items: [summary(RUNNING, 'desktop-financeiro'), summary(other, 'desktop-controladoria')],
        nextCursor: null,
      }),
    );
    mocked(hunit.api.executions.get).mockImplementation((id: string) =>
      okResult({ ...RUNNING_DETAIL, id }),
    );
    renderWithApp(<ExecutionsScreen />, hunit);

    await waitFor(() =>
      expect(screen.getAllByRole('region', { name: /^Em andamento:/ })).toHaveLength(2),
    );
    const cards = screen.getAllByRole('region', { name: /^Em andamento:/ });
    // 1 de 2 hotéis terminou? Nenhum: um em andamento e um pendente.
    await waitFor(() => expect(cards[0]).toHaveTextContent('0 de 2 hotéis concluídos'));
    expect(cards[1]).toHaveTextContent('desktop-controladoria');
    expect(screen.queryByRole('table', { name: 'Histórico das execuções' })).toBeNull();
  });

  it('nenhuma em andamento: sem card, só o "Histórico"', async () => {
    mocked(hunit.api.executions.list).mockImplementation(() =>
      okResult({ items: [SUMMARIES[1] as ExecutionSummary], nextCursor: null }),
    );
    renderWithApp(<ExecutionsScreen />, hunit);

    expect(
      await screen.findByRole('table', { name: 'Histórico das execuções' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Em andamento:/ })).toBeNull();
    // Sem card escuro acima, a lista vem sem o título "Histórico" (telas 5.1 e 6.1).
    expect(screen.queryByRole('heading', { name: 'Histórico' })).toBeNull();
  });

  it('detalhe em andamento: faixa de progresso, contagens em caixas e hotéis em linhas (3.2)', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);
    const detailPanel = await openDetail(/desktop-financeiro/);
    const panel = within(detailPanel);

    expect(
      await panel.findByRole('progressbar', { name: '0 de 2 hotéis concluídos' }),
    ).toBeInTheDocument();
    expect(panel.getByTestId('count-virtual_card_pending_charge')).toHaveAttribute(
      'data-tone',
      'amber',
    );
    const hotels = panel.getByRole('list', { name: 'Hotéis da execução' });
    expect(within(hotels).getAllByRole('listitem')).toHaveLength(2);
    expect(panel.getByTestId('hotel-32')).toHaveTextContent('Código 32 · aguardando na fila');
    expect(within(panel.getByTestId('hotel-31')).getByText('Em andamento')).toHaveAttribute(
      'data-tone',
      'lime',
    );
  });

  it('detalhe encerrado: sem faixa de progresso, "Retomar" é a principal', async () => {
    renderWithApp(<ExecutionsScreen onOpenReservations={vi.fn()} />, hunit);
    const panel = within(await openDetail(/desktop-controladoria/));

    expect(await panel.findByRole('button', { name: /^retomar$/i })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(panel.queryByRole('progressbar')).toBeNull();
    expect(panel.getByRole('button', { name: 'Ver as reservas desta execução' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
  });
});
