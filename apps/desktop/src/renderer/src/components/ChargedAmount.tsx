/**
 * Valor cobrado com a origem (specs/005, FR-024): o do Hunit, se houver; senão o informado à mão;
 * senão o do retorno do Comercial confirmado. Qual vale e de onde vem chegam prontos do servidor.
 */
import { Text } from '@mantine/core';
import type { ReservationTreatment } from '../../../shared/ipc-types';
import { formatMoney } from '../presentation/format';
import { CHARGED_AMOUNT_ORIGIN_NAMES } from '../presentation/labels';

export function ChargedAmount({
  treatment,
}: {
  treatment: Pick<ReservationTreatment, 'effectiveChargedAmount' | 'chargedAmountOrigin'>;
}) {
  const { effectiveChargedAmount: amount, chargedAmountOrigin: origin } = treatment;
  if (!amount) return <>—</>;
  return (
    <>
      {formatMoney(amount)}
      {origin && (
        <Text span size="xs" c="dimmed">
          {' '}
          ({CHARGED_AMOUNT_ORIGIN_NAMES[origin]})
        </Text>
      )}
    </>
  );
}
