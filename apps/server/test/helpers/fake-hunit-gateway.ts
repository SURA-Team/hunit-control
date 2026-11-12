/**
 * Hunit simulado, programável por roteiro (tasks.md, T019).
 *
 * Permite testar o executor, o banco e a API sem acessar o Hunit real: o teste descreve o que
 * o "Hunit" deve responder (`FakeScenario`) e pode intervir em qualquer chamada com `before`
 * (pausar, falhar, cancelar a execução no meio).
 *
 * Exemplo:
 *
 *   const hunit = new FakeHunit({
 *     hotels: [{ code: 'H1', reservations: [{ reservationNumber: '1001' }] }],
 *   });
 *   const gateway = await hunit.createGateway({ executionId });
 */
import type {
  Period,
  ReservationListing,
  ReservationPayment,
  ReservationSnapshot,
  ReservationStatus,
} from '@hunit/domain';
import { InvalidTokenError } from '../../src/hunit/errors.js';
import type {
  CreateHunitGateway,
  HunitCredentials,
  HunitGateway,
  HunitHotel,
  HunitRetryNotice,
  LoginOutcome,
  ReservationDetail,
  ReservationListItem,
  ReservationPage,
} from '../../src/hunit/gateway.js';

/** Campos do detalhe de uma reserva que o teste quer diferentes do padrão. */
export type FakeDetail = Partial<Omit<ReservationSnapshot, 'payment' | 'listing'>> & {
  payment?: Partial<ReservationPayment>;
};

export interface FakeReservation {
  reservationNumber: string;
  /** Padrão: `booking-<número da reserva>`. */
  bookingId?: string;
  /** Situação mostrada na listagem e no detalhe. Padrão: `active`. */
  reservationStatus?: ReservationStatus;
  listing?: Partial<ReservationListing>;
  /**
   * O que `readReservation` devolve: campos a sobrepor ao detalhe padrão (uma reserva pendente
   * de cobrança) ou um erro a lançar. Veja `reservationDetails` para os casos comuns.
   */
  detail?: FakeDetail | Error;
}

export interface FakeHotel {
  code: string;
  name?: string;
  /** Reservas do hotel. A busca devolve as que têm check-in dentro do período pedido. */
  reservations?: FakeReservation[];
  /** Alternativa a `reservations`: páginas exatas, devolvidas para qualquer período. */
  pages?: FakeReservation[][];
  /** Reservas por página quando a paginação é calculada. Padrão: 30. */
  pageSize?: number;
  /** Erro lançado ao consultar as reservas deste hotel. */
  searchError?: Error;
}

export interface FakeScenario {
  /** Resultado do login. Padrão: o Hunit pede o token. */
  login?: LoginOutcome | Error;
  /** Token aceito; qualquer outro é recusado com `InvalidTokenError`. Padrão: "123456". */
  validToken?: string;
  /** Erro lançado por `submitToken`, qualquer que seja o token. */
  tokenError?: Error;
  hotels?: FakeHotel[];
  /**
   * Hotéis que cada usuário acessa (contas com acessos diferentes, FR-009a). Usuário fora da
   * lista acessa todos os hotéis do roteiro.
   */
  accessByUsername?: Record<string, readonly string[]>;
  listHotelsError?: Error;
}

export type FakeCall = { session: number } & (
  | { method: 'login'; credentials: HunitCredentials }
  | { method: 'submitToken'; token: string }
  | { method: 'listHotels' }
  | { method: 'searchReservations'; hotelCode: string; period: Period; page: number }
  | { method: 'readReservation'; hotelCode: string; bookingId: string }
  | { method: 'close' }
);

export type FakeMethod = FakeCall['method'];
type CallTo<M extends FakeMethod> = Extract<FakeCall, { method: M }>;
/** Uma chamada antes de receber o número da sessão. */
type NewFakeCall = { [M in FakeMethod]: Omit<CallTo<M>, 'session'> }[FakeMethod];
type Hook = (call: FakeCall) => void | Promise<void>;

const DEFAULT_TOKEN = '123456';
const DEFAULT_PAGE_SIZE = 30;

export function fakeListing(overrides: Partial<ReservationListing> = {}): ReservationListing {
  return {
    guestName: 'Hóspede de Teste',
    channel: 'Booking.com',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    stayPeriod: '03/11/2026 a 05/11/2026',
    totalAmount: '500.00',
    ...overrides,
  };
}

