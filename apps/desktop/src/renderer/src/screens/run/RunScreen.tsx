/**
 * Tela Executar (specs/002, US1, FR-004, FR-006 a FR-010): acesso ao Hunit, período de check-in e
 * hotéis; inicia a execução e mostra o estado dela até o resultado. Guarda em memória o período e
 * os hotéis da última execução iniciada, para o "Iniciar de novo" (US1, cenário 5). Só o perfil
 * operador vê o formulário.
 */
import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { StartExecutionInput } from '../../../../shared/ipc-types';
import { errorCode, HunitError, messageOf, unwrap, useHunit } from '../../hunit';
import { useConnection } from '../../state/connection';
import { useExecution } from '../../state/executions';
import { CredentialsForm } from './CredentialsForm';
import { ExecutionResult } from './ExecutionResult';
import { HotelSelect, type HotelMode } from './HotelSelect';
import { PeriodPicker } from './PeriodPicker';

const IDLE_NOTICE =
  'Usuário e senha do Hunit foram apagados por inatividade. Informe-os de novo para executar.';

/** Data local no formato da API, `days` dias a partir de hoje. */
function localDate(days = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function RunScreen({ onOpenExecution }: { onOpenExecution: (executionId: string) => void }) {
  const { client, isOperator } = useConnection();

  if (!client) return null;
  if (!isOperator) {
    return (
      <Alert color="gray" title="Executar">
        Com o perfil consulta, o app não inicia execuções. Veja as execuções e as reservas nas
        outras áreas.
      </Alert>
    );
  }
  return <RunForm onOpenExecution={onOpenExecution} />;
}

function RunForm({ onOpenExecution }: { onOpenExecution: (executionId: string) => void }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const { client, isOnline } = useConnection();

  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => unwrap(hunit.credentials.status()),
  });
  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [period, setPeriod] = useState<{ from: string | null; to: string | null }>(() => ({
    from: localDate(),
    to: localDate(6),
  }));
  const [hotelMode, setHotelMode] = useState<HotelMode>('all');
  const [selectedHotels, setSelectedHotels] = useState<string[]>([]);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [hotelError, setHotelError] = useState<string | null>(null);
  const [lastStarted, setLastStarted] = useState<StartExecutionInput | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const execution = useExecution(executionId);

  // O cofre foi esvaziado (por inatividade ou "Limpar acesso"): a tela pede o acesso de novo.
  useEffect(
    () =>
      hunit.credentials.onCleared(({ reason }) => {
        if (reason === 'idle') setNotice(IDLE_NOTICE);
        queryClient.setQueryData(['credentials'], { username: null, hasPassword: false });
      }),
    [hunit, queryClient],
  );

  const saveAccess = useMutation({
    mutationFn: () => unwrap(hunit.credentials.set({ username: username.trim(), password })),
    onSuccess: (status) => {
      queryClient.setQueryData(['credentials'], status);
      setPassword('');
      setNotice(null);
    },
  });

  const clearAccess = useMutation({
    mutationFn: () => unwrap(hunit.credentials.clear()),
    onSuccess: (status) => queryClient.setQueryData(['credentials'], status),
  });

  const start = useMutation({
    mutationFn: async (input: StartExecutionInput) => {
      setActiveExecutionId(null);
      // Campos preenchidos e ainda não guardados vão para o cofre antes de iniciar.
      if (username.trim() !== '' && password !== '') await saveAccess.mutateAsync();
      return unwrap(hunit.executions.start(input));
    },
    onSuccess: (started, input) => {
      setLastStarted(input);
      setExecutionId(started.id);
      queryClient.setQueryData(['execution', started.id], started);
    },
    onError: async (error) => {
      const code = errorCode(error);
      if (code === 'credentials_expired') setNotice(IDLE_NOTICE);
      if (code === 'credentials_expired' || code === 'credentials_missing') {
        await queryClient.invalidateQueries({ queryKey: ['credentials'] });
      }
      if (code === 'execution_already_active') {
        const active = await hunit.executions.list({ active: true, limit: 50 });
        if (active.ok) {
          const mine =
            active.data.items.find((item) => item.requestedClient === client?.name) ??
            active.data.items[0];
          setActiveExecutionId(mine?.id ?? null);
        }
      }
    },
  });

  function submit() {
    setPeriodError(null);
    setHotelError(null);
    if (!period.from || !period.to) {
      setPeriodError('Informe o início e o fim do período de check-in.');
      return;
    }
    if (period.to < period.from) {
      setPeriodError('A data final não pode ser antes do início.');
      return;
    }
    const catalogEmpty = (hotels.data ?? []).length === 0;
    const some = hotelMode === 'some' && !catalogEmpty;
    if (some && selectedHotels.length === 0) {
      setHotelError('Escolha ao menos um hotel.');
      return;
    }
    start.mutate({
      period: { from: period.from, to: period.to },
      hotelCodes: some ? selectedHotels : null,
    });
  }

  const errorMessage =
    start.error && errorCode(start.error) !== 'credentials_expired' ? messageOf(start.error) : null;

  return (
    <Stack gap="md" maw={980}>
      <Title order={2}>Executar</Title>
      <CredentialsForm
        status={credentials.data}
        username={username}
        password={password}
        onUsername={setUsername}
        onPassword={setPassword}
        onSave={() => saveAccess.mutate()}
        onClear={() => clearAccess.mutate()}
        saving={saveAccess.isPending}
        notice={notice}
      />

      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <Title order={4}>Consulta</Title>
          <PeriodPicker
            from={period.from}
            to={period.to}
            onChange={(next) => {
              setPeriod(next);
              setPeriodError(null);
            }}
            error={periodError}
          />
          <HotelSelect
            hotels={hotels.data ?? []}
            mode={hotelMode}
            selected={selectedHotels}
            onMode={setHotelMode}
            onSelected={(codes) => {
              setSelectedHotels(codes);
              setHotelError(null);
            }}
            error={hotelError}
          />
          <Group>
            <Button onClick={submit} loading={start.isPending} size="md" disabled={!isOnline}>
              Iniciar execução
            </Button>
          </Group>
          {errorMessage && (
            <Alert color="red" role="alert">
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm">{errorMessage}</Text>
                {activeExecutionId && (
                  <Button
                    size="xs"
                    variant="white"
                    onClick={() => onOpenExecution(activeExecutionId)}
                  >
                    Ver a execução ativa
                  </Button>
                )}
              </Group>
            </Alert>
          )}
        </Stack>
      </Paper>

      {execution.data && (
        <ExecutionResult
          execution={execution.data}
          onRestart={lastStarted ? () => start.mutate(lastStarted) : undefined}
          restarting={start.isPending}
        />
      )}
      {execution.error instanceof HunitError && execution.data === undefined && (
        <Text size="sm" c="red">
          {execution.error.message}
        </Text>
      )}
    </Stack>
  );
}
