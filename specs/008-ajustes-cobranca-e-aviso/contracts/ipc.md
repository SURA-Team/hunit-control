# Ponte do app (`window.hunit`): acréscimos da 008

**Feature**: [spec.md](../spec.md) | **Research**: [R-03](../research.md#r-03--som-do-aviso-um-só-com-volume), [R-07](../research.md#r-07--fila-cobradas-no-hunit-e-o-verificar-agora), [R-08](../research.md#r-08--cancelada-sem-cobrança-como-marcação-do-financeiro), [R-10](../research.md#r-10--ícone-na-barra-de-tarefas-do-windows)

Regras de sempre (002): o renderer não tem Node nem rede; toda chamada passa pelo processo principal,
que valida a entrada com `ipc-schemas.ts` e fala com a API. Usuário e senha do Hunit ficam no cofre do
principal; a verificação da fila os usa como o envio (`dispatches.start`).

## Grupos alterados

| Onde | Mudança |
|---|---|
| `preferences.get` / `preferences.set` | `Preferences` ganha `soundVolume` (0 a 100); `set` aceita `{ soundEnabled?, soundVolume?, idleHours? }` e grava na hora |
| `attention.onPlaySound` | o callback recebe `{ volume: number }` (0 a 100), para o renderer tocar no volume escolhido |
| `reservations` | `markNoCharge: (input: { key: ReservationKey; expectedSituation: ReservationDetailedSituation; note?: string }) => Promise<Result<Reservation>>` e `undoNoCharge: (input: { key: ReservationKey; markId: string }) => Promise<Result<Reservation>>` |
| `commercial` | `hunitCharges: () => Promise<Result<HunitChargeQueue>>` (`GET /commercial-hunit-charges`) e `checkHunitCharges: () => Promise<Result<Dispatch>>` (`POST /commercial-hunit-charges/check`, credenciais do cofre; sem credenciais → o mesmo erro do envio, e a tela abre o diálogo de credenciais) |
| `dispatches.list` | entrada ganha `purpose?: 'send' \| 'hunit_check' \| 'all'` |
| `twoFactor.onRequested` | sem mudança de formato: a verificação é um `job` do tipo `dispatch`; o texto do card vem de `purpose` |

## Processo principal (sem ponte nova)

- `attention.ts`: notificação do pedido de token e do teste com `silent: true` (o único som é o do
  app).
- `index.ts`: AUMID `io.github.sura-team.hunit-control` só empacotado; em desenvolvimento e nos testes,
  `io.github.sura-team.hunit-control.dev`.
- `window.ts`: ícone da janela nos dois modos (empacotado: `process.resourcesPath/icon.ico`, vindo do
  `extraResources`) e `setAppDetails` no Windows (R-10).
- `execution-watcher.ts`: acompanha envios e verificações (`purpose=all`) para o aviso do token.
