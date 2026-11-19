/**
 * Chave liga/desliga com rótulo (specs/006; "Switch" do design, node `21:198`): ligada em preto com o
 * botão lima. O design só desenha ligada; desligada, o trilho fica na cor da borda do campo.
 */
import { Switch, type SwitchProps } from '@mantine/core';
import { choiceClassNames, fieldClasses } from './shared';

export type SwitchFieldProps = Omit<
  SwitchProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars' | 'color'
>;

export function SwitchField(props: SwitchFieldProps) {
  return (
    <Switch
      classNames={{
        ...choiceClassNames,
        input: fieldClasses.switchInput,
        track: fieldClasses.track,
        thumb: fieldClasses.thumb,
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
