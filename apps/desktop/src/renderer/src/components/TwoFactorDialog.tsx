/**
 * Diálogo do pedido de token (specs/002, FR-011, FR-013, FR-019, data-model §4.2, research R-07).
 *
 * Aberto pelo processo principal quando uma execução ou um envio ao Comercial desta máquina passa
 * a aguardar o token (ou é encontrado assim ao abrir o app; specs/005, research R-14). A contagem regressiva usa o prazo do servidor corrigido pela
 * diferença de relógio. O diálogo fecha sozinho quando a execução sai da espera, com a mensagem do
 * desfecho; pedidos simultâneos (raros) entram em fila.
 *
 * Desde a 006 (T020; telas 2.4, 2.5, 2.9 e 7.3): diálogo escuro enquanto pede o token (contagem em
 * lima, "Enviar token" em lima, sem fechar) e claro com o desfecho e "Fechar".
 */
import { useEffect, useState, type FormEvent } from 'react';
import type {
  JobKind,
  JobRef,
  TwoFactorCloseReason,
  TwoFactorRequest,
} from '../../../shared/ipc-types';
import { HunitError, unwrap, useHunit } from '../hunit';
import { formatRemaining } from '../presentation/format';
import { Action, AppDialog, Countdown, Field, Notice } from '../ui';

const TOKEN_PATTERN = /^[0-9]{4,10}$/;

/** "A execução" ou "O envio ao Comercial". */
const SUBJECT: Record<JobKind, { name: string; article: 'A' | 'O' }> = {
  execution: { name: 'execução', article: 'A' },
  dispatch: { name: 'envio ao Comercial', article: 'O' },
};

function closedMessage(kind: JobKind, reason: TwoFactorCloseReason): string {
  const { name, article } = SUBJECT[kind];
  const lower = article.toLowerCase();
  const messages: Record<TwoFactorCloseReason, string> = {
    accepted: `Token aceito pelo Hunit. ${article} ${name} continua.`,
    rejected: 'O Hunit recusou o token.',
    expired: 'O prazo para informar o token terminou.',
    finished: `${article} ${name} terminou antes de o token ser usado.`,
    answered_elsewhere: `O token foi informado em outra máquina; ${lower} ${name} continua.`,
  };
  return messages[reason];
}

const sameJob = (a: JobRef, b: JobRef) => a.kind === b.kind && a.id === b.id;

/** Como o pedido terminou. */
interface Outcome {
  job: JobRef;
  message: string;
  success: boolean;
}

type Phase = { kind: 'open'; error: string | null } | { kind: 'sending' } | { kind: 'waiting' };

export function TwoFactorDialog() {
  const hunit = useHunit();
  const [queue, setQueue] = useState<TwoFactorRequest[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'open', error: null });
  const [token, setToken] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const current = queue[0] ?? null;
  const closed = current !== null && outcome && sameJob(outcome.job, current.job) ? outcome : null;

  useEffect(() => {
    const offRequested = hunit.twoFactor.onRequested((request) =>
      setQueue((previous) =>
        previous.some((item) => sameJob(item.job, request.job)) ? previous : [...previous, request],
      ),
    );
    const offClosed = hunit.twoFactor.onClosed(({ job, reason }) => {
      setOutcome({
        job,
        message: closedMessage(job.kind, reason),
        success: reason === 'accepted' || reason === 'answered_elsewhere',
      });
      // O pedido mostrado fica na tela com o desfecho; os da fila que fecharam saem dela.
      setQueue((previous) =>
        previous[0] && sameJob(previous[0].job, job)
          ? previous
          : previous.filter((item) => !sameJob(item.job, job)),
      );
    });
    return () => {
      offRequested();
      offClosed();
    };
  }, [hunit]);

  // Atualiza a contagem regressiva enquanto houver pedido aberto.
  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [current]);

  function next() {
    setQueue((previous) => previous.slice(1));
    setOutcome(null);
    setPhase({ kind: 'open', error: null });
    setToken('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const value = token.trim();
    if (!TOKEN_PATTERN.test(value)) {
      setPhase({ kind: 'open', error: 'O token tem de 4 a 10 dígitos.' });
      return;
    }
    setPhase({ kind: 'sending' });
    const { job } = current;
    try {
      await unwrap(
        job.kind === 'execution'
          ? hunit.executions.sendToken({ executionId: job.id, token: value })
          : hunit.dispatches.sendToken({ dispatchId: job.id, token: value }),
      );
      setToken('');
      setPhase({ kind: 'waiting' });
    } catch (error) {
      if (error instanceof HunitError && error.code === 'not_awaiting_two_factor') {
        const { name, article } = SUBJECT[job.kind];
        setOutcome({
          job,
          message: `${article} ${name} não aguarda mais o token.`,
          success: false,
        });
      } else {
        setPhase({
          kind: 'open',
          error: error instanceof HunitError ? error.message : 'Não foi possível enviar o token.',
        });
      }
    }
  }

  const remaining = current ? Date.parse(current.deadline) - (now + current.clockOffsetMs) : 0;

  return (
    <AppDialog
      opened={current !== null}
      onClose={() => (closed ? next() : undefined)}
      title="O Hunit pediu o token"
      subtitle={current?.job.kind === 'dispatch' ? 'Envio ao Comercial' : undefined}
      dark={closed === null}
      withCloseButton={closed !== null}
      closeOnClickOutside={false}
      closeOnEscape={closed !== null}
      // Acima de qualquer painel ou diálogo aberto: o pedido de token tem prazo curto.
      zIndex={1000}
      instant
      onSubmit={closed ? undefined : (event) => void submit(event)}
      actions={
        closed ? (
          <Action variant="primary" size="sm" onClick={next}>
            Fechar
          </Action>
        ) : phase.kind === 'waiting' ? undefined : (
          <Action type="submit" variant="primary" size="sm" loading={phase.kind === 'sending'}>
            Enviar token
          </Action>
        )
      }
    >
      {closed ? (
        <Notice tone={closed.success ? 'green' : 'red'} role="status">
          {closed.message}
        </Notice>
      ) : (
        <>
          <Countdown
            label="Tempo restante"
            value={formatRemaining(remaining)}
            urgent={remaining < 30_000}
          />
          {phase.kind === 'waiting' ? (
            <Notice tone="lime" role="status">
              Token entregue, aguardando o Hunit…
            </Notice>
          ) : (
            <Field
              size="lg"
              label="Token do autenticador"
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              data-autofocus
              error={phase.kind === 'open' ? phase.error : null}
              disabled={phase.kind === 'sending'}
            />
          )}
        </>
      )}
    </AppDialog>
  );
}
