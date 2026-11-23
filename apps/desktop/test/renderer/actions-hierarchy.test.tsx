/**
 * Uma ação principal por bloco nas telas já migradas (specs/006, T040, FR-007, research R-06). Cada
 * tela no estado com mais ações à vista; a lista `SCREENS` cresce com as histórias que migram telas.
 * A outra metade da T040 (a varredura das variantes no código) está em `test/main/actions-audit.test.ts`.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialScreen } from '../../src/renderer/src/screens/commercial/CommercialScreen';
import { ExecutionsScreen } from '../../src/renderer/src/screens/executions/ExecutionsScreen';
import { ExecutionResult } from '../../src/renderer/src/screens/run/ExecutionResult';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import { RunScreen } from '../../src/renderer/src/screens/run/RunScreen';
import { SetupScreen } from '../../src/renderer/src/screens/setup/SetupScreen';
import { returnBrief, sheetStatus } from './commercial-fixtures';
import { expectOnePrimaryPerBlock } from './hierarchy';
import { fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';
import { findRow, serveReservations } from './reservations-helpers';
import {
  detail,
  document as treatmentDocument,
  pendingReservation,
  treatment,
} from './treatment-fixtures';

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
});

interface ScreenCase {
  /** Renderiza a tela no estado com mais ações principais à vista. */
  open: () => Promise<void>;
}

/**
 * Telas já migradas (a lista cresce com as histórias). Cada uma no estado com mais ações à vista:
 * Reservas com a barra de seleção; a tratativa com o alerta "Verificar" e o campo do valor.
 */
const SCREENS: Record<string, ScreenCase> = {
  'Configuração (telas 1.1 a 1.3)': {
    open: async () => {
      renderWithApp(<SetupScreen />, hunit);
      await screen.findByRole('button', { name: /testar conexão/i });
    },
  },
  'Executar (telas 2.1 a 2.3)': {
    open: async () => {
      renderWithApp(<RunScreen onOpenExecution={vi.fn()} />, hunit);
      await screen.findByRole('button', { name: /iniciar execução/i });
    },
  },
  'Reservas com seleção (telas 4.1 e 4.4)': {
    open: async () => {
      serveReservations(hunit);
      renderWithApp(<ReservationsScreen />, hunit);
      await findRow('7001');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('checkbox', { name: 'Selecionar a reserva 7001' }));
      await screen.findByTestId('selection-bar');
    },
  },
  'Tratativa com "Verificar" e valor (telas 4.7 e 4.9)': {
    open: async () => {
      const proof = treatmentDocument();
      const current = treatment({
        status: 'charged',
        situation: 'virtual_card_already_charged',
        needsReview: true,
        proof,
      });
      mocked(hunit.api.treatments.get).mockImplementation(() =>
        okResult(detail({ treatment: current, documents: [proof] })),
      );
      renderWithApp(
        <ReservationDetail
          reservation={pendingReservation('7001', {
            classification: 'virtual_card_already_charged',
            treatment: current,
          })}
        />,
        hunit,
      );
      await waitFor(() => expect(hunit.api.connection.getState).toHaveBeenCalled());
      await act(() => Promise.resolve());
      await screen.findByRole('button', { name: 'Informar valor' });
    },
  },
  'Comercial — Retornos a validar (tela 7.8)': {
    open: async () => {
      mocked(hunit.api.commercial.sheetStatus).mockImplementation(() => okResult(sheetStatus()));
      mocked(hunit.api.reservations.list).mockImplementation(() =>
        okResult({
          items: ['7001', '7002'].map((number) =>
            pendingReservation(number, {
              treatment: treatment({ status: 'sent', detailedSituation: 'return_pending' }),
              commercial: {
                lineState: 'open',
                inSheet: true,
                lastSentAt: '2026-11-14T12:00:00.000Z',
                lastDispatchId: '44444444-4444-4444-8444-444444444444',
                returnState: 'awaiting_validation',
                currentReturn: returnBrief(),
                returnProblem: null,
                syncPending: false,
                report: null,
              },
            }),
          ),
          nextCursor: null,
        }),
      );
      renderWithApp(<CommercialScreen />, hunit);
      const user = userEvent.setup();
      await user.click(screen.getByRole('tab', { name: /^Retornos a validar/ }));
      await screen.findAllByRole('button', { name: 'Confirmar' });
    },
  },
  'Comercial — Planilha (tela 7.10)': {
    open: async () => {
      mocked(hunit.api.commercial.sheetStatus).mockImplementation(() => okResult(sheetStatus()));
      renderWithApp(<CommercialScreen />, hunit);
      const user = userEvent.setup();
      await user.click(screen.getByRole('tab', { name: 'Planilha' }));
      await screen.findByRole('button', { name: 'Ler retornos agora' });
    },
  },
  'Execuções com a gaveta de uma encerrada (telas 3.1 e 3.4)': {
    open: async () => {
      const base = {
        requestedClient: 'desktop-financeiro',
        period: { from: '2026-11-01', to: '2026-11-07' },
        createdAt: '2026-11-12T12:00:00.000Z',
        endReason: 'server_restarted' as const,
        finishedAt: '2026-11-12T12:20:00.000Z',
      };
      const running = {
        ...base,
        id: '11111111-1111-4111-8111-111111111111',
        status: 'running' as const,
        endReason: null,
        finishedAt: null,
      };
      const failed = {
        ...base,
        id: '22222222-2222-4222-8222-222222222222',
        status: 'failed' as const,
      };
      mocked(hunit.api.executions.list).mockImplementation(() =>
        okResult({ items: [running, failed], nextCursor: null }),
      );
      mocked(hunit.api.executions.get).mockImplementation((id: string) =>
        okResult({
          ...(id === running.id ? running : failed),
          hotels: [],
          counts: {},
          recentEvents: [],
          warnings: [],
        }),
      );
      renderWithApp(<ExecutionsScreen onOpenReservations={vi.fn()} />, hunit);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Abrir a execução de/ }));
      await screen.findByRole('button', { name: 'Retomar' });
    },
  },
  'Executar — falhou, com "Iniciar de novo" (tela 2.10)': {
    open: async () => {
      renderWithApp(
        <ExecutionResult
          execution={{
            id: '33333333-3333-4333-8333-333333333333',
            requestedClient: 'desktop-financeiro',
            status: 'failed',
            endReason: 'invalid_token',
            period: { from: '2026-11-01', to: '2026-11-07' },
            createdAt: '2026-11-12T12:00:00.000Z',
            finishedAt: '2026-11-12T12:01:00.000Z',
            hotels: [],
            counts: {},
            recentEvents: [],
            warnings: [],
          }}
          onRestart={vi.fn()}
        />,
        hunit,
      );
      await screen.findByRole('button', { name: 'Iniciar de novo' });
    },
  },
};

describe('uma ação principal por bloco nas telas migradas (FR-007)', () => {
  it.each(Object.entries(SCREENS))('%s', async (_, { open }) => {
    await open();
    expect(document.querySelectorAll('[data-variant="primary"]').length).toBeGreaterThan(0);
    expectOnePrimaryPerBlock();
  });
});
