/**
 * Campo de texto com rótulo acima, ajuda e erro (specs/006; "Campo" do design, node `21:113`).
 * Rótulo, ajuda e erro ficam ligados ao campo (leitor de tela e `getByLabelText`).
 */
import { TextInput, type TextInputProps } from '@mantine/core';
import { inputClassNames } from './shared';

export type FieldProps = Omit<
  TextInputProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
>;

export function Field(props: FieldProps) {
  return <TextInput classNames={inputClassNames} {...props} />;
}
