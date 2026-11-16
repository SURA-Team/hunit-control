/**
 * Selo "Sistema anterior" (specs/004, FR-011, FR-024): a reserva veio da importação do histórico,
 * mesmo que o HUNIT Control a tenha verificado depois.
 */
import { Badge } from '@mantine/core';
import { LEGACY_ORIGIN_NAME } from '../presentation/labels';

export function LegacyBadge({ size = 'xs' }: { size?: 'xs' | 'sm' | 'md' }) {
  return (
    <Badge
      size={size}
      variant="outline"
      color="gray"
      radius="sm"
      title="Reserva importada do sistema anterior"
      data-testid="legacy-badge"
    >
      {LEGACY_ORIGIN_NAME}
    </Badge>
  );
}
