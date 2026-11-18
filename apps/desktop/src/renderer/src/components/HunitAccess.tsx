/**
 * Acesso ao Hunit fora da tela Executar (specs/005, research R-14): o mesmo formulário e o mesmo
 * cofre do processo principal (specs/002, FR-006 a FR-008), para enviar ao Comercial e retomar um
 * envio. Usuário e senha guardados numa tela valem na outra.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { unwrap, useHunit } from '../hunit';
import { CredentialsForm } from '../screens/run/CredentialsForm';

const IDLE_NOTICE =
  'Usuário e senha do Hunit foram apagados por inatividade. Informe-os de novo para enviar.';

export interface HunitAccessState {
  hasPassword: boolean;
  /** Guarda no cofre o que foi digitado e ainda não guardado (antes de enviar). */
  saveTyped(): Promise<void>;
  /** O cofre foi esvaziado: a tela pede o acesso de novo. */
  expired(): void;
  form: React.ReactNode;
}

export function useHunitAccess(): HunitAccessState {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => unwrap(hunit.credentials.status()),
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      hunit.credentials.onCleared(({ reason }) => {
        if (reason === 'idle') setNotice(IDLE_NOTICE);
        queryClient.setQueryData(['credentials'], { username: null, hasPassword: false });
      }),
    [hunit, queryClient],
  );

  const save = useMutation({
    mutationFn: () => unwrap(hunit.credentials.set({ username: username.trim(), password })),
    onSuccess: (status) => {
      queryClient.setQueryData(['credentials'], status);
      setPassword('');
      setNotice(null);
    },
  });
  const clear = useMutation({
    mutationFn: () => unwrap(hunit.credentials.clear()),
    onSuccess: (status) => queryClient.setQueryData(['credentials'], status),
  });

  return {
    hasPassword: credentials.data?.hasPassword ?? false,
    saveTyped: async () => {
      if (username.trim() !== '' && password !== '') await save.mutateAsync();
    },
    expired: () => {
      setNotice(IDLE_NOTICE);
      void queryClient.invalidateQueries({ queryKey: ['credentials'] });
    },
    form: (
      <CredentialsForm
        status={credentials.data}
        username={username}
        password={password}
        onUsername={setUsername}
        onPassword={setPassword}
        onSave={() => save.mutate()}
        onClear={() => clear.mutate()}
        saving={save.isPending}
        notice={notice}
      />
    ),
  };
}