const EMPTY_PAYMENT: ReservationPayment = {
  chargedAt: null,
  chargedBy: null,
  chargedAmount: null,
  transactionId: null,
  authorizationCode: null,
  processorReference: null,
  isInstallment: null,
  installmentCount: null,
  installmentAmount: null,
  prePaymentState: null,
  prePaymentMessage: null,
};

/** Sinais de uma reserva sem pré-pagamento; a forma de pagamento decide (FR-013, regra 2). */
const noPrePayment = {
  prePaymentPresent: false,
  chargeRecordPresent: false,
  chargeActionVisible: false,
  chargeFailed: false,
  validationOnly: false,
} as const;

/** Detalhes prontos para as situações de cobrança mais comuns (FR-013). */
export const reservationDetails = {
  /** Pré-pagamento sem cobrança e com a ação de cobrar disponível (é o padrão). */
  pendingCharge: (): FakeDetail => ({
    prePaymentPresent: true,
    chargeRecordPresent: false,
    chargeActionVisible: true,
    chargeFailed: false,
    validationOnly: false,
    payment: { prePaymentState: 'Unprocessed' },
  }),
  /** Pré-pagamento com registro "Cobrado em". */
  alreadyCharged: (payment: Partial<ReservationPayment> = {}): FakeDetail => ({
    prePaymentPresent: true,
    chargeRecordPresent: true,
    chargeActionVisible: false,
    chargeFailed: false,
    validationOnly: false,
    payment: {
      prePaymentState: 'Success',
      chargedAt: '2026-11-02T14:30:00.000Z',
      chargedBy: 'Operador de Teste',
      chargedAmount: '500.00',
      transactionId: 'T-0001',
      authorizationCode: 'A-0001',
      processorReference: 'P-0001',
      isInstallment: false,
      installmentCount: 1,
      installmentAmount: '500.00',
      ...payment,
    },
  }),
  /** Cartão apenas validado ("Validado em"), sem cobrança. */
  validatedOnly: (payment: Partial<ReservationPayment> = {}): FakeDetail => ({
    prePaymentPresent: true,
    chargeRecordPresent: false,
    chargeActionVisible: false,
    chargeFailed: false,
    validationOnly: true,
    payment: {
      prePaymentState: 'Success',
      chargedAt: '2026-11-02T14:30:00.000Z',
      chargedBy: 'Operador de Teste',
      chargedAmount: '0.00',
      ...payment,
    },
  }),
  /** O estado atual do pré-pagamento indica falha de cobrança. */
  chargeError: (message = 'Cartão recusado'): FakeDetail => ({
    prePaymentPresent: true,
    chargeRecordPresent: false,
    chargeActionVisible: true,
    chargeFailed: true,
    validationOnly: false,
    payment: { prePaymentState: 'Fail', prePaymentMessage: message },
  }),
  /** Sem pré-pagamento e forma "faturado" (research R-22). */
  invoiced: (): FakeDetail => ({
    ...noPrePayment,
    paymentForm: { kind: 'invoiced', label: 'Faturado' },
  }),
  /** Sem pré-pagamento e forma "cartão de crédito": cobrar na maquininha (research R-22). */
  chargeAtTerminal: (): FakeDetail => ({
    ...noPrePayment,
    paymentForm: { kind: 'credit_card', label: 'cartão de crédito' },
  }),
  /** Sem pré-pagamento e sem forma de pagamento informada (research R-22). */
  noCardNoForm: (): FakeDetail => ({ ...noPrePayment, paymentForm: null }),
  /** Detalhe em formato não reconhecido: nada pôde ser determinado. */
  unrecognized: (): FakeDetail => ({
    structureRecognized: false,
    prePaymentPresent: null,
    chargeRecordPresent: null,
    chargeActionVisible: null,
    chargeFailed: null,
    validationOnly: null,
    reservationStatus: 'unknown',
  }),
};

function bookingIdOf(reservation: FakeReservation): string {
  return reservation.bookingId ?? `booking-${reservation.reservationNumber}`;
}

function toListItem(reservation: FakeReservation): ReservationListItem {
  return {
    bookingId: bookingIdOf(reservation),
    reservationNumber: reservation.reservationNumber,
    reservationStatus: reservation.reservationStatus ?? 'active',
    listing: fakeListing(reservation.listing),
  };
}

