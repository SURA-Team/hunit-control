# Research: Tratativas manuais das reservas

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Decisões técnicas da feature 003. Os números de requisito (FR/SC) são os da [spec](./spec.md);
referências a outras features citam a spec (`specs/001`, `specs/002`). A Technical Context do plano
não deixou nenhum ponto em aberto: cada dúvida está resolvida abaixo.

## R-01 — Onde ficam os documentos: no PostgreSQL (FR-010, FR-011, SC-007)

**Decisão**: o conteúdo dos documentos fica no próprio banco, numa tabela `treatment_files`
(`bytea`), com o arquivo identificado pelo seu SHA-256. Os metadados ficam em
`treatment_documents` (ver [data-model.md](./data-model.md)).

**Motivo**:

- **Cópia de segurança e restauração sem mudar nada**: a cópia diária é um `pg_dump` cifrado
  (specs/001, R-21). Com os documentos no banco, eles entram nas cópias e voltam na restauração
  (FR-010, SC-007) sem um segundo mecanismo — as evidências ficam de fora justamente por estarem em
  disco (specs/001, FR-030).
- **Tudo ou nada de verdade** (FR-011): o registro e o arquivo são gravados na mesma transação.
  Com arquivos em disco, seria preciso compensar falhas à mão, como o `EvidenceStore` faz.
- **Fonte da verdade única** (constitution, princípio VI) e nenhum volume novo no Compose
  (princípio V).
- **Volume pequeno**: dezenas de documentos por semana, até 25 MB cada (FR-008). Mesmo no pior
  caso, alguns GB em 5 anos — dentro do que o `pg_dump` e o PostgreSQL tratam bem.

**Deduplicação**: o mesmo arquivo aplicado a 20 reservas (US3) é guardado uma vez só: a chave de
`treatment_files` é o SHA-256 do conteúdo, e cada documento aponta para ela. Um arquivo deixa de
existir quando nenhum documento aponta mais para ele (R-07).

**Alternativas consideradas**:

- *Arquivos num volume, como as evidências*: exigiria incluir o volume nas cópias, cifrar e
  restaurar junto com o banco, e compensar falhas entre disco e banco. Rejeitada.
- *Large objects do PostgreSQL* (`lo_*`): o `pg_dump` inclui, mas exigem limpeza própria
  (`vacuumlo`) e uma API diferente no driver. `bytea` basta para arquivos de até 25 MB.
- *Serviço de objetos (S3, MinIO)*: infraestrutura nova sem necessidade (princípio VIII). Pode ser
  revisto na ida para a AWS.

## R-02 — Envio do arquivo em duas etapas (FR-006, FR-008, FR-011)

**Decisão**: o envio é separado do registro.

1. `POST /v1/treatment-files` recebe o arquivo puro (`application/octet-stream`, até 25 MiB), com
   o nome original num parâmetro. O servidor confere tamanho e tipo (R-03), calcula o SHA-256,
   grava em `treatment_files` (se ainda não existir) e devolve o `fileId`.
2. `POST /v1/treatment-documents` registra o documento (`kind` + `fileId` + nome) em uma ou várias
   reservas (até 200 por pedido), cada uma na sua transação, e devolve o resultado por reserva.

Antes de enviar o arquivo, o app pergunta ao servidor quais reservas aceitam
(`POST /v1/treatment-documents/check`, sem gravar nada): assim a confirmação mostra quantas aceitam,
quantas serão ignoradas e o total (FR-006, US3 cenário 1) com a regra do servidor, e um arquivo de
25 MB não é enviado à toa.

**Motivo**: o lote (US3) usa um único envio para N reservas; se uma reserva falhar, o operador
repete só ela sem reenviar o arquivo (US3 cenário 3); e o registro continua sendo JSON validado
pelo contrato, como todo o resto da API.

**Arquivo enviado e não usado** (o app caiu entre as duas etapas): fica sem nenhum documento e é
apagado pela rotina diária depois de 24 h (R-07).

**Alternativas consideradas**: `multipart/form-data` com arquivo e reservas no mesmo pedido —
exigiria o plugin `@fastify/multipart`, validação manual dos campos fora do contrato e reenvio do
arquivo a cada nova tentativa. Rejeitada.

## R-03 — Conferência do tipo e do tamanho no servidor (FR-008, casos-limite)

