# Ponte do app (`window.hunit`): acréscimos da 007

**Feature**: [spec.md](../spec.md) | **Research**: [R-06](../research.md#r-06--período-atalhos-e-o-estado-dos-dados-no-app), [R-07](../research.md#r-07--gaveta-do-hotel-e-a-ida-para-reservas)

Regras de sempre (002): o renderer não tem Node nem rede; toda chamada passa pelo processo principal,
que valida a entrada com `ipc-schemas.ts` e fala com a API.

## Grupo novo

| Onde | Assinatura |
|---|---|
| `reports.overview` | `(input: { checkInFrom: string; checkInTo: string }) => Promise<Result<ReportOverview>>` — `GET /reports/overview`. Canal `reports:overview`. O esquema aceita só datas `AAAA-MM-DD` existentes, com início até o fim |

## Grupos alterados

| Onde | Mudança |
|---|---|
| `reservations.list` e `reservations.selectAll` | `order` aceita `'amount_desc'` |

## Arquivos

`shared/ipc-channels.ts`, `shared/ipc-types.ts` (`ReportOverview`, `HotelReportRow` a partir dos tipos
gerados), `shared/ipc-schemas.ts`, `main/api-client.ts`, `main/ipc-handlers.ts` (ou um
`main/reports-handlers.ts`, como os do Comercial), `preload/index.ts`. O teste de segurança da ponte
(`security-hardening.test.ts`) ganha `reports.overview` na lista.
