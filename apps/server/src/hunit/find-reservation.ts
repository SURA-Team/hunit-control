/**
 * Verificação de uma reserva no Hunit pelo número (specs/005, FR-004; research R-02).
 *
 * Usa só o que o gateway já faz — a listagem do hotel (`GetBookings`, com os filtros fixos da
 * FR-010 da 001) no dia do check-in registrado e o detalhe (`BookingDetail`) —, por isso nenhuma
 * rota nova entra na lista de permissão da proteção de somente leitura. As novas tentativas por
 * indisponibilidade passageira (FR-011a da 001) valem aqui também, porque estão no cliente da API.
 *
 * Fica na camada do Hunit (constitution, princípio II): quem chama recebe só objetos do domínio.
 */
import type { Period } from '@hunit/domain';
import type { HunitGateway, ReservationDetail, ReservationListItem } from './gateway.js';

export interface FoundReservation {
  item: ReservationListItem;
  detail: ReservationDetail;
}

/**
 * Procura a reserva na listagem do hotel no dia do check-in e lê o detalhe dela.
 *
 * @returns `null` se a reserva não aparece na listagem desse dia (não existe mais, mudou de
 *   check-in no Hunit ou deixou de ser Canal Collect).
 * @throws os erros da camada do Hunit (`ScreenNotRecognizedError`, `SessionExpiredError`,
 *   `HunitUnavailableError`), como as leituras da coleta.
 */
export async function findReservation(
  gateway: HunitGateway,
  input: { hotelCode: string; reservationNumber: string; checkIn: string },
): Promise<FoundReservation | null> {
  const period: Period = { from: input.checkIn, to: input.checkIn };
  for (let page = 1; ; page += 1) {
    const result = await gateway.searchReservations(input.hotelCode, period, page);
    const item = result.items.find(
      (candidate) => candidate.reservationNumber === input.reservationNumber,
    );
    if (item) return { item, detail: await gateway.readReservation(input.hotelCode, item) };
    if (page >= result.totalPages) return null;
  }
}
