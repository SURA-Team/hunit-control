/**
 * Ícones do design (specs/006, T008, research R-04): cada SVG exportado do Figma tem o seu
 * componente, com os mesmos traços; todos ficam ocultos do leitor de tela e herdam a cor do texto.
 */
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import * as icons from '../../src/renderer/src/ui/icons';
import { BrandMark, type IconProps } from '../../src/renderer/src/ui/icons';

const sources = import.meta.glob<string>('../../resources/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** `chevron-right.svg` → `ChevronRightIcon`. */
const componentName = (file: string) =>
  `${file
    .replace(/^.*\/|\.svg$/g, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Icon`;

const components = icons as unknown as Record<string, ComponentType<IconProps> | undefined>;
const cases = Object.entries(sources).map(([file, svg]) => [componentName(file), svg] as const);

const strokesOf = (root: ParentNode) =>
  [...root.querySelectorAll('path')].map((path) => [
    path.getAttribute('d'),
    Number(path.getAttribute('stroke-width')),
  ]);

describe('ícones do design', () => {
  it('cada SVG exportado tem um componente e cada componente tem o seu SVG', () => {
    expect(cases.length).toBeGreaterThan(0);
    const exported = Object.keys(components).filter((name) => name.endsWith('Icon'));
    expect(exported.sort()).toEqual(cases.map(([name]) => name).sort());
  });

  it.each(cases)(
    '%s tem os traços do SVG, herda a cor e fica oculto do leitor de tela',
    (name, svg) => {
      const Icon = components[name];
      if (!Icon) throw new Error(`Falta o componente ${name}`);
      const { container } = render(<Icon />);
      const element = container.querySelector('svg');
      const source = new DOMParser().parseFromString(svg, 'image/svg+xml');

      expect(element).toHaveAttribute('aria-hidden', 'true');
      expect(element).toHaveAttribute('viewBox', source.documentElement.getAttribute('viewBox'));
      expect(strokesOf(container)).toEqual(strokesOf(source));
      for (const path of container.querySelectorAll('path')) {
        expect(path).toHaveAttribute('stroke', 'currentColor');
        expect(path).not.toHaveAttribute('fill');
      }
    },
  );

  it('o tamanho padrão é o do desenho; a prop size muda largura e altura', () => {
    const { container, rerender } = render(<icons.CloseIcon />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '20');
    rerender(<icons.CloseIcon size={16} />);
    expect(container.querySelector('svg')).toHaveAttribute('height', '16');
    rerender(<icons.SearchEmptyIcon />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '48');
  });

  it('a marca do cabeçalho é decorativa e tem o H lima no quadrado preto', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '32');
    expect(container.querySelector('rect')).toHaveAttribute('fill', '#0e0e10');
    expect(container.querySelector('path')).toHaveAttribute('fill', '#d4f25a');
  });
});
