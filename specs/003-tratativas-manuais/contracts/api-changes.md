# Contrato: acréscimos à API (1.4.0 → 1.5.0)

**Feature**: [spec.md](../spec.md) | **Research**: [R-02](../research.md), [R-03](../research.md), [R-10](../research.md) | **Data model**: [data-model.md](../data-model.md)

A fonte da verdade continua sendo `packages/contracts/openapi.yaml`. Tudo aqui é **compatível**
(só acréscimos): a versão sobe na parte MINOR (`info.version: 1.5.0`). Depois de aplicar, regenerar
os tipos (`pnpm --filter @hunit/contracts generate`) e copiar o arquivo para
`specs/003-tratativas-manuais/contracts/openapi.yaml` (research R-12). Cada acréscimo exige teste
de contrato no grupo `server-db`.

Todas as operações que não são `GET` entram em `OPERATOR_ONLY_OPERATIONS` (FR-014): o perfil
consulta recebe `403 forbidden_for_role`.

---

## 1. Códigos de problema novos

Acrescentados ao `enum` de `Problem.code`:

| Código | HTTP | Quando |
|---|---|---|
| `empty_file` | 400 | arquivo enviado sem conteúdo |
| `file_too_large` | 413 | mais de 26 214 400 bytes |
| `unsupported_file_type` | 415 | extensão fora da lista ou conteúdo que não corresponde à extensão (R-03) |
| `file_not_found` | 422 | `fileId` que o servidor não tem (nunca enviado ou já apagado) |
| `not_eligible_for_treatment` | 409 | a reserva não aceita registros (FR-003) — operações de uma reserva só |
| `document_not_current` | 409 | desfazer um documento que já não é o atual |
| `document_not_revertible` | 409 | reverter um documento atual, purgado ou com o prazo de 30 dias vencido (FR-013a) |
| `proof_required` | 409 | informar valor manual sem comprovante atual (FR-005) |
| `document_purged` | 410 | baixar um documento cujo arquivo foi apagado pela retenção (FR-013, FR-016) |

## 2. Esquemas novos

```yaml
TreatmentDocumentKind:
  type: string
  enum: [request, proof]          # request = tratativa (pedido de cobrança); proof = comprovante

TreatmentStatus:
  type: string
  enum: [none, sent, charged]     # sem tratativa, Enviada, Cobrada (FR-002)

TreatmentDocumentState:
  type: string
  enum: [current, replaced, removed, purged]

ReservationKey:
  type: object
  required: [hotelCode, reservationNumber]
  additionalProperties: false
  properties:
    hotelCode: { type: string, minLength: 1 }
    reservationNumber: { type: string, minLength: 1 }

TreatmentDocument:
  type: object
  required: [id, kind, state, sizeBytes, mediaType, attachedAt, attachedBy]
  properties:
    id: { type: string, format: uuid }
    kind: { $ref: '#/components/schemas/TreatmentDocumentKind' }
    state: { $ref: '#/components/schemas/TreatmentDocumentState' }
    fileName: { type: [string, 'null'], description: null depois da purga }
    sizeBytes: { type: integer }
    mediaType: { type: string }
    attachedAt: { type: string, format: date-time }
    attachedBy: { type: string, description: nome do cliente da API }
    endedAt: { type: [string, 'null'], format: date-time }
    endedBy: { type: [string, 'null'] }
    revertibleUntil:
      type: [string, 'null']
      format: date-time
      description: Preenchido só em documentos substituídos ou desfeitos ainda no prazo (FR-013a)

ReservationTreatment:            # resumo que passa a vir em toda Reservation
  type: object
  required: [status, request, proof, manualChargedAmount, effectiveChargedAmount]
  properties:
    status: { $ref: '#/components/schemas/TreatmentStatus' }
    request:
      oneOf: [{ $ref: '#/components/schemas/TreatmentDocument' }, { type: 'null' }]
    proof:
      oneOf: [{ $ref: '#/components/schemas/TreatmentDocument' }, { type: 'null' }]
    manualChargedAmount: { $ref: '#/components/schemas/Money' }
    effectiveChargedAmount:
      $ref: '#/components/schemas/Money'
      description: O do Hunit quando existe; senão o manual, se houver comprovante atual (FR-005)
    acceptsDocuments:
      type: boolean
      description: A classificação atual aceita registrar, substituir e reverter (FR-003)

TreatmentEvent:
  type: object
  required: [id, type, client, at]
  properties:
    id: { type: integer }
    type: { type: string, enum: [attached, replaced, removed, reverted, amount_set, amount_cleared] }
    kind:
      oneOf: [{ $ref: '#/components/schemas/TreatmentDocumentKind' }, { type: 'null' }]
    documentId: { type: [string, 'null'], format: uuid }
    previousDocumentId: { type: [string, 'null'], format: uuid }
    amount: { $ref: '#/components/schemas/Money' }
    batchId: { type: [string, 'null'], format: uuid }
    client: { type: string }
    at: { type: string, format: date-time }

ReservationOutcome:
  type: object
  required: [hotelCode, reservationNumber, outcome]
  properties:
    hotelCode: { type: string }
    reservationNumber: { type: string }
    outcome: { type: string, enum: [registered, replaced, ignored, failed] }
    reason:
      type: [string, 'null']
      enum: [not_found, not_eligible, same_file, null]
    classification:
      oneOf: [{ $ref: '#/components/schemas/Classification' }, { type: 'null' }]
    totalAmount: { $ref: '#/components/schemas/Money' }
    documentId: { type: [string, 'null'], format: uuid, description: preenchido em registered e replaced }
```

