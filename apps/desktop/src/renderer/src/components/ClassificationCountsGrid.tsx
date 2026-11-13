/** Contagens por situação de cobrança, com os nomes e tons da spec 001 (data-model §6.1). */
import { Paper, SimpleGrid, Text } from '@mantine/core';
import type { ClassificationCounts } from '../../../shared/ipc-types';
import { CLASSIFICATION_LABELS, CLASSIFICATION_ORDER, TONE_COLORS } from '../presentation/labels';

export function ClassificationCountsGrid({ counts }: { counts: ClassificationCounts }) {
  const present = CLASSIFICATION_ORDER.filter(
    (classification) => (counts[classification] ?? 0) > 0,
  );
  if (present.length === 0) return null;
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm">
      {present.map((classification) => {
        const label = CLASSIFICATION_LABELS[classification];
        return (
          <Paper key={classification} withBorder p="xs" radius="sm">
            <Text size="xs" c={`${TONE_COLORS[label.tone]}.8`} fw={600}>
              {label.name}
            </Text>
            <Text fz={22} fw={700} data-testid={`count-${classification}`}>
              {counts[classification]}
            </Text>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}
