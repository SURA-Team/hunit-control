/**
 * Detalhe da reserva (specs/002, FR-022, US3 cenários 4 e 5): dados da cobrança, motivo da
 * classificação, o que mudou desde a verificação anterior e o histórico de verificação. Tudo como
 * o servidor informa; o app só formata.
 */
import { Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { Reservation } from '../../../../shared/ipc-types';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate, formatDateTime, formatMoney } from '../../presentation/format';
import { CLASSIFICATION_LABELS, RESERVATION_STATUS_LABELS } from '../../presentation/labels';

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
          <StatusBadge label={CLASSIFICATION_LABELS[reservation.classification]} size="md" />
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
      </SimpleGrid>

      <Paper withBorder p="sm" radius="sm">
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

      <Paper withBorder p="sm" radius="sm">
        <Title order={5} mb="xs">
          Cobrança
        </Title>
        <SimpleGrid cols={3} spacing="sm">
          <Field label="Data">{payment?.chargedAt ? formatDateTime(payment.chargedAt) : '—'}</Field>
          <Field label="Responsável">{dash(payment?.chargedBy)}</Field>
          <Field label="Valor cobrado">{formatMoney(payment?.chargedAmount)}</Field>
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
      </Paper>
    </Stack>
  );
}
