/**
 * A ponte `window.hunit` dentro da interface (specs/002, contracts/ipc.md). Os componentes a
 * recebem por contexto, o que deixa os testes trocá-la por uma simulada. `unwrap` converte o
 * `Result` em valor ou em `HunitError` com o código, para o TanStack Query.
 */
import { createContext, useContext } from 'react';
import type { AppError, ErrorCode, HunitApi, Result } from '../../shared/ipc-types';
import { errorMessage } from './presentation/labels';

export const HunitContext = createContext<HunitApi | null>(null);

export function useHunit(): HunitApi {
  const hunit = useContext(HunitContext);
  if (!hunit) throw new Error('A ponte window.hunit não está disponível.');
  return hunit;
}

/** A ponte exposta pelo preload. */
export function windowHunit(): HunitApi {
  return (window as unknown as { hunit: HunitApi }).hunit;
}

export class HunitError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  readonly status: number | undefined;

  constructor(error: AppError) {
    super(errorMessage(error));
    this.name = 'HunitError';
    this.code = error.code;
    this.detail = error.detail;
    this.status = error.status;
  }
}

export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.data;
  throw new HunitError(result.error);
}

/** Código do erro, quando é um erro da ponte. */
export function errorCode(error: unknown): ErrorCode | null {
  return error instanceof HunitError ? error.code : null;
}

/** Mensagem para o operador de qualquer erro (os da ponte já vêm em português). */
export function messageOf(error: unknown): string {
  return error instanceof HunitError ? error.message : errorMessage({ code: 'internal_error' });
}
