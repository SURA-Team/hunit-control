# Research: Importação do histórico do sistema anterior

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Decisões técnicas da Fase 0. A spec não deixou nenhum `NEEDS CLARIFICATION`: as quatro decisões de
2026-11-16 (comando no servidor, cópia .xlsx, "A revisar (sistema anterior)" e colunas conferidas)
já estão nela. Esta pesquisa resolve o **como**.

A estrutura da planilha foi conferida no **código** do sistema anterior (gravação no Sheets com
`valueInputOption: RAW`, colunas e regras do anexo antigo), nunca nos dados.

---

## R-01 — Onde e como o comando roda (FR-002, FR-019, FR-020)

- **Decision**: subcomando `legacy-import` do `apps/server/src/cli.ts`, que já reúne os comandos
  administrativos (`create-client`, `revoke-client`). Na produção, roda num container de uso único
  do serviço `server`, com a pasta da importação montada **só para leitura**:

  ```text
  docker compose run --rm -v "C:\importacao:/import:ro" server node dist/cli.js legacy-import simulate --xlsx /import/planilha.xlsx --files /import/anexos
  ```

  Em desenvolvimento e nos testes, o mesmo código roda com `pnpm --filter @hunit/server
  legacy-import …` (script novo no `package.json`, depois do `pnpm build`), apontando para o banco
  de teste ou de homologação.
- **Uma importação por vez** (FR-020): o comando pega um *advisory lock* do PostgreSQL
  (`pg_try_advisory_lock` com uma chave fixa) na conexão dele, durante a simulação e a importação.
  Se outro processo já tem o lock, o comando termina com "Já existe uma importação em andamento".
  O lock some sozinho se o processo morrer (a conexão cai), sem estado preso no banco.
- **Rationale**: a importação acontece uma vez e lê dados pessoais e financeiros; um comando local
  não abre rota nova na API, não faz os arquivos trafegarem pela rede (FR-002) e não precisa de
  perfil novo. O `docker compose run` reaproveita a imagem e as variáveis do `server` (inclusive
  `DATABASE_URL`) sem publicar portas; a montagem só para leitura não deixa estado em disco fora dos
  volumes declarados (constitution, princípio V) e desaparece com o container.
- **Alternatives considered**: `docker compose cp` para dentro do container `server` em execução
  (deixa cópia dos arquivos no container até ele ser recriado); volume novo no Compose (estado
  permanente para um uso único); rota na API (rejeitada na clarificação).

## R-02 — Leitura do .xlsx (FR-003, FR-004)

- **Decision**: biblioteca `read-excel-file` (entrada `read-excel-file/node`), em `dependencies` do
  `@hunit/server`, na versão mais nova publicada há 3 dias ou mais (hoje 9.3.15; a regra do
  `pnpm-workspace.yaml` já impede uma mais nova). Sem script de instalação. Lê as abas pelo nome
  ("Reservas" e "Tratativas") e as colunas pelo nome do cabeçalho, em qualquer ordem (FR-003). Para
  os testes, `write-excel-file` (mesmo autor) em `devDependencies` gera a planilha fictícia na hora:
  nenhum `.xlsx` vai para o repositório (o `.gitignore` já bloqueia `*.xlsx`).
- **Rationale**: dependências pequenas (`fflate`, `saxen`) e mantida (versões em 2026); só lê, o que
  é tudo o que a importação precisa; devolve células com data já como `Date`.
- **Alternatives considered**: `exceljs` 4.4.0 (sem versão nova desde 2023, puxa `archiver`, `tmp` e
  `unzipper` antigos, e também escreve arquivos); SheetJS (`xlsx`) (fora do registro do npm, o que
  foge da regra de idade mínima das versões); ler o ZIP e o XML à mão (mais código para manter, sem
  ganho).

## R-03 — Interpretação dos valores das células (FR-006, FR-008)

O sistema anterior gravava no Sheets com `RAW`: datas e datas com hora como **número de série** (dias
desde 1899-12-30, com fração do dia), números como números e o resto como texto. As colunas da aba
de tratativas ("… anexada em", "Atualizado em", "Valor manual alterado em") eram texto ISO
(`2026-05-01T10:15:00`), e o "Valor manual" era texto com ponto decimal. Numa cópia .xlsx, uma
célula com formato de data chega como `Date`.

