# Ponte do app (`window.hunit`): acréscimos

**Feature**: [spec.md](../spec.md) | **Research**: [R-13](../research.md#r-13--app-desktop-fr-024)

Nenhum canal novo. Os canais existentes passam os campos novos da API sem regra nenhuma:

| Onde | Mudança |
|---|---|
| `ipc-schemas.ts` — filtros de `reservations.list` | `fromLegacy: z.boolean().optional()` |
| `ipc-types.ts` — `ReservationFilters` | `fromLegacy?: boolean \| undefined` |
| `ipc-types.ts` — reserva, documento e evento | tipos gerados da API 1.6.0 (`legacy`, `fromLegacy`) |
| `main/api-client.ts` | envia `fromLegacy` na query quando definido |

A interface usa os campos para o selo "Sistema anterior", o filtro "Origem", a seção "Sistema
anterior" do detalhe e o autor "Sistema anterior" no histórico (data-model §6).
