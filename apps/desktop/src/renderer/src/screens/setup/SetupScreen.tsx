/**
 * Configuração da máquina (specs/002, FR-001 a FR-004, FR-025, research R-03 e R-07): endereço do
 * servidor, certificado raiz (o operador confere a impressão digital) e chave de acesso. A conexão
 * é testada antes de salvar; um teste só vale para os dados com que foi feito.
 *
 * Desde a 006 (T019; telas 1.1 a 1.3): cards de 760 px com os componentes de ui/, "Limpar" e
 * "Remover" em vermelho suave e "Sim, remover" em vermelho cheio (FR-009).
 */
import { Divider, Group, Loader, Stack, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  ClientIdentity,
  PickedCertificate,
  Preferences,
  PreferencesInput,
  PublicConfig,
} from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate } from '../../presentation/format';
import { playAlertSound } from '../../sound';
import {
  Action,
  AppDialog,
  InfoIcon,
  Card,
  CodeText,
  Field,
  Notice,
  PageHeader,
  PasswordField,
  SectionTitle,
  SwitchField,
  VolumeField,
} from '../../ui';
import { PreferencesForm, updateSavedPreferences } from './PreferencesForm';

const ROLE_NAMES: Record<ClientIdentity['role'], string> = {
  operator: 'Operador',
  reader: 'Consulta',
};

export function SetupScreen() {
  const hunit = useHunit();
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => unwrap(hunit.connection.getConfig()),
  });
  const info = useQuery({ queryKey: ['app-info'], queryFn: () => unwrap(hunit.app.info()) });

  return (
    <Stack gap={16} maw={760}>
      <PageHeader title="Configuração" />
      {config.isPending ? (
        <Loader size="sm" />
      ) : (
        // Recriado quando a configuração salva muda: o formulário começa com o que está guardado.
        <ConnectionForm
          key={
            config.data
              ? `${config.data.serverUrl}|${config.data.certificate.fingerprint256}`
              : 'novo'
          }
          saved={config.data ?? null}
        />
      )}
      {config.data && (
        <PreferencesForm
          key={`preferencias-${config.data.preferences.idleHours}`}
          initial={config.data.preferences}
        />
      )}
      {!config.isPending && (
        <AttentionCard
          // Chave própria: as dos irmãos (a da conexão é "novo" no primeiro uso) não podem repetir.
          key={config.data ? 'aviso-configurado' : 'aviso-novo'}
          saved={config.data?.preferences ?? null}
        />
      )}
      {config.data && <RemoveConfiguration />}
      {info.data && (
        <Text size="sm" c="dimmed">
          HUNIT Control — versão {info.data.version}
        </Text>
      )}
    </Stack>
  );
}

