/**
 * Servidor de identidade não confirmada (specs/002, T074, FR-002, SC-007): certificado de outra
 * autoridade ou de outro nome é recusado no "Testar conexão", sem opção de continuar e sem salvar.
 */
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import { launchApp, stubOpenDialog, type LaunchedApp } from './app-fixture.js';

let certificates: TestCertificates;
let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startE2eServer();
  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp();
  const certificateFile = path.join(launched.userDataDir, 'hunit-raiz.crt');
  await writeFile(certificateFile, certificates.authority.certificatePem);
  await stubOpenDialog(launched.app, certificateFile);
});

afterAll(async () => {
  await launched?.close();
  await tls?.close();
  await server?.close();
});

describe('servidor não confirmado (SC-007)', () => {
  it.each([
    ['de outra autoridade', 'strange'],
    ['emitido para outro nome', 'otherName'],
  ] as const)('certificado %s: recusa, sem continuar e sem salvar', async (_caso, which) => {
    const { window, userDataDir } = launched;
    tls.useCertificate(certificates[which]);

    await window.getByLabel('Endereço do servidor').fill(tls.url);
    await window.getByRole('button', { name: /escolher certificado/i }).click();
    await window.getByLabel('Chave de acesso').fill(server.operator.apiKey);
    await window.getByRole('button', { name: 'Testar conexão' }).click();

    await window
      .getByText('Não foi possível confirmar a identidade do servidor', { exact: false })
      .first()
      .waitFor({ timeout: 15_000 });
    expect(await window.getByRole('button', { name: /continuar|ignorar/i }).count()).toBe(0);
    expect(await window.getByRole('button', { name: 'Salvar conexão' }).isDisabled()).toBe(true);
    await expect(access(path.join(userDataDir, 'config.json'))).rejects.toThrow();
  });
});
