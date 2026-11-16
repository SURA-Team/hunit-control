# Data Model: Importação do histórico do sistema anterior

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

A importação grava nas tabelas que já existem (reservas da 001, tratativas da 003) e acrescenta
três tabelas próprias: a associação de hotéis, a origem de cada reserva importada e o registro de
cada simulação ou importação. Nenhuma tabela guarda conteúdo de célula da planilha que o HUNIT
Control já não guardaria para uma reserva verificada por ele (FR-018).

## 1. Tabelas novas

### 1.1 `legacy_imports` — cada simulação ou importação (FR-005, FR-005a)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | mostrado no terminal; `run --simulation <id>` |
| `kind` | enum `legacy_import_kind` | `simulation` ou `import` |
| `simulation_id` | `uuid` FK `legacy_imports`, anulável | só em `import`: a simulação confirmada |
| `status` | enum `legacy_import_status` | `running`, `completed`, `failed`, `interrupted` (R-09) |
| `fingerprint` | `text` | SHA-256 da planilha + arquivos referenciados + associação (R-08) |
| `started_at`, `finished_at` | `timestamptz` | `finished_at` nulo enquanto `running` |
| `counts` | `jsonb` | `{ reservations: {created, updated, ignored, rejected}, requests: {…}, proofs: {…}, manualAmounts: {…}, unreferencedFiles }` |
| `issues` | `jsonb` | lista de `{ sheet, row, legacyHotel, reservationNumber, entity, outcome, reason }` (só ignorados e recusados) |
| `differences` | `jsonb`, anulável | só em `import`: desfechos que mudaram em relação à simulação |
| `warnings` | `jsonb` | avisos gerais (ex.: reservas com `not_virtual_card` sem origem, R-04; hotéis sem associação) |

`issues` só tem códigos, números de linha, o código do hotel do sistema anterior e o número da
reserva (FR-018). Guardada sem prazo: não tem dado pessoal.

### 1.2 `legacy_hotel_mappings` — associação de hotéis (FR-006a)

| Coluna | Tipo | Regra |
|---|---|---|
| `legacy_key` | `text` PK | "Codigo hotel" do sistema anterior (minúsculas com `_`) |
| `legacy_name` | `text` | "Hotel" da última simulação |
| `decision` | enum `legacy_hotel_decision` | `proposed`, `confirmed`, `unmapped` |
| `hotel_code` | `text` FK `hotels`, anulável | preenchido em `proposed` (se houver proposta) e em `confirmed`; nulo em `unmapped` |
| `updated_at` | `timestamptz` | |

`check`: `decision = 'confirmed'` exige `hotel_code`; `decision = 'unmapped'` exige `hotel_code` nulo.

### 1.3 `legacy_reservations` — origem "Sistema anterior" de uma reserva (FR-010, FR-011)

| Coluna | Tipo | Regra |
|---|---|---|
| `hotel_code`, `reservation_number` | PK, FK `reservations` | |
| `legacy_hotel_key` | `text` | código do hotel no sistema anterior |
| `original_classification` | `text` | "Codigo status" como estava na planilha (pode ser um valor desconhecido) |
| `original_previous_classification` | `text`, anulável | "Status anterior" como estava |
| `first_verified_at`, `last_verified_at` | `timestamptz` | do sistema anterior |
| `verification_count` | `integer` | do sistema anterior, ≥ 1 |
| `merged` | `boolean` | `true` = a reserva já tinha sido verificada pelo HUNIT Control quando foi importada (FR-010) |
| `applied_count` | `integer` | quanto foi somado a `reservations.verification_count` por esta origem (R-06) |
| `row_hash` | `text` | SHA-256 dos valores normalizados da linha (R-06, FR-010a) |
| `first_import_id`, `last_import_id` | `uuid` FK `legacy_imports` | |

Ter linha aqui = reserva com a marcação "Sistema anterior" (FR-011), para sempre, mesmo depois de
verificada pelo HUNIT Control. A retenção não apaga esta linha (não tem dado pessoal).

## 2. Mudanças em tabelas existentes

