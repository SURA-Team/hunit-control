/**
 * Tela de configuração (specs/002, T032, FR-001 a FR-004, FR-006, FR-025, research R-03 e R-07):
 * endereço, certificado raiz e chave; testar antes de salvar; preferências; "Testar aviso". Da 008
 * (US1, telas 1.1 a 1.3): o card do aviso com a chave do som e o volume, gravados na hora, e a
 * amostra só com o som ligado; "Preferências" sem a chave do som.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playAlertSound } from '../../src/renderer/src/sound';
import { SetupScreen } from '../../src/renderer/src/screens/setup/SetupScreen';
import type { PublicConfig } from '../../src/shared/ipc-types';
import { expectOnePrimaryPerBlock } from './hierarchy';
import { errorResult, fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';

vi.mock('../../src/renderer/src/sound', () => ({ playAlertSound: vi.fn() }));

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
  preferences: { soundEnabled: true, soundVolume: 100, idleHours: 8 },
};

let hunit: FakeHunit;

beforeEach(() => {
  vi.mocked(playAlertSound).mockClear();
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

  it('salva o prazo de inatividade; "Preferências" não tem mais a chave do som (FR-004)', async () => {
    renderWithApp(<SetupScreen />, hunit);
    const user = userEvent.setup();
    const idle = await screen.findByLabelText(/prazo de inatividade/i);
    const preferences = idle.closest('[data-block="Preferências"]') as HTMLElement;
    expect(within(preferences).queryByRole('switch')).not.toBeInTheDocument();

    await user.clear(idle);
    await user.type(idle, '12');
    await user.click(screen.getByRole('button', { name: /salvar preferências/i }));

    await waitFor(() => expect(hunit.api.preferences.set).toHaveBeenCalledWith({ idleHours: 12 }));
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

describe('SetupScreen — card "Aviso do pedido de token" (specs/008, US1)', () => {
  function card() {
    return screen
      .getByRole('heading', { name: 'Aviso do pedido de token' })
      .closest('[data-block="Aviso do pedido de token"]') as HTMLElement;
  }

  it('som ligado (tela 1.3): chave ligada, volume ativo, a nota do som único e "Testar aviso"', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() =>
      okResult({ ...CONFIG, preferences: { soundEnabled: true, soundVolume: 70, idleHours: 8 } }),
    );
    renderWithApp(<SetupScreen />, hunit);

    const toggle = await screen.findByRole('switch', { name: /^Tocar som do aviso/ });
    expect(toggle).toBeChecked();
    expect(screen.getByText('Desligue para deixar o aviso sem som (mudo).')).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: 'Volume do aviso' });
    expect(slider).toHaveAttribute('aria-valuenow', '70');
    expect(slider).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(card()).getByText(/toca um único som/i)).toBeInTheDocument();
    expect(within(card()).getByText(/Toca um som só: o do app/)).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: /testar aviso/i })).toBeInTheDocument();
  });

  it('som desligado (tela 1.2): o volume fica desabilitado', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() =>
      okResult({ ...CONFIG, preferences: { soundEnabled: false, soundVolume: 100, idleHours: 8 } }),
    );
    renderWithApp(<SetupScreen />, hunit);

    expect(await screen.findByRole('switch', { name: /^Tocar som do aviso/ })).not.toBeChecked();
    expect(screen.getByRole('slider', { name: 'Volume do aviso' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('primeiro uso (telas 1.1 e 1.2): som ligado a 100 % e já dá para desligar antes de salvar a conexão', async () => {
    const user = userEvent.setup();
    renderWithApp(<SetupScreen />, hunit);

    const toggle = await screen.findByRole('switch', { name: /^Tocar som do aviso/ });
    expect(toggle).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Volume do aviso' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    await user.click(toggle);
    await waitFor(() =>
      expect(hunit.api.preferences.set).toHaveBeenCalledWith({ soundEnabled: false }),
    );
    expect(screen.getByRole('button', { name: /testar aviso/i })).toBeEnabled();
  });

  it('a chave grava na hora, sem botão, e não toca amostra (FR-006)', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
    const user = userEvent.setup();
    renderWithApp(<SetupScreen />, hunit);

    await user.click(await screen.findByRole('switch', { name: /^Tocar som do aviso/ }));

    await waitFor(() =>
      expect(hunit.api.preferences.set).toHaveBeenCalledWith({ soundEnabled: false }),
    );
    expect(screen.getByRole('slider', { name: 'Volume do aviso' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(playAlertSound).not.toHaveBeenCalled();
  });

  it('ao soltar o volume com o som ligado, grava e toca a amostra no volume escolhido', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
    const user = userEvent.setup();
    renderWithApp(<SetupScreen />, hunit);

    const slider = await screen.findByRole('slider', { name: 'Volume do aviso' });
    slider.focus();
    await user.keyboard('{PageDown}');

    await waitFor(() =>
      expect(hunit.api.preferences.set).toHaveBeenCalledWith({ soundVolume: 90 }),
    );
    expect(playAlertSound).toHaveBeenCalledWith(90);
    expect(screen.getByText('90 %')).toBeInTheDocument();
  });

  it('volume 0 é aceito e a chave continua ligada (edge case)', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
    const user = userEvent.setup();
    renderWithApp(<SetupScreen />, hunit);

    const slider = await screen.findByRole('slider', { name: 'Volume do aviso' });
    slider.focus();
    await user.keyboard('{Home}');

    await waitFor(() => expect(hunit.api.preferences.set).toHaveBeenCalledWith({ soundVolume: 0 }));
    expect(screen.getByRole('switch', { name: /^Tocar som do aviso/ })).toBeChecked();
  });

  it('falha ao gravar aparece no card', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
    mocked(hunit.api.preferences.set).mockImplementation(() => errorResult('offline'));
    const user = userEvent.setup();
    renderWithApp(<SetupScreen />, hunit);

    await user.click(await screen.findByRole('switch', { name: /^Tocar som do aviso/ }));

    expect(await within(card()).findByText(/servidor indisponível/i)).toBeInTheDocument();
  });
});

describe('SetupScreen — visual novo (specs/006, T019)', () => {
  it('uma ação principal por card; "Remover" em vermelho suave e "Sim, remover" em vermelho (FR-007, FR-009)', async () => {
    mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
    const user = userEvent.setup();
    renderWithApp(<SetupScreen />, hunit);

    const remove = await screen.findByRole('button', {
      name: /remover a configuração desta máquina/i,
    });
    expect(remove).toHaveAttribute('data-variant', 'danger-light');
    expect(screen.getByRole('button', { name: /^salvar conexão$/i })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(screen.getByRole('button', { name: /testar conexão/i })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    expectOnePrimaryPerBlock();

    await user.click(remove);
    expect(await screen.findByRole('button', { name: /sim, remover/i })).toHaveAttribute(
      'data-variant',
      'danger',
    );
    expectOnePrimaryPerBlock();
  });
});
