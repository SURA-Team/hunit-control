/**
 * Botão secundário que abre um menu com ações do mesmo tipo (specs/006; "Botão com menu" do design,
 * node `182:1171`): "Anexar ▾" (tratativa ou comprovante) e "Confirmar ▾" (retornos do Comercial ou o
 * alerta "Verificar"). O menu é o do Mantine: abre com Enter, Espaço ou seta para baixo, navega pelas
 * setas e fecha com Esc. Dentro de uma superfície escura o botão continua branco.
 */
import { Menu } from '@mantine/core';
import { Action, type ActionSize } from './Action';
import { ChevronDownIcon } from './icons';
import classes from './MenuButton.module.css';
import { Surface } from './Surface';

export interface MenuButtonItem {
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface MenuButtonProps {
  label: string;
  items: readonly MenuButtonItem[];
  disabled?: boolean;
  size?: ActionSize;
}

export function MenuButton({ label, items, disabled = false, size = 'md' }: MenuButtonProps) {
  return (
    <Menu
      position="bottom-end"
      offset={6}
      disabled={disabled}
      classNames={{ dropdown: classes.dropdown, item: classes.item }}
    >
      <Menu.Target>
        <Action
          variant="secondary"
          size={size}
          disabled={disabled}
          rightSection={<ChevronDownIcon size={16} />}
          data-menu=""
        >
          {label}
        </Action>
      </Menu.Target>
      <Menu.Dropdown>
        <Surface>
          {items.map((item) => (
            <Menu.Item key={item.label} onClick={item.onClick} disabled={item.disabled}>
              {item.label}
              {item.description && <span className={classes.description}>{item.description}</span>}
            </Menu.Item>
          ))}
        </Surface>
      </Menu.Dropdown>
    </Menu>
  );
}