function ConnectionForm({ saved }: { saved: PublicConfig | null }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const [serverUrl, setServerUrl] = useState(saved?.serverUrl ?? '');
  const [certificate, setCertificate] = useState<PickedCertificate | null>(
    saved ? { pem: saved.certificatePem, info: saved.certificate } : null,
  );
  const [apiKey, setApiKey] = useState('');
  const [tested, setTested] = useState<{ signature: string; client: ClientIdentity } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const input = () => ({
    serverUrl: serverUrl.trim(),
    certificatePem: certificate?.pem ?? '',
    ...(apiKey.trim() !== '' && { apiKey: apiKey.trim() }),
  });
  const signature = JSON.stringify(input());

  const pick = useMutation({
    mutationFn: () => unwrap(hunit.connection.pickCertificate()),
    onSuccess: (picked) => {
      setPickError(null);
      if (picked) setCertificate(picked);
    },
    onError: (error) => setPickError(messageOf(error)),
  });

  const test = useMutation({
    mutationFn: () => unwrap(hunit.connection.test(input())),
    onMutate: () => setTested(null),
    onSuccess: (client) => setTested({ signature, client }),
  });

  const save = useMutation({
    mutationFn: () => unwrap(hunit.connection.save(input())),
    onSuccess: async () => {
      setApiKey('');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const hasKey = apiKey.trim() !== '' || Boolean(saved?.hasApiKey);
  const canTest = serverUrl.trim() !== '' && certificate !== null && hasKey;
  const testValid = tested !== null && tested.signature === signature;

  return (
    <Card block="Conexão com o servidor">
      <SectionTitle>Conexão com o servidor</SectionTitle>
      <Field
        label="Endereço do servidor"
        description="Como recebido do responsável, com https:// (ex.: https://192.168.0.50)"
        value={serverUrl}
        onChange={(event) => setServerUrl(event.currentTarget.value)}
        autoComplete="off"
        spellCheck={false}
      />

      <Group gap={12}>
        <Action
          variant="secondary"
          size="sm"
          onClick={() => pick.mutate()}
          loading={pick.isPending}
        >
          Escolher certificado raiz…
        </Action>
        <Text size="sm" c="dimmed">
          Arquivo hunit-raiz.crt exportado do servidor
        </Text>
      </Group>
      {pickError && <Notice tone="red">{pickError}</Notice>}
      {certificate && (
        <Card tone="subtle" padding={12} block="Certificado escolhido">
          <Text size="sm">Autoridade: {certificate.info.issuer}</Text>
          <Text size="sm">Impressão digital (SHA-256):</Text>
          <CodeText>{certificate.info.fingerprint256}</CodeText>
          <Text size="sm">Válido até {formatDate(certificate.info.validTo)}</Text>
          <Text size="xs" c="dimmed">
            Confira a impressão digital com o responsável pelo servidor.
          </Text>
        </Card>
      )}

      <PasswordField
        label="Chave de acesso"
        description={
          saved?.hasApiKey
            ? 'Chave guardada protegida nesta máquina. Deixe em branco para manter.'
            : 'Chave desta máquina, recebida do responsável pelo servidor'
        }
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
        autoComplete="off"
      />

      <Group gap={16}>
        <Action
          variant="secondary"
          size="sm"
          onClick={() => test.mutate()}
          loading={test.isPending}
          disabled={!canTest}
        >
          Testar conexão
        </Action>
        <Action
          variant="primary"
          size="sm"
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={!testValid || save.isPending}
        >
          Salvar conexão
        </Action>
      </Group>

      {test.isError && (
        <Notice tone="red" title="O teste falhou">
          {messageOf(test.error)}
        </Notice>
      )}
      {testValid && (
        <Notice tone="green" title="Conexão confirmada" role="status">
          Cliente <strong>{tested.client.name}</strong>, perfil {ROLE_NAMES[tested.client.role]}.
          Salve para usar esta conexão.
        </Notice>
      )}
      {save.isError && (
        <Notice tone="red" title="Não foi possível salvar">
          {messageOf(save.error)}
        </Notice>
      )}
      {save.isSuccess && !testValid && (
        <Notice tone="green" role="status" compact>
          Conexão salva.
        </Notice>
      )}
    </Card>
  );
}

/**
 * Card "Aviso do pedido de token" (specs/008, US1; telas 1.1 a 1.3): a chave do som e o volume gravam
 * na hora, sem botão (FR-006); ao soltar o volume com o som ligado, toca a amostra. Volume 0 mantém a
 * chave ligada (edge case). No primeiro uso (tela 1.2), o processo principal guarda a escolha e a
 * grava junto com a conexão.
 */
function AttentionCard({ saved }: { saved: Preferences | null }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const [soundEnabled, setSoundEnabled] = useState(saved?.soundEnabled ?? true);
  const [volume, setVolume] = useState(saved?.soundVolume ?? 100);
  const test = useMutation({ mutationFn: () => unwrap(hunit.attention.test()) });
  const save = useMutation({
    mutationFn: (input: PreferencesInput) => unwrap(hunit.preferences.set(input)),
    onSuccess: (preferences) => updateSavedPreferences(queryClient, preferences),
  });

  return (
    <Card block="Aviso do pedido de token">
      <SectionTitle>Aviso do pedido de token</SectionTitle>
      <Text size="sm">
        Quando o Hunit pedir o token, o app mostra uma notificação do Windows, vem para a frente e
        toca um único som. Teste para conferir se a notificação aparece nesta máquina.
      </Text>
      <SwitchField
        label="Tocar som do aviso"
        inlineDescription
        description={
          soundEnabled
            ? 'Desligue para deixar o aviso sem som (mudo).'
            : 'Som desligado: o aviso aparece só na tela, sem som.'
        }
        checked={soundEnabled}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          setSoundEnabled(next);
          save.mutate({ soundEnabled: next });
        }}
      />
      <VolumeField
        value={volume}
        disabled={!soundEnabled}
        onChange={setVolume}
        onChangeEnd={(next) => {
          save.mutate({ soundVolume: next });
          playAlertSound(next);
        }}
      />
      <Notice tone="gray" role="none" icon={<InfoIcon size={16} />}>
        Toca um som só: o do app. A notificação do Windows aparece sem som, para os dois não tocarem
        ao mesmo tempo.
      </Notice>
      {save.isError && <Notice tone="red">{messageOf(save.error)}</Notice>}
      <Divider />
      <Group>
        <Action
          variant="secondary"
          size="sm"
          onClick={() => test.mutate()}
          loading={test.isPending}
        >
          Testar aviso
        </Action>
      </Group>
    </Card>
  );
}

/** Remover a configuração desta máquina, inclusive a chave guardada (FR-003). */
function RemoveConfiguration() {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => unwrap(hunit.connection.remove()),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  return (
    <Card block="Remover a configuração">
      <SectionTitle>Remover a configuração</SectionTitle>
      <Text size="sm">
        Apaga desta máquina o endereço do servidor, o certificado e a chave de acesso guardada. Para
        usar o app de novo, será preciso configurar outra vez.
      </Text>
      <Group>
        <Action variant="danger-light" size="sm" onClick={() => setConfirming(true)}>
          Remover a configuração desta máquina
        </Action>
      </Group>
      {remove.isError && <Notice tone="red">{messageOf(remove.error)}</Notice>}
      <AppDialog
        opened={confirming}
        onClose={() => setConfirming(false)}
        title="Remover a configuração?"
        actions={
          <>
            <Action variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Não
            </Action>
            <Action
              variant="danger"
              size="sm"
              onClick={() => remove.mutate()}
              loading={remove.isPending}
            >
              Sim, remover
            </Action>
          </>
        }
      >
        <Text size="sm">A chave de acesso guardada nesta máquina será apagada.</Text>
      </AppDialog>
    </Card>
  );
}
