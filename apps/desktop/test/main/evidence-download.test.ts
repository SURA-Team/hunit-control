/**
 * Download de evidências (specs/002, T065, FR-024): o principal baixa com a chave, abre "Salvar
 * como" com um nome padrão e grava onde o operador escolher. O conteúdo nunca vai para a interface.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/main/api-client.js';
import { saveEvidence, type SaveDialog } from '../../src/main/evidence-download.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { sendProblem, startHttpsServer, type TestHttpsServer } from '../helpers/https-server.js';

const ID = '44444444-4444-4444-8444-444444444444';
const API_KEY = 'hunit_chave-evidencia';

let certificates: TestCertificates;
let server: TestHttpsServer;
let api: ApiClient;
let dir: string;

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startHttpsServer(certificates.server);
  api = new ApiClient({
    serverUrl: server.url,
    caCertificatePem: certificates.authority.certificatePem,
    apiKey: API_KEY,
  });
  dir = await mkdtemp(path.join(tmpdir(), 'hunit-evidence-download-'));
});

afterEach(() => {
  server.reset();
});

afterAll(async () => {
  await api.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

function serveScreenshot() {
  server.on('GET', `/v1/evidence/${ID}/screenshot`, (_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  });
}

describe('saveEvidence', () => {
  it('baixa com a chave, sugere o nome padrão e grava onde o operador escolheu', async () => {
    serveScreenshot();
    const target = path.join(dir, 'escolhido.png');
    const showSaveDialog = vi.fn<SaveDialog>(() =>
      Promise.resolve({ canceled: false, filePath: target }),
    );

    const result = await saveEvidence({
      api,
      evidenceId: ID,
      file: 'screenshot',
      label: '31',
      showSaveDialog,
      defaultDirectory: dir,
    });

    expect(result).toEqual({ ok: true, data: { savedTo: target } });
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: path.join(dir, `evidencia-31-${ID}.png`) }),
    );
    expect([...(await readFile(target))]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  });

  it.each([
    ['html', 'html', 'text/html'],
    ['response', 'json', 'application/json'],
  ] as const)('arquivo %s → extensão .%s', async (file, extension, type) => {
    server.on('GET', `/v1/evidence/${ID}/${file}`, (_request, response) => {
      response.writeHead(200, { 'content-type': type });
      response.end('conteúdo');
    });
    const showSaveDialog = vi.fn<SaveDialog>(() => Promise.resolve({ canceled: true }));

    await saveEvidence({ api, evidenceId: ID, file, showSaveDialog, defaultDirectory: dir });

    expect(showSaveDialog.mock.calls[0]?.[0].defaultPath).toBe(
      path.join(dir, `evidencia-execucao-${ID}.${extension}`),
    );
  });

  it('cancelado → null, sem gravar nada', async () => {
    serveScreenshot();

    const result = await saveEvidence({
      api,
      evidenceId: ID,
      file: 'screenshot',
      showSaveDialog: () => Promise.resolve({ canceled: true }),
      defaultDirectory: dir,
    });

    expect(result).toEqual({ ok: true, data: null });
  });

  it('evidência vencida → evidence_expired, sem abrir o diálogo', async () => {
    server.on('GET', `/v1/evidence/${ID}/screenshot`, (_request, response) =>
      sendProblem(response, 410, 'evidence_expired', 'A evidência passou do prazo.'),
    );
    const showSaveDialog = vi.fn<SaveDialog>();

    const result = await saveEvidence({
      api,
      evidenceId: ID,
      file: 'screenshot',
      showSaveDialog,
      defaultDirectory: dir,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'evidence_expired' } });
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('o resultado nunca leva o conteúdo do arquivo', async () => {
    serveScreenshot();

    const result = await saveEvidence({
      api,
      evidenceId: ID,
      file: 'screenshot',
      showSaveDialog: () => Promise.resolve({ canceled: false, filePath: path.join(dir, 'x.png') }),
      defaultDirectory: dir,
    });

    expect(Object.keys(result.ok ? (result.data ?? {}) : {})).toEqual(['savedTo']);
  });
});
