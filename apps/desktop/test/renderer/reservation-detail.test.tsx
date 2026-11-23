/**
 * Detalhe da reserva (specs/002, T064, FR-022, US3 cenários 4 e 5): dados da cobrança formatados,
 * motivo, classificação anterior quando mudou e o histórico de verificação.
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import type { Reservation } from '../../src/shared/ipc-types';
import { renderWithApp } from './render';
import { NO_TREATMENT } from './treatment-fixtures';

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
    treatment: {
      ...NO_TREATMENT,
      situation: 'virtual_card_already_charged',
      detailedSituation: 'virtual_card_already_charged',
      acceptsDocuments: false,
    },
    amountToCharge: '1234.50',
    noCharge: null,
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

    const hunitStatus = within(screen.getByTestId('hunit-status'));
    expect(hunitStatus.getByText('Status do Hunit')).toBeInTheDocument();
    expect(hunitStatus.getByText('cobrança registrada no pré-pagamento')).toBeInTheDocument();
    expect(hunitStatus.getByText('Já cobrada')).toBeInTheDocument();
    expect(hunitStatus.getByText('Pendente de cobrança')).toBeInTheDocument();
  });

  it('com comprovante, a situação é "Comprovante enviado" e o status do Hunit fica à parte (FR-002)', () => {
    renderWithApp(
      <ReservationDetail
        reservation={reservation({
          classification: 'cancelled_no_charge',
          treatment: {
            ...NO_TREATMENT,
            situation: 'proof_sent',
            detailedSituation: 'proof_sent',
            status: 'charged',
          },
        })}
      />,
    );

    const header = screen.getByRole('heading', { name: /Reserva/ }).parentElement;
    expect(header).toHaveTextContent('Comprovante enviado');
    expect(
      within(screen.getByTestId('hunit-status')).getByText('Cancelada sem cobrança'),
    ).toBeInTheDocument();
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

describe('gaveta no visual novo (specs/006, T044; tela 4.2, research R-12)', () => {
  const header = () => screen.getByRole('heading', { name: /Reserva 258-1234/ }).parentElement;

  it('cabeçalho com o número, o hotel e os selos da situação e de ativa', () => {
    renderWithApp(<ReservationDetail reservation={reservation()} />);
    expect(screen.getByRole('heading', { name: /Reserva 258-1234/ })).toHaveTextContent(
      'Reserva 258-1234 hotel 31',
    );
    expect(header()).toHaveTextContent('Já cobrada');
    expect(header()).toHaveTextContent('Ativa');
  });

  it('cancelada mostra "Cancelada"; sem a situação no Hunit, "Não identificada" uma vez só', () => {
    const { unmount } = renderWithApp(
      <ReservationDetail reservation={reservation({ reservationStatus: 'cancelled' })} />,
    );
    expect(header()).toHaveTextContent('Cancelada');
    unmount();

    renderWithApp(
      <ReservationDetail reservation={reservation({ reservationStatus: 'unknown' })} />,
    );
    expect(within(header() as HTMLElement).getAllByText('Não identificada')).toHaveLength(1);
  });

  it('dados da reserva com "Valor cobrado" e o card Cobrança com "Valor cobrado no Hunit" (FR-040)', () => {
    renderWithApp(
      <ReservationDetail
        reservation={reservation({
          treatment: {
            ...reservation().treatment,
            effectiveChargedAmount: '1234.50',
            chargedAmountOrigin: 'hunit',
          },
        })}
      />,
    );
    const data = screen.getByLabelText('Dados da reserva');
    for (const label of [
      'Hóspede',
      'Canal',
      'Forma de pagamento',
      'Check-in',
      'Check-out',
      'Valor total',
      'Valor cobrado',
    ]) {
      expect(within(data).getByText(label)).toBeInTheDocument();
    }
    expect(data.textContent?.replace(/\s+/g, ' ')).toContain('R$ 1.234,50 (Hunit)');
    expect(screen.getByText('Valor cobrado no Hunit')).toBeInTheDocument();
  });

  it('"Status do Hunit" com o motivo e a "Classificação anterior" (FR-025); "Verificações" (FR-028)', () => {
    renderWithApp(<ReservationDetail reservation={reservation()} />);
    const status = screen.getByTestId('hunit-status');
    expect(status).toHaveTextContent('Motivo da classificação');
    expect(status).toHaveTextContent('Classificação anterior:');
    expect(status).toHaveTextContent('Pendente de cobrança');
    for (const title of ['Status do Hunit', 'Tratativa', 'Cobrança', 'Verificações']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });
});