function toSnapshot(reservation: FakeReservation, detail: FakeDetail): ReservationSnapshot {
  const { payment, ...flags } = { ...reservationDetails.pendingCharge(), ...detail };
  return {
    reservationNumber: reservation.reservationNumber,
    structureRecognized: true,
    prePaymentPresent: null,
    chargeRecordPresent: null,
    chargeActionVisible: null,
    chargeFailed: null,
    validationOnly: null,
    reservationStatus: reservation.reservationStatus ?? 'active',
    paymentForm: null,
    ...flags,
    payment: { ...EMPTY_PAYMENT, ...payment },
    listing: fakeListing(reservation.listing),
  };
}

/** O "site" simulado: guarda o roteiro e cria uma sessão (gateway) por execução. */
export class FakeHunit {
  scenario: FakeScenario;
  /** Sessões criadas, na ordem (uma por execução). */
  readonly sessions: FakeHunitGateway[] = [];
  /** Todas as chamadas recebidas, de todas as sessões, na ordem em que chegaram. */
  readonly calls: FakeCall[] = [];
  private readonly hooks = new Map<FakeMethod, Hook[]>();

  constructor(scenario: FakeScenario = {}) {
    this.scenario = scenario;
  }

  readonly createGateway: CreateHunitGateway = (options) => {
    const gateway = new FakeHunitGateway(this, this.sessions.length + 1, options.onRetry);
    this.sessions.push(gateway);
    return Promise.resolve(gateway);
  };

  /**
   * Registra uma função chamada antes de cada execução de `method`. Ela pode lançar um erro
   * (a chamada falha) ou devolver uma promessa (a chamada espera) — útil para cancelar uma
   * execução num ponto exato.
   */
  before<M extends FakeMethod>(method: M, hook: (call: CallTo<M>) => void | Promise<void>): void {
    const hooks = this.hooks.get(method) ?? [];
    hooks.push(hook as Hook);
    this.hooks.set(method, hooks);
  }

  /** Chamadas recebidas para um método. */
  callsTo<M extends FakeMethod>(method: M): Array<CallTo<M>> {
    return this.calls.filter((call): call is CallTo<M> => call.method === method);
  }

  /** @internal */
  hooksFor(method: FakeMethod): readonly Hook[] {
    return this.hooks.get(method) ?? [];
  }

  /** @internal */
  hotel(code: string): FakeHotel {
    const hotel = this.scenario.hotels?.find((candidate) => candidate.code === code);
    if (!hotel) throw new Error(`FakeHunit: o roteiro não tem o hotel "${code}".`);
    return hotel;
  }
}

type SessionState = 'new' | 'awaiting_token' | 'authenticated';

export class FakeHunitGateway implements HunitGateway {
  private state: SessionState = 'new';
  /** Usuário que fez login nesta sessão (decide o catálogo, `accessByUsername`). */
  private username: string | null = null;
  private isClosed = false;
  private rejectPending: (error: Error) => void = () => undefined;
  private readonly closedSignal: Promise<never>;

