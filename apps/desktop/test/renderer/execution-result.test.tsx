/**
 * Resultado da execução (specs/002, T044, US1 cenário 7, FR-007, data-model §6): contagens por
 * situação com os nomes da spec 001, hotéis concluídos e com falha (com o motivo) e a mensagem do
 * motivo de término.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionResult } from '../../src/renderer/src/screens/run/ExecutionResult';
import type { Execution } from '../../src/shared/ipc-types';
import { renderWithApp } from './render';

function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'completed',
    period: { from: '2026-11-01', to: '2026-11-07' },
    createdAt: '2026-11-12T12:00:00.000Z',
    finishedAt: '2026-11-12T12:13:18.000Z',
    requestedClient: 'desktop-financeiro',
    endReason: null,
    hotels: [
      {
        hotelCode: '31',
        hotelName: 'Hotel Trinta e Um',
        status: 'completed',
        reservationsSeen: 12,
        durationSeconds: 75,
        counts: { virtual_card_pending_charge: 3, virtual_card_already_charged: 9 },
        failureReason: null,
      },
      {
        hotelCode: '32',
        hotelName: 'Hotel Trinta e Dois',
        status: 'failed',
        reservationsSeen: 0,
        durationSeconds: 4,
        counts: {},
        failureReason: 'O Hunit não respondeu depois das novas tentativas.',
      },
    ],
    counts: { virtual_card_pending_charge: 3, virtual_card_already_charged: 9 },
    recentEvents: [],
    warnings: [],
    ...overrides,
  };
}

describe('ExecutionResult', () => {
  it('mostra as contagens por situação com os nomes da spec 001', () => {
    renderWithApp(<ExecutionResult execution={execution()} />);

    expect(screen.getByText('Pendente de cobrança')).toBeInTheDocument();
    expect(screen.getByText('Já cobrada')).toBeInTheDocument();
    expect(screen.getByTestId('count-virtual_card_pending_charge')).toHaveTextContent('3');
    expect(screen.getByTestId('count-virtual_card_already_charged')).toHaveTextContent('9');
  });

  it('mostra os hotéis concluídos e os que falharam, com o motivo', () => {
    renderWithApp(<ExecutionResult execution={execution()} />);

    expect(screen.getByText(/Hotel Trinta e Um/)).toBeInTheDocument();
    expect(screen.getByText(/Hotel Trinta e Dois/)).toBeInTheDocument();
    expect(
      screen.getByText('O Hunit não respondeu depois das novas tentativas.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Concluído')).toBeInTheDocument();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('mostra a mensagem do motivo de término (data-model §6.4)', () => {
    renderWithApp(
      <ExecutionResult
        execution={execution({
          status: 'failed',
          endReason: 'invalid_credentials',
          hotels: [],
          counts: {},
        })}
      />,
    );

    expect(screen.getByText('Usuário ou senha do Hunit incorretos.')).toBeInTheDocument();
  });

  it('prazo do token esgotado ou token recusado oferece "Iniciar de novo" (US1, cenário 5)', () => {
    const onRestart = vi.fn();
    renderWithApp(
      <ExecutionResult
        execution={execution({
          status: 'failed',
          endReason: 'two_factor_timeout',
          hotels: [],
          counts: {},
        })}
        onRestart={onRestart}
      />,
    );

    screen.getByRole('button', { name: /iniciar de novo/i }).click();
    expect(onRestart).toHaveBeenCalled();
  });

  it('em outros motivos não oferece "Iniciar de novo"', () => {
    renderWithApp(
      <ExecutionResult
        execution={execution({ status: 'failed', endReason: 'hunit_unavailable' })}
        onRestart={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /iniciar de novo/i })).not.toBeInTheDocument();
  });

  it('nenhuma mensagem mostra a senha (FR-007)', () => {
    renderWithApp(
      <ExecutionResult
        execution={execution({ status: 'failed', endReason: 'invalid_credentials' })}
      />,
    );

    expect(document.body.textContent).not.toMatch(/SENHA|senha:/);
  });
});