- **Decision**: funções puras em `@hunit/domain` (`legacy-values.ts`) aceitam, por tipo de coluna:
  - **data e hora** (`Primeira verificacao`, `Cobrado em`, …): `Date`, número de série, texto ISO
    (`AAAA-MM-DD[THH:MM[:SS]]`) ou `DD/MM/AAAA[ HH:MM[:SS]]`. O valor é a hora **de Brasília**,
    gravada como instante UTC somando 3 horas (o Brasil não tem horário de verão desde 2019, e o
    sistema anterior rodou em 2026);
  - **data** (`Entrada`, `Saida`): os mesmos formatos, sem hora;
  - **dinheiro**: número, `1234.56`, `1.234,56` ou `R$ 1.234,56`; vira string decimal com duas casas
    (specs/001, R-17); negativo é ilegível;
  - **inteiro** (`Quantidade de verificacoes`, `Numero de parcelas`): número inteiro ≥ 0, ou texto
    com um;
  - **sim/não**: booleano, `TRUE`/`FALSE`, `Sim`/`Não`, `true`/`false`; vazio = desconhecido.
  Célula vazia em coluna opcional = `null`. Qualquer outro conteúdo é **ilegível** e recusa a linha
  com o código do motivo (R-08), sem repetir o valor.
- **Rationale**: aceita as duas formas que uma cópia baixada pode trazer (célula formatada ou número
  cru) sem depender de como o Google formatou cada coluna; regra testável sem I/O.
- **Alternatives considered**: exigir um formato só (frágil: o formato depende da exportação);
  guardar o fuso numa variável de ambiente (sem necessidade; o fuso dos dados é fixo).

## R-04 — "A revisar (sistema anterior)" e a conversão das classificações (FR-007, FR-007a)

- **Decision**: reaproveitar o valor **`not_virtual_card`** da classificação, obsoleto desde a R-22
  da 001 (nunca mais produzido pelo coletor e sem registros na produção), como **"A revisar
  (sistema anterior)"**. É o mesmo código que o sistema anterior gravava para "Sem cartão virtual".
  Muda o significado documentado, o nome no app e as regras de tratativa do domínio:
  - `acceptsTreatment('not_virtual_card')` passa a `true` (aceita tratativa e comprovante, FR-007a);
  - função nova **`requiresCharge(classification)`**: as que aceitam tratativa, **menos**
    `not_virtual_card`. Passa a ser a base de `isPendingCharge` ("Falta cobrar"), de
    `reservationSituation` (só com tratativa e `requiresCharge` → "Tratativa enviada") e de
    `needsReview`;
  - com só tratativa, `not_virtual_card` fica com a situação "A revisar (sistema anterior)" e
    **sem** alerta (FR-007a): `needsReview` devolve `false` para ela;
  - `CLASSIFICATIONS_REQUIRING_CHARGE` substitui `CLASSIFICATIONS_ACCEPTING_TREATMENT` nos filtros SQL
    de `pendingCharge`, `needsReview` e `situation` do `reservations-repo.ts` (três usos). As
    verificações de elegibilidade do `treatments-repo.ts` continuam com `acceptsTreatment`.

  Conversão (FR-007), pela coluna "Codigo status":

  | Código do sistema anterior | Classificação |
  |---|---|
  | `ignored_hotelbeds_258` | `ignored_hotelbeds_258` |
  | `virtual_card_already_charged` | `virtual_card_already_charged` |
  | `virtual_card_pending_charge` | `virtual_card_pending_charge` |
  | `virtual_card_charge_error` | `virtual_card_charge_error` |
  | `analysis_error` | `analysis_error` |
  | `not_virtual_card` ou qualquer outro valor não vazio | `not_virtual_card` ("A revisar (sistema anterior)") |
  | vazio | linha recusada (`missing_value`) |

  A coluna "Status anterior" passa pela mesma tabela e também aceita os rótulos da coluna "Status"
  (`Pre-pagamento pendente` etc.), sem diferenciar maiúsculas e acentos. O código original fica
  guardado em `legacy_reservations.original_classification` (data-model §1.3).