| Tabela | Mudança | Por quê |
|---|---|---|
| `reservations` | `last_execution_id` passa a anulável | reserva só do sistema anterior não tem execução (R-06); `null` = "ainda não verificada pelo HUNIT Control" |
| `treatment_documents` | `legacy_import_id uuid` FK `legacy_imports`, anulável | documento criado por importação (R-05, R-07) |
| `treatment_events` | `legacy_import_id uuid` FK `legacy_imports`, anulável | evento criado por importação (FR-016) |
| `reservation_manual_amounts` | `legacy_import_id uuid` FK `legacy_imports`, anulável | valor manual vindo do sistema anterior (FR-015) |
| `api_clients` | linha reservada `sistema-anterior` (perfil `reader`, revogada, sem chave) | autor dos registros importados (R-05) |

Enums novos: `legacy_import_kind`, `legacy_import_status`, `legacy_hotel_decision`. Nenhum valor
novo em `classification` (R-04). Uma migration nova, gerada pelo `db:generate`.

## 3. Da planilha para o HUNIT Control

### 3.1 Aba "Reservas" → `reservations` (reserva nova ou ainda não verificada)

| Coluna da planilha | Campo | Regra |
|---|---|---|
| Codigo hotel (*) | `hotel_code` | pela associação confirmada (§1.2) |
| Reserva (*) | `reservation_number` | texto, sem espaços nas pontas |
| Hospede | `guest_name` | `null` se vazio ou se check-in há mais de 5 anos (FR-022) |
| Canal | `channel` | texto; vazio → `""` |
| Entrada (*), Saida (*) | `check_in`, `check_out` | data (R-03); saída ≥ entrada |
| Periodo da hospedagem | `stay_period` | texto; vazio → `""` |
| Total da reserva (*) | `total_amount` | dinheiro (R-03) |
| Codigo status (*) | `classification` | conversão (R-04) |
| Motivo | `reason` | `Sistema anterior: <Motivo>`; em "A revisar", motivo fixo com o código original |
| Pre-pagamento encontrado | `pre_payment_found` | sim/não; vazio → `false` |
| Cobrado em, Cobrado por, Valor cobrado | `charged_at`, `charged_by`, `charged_amount` | data e hora, texto, dinheiro |
| ID da transacao, Codigo de autorizacao, Referencia do processador | mesmos campos | texto |
| Parcelado, Numero de parcelas, Valor da parcela | `is_installment`, `installment_count`, `installment_amount` | sim/não, inteiro, dinheiro |
| Estado do pre-pagamento, Mensagem do pre-pagamento | `pre_payment_state`, `pre_payment_message` | texto |
| Acao de cobranca visivel | `charge_action_visible` | sim/não; vazio → `false` |
| Primeira verificacao (*), Ultima verificacao (*) | `first_verified_at`, `last_verified_at` | data e hora; primeira ≤ última |
| Quantidade de verificacoes (*) | `verification_count` | inteiro ≥ 1 |
| — | `changed_fields` | vazio (os nomes de campo do sistema anterior não são os do HUNIT Control) |
| Status alterado na ultima verificacao | `status_changed` | sim/não; vazio → `false` |
| Status anterior | `previous_classification` | conversão (R-04); vazio → `null` |
| Ultima alteracao de status | `status_changed_at` | data e hora |
| — | `reservation_status` | `unknown` (FR-008) |
| — | `payment_form`, `not_found_since`, `last_execution_id` | `null` |
| — | `anonymized_at` | agora, se check-in há mais de 5 anos (FR-022) |

Colunas que só informam e não são gravadas: Hotel (só associação), Status (rótulo), Requer
tratamento manual (o HUNIT Control deriva da classificação), Dados alterados na ultima verificacao
e Campos alterados (nomes de campo do sistema anterior).

### 3.2 Reserva já verificada pelo HUNIT Control (FR-010)

Só mudam `first_verified_at = min(HUNIT Control, sistema anterior)` e `verification_count +=
verification_count do sistema anterior`. Classificação, dados, última verificação, campos alterados
e status anterior continuam os do HUNIT Control. A linha em `legacy_reservations` guarda o que o
sistema anterior tinha (é o "registro do sistema anterior no histórico" da spec).

### 3.3 Aba "Tratativas" → documentos, valor manual e eventos (FR-012 a FR-016)

| Colunas | Vira | Data original |
|---|---|---|
| Tratativa - arquivo no Dropbox / nome original / anexada em | documento `request` | "Tratativa anexada em" (vazia → "Atualizado em") |
| Comprovante - arquivo no Dropbox / nome original / anexado em | documento `proof` | "Comprovante anexado em" (vazia → "Atualizado em") |
| Anexo antigo - arquivo no Dropbox / nome original / em | `proof` se o código original era `virtual_card_pending_charge`, senão `request` (R-07) | "Anexo antigo em" |
| Valor manual / alterado em | `reservation_manual_amounts` + evento `amount_set` | "Valor manual alterado em" (vazia → "Atualizado em") |

