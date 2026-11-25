/**
 * Validação de toda entrada que chega da interface (specs/002, research R-02, contracts/ipc.md).
 * O processo principal confere cada pedido com estes esquemas antes de fazer qualquer coisa;
 * entrada inválida vira `invalid_input`, sem chamar a API nem tocar no disco.
 */
import { z } from 'zod';
import { MAX_COMMERCIAL_RESERVATIONS, MAX_TREATMENT_RESERVATIONS } from './ipc-types.js';

/** Datas no formato da API (YYYY-MM-DD), com dia que existe no calendário. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'data inexistente');

const uuid = z.uuid();
const cursor = z.string().min(1).max(1000);
const limit = z.number().int().min(1).max(500);
const shortText = z.string().min(1).max(200);

/**
 * Endereço do servidor: `https://` obrigatório e só a origem — sem caminho, consulta, fragmento
 * nem usuário e senha. Sai normalizado, sem a barra final (ex.: "https://192.168.0.50").
 */
export const serverUrlSchema = z.string().transform((value, context) => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    context.addIssue({ code: 'custom', message: 'endereço inválido' });
    return z.NEVER;
  }
  const onlyOrigin =
    (url.pathname === '/' || url.pathname === '') &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  if (url.protocol !== 'https:' || !onlyOrigin) {
    context.addIssue({
      code: 'custom',
      message: 'use https:// e só o endereço do servidor (sem caminho, consulta ou fragmento)',
    });
    return z.NEVER;
  }
  return url.origin;
});

const certificatePem = z
  .string()
  .max(20_000)
  .refine((value) => value.includes('-----BEGIN CERTIFICATE-----'), 'certificado PEM');

const apiKey = z.string().trim().min(1).max(500);

export const connectionInputSchema = z.strictObject({
  serverUrl: serverUrlSchema,
  certificatePem,
  apiKey: apiKey.optional(),
});

export const idleHoursSchema = z.number().int().min(1).max(24);

/** Volume do som do aviso (specs/008, FR-002). */
export const soundVolumeSchema = z.number().int().min(0).max(100);

export const preferencesInputSchema = z.strictObject({
  soundEnabled: z.boolean().optional(),
  soundVolume: soundVolumeSchema.optional(),
  idleHours: idleHoursSchema.optional(),
});

export const credentialsInputSchema = z.strictObject({
  username: z.string().trim().min(1).max(200),
  // A senha vai como foi digitada: espaços podem fazer parte dela.
  password: z.string().min(1).max(500),
});

export const executionIdSchema = uuid;

export const executionListInputSchema = z.strictObject({
  active: z.boolean().optional(),
  status: z
    .enum(['queued', 'running', 'awaiting_2fa', 'completed', 'failed', 'cancelled'])
    .optional(),
  cursor: cursor.optional(),
  limit: limit.optional(),
});

/**
 * Período do resumo do módulo de Relatórios (specs/007): as duas datas, início até o fim; desde o
 * contrato 1.11.0, os filtros do painel da área Reservas (FR-005a, research R-14). Os valores das
 * situações são conferidos pelo servidor.
 */
export const reportOverviewInputSchema = z
  .strictObject({
    checkInFrom: isoDate,
    checkInTo: isoDate,
    hotelCode: z.array(shortText).max(1000).optional(),
    detailedSituation: z.array(z.string().min(1).max(64)).max(20).optional(),
    reservationStatus: z.array(z.string().min(1).max(64)).max(10).optional(),
    channel: z.string().min(1).max(100).optional(),
    fromLegacy: z.boolean().optional(),
    notFound: z.boolean().optional(),
  })
  .refine((input) => input.checkInFrom <= input.checkInTo, 'o início não pode ser depois do fim');

export const startExecutionInputSchema = z.strictObject({
  period: z
    .strictObject({ from: isoDate, to: isoDate })
    .refine((period) => period.from <= period.to, 'o início não pode ser depois do fim'),
  hotelCodes: z.array(shortText).min(1).max(1000).nullable(),
});

