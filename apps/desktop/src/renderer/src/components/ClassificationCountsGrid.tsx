/**
 * Contagens por situação de cobrança, com os nomes e tons da spec 001 (data-model §6.1). Desde a 006
 * (T057; telas 2.7 e 3.4): caixas cinza com o rótulo no tom (âmbar, vermelho, verde ou cinza) e o
 * número grande (`CountCard`), cinco por linha (`CountGrid`).
 */
import type { ClassificationCounts } from '../../../shared/ipc-types';
import { CLASSIFICATION_LABELS, CLASSIFICATION_ORDER, type Tone } from '../presentation/labels';
import { CountCard, CountGrid, type CountCardProps } from '../ui';

const COUNT_TONES: Readonly<Record<Tone, CountCardProps['tone']>> = {
  success: 'green',
  warning: 'amber',
  error: 'red',
  progress: 'gray',
  info: 'gray',
  neutral: 'gray',
};

export function ClassificationCountsGrid({ counts }: { counts: ClassificationCounts }) {
  const present = CLASSIFICATION_ORDER.filter(
    (classification) => (counts[classification] ?? 0) > 0,
  );
  if (present.length === 0) return null;
  return (
    <CountGrid label="Contagens por situação">
      {present.map((classification) => {
        const label = CLASSIFICATION_LABELS[classification];
        return (
          <CountCard
            key={classification}
            tone={COUNT_TONES[label.tone]}
            label={label.name}
            value={counts[classification]}
            data-testid={`count-${classification}`}
          />
        );
      })}
    </CountGrid>
  );
}
