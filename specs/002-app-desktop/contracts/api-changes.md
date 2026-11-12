# Contrato: acréscimos à API (1.3.0 → 1.4.0)

**Feature**: [spec.md](../spec.md) | **Research**: [R-10](../research.md#r-10--o-que-a-api-ganha-nesta-feature-contrato-130--140)

A fonte da verdade continua sendo `packages/contracts/openapi.yaml`. Este documento descreve o que
a feature 002 acrescenta. Todos os itens são **compatíveis**: nenhum cliente existente quebra, por
isso a versão sobe só na parte MINOR (`info.version: 1.4.0`). Depois de aplicar no `openapi.yaml`,
regenerar os tipos (`pnpm --filter @hunit/contracts generate`) e copiar o arquivo para
`specs/002-app-desktop/contracts/openapi.yaml` (research R-15).

Cada acréscimo exige teste de contrato no grupo `server-db` (constitution, princípio VII).

---

## 1. `GET /v1/me` — quem é o cliente da chave (FR-004, FR-012)

Disponível para os dois perfis.

```yaml
/me:
  get:
    tags: [clients]
    operationId: getCurrentClient
    summary: Nome e perfil do cliente dono da chave usada (feature 002)
    responses:
      '200':
        description: Cliente autenticado
        content:
          application/json:
            schema: { $ref: '#/components/schemas/ClientIdentity' }
      '401': { $ref: '#/components/responses/Unauthorized' }

# components/schemas
ClientRole:
  type: string
  enum: [operator, reader]
ClientIdentity:
  type: object
  required: [name, role]
  properties:
    name: { type: string, description: 'Mesmo valor de Execution.requestedClient para as execuções iniciadas por este cliente' }
    role: { $ref: '#/components/schemas/ClientRole' }
```

## 2. Lista de execuções: quem iniciou e filtro de ativas (FR-015, FR-019)

```yaml
# GET /executions — parâmetro novo
- name: active
  in: query
  description: |
    true = só execuções ativas (queued, running, awaiting_2fa); false = só encerradas;
    omitido = todas. Combinável com `status`.
  schema: { type: boolean }

# components/schemas/ExecutionSummary — campo novo, sempre presente
requestedClient: { type: string, description: Nome do cliente que iniciou (ou retomou) }
# (ExecutionSummary.required passa a incluir requestedClient; Execution já o tinha)
```

Regras: `active=true` com `status` de execução encerrada devolve lista vazia (sem erro). A ordem
continua "mais recentes primeiro".

## 3. Reservas: busca livre, canal e valor (FR-020, FR-020a, FR-020b)

```yaml
# GET /reservations — parâmetros novos, combináveis entre si e com os existentes (E lógico)
- name: q
  in: query
  description: |
    Busca livre. Encontra a reserva se o número da reserva, a transação, o código de
    autorização ou a referência da operadora forem iguais ao texto (sem diferenciar
    maiúsculas), ou se o nome do hóspede contiver o texto (sem diferenciar maiúsculas e
    acentos). Espaços nas pontas são ignorados. Reservas anonimizadas não são encontradas
    pelo nome.
  schema: { type: string, minLength: 2, maxLength: 100 }
- name: channel
  in: query
  description: Canal exatamente como em Reservation.channel (ver GET /channels)
  schema: { type: string, minLength: 1, maxLength: 100 }
- name: amount
  in: query
  description: Valor em BRL; encontra reservas cujo valor total OU valor cobrado seja igual
  schema: { type: string, pattern: '^[0-9]+\.[0-9]{2}$' }
```

Exemplos de aceitação (testes de contrato e integração):

| Consulta | Encontra |
|---|---|
| `q=aut-0042` | reserva com `authorizationCode = "AUT-0042"` em qualquer hotel |
| `q=joao` | hóspedes "João Silva" e "JOÃO PEREIRA"; não encontra reserva anonimizada |
| `q=258-1234&hotelCode=H1` | só a reserva 258-1234 do hotel H1 |
| `amount=1234.50` | reservas com total 1234.50 ou valor cobrado 1234.50 |
| `q=a` | `400 validation_error` (mínimo de 2 caracteres) |
| `amount=1.234,50` | `400 validation_error` (formato da API; a interface converte antes) |

## 4. `GET /v1/channels` — canais existentes (filtro da FR-020)

```yaml
/channels:
  get:
    tags: [reservations]
    operationId: listChannels
    summary: Canais presentes nas reservas gravadas, em ordem alfabética (feature 002)
    responses:
      '200':
        description: Lista de canais
        content:
          application/json:
            schema:
              type: object
              required: [items]
              properties:
                items: { type: array, items: { type: string } }
      '401': { $ref: '#/components/responses/Unauthorized' }
```

## 5. `GET /v1/executions/{executionId}/evidence` — evidências da execução (FR-024)

Hoje o identificador da evidência só aparece dentro do texto da mensagem do evento
`evidence_recorded`; esta rota dá a lista estruturada. Evidências vencidas já foram removidas pela
rotina diária e não aparecem; o download de uma que venceu entre a lista e o clique continua
respondendo `evidence_expired`.

```yaml
/executions/{executionId}/evidence:
  parameters:
    - $ref: '#/components/parameters/ExecutionId'
  get:
    tags: [evidence]
    operationId: listExecutionEvidence
    summary: Evidências de falha registradas na execução (feature 002)
    responses:
      '200':
        description: Evidências, mais recentes primeiro
        content:
          application/json:
            schema:
              type: object
              required: [items]
              properties:
                items:
                  type: array
                  items: { $ref: '#/components/schemas/EvidenceSummary' }
      '401': { $ref: '#/components/responses/Unauthorized' }
      '404': { $ref: '#/components/responses/NotFound' }

# components/schemas
EvidenceSummary:
  type: object
  required: [id, kind, reason, files, createdAt, expiresAt]
  properties:
    id: { type: string, format: uuid }
    hotelCode: { type: [string, 'null'] }
    reservationNumber: { type: [string, 'null'] }
    kind:
      type: string
      enum: [navigation_failure, classification_failure, screen_not_recognized, reservation_status_unknown]
    reason: { type: string }
    files:
      type: array
      minItems: 1
      items: { type: string, enum: [screenshot, html, response] }
      description: Arquivos disponíveis para GET /evidence/{evidenceId}/{file}
    createdAt: { type: string, format: date-time }
    expiresAt: { type: string, format: date-time }
```

## 6. O que não muda

- Autenticação (`Authorization: Bearer <chave>`), formatos de erro (`application/problem+json`) e
  todas as rotas e campos existentes.
- As rotas novas são de leitura e não entram em `OPERATOR_ONLY_OPERATIONS` (perfil consulta pode
  usá-las).
- Nenhuma rota nova acessa o Hunit; a camada do Hunit e o `read-only-guard` não mudam.