- **Rationale**: nenhum valor novo no enum do banco e no contrato; o valor já existe para registros
  antigos e é literalmente a classificação de origem dessas reservas. A coletora nunca o produz, então
  ele só aparece em reservas importadas ainda não verificadas pelo HUNIT Control, e sai sozinho na
  próxima verificação (FR-018b da 001, sem código novo).
- **Risco e controle**: uma reserva gravada antes da R-22 com `not_virtual_card` passaria a aparecer
  como "A revisar". O comando confere, na simulação, quantas reservas têm `not_virtual_card` sem
  linha em `legacy_reservations`. Se houver alguma, o relatório avisa (a R-22 registrou que na
  prática não há).
- **Alternatives considered**: valor novo `legacy_review` no enum (dois valores para a mesma coisa,
  enum do banco e do contrato mudando, cliente antigo recebendo valor desconhecido); `analysis_error`
  com marcação (rejeitado na clarificação: lotaria o "Falta cobrar"); marcação à parte da
  classificação (exigiria mudar a derivação da situação em todos os filtros).

## R-05 — Autoria "Sistema anterior" (FR-016)

As colunas de autoria das tabelas da 003 (`treatment_files.uploaded_by_client_id`,
`treatment_documents.attached_by_client_id`, `reservation_manual_amounts.set_by_client_id` e
`treatment_events.client_id`) são obrigatórias e apontam para `api_clients`.

- **Decision**: um **autor reservado** em `api_clients`, de nome `sistema-anterior`, criado pelo
  comando na primeira importação se não existir: perfil `reader`, **já revogado** (`revoked_at`
  preenchido) e com `key_hash` de 32 bytes aleatórios cuja chave nunca existiu. Nenhuma chave dá
  acesso como ele. O `create-client` passa a recusar esse nome. Os registros importados ganham
  também `legacy_import_id` (documento, evento, valor), que diz qual importação os criou; a API
  devolve `fromLegacy: true` e o app mostra "Sistema anterior". As datas (`attached_at`, `set_at`,
  `at`) são as **originais** da planilha; o momento da importação vem de `legacy_imports`.
- **Rationale**: nenhuma coluna de autoria vira opcional, nenhuma consulta da 003 muda, e o contrato
  continua devolvendo `attachedBy` como texto. A constitution exige credencial própria de **quem
  usa** a API; o autor reservado não usa a API e não tem credencial.
- **Alternatives considered**: tornar as quatro colunas opcionais com uma coluna de origem (muda
  junções, tipos e o contrato, `attachedBy` passaria a anulável); um cliente com chave válida
  (abriria um acesso sem dono).

## R-06 — Reservas importadas e regra de precedência (FR-008 a FR-011)

- **Decision**:
  1. `reservations.last_execution_id` passa a **anulável**: `null` = a reserva veio do sistema
     anterior e o HUNIT Control ainda não a verificou. O coletor sempre o preenche, então a
     primeira verificação o grava. Na API, `lastExecutionId` já é opcional.
  2. Tabela nova **`legacy_reservations`** (data-model §1.3), uma linha por reserva importada: é a
     **marcação de origem** (FR-011), guarda a classificação original, as verificações do sistema
     anterior, o resumo (hash) da linha e se a precedência de FR-010 foi aplicada.
  3. Regras puras em `@hunit/domain` (`legacy-import.ts`):
     - **reserva nova** → `reservations` com os dados da planilha: classificação convertida (R-04),
       `reservation_status = 'unknown'`, `payment_form = null`, verificações e status anterior do
       sistema anterior, motivo `Sistema anterior: <Motivo>` (ou o motivo de "A revisar");
     - **já existe, verificada pelo HUNIT Control** (`last_execution_id` preenchido) → só
       `first_verified_at = min(as duas)` e `verification_count += contagem do sistema anterior`; o
       resto não muda (FR-010). `legacy_reservations.merged = true` e `applied_count` guardam o que
       foi somado;
     - **já importada, ainda não verificada** → atualiza com a planilha se o hash mudou, senão
       ignora (FR-010a);
     - **já importada e depois verificada** → se o hash não mudou, ignora; se mudou, ajusta a
       contagem pela diferença (`- applied_count + nova`) e a primeira verificação (FR-010).
  4. **Ordem com o coletor** (caso-limite "execução em andamento"): cada reserva é gravada numa
     transação que trava a linha (`SELECT … FOR UPDATE`, como o `lockHotelReservations` do coletor).
     Importar antes e verificar depois dá contagem = anterior + 1 e primeira = a do sistema anterior;
     verificar antes e importar depois dá o mesmo resultado. Um teste confere as duas ordens.
