/**
 * Auxiliares dos testes das tratativas (specs/003): arquivos montados aqui, sem dados reais, e
 * atalhos para as chamadas mais repetidas da API.
 */
import type { LightMyRequestResponse } from 'fastify';
import type { TestApp, TestClient } from './app.js';

export const text = (value: string): Buffer => Buffer.from(value, 'utf8');

/** PDF mínimo; `marker` muda o conteúdo (e o `fileId`). */
export const pdfFile = (marker = 'a'): Buffer => text(`%PDF-1.7\n% teste ${marker}\n%%EOF\n`);

export const pngFile = (marker = 'a'): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), text(marker)]);

export const emlFile = (marker = 'a'): Buffer =>
  text(
    'From: financeiro@exemplo.test\r\nTo: comercial@exemplo.test\r\n' +
      `Subject: Pedido de cobranca ${marker}\r\nDate: Fri, 13 Nov 2026 10:00:00 -0300\r\n\r\n` +
      'Segue o pedido de cobranca.\r\n',
  );

/** Executável (cabeçalho "MZ") para os testes de arquivo renomeado. */
export const executableFile = (): Buffer =>
  Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(60, 0x20)]);

export interface UploadedFile {
  fileId: string;
  sizeBytes: number;
  mediaType: string;
}

export function uploadFile(
  test: TestApp,
  client: TestClient,
  name: string,
  content: Buffer,
): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'POST',
    url: `/v1/treatment-files?name=${encodeURIComponent(name)}`,
    headers: { ...client.headers, 'content-type': 'application/octet-stream' },
    payload: content,
  });
}

/** Envia o arquivo e devolve o `fileId`; falha se o envio não for aceito. */
export async function uploadedFile(
  test: TestApp,
  client: TestClient,
  name: string,
  content: Buffer,
): Promise<UploadedFile> {
  const response = await uploadFile(test, client, name, content);
  if (response.statusCode !== 201) {
    throw new Error(`Envio recusado (${response.statusCode}): ${response.body}`);
  }
  return response.json();
}

export interface ReservationKey {
  hotelCode: string;
  reservationNumber: string;
}

export interface OutcomeBody extends ReservationKey {
  outcome: 'registered' | 'replaced' | 'ignored' | 'failed';
  reason: 'not_found' | 'not_eligible' | 'same_file' | null;
  classification: string | null;
  totalAmount: string | null;
  documentId: string | null;
}

export function registerDocuments(
  test: TestApp,
  client: TestClient,
  body: {
    kind: 'request' | 'proof';
    fileId: string;
    fileName: string;
    reservations: ReservationKey[];
  },
): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'POST',
    url: '/v1/treatment-documents',
    headers: client.headers,
    payload: body,
  });
}

/** Envia o arquivo e registra numa reserva; devolve o desfecho dela. */
export async function attach(
  test: TestApp,
  client: TestClient,
  key: ReservationKey,
  kind: 'request' | 'proof',
  name: string,
  content: Buffer,
): Promise<OutcomeBody> {
  const file = await uploadedFile(test, client, name, content);
  const response = await registerDocuments(test, client, {
    kind,
    fileId: file.fileId,
    fileName: name,
    reservations: [key],
  });
  if (response.statusCode !== 200) {
    throw new Error(`Registro recusado (${response.statusCode}): ${response.body}`);
  }
  const [outcome] = response.json<{ items: OutcomeBody[] }>().items;
  if (!outcome) throw new Error('O registro não devolveu o desfecho da reserva.');
  return outcome;
}

export interface DocumentBody {
  id: string;
  kind: 'request' | 'proof';
  state: 'current' | 'replaced' | 'removed' | 'purged';
  fileName: string | null;
  sizeBytes: number;
  mediaType: string;
  attachedAt: string;
  attachedBy: string;
  endedAt: string | null;
  endedBy: string | null;
  revertibleUntil: string | null;
}

export interface TreatmentBody {
  status: 'none' | 'sent' | 'charged';
  situation: string;
  needsReview: boolean;
  request: DocumentBody | null;
  proof: DocumentBody | null;
  manualChargedAmount: string | null;
  effectiveChargedAmount: string | null;
  acceptsDocuments: boolean;
}

export interface EventBody {
  id: number;
  type: string;
  kind: 'request' | 'proof' | null;
  documentId: string | null;
  previousDocumentId: string | null;
  amount: string | null;
  classification: string | null;
  batchId: string | null;
  client: string;
  at: string;
}

export interface TreatmentDetailBody {
  treatment: TreatmentBody;
  documents: DocumentBody[];
  events: EventBody[];
}

export function reservationPath(key: ReservationKey): string {
  return `/v1/reservations/${encodeURIComponent(key.hotelCode)}/${encodeURIComponent(key.reservationNumber)}`;
}

export function getTreatment(
  test: TestApp,
  client: TestClient,
  key: ReservationKey,
): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'GET',
    url: `${reservationPath(key)}/treatment`,
    headers: client.headers,
  });
}

export async function treatmentDetail(
  test: TestApp,
  client: TestClient,
  key: ReservationKey,
): Promise<TreatmentDetailBody> {
  const response = await getTreatment(test, client, key);
  if (response.statusCode !== 200) {
    throw new Error(`Tratativa não devolvida (${response.statusCode}): ${response.body}`);
  }
  return response.json();
}
