/**
 * Busca única da tela Reservas (specs/006, T036, research R-10): dinheiro brasileiro com centavos
 * ou "R$" vai como valor (`amount`), o resto como texto (`q`, pelo menos 2 caracteres), e a busca vale
 * 400 ms depois da última tecla, sem botão "Buscar".
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseSearch } from '../../src/renderer/src/presentation/reservations';
import {
  ReservationsScreen,
  SEARCH_DELAY_MS,
} from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import { fakeHunit, mocked, renderWithApp, type FakeHunit } from './render';
import { findRow, lastListQuery, serveReservations, typeSearch } from './reservations-helpers';

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
  serveReservations(hunit);
});

describe('parseSearch: texto ou valor (R-10)', () => {
  it.each([
    ['380,00', { amount: '380.00' }],
    ['1.234,56', { amount: '1234.56' }],
    ['R$ 380', { amount: '380.00' }],
    ['r$1.234,5', { amount: '1234.50' }],
    ['101-1000', { q: '101-1000' }],
    ['1000', { q: '1000' }],
    ['  aut-0042  ', { q: 'aut-0042' }],
    ['Ana Ribeiro', { q: 'Ana Ribeiro' }],
    ['', {}],
    ['   ', {}],
  ])('"%s" → %o', (text, expected) => {
    expect(parseSearch(text)).toEqual(expected);
  });

  it.each([
    ['a', 'Digite ao menos 2 caracteres na busca.'],
    ['R$ doze', 'Valor inválido. Use, por exemplo, 1.234,56.'],
  ])('"%s" → erro', (text, error) => {
    expect(parseSearch(text)).toEqual({ error });
  });
});

describe('na tela', () => {
  it('vale sozinha depois da última tecla (400 ms), sem "Buscar"', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();
    expect(SEARCH_DELAY_MS).toBe(400);

    const before = mocked(hunit.api.reservations.list).mock.calls.length;
    await typeSearch(user, '101-1000');
    // Logo depois de digitar, a busca ainda não foi.
    expect(mocked(hunit.api.reservations.list).mock.calls.length).toBe(before);

    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ q: '101-1000' }));
    expect(lastListQuery(hunit)).not.toHaveProperty('amount');
    // Uma pesquisa só para a palavra inteira, não uma por tecla.
    expect(
      mocked(hunit.api.reservations.list).mock.calls.filter((call) => call[0].q !== undefined),
    ).toHaveLength(1);
  });

  it('valor com centavos vai como amount, e as contagens acompanham', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');

    await typeSearch(user, '380,00');

    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ amount: '380.00' }));
    expect(lastListQuery(hunit)).not.toHaveProperty('q');
    await waitFor(() =>
      expect(mocked(hunit.api.reservations.quickFilterCounts).mock.calls.at(-1)?.[0]).toEqual({
        amount: '380.00',
      }),
    );
  });

  it('1 caractere mostra o erro e a lista fica com a última busca válida', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    await typeSearch(user, 'joao');
    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ q: 'joao' }));

    await typeSearch(user, 'j');

    expect(await screen.findByText('Digite ao menos 2 caracteres na busca.')).toBeInTheDocument();
    expect(lastListQuery(hunit)).toMatchObject({ q: 'joao' });
  });

  it('apagar a busca volta a lista inteira', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    await typeSearch(user, 'joao');
    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ q: 'joao' }));

    await typeSearch(user, '');

    await waitFor(() => expect(lastListQuery(hunit)).not.toHaveProperty('q'));
  });
});
