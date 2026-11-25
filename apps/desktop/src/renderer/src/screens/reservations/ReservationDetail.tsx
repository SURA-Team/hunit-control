/**
 * Detalhe da reserva (specs/002, FR-022, US3 cenários 4 e 5): dados da cobrança, o status do Hunit
 * (classificação e motivo), o que mudou desde a verificação anterior e o histórico de verificação.
 * Tudo como o servidor informa; o app só formata. No topo, a situação da reserva (specs/003,
 * FR-002); a tratativa manual fica numa seção própria, e o envio ao Comercial em outra (specs/005,
 * FR-023), com o valor cobrado e a origem ao lado do valor total (FR-024).
 *
 * Desde a 006 (T044; tela 4.2, research R-12): o cabeçalho com "Reserva N", o hotel e os selos
 * (situação, "Verificar", "Sistema anterior", ativa, cancelada ou não identificada); os dados da
 * reserva em três colunas, com "Valor cobrado" (FR-040); a caixa cinza "Status do Hunit" com o selo,
 * o motivo e a "Classificação anterior" quando mudou (FR-025); os cards "Tratativa", "Comercial",
 * "Cobrança" ("Valor cobrado no Hunit") e "Verificações" (FR-028) e, para as importadas, "Sistema
 * anterior". Cada card é um bloco: no máximo uma ação principal em cada (FR-007).
 *
 * Desde a 008 (T031; telas 7.17 e 7.18): o card "Cancelada sem cobrança" depois do "Comercial"; o
 * selo do cabeçalho vem da situação detalhada (`cancelled_no_charge`).
 */
import { Group, Stack, Text } from '@mantine/core';
import type { Reservation } from '../../../../shared/ipc-types';
import { formatDate, formatDateTime, formatMoney } from '../../presentation/format';
import {
  CHARGED_AMOUNT_ORIGIN_NAMES,
  CLASSIFICATION_LABELS,
  RESERVATION_STATUS_LABELS,
  legacyClassificationName,
} from '../../presentation/labels';
import { badgeOf, LEGACY_BADGE, situationBadges } from '../../presentation/reservations';
import {
  Card,
  CardHeader,
  DataField,
  DataGrid,
  DetailHeader,
  StatusBadge,
  type SituationBadgeItem,
} from '../../ui';
import { CommercialSection } from './CommercialSection';
import { NoChargeSection } from './NoChargeSection';
import { TreatmentSection } from './TreatmentSection';

const dash = (value: string | null | undefined) => (value ? value : '—');

export function GuestName({ reservation }: { reservation: Reservation }) {
  if (reservation.anonymized || reservation.guestName === null) {
    return (
      <Text span fs="italic" c="dimmed" size="sm">
        nome anonimizado
      </Text>
    );
  }
  return <>{reservation.guestName}</>;
}

/** Selos do cabeçalho: os da lista e, depois, ativa ou cancelada ("Não identificada" já vem neles). */
function headerBadges(reservation: Reservation): SituationBadgeItem[] {
  return [
    ...(reservation.legacy ? [LEGACY_BADGE] : []),
    ...situationBadges(reservation),
    ...(reservation.reservationStatus === 'unknown'
      ? []
      : [badgeOf(RESERVATION_STATUS_LABELS[reservation.reservationStatus])]),
  ];
}

