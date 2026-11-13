# Data Model: Tratativas manuais das reservas

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

A tratativa é uma camada **ao lado** da reserva: nenhuma coluna de `reservations` (specs/001,
data-model) muda, e o coletor do Hunit não lê nem grava nenhuma das tabelas abaixo (FR-007,
SC-004). A ligação é pela chave da reserva, hotel + número (specs/001, FR-017).

## 1. Tabelas novas

### 1.1 `treatment_files` — conteúdo dos arquivos (R-01)

| Coluna | Tipo | Regra |
|---|---|---|
| `sha256` | `text` PK | SHA-256 do conteúdo, em hexadecimal minúsculo; também é o `fileId` da API |
| `content` | `bytea` | 1 byte a 26 214 400 bytes (FR-008) |
| `size_bytes` | `integer` | `= octet_length(content)` |
| `media_type` | `text` | decidido pelo servidor (R-03): `application/pdf`, `image/png`, `image/jpeg`, `message/rfc822` (.eml), `application/vnd.ms-outlook` (.msg) |
| `created_at` | `timestamptz` | primeiro envio desse conteúdo |
| `uploaded_by_client_id` | `uuid` FK `api_clients` | quem enviou primeiro |

Um mesmo conteúdo enviado de novo não cria linha nova (deduplicação). Linhas sem documento que
aponte para elas são apagadas pela manutenção depois de 24 h (R-07).

