/**
 * Navegação de ui/ (specs/006, T013, FR-002, FR-044): cabeçalho com o cliente e o perfil, menu lateral
 * com a área ativa e o nome acessível (também no modo só com ícones) e as abas com contagem.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AppHeader,
  ReservationsIcon,
  RunIcon,
  SideMenu,
  SideMenuItem,
  TabPanel,
  Tabs,
} from '../../src/renderer/src/ui';
import { renderUi } from './render';

describe('AppHeader', () => {
  it('marca, cliente e perfil Operador em lima', () => {
    renderUi(<AppHeader clientName="Recepção — PC 1" profile="operator" />);
    const banner = screen.getByRole('banner');
    expect(banner).toHaveTextContent('HUNIT Control');
    expect(banner).toHaveTextContent('Recepção — PC 1');
    expect(screen.getByText('Operador')).toHaveAttribute('data-tone', 'lime');
  });

  it('perfil Consulta em cinza; sem conexão, só a marca', () => {
    const { rerender } = renderUi(<AppHeader clientName="consulta" profile="reader" />);
    expect(screen.getByText('Consulta')).toHaveAttribute('data-tone', 'gray');
    rerender(<AppHeader />);
    expect(screen.getByRole('banner')).toHaveTextContent('HUNIT Control');
    expect(screen.queryByText('Consulta')).toBeNull();
  });
});

describe('SideMenu', () => {
  it('a área ativa tem aria-current e todas têm nome e dica (menu só com ícones)', async () => {
    const user = userEvent.setup();
    const openReservations = vi.fn();
    renderUi(
      <SideMenu>
        <SideMenuItem label="Executar" icon={<RunIcon />} active onClick={vi.fn()} />
        <SideMenuItem
          label="Reservas"
          icon={<ReservationsIcon />}
          active={false}
          onClick={openReservations}
        />
      </SideMenu>,
    );
    const nav = screen.getByRole('navigation', { name: 'Áreas do app' });
    expect(nav).toBeInTheDocument();
    const run = screen.getByRole('button', { name: 'Executar' });
    const reservations = screen.getByRole('button', { name: 'Reservas' });
    expect(run).toHaveAttribute('aria-current', 'page');
    expect(reservations).not.toHaveAttribute('aria-current');
    expect(reservations).toHaveAttribute('data-tooltip', 'Reservas');

    await user.click(reservations);
    expect(openReservations).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs', () => {
  const items = [
    { value: 'dispatches', label: 'Envios' },
    { value: 'returns', label: 'Retornos a validar', count: 2 },
    { value: 'problems', label: 'Retornos com problema', count: 1 },
  ];

  it('mostra a aba ativa e a contagem; o clique e as setas trocam de aba', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(
      <Tabs value="dispatches" onChange={onChange} items={items} aria-label="Comercial">
        <TabPanel value="dispatches">Lista de envios</TabPanel>
        <TabPanel value="returns">Retornos</TabPanel>
      </Tabs>,
    );
    expect(screen.getByRole('tablist', { name: 'Comercial' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Envios' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Retornos a validar/ })).toHaveTextContent('2');
    expect(screen.getByText('Lista de envios')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: /Retornos com problema/ }));
    expect(onChange).toHaveBeenLastCalledWith('problems');

    screen.getByRole('tab', { name: 'Envios' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('returns');
  });
});
