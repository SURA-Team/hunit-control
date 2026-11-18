/**
 * Gaveta de detalhes à direita (specs/006, FR-042, FR-047; telas 3.2, 4.2 e 7.5): até 780 px, sempre
 * com 96 px livres à esquerda, a altura toda da janela, cantos arredondados só à esquerda. Rola por
 * dentro com o título e o fechar fixos no topo. Os cards dentro dela usam `<Card padding={16}>`.
 * Abre por cima do conteúdo, sem mudar a largura da lista (research R-07).
 */
import { Drawer } from '@mantine/core';
import type { ReactNode } from 'react';
import { CloseIcon } from './icons';
import classes from './structure.module.css';
import { Surface } from './Surface';
import { colors, overlay } from './tokens';

export interface AppDrawerProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}

export function AppDrawer({
  opened,
  onClose,
  title,
  children,
  'data-testid': testId,
}: AppDrawerProps) {
  return (
    <Drawer.Root
      opened={opened}
      onClose={onClose}
      position="right"
      // Classes pelo Root: no Mantine 9, `className` no Drawer.Content também vai para o contêiner de
      // tela cheia (`inner`).
      classNames={{
        content: classes.drawerContent,
        header: classes.drawerHeader,
        title: classes.dialogTitle,
        close: classes.close,
        body: classes.drawerBody,
      }}
    >
      <Drawer.Overlay
        color={colors['sobreposição']}
        backgroundOpacity={overlay.opacity}
        blur={overlay.blur}
      />
      <Drawer.Content data-testid={testId}>
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
          <Drawer.CloseButton icon={<CloseIcon />} aria-label="Fechar" />
        </Drawer.Header>
        <Drawer.Body>
          <Surface>{children}</Surface>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