`Reservation` ganha a propriedade `treatment` (`$ref: ReservationTreatment`), presente em
`GET /reservations` e em `GET /reservations/{hotelCode}/{reservationNumber}`.

## 3. `POST /v1/treatment-files` — enviar o arquivo (FR-008, R-02, R-03)

```yaml
/treatment-files:
  post:
    tags: [treatments]
    operationId: uploadTreatmentFile
    parameters:
      - name: name
        in: query
        required: true
        description: Nome original do arquivo, com a extensão
        schema: { type: string, minLength: 1, maxLength: 255 }
    requestBody:
      required: true
      content:
        application/octet-stream: {}   # sem schema: conferido no handler (R-03)
    responses:
      '201':
        content:
          application/json:
            schema:
              type: object
              required: [fileId, sizeBytes, mediaType]
              properties:
                fileId: { type: string, pattern: '^[0-9a-f]{64}$' }
                sizeBytes: { type: integer }
                mediaType: { type: string }
      '400': { $ref: '#/components/responses/BadRequest' }   # inclui empty_file
      '401': { $ref: '#/components/responses/Unauthorized' }
      '403': { $ref: '#/components/responses/Forbidden' }
      '413': # file_too_large
      '415': # unsupported_file_type
```

Enviar de novo um arquivo idêntico devolve o mesmo `fileId` (201), sem gravar outra cópia. O nome
(`name`) não aparece no log do servidor (research R-13).

## 4. `POST /v1/treatment-documents/check` — quem aceita, sem gravar (FR-006, FR-006a)

```yaml
requestBody:   # application/json
  type: object
  required: [kind, reservations]
  additionalProperties: false
  properties:
    kind: { $ref: '#/components/schemas/TreatmentDocumentKind' }
    reservations:
      type: array
      minItems: 1
      maxItems: 200
      items: { $ref: '#/components/schemas/ReservationKey' }
responses:
  '200':
    schema:
      type: object
      required: [items, acceptedCount, ignoredCount, acceptedTotalAmount]
      properties:
        items: { type: array, items: { $ref: '#/components/schemas/ReservationOutcome' } }
        acceptedCount: { type: integer }
        replacingCount: { type: integer, description: das aceitas, quantas já têm um documento desse tipo }
        ignoredCount: { type: integer }
        acceptedTotalAmount: { $ref: '#/components/schemas/Money' }
```

No `check`, `outcome` é `registered` (seria novo), `replaced` (substituiria o atual) ou `ignored`.

## 5. `POST /v1/treatment-documents` — registrar (FR-001, FR-004, FR-006, FR-011)

```yaml
requestBody:   # application/json
  type: object
  required: [kind, fileId, fileName, reservations]
  additionalProperties: false
  properties:
    kind: { $ref: '#/components/schemas/TreatmentDocumentKind' }
    fileId: { type: string, pattern: '^[0-9a-f]{64}$' }
    fileName: { type: string, minLength: 1, maxLength: 255 }
    reservations:
      type: array
      minItems: 1
      maxItems: 200
      items: { $ref: '#/components/schemas/ReservationKey' }
responses:
  '200':
    schema:
      type: object
      required: [batchId, items]
      properties:
        batchId: { type: string, format: uuid }
        items: { type: array, items: { $ref: '#/components/schemas/ReservationOutcome' } }
  '422': # file_not_found
```

