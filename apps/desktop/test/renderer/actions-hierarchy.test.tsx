/**
 * Uma ação principal por bloco nas telas já migradas (specs/006, T040, FR-007, research R-06). Cada
 * tela no estado com mais ações à vista; a lista `SCREENS` cresce com as histórias que migram telas.
 * A outra metade da T040 (a varredura das variantes no código) está em `test/main/actions-audit.test.ts`.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import { RunScreen } from '../../src/renderer/src/screens/run/RunScreen';
import { SetupScreen } from '../../src/renderer/src/screens/setup/SetupScreen';
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
};

describe('uma ação principal por bloco nas telas migradas (FR-007)', () => {
  it.each(Object.entries(SCREENS))('%s', async (_, { open }) => {
    await open();
    expect(document.querySelectorAll('[data-variant="primary"]').length).toBeGreaterThan(0);
    expectOnePrimaryPerBlock();
  });
});