/** "R$ 380,00 (manual)": o valor que vale e a origem (specs/005, FR-024). */
function ChargedAmount({ reservation }: { reservation: Reservation }) {
  const { effectiveChargedAmount: amount, chargedAmountOrigin: origin } = reservation.treatment;
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

/** "Classificação anterior: [selo]", na caixa "Status do Hunit" (tela 4.9). */
function PreviousLine({ label, badge }: { label: string; badge: SituationBadgeItem }) {
  return (
    <Group gap={8}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
    </Group>
  );
}

export function ReservationDetail({ reservation }: { reservation: Reservation }) {
  const { payment, tracking } = reservation;
  const installments =
    payment?.isInstallment && payment.installmentCount
      ? `${payment.installmentCount} × ${formatMoney(payment.installmentAmount)}`
      : payment?.isInstallment === false
        ? 'À vista'
        : '—';

  return (
    <Stack gap={16} data-testid="reservation-detail">
      <DetailHeader
        title={`Reserva ${reservation.reservationNumber}`}
        subtitle={`hotel ${reservation.hotelCode}`}
        badges={headerBadges(reservation)}
      />

      <DataGrid label="Dados da reserva">
        <DataField label="Hóspede">
          <GuestName reservation={reservation} />
        </DataField>
        <DataField label="Canal">{dash(reservation.channel)}</DataField>
        <DataField label="Forma de pagamento">{dash(reservation.paymentForm)}</DataField>
        <DataField label="Check-in">{formatDate(reservation.checkIn)}</DataField>
        <DataField label="Check-out">{formatDate(reservation.checkOut)}</DataField>
        <DataField label="Valor total">{formatMoney(reservation.totalAmount)}</DataField>
        <DataField label="Valor cobrado">
          <ChargedAmount reservation={reservation} />
        </DataField>
      </DataGrid>

      <Card tone="subtle" padding={12} block="Status do Hunit" data-testid="hunit-status">
        <CardHeader
          title="Status do Hunit"
          aside={
            <StatusBadge tone={badgeOf(CLASSIFICATION_LABELS[reservation.classification]).tone}>
              {CLASSIFICATION_LABELS[reservation.classification].name}
            </StatusBadge>
          }
        />
        <DataField label="Motivo da classificação">{reservation.reason}</DataField>
        {tracking?.previousClassification && (
          <PreviousLine
            label="Classificação anterior:"
            badge={badgeOf(CLASSIFICATION_LABELS[tracking.previousClassification])}
          />
        )}
        {tracking?.previousReservationStatus && (
          <PreviousLine
            label="Situação anterior da reserva:"
            badge={badgeOf(RESERVATION_STATUS_LABELS[tracking.previousReservationStatus])}
          />
        )}
        {tracking?.notFoundSince && (
          <DataField label="Não encontrada na verificação de">
            {formatDateTime(tracking.notFoundSince)}
          </DataField>
        )}
      </Card>

      <TreatmentSection reservation={reservation} />

      <CommercialSection reservation={reservation} />

      {/* Outra reserva na mesma gaveta: o aviso e a observação digitada não passam para ela. */}
      <NoChargeSection
        key={`${reservation.hotelCode}/${reservation.reservationNumber}`}
        reservation={reservation}
      />

      <Card block="Cobrança">
        <CardHeader title="Cobrança" />
        <DataGrid>
          <DataField label="Data">
            {payment?.chargedAt ? formatDateTime(payment.chargedAt) : '—'}
          </DataField>
          <DataField label="Responsável">{dash(payment?.chargedBy)}</DataField>
          <DataField label="Valor cobrado no Hunit">
            {formatMoney(payment?.chargedAmount)}
          </DataField>
          <DataField label="Transação">{dash(payment?.transactionId)}</DataField>
          <DataField label="Autorização">{dash(payment?.authorizationCode)}</DataField>
          <DataField label="Referência da operadora">{dash(payment?.processorReference)}</DataField>
          <DataField label="Parcelamento">{installments}</DataField>
          <DataField label="Estado do pré-pagamento">{dash(payment?.prePaymentState)}</DataField>
          <DataField label="Mensagem do pré-pagamento">
            {dash(payment?.prePaymentMessage)}
          </DataField>
        </DataGrid>
      </Card>

      <Card block="Verificações">
        <CardHeader title="Verificações" />
        <DataGrid>
          <DataField label="Primeira">{formatDateTime(reservation.firstVerifiedAt)}</DataField>
          <DataField label="Última">{formatDateTime(reservation.lastVerifiedAt)}</DataField>
          <DataField label="Quantidade">{reservation.verificationCount}</DataField>
        </DataGrid>
        {reservation.lastExecutionId === undefined && (
          <Text size="sm" c="dimmed">
            Ainda não verificada pelo HUNIT Control: os dados são os do sistema anterior.
          </Text>
        )}
      </Card>

      {reservation.legacy && (
        <Card block="Sistema anterior" data-testid="legacy-origin">
          <CardHeader title="Sistema anterior" />
          <DataGrid>
            <DataField label="Classificação original">
              {legacyClassificationName(reservation.legacy.originalClassification)}
            </DataField>
            <DataField label="Importada em">
              {formatDateTime(reservation.legacy.importedAt)}
            </DataField>
            <DataField label="Verificações no sistema anterior">
              {reservation.legacy.verificationCount}
            </DataField>
            <DataField label="Primeira verificação">
              {formatDateTime(reservation.legacy.firstVerifiedAt)}
            </DataField>
            <DataField label="Última verificação">
              {formatDateTime(reservation.legacy.lastVerifiedAt)}
            </DataField>
          </DataGrid>
          {reservation.legacy.merged && (
            <Text size="sm" c="dimmed">
              O HUNIT Control já conhecia esta reserva: valem os dados dele. A primeira verificação
              e a quantidade acima incluem as do sistema anterior.
            </Text>
          )}
        </Card>
      )}
    </Stack>
  );
}
