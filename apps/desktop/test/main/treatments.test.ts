/**
 * Canais das tratativas no processo principal (specs/003, T024 e T043; contracts/ipc.md): o
 * arquivo é enviado uma vez, o lote vai em partes de 200 com resultado único, a memória é
 * liberada quando tudo foi processado e mantida quando a conexão cai, e a interface nunca recebe
 * o conteúdo dos arquivos.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickedFileEntry } from '../../src/main/picked-files.js';
import {
  createTreatmentHandlers,
  RESERVATIONS_PER_REQUEST,
  safeFileName,
  type TreatmentServices,
} from '../../src/main/treatments.js';
import { INVOKE } from '../../src/shared/ipc-channels.js';
import type {
  AppError,
  ReservationKey,
  ReservationOutcome,
  Result,
  TreatmentApplyResult,
  TreatmentCheck,
} from '../../src/shared/ipc-types.js';

const SELECTION = '33333333-3333-4333-8333-333333333333';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';
const FILE_ID = 'a'.repeat(64);
const OFFLINE: AppError = { code: 'offline', detail: 'O servidor não respondeu.' };

const ok = <T>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });
const fail = (error: AppError): Promise<Result<never>> => Promise.resolve({ ok: false, error });

const keys = (count: number): ReservationKey[] =>
  Array.from({ length: count }, (_unused, index) => ({
    hotelCode: '31',
    reservationNumber: `R${String(index + 1).padStart(4, '0')}`,
  }));

const outcomeOf = (key: ReservationKey, outcome: ReservationOutcome['outcome'] = 'registered') => ({
  ...key,
  outcome,
  reason: null,
  classification: 'virtual_card_pending_charge' as const,
  totalAmount: '10.00',
  documentId: null,
});

function setup() {
  const entry: PickedFileEntry = {
    selectionId: SELECTION,
    fileName: 'comprovante.pdf',
    bytes: Buffer.from('%PDF-1.7 teste'),
    sizeBytes: 14,
    mediaType: 'application/pdf',
  };
  const stored = new Map<string, PickedFileEntry>([[SELECTION, entry]]);
  const files = {
    pick: vi.fn(() => ok<PickedFileEntry | null>(entry)),
    get: vi.fn((selectionId: string) => stored.get(selectionId) ?? null),
    discard: vi.fn((selectionId: string) => void stored.delete(selectionId)),
  };
  const api = {
    uploadTreatmentFile: vi.fn(() =>
      ok({ fileId: FILE_ID, sizeBytes: 14, mediaType: 'application/pdf' }),
    ),
    checkTreatmentDocuments: vi.fn(
      (body: { reservations: ReservationKey[] }): Promise<Result<TreatmentCheck>> =>
        ok({
          items: body.reservations.map((key) => outcomeOf(key)),
          acceptedCount: body.reservations.length,
          replacingCount: 1,
          ignoredCount: 0,
          acceptedTotalAmount: '0.35',
        }),
    ),
    registerTreatmentDocuments: vi.fn(
      (body: {
        fileId: string;
        fileName: string;
        reservations: ReservationKey[];
      }): Promise<Result<{ batchId: string; items: ReservationOutcome[] }>> =>
        ok({ batchId: 'b', items: body.reservations.map((key) => outcomeOf(key)) }),
    ),
    removeTreatmentDocument: vi.fn(() => ok(undefined)),
    revertTreatmentDocument: vi.fn(() => fail({ code: 'document_not_revertible' })),
    getReservationTreatment: vi.fn(() => fail({ code: 'not_found' })),
    setManualChargedAmount: vi.fn(() => fail({ code: 'proof_required' })),
    clearManualChargedAmount: vi.fn(() => fail({ code: 'not_found' })),
    downloadTreatmentDocument: vi.fn(() =>
      ok({ content: Buffer.from('conteudo do documento'), fileName: 'Comprovante: nº 1?.pdf' }),
    ),
  };
  const reportFailure = vi.fn();
  const showSaveDialog = vi.fn<TreatmentServices['showSaveDialog']>(() =>
    Promise.resolve({ canceled: true }),
  );
  const buildPreview = vi.fn<TreatmentServices['buildPreview']>(() =>
    Promise.resolve({ type: 'unavailable', reason: 'unreadable' }),
  );
  const services: TreatmentServices = {
    getApi: () => api,
    reportFailure,
    files,
    buildPreview,
    showSaveDialog,
    defaultDirectory: 'C:\\Downloads',
  };
  const handlers = createTreatmentHandlers(services);
  const invoke = <T>(channel: string, input: unknown) =>
    (handlers as Record<string, (input: unknown) => Promise<Result<T>>>)[channel]?.(input) ??
    Promise.reject(new Error(`canal sem tratador: ${channel}`));
  return { api, files, stored, reportFailure, showSaveDialog, buildPreview, services, invoke };
}

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, veio ${result.error.code}`);
  return result.data;
}

describe('escolher o arquivo', () => {
  it('devolve a pré-visualização e o id, nunca os bytes nem o caminho', async () => {
    const { invoke, buildPreview } = setup();

    const picked = expectOk(await invoke(INVOKE.treatmentsPickFile, { kind: 'proof' }));

    expect(picked).toEqual({
      selectionId: SELECTION,
      fileName: 'comprovante.pdf',
      sizeBytes: 14,
      mediaType: 'application/pdf',
      preview: { type: 'unavailable', reason: 'unreadable' },
    });
    expect(buildPreview).toHaveBeenCalledTimes(1);
  });

  it('diálogo cancelado devolve nulo; arquivo recusado devolve o erro', async () => {
    const { invoke, files } = setup();

    files.pick.mockImplementationOnce(() => ok(null));
    expect(expectOk(await invoke(INVOKE.treatmentsPickFile, { kind: 'request' }))).toBeNull();

    files.pick.mockImplementationOnce(() => fail({ code: 'file_too_large' }));
    expect(await invoke(INVOKE.treatmentsPickFile, { kind: 'request' })).toEqual({
      ok: false,
      error: { code: 'file_too_large' },
    });
  });

  it('recusa entrada inválida sem abrir o diálogo', async () => {
    const { invoke, files } = setup();

    const result = await invoke(INVOKE.treatmentsPickFile, { kind: 'outro' });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(files.pick).not.toHaveBeenCalled();
  });

  it('descartar libera a memória', async () => {
    const { invoke, files } = setup();

    await invoke(INVOKE.treatmentsDiscardFile, SELECTION);

    expect(files.discard).toHaveBeenCalledWith(SELECTION);
  });
});

describe('conferir (check)', () => {
  it('450 reservas vão em 3 partes de no máximo 200, com um resultado único', async () => {
    const { invoke, api } = setup();

    const check = expectOk<TreatmentCheck>(
      await invoke(INVOKE.treatmentsCheck, { kind: 'proof', reservations: keys(450) }),
    );

    expect(RESERVATIONS_PER_REQUEST).toBe(200);
    expect(
      api.checkTreatmentDocuments.mock.calls.map(([body]) => body.reservations.length),
    ).toEqual([200, 200, 50]);
    expect(check.items).toHaveLength(450);
    expect(check).toMatchObject({
      acceptedCount: 450,
      replacingCount: 3,
      ignoredCount: 0,
      // 0,35 × 3 partes, somados em centavos.
      acceptedTotalAmount: '1.05',
    });
  });

  it('recusa mais de 2 000 reservas e lista vazia, sem chamar o servidor', async () => {
    const { invoke, api } = setup();

    for (const reservations of [keys(2001), []]) {
      const result = await invoke(INVOKE.treatmentsCheck, { kind: 'proof', reservations });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    expect(api.checkTreatmentDocuments).not.toHaveBeenCalled();
  });

  it('erro do servidor é devolvido e avisado ao estado da conexão', async () => {
    const { invoke, api, reportFailure } = setup();
    api.checkTreatmentDocuments.mockImplementationOnce(() => fail(OFFLINE));

    const result = await invoke(INVOKE.treatmentsCheck, { kind: 'proof', reservations: keys(1) });

    expect(result).toEqual({ ok: false, error: OFFLINE });
    expect(reportFailure).toHaveBeenCalledWith(OFFLINE);
  });
});

describe('aplicar (apply)', () => {
  const apply = (
    invoke: <T>(channel: string, input: unknown) => Promise<Result<T>>,
    reservations: ReservationKey[],
  ) =>
    invoke<TreatmentApplyResult>(INVOKE.treatmentsApply, {
      selectionId: SELECTION,
      kind: 'proof',
      reservations,
    });

  it('envia o arquivo uma vez, com o nome lido do disco, e registra em partes de 200', async () => {
    const { invoke, api, stored } = setup();

    const result = expectOk(await apply(invoke, keys(450)));

    expect(api.uploadTreatmentFile).toHaveBeenCalledTimes(1);
    expect(api.uploadTreatmentFile).toHaveBeenCalledWith(
      'comprovante.pdf',
      Buffer.from('%PDF-1.7 teste'),
    );
    expect(
      api.registerTreatmentDocuments.mock.calls.map(([body]) => [
        body.fileId,
        body.fileName,
        body.reservations.length,
      ]),
    ).toEqual([
      [FILE_ID, 'comprovante.pdf', 200],
      [FILE_ID, 'comprovante.pdf', 200],
      [FILE_ID, 'comprovante.pdf', 50],
    ]);
    expect(result.items).toHaveLength(450);
    expect(result).toMatchObject({ failedKeys: [], retryable: false });
    // Tudo processado: a memória do arquivo é liberada.
    expect(stored.has(SELECTION)).toBe(false);
  });

  it('as reservas que falharam voltam em failedKeys; a memória é liberada mesmo assim', async () => {
    const { invoke, api, stored } = setup();
    const [first, second, third] = keys(3) as [ReservationKey, ReservationKey, ReservationKey];
    api.registerTreatmentDocuments.mockImplementationOnce(() =>
      ok({
        batchId: 'b',
        items: [outcomeOf(first), outcomeOf(second, 'failed'), outcomeOf(third, 'ignored')],
      }),
    );

    const result = expectOk(await apply(invoke, [first, second, third]));

    expect(result.failedKeys).toEqual([second]);
    expect(result.retryable).toBe(false);
    expect(stored.has(SELECTION)).toBe(false);
  });

  it('servidor fora do ar no envio: nada registrado, arquivo mantido para tentar de novo', async () => {
    const { invoke, api, stored, reportFailure } = setup();
    api.uploadTreatmentFile.mockImplementationOnce(() => fail(OFFLINE));
    const reservations = keys(3);

    const first = expectOk(await apply(invoke, reservations));

    expect(first).toEqual({ items: [], failedKeys: reservations, retryable: true, error: OFFLINE });
    expect(api.registerTreatmentDocuments).not.toHaveBeenCalled();
    expect(stored.has(SELECTION)).toBe(true);
    expect(reportFailure).toHaveBeenCalledWith(OFFLINE);

    // Nova tentativa com o mesmo id: conclui sem escolher o arquivo de novo.
    const second = expectOk(await apply(invoke, first.failedKeys));
    expect(second).toMatchObject({ failedKeys: [], retryable: false });
    expect(second.items).toHaveLength(3);
    expect(stored.has(SELECTION)).toBe(false);
  });

  it('servidor fora do ar no meio do lote: o que faltou volta para tentar de novo', async () => {
    const { invoke, api, stored } = setup();
    const reservations = keys(450);
    api.registerTreatmentDocuments
      .mockImplementationOnce((body) =>
        ok({ batchId: 'b', items: body.reservations.map((key) => outcomeOf(key)) }),
      )
      .mockImplementationOnce(() => fail(OFFLINE));

    const result = expectOk(await apply(invoke, reservations));

    expect(result.items).toHaveLength(200);
    expect(result.failedKeys).toEqual(reservations.slice(200));
    expect(result).toMatchObject({ retryable: true, error: OFFLINE });
    expect(stored.has(SELECTION)).toBe(true);
  });

  it('arquivo recusado pelo servidor: devolve o erro e libera a memória', async () => {
    const { invoke, api, stored } = setup();
    api.uploadTreatmentFile.mockImplementationOnce(() => fail({ code: 'unsupported_file_type' }));

    const result = await apply(invoke, keys(1));

    expect(result).toEqual({ ok: false, error: { code: 'unsupported_file_type' } });
    expect(stored.has(SELECTION)).toBe(false);
  });

  it('erro do servidor no registro (não é de conexão): não dá para tentar de novo', async () => {
    const { invoke, api, stored } = setup();
    const reservations = keys(2);
    api.registerTreatmentDocuments.mockImplementationOnce(() => fail({ code: 'file_not_found' }));

    const result = expectOk(await apply(invoke, reservations));

    expect(result).toEqual({
      items: [],
      failedKeys: reservations,
      retryable: false,
      error: { code: 'file_not_found' },
    });
    expect(stored.has(SELECTION)).toBe(false);
  });

  it('arquivo que já saiu da memória pede para escolher de novo, sem chamar o servidor', async () => {
    const { invoke, api, stored } = setup();
    stored.clear();

    const result = await apply(invoke, keys(1));

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.uploadTreatmentFile).not.toHaveBeenCalled();
  });

  it('a interface não escolhe o nome do arquivo: campos a mais são recusados', async () => {
    const { invoke, api } = setup();

    const result = await invoke(INVOKE.treatmentsApply, {
      selectionId: SELECTION,
      kind: 'proof',
      reservations: keys(1),
      fileName: 'outro-nome.pdf',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.uploadTreatmentFile).not.toHaveBeenCalled();
  });
});

describe('ações de uma reserva', () => {
  it('repassam o resultado do servidor', async () => {
    const { invoke, api } = setup();
    const key = { hotelCode: '31', reservationNumber: '7001' };

    expect(await invoke(INVOKE.treatmentsRemove, DOCUMENT)).toEqual({ ok: true, data: undefined });
    expect(await invoke(INVOKE.treatmentsRevert, DOCUMENT)).toMatchObject({
      error: { code: 'document_not_revertible' },
    });
    expect(await invoke(INVOKE.treatmentsGet, key)).toMatchObject({ error: { code: 'not_found' } });
    expect(
      await invoke(INVOKE.treatmentsSetManualAmount, { ...key, amount: '500.00' }),
    ).toMatchObject({ error: { code: 'proof_required' } });
    await invoke(INVOKE.treatmentsClearManualAmount, key);

    expect(api.removeTreatmentDocument).toHaveBeenCalledWith(DOCUMENT);
    expect(api.revertTreatmentDocument).toHaveBeenCalledWith(DOCUMENT);
    expect(api.setManualChargedAmount).toHaveBeenCalledWith(key, '500.00');
    expect(api.clearManualChargedAmount).toHaveBeenCalledWith(key);
  });

  it.each([
    ['valor zero', '0.00'],
    ['vírgula', '10,00'],
    ['negativo', '-1.00'],
  ])('recusa valor inválido (%s) sem chamar o servidor', async (_case, amount) => {
    const { invoke, api } = setup();

    const result = await invoke(INVOKE.treatmentsSetManualAmount, {
      hotelCode: '31',
      reservationNumber: '7001',
      amount,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.setManualChargedAmount).not.toHaveBeenCalled();
  });

  it('recusa id de documento que não é UUID', async () => {
    const { invoke, api } = setup();

    expect(await invoke(INVOKE.treatmentsRemove, 'x')).toMatchObject({
      error: { code: 'invalid_input' },
    });
    expect(api.removeTreatmentDocument).not.toHaveBeenCalled();
  });

  it('sem configuração, responde not_configured', async () => {
    const { services } = setup();
    const handlers = createTreatmentHandlers({ ...services, getApi: () => null });

    expect(await handlers[INVOKE.treatmentsRemove]?.(DOCUMENT)).toMatchObject({
      ok: false,
      error: { code: 'not_configured' },
    });
  });
});

describe('salvar o documento', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hunit-save-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sugere o nome original (sem caracteres que o Windows recusa) e grava onde foi escolhido', async () => {
    const { invoke, showSaveDialog } = setup();
    const target = path.join(dir, 'salvo.pdf');
    showSaveDialog.mockImplementationOnce(() =>
      Promise.resolve({ canceled: false, filePath: target }),
    );

    const result = await invoke(INVOKE.treatmentsSaveDocument, DOCUMENT);

    expect(showSaveDialog).toHaveBeenCalledWith({
      title: 'Salvar documento',
      defaultPath: path.join('C:\\Downloads', 'Comprovante_ nº 1_.pdf'),
      filters: [{ name: 'Documento', extensions: ['pdf'] }],
    });
    // A interface recebe só o caminho; o conteúdo vai direto para o disco.
    expect(result).toEqual({ ok: true, data: { savedTo: target } });
    expect((await readFile(target)).toString()).toBe('conteudo do documento');
  });

  it('"Salvar como" cancelado não grava nada', async () => {
    const { invoke } = setup();

    expect(await invoke(INVOKE.treatmentsSaveDocument, DOCUMENT)).toEqual({ ok: true, data: null });
  });

  it('arquivo já apagado no servidor é avisado sem abrir o diálogo', async () => {
    const { invoke, api, showSaveDialog } = setup();
    api.downloadTreatmentDocument.mockImplementationOnce(() => fail({ code: 'document_purged' }));

    const result = await invoke(INVOKE.treatmentsSaveDocument, DOCUMENT);

    expect(result).toMatchObject({ ok: false, error: { code: 'document_purged' } });
    expect(showSaveDialog).not.toHaveBeenCalled();
  });
});

describe('safeFileName', () => {
  it.each([
    ['comprovante.pdf', 'comprovante.pdf'],
    ['a<b>c:d"e/f\\g|h?i*.pdf', 'a_b_c_d_e_f_g_h_i_.pdf'],
    ['termina em ponto. ', 'termina em ponto'],
    ['...', 'documento'],
  ])('%s → %s', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
});