- **Rationale**: não mexe no coletor nem no `mergeVerification`; a marcação de origem não depende de
  coluna nova em `reservations`; a idempotência sai do hash e da linha de origem.
- **Alternatives considered**: execução fictícia "importação" para preencher `last_execution_id`
  (apareceria na lista de execuções e no filtro "por execução"); colunas de origem em
  `reservations` (misturaria o histórico do sistema anterior com os dados lidos do Hunit).

## R-07 — Documentos importados (FR-012 a FR-015, FR-022)

- **Decision**:
  - **Caminho**: o valor de "… arquivo no Dropbox" é um caminho relativo à pasta que o sistema
    anterior usava. Ele é resolvido dentro da pasta `--files`: primeiro o caminho como está; se não
    existir, o **nome do arquivo** procurado em toda a pasta (os nomes do sistema anterior têm um
    identificador único). Nome encontrado em mais de um lugar = `file_not_found`. Caminho absoluto,
    com `..` ou que saia da pasta (inclusive por link simbólico, conferido pelo caminho real) é
    recusado (`file_not_found`), sem abrir nada fora da pasta.
  - **Conferência**: a mesma `detectTreatmentFile` da 003 (tipo pelo conteúdo, vazio, 25 MiB);
    arquivo maior que o limite não é lido inteiro (o tamanho vem do sistema de arquivos).
  - **Nome original**: coluna "… nome original"; se faltar ou for inválido
    (`isValidTreatmentFileName`), usa o nome do arquivo na pasta. O nome nunca sai do banco: não
    aparece em relatório nem em log (FR-018).
  - **Conteúdo**: `treatment_files` com deduplicação pelo SHA-256, como na 003; um arquivo usado em
    várias reservas é guardado uma vez.
  - **Anexo antigo**: vira comprovante se o código original era `virtual_card_pending_charge`, senão
    tratativa (como o sistema anterior o exibia). Se a mesma linha também tem o documento novo desse
    tipo, vale o documento novo e o antigo é ignorado (`superseded_in_legacy`).
  - **Precedência** (FR-014): documento atual do mesmo tipo registrado no HUNIT Control (sem
    `legacy_import_id`) → ignorado (`kept_hunit_control`). Atual vindo de importação com o mesmo
    SHA-256 → ignorado (`already_imported`); com outro SHA-256 → substitui (estado `replaced`, prazo
    de 30 dias da 003, evento `replaced`). Ajuste da implementação: um arquivo já importado para a
    reserva e o tipo, em **qualquer** estado (ex.: o operador o desfez), também é
    `already_imported`, para a reimportação não trazer de volta o que o operador tirou.
  - **Valor manual** (FR-015): importado se a reserva fica com comprovante atual; senão,
    `manual_amount_without_proof`. Já existe valor manual do HUNIT Control → ignorado.
  - **Mais de 5 anos** (FR-022): reserva gravada já anonimizada (`guest_name = null`,
    `anonymized_at` = agora) e documentos gravados direto como `purged` (sem arquivo e sem nome,
    com tamanho e tipo), sem passar pelo `treatment_files`.
  - A regra de elegibilidade da 003 (FR-003) não é aplicada (FR-017).
- **Rationale**: reaproveita a conferência e a guarda da 003; resolver por nome cobre cópias da
  pasta feitas a partir de outro nível; o caminho real impede leitura fora da pasta montada.
- **Alternatives considered**: exigir a mesma árvore de pastas do sistema anterior (frágil ao
  copiar); copiar os arquivos para um volume antes (cópia extra de dados sensíveis).

## R-08 — Simulação, confirmação e relatório (FR-005, FR-005a, FR-006, FR-018)