**Decisão**: a conferência é uma função pura em `@hunit/domain` (`document-type.ts`), testada sem
I/O. O tipo é decidido pelo **conteúdo** e precisa bater com a extensão do nome:

| Extensão | Conteúdo exigido |
|---|---|
| `.pdf` | começa com `%PDF-` |
| `.png` | assinatura PNG (`89 50 4E 47 0D 0A 1A 0A`) |
| `.jpg`, `.jpeg` | começa com `FF D8 FF` |
| `.msg` | arquivo composto do Outlook (OLE/CFB: `D0 CF 11 E0 A1 B1 1A E1`) |
| `.eml` | texto sem bytes nulos, com um bloco de cabeçalhos no início (linhas `Nome: valor` até a primeira linha em branco) que inclua pelo menos `From`, `Date` ou `Subject` |

Arquivo vazio, acima de 25 MiB (26 214 400 bytes), de outra extensão ou com conteúdo diferente da
extensão é recusado com um código próprio (`empty_file`, `file_too_large`,
`unsupported_file_type`) e nada é gravado.

O tipo de conteúdo guardado (`media_type`) é o decidido pelo servidor, nunca o informado pelo
cliente. O limite é uma constante (não uma variável de ambiente): a spec fixa 25 MB, e mudar o
limite é mudar a spec.

**No HTTP**: o servidor hoje só lê JSON (`app.ts`, `acceptOnlyJsonBodies`). Passa a ler
`application/octet-stream` como `Buffer`, **somente** na operação de envio: o limite de corpo
dessa rota é 25 MiB (as demais continuam com o padrão de 1 MiB do Fastify), e o contrato declara o
corpo sem `schema` — o `fastify-openapi-glue` só valida corpos com `schema`, e um `Buffer` não
passaria por um schema `type: string`. A conferência fica no handler, pela função do domínio. O
proxy (Caddy) não limita o tamanho do corpo; nada muda nele.

**Alternativas consideradas**: biblioteca de detecção de tipo (`file-type`) — cobre centenas de
formatos que não interessam e não reconhece `.eml`; as cinco assinaturas acima são poucas linhas.

## R-04 — Regras das tratativas no domínio (FR-002, FR-003, FR-004, FR-005, FR-013a)

**Decisão**: as regras ficam em `@hunit/domain` (`treatment.ts`), sem I/O:

- `acceptsTreatment(classification)`: pendente de cobrança, erro na cobrança, cartão validado (não
  cobrado), erro de análise e cobrar na maquininha → aceita tratativa e comprovante; as demais não
  (FR-003). `not_virtual_card` (obsoleta, specs/001 R-22) também não aceita.
- `treatmentStatus({ hasCurrentRequest, hasCurrentProof })` → `charged` | `sent` | `none` (FR-002).
- `revertDeadline(endedAt)` = `endedAt` + 30 dias; `isRevertible(document, now)` (FR-013, FR-013a).
- `effectiveChargedAmount(hunitAmount, manualAmount)` → o do Hunit prevalece quando existe (FR-005).
- `isPendingCharge(classification, treatmentStatus)` → `acceptsTreatment(classification)` e sem
  comprovante (`none` ou `sent`): é o filtro "Falta cobrar" (FR-002), aplicado pelo servidor no
  parâmetro `pendingCharge` da consulta. O filtro por classificação e o resumo das execuções não
  mudam: mostram o que o Hunit informou.

O servidor usa essas funções ao registrar e ao montar as respostas; o app nunca as reimplementa —
recebe do servidor o resultado (`treatmentStatus`, `revertibleUntil`, os desfechos do `check`)
(constitution, princípio III).

## R-05 — Concorrência, transações e lote (FR-006, FR-011, casos-limite)

**Decisão**:

- Cada reserva do lote é gravada na sua própria transação: trava a linha da reserva
  (`SELECT … FOR UPDATE`), confere a elegibilidade **naquele momento** (FR-006a), encerra o
  documento atual do mesmo tipo (se houver, vira `replaced`), insere o novo como `current` e grava
  o evento no histórico. Um índice único parcial garante no máximo um documento `current` por
  reserva e tipo.
- Dois operadores na mesma reserva: as transações são serializadas pela trava; o segundo
  substitui o primeiro, e o histórico guarda os dois (caso-limite da spec).
