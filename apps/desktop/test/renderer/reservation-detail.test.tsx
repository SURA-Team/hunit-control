/**
 * Detalhe da reserva (specs/002, T064, FR-022, US3 cenários 4 e 5): dados da cobrança formatados,
 * motivo, classificação anterior quando mudou e o histórico de verificação.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import type { Reservation } from '../../src/shared/ipc-types';
import { renderWithApp } from './render';

/**
 * Valores em reais: o Intl usa um espaço que não quebra a linha, que a Testing Library normaliza
 * para um espaço comum ao ler a página; o texto procurado usa o espaço comum.
 */
const money = (text: string) => text;

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    hotelCode: '31',
    reservationNumber: '258-1234',
    guestName: 'João Silva',
    channel: 'Booking.com',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    totalAmount: '1234.50',
    reservationStatus: 'active',
    classification: 'virtual_card_already_charged',
    reason: 'cobrança registrada no pré-pagamento',
    paymentForm: null,
    payment: {
      prePaymentFound: true,
      chargedAt: new Date(2026, 10, 4, 14, 30).toISOString(),
      chargedBy: 'Recepção',
      chargedAmount: '1234.50',
      transactionId: 'TX-9001',
      authorizationCode: 'AUT-0042',
      processorReference: 'REF-777',
      isInstallment: true,
      installmentCount: 3,
      installmentAmount: '411.50',
      prePaymentState: 'Charged',
      prePaymentMessage: null,
      chargeActionVisible: false,
    },
    tracking: {
      changedFields: ['classification'],
      statusChanged: false,
      previousClassification: 'virtual_card_pending_charge',
      previousReservationStatus: null,
      statusChangedAt: null,
      notFoundSince: null,
    },
    firstVerifiedAt: new Date(2026, 10, 1, 8, 0).toISOString(),
    lastVerifiedAt: new Date(2026, 10, 12, 9, 15).toISOString(),
    verificationCount: 4,
    lastExecutionId: '11111111-1111-4111-8111-111111111111',
    anonymized: false,
    ...overrides,
  };
}

describe('ReservationDetail (FR-022)', () => {
  it('mostra os dados da cobrança formatados', () => {
    renderWithApp(<ReservationDetail reservation={reservation()} />);

    expect(screen.getByText('04/11/2026 14:30')).toBeInTheDocument();
    expect(screen.getByText('Recepção')).toBeInTheDocument();
    expect(screen.getAllByText(money('R$ 1.234,50')).length).toBeGreaterThan(0);
    expect(screen.getByText('TX-9001')).toBeInTheDocument();
    expect(screen.getByText('AUT-0042')).toBeInTheDocument();
    expect(screen.getByText('REF-777')).toBeInTheDocument();
    expect(screen.getByText(money('3 × R$ 411,50'))).toBeInTheDocument();
    expect(screen.getByText('Charged')).toBeInTheDocument();
  });

  it('mostra o motivo e a classificação anterior quando mudou', () => {
    renderWithApp(<ReservationDetail reservation={reservation()} />);

    expect(screen.getByText('cobrança registrada no pré-pagamento')).toBeInTheDocument();
    expect(screen.getByText('Já cobrada')).toBeInTheDocument();
    expect(screen.getByText('Pendente de cobrança')).toBeInTheDocument();
  });

  it('mostra a primeira e a última verificação e a quantidade', () => {
    renderWithApp(<ReservationDetail reservation={reservation()} />);

    expect(screen.getByText('01/11/2026 08:00')).toBeInTheDocument();
    expect(screen.getByText('12/11/2026 09:15')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('sem mudança, não mostra classificação anterior', () => {
    renderWithApp(
      <ReservationDetail
        reservation={reservation({
          tracking: {
            changedFields: [],
            statusChanged: false,
            previousClassification: null,
            previousReservationStatus: null,
            statusChangedAt: null,
            notFoundSince: null,
          },
        })}
      />,
    );

    expect(screen.queryByText(/classificação anterior/i)).not.toBeInTheDocument();
  });

  it('reserva anonimizada mostra "nome anonimizado" (cenário 5)', () => {
    renderWithApp(
      <ReservationDetail reservation={reservation({ guestName: null, anonymized: true })} />,
    );

    expect(screen.getByText(/nome anonimizado/i)).toBeInTheDocument();
  });
});
