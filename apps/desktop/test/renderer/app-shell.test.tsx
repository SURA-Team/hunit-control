/**
 * Estrutura do app (specs/006, T016, FR-002, US1-1, US1-2): cabeçalho com a marca, o cliente e o
 * perfil; menu lateral com uma área por perfil e a área ativa marcada (`aria-current`); sem conexão
 * confirmada, só a Configuração.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/src/App';
import { fakeHunit, ONLINE_OPERATOR, ONLINE_READER, renderWithApp } from './render';

async function menuItems() {
  const nav = await screen.findByRole('navigation', { name: 'Áreas do app' });
  return {
    nav,
    names: () =>
      within(nav)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
  };
}

describe('estrutura do app', () => {
  it('operador: as cinco áreas, Executar ativa e o perfil no cabeçalho', async () => {
    renderWithApp(<App />, fakeHunit(ONLINE_OPERATOR));
    const banner = screen.getByRole('banner');
    expect(banner).toHaveTextContent('HUNIT Control');
    expect(await within(banner).findByText('Operador')).toHaveAttribute('data-tone', 'lime');
    expect(banner).toHaveTextContent('desktop-financeiro');

    const { nav, names } = await menuItems();
    await waitFor(() =>
      expect(names()).toEqual(['Executar', 'Execuções', 'Reservas', 'Comercial', 'Configuração']),
    );
    expect(within(nav).getByRole('button', { name: 'Executar' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('a pílula acompanha a área escolhida', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, fakeHunit(ONLINE_OPERATOR));
    const { nav } = await menuItems();
    await user.click(await within(nav).findByRole('button', { name: 'Reservas' }));

    expect(within(nav).getByRole('button', { name: 'Reservas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('button', { name: 'Executar' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('consulta: sem "Executar", com o perfil Consulta', async () => {
    renderWithApp(<App />, fakeHunit(ONLINE_READER));
    expect(await within(screen.getByRole('banner')).findByText('Consulta')).toHaveAttribute(
      'data-tone',
      'gray',
    );
    const { names } = await menuItems();
    await waitFor(() =>
      expect(names()).toEqual(['Execuções', 'Reservas', 'Comercial', 'Configuração']),
    );
  });

  it('sem conexão configurada: só a Configuração, sem o selo do perfil', async () => {
    renderWithApp(
      <App />,
      fakeHunit({ status: 'not_configured', client: null, checkedAt: '2026-11-18T12:00:00.000Z' }),
    );
    const { nav, names } = await menuItems();
    await waitFor(() => expect(names()).toEqual(['Configuração']));
    expect(within(nav).getByRole('button', { name: 'Configuração' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('banner')).not.toHaveTextContent(/Operador|Consulta/);
  });
});
