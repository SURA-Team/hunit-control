/**
 * Diálogo do pedido de token (specs/002, T042, FR-011, FR-013, data-model §4.2): contagem
 * regressiva corrigida pela diferença de relógio, campo em foco, só dígitos, mensagem de cada
 * desfecho e fila de pedidos simultâneos.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorDialog } from '../../src/renderer/src/components/TwoFactorDialog';
import type { TwoFactorCloseReason } from '../../src/shared/ipc-types';
import { errorResult, fakeHunit, mocked, renderWithApp, type FakeHunit } from './render';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

let hunit: FakeHunit;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  hunit = fakeHunit();
});

afterEach(() => {
  vi.useRealTimers();
});

function request(executionId = ID_A, secondsLeft = 125, clockOffsetMs = 0) {
  act(() =>
    hunit.emit.twoFactorRequested({
      executionId,
      deadline: new Date(NOW.getTime() + secondsLeft * 1000).toISOString(),
      clockOffsetMs,
    }),
  );
}

describe('TwoFactorDialog', () => {
  it('a contagem é o prazo menos (agora + diferença de relógio)', async () => {
    renderWithApp(<TwoFactorDialog />, hunit);

    // O relógio do servidor está 10 s atrasado em relação ao da máquina.
    request(ID_A, 125, -10_000);

    expect(await screen.findByText('2:15')).toBeInTheDocument();
  });

  it('o campo do token abre em foco', async () => {
    renderWithApp(<TwoFactorDialog />, hunit);
    request();

    const field = await screen.findByLabelText(/token do autenticador/i);
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('aceita só de 4 a 10 dígitos', async () => {
    renderWithApp(<TwoFactorDialog />, hunit);
    request();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/token do autenticador/i), '12ab');
    await user.click(screen.getByRole('button', { name: /enviar token/i }));

    expect(await screen.findByText(/de 4 a 10 dígitos/i)).toBeInTheDocument();
    expect(hunit.api.executions.sendToken).not.toHaveBeenCalled();
  });

  it('enviar entrega o token e mostra que aguarda o Hunit', async () => {
    renderWithApp(<TwoFactorDialog />, hunit);
    request();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/token do autenticador/i), '123456');
    await user.click(screen.getByRole('button', { name: /enviar token/i }));

    expect(hunit.api.executions.sendToken).toHaveBeenCalledWith({
      executionId: ID_A,
      token: '123456',
    });
    expect(await screen.findByText(/token entregue, aguardando o hunit/i)).toBeInTheDocument();
  });

  it.each([
    ['accepted', /token aceito/i],
    ['rejected', /o hunit recusou o token/i],
    ['expired', /o prazo para informar o token terminou/i],
    ['finished', /a execução terminou/i],
    ['answered_elsewhere', /informado em outr/i],
  ] as const)('fecha com a mensagem de %s', async (reason: TwoFactorCloseReason, message) => {
    renderWithApp(<TwoFactorDialog />, hunit);
    request();
    await screen.findByLabelText(/token do autenticador/i);

    act(() => hunit.emit.twoFactorClosed({ executionId: ID_A, reason }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText(/token do autenticador/i)).not.toBeInTheDocument();
  });

  it('not_awaiting_two_factor: avisa que a execução não aguarda mais o token', async () => {
    mocked(hunit.api.executions.sendToken).mockImplementation(() =>
      errorResult('not_awaiting_two_factor'),
    );
    renderWithApp(<TwoFactorDialog />, hunit);
    request();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/token do autenticador/i), '123456');
    await user.click(screen.getByRole('button', { name: /enviar token/i }));

    expect(await screen.findByText(/a execução não aguarda mais o token/i)).toBeInTheDocument();
  });

  it('pedidos simultâneos entram em fila', async () => {
    renderWithApp(<TwoFactorDialog />, hunit);
    request(ID_A, 120);
    request(ID_B, 90);
    const user = userEvent.setup();

    expect(await screen.findByText('2:00')).toBeInTheDocument();
    act(() => hunit.emit.twoFactorClosed({ executionId: ID_A, reason: 'accepted' }));
    await user.click(await screen.findByRole('button', { name: /fechar/i }));

    expect(await screen.findByText('1:30')).toBeInTheDocument();
  });

  it('o mesmo pedido repetido não duplica a fila', async () => {
    renderWithApp(<TwoFactorDialog />, hunit);
    request(ID_A, 120);
    request(ID_A, 120);
    const user = userEvent.setup();

    act(() => hunit.emit.twoFactorClosed({ executionId: ID_A, reason: 'accepted' }));
    await user.click(await screen.findByRole('button', { name: /fechar/i }));

    await waitFor(() => expect(screen.queryByText(/token aceito/i)).not.toBeInTheDocument());
    expect(screen.queryByLabelText(/token do autenticador/i)).not.toBeInTheDocument();
  });
});
