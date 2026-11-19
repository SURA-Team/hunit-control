/**
 * Apoio dos testes da tela Reservas no visual novo (specs/006, T036): a reserva fictícia, a busca
 * única (vale 400 ms depois da última tecla), a linha pelo número e os menus da barra de seleção.
 */
import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import type {
  Reservation,
  ReservationListInput,
  ReservationQuickFilterCounts,
} from '../../src/shared/ipc-types';
import { mocked, okResult, type FakeHunit } from './render';
import { NO_TREATMENT } from './treatment-fixtures';

export type User = ReturnType<typeof userEvent.setup>;

export function reservation(number: string, overrides: Partial<Reservation> = {}): Reservation {
  return {
    hotelCode: '31',
    reservationNumber: number,
    guestName: 'João Silva',
    channel: 'Booking.com',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    totalAmount: '1234.50',
    reservationStatus: 'active',
    classification: 'virtual_card_pending_charge',
    reason: 'pré-pagamento sem cobrança',
    firstVerifiedAt: '2026-11-12T12:00:00.000Z',
    lastVerifiedAt: '2026-11-12T12:00:00.000Z',
    verificationCount: 1,
    treatment: NO_TREATMENT,
    ...overrides,
  };
}

export const COUNTS: ReservationQuickFilterCounts = {
  all: 12,
  pendingCharge: 5,
  toReview: 0,
  withError: 3,
  done: 4,
};

/** Hotéis, canais, uma página com a 7001 e as contagens de exemplo. */
export function serveReservations(hunit: FakeHunit, items: Reservation[] = [reservation('7001')]) {
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([
      { code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '' },
      { code: '32', name: 'Pousada Serra', available: true, lastSeenAt: '' },
    ]),
  );
  mocked(hunit.api.reservations.channels).mockImplementation(() =>
    okResult(['Booking.com', 'Expedia']),
  );
  mocked(hunit.api.reservations.list).mockImplementation(() =>
    okResult({ items, nextCursor: null }),
  );
  mocked(hunit.api.reservations.quickFilterCounts).mockImplementation(() => okResult(COUNTS));
}

export function lastListQuery(hunit: FakeHunit): ReservationListInput {
  return mocked(hunit.api.reservations.list).mock.calls.at(-1)?.[0] ?? {};
}

/** A linha da reserva `number` (o número aparece na segunda linha do hóspede). */
export function findRow(number: string): Promise<HTMLElement> {
  return screen.findByRole('row', { name: new RegExp(`\\b${number}\\b`) });
}

export function searchField(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Buscar reservas' });
}

/** Digita na busca única (apaga o que havia); a tela aplica 400 ms depois. */
export async function typeSearch(user: User, text: string): Promise<void> {
  const field = searchField();
  await user.clear(field);
  if (text) await user.type(field, text);
}

/** O chip de filtro rápido (o nome acessível inclui a contagem). */
export function quickFilterChip(label: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Filtros rápidos' })).getByRole('button', {
    name: new RegExp(`^${label}`),
  });
}

/** Abre um menu da barra de seleção ("Anexar", "Confirmar") e escolhe o item. */
export async function chooseFromMenu(user: User, menu: string, item: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: menu }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

/** Abre o painel "Filtros avançados" e devolve a região dele. */
export async function openFiltersPanel(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Filtros' }));
  return screen.findByRole('region', { name: 'Filtros avançados' });
}
