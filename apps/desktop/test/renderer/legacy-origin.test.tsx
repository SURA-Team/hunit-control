/**
 * Origem "Sistema anterior" no app (specs/004, FR-011, FR-024; data-model §6) — tasks.md, T031:
 * selo na lista e no detalhe, filtro "Origem", seção "Sistema anterior" e autor no histórico.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import type {
  Reservation,
  ReservationListInput,
  TreatmentDetail,
} from '../../src/shared/ipc-types';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { NO_TREATMENT } from './treatment-fixtures';

const LEGACY = {
  importedAt: '2026-11-16T15:00:00.000Z',
  originalClassification: 'not_virtual_card',
  originalPreviousClassification: null,
  firstVerifiedAt: '2026-05-01T13:00:00.000Z',
  lastVerifiedAt: '2026-05-08T13:00:00.000Z',
  verificationCount: 3,
  merged: false,
};

function reservation(number: string, overrides: Partial<Reservation> = {}): Reservation {
  return {
    hotelCode: '31',
    reservationNumber: number,
    guestName: 'Hóspede Fictício',
    channel: 'Canal Fictício',
    checkIn: '2026-05-10',
    checkOut: '2026-05-12',
    totalAmount: '1234.56',
    reservationStatus: 'unknown',
    classification: 'not_virtual_card',
    reason: 'Sistema anterior: classificação sem correspondência',
    firstVerifiedAt: LEGACY.firstVerifiedAt,
    lastVerifiedAt: LEGACY.lastVerifiedAt,
    verificationCount: 3,
    treatment: {
      ...NO_TREATMENT,
      situation: 'not_virtual_card',
      detailedSituation: 'not_virtual_card',
    },
    legacy: LEGACY,
    ...overrides,
  };
}

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit(ONLINE_READER);
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([{ code: '31', name: 'Hotel Fictício', available: true, lastSeenAt: '' }]),
  );
  mocked(hunit.api.reservations.channels).mockImplementation(() => okResult([]));
  mocked(hunit.api.reservations.list).mockImplementation(() =>
    okResult({
      items: [
        reservation('900001'),
        reservation('7001', {
          legacy: null,
          classification: 'virtual_card_pending_charge',
          reservationStatus: 'active',
          lastExecutionId: '11111111-1111-4111-8111-111111111111',
          treatment: NO_TREATMENT,
        }),
      ],
      nextCursor: null,
    }),
  );
});

function lastQuery(): ReservationListInput {
  return mocked(hunit.api.reservations.list).mock.calls.at(-1)?.[0] ?? {};
}

describe('lista', () => {
  it('selo "Sistema anterior" só nas importadas, com "A revisar (sistema anterior)"', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const rows = await screen.findAllByRole('row');
    const imported = rows.find((row) => row.textContent?.includes('900001'));
    const other = rows.find((row) => row.textContent?.includes('7001'));
    // O selo fica ao lado do nome (specs/006, tela 4.10).
    expect(within(imported!).getByText('Sistema anterior', { exact: true })).toBeInTheDocument();
    expect(imported).toHaveTextContent('A revisar (sistema anterior)');
    expect(within(other!).queryByText('Sistema anterior', { exact: true })).toBeNull();
  });

  it('filtro "Origem": Todas, Sistema anterior e HUNIT Control viram fromLegacy', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    await screen.findAllByRole('row');
    expect(lastQuery().fromLegacy).toBeUndefined();

    // O Select do Mantine liga o rótulo ao campo e à lista de opções: o campo é o <input>.
    const origin = screen
      .getAllByLabelText('Origem')
      .find((element) => element.tagName === 'INPUT')!;
    await userEvent.click(origin);
    await userEvent.click(await screen.findByRole('option', { name: 'Sistema anterior' }));
    // Vale na hora, sem "Buscar" (specs/006, research R-11).
    await waitFor(() => expect(lastQuery().fromLegacy).toBe(true));

    await userEvent.click(origin);
    await userEvent.click(await screen.findByRole('option', { name: 'HUNIT Control' }));
    await waitFor(() => expect(lastQuery().fromLegacy).toBe(false));
  });
});

describe('detalhe', () => {
  beforeEach(() => {
    mocked(hunit.api.treatments.get).mockImplementation(() =>
      okResult<TreatmentDetail>({
        treatment: NO_TREATMENT,
        documents: [],
        events: [
          {
            id: 1,
            type: 'attached',
            kind: 'request',
            documentId: null,
            previousDocumentId: null,
            amount: null,
            classification: null,
            batchId: null,
            client: 'sistema-anterior',
            at: '2026-05-02T12:30:00.000Z',
            fromLegacy: true,
          },
        ],
      }),
    );
  });

  it('seção "Sistema anterior" com a classificação original e "ainda não verificada"', () => {
    renderWithApp(<ReservationDetail reservation={reservation('900001')} />, hunit);
    const section = screen.getByTestId('legacy-origin');
    expect(section).toHaveTextContent('Sem cartão virtual');
    expect(section).toHaveTextContent('Verificações no sistema anterior');
    expect(screen.getAllByTestId('legacy-badge').length).toBeGreaterThan(0);
    expect(screen.getByText(/Ainda não verificada pelo HUNIT Control/)).toBeInTheDocument();
  });

  it('código desconhecido aparece como veio; já conhecida pelo HUNIT Control explica a soma', () => {
    renderWithApp(
      <ReservationDetail
        reservation={reservation('900002', {
          lastExecutionId: '11111111-1111-4111-8111-111111111111',
          legacy: { ...LEGACY, originalClassification: 'codigo_estranho', merged: true },
        })}
      />,
      hunit,
    );
    expect(screen.getByTestId('legacy-origin')).toHaveTextContent('codigo_estranho');
    expect(screen.getByText(/já conhecia esta reserva/)).toBeInTheDocument();
    expect(screen.queryByText(/Ainda não verificada/)).toBeNull();
  });

  it('do HUNIT Control: sem seção nem selo', () => {
    renderWithApp(
      <ReservationDetail
        reservation={reservation('7001', {
          legacy: null,
          lastExecutionId: '11111111-1111-4111-8111-111111111111',
        })}
      />,
      hunit,
    );
    expect(screen.queryByTestId('legacy-origin')).toBeNull();
    expect(screen.queryByTestId('legacy-badge')).toBeNull();
  });

  it('histórico: autor "Sistema anterior" nos registros importados', async () => {
    renderWithApp(<ReservationDetail reservation={reservation('900001')} />, hunit);
    expect(await screen.findByText(/— Sistema anterior/)).toBeInTheDocument();
    expect(screen.queryByText(/sistema-anterior/)).toBeNull();
  });
});