export const sendTokenInputSchema = z.strictObject({
  executionId: uuid,
  token: z.string().regex(/^[0-9]{4,10}$/, 'o token tem de 4 a 10 dígitos'),
});

export const reservationListInputSchema = z.strictObject({
  executionId: uuid.optional(),
  hotelCode: z.array(shortText).max(1000).optional(),
  // Os valores aceitos são conferidos pelo servidor, que conhece a lista do contrato.
  classification: z.array(z.string().min(1).max(64)).max(50).optional(),
  reservationStatus: z.array(z.string().min(1).max(64)).max(10).optional(),
  notFound: z.boolean().optional(),
  checkInFrom: isoDate.optional(),
  checkInTo: isoDate.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  channel: z.string().min(1).max(100).optional(),
  amount: z
    .string()
    .regex(/^[0-9]+\.[0-9]{2}$/, 'valor no formato 1234.56')
    .optional(),
  treatmentStatus: z
    .array(z.enum(['none', 'sent', 'charged']))
    .max(3)
    .optional(),
  pendingCharge: z.boolean().optional(),
  // Situação da reserva (specs/003): os valores aceitos são conferidos pelo servidor.
  situation: z.array(z.string().min(1).max(64)).max(20).optional(),
  needsReview: z.boolean().optional(),
  // Origem "Sistema anterior" (specs/004, FR-011).
  fromLegacy: z.boolean().optional(),
  // Situação com o detalhe do Comercial (specs/005): os valores aceitos são conferidos pelo servidor.
  detailedSituation: z.array(z.string().min(1).max(64)).max(20).optional(),
  // Filtro rápido e ordem da lista (specs/006, contrato 1.8.0).
  quickFilter: z.enum(['pending_charge', 'to_review', 'with_error', 'done']).optional(),
  // `amount_desc` (specs/007, contrato 1.10.0): a gaveta do hotel no módulo de Relatórios.
  order: z.enum(['hotel_number', 'hotel_check_in', 'amount_desc']).optional(),
  cursor: cursor.optional(),
  limit: limit.optional(),
});

export const reservationKeySchema = z.strictObject({
  hotelCode: shortText,
  reservationNumber: shortText,
});

/** Situações detalhadas que a pessoa pode ter visto (o servidor confere o valor, specs/008). */
const detailedSituation = z.string().trim().min(1).max(50);

export const markNoChargeInputSchema = z.strictObject({
  key: reservationKeySchema,
  expectedSituation: detailedSituation,
  // Observação opcional, até 500 caracteres (FR-019); vazia vira "sem observação".
  note: z.string().trim().max(500).optional(),
});

export const undoNoChargeInputSchema = z.strictObject({
  key: reservationKeySchema,
  markId: uuid,
});

export const evidenceSaveInputSchema = z.strictObject({
  evidenceId: uuid,
  file: z.enum(['screenshot', 'html', 'response']),
  label: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, 'só letras, números, - e _')
    .optional(),
});

// ---------------------------------------------------------------------------
// Tratativas manuais (specs/003, contracts/ipc.md)
// ---------------------------------------------------------------------------

const treatmentKind = z.enum(['request', 'proof']);
const treatmentReservations = z
  .array(reservationKeySchema)
  .min(1)
  .max(MAX_TREATMENT_RESERVATIONS, `no máximo ${MAX_TREATMENT_RESERVATIONS} reservas`);

export const pickFileInputSchema = z.strictObject({ kind: treatmentKind });

/** Id que o processo principal deu ao arquivo escolhido. */
export const selectionIdSchema = uuid;

export const documentIdSchema = uuid;

export const treatmentCheckInputSchema = z.strictObject({
  kind: treatmentKind,
  reservations: treatmentReservations,
});

