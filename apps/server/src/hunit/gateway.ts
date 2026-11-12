import type {
  Period,
  ReservationListing,
  ReservationSnapshot,
  ReservationStatus,
} from '@hunit/domain';
import type { EvidenceMaterial } from '../evidence/material.js';

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

  /**
   * Detalhe de uma reserva da listagem, somente leitura (FR-012).
   *
   * @throws ScreenNotRecognizedError se o detalhe não tiver o formato esperado (o executor
   *   classifica a reserva como erro de análise, com a evidência, e segue — edge case "falha ao
   *   abrir uma reserva"); SessionExpiredError, HunitUnavailableError.
   */
  readReservation(hotelCode: string, item: ReservationListItem): Promise<ReservationDetail>;

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

/** Detalhe lido de uma reserva. */
export interface ReservationDetail {
  snapshot: ReservationSnapshot;
  /**
   * O que o Hunit devolveu (ex.: a resposta JSON do detalhe). Vira evidência quando a reserva
   * não pode ser classificada com segurança ou a situação dela não é identificada (FR-014a,
   * FR-024).
   */
  evidence: EvidenceMaterial;
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

/**
 * Aviso de que uma leitura do Hunit falhou por indisponibilidade passageira e vai ser repetida
 * (FR-011a, research R-23).
 */
export interface HunitRetryNotice {
  /** Número desta nova tentativa, começando em 1. */
  attempt: number;
  /** Total de novas tentativas permitidas. */
  maxAttempts: number;
  /** Espera antes desta tentativa, em milissegundos. */
  delayMs: number;
  /** Hotel da leitura, ou `null` quando ela não é de um hotel (ex.: catálogo). */
  hotelCode: string | null;
  /** O que aconteceu, para o operador. Nunca cita usuário, senha ou token. */
  reason: string;
}

/** Recebe os avisos de nova tentativa; a leitura espera a promessa antes de seguir. */
export type HunitRetryListener = (notice: HunitRetryNotice) => void | Promise<void>;

/** Cria a sessão do Hunit de uma execução. Cada execução tem a sua, com navegador próprio. */
export type CreateHunitGateway = (options: {
  executionId: string;
  /** Chamado antes de cada nova tentativa de uma leitura (FR-011a). */
  onRetry?: HunitRetryListener;
}) => Promise<HunitGateway>;