  constructor(
    private readonly hunit: FakeHunit,
    /** Número da sessão, começando em 1. */
    readonly session: number,
    /** Aviso de nova tentativa informado pelo executor em `createGateway` (research R-23). */
    private readonly onRetry: ((notice: HunitRetryNotice) => void | Promise<void>) | undefined,
  ) {
    this.closedSignal = new Promise<never>((_resolve, reject) => {
      this.rejectPending = reject;
    });
    // Evita o aviso de "rejeição não tratada" quando nenhuma chamada está em andamento.
    this.closedSignal.catch(() => undefined);
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /**
   * Simula o aviso que o gateway real dá antes de repetir uma leitura que falhou por erro
   * passageiro do Hunit (FR-011a, research R-23). Use dentro de um `before`.
   */
  async notifyRetry(notice: HunitRetryNotice): Promise<void> {
    if (!this.onRetry) throw this.misuse('o executor não informou onRetry ao criar o gateway');
    await this.onRetry(notice);
  }

  async login(credentials: HunitCredentials): Promise<LoginOutcome> {
    return this.run({ method: 'login', credentials }, () => {
      if (this.state !== 'new') throw this.misuse('login chamado duas vezes na mesma sessão');

      const outcome = this.hunit.scenario.login ?? 'two_factor_required';
      if (outcome instanceof Error) throw outcome;

      this.username = credentials.username;
      this.state = outcome === 'authenticated' ? 'authenticated' : 'awaiting_token';
      return outcome;
    });
  }

  async submitToken(token: string): Promise<void> {
    return this.run({ method: 'submitToken', token }, () => {
      if (this.state !== 'awaiting_token') {
        throw this.misuse('submitToken chamado sem o Hunit ter pedido o token');
      }

      const { tokenError, validToken = DEFAULT_TOKEN } = this.hunit.scenario;
      if (tokenError) throw tokenError;
      if (token !== validToken) throw new InvalidTokenError();

      this.state = 'authenticated';
    });
  }

  async listHotels(): Promise<HunitHotel[]> {
    return this.run({ method: 'listHotels' }, () => {
      this.requireAccess('listHotels');

      const { listHotelsError, hotels = [], accessByUsername } = this.hunit.scenario;
      if (listHotelsError) throw listHotelsError;

      const access = this.username === null ? undefined : accessByUsername?.[this.username];
      const visible = access ? hotels.filter((hotel) => access.includes(hotel.code)) : hotels;
      return visible.map((hotel) => ({
        code: hotel.code,
        name: hotel.name ?? `Hotel ${hotel.code}`,
      }));
    });
  }

  async searchReservations(
    hotelCode: string,
    period: Period,
    page: number,
  ): Promise<ReservationPage> {
    return this.run({ method: 'searchReservations', hotelCode, period, page }, () => {
      this.requireAccess('searchReservations');

      const hotel = this.hunit.hotel(hotelCode);
      if (hotel.searchError) throw hotel.searchError;

      if (hotel.pages) {
        return {
          page,
          totalPages: hotel.pages.length,
          totalItems: hotel.pages.flat().length,
          items: (hotel.pages[page - 1] ?? []).map(toListItem),
        };
      }

      const pageSize = hotel.pageSize ?? DEFAULT_PAGE_SIZE;
      const matching = (hotel.reservations ?? []).filter((reservation) => {
        const { checkIn } = fakeListing(reservation.listing);
        return checkIn >= period.from && checkIn <= period.to;
      });

      return {
        page,
        totalPages: Math.ceil(matching.length / pageSize),
        totalItems: matching.length,
        items: matching.slice((page - 1) * pageSize, page * pageSize).map(toListItem),
      };
    });
  }

  async readReservation(hotelCode: string, item: ReservationListItem): Promise<ReservationDetail> {
    const { bookingId } = item;
    return this.run({ method: 'readReservation', hotelCode, bookingId }, () => {
      this.requireAccess('readReservation');

      const hotel = this.hunit.hotel(hotelCode);
      const reservation = [...(hotel.reservations ?? []), ...(hotel.pages ?? []).flat()].find(
        (candidate) => bookingIdOf(candidate) === bookingId,
      );
      if (!reservation) {
        throw new Error(`FakeHunit: o hotel "${hotelCode}" não tem a reserva "${bookingId}".`);
      }

      const detail = reservation.detail ?? {};
      if (detail instanceof Error) throw detail;
      const snapshot = toSnapshot(reservation, detail);
      return { snapshot, evidence: { response: JSON.stringify({ fake: true, bookingId }) } };
    });
  }

  close(): Promise<void> {
    this.hunit.calls.push({ session: this.session, method: 'close' });
    if (!this.isClosed) {
      this.isClosed = true;
      this.rejectPending(new Error('O navegador foi fechado.'));
    }
    return Promise.resolve();
  }

  private async run<T>(call: NewFakeCall, body: () => T): Promise<T> {
    const recorded: FakeCall = { ...call, session: this.session };
    this.hunit.calls.push(recorded);
    this.assertOpen();

    for (const hook of this.hunit.hooksFor(recorded.method)) {
      // Se a sessão for fechada enquanto a chamada espera, ela falha (como no navegador real).
      await Promise.race([hook(recorded), this.closedSignal]);
    }

    this.assertOpen();
    return body();
  }

  private assertOpen(): void {
    if (this.isClosed) throw new Error('O navegador foi fechado.');
  }

  private requireAccess(method: string): void {
    if (this.state !== 'authenticated') {
      throw this.misuse(`${method} chamado antes de o acesso ser concluído`);
    }
  }

  private misuse(problem: string): Error {
    return new Error(`FakeHunit (uso incorreto do gateway): ${problem}.`);
  }
}
