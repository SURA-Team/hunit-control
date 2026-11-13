/**
 * Tela de configuração (specs/002, T032, FR-001 a FR-004, FR-006, FR-025, research R-03 e R-07):
 * endereço, certificado raiz e chave; testar antes de salvar; preferências; "Testar aviso".
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SetupScreen } from '../../src/renderer/src/screens/setup/SetupScreen';
import type { PublicConfig } from '../../src/shared/ipc-types';
import { errorResult, fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';

const PEM = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
const CERTIFICATE = {
  fingerprint256: 'AB:CD:EF:01',
  subject: 'CN=Caddy Local Authority - 2026 ECC Root',
  issuer: 'CN=Caddy Local Authority - 2026 ECC Root',
  validTo: '2036-11-10T00:00:00.000Z',
  isCertificateAuthority: true,
};
const CONFIG: PublicConfig = {
  serverUrl: 'https://192.168.0.50',
  certificatePem: PEM,
  certificate: CERTIFICATE,
  hasApiKey: true,
  preferences: { soundEnabled: true, idleHours: 8 },
};

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit({ status: 'not_configured', client: null, checkedAt: '2026-11-12T12:00:00Z' });
  mocked(hunit.api.connection.pickCertificate).mockImplementation(() =>
    okResult({ pem: PEM, info: CERTIFICATE }),
  );
});

async function fillConnection() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/endereço do servidor/i), 'https://192.168.0.50');
  await user.click(screen.getByRole('button', { name: /escolher certificado/i }));
  await user.type(screen.getByLabelText(/chave de acesso/i), 'hunit_chave-de-teste');
  return user;
}

describe('SetupScreen — conexão', () => {
  it('escolher o certificado mostra impressão digital, emissor e validade', async () => {
    renderWithApp(<SetupScreen />, hunit);

    await userEvent.click(await screen.findByRole('button', { name: /escolher certificado/i }));

    expect(await screen.findByText('AB:CD:EF:01')).toBeInTheDocument();
    expect(screen.getByText(/Caddy Local Authority/)).toBeInTheDocument();
    expect(screen.getByText(/10\/11\/2036|09\/11\/2036/)).toBeInTheDocument();
  });

  it('"Testar conexão" mostra o cliente e o perfil; só então "Salvar" habilita', async () => {
    mocked(hunit.api.connection.test).mockImplementation(() =>
      okResult({ name: 'desktop-financeiro', role: 'operator' as const }),
    );
    mocked(hunit.api.connection.save).mockImplementation(() => okResult(CONFIG));
    renderWithApp(<SetupScreen />, hunit);
    await screen.findByLabelText(/endereço do servidor/i);
    const user = await fillConnection();

    const save = screen.getByRole('button', { name: /^salvar conexão$/i });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /testar conexão/i }));

    expect(await screen.findByText(/desktop-financeiro/)).toBeInTheDocument();
    expect(screen.getByText(/operador/i)).toBeInTheDocument();
    expect(hunit.api.connection.test).toHaveBeenCalledWith({
      serverUrl: 'https://192.168.0.50',
      certificatePem: PEM,
      apiKey: 'hunit_chave-de-teste',
    });
    await waitFor(() => expect(save).toBeEnabled());

    await user.click(save);
    await waitFor(() =>
      expect(hunit.api.connection.save).toHaveBeenCalledWith({
        serverUrl: 'https://192.168.0.50',
        certificatePem: PEM,
        apiKey: 'hunit_chave-de-teste',
      }),
    );
  });

  it('mudar um campo depois do teste exige testar de novo', async () => {
    renderWithApp(<SetupScreen />, hunit);
    await screen.findByLabelText(/endereço do servidor/i);
    const user = await fillConnection();
    await user.click(screen.getByRole('button', { name: /testar conexão/i }));
    const save = screen.getByRole('button', { name: /^salvar conexão$/i });
    await waitFor(() => expect(save).toBeEnabled());

    await user.type(screen.getByLabelText(/endereço do servidor/i), '1');

    expect(save).toBeDisabled();
  });

  it('servidor não confirmado: explica, sem botão de continuar (FR-002)', async () => {
    mocked(hunit.api.connection.test).mockImplementation(() => errorResult('untrusted_server'));
    renderWithApp(<SetupScreen />, hunit);
    await screen.findByLabelText(/endereço do servidor/i);
    const user = await fillConnection();

    await user.click(screen.getByRole('button', { name: /testar conexão/i }));

    expect(
      await screen.findByText(/não foi possível confirmar a identidade do servidor/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continuar|ignorar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^salvar conexão$/i })).toBeDisabled();
  });

  it('já configurado: mostra o endereço e o certificado guardados e que a chave está guardada', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
    renderWithApp(<SetupScreen />, hunit);

    expect(await screen.findByDisplayValue('https://192.168.0.50')).toBeInTheDocument();
    expect(screen.getByText('AB:CD:EF:01')).toBeInTheDocument();
    expect(screen.getByText(/chave guardada/i)).toBeInTheDocument();
  });

  it('remover a configuração pede confirmação e apaga (FR-003)', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
    renderWithApp(<SetupScreen />, hunit);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /remover a configuração/i }));
    expect(hunit.api.connection.remove).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /sim, remover/i }));

    await waitFor(() => expect(hunit.api.connection.remove).toHaveBeenCalled());
  });

  it('sem configuração, não oferece remover', async () => {
    renderWithApp(<SetupScreen />, hunit);
    await screen.findByLabelText(/endereço do servidor/i);

    expect(
      screen.queryByRole('button', { name: /remover a configuração/i }),
    ).not.toBeInTheDocument();
  });

  it('mostra a versão do app (FR-025)', async () => {
    renderWithApp(<SetupScreen />, hunit);

    expect(await screen.findByText(/versão 0\.1\.0/i)).toBeInTheDocument();
  });
});

describe('SetupScreen — preferências e aviso', () => {
  beforeEach(() => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
  });

  it('salva o prazo de inatividade e o som', async () => {
    renderWithApp(<SetupScreen />, hunit);
    const user = userEvent.setup();
    const idle = await screen.findByLabelText(/prazo de inatividade/i);

    await user.clear(idle);
    await user.type(idle, '12');
    await user.click(screen.getByLabelText(/som do aviso/i));
    await user.click(screen.getByRole('button', { name: /salvar preferências/i }));

    await waitFor(() =>
      expect(hunit.api.preferences.set).toHaveBeenCalledWith({
        idleHours: 12,
        soundEnabled: false,
      }),
    );
  });

  it('recusa prazo fora de 1 a 24 horas', async () => {
    renderWithApp(<SetupScreen />, hunit);
    const user = userEvent.setup();
    const idle = await screen.findByLabelText(/prazo de inatividade/i);

    await user.clear(idle);
    await user.type(idle, '30');
    await user.click(screen.getByRole('button', { name: /salvar preferências/i }));

    expect(await screen.findByText(/de 1 a 24 horas/i)).toBeInTheDocument();
    expect(hunit.api.preferences.set).not.toHaveBeenCalled();
  });

  it('"Testar aviso" dispara o aviso completo', async () => {
    renderWithApp(<SetupScreen />, hunit);

    await userEvent.click(await screen.findByRole('button', { name: /testar aviso/i }));

    expect(hunit.api.attention.test).toHaveBeenCalled();
  });
});