### 1.2 `treatment_documents` — documentos das reservas

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | |
| `hotel_code`, `reservation_number` | `text` | FK composta para `reservations` |
| `kind` | enum `treatment_document_kind` | `request` (tratativa: pedido de cobrança) ou `proof` (comprovante) |
| `state` | enum `treatment_document_state` | `current`, `replaced`, `removed`, `purged` (§2) |
| `file_sha256` | `text` FK `treatment_files`, anulável | `null` só quando `purged` |
| `original_name` | `text`, anulável | nome do arquivo como escolhido (1 a 255 caracteres, sem `/`, `\` nem caracteres de controle); `null` só quando `purged` |
| `size_bytes`, `media_type` | | copiados do arquivo, para listar sem ler o conteúdo; mantidos após a purga |
| `attached_at` | `timestamptz` | |
| `attached_by_client_id` | `uuid` FK `api_clients` | |
| `ended_at` | `timestamptz`, anulável | quando deixou de ser atual (substituído ou desfeito) |
| `ended_by_client_id` | `uuid` FK, anulável | |
| `purged_at` | `timestamptz`, anulável | |

Restrições:

- índice único parcial em (`hotel_code`, `reservation_number`, `kind`) onde `state = 'current'`:
  no máximo um documento atual por reserva e tipo (FR-001, R-05);
- `check`: `state = 'current'` ⇔ `ended_at is null`; `state = 'purged'` ⇔ `file_sha256 is null`
  e `original_name is null`;
- índice em (`hotel_code`, `reservation_number`) para a consulta e o filtro (SC-008);
- índice em `ended_at` onde `state in ('replaced', 'removed')`, para a purga diária.

### 1.3 `reservation_manual_amounts` — valor cobrado informado à mão (FR-005)

| Coluna | Tipo | Regra |
|---|---|---|
| `hotel_code`, `reservation_number` | PK, FK `reservations` | |
| `amount` | `numeric(12,2)` | maior que zero |
| `set_at` | `timestamptz` | |
| `set_by_client_id` | `uuid` FK `api_clients` | |

Remover o valor apaga a linha (o histórico guarda o evento). Só pode existir com um comprovante
atual na reserva (FR-005); desfazer o comprovante **não** apaga o valor sozinho — ele fica sem
efeito na exibição até haver comprovante de novo, e o operador pode removê-lo. Assim, reverter o
comprovante (FR-013a) traz de volta o valor que já estava.

### 1.4 `treatment_events` — histórico (FR-012)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `bigserial` PK | ordem dos eventos |
| `hotel_code`, `reservation_number` | `text` | FK `reservations` |
| `type` | enum | `attached`, `replaced`, `removed`, `reverted`, `amount_set`, `amount_cleared` |
| `kind` | enum `treatment_document_kind`, anulável | nos eventos de documento |
| `document_id` | `uuid` FK `treatment_documents`, anulável | documento que ficou atual (`attached`, `reverted`) ou que deixou de ser (`removed`) |
| `previous_document_id` | `uuid`, anulável | o que foi substituído (`replaced`, `reverted`) |
| `amount` | `numeric(12,2)`, anulável | nos eventos de valor |
| `batch_id` | `uuid`, anulável | mesmo valor para tudo o que foi gravado no mesmo pedido em lote (R-05) |
| `client_id` | `uuid` FK `api_clients` | quem fez |
| `at` | `timestamptz` | |

Só inclusão: nenhuma operação da API altera ou apaga eventos. Não guarda nome de arquivo (R-06).

## 2. Estados de um documento

```text
             registrar                 registrar outro do mesmo tipo
   (nada) ─────────────► current ─────────────────────────────────► replaced ─┐
                           │  ▲                                                │
                  desfazer │  │ reverter (≤ 30 dias, reserva elegível)         │ 30 dias
                           ▼  │                                                ▼
                         removed ────────────────── 30 dias ─────────────► purged
                                                                                ▲
             current / replaced / removed ── reserva anonimizada (5 anos) ──────┘
```

- **Reverter** um `replaced` ou `removed` dentro do prazo: ele volta a `current`; o `current` do
  mesmo tipo, se houver, passa a `replaced` com `ended_at` = agora (prazo novo de 30 dias). Recusado
  se a reserva não aceita registros (FR-003) ou se o prazo venceu (FR-013a).
- **Purga** apaga o vínculo com o arquivo e o nome; o arquivo some quando nenhum outro documento o
  usa (§1.1).

Prazo de reversão (`revertibleUntil`) = `ended_at` + 30 dias (R-04).

## 3. Situação exibida e valores (FR-002, FR-005)

Calculadas pelo servidor com as funções do domínio (R-04) e devolvidas prontas na API:

| Documentos atuais | `treatmentStatus` | Nome no app | Conta como pendência |
|---|---|---|---|
| comprovante (com ou sem tratativa) | `charged` | Cobrada | não |
| só tratativa | `sent` | Enviada | sim |
| nenhum | `none` | (a classificação, sem marcação) | conforme a classificação |

- A classificação calculada continua no campo `classification`, sem mudança; o app mostra
  "Cobrada" ou "Enviada" junto dela.
- O filtro `classification` continua comparando a classificação calculada. A lista "o que falta
  cobrar" é `classification` ∈ {pendentes} **e** `treatmentStatus` ∈ {`none`, `sent`}.
- Uma reserva com documentos que passou a uma classificação que não aceita registros (ex.:
  "já cobrada" pelo Hunit) mantém os documentos e o `treatmentStatus` (caso-limite da spec).
- Valor cobrado: `payment.chargedAmount` (Hunit) e `treatment.manualChargedAmount` (à mão) vêm
  separados; `treatment.effectiveChargedAmount` = o do Hunit quando existe, senão o manual (só com
  comprovante atual).

## 4. Elegibilidade (FR-003)

| Classificação | Aceita tratativa e comprovante |
|---|---|
| `virtual_card_pending_charge` (pendente de cobrança) | sim |
| `virtual_card_charge_error` (erro na cobrança) | sim |
| `virtual_card_validated_only` (cartão validado, não cobrado) | sim |
| `analysis_error` (erro de análise) | sim |
| `charge_at_terminal` (cobrar na maquininha) | sim |
| `ignored_hotelbeds_258`, `invoiced`, `cancelled_no_charge`, `virtual_card_already_charged`, `not_virtual_card` | não |

Vale para registrar, substituir e reverter. Desfazer e remover o valor manual são sempre aceitos
(corrigir um engano não depende da classificação).

## 5. Motivos de recusa por reserva (lote e `check`)

| Código | Quando |
|---|---|
| `not_found` | reserva não existe |
| `not_eligible` | classificação não aceita registros (§4) |
| `same_file` | a reserva já tem esse mesmo arquivo como documento atual desse tipo (nada a fazer) |

Os desfechos possíveis são `registered` (novo), `replaced` (substituiu o atual), `ignored` (com um
dos motivos acima) e `failed` (erro inesperado; a reserva fica como estava e pode ser repetida).

## 6. Estado do app (em memória)

| Estado | Onde | Ciclo de vida |
|---|---|---|
| Seleção do lote: chave + dados para a lista (número, hotel, hóspede, valor, situação) | interface (provider no `App.tsx`) | até aplicar (ficam só as `failed`), limpar ou fechar o app (FR-006a, R-09) |
| Arquivo escolhido: bytes, nome, tamanho, tipo, modelo de pré-visualização | processo principal | até confirmar, cancelar ou 15 min sem uso (R-08) |

Nenhum dos dois vai para o disco (FR-018a; specs/002, FR-008a).

## 7. Nomes em português (app)

| Valor | Texto |
|---|---|
| `kind: request` | Tratativa |
| `kind: proof` | Comprovante |
| `treatmentStatus: sent` | Enviada |
| `treatmentStatus: charged` | Cobrada |
| `treatmentStatus: none` (filtro) | Sem tratativa |
| `state: replaced` | Substituído |
| `state: removed` | Desfeito |
| `state: purged` | Arquivo apagado pelo prazo de retenção |
| eventos | Anexou, Substituiu, Desfez, Reverteu, Informou valor, Removeu valor |
| `not_eligible` | "Esta reserva não exige cobrança (situação: …)" |
| `same_file` | "Esta reserva já tem este arquivo" |
| `file_too_large` | "O arquivo tem mais de 25 MB" |
| `unsupported_file_type` | "Tipo não aceito. Use e-mail (.eml ou .msg), PDF ou imagem (.png, .jpg)" |
| `empty_file` | "O arquivo está vazio" |