Sem nenhuma data legível, a data original é a "Ultima verificacao" da reserva no sistema anterior e
o relatório registra o aviso `original_date_missing`. Cada documento gravado gera um evento
`attached` (ou `replaced`, R-07) com `legacy_import_id`, `client_id` = autor reservado e `at` = data
original.

## 4. Desfechos e motivos (relatório, FR-005 e FR-006)

Desfechos por entidade: `created`, `updated`, `ignored`, `rejected`.

| Código | Desfecho | Entidade | Texto no relatório |
|---|---|---|---|
| `missing_column` | (para tudo) | planilha | Coluna obrigatória ausente: <nome da coluna> |
| `hotel_not_mapped` | rejected | reserva | Hotel sem associação no catálogo |
| `missing_value` | rejected | reserva | Dado obrigatório vazio: <nome da coluna> |
| `unreadable_date` | rejected | reserva/documento | Data ilegível: <nome da coluna> |
| `unreadable_amount` | rejected | reserva/valor | Valor ilegível: <nome da coluna> |
| `unreadable_number` | rejected | reserva | Número ilegível: <nome da coluna> |
| `inconsistent_dates` | rejected | reserva | Datas incoerentes (saída antes da entrada, ou primeira verificação depois da última) |
| `duplicated_in_sheet` | ignored | reserva | Linha repetida na planilha (vale a de última verificação mais recente) |
| `unchanged` | ignored | reserva | Já importada, sem mudança |
| `reservation_rejected` | rejected | documento/valor | A reserva desta tratativa foi recusada |
| `reservation_not_in_sheet` | rejected | documento/valor | Reserva sem linha na aba de reservas nem no HUNIT Control |
| `file_not_found` | rejected | documento | Arquivo não encontrado na pasta |
| `empty_file` | rejected | documento | Arquivo vazio |
| `unsupported_file_type` | rejected | documento | Tipo não aceito |
| `file_type_mismatch` | rejected | documento | Conteúdo diferente do tipo do arquivo |
| `file_too_large` | rejected | documento | Arquivo acima de 25 MB |
| `kept_hunit_control` | ignored | documento/valor | Já registrado no HUNIT Control (prevalece) |
| `already_imported` | ignored | documento/valor | Já importado, sem mudança |
| `superseded_in_legacy` | ignored | documento | Anexo antigo substituído por documento mais novo na mesma linha |
| `manual_amount_without_proof` | rejected | valor | Valor manual sem comprovante |

Avisos (`warnings`, não recusam nada): `original_date_missing`, `anonymized_on_import` (contagem de
reservas com check-in há mais de 5 anos), `unreferenced_files` (contagem), `obsolete_classification_in_use`
(R-04), `previous_import_incomplete` (R-09).

## 5. Classificação "A revisar (sistema anterior)" (R-04)

| Regra | `not_virtual_card` |
|---|---|
| `acceptsTreatment` (registrar, substituir, reverter) | sim (antes: não) |
| `requiresCharge` (nova): entra no "Falta cobrar" | não |
| Situação com só tratativa | a própria classificação ("A revisar (sistema anterior)") |
| Alerta "Verificar" | nunca |
| Situação com comprovante | "Comprovante enviado" |
| Sai dela | na primeira verificação pelo HUNIT Control (FR-018b da 001) |

Para as demais classificações, `requiresCharge = acceptsTreatment` e nada muda.

## 6. Nomes em português (app e relatório)

| Valor | Texto |
|---|---|
| `classification: not_virtual_card` | A revisar (sistema anterior) |
| `Reservation.legacy` presente | selo "Sistema anterior" |
| `fromLegacy` (filtro) | "Origem": Todas / Sistema anterior / HUNIT Control |
| `lastExecutionId` ausente | "Ainda não verificada pelo HUNIT Control" |
| `legacy.originalClassification` | nome do sistema anterior: Ignorada - prefixo 258, Pre-pagamento cobrado, Pre-pagamento pendente, Erro na cobranca, Erro de analise, Sem cartao virtual (com acentos no app); outro código → o próprio código |
| eventos e documentos com `fromLegacy` | autor "Sistema anterior", com a data original |
