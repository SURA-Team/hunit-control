/**
 * Campo de texto longo (specs/006, T051; "Campo" do design, tela 7.6): rótulo acima, o contador de
 * caracteres alinhado à direita na linha do rótulo ("15/500") e o erro abaixo. O contador fica fora
 * do rótulo, para o nome do campo continuar só o rótulo.
 */
import { Textarea, type TextareaProps } from '@mantine/core';
import { fieldClasses, inputClassNames } from './shared';

export type TextAreaFieldProps = Omit<
  TextareaProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
> & {
  /** "15/500", à direita da linha do rótulo. */
  counter?: string;
};

export function TextAreaField({ counter, ...props }: TextAreaFieldProps) {
  return (
    <div className={fieldClasses.textAreaFrame}>
      <Textarea
        classNames={{
          ...inputClassNames,
          input: `${inputClassNames.input} ${fieldClasses.textArea}`,
        }}
        {...props}
      />
      {counter && <span className={fieldClasses.counter}>{counter}</span>}
    </div>
  );
}
