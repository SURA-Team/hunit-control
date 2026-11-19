/**
 * Caixa de seleção sem rótulo visível, das listas e da barra de lote (specs/006, FR-018; "Caixa de
 * seleção" do design, node `76:71`): desmarcada (branca com borda), marcada (preta com o check lima)
 * e parcial (preta com o traço lima, `aria-checked="mixed"`). O nome acessível vem de `aria-label`.
 */
import { Checkbox, type CheckboxProps } from '@mantine/core';
import { CheckIcon, MinusIcon } from '../icons';
import { choiceClassNames, fieldClasses } from './shared';

export type SelectionBoxProps = Omit<
  CheckboxProps,
  | 'classNames'
  | 'styles'
  | 'className'
  | 'style'
  | 'variant'
  | 'size'
  | 'radius'
  | 'vars'
  | 'icon'
  | 'color'
  | 'iconColor'
  | 'label'
> & { 'aria-label': string };

/** Ícone do Mantine: o check ou, na parcial, o traço — os dois do design, em lima. */
function SelectionIcon({
  indeterminate,
  className,
}: {
  indeterminate: boolean | undefined;
  className: string;
}) {
  return indeterminate ? <MinusIcon className={className} /> : <CheckIcon className={className} />;
}

export const selectionVars = () => ({
  root: { '--checkbox-size': '20px', '--checkbox-radius': '6px' },
});

export function SelectionBox({ indeterminate, ...props }: SelectionBoxProps) {
  return (
    <Checkbox
      classNames={{
        ...choiceClassNames,
        input: fieldClasses.checkboxInput,
        icon: fieldClasses.checkboxIcon,
      }}
      vars={selectionVars}
      icon={SelectionIcon}
      indeterminate={indeterminate}
      aria-checked={indeterminate ? 'mixed' : undefined}
      {...props}
    />
  );
}
