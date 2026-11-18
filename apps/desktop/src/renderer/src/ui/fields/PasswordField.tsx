/** Campo de senha com o ícone "Olho" do design para mostrar e esconder (specs/006; "Campo", `Ícone=Olho`). */
import { PasswordInput, type PasswordInputProps } from '@mantine/core';
import { EyeIcon } from '../icons';
import { fieldClasses, inputClassNames, sizedClassNames, type FieldSize } from './shared';

export type PasswordFieldProps = Omit<
  PasswordInputProps,
  | 'classNames'
  | 'styles'
  | 'className'
  | 'style'
  | 'variant'
  | 'size'
  | 'radius'
  | 'vars'
  | 'visibilityToggleIcon'
> & { size?: FieldSize };

export function PasswordField({ size = 'sm', ...props }: PasswordFieldProps) {
  return (
    <PasswordInput
      classNames={{
        ...sizedClassNames(inputClassNames, size),
        innerInput: fieldClasses.innerInput,
        visibilityToggle: fieldClasses.visibilityToggle,
      }}
      visibilityToggleIcon={() => <EyeIcon />}
      visibilityToggleButtonProps={{ 'aria-label': 'Mostrar ou esconder a senha' }}
      {...props}
    />
  );
}
