/**
 * Barras, legendas, card de valor e linha do ranking (specs/007, T010 e T015; contracts/
 * ui-components.md): segmentos proporcionais e na escala comum, barra vazia, nome acessível, legenda
 * em texto e a linha do ranking como botão.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AmountCard,
  LegendList,
  RankingList,
  RankingRow,
  StackedBar,
  ValuePlaceholder,
} from '../../src/renderer/src/ui';
import { renderUi } from './render';

const widths = (bar: HTMLElement) =>
  [...bar.querySelectorAll<HTMLElement>('[data-tone]')].map((segment) => segment.style.width);

describe('StackedBar', () => {
  it('segmentos proporcionais à soma, com o nome acessível', () => {
    renderUi(
      <StackedBar
        label="Solicitado R$ 25,00 e pendente R$ 75,00"
        segments={[
          { tone: 'requested', value: 25 },
          { tone: 'pending', value: 75 },
        ]}
      />,
    );
    const bar = screen.getByRole('img', { name: 'Solicitado R$ 25,00 e pendente R$ 75,00' });
    expect(widths(bar)).toEqual(['25%', '75%']);
  });

  it('escala comum: a barra menor não ocupa a largura toda', () => {
    renderUi(<StackedBar label="hotel" max={200} segments={[{ tone: 'pending', value: 50 }]} />);
    expect(widths(screen.getByRole('img', { name: 'hotel' }))).toEqual(['25%']);
  });

  it('sem valor: só o fundo', () => {
    renderUi(
      <StackedBar
        label="vazia"
        segments={[
          { tone: 'requested', value: 0 },
          { tone: 'pending', value: 0 },
        ]}
      />,
    );
    expect(widths(screen.getByRole('img', { name: 'vazia' }))).toEqual([]);
  });
});

describe('LegendList', () => {
  it('cada linha em texto: nome, valor e percentual', () => {
    renderUi(
      <LegendList
        label="Distribuição"
        items={[
          { tone: 'previous', name: 'Cobrado anteriormente', value: 'R$ 10,00', percent: '96,6%' },
          { tone: 'recovered', name: 'Recuperado', value: 'R$ 1,00', percent: '<0,1%' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Cobrado anteriormenteR$ 10,0096,6%');
    expect(items[1]).toHaveTextContent('<0,1%');
  });
});

describe('AmountCard e ValuePlaceholder', () => {
  it('o card é uma região com o rótulo; o carregando é anunciado', () => {
    renderUi(<AmountCard label="Valor em aberto" amount={<ValuePlaceholder />} dark />);
    const card = screen.getByRole('region', { name: 'Valor em aberto' });
    expect(card).toHaveTextContent('Carregando');
  });
});

describe('RankingRow', () => {
  it('a linha é um botão com o nome do hotel, a posição com dois dígitos e o valor', async () => {
    const onOpen = vi.fn();
    renderUi(
      <RankingList label="Ranking">
        <RankingRow
          position={3}
          name="Hotel Praia Azul"
          bar={null}
          value="R$ 10,00"
          onOpen={onOpen}
        />
      </RankingList>,
    );
    const row = screen.getByRole('button', { name: 'Abrir o detalhe de Hotel Praia Azul' });
    expect(row).toHaveTextContent('03Hotel Praia AzulR$ 10,00');
    await userEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('desabilitada não abre', async () => {
    const onOpen = vi.fn();
    renderUi(
      <RankingList label="Ranking">
        <RankingRow position={1} name="Hotel" bar={null} value="R$ 1,00" onOpen={onOpen} disabled />
      </RankingList>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abrir o detalhe de Hotel' }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