- O lote para em erro inesperado? Não: cada reserva tem seu desfecho (`registered`, `replaced`,
  `ignored` com motivo, `failed`), e o lote continua. A resposta lista todos; o app mantém
  selecionadas as que falharam (FR-006a).
- Todas as gravações de um mesmo pedido levam o mesmo `batchId` no histórico, para saber o que foi
  aplicado junto.
- Seleções maiores que 200 reservas são enviadas pelo app em partes de 200, com um resultado único
  na tela.

## R-06 — Histórico e auditoria (FR-012, FR-013)

**Decisão**: tabela `treatment_events`, só de inclusão (nenhuma ação dos operadores altera ou apaga
uma linha). Cada evento guarda o tipo (`attached`, `replaced`, `removed`, `reverted`,
`amount_set`, `amount_cleared`), o documento ou o valor envolvido, o cliente da API e o momento.

O histórico não repete nomes de arquivo (só o id do documento), para que a retenção apague os
nomes num lugar só (R-07). Quem fez é o cliente da API (premissa da spec).

## R-07 — Retenção dos documentos (FR-013, FR-016)

**Decisão**: a rotina diária de manutenção (`maintenance/retention.ts`, specs/001 R-16) ganha três
passos, na mesma rodada e com a mesma garantia de recuperar o atraso (specs/001, FR-029):

1. **Documentos substituídos ou desfeitos há mais de 30 dias**: o documento passa a `purged`
   (sem arquivo e sem nome original); o registro e o histórico ficam.
2. **Reservas anonimizadas** (check-in há mais de 5 anos, specs/001 FR-026): todos os documentos
   delas, inclusive os atuais, passam a `purged`, e o valor manual fica. A situação exibida
   continua a mesma (a reserva teve comprovante), conforme FR-016.
3. **Arquivos órfãos**: linhas de `treatment_files` sem nenhum documento que aponte para elas e
   criadas há mais de 24 h são apagadas (cobre os documentos purgados e os envios não usados de
   R-02).

O prazo de 30 dias é uma constante do domínio (R-04): a spec fixa o valor.

**Por que manter o registro purgado**: FR-016 pede para manter "o registro de que houve
tratativa/comprovante, as datas e o valor manual"; o histórico (FR-012) também não pode perder as
linhas.

## R-08 — Pré-visualização no app (FR-018, FR-018a, SC-010, SC-011)

**Decisão**: o arquivo é escolhido, lido e interpretado no **processo principal**, só em memória; a
interface recebe um modelo pronto para mostrar.

- **Escolha e leitura**: `dialog.showOpenDialog` (filtros pelas extensões aceitas); o principal
  confere o tamanho antes de ler (arquivos acima de 25 MB são recusados sem serem lidos) e guarda os
  bytes num mapa em memória, com um id de seleção. A entrada sai do mapa quando o envio e o registro
  terminam (mesmo com reservas ignoradas ou `failed`), ao cancelar ou depois de 15 minutos sem uso.
  Se o envio do arquivo ou de alguma parte do registro falhar por conexão (servidor indisponível),
  a entrada **fica** e o app oferece "Tentar de novo" sem escolher o arquivo outra vez (caso-limite
  da spec); reenviar o mesmo arquivo não duplica nada (R-01) e as reservas já registradas voltam
  como `ignored`/`same_file`. Nada é gravado no disco (FR-018a, SC-011) — o envio ao servidor
  usa os mesmos bytes.
- **PDF**: `pdfjs-dist` na interface, desenhando as páginas em `canvas`, com o *worker* empacotado
  pelo Vite (CSP `worker-src 'self'`). O pdf.js não executa os scripts de um PDF por padrão
  (`isEvalSupported: false`, `enableScripting: false`). Alternativa rejeitada: o visualizador de PDF
  do Chromium (`plugins: true`) — exigiria afrouxar as `webPreferences` endurecidas da 002 (R-02) e
  abrir o PDF por URL.
- **Imagens**: `blob:` na interface (a CSP passa a aceitar `img-src blob:`).
- **E-mail .eml**: `postal-mime` (MIT-0, sem dependências) no principal → remetente, destinatários,
  assunto, data, texto e lista de anexos (nome, tipo, tamanho), sem abrir os anexos.
