/**
 * Filtros rápidos com contagem (specs/006, T036; FR-016, FR-017, research R-09): Todas · Falta
 * cobrar · A verificar · Com erro · Concluídas, com as contagens do servidor para a busca e os filtros
 * em vigor; o escolhido vira `quickFilter` da lista, de "Selecionar todas do filtro" e da cópia.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import { errorResult, fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';
import {
  COUNTS,
  findRow,
  lastListQuery,
  quickFilterChip,
  serveReservations,
  typeSearch,
} from './reservations-helpers';

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
  serveReservations(hunit);
});

describe('filtros rápidos (FR-016, FR-017)', () => {
  it('na ordem do design, com as contagens; "Todas" começa escolhido', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    await findRow('7001');

    const group = screen.getByRole('group', { name: 'Filtros rápidos' });
    await waitFor(() => expect(quickFilterChip('Todas')).toHaveTextContent('12'));
    const chips = within(group)
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'));
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Todas12',
      'Falta cobrar5',
      'A verificar0',
      'Com erro3',
      'Concluídas4',
    ]);
    expect(quickFilterChip('Todas')).toHaveAttribute('aria-pressed', 'true');
  });

  it('o chip escolhido vira quickFilter da lista; as contagens não mudam com ele', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');

    await user.click(quickFilterChip('A verificar'));

    await waitFor(() =>
      expect(lastListQuery(hunit)).toMatchObject({
        quickFilter: 'to_review',
        order: 'hotel_check_in',
      }),
    );
    // A tela não monta a regra: nada de pendingCharge, needsReview ou situações.
    for (const key of ['pendingCharge', 'needsReview', 'detailedSituation', 'classification']) {
      expect(lastListQuery(hunit)).not.toHaveProperty(key);
    }
    expect(quickFilterChip('A verificar')).toHaveAttribute('aria-pressed', 'true');
    for (const call of mocked(hunit.api.reservations.quickFilterCounts).mock.calls) {
      expect(call[0]).not.toHaveProperty('quickFilter');
      expect(call[0]).not.toHaveProperty('order');
    }
    // Rodapé com o total do grupo escolhido.
    expect(
      await screen.findByText('Mostrando 1 de 0 reservas · ordenadas por hotel e check-in'),
    ).toBeInTheDocument();

    await user.click(quickFilterChip('A verificar'));
    await waitFor(() => expect(lastListQuery(hunit)).not.toHaveProperty('quickFilter'));
    expect(quickFilterChip('Todas')).toHaveAttribute('aria-pressed', 'true');
  });

  it('as contagens seguem a busca e os filtros em vigor', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');

    await typeSearch(user, 'Ana');

    await waitFor(() =>
      expect(mocked(hunit.api.reservations.quickFilterCounts).mock.calls.at(-1)?.[0]).toEqual({
        q: 'Ana',
      }),
    );
  });

  it('contagem grande aparece abreviada, com o número inteiro na dica', async () => {
    mocked(hunit.api.reservations.quickFilterCounts).mockImplementation(() =>
      okResult({ ...COUNTS, all: 12_345 }),
    );
    renderWithApp(<ReservationsScreen />, hunit);
    await findRow('7001');

    const count = await within(quickFilterChip('Todas')).findByTitle('12.345');
    expect(count.textContent?.replace(/\u00a0/g, ' ')).toBe('12,3 mil');
  });

  it('falha nas contagens não esconde a lista: os chips ficam sem número', async () => {
    mocked(hunit.api.reservations.quickFilterCounts).mockImplementation(() =>
      errorResult('internal_error'),
    );
    renderWithApp(<ReservationsScreen />, hunit);

    expect(await findRow('7001')).toBeInTheDocument();
    await waitFor(() => expect(hunit.api.reservations.quickFilterCounts).toHaveBeenCalled());
    expect(quickFilterChip('Todas').textContent).toBe('Todas');
    expect(quickFilterChip('Falta cobrar').textContent).toBe('Falta cobrar');
    expect(
      await screen.findByText('Mostrando 1 reserva · ordenadas por hotel e check-in'),
    ).toBeInTheDocument();
  });

  it('"Selecionar todas do filtro" segue o filtro rápido e a ordem da lista', async () => {
    mocked(hunit.api.reservations.selectAll).mockImplementation(() =>
      okResult({ total: 0, truncated: false, items: [] }),
    );
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    await user.click(quickFilterChip('Com erro'));
    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ quickFilter: 'with_error' }));

    await user.click(screen.getByRole('button', { name: 'Selecionar todas do filtro' }));

    await waitFor(() =>
      expect(hunit.api.reservations.selectAll).toHaveBeenCalledWith({
        quickFilter: 'with_error',
        order: 'hotel_check_in',
      }),
    );
  });
});
