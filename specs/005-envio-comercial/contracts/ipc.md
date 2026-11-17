# Ponte do app (`window.hunit`): acréscimos

**Feature**: [spec.md](../spec.md) | **Research**: [R-12](../research.md#r-12--lotes-selecionar-todas-do-filtro-e-cópia-para-e-mail), [R-14](../research.md#r-14--app-desktop-área-comercial-e-o-envio-no-fluxo-das-execuções)

Regras de sempre (002): o renderer não tem Node nem rede; toda chamada passa pelo processo principal,
que valida a entrada com `ipc-schemas.ts` e fala com a API. Usuário e senha do Hunit continuam no
cofre de credenciais do principal (`credentials`), em memória até o app fechar; o renderer nunca os
recebe de volta.

## Grupos novos

```ts
dispatches: {
  check: (input: { reservations: ReservationKey[] }) => Promise<Result<DispatchCheck>>;
  /** Usa as credenciais do cofre, como executions.start. */
  start: (input: { reservations: ReservationKey[] }) => Promise<Result<Dispatch>>;
  list: (input: DispatchListInput) => Promise<Result<Page<DispatchSummary>>>;
  get: (dispatchId: string) => Promise<Result<DispatchDetail>>;
  resume: (dispatchId: string) => Promise<Result<Dispatch>>;
  cancel: (dispatchId: string) => Promise<Result<Dispatch>>;
  sendToken: (input: { dispatchId: string; token: string }) => Promise<Result<void>>;
  watch: (dispatchId: string) => Promise<Result<void>>;
  unwatch: (dispatchId: string) => Promise<Result<void>>;
  onChanged(callback: (event: DispatchChanged) => void): Unsubscribe;
};
commercial: {
  get: (input: ReservationKey) => Promise<Result<CommercialDetail>>;   // linha, retornos, histórico
  cancelLine: (input: ReservationKey) => Promise<Result<CommercialLine>>;
  restoreLine: (input: ReservationKey) => Promise<Result<CommercialLine>>;
  confirmReturn: (returnId: string) => Promise<Result<ReservationTreatment>>;
  rejectReturn: (input: { returnId: string; reason: string }) => Promise<Result<ReservationTreatment>>;
  undoConfirmation: (returnId: string) => Promise<Result<ReservationTreatment>>;
  confirmReturns: (input: { reservations: ReservationKey[] }) => Promise<Result<BatchResult>>;
  sheetStatus: () => Promise<Result<CommercialSheetStatus>>;
  readNow: () => Promise<Result<CommercialSheetRead>>;
};
clipboard: {
  /** Monta a tabela (HTML + texto com tabulação) no principal e grava na área de transferência. */
  copyReservations: (input: CopyReservationsInput) => Promise<Result<{ copied: number }>>;
};
```

`CopyReservationsInput` = `{ source: 'selection'; reservations: CopyRow[] }` ou
`{ source: 'filter'; filters: ReservationFilters }` (o principal chama `GET /reservations/selection`).
`CopyRow` só tem as colunas da cópia (FR-027): hotel, reserva, check-in, canal, valor, motivo, ativa ou
cancelada, situação. Não existe campo de hóspede no tipo; um teste confere que o HTML e o texto
gerados não têm o nome de nenhuma reserva de teste.

## Grupos alterados

| Onde | Mudança |
|---|---|
| `reservations` | `selectAll: (filters: ReservationFilters) => Promise<Result<SelectionResult>>` (`GET /reservations/selection`) |
| `treatments` | `confirmReviews: (input: { reservations: ReservationKey[] }) => Promise<Result<BatchResult>>` (`POST /treatment-reviews`) |
| `twoFactor.onRequested` | `TwoFactorRequest` ganha `job: { kind: 'execution' \| 'dispatch'; id }`; o aviso (`attention`) é o mesmo |
| `ipc-schemas.ts` — filtros | `detailedSituation: z.array(...)`, `sentToCommercial: z.boolean().optional()` |
| `ipc-types.ts` | tipos gerados da API 1.7.0 (`detailedSituation`, `chargedAmountOrigin`, `commercial` etc.) |
| `main/execution-watcher.ts` | observa também os envios iniciados nesta máquina (pedido de token, término) |

## Limites validados no principal

Até 2 000 reservas em `dispatches.check`, `dispatches.start`, `commercial.confirmReturns`,
`treatments.confirmReviews` e `clipboard.copyReservations`; `reason` de 1 a 500 caracteres; token com o
mesmo formato de `executions.sendToken`.
