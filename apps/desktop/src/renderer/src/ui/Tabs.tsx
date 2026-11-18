/**
 * Abas (specs/006, FR-039, FR-044; "Aba" do design, node `182:1232`): trilho cinza com a aba ativa
 * em branco e a contagem numa pílula (lima na ativa). Quebram linha quando não cabem. Teclado do
 * Mantine: setas trocam de aba. Os painéis são `TabPanel` com o mesmo `value`.
 */
import { Tabs as MantineTabs } from '@mantine/core';
import type { ReactNode } from 'react';
import { formatCount, formatInteger } from '../presentation/format';
import classes from './navigation.module.css';

export interface TabItem {
  value: string;
  label: string;
  /** Contagem ao lado do rótulo; sem ela, só o rótulo. */
  count?: number | null;
}

export interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  items: readonly TabItem[];
  children: ReactNode;
  'aria-label'?: string;
}

export function Tabs({ value, onChange, items, children, 'aria-label': ariaLabel }: TabsProps) {
  return (
    <MantineTabs
      value={value}
      onChange={(next) => {
        if (next) onChange(next);
      }}
      variant="rail"
      classNames={{
        list: classes.tabList,
        tab: classes.tab,
        tabSection: classes.tabSection,
        panel: classes.panel,
      }}
    >
      <MantineTabs.List aria-label={ariaLabel}>
        {items.map((item) => (
          <MantineTabs.Tab
            key={item.value}
            value={item.value}
            rightSection={
              item.count === undefined || item.count === null ? undefined : (
                <span className={classes.tabCount} title={formatInteger(item.count)}>
                  {formatCount(item.count)}
                </span>
              )
            }
          >
            {item.label}
          </MantineTabs.Tab>
        ))}
      </MantineTabs.List>
      {children}
    </MantineTabs>
  );
}

export const TabPanel = MantineTabs.Panel;
