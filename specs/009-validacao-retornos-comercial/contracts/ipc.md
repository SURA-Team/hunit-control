# Ponte do app (`window.hunit`): acréscimos da 009

**Feature**: [spec.md](../spec.md) | **API**: [api-changes.md](./api-changes.md)

O renderer continua sem rede: o processo principal chama a API e devolve `Result<T>`. Tipos em
`apps/desktop/src/shared/ipc-types.ts`, validação em `ipc-schemas.ts`, canais em `ipc-channels.ts`.

| Método | Canal | Chama | Devolve |
|---|---|---|---|
| `commercial.confirmSituationReturn({ returnId, as, chargedAmount?, note? })` | `commercial:confirmSituationReturn` (`commercialConfirmSituationReturn`) | `POST /commercial-returns/{returnId}/situation/confirm` | `Result<Reservation>` |

A recusa e os desfazer usam os métodos que já existem (`commercial.rejectReturn`,
`commercial.undoConfirmation` (canal `commercial:undoConfirmation`), `reservations.undoNoCharge`).

Erros mostrados ao operador (em `presentation/labels.ts`):

| Código | Mensagem |
|---|---|
| `charged_amount_required` | "Informe o valor cobrado: o Comercial não informou." |
| `not_a_situation_return` | "Este retorno não é de uma situação livre. Atualize a lista." |
| `return_not_awaiting_validation` | a mensagem que já existe |
| `no_charge_not_accepted` | a mensagem que já existe (com o motivo) |
