/**
 * Tela Executar (specs/002, T043, US1, FR-006 a FR-010, FR-004): acesso ao Hunit guardado no cofre
 * do processo principal, período em DD/MM/AAAA validado, hotéis (todos ou uma seleção com busca),
 * mensagens dos erros e "Iniciar de novo" depois de prazo do token esgotado ou token recusado.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunScreen } from '../../src/renderer/src/screens/run/RunScreen';
import type { Execution, Hotel } from '../../src/shared/ipc-types';
import {
  errorResult,
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';

const ID = '11111111-1111-4111-8111-111111111111';
const HOTELS: Hotel[] = [
  { code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '2026-11-12T12:00:00Z' },
  { code: '32', name: 'Pousada Serra', available: true, lastSeenAt: '2026-11-12T12:00:00Z' },
];

function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: ID,
    status: 'queued',
    period: { from: '2026-11-01', to: '2026-11-07' },
    createdAt: '2026-11-12T12:00:00.000Z',
    requestedClient: 'desktop-financeiro',
    endReason: null,
    hotels: [],
    counts: {},
    recentEvents: [],
    warnings: [],
    ...overrides,
  };
}

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
  mocked(hunit.api.hotels.list).mockImplementation(() => okResult(HOTELS));
});

async function fillPeriod(from: string, to: string) {
  const user = userEvent.setup();
  const start = await screen.findByLabelText(/check-in de/i);
  const end = screen.getByLabelText(/check-in até/i);
  await user.clear(start);
  await user.type(start, from);
  await user.clear(end);
  await user.type(end, to);
  await user.click(document.body);
  return user;
}

async function saveAccess(user = userEvent.setup()) {
  await user.type(await screen.findByLabelText(/usuário do hunit/i), 'op@hotel.test');
  await user.type(screen.getByLabelText(/senha do hunit/i), 'SENHA-MARCADOR-RUN');
  await user.click(screen.getByRole('button', { name: /guardar acesso/i }));
  return user;
}

describe('RunScreen — acesso ao Hunit (FR-006 a FR-008)', () => {
  it('informar usuário e senha guarda no cofre e mostra o usuário e "senha guardada"', async () => {
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);

    await saveAccess();

    expect(hunit.api.credentials.set).toHaveBeenCalledWith({
      username: 'op@hotel.test',
      password: 'SENHA-MARCADOR-RUN',
    });
    expect(await screen.findByText('op@hotel.test')).toBeInTheDocument();
    expect(screen.getByText(/senha guardada/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('SENHA-MARCADOR-RUN')).not.toBeInTheDocument();
  });

  it('"Limpar acesso" esvazia o cofre', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'op@hotel.test', hasPassword: true }),
    );
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);

    await userEvent.click(await screen.findByRole('button', { name: /limpar acesso/i }));

    expect(hunit.api.credentials.clear).toHaveBeenCalled();
    expect(await screen.findByLabelText(/usuário do hunit/i)).toBeInTheDocument();
  });

  it('esvaziado por inatividade: explica e pede de novo', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'op@hotel.test', hasPassword: true }),
    );
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
    await screen.findByText(/senha guardada/i);

    act(() => hunit.emit.credentialsCleared('idle'));

    expect(await screen.findByText(/apagados por inatividade/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/usuário do hunit/i)).toBeInTheDocument();
  });
});

describe('RunScreen — período e hotéis (FR-009, FR-010)', () => {
  it('período com fim antes do início não é enviado', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'op@hotel.test', hasPassword: true }),
    );
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
    const user = await fillPeriod('10/11/2026', '03/11/2026');

    await user.click(screen.getByRole('button', { name: /iniciar execução/i }));

    expect(await screen.findByText(/não pode ser antes do início/i)).toBeInTheDocument();
    expect(hunit.api.executions.start).not.toHaveBeenCalled();
  });

  it('as datas são digitadas e mostradas em DD/MM/AAAA e vão no formato da API', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'op@hotel.test', hasPassword: true }),
    );
    mocked(hunit.api.executions.start).mockImplementation(() => okResult(execution()));
    mocked(hunit.api.executions.get).mockImplementation(() => okResult(execution()));
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
    const user = await fillPeriod('01/11/2026', '07/11/2026');

    expect(screen.getByDisplayValue('01/11/2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /iniciar execução/i }));

    await waitFor(() =>
      expect(hunit.api.executions.start).toHaveBeenCalledWith({
        period: { from: '2026-11-01', to: '2026-11-07' },
        hotelCodes: null,
      }),
    );
  });

  it('escolher hotéis com busca pelo nome ou pelo código', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'op@hotel.test', hasPassword: true }),
    );
    mocked(hunit.api.executions.start).mockImplementation(() => okResult(execution()));
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
    const user = await fillPeriod('01/11/2026', '07/11/2026');

    await user.click(await screen.findByRole('radio', { name: /escolher hotéis/i }));
    const select = screen.getByPlaceholderText(/busque pelo nome/i);
    await user.type(select, 'serra');
    await user.click(await screen.findByRole('option', { name: /Pousada Serra/ }));
    await user.type(select, '31');
    await user.click(await screen.findByRole('option', { name: /Hotel Praia/ }));
    await user.click(screen.getByRole('button', { name: /iniciar execução/i }));

    await waitFor(() =>
      expect(hunit.api.executions.start).toHaveBeenCalledWith(
        expect.objectContaining({ hotelCodes: ['32', '31'] }),
      ),
    );
  });

  it('catálogo vazio: só "todos os hotéis", com a explicação', async () => {
    mocked(hunit.api.hotels.list).mockImplementation(() => okResult([]));
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);

    expect(await screen.findByText(/catálogo .* será obtido nesta execução/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /escolher hotéis/i })).toBeDisabled();
  });
});

describe('RunScreen — iniciar e erros', () => {
  it('sem acesso guardado, iniciar com os campos preenchidos guarda e inicia', async () => {
    mocked(hunit.api.executions.start).mockImplementation(() => okResult(execution()));
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/usuário do hunit/i), 'op@hotel.test');
    await user.type(screen.getByLabelText(/senha do hunit/i), 'SENHA-MARCADOR-RUN');

    await user.click(screen.getByRole('button', { name: /iniciar execução/i }));

    await waitFor(() => expect(hunit.api.executions.start).toHaveBeenCalled());
    expect(hunit.api.credentials.set).toHaveBeenCalled();
  });

  it('credentials_expired explica a inatividade e pede o acesso de novo', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'op@hotel.test', hasPassword: true }),
    );
    mocked(hunit.api.executions.start).mockImplementation(() => errorResult('credentials_expired'));
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);

    await userEvent.click(await screen.findByRole('button', { name: /iniciar execução/i }));

    expect(await screen.findByText(/apagados por inatividade/i)).toBeInTheDocument();
  });

  it('execution_already_active leva à execução ativa', async () => {
    const onOpenExecution = vi.fn();
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'op@hotel.test', hasPassword: true }),
    );
    mocked(hunit.api.executions.start).mockImplementation(() =>
      errorResult('execution_already_active'),
    );
    mocked(hunit.api.executions.list).mockImplementation(() =>
      okResult({ items: [execution({ status: 'running' })], nextCursor: null }),
    );
    renderWithApp(<RunScreen onOpenExecution={onOpenExecution} />, hunit);

    await userEvent.click(await screen.findByRole('button', { name: /iniciar execução/i }));
    await userEvent.click(await screen.findByRole('button', { name: /ver a execução ativa/i }));

    expect(onOpenExecution).toHaveBeenCalledWith(ID);
  });

  it('a senha nunca aparece numa mensagem de erro (FR-007)', async () => {
    mocked(hunit.api.executions.start).mockImplementation(() => okResult(execution()));
    mocked(hunit.api.executions.get).mockImplementation(() =>
      okResult(execution({ status: 'failed', endReason: 'invalid_credentials' })),
    );
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
    await saveAccess();

    await userEvent.click(screen.getByRole('button', { name: /iniciar execução/i }));

    expect(await screen.findByText(/usuário ou senha do hunit incorretos/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SENHA-MARCADOR-RUN');
  });

  it('perfil consulta não vê o formulário (FR-004)', async () => {
    renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, fakeHunit(ONLINE_READER));

    expect(await screen.findByText(/perfil consulta/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /iniciar execução/i })).not.toBeInTheDocument();
  });
});

describe('RunScreen — "Iniciar de novo" (US1, cenário 5)', () => {
  it.each(['two_factor_timeout', 'invalid_token'] as const)(
    'depois de %s, reenvia o mesmo período e os mesmos hotéis',
    async (endReason) => {
      mocked(hunit.api.credentials.status).mockImplementation(() =>
        okResult({ username: 'op@hotel.test', hasPassword: true }),
      );
      mocked(hunit.api.executions.start).mockImplementation(() => okResult(execution()));
      mocked(hunit.api.executions.get).mockImplementation(() =>
        okResult(execution({ status: 'failed', endReason })),
      );
      renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
      const user = await fillPeriod('01/11/2026', '07/11/2026');
      await user.click(screen.getByRole('button', { name: /iniciar execução/i }));

      const result = await screen.findByTestId('execution-result');
      await user.click(within(result).getByRole('button', { name: /iniciar de novo/i }));

      await waitFor(() => expect(hunit.api.executions.start).toHaveBeenCalledTimes(2));
      expect(mocked(hunit.api.executions.start).mock.calls[1]?.[0]).toEqual({
        period: { from: '2026-11-01', to: '2026-11-07' },
        hotelCodes: null,
      });
    },
  );
});