- **E-mail .msg**: `@kenjiuno/msgreader` (Apache-2.0, JavaScript puro) no principal → o mesmo
  modelo. É o formato mais frágil (binário do Outlook): se a leitura falhar, vale o aviso "não foi
  possível pré-visualizar", com nome, tipo e tamanho, e o operador pode confirmar mesmo assim
  (FR-018a).
- **Corpo em HTML** (e-mail sem versão em texto): mostrado num `iframe` com `sandbox=""` (sem
  scripts, sem formulários, sem navegação) e `srcdoc` com CSP própria
  (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`): nenhuma imagem ou recurso da
  internet é carregado (FR-018a, SC-011). A CSP da interface já tem `connect-src 'none'`.
- **Tempo** (SC-010): a leitura e a interpretação de 25 MB no principal levam décimos de segundo; o
  PDF mostra a primeira página logo e desenha as outras sob demanda.

As três bibliotecas são novas no app; as versões seguem a regra de 3 dias do `pnpm-workspace.yaml`
e nenhuma exige script de instalação. Ficam em `devDependencies` e são empacotadas pelo Vite, como
todas as do app (specs/002, R-11).

**Alternativas consideradas**:

- *Interpretar os e-mails no servidor*: o arquivo teria de ser enviado antes da confirmação, e
  cancelar deixaria um envio para trás — contraria "cancelar não envia nada" (FR-018).
- *`mailparser`* para .eml: depende de várias bibliotecas de Node; o `postal-mime` faz o mesmo sem
  dependências.
- *Converter o HTML do e-mail em texto*: perderia tabelas e formatação que ajudam a reconhecer o
  e-mail certo; o `iframe` isolado mostra o original sem riscos.

## R-09 — Seleção que sobrevive às pesquisas (FR-006a, US3 cenários 4 a 6)

**Decisão**: a seleção fica num estado da interface acima da tela de reservas (um *provider* no
`App.tsx`), guardando, para cada reserva marcada, a chave (hotel + número) e o que a lista precisa
mostrar (número, hotel, hóspede, valor, situação). Ela não depende do resultado da pesquisa, dos
filtros nem da página. Só em memória: fechar o app limpa a seleção (FR-006a; a 002 não grava
reservas no disco, FR-008a).

- Linhas de um resultado são mostradas marcadas se a chave estiver na seleção.
- A barra da seleção mostra quantidade e total; "Ver seleção" abre a lista completa, com desmarcar e
  "Limpar seleção".
- Na confirmação, a elegibilidade e os valores vêm do `check` do servidor (R-02), não do que
  estava guardado: uma reserva que mudou depois de marcada aparece como ignorada (FR-006a).
- Limite de 2 000 reservas (FR-006a): ao passar disso (inclusive pela caixa do cabeçalho), o app
  marca até o limite e avisa "Selecione no máximo 2 000 reservas". O limite cobre com folga o uso
  esperado e mantém o lote em no máximo 10 partes de 200 (R-05).

**Causa do problema no sistema anterior**: a seleção ficava presa às linhas do resultado; uma nova
pesquisa trocava as linhas e descartava as marcas. Separar a seleção do resultado resolve.

## R-10 — O que a API ganha (contrato 1.4.0 → 1.5.0)

Só acréscimos, sem quebrar o app da 002 nem clientes da 001 (premissa da spec). Detalhes e exemplos
em [contracts/api-changes.md](./contracts/api-changes.md).

| Acréscimo | Requisito | Perfil |
|---|---|---|
| `POST /treatment-files` (envio do arquivo) | FR-008, FR-010 | operador |
| `POST /treatment-documents/check` (quem aceita, sem gravar) | FR-003, FR-006, FR-006a | operador |
| `POST /treatment-documents` (registrar em 1..200 reservas) | FR-001, FR-004, FR-006, FR-011 | operador |
| `DELETE /treatment-documents/{id}` (desfazer) | FR-004 | operador |
| `POST /treatment-documents/{id}/revert` | FR-013a | operador |
| `GET /treatment-documents/{id}/file` (baixar) | FR-009 | os dois |
| `PUT` e `DELETE /reservations/{hotel}/{número}/manual-amount` | FR-005 | operador |
| `GET /reservations/{hotel}/{número}/treatment` (documentos e histórico) | FR-012, FR-015 | os dois |
| `Reservation.treatment` (situação, documentos atuais, valor manual) | FR-002, FR-015 | os dois |
| filtros `treatmentStatus` e `pendingCharge` ("Falta cobrar") em `GET /reservations`; `amount` passa a achar o valor manual | FR-002, FR-015 | os dois |

As operações que não são `GET` entram em `OPERATOR_ONLY_OPERATIONS` (FR-014, SC-006); o teste que
já existe confere que nenhuma ficou de fora. O `check` é `POST` por receber uma lista de reservas
no corpo, e fica com o operador porque só serve para registrar.

O download usa os mesmos cuidados das evidências: `x-content-type-options: nosniff`,
`content-security-policy: sandbox` e `content-disposition: attachment` com o nome original
(`filename*` em UTF-8, RFC 6266), para que nada do arquivo seja executado ou interpretado.

## R-11 — Testes (princípio VII)

| Camada | Grupo | O que comprova |
|---|---|---|
| Domínio | `domain` | `document-type` (cada assinatura, extensão trocada, vazio, limite exato e 1 byte acima); elegibilidade de cada classificação; situação derivada; prazo de reversão; valor efetivo |
| API | `server-db` | contrato de cada operação nova contra o `openapi.yaml` 1.5.0; perfil consulta recusado em todas as ações de registro (SC-006); lote com reservas aceitas, ignoradas e inexistentes; dois registros concorrentes na mesma reserva; desfazer, reverter, prazo vencido; tratativas intactas após nova verificação pelo coletor (SC-004); nenhuma chamada ao `HunitGateway` (SC-003); download idêntico ao enviado (SC-005); filtro `treatmentStatus` combinado com classificação (SC-008) |
| Manutenção | `server-db` | purga após 30 dias, purga na anonimização, órfãos após 24 h |
| Cópia | `server-db` | o teste de cópia e restauração que já existe ganha um documento: depois de restaurar, o arquivo baixado é idêntico (SC-007) |
| App, principal | `desktop` | leitura só em memória; recusa acima de 25 MB sem ler; modelo de pré-visualização de .eml e .msg (fixtures **sintéticas**, sem dados reais); falha de leitura vira aviso; envio em partes de 200 |
| App, interface | `desktop-ui` | seleção mantida entre pesquisas, filtros e páginas; lista da seleção; ações escondidas para o perfil consulta; HTML do e-mail num `iframe` isolado |
| Ponta a ponta | `desktop-e2e` | US1 a US4 com o app real; varredura da pasta de dados do app e da pasta temporária sem cópia do documento e sem acesso à rede durante a pré-visualização (SC-011) |

Fixtures de e-mail e PDF são **geradas no teste**, sem dados de hóspedes nem da empresa (AGENTS.md).

## R-12 — Onde fica o contrato desta feature

Segue a regra da 002 (R-15): o `packages/contracts/openapi.yaml` passa para a 1.5.0 e é copiado
para `specs/003-tratativas-manuais/contracts/openapi.yaml` na implementação; a cópia da 002 fica
congelada na 1.4.0.

## R-13 — Nomes de arquivo e buscas fora dos logs (constitution, "Observabilidade")

**Problema**: o Fastify registra cada requisição com a URL completa, inclusive a query. O nome do
arquivo vai em `?name=` no envio (R-02) e pode conter o nome do hóspede (FR-016); a busca livre da
002 (`GET /reservations?q=`) já leva nomes de hóspedes para o log do servidor pelo mesmo caminho.
A constitution exige logs "sem dados sensíveis".

**Decisão**: o logger do servidor (`apps/server/src/logging.ts`) ganha um serializador de `req` que
registra método, **caminho sem a query**, id da requisição e o cliente — nunca a query, os
cabeçalhos nem o corpo. Corrige o envio e a busca de uma vez, sem mudar o contrato. Um teste de
segurança (`apps/server/test/security/`) faz um envio com nome marcado e uma busca por um nome de
hóspede fictício e confere que nenhum dos dois aparece no log.

Os números de reserva continuam no caminho de algumas rotas (`/reservations/{hotel}/{número}`):
não são dados pessoais do hóspede e já eram registrados desde a 001.

**Alternativa considerada**: mandar o nome num cabeçalho (`X-File-Name`) — resolveria só o envio,
e a busca continuaria vazando.
