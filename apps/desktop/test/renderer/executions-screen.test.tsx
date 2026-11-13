/**
 * Tela Execuções (specs/002, T054, US2, FR-015 a FR-019, FR-016a): lista com quem iniciou, detalhe
 * com andamento, estimativa, contagens e avisos, cancelar com confirmação, retomar usando o cofre,
 * ligação entre a original e a retomada e campo de token para o perfil operador.
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

async function openDetail(name: RegExp) {
  const rows = await screen.findAllByRole('row');
  const row = rows.find((candidate) => name.test(candidate.textContent ?? ''));
  if (!row) throw new Error('linha não encontrada');
  await userEvent.click(row);
  return screen.findByTestId('execution-detail');
}

describe('lista de execuções (FR-015)', () => {
  it('mostra quem iniciou, período, estado, motivo de término e datas, na ordem do servidor', async () => {
    renderWithApp(<ExecutionsScreen />, hunit);

    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows[0]).toHaveTextContent('desktop-financeiro');
    expect(rows[0]).toHaveTextContent('01/11/2026 a 07/11/2026');
    expect(rows[0]).toHaveTextContent('Em andamento');
    expect(rows[1]).toHaveTextContent('desktop-controladoria');
    expect(rows[1]).toHaveTextContent('Falhou');
    expect(rows[1]).toHaveTextContent('O servidor reiniciou durante a execução');
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
    expect(panel.getByText('1 de 5')).toBeInTheDocument();
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

    await userEvent.click(await panel.findByRole('button', { name: /cancelar execução/i }));
    expect(hunit.api.executions.cancel).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /sim, cancelar/i }));

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