- **Decision**:
  - `legacy-import simulate` lê tudo, confere e calcula o desfecho de cada linha e documento **na
    mesma transação de leitura**, sem gravar reservas, documentos nem arquivos. Grava só uma linha
    em `legacy_imports` (tipo `simulation`) com as contagens, a lista de ignorados e recusados e a
    **impressão digital**: SHA-256 de (SHA-256 da planilha + caminho e SHA-256 de cada arquivo
    referenciado + associação de hotéis em uso).
  - `legacy-import run --simulation <id>` recalcula a impressão digital e recusa se ela mudou
    ("a planilha, a pasta ou a associação mudou desde a simulação; simule de novo"). Depois aplica,
    reserva a reserva (R-09), e grava uma linha `import` ligada à simulação, com as contagens e as
    **diferenças** em relação a ela (ex.: uma reserva que o coletor gravou entre as duas).
  - **Relatório** (tela e banco): tabela de contagens por entidade (reserva, tratativa, comprovante,
    valor manual) × desfecho (`created`, `updated`, `ignored`, `rejected`), e a lista de ignorados e
    recusados com **aba, número da linha, código do hotel do sistema anterior, número da reserva,
    tipo e código do motivo**. Nunca nome de hóspede, valor, data, nome de arquivo nem conteúdo de
    célula. O número da linha permite achar o caso na planilha sem repetir o dado.
  - **Códigos de motivo** (data-model §4) com texto em português no relatório.
  - Código de saída: 0 = terminou (mesmo com recusas); 1 = erro de uso, coluna obrigatória faltando,
    importação em andamento, impressão digital diferente ou falha geral.
- **Rationale**: a simulação usa o mesmo código da importação (só não grava), o que garante o mesmo
  resultado; a impressão digital prova que a importação confirmada foi conferida antes.
- **Alternatives considered**: simulação numa transação revertida no fim (grava arquivos e trava
  linhas à toa, e uma simulação longa seguraria locks do coletor); arquivo de relatório em disco
  (dados fora do banco e fora do volume declarado).

## R-09 — Transações e interrupção (FR-021)

- **Decision**: uma transação por reserva, com tudo dela (linha em `reservations`,
  `legacy_reservations`, documentos, valor manual e eventos). As reservas são processadas na ordem
  da planilha; o andamento sai no terminal a cada 500 linhas (só contagens). Se o processo for
  interrompido, as reservas já gravadas ficam completas; rodar de novo (nova simulação e `run`)
  ignora o que já entrou (hash e SHA-256 iguais) e completa o resto. A linha `import` fica com
  `status = 'interrupted'` quando o processo recebe sinal de encerramento, ou `running` se morrer
  sem aviso; a simulação seguinte mostra a anterior como não concluída.
- **Rationale**: tudo ou nada por reserva (FR-021, FR-011 da 003) sem uma transação gigante que
  travaria o coletor por minutos.
- **Alternatives considered**: uma transação para a importação toda (travas longas, e uma falha no
  fim desfaria tudo).

## R-10 — Associação de hotéis (FR-006a)

- **Decision**: tabela `legacy_hotel_mappings` (data-model §1.2), uma linha por "Codigo hotel" do
  sistema anterior. A cada simulação, os códigos novos ganham uma **proposta**: o hotel do catálogo
  (`hotels`, todas as contas) cujo nome, normalizado (sem acentos, minúsculas, espaços e `_` como
  separador único, sem pontuação), é igual ao do "Hotel" ou ao do código do sistema anterior. Sem
  igualdade exata, ou com mais de um candidato, fica **sem proposta**. Comandos:
  - `legacy-import hotels` — lista cada código, nome, quantidade de linhas, proposta ou associação e
    situação (`proposed`, `confirmed`, `unmapped`);
  - `legacy-import hotels --set <código> --hotel <código do catálogo>` — confirma ou troca;
  - `legacy-import hotels --set <código> --none` — deixa sem associação (as linhas são recusadas);
  - `legacy-import hotels --accept-proposals` — confirma todas as propostas.
  Só associações **confirmadas** valem, na simulação e na importação: as linhas de um hotel ainda em
  `proposed` ou `unmapped` são recusadas (`hotel_not_mapped`), e o relatório lista os hotéis nessa
  situação com a proposta. O roteiro é: simular, conferir e confirmar os hotéis, simular de novo e
  importar (a associação entra na impressão digital, R-08).
- **Rationale**: o código do sistema anterior é um nome em minúsculas com `_` (clarificação), então
  só o nome compara; a confirmação explícita evita gravar milhares de reservas no hotel errado.