// A interface não informa nome nem conteúdo do arquivo: o principal usa o que leu do disco.
export const treatmentApplyInputSchema = z.strictObject({
  selectionId: selectionIdSchema,
  kind: treatmentKind,
  reservations: treatmentReservations,
});

export const manualAmountInputSchema = z.strictObject({
  hotelCode: shortText,
  reservationNumber: shortText,
  amount: z
    .string()
    .regex(/^[0-9]+\.[0-9]{2}$/, 'valor no formato 1234.56')
    .refine((value) => Number(value) > 0, 'o valor deve ser maior que zero'),
});

// ---------------------------------------------------------------------------
// Envio ao Comercial pela planilha (specs/005, contracts/ipc.md)
// ---------------------------------------------------------------------------

const commercialReservations = z
  .array(reservationKeySchema)
  .min(1)
  .max(MAX_COMMERCIAL_RESERVATIONS, `no máximo ${MAX_COMMERCIAL_RESERVATIONS} reservas`);

/** Envio, conferência e confirmações em lote: de 1 a 2 000 reservas. */
export const reservationsInputSchema = z.strictObject({ reservations: commercialReservations });

/** Confirmação em lote dos retornos, com as "Cancelada" quando pedido (homologação, R-19). */
export const confirmReturnsInputSchema = z.strictObject({
  reservations: commercialReservations,
  includeCancellations: z.boolean().optional(),
});

export const dispatchIdSchema = uuid;
export const returnIdSchema = uuid;

export const dispatchListInputSchema = z.strictObject({
  active: z.boolean().optional(),
  purpose: z.enum(['send', 'hunit_check', 'all']).optional(),
  cursor: cursor.optional(),
  limit: limit.optional(),
});

export const dispatchTokenInputSchema = z.strictObject({
  dispatchId: uuid,
  token: z.string().regex(/^[0-9]{4,10}$/, 'o token tem de 4 a 10 dígitos'),
});

export const rejectReturnInputSchema = z.strictObject({
  returnId: uuid,
  reason: z.string().trim().min(1, 'informe o motivo').max(500),
});

export const rejectCancellationInputSchema = z.strictObject({
  key: reservationKeySchema,
  reason: z.string().trim().min(1, 'informe o motivo').max(500),
});

/** Filtros de "selecionar todas do filtro" e da cópia: os da lista, sem paginação. */
export const reservationFiltersSchema = reservationListInputSchema.omit({
  cursor: true,
  limit: true,
});

/** Filtros das contagens dos filtros rápidos (specs/006): sem paginação, filtro rápido e ordem. */
export const reservationCountFiltersSchema = reservationListInputSchema.omit({
  cursor: true,
  limit: true,
  quickFilter: true,
  order: true,
});

const money = z.string().regex(/^-?[0-9]+\.[0-9]{2}$/, 'valor no formato 1234.56');

/** Uma linha da cópia: só as colunas de FR-027. Qualquer campo a mais (ex.: o hóspede) é recusado. */
export const copyRowSchema = z.strictObject({
  hotelName: z.string().min(1).max(200),
  reservationNumber: shortText,
  checkIn: isoDate.nullable(),
  channel: z.string().max(200).nullable(),
  totalAmount: money.nullable(),
  // Os nomes vêm do contrato; um valor desconhecido é recusado pela tabela da cópia.
  classification: z.string().min(1).max(64),
  reservationStatus: z.string().min(1).max(64),
  detailedSituation: z.string().min(1).max(64),
});

export const copyReservationsInputSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('selection'),
    rows: z
      .array(copyRowSchema)
      .min(1)
      .max(MAX_COMMERCIAL_RESERVATIONS, `no máximo ${MAX_COMMERCIAL_RESERVATIONS} reservas`),
  }),
  z.strictObject({
    source: z.literal('filter'),
    filters: reservationFiltersSchema,
    description: z.string().max(500).optional(),
  }),
]);
