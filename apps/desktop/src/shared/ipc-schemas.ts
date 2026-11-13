/**
 * Validação de toda entrada que chega da interface (specs/002, research R-02, contracts/ipc.md).
 * O processo principal confere cada pedido com estes esquemas antes de fazer qualquer coisa;
 * entrada inválida vira `invalid_input`, sem chamar a API nem tocar no disco.
 */
import { z } from 'zod';

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

export const preferencesInputSchema = z.strictObject({
  soundEnabled: z.boolean().optional(),
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
  cursor: cursor.optional(),
  limit: limit.optional(),
});

export const reservationKeySchema = z.strictObject({
  hotelCode: shortText,
  reservationNumber: shortText,
});

export const evidenceSaveInputSchema = z.strictObject({
  evidenceId: uuid,
  file: z.enum(['screenshot', 'html', 'response']),
  label: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, 'só letras, números, - e _')
    .optional(),
});
