/**
 * Configuração da máquina (specs/002, FR-001 a FR-004, FR-025, research R-03 e R-07): endereço do
 * servidor, certificado raiz (o operador confere a impressão digital) e chave de acesso. A conexão
 * é testada antes de salvar; um teste só vale para os dados com que foi feito.
 */
import {
  Alert,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ClientIdentity, PickedCertificate, PublicConfig } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate } from '../../presentation/format';
import { PreferencesForm } from './PreferencesForm';

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
    <Stack gap="lg" maw={760}>
      <Title order={2}>Configuração</Title>
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
          key={JSON.stringify(config.data.preferences)}
          initial={config.data.preferences}
        />
      )}
      <AttentionTest />
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
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Title order={4}>Conexão com o servidor</Title>
        <TextInput
          label="Endereço do servidor"
          description="Como recebido do responsável, com https:// (ex.: https://192.168.0.50)"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
        />

        <Stack gap={6}>
          <Group gap="sm">
            <Button variant="default" onClick={() => pick.mutate()} loading={pick.isPending}>
              Escolher certificado raiz…
            </Button>
            <Text size="sm" c="dimmed">
              Arquivo hunit-raiz.crt exportado do servidor
            </Text>
          </Group>
          {pickError && (
            <Text size="sm" c="red">
              {pickError}
            </Text>
          )}
          {certificate && (
            <Paper bg="gray.0" p="sm" radius="sm">
              <Stack gap={4}>
                <Text size="sm">
                  Autoridade: <Text span>{certificate.info.issuer}</Text>
                </Text>
                <Text size="sm">
                  Impressão digital (SHA-256): <Code>{certificate.info.fingerprint256}</Code>
                </Text>
                <Text size="sm">Válido até {formatDate(certificate.info.validTo)}</Text>
                <Text size="xs" c="dimmed">
                  Confira a impressão digital com o responsável pelo servidor.
                </Text>
              </Stack>
            </Paper>
          )}
        </Stack>

        <PasswordInput
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

        <Group>
          <Button
            variant="light"
            onClick={() => test.mutate()}
            loading={test.isPending}
            disabled={!canTest}
          >
            Testar conexão
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!testValid || save.isPending}
          >
            Salvar conexão
          </Button>
        </Group>

        {test.isError && (
          <Alert color="red" title="O teste falhou" role="alert">
            {messageOf(test.error)}
          </Alert>
        )}
        {testValid && (
          <Alert color="green" title="Conexão confirmada" role="status">
            Cliente <b>{tested.client.name}</b>, perfil {ROLE_NAMES[tested.client.role]}. Salve para
            usar esta conexão.
          </Alert>
        )}
        {save.isError && (
          <Alert color="red" title="Não foi possível salvar" role="alert">
            {messageOf(save.error)}
          </Alert>
        )}
        {save.isSuccess && !testValid && (
          <Text size="sm" c="green.8" role="status">
            Conexão salva.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function AttentionTest() {
  const hunit = useHunit();
  const test = useMutation({ mutationFn: () => unwrap(hunit.attention.test()) });
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Aviso do pedido de token</Title>
        <Text size="sm">
          Quando o Hunit pedir o token, o app mostra uma notificação do Windows, vem para a frente e
          toca um som. Teste para conferir se a notificação aparece nesta máquina.
        </Text>
        <Divider />
        <Group>
          <Button variant="default" onClick={() => test.mutate()} loading={test.isPending}>
            Testar aviso
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
