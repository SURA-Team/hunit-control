/** Campo numérico com rótulo acima, ajuda e erro (specs/006; "Campo" do design, node `21:113`). */
import { NumberInput, type NumberInputProps } from '@mantine/core';
import { inputClassNames, sizedClassNames, type FieldSize } from './shared';

export type NumberFieldProps = Omit<
  NumberInputProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
> & { size?: FieldSize };

export function NumberField({ size = 'sm', ...props }: NumberFieldProps) {
  return <NumberInput classNames={sizedClassNames(inputClassNames, size)} {...props} />;
}
