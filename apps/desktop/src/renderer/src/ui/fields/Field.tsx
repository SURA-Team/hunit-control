/**
 * Campo de texto com rótulo acima, ajuda e erro (specs/006; "Campo" do design, node `21:113`).
 * Rótulo, ajuda e erro ficam ligados ao campo (leitor de tela e `getByLabelText`).
 */
import { TextInput, type TextInputProps } from '@mantine/core';
import { inputClassNames, sizedClassNames, type FieldSize } from './shared';

export type FieldProps = Omit<
  TextInputProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
> & { size?: FieldSize };

export function Field({ size = 'sm', ...props }: FieldProps) {
  return <TextInput classNames={sizedClassNames(inputClassNames, size)} {...props} />;
}