Cada reserva é gravada na sua transação (R-05); o pedido responde 200 mesmo com reservas
ignoradas ou com falha — o desfecho de cada uma está em `items`. O `fileName` precisa ter a mesma
extensão aceita para o tipo do arquivo (R-03); senão `415 unsupported_file_type` para o pedido todo.

Exemplo de resposta:

```json
{
  "batchId": "6f1c…",
  "items": [
    { "hotelCode": "H001", "reservationNumber": "123456", "outcome": "registered", "reason": null,
      "classification": "virtual_card_pending_charge", "totalAmount": "540.00", "documentId": "a1…" },
    { "hotelCode": "H001", "reservationNumber": "123457", "outcome": "ignored", "reason": "not_eligible",
      "classification": "virtual_card_already_charged", "totalAmount": "320.00", "documentId": null }
  ]
}
```

## 6. `DELETE /v1/treatment-documents/{documentId}` — desfazer (FR-004)

`204`. O documento passa a `removed` e ganha `revertibleUntil`. `409 document_not_current` se não
for o atual; `404` se não existir.

## 7. `POST /v1/treatment-documents/{documentId}/revert` — reverter (FR-013a)

Sem corpo. `200` com o `ReservationTreatment` atualizado. O documento volta a `current`; o atual do
mesmo tipo, se houver, passa a `replaced`. `409 document_not_revertible` (atual, purgado ou prazo
vencido) ou `409 not_eligible_for_treatment`.

## 8. `GET /v1/treatment-documents/{documentId}/file` — baixar (FR-009)

Disponível para os dois perfis. `200` com o conteúdo idêntico ao enviado e os cabeçalhos:

```text
content-type: <media_type>
content-disposition: attachment; filename="<nome ASCII>"; filename*=UTF-8''<nome original>
x-content-type-options: nosniff
content-security-policy: sandbox
```

Funciona para documentos atuais, substituídos e desfeitos. `410 document_purged` depois da purga.

## 9. Valor manual (FR-005)

```yaml
/reservations/{hotelCode}/{reservationNumber}/manual-amount:
  put:
    operationId: setManualChargedAmount
    requestBody:   # application/json
      type: object
      required: [amount]
      additionalProperties: false
      properties:
        amount: { type: string, pattern: '^[0-9]+\.[0-9]{2}$' }   # maior que zero
    responses:
      '200': ReservationTreatment
      '409': proof_required
  delete:
    operationId: clearManualChargedAmount
    responses:
      '200': ReservationTreatment
```

Remover sem valor gravado responde 200 sem mudar nada.

## 10. `GET /v1/reservations/{hotelCode}/{reservationNumber}/treatment` — documentos e histórico (FR-012, FR-015)

Disponível para os dois perfis.

```yaml
responses:
  '200':
    schema:
      type: object
      required: [treatment, documents, events]
      properties:
        treatment: { $ref: '#/components/schemas/ReservationTreatment' }
        documents:
          type: array        # todos os documentos da reserva, do mais recente para o mais antigo
          items: { $ref: '#/components/schemas/TreatmentDocument' }
        events:
          type: array        # histórico completo, do mais recente para o mais antigo
          items: { $ref: '#/components/schemas/TreatmentEvent' }
```

## 11. `GET /v1/reservations` — filtros e busca por valor (FR-002, FR-015)

```yaml
- name: treatmentStatus
  in: query
  description: none = sem tratativa; sent = Enviada; charged = Cobrada (FR-002). Combinável com os demais.
  schema: { type: array, items: { $ref: '#/components/schemas/TreatmentStatus' } }
  style: form
  explode: true
- name: pendingCharge
  in: query
  description: |
    true = "Falta cobrar": classificação que exige cobrança (FR-003) e sem comprovante
    (treatmentStatus none ou sent). false = o contrário. Omitido = sem esse filtro. Combinável com
    os demais (FR-002, data-model §3).
  schema: { type: boolean }
```

Nenhum parâmetro de consulta é registrado no log do servidor (research R-13).

O parâmetro `amount` passa a achar também o valor manual (descrição atualizada: "valor total, valor
cobrado ou valor cobrado informado à mão").