- **Alternatives considered**: comparação aproximada (distância de edição) — propostas erradas em
  nomes parecidos de hotéis da mesma rede; arquivo de associação em disco (mais um arquivo para
  versionar ou perder).

## R-11 — Dados pessoais fora de logs e relatórios (FR-018, SC-006)

- **Decision**: o comando nunca imprime valores de célula: os erros da leitura (biblioteca,
  sistema de arquivos) são convertidos em códigos de motivo; uma exceção inesperada sai como "Falha
  na linha N da aba X" e o detalhe vai só para o log em JSON, já sem a mensagem original (que pode
  conter o valor). O `SecretRegistry` não se aplica (não há credenciais). Teste: uma planilha
  fictícia com valores marcados (`MARCADOR-HOSPEDE`, `MARCADOR-ARQUIVO.pdf`, `987654.32`) em todas
  as colunas sensíveis; o teste confere que nenhum marcador aparece na saída, no log nem em
  `legacy_imports`.
- **Rationale**: o relatório é o único produto visível da importação e vai ser lido e repassado.

## R-12 — Contrato da API 1.5.0 → 1.6.0 (FR-011, FR-016, FR-024)

- **Decision**: só acréscimos ([contracts/api-changes.md](./contracts/api-changes.md)):
  `Reservation.legacy` (objeto ou `null`), filtro `fromLegacy` em `GET /v1/reservations`,
  `fromLegacy` em `TreatmentDocument` e `TreatmentEvent`, e as descrições de `Classification`
  (`not_virtual_card` = "A revisar (sistema anterior)") e de `lastExecutionId` (ausente = só do
  sistema anterior). Versão **1.6.0**. A cópia do contrato vai para
  `specs/004-importacao-historico/contracts/openapi.yaml`; a da 003 fica congelada na 1.5.0.
- **Rationale**: nenhum campo obrigatório novo, nenhum valor de enum novo; o app atual continua
  funcionando com a API nova.

## R-13 — App desktop (FR-024)

- **Decision**: só apresentação, sem regra de negócio (constitution, princípio III):
  - `not_virtual_card` → "A revisar (sistema anterior)", tom `warning`; na ordem do filtro "Situação
    da reserva", logo depois das que pedem ação;
  - selo "Sistema anterior" na lista (ao lado do número) e no detalhe;
  - filtro "Origem": Todas / Sistema anterior / HUNIT Control (`fromLegacy`), também na ponte
    (`ipc-schemas.ts`);
  - detalhe: seção "Sistema anterior" com a classificação original (nome do sistema anterior), a
    primeira e a última verificação e a contagem de lá e a data da importação; "Ainda não verificada
    pelo HUNIT Control" quando `lastExecutionId` falta;
  - histórico: autor "Sistema anterior" nos eventos com `fromLegacy`.
  Mudança visível numa feature de 002 a 006: a skill `figma-screens-sync` atualiza a página
  `004-importacao-historico` no Figma antes do PR (AGENTS.md).
- **Rationale**: as decisões ficam no servidor; o app só mostra os campos novos.

## R-14 — Testes (constitution, princípio VII)

- **Decision**:
  - `domain`: valores (R-03), conversão (R-04), regras de precedência (R-06), anexo antigo e
    precedência dos documentos (R-07), normalização dos nomes de hotel (R-10), `requiresCharge` e a
    nova derivação da situação;
  - `server-db`: planilha fictícia gerada com `write-excel-file` e pasta de anexos sintéticos
    (PDF, PNG, .eml mínimos), cobrindo cada motivo de recusa; simulação sem gravação (SC-002);
    importação e reimportação sem duplicar (SC-003); download idêntico (SC-004); zero chamadas ao
    `HunitGateway` (SC-005); marcadores fora da saída (SC-006); precedência e ordem com o coletor
    (SC-007); lock de uma importação por vez; reserva "A revisar" reclassificada pelo coletor;
    retenção dos importados com mais de 5 anos; cópia e restauração com reserva importada;
    contrato 1.6.0 (`fromLegacy`, `legacy`);
  - `desktop-ui`: nomes, selo, filtro e seção do detalhe; `desktop-e2e`: o roteiro de captura das
    telas ganha uma reserva importada (para o espelho no Figma);
  - medição: simulação de 20 000 linhas e 2 000 anexos pequenos (SC-008), num teste marcado como
    lento, fora da rodada normal.
