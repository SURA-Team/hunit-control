# Mudanças na API: 1.5.0 → 1.6.0

**Feature**: [spec.md](../spec.md) | **Research**: [R-12](../research.md#r-12--contrato-da-api-150--160-fr-011-fr-016-fr-024)

Só acréscimos e descrições: nenhuma operação nova, nenhum campo obrigatório novo, nenhum valor novo
de enum. A importação não tem rota na API (FR-002). A fonte da verdade continua sendo
`packages/contracts/openapi.yaml`; a cópia desta feature fica em `contracts/openapi.yaml`
(criada na implementação, idêntica ao pacote).

## 1. `GET /v1/reservations` — filtro novo

| Parâmetro | Tipo | Regra |
|---|---|---|
| `fromLegacy` | `boolean`, opcional | `true` = só reservas importadas do sistema anterior (com ou sem verificação posterior pelo HUNIT Control); `false` = só as que não vieram de lá. Combina com todos os filtros existentes (FR-011) |

O filtro `situation` já aceita `not_virtual_card`, que passa a significar "A revisar (sistema
anterior)" (§3). `pendingCharge=true` deixa de incluir `not_virtual_card` (data-model §5); hoje não
há reservas com esse valor, então nenhum resultado atual muda.

## 2. `Reservation` — campo novo

```yaml
legacy:
  description: >-
    Origem "Sistema anterior" (specs/004, FR-011). null = a reserva não veio da importação.
  oneOf:
    - type: 'null'
    - $ref: '#/components/schemas/ReservationLegacyOrigin'
```

```yaml
ReservationLegacyOrigin:
  type: object
  required: [importedAt, originalClassification, originalPreviousClassification, firstVerifiedAt, lastVerifiedAt, verificationCount, merged]
  properties:
    importedAt: { type: string, format: date-time, description: Primeira importação que trouxe a reserva }
    originalClassification:
      type: string
      description: >-
        "Codigo status" como estava no sistema anterior (ex.: virtual_card_pending_charge,
        not_virtual_card ou um código desconhecido). Só informativo: a classificação vale.
    originalPreviousClassification: { type: [string, 'null'] }
    firstVerifiedAt: { type: string, format: date-time, description: Primeira verificação no sistema anterior }
    lastVerifiedAt: { type: string, format: date-time, description: Última verificação no sistema anterior }
    verificationCount: { type: integer, minimum: 1, description: Verificações feitas pelo sistema anterior }
    merged:
      type: boolean
      description: >-
        true = o HUNIT Control já conhecia a reserva quando ela foi importada; a classificação e os
        dados são os dele, e só a primeira verificação e a contagem incluíram o sistema anterior
        (FR-010).
```

Descrição de campos existentes (sem mudança de tipo):

- `lastExecutionId`: "Ausente = reserva só do sistema anterior, ainda não verificada pelo HUNIT
  Control (specs/004)."
- `firstVerifiedAt`, `verificationCount`: "Incluem as verificações do sistema anterior quando a
  reserva foi importada (specs/004, FR-010)."

## 3. `Classification` — descrição

`not_virtual_card`: **"A revisar (sistema anterior)"**. Não é produzida pelas execuções: só aparece
em reservas importadas cuja classificação do sistema anterior não tem correspondência (specs/004,
FR-007a) e sai na primeira verificação pelo HUNIT Control. Aceita tratativa e comprovante, não entra
em `pendingCharge` e não gera `needsReview`. (Antes: obsoleta desde a 1.2.0.)

## 4. `TreatmentDocument` e `TreatmentEvent` — campo novo

```yaml
fromLegacy:
  type: boolean
  description: >-
    true = registro importado do sistema anterior (specs/004, FR-016). attachedAt / at é a data
    original do registro; attachedBy / client é "sistema-anterior".
```

Opcional nas duas (ausente = `false`), para não quebrar quem valida respostas com o schema da 1.5.0.

## 5. Erros

Nenhum código novo.

## 6. Perfis

Sem mudança: os dois perfis veem os campos novos; nenhuma operação de escrita nova.
