/**
 * Detalhe da reserva (specs/002, FR-022, US3 cenários 4 e 5): dados da cobrança, o status do Hunit
 * (classificação e motivo), o que mudou desde a verificação anterior e o histórico de verificação.
 * Tudo como o servidor informa; o app só formata. No topo, a situação da reserva (specs/003,
 * FR-002); a tratativa manual fica numa seção própria, e o envio ao Comercial em outra (specs/005,
 * FR-023), com o valor cobrado e a origem ao lado do valor total (FR-024).
 */
import { Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { Reservation } from '../../../../shared/ipc-types';
import { ChargedAmount } from '../../components/ChargedAmount';
import { LegacyBadge } from '../../components/LegacyBadge';
import { StatusBadge } from '../../components/StatusBadge';
import { SituationBadge } from '../../components/SituationBadge';
import { formatDate, formatDateTime, formatMoney } from '../../presentation/format';
import {
  CLASSIFICATION_LABELS,
  RESERVATION_STATUS_LABELS,
  legacyClassificationName,
} from '../../presentation/labels';
import { CommercialSection } from './CommercialSection';
import { TreatmentSection } from './TreatmentSection';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" component="div">
        {children ?? '—'}
      </Text>
    </div>
  );
}

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

export function ReservationDetail({ reservation }: { reservation: Reservation }) {
  const { payment, tracking } = reservation;
  const installments =
    payment?.isInstallment && payment.installmentCount
      ? `${payment.installmentCount} × ${formatMoney(payment.installmentAmount)}`
      : payment?.isInstallment === false
        ? 'À vista'
        : '—';

  return (
    <Stack gap="md" data-testid="reservation-detail">
      <Group justify="space-between">
        <Title order={4}>
          Reserva {reservation.reservationNumber}{' '}
          <Text span c="dimmed" size="sm">
            hotel {reservation.hotelCode}
          </Text>
        </Title>
        <Group gap="xs">
          {reservation.legacy && <LegacyBadge size="md" />}
          <SituationBadge treatment={reservation.treatment} size="md" />
          <StatusBadge label={RESERVATION_STATUS_LABELS[reservation.reservationStatus]} size="md" />
        </Group>
      </Group>

      <SimpleGrid cols={3} spacing="sm">
        <Field label="Hóspede">
          <GuestName reservation={reservation} />
        </Field>
        <Field label="Canal">{dash(reservation.channel)}</Field>
        <Field label="Forma de pagamento">{dash(reservation.paymentForm)}</Field>
        <Field label="Check-in">{formatDate(reservation.checkIn)}</Field>
        <Field label="Check-out">{formatDate(reservation.checkOut)}</Field>
        <Field label="Valor total">{formatMoney(reservation.totalAmount)}</Field>
        <Field label="Valor cobrado">
          <ChargedAmount treatment={reservation.treatment} />
        </Field>
      </SimpleGrid>

      <Paper withBorder p="sm" radius="sm" data-testid="hunit-status">
        <Group gap="xs" mb={6}>
          <Title order={5}>Status do Hunit</Title>
          <StatusBadge label={CLASSIFICATION_LABELS[reservation.classification]} />
        </Group>
        <Text size="xs" c="dimmed">
          Motivo da classificação
        </Text>
        <Text size="sm">{reservation.reason}</Text>
        {tracking?.previousClassification && (
          <Group gap="xs" mt={6}>
            <Text size="sm">Classificação anterior:</Text>
            <StatusBadge label={CLASSIFICATION_LABELS[tracking.previousClassification]} />
          </Group>
        )}
        {tracking?.previousReservationStatus && (
          <Group gap="xs" mt={6}>
            <Text size="sm">Situação anterior da reserva:</Text>
            <StatusBadge label={RESERVATION_STATUS_LABELS[tracking.previousReservationStatus]} />
          </Group>
        )}
        {tracking?.notFoundSince && (
          <Text size="sm" c="orange.8" mt={6}>
            Não encontrada na verificação de {formatDateTime(tracking.notFoundSince)}.
          </Text>
        )}
      </Paper>

      <TreatmentSection reservation={reservation} />

      <CommercialSection reservation={reservation} />

      <Paper withBorder p="sm" radius="sm">
        <Title order={5} mb="xs">
          Cobrança
        </Title>
        <SimpleGrid cols={3} spacing="sm">
          <Field label="Data">{payment?.chargedAt ? formatDateTime(payment.chargedAt) : '—'}</Field>
          <Field label="Responsável">{dash(payment?.chargedBy)}</Field>
          <Field label="Valor cobrado no Hunit">{formatMoney(payment?.chargedAmount)}</Field>
          <Field label="Transação">{dash(payment?.transactionId)}</Field>
          <Field label="Autorização">{dash(payment?.authorizationCode)}</Field>
          <Field label="Referência da operadora">{dash(payment?.processorReference)}</Field>
          <Field label="Parcelamento">{installments}</Field>
          <Field label="Estado do pré-pagamento">{dash(payment?.prePaymentState)}</Field>
          <Field label="Mensagem do pré-pagamento">{dash(payment?.prePaymentMessage)}</Field>
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="sm" radius="sm">
        <Title order={5} mb="xs">
          Verificações
        </Title>
        <SimpleGrid cols={3} spacing="sm">
          <Field label="Primeira">{formatDateTime(reservation.firstVerifiedAt)}</Field>
          <Field label="Última">{formatDateTime(reservation.lastVerifiedAt)}</Field>
          <Field label="Quantidade">{reservation.verificationCount}</Field>
        </SimpleGrid>
        {reservation.lastExecutionId === undefined && (
          <Text size="sm" c="dimmed" mt={6}>
            Ainda não verificada pelo HUNIT Control: os dados são os do sistema anterior.
          </Text>
        )}
      </Paper>

      {reservation.legacy && (
        <Paper withBorder p="sm" radius="sm" data-testid="legacy-origin">
          <Title order={5} mb="xs">
            Sistema anterior
          </Title>
          <SimpleGrid cols={3} spacing="sm">
            <Field label="Classificação original">
              {legacyClassificationName(reservation.legacy.originalClassification)}
            </Field>
            <Field label="Importada em">{formatDateTime(reservation.legacy.importedAt)}</Field>
            <Field label="Verificações no sistema anterior">
              {reservation.legacy.verificationCount}
            </Field>
            <Field label="Primeira verificação">
              {formatDateTime(reservation.legacy.firstVerifiedAt)}
            </Field>
            <Field label="Última verificação">
              {formatDateTime(reservation.legacy.lastVerifiedAt)}
            </Field>
          </SimpleGrid>
          {reservation.legacy.merged && (
            <Text size="sm" c="dimmed" mt={6}>
              O HUNIT Control já conhecia esta reserva: valem os dados dele. A primeira verificação
              e a quantidade acima incluem as do sistema anterior.
            </Text>
          )}
        </Paper>
      )}
    </Stack>
  );
}
