import type {
  Period,
  ReservationListing,
  ReservationSnapshot,
  ReservationStatus,
} from '@hunit/domain';

/**
 * Porta de entrada da camada do Hunit (constitution, princípio II; research R-13a).
 *
 * O executor só conhece esta interface: ela devolve objetos neutros do domínio e nunca expõe
 * telas, seletores, rotas ou formatos de resposta do Hunit. Há duas implementações: a real
 * (Playwright para login/2FA + leitura da API interna) e a simulada, usada nos testes.
 *
 * Todas as operações são somente leitura (FR-012): não existe método que cobre, altere ou
 * cancele algo no Hunit.
 *
 * Falhas são sinalizadas com os erros de `errors.ts`.
 */
export interface HunitGateway {
  /**
   * Abre o Hunit e informa usuário e senha.
   *
   * @returns `two_factor_required` quando o Hunit pede o token (o caso normal) ou
   *   `authenticated` quando o acesso é concluído sem token.
   * @throws InvalidCredentialsError, HunitUnavailableError, ScreenNotRecognizedError
   */
  login(credentials: HunitCredentials): Promise<LoginOutcome>;

  /**
   * Informa o token 2FA pedido depois de `login`. Ao terminar sem erro, o acesso está concluído.
   *
   * @throws InvalidTokenError, TwoFactorTimeoutError, HunitUnavailableError,
   *   ScreenNotRecognizedError
   */
  submitToken(token: string): Promise<void>;

  /** Hotéis disponíveis na conta (FR-008). Exige acesso concluído. */
  listHotels(): Promise<HunitHotel[]>;

  /**
   * Uma página da listagem de reservas de um hotel, com os filtros fixos da FR-010 e check-in
   * dentro do período. `page` começa em 1.
   */
  searchReservations(hotelCode: string, period: Period, page: number): Promise<ReservationPage>;

  /** Detalhe de uma reserva, somente leitura. `bookingId` vem de `ReservationListItem`. */
  readReservation(hotelCode: string, bookingId: string): Promise<ReservationSnapshot>;

  /**
   * Encerra a sessão e libera o navegador. Pode ser chamado a qualquer momento (inclusive com
   * outra operação em andamento, que então falha) e mais de uma vez.
   */
  close(): Promise<void>;
}

/** Credenciais do Hunit. Existem só em memória, enquanto o login acontece (FR-005). */
export interface HunitCredentials {
  username: string;
  password: string;
}

export type LoginOutcome = 'two_factor_required' | 'authenticated';

export interface HunitHotel {
  /** Identificador do hotel no Hunit. */
  code: string;
  name: string;
}

/** Uma reserva como aparece na listagem do Hunit. */
export interface ReservationListItem {
  /** Identificador interno do Hunit, usado para ler o detalhe. Não é o número da reserva. */
  bookingId: string;
  /** Número da reserva exibido ao usuário; identifica a reserva junto com o hotel (FR-017). */
  reservationNumber: string;
  reservationStatus: ReservationStatus;
  listing: ReservationListing;
}

export interface ReservationPage {
  /** Página devolvida, começando em 1. */
  page: number;
  /** Total de páginas, descoberto a partir do próprio resultado (FR-011). Zero se não há reservas. */
  totalPages: number;
  /** Total de reservas em todas as páginas. */
  totalItems: number;
  items: ReservationListItem[];
}

/** Cria a sessão do Hunit de uma execução. Cada execução tem a sua, com navegador próprio. */
export type CreateHunitGateway = (options: { executionId: string }) => Promise<HunitGateway>;
