/** Situação com nome e cor consistentes em todo o app (specs/002, FR-023, data-model §6). */
import { Badge } from '@mantine/core';
import { TONE_COLORS, type Label } from '../presentation/labels';

export function StatusBadge({ label, size = 'sm' }: { label: Label; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <Badge color={TONE_COLORS[label.tone]} variant="light" size={size} radius="sm">
      {label.name}
    </Badge>
  );
}
