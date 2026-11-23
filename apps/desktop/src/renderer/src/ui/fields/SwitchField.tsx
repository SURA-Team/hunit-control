/**
 * Chave liga/desliga com rótulo (specs/006; "Switch" do design, node `21:198`). Variantes do design
 * (specs/008, US5): "Ligado" com o trilho preto e o botão lima; "Desligado" com o trilho na cor da
 * borda do campo e o botão branco. Foco pelo teclado com o contorno escuro, como os botões.
 */
import { Switch, type SwitchProps } from '@mantine/core';
import { choiceClassNames, fieldClasses } from './shared';

export type SwitchFieldProps = Omit<
  SwitchProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars' | 'color'
> & {
  /** A descrição ao lado do rótulo, na mesma linha ("Tocar som do aviso", telas 1.1 a 1.3). */
  inlineDescription?: boolean;
};

export function SwitchField({ inlineDescription = false, ...props }: SwitchFieldProps) {
  return (
    <Switch
      classNames={{
        ...choiceClassNames,
        input: fieldClasses.switchInput,
        track: fieldClasses.track,
        thumb: fieldClasses.thumb,
        ...(inlineDescription && { labelWrapper: fieldClasses.inlineDescription }),
      }}
      vars={() => ({
        root: {
          '--switch-width': '40px',
          '--switch-height': '22px',
          '--switch-thumb-size': '16px',
          '--switch-radius': '11px',
          '--switch-track-label-padding': '3px',
          '--label-offset-start': '12px',
        },
      })}
      {...props}
    />
  );
}
