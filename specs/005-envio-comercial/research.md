# Research: Envio dos pedidos de cobrança ao Comercial

Decisões técnicas da feature 005 (Fase 0 do `/speckit-plan`). Cada uma tem decisão, justificativa e
alternativas. As referências "spec" são a [spec.md](./spec.md); "001", "003" e "004" são as specs e
os researches dessas features.

## R-01 — O envio é um job próprio, com a mesma máquina de estados das execuções

**Decisão**: o envio ao Comercial é um job com tabela própria (`commercial_dispatches`), com os mesmos
estados (`queued`, `running`, `awaiting_2fa`, `completed`, `failed`, `cancelled`) e os mesmos motivos
de encerramento das execuções (enums reaproveitados). O login, a espera do token, o envio do token e a
proteção dos segredos saem do `ExecutionRunner` para um módulo comum (`apps/server/src/hunit-session/`),
usado pelos dois: a execução (coleta por hotel e período) e o envio (verificação por reserva). O
`DispatchRunner` roda no mesmo processo da API, como o `ExecutionRunner` (001, R-02), para usuário,
senha e token ficarem só em memória.

A regra "uma automação por vez por conta do Hunit" (constitution IV) passa a valer entre as duas
tabelas: ao criar uma execução ou um envio, a transação pega um *advisory lock* da conta
(`pg_advisory_xact_lock(hashtext(account_key))`) e confere que não há execução nem envio ativo da
mesma conta. Os índices únicos parciais continuam valendo dentro de cada tabela.

A retomada (constitution IV, spec FR-007) cria um envio filho (`parent_dispatch_id`) com as reservas
ainda não verificadas, com novo login e token — o equivalente a "a partir do último hotel concluído".

**Justificativa**: o envio precisa de tudo o que a execução já tem (token com aviso no app,
acompanhamento em tempo real, cancelar, retomar, segredos só em memória), mas a unidade de trabalho é
outra (lista de reservas, não hotel + período). Reaproveitar a sessão e os estados evita duplicar a
parte mais sensível (credenciais e token) e mantém a experiência igual para o operador.

**Alternativas**:
- *Envio como um tipo de execução* (`executions.kind`): o app atual lista as execuções e exige
  período e hotéis; um envio apareceria quebrado na lista dele, o que viola "sem quebrar o app
  desktop atual". Também mexeria em índices e na retomada por hotel.
- *Fila externa ou processo separado*: obrigaria credenciais a passar por fila ou banco (001, R-02).

## R-02 — Verificação de uma reserva no Hunit: dia do check-in + detalhe

**Decisão**: o `HunitGateway` ganha `findReservation(hotelCode, reservationNumber, checkIn)`. Ele lê a
listagem do hotel (`GetBookings`) com o período **igual ao dia do check-in registrado** e os filtros
fixos da 001 (FR-010), percorre as páginas até achar o número da reserva e lê o detalhe
(`BookingDetail`). As duas rotas já estão na lista de permissão: **nenhuma rota nova** no
`read-only-guard`. A conferência dos filtros da 001 (`searchBookings`) continua valendo.

O resultado passa pelo mesmo domínio da coleta (classificação, FR-013) e é gravado por uma função nova
`commitVerifiedReservation`, extraída de `commitHotel` (mesma atualização de dados, histórico e
mudança de status, 001 FR-016 a FR-018b, numa transação com `FOR UPDATE`). Diferenças em relação à
coleta:
- grava `reservations.last_dispatch_id` (coluna nova), não `last_execution_id`, e não cria
  `reservation_observations` (que são "o que cada execução viu");
- "verificada pelo HUNIT Control" (004, precedência da importação) passa a ser
  `last_execution_id is not null or last_dispatch_id is not null`;
- reserva não achada não é marcada "não encontrada na última verificação" (spec, premissas): o item
  do envio fica `not_verified` com o motivo "não encontrada no Hunit no check-in registrado".

Leituras com falha passageira são repetidas como na coleta (001 FR-011a); `ScreenNotRecognizedError`
no detalhe deixa a reserva `not_verified`, com evidência (001 FR-024), e o envio segue.

**Justificativa**: usa só o que já foi confirmado no Hunit real (rotas, filtros, formato) e já tem
teste e fixtures. Um dia de check-in num hotel cabe quase sempre numa página (50 reservas).

**Alternativas**:
- *Filtro por número da reserva no `GetBookings`*: o campo existe na tela (001 FR-010, "nº da
  reserva"), mas o nome do parâmetro não foi observado. Fica como otimização a avaliar na homologação
  com o `hunit:reservations-check`; se confirmado, entra com teste e registro aqui. Ele resolveria a
  reserva cujo check-in mudou no Hunit, hoje relatada como não encontrada.
- *Abrir o detalhe direto pelo `bookingId`*: o sistema não guarda o identificador interno do Hunit
  (001 R-13a), só o número; guardar exigiria migração e não serve às reservas importadas (004).

## R-03 — Acesso à planilha: API REST do Google Sheets com `google-auth-library`

**Decisão**: o servidor fala com a API v4 do Google Sheets por HTTP (`fetch` do Node) e obtém o token
de acesso com a `google-auth-library` (conta de serviço, JWT, escopo
`https://www.googleapis.com/auth/spreadsheets`). Tudo fica atrás de uma interface,
`CommercialSheetGateway` (`apps/server/src/commercial-sheet/gateway.ts`), com duas implementações: a
real (`google-sheet-gateway.ts`) e uma em memória para os testes, como o `HunitGateway` (001).

Operações usadas: `spreadsheets.get` (abas, proteções, cabeçalhos), `spreadsheets.values.batchGet`
(leitura das duas abas, `UNFORMATTED_VALUE`) e `spreadsheets.batchUpdate` (formatação inicial,
proteções e todas as escritas de uma rodada num pedido só).

**Justificativa**: três chamadas REST bem documentadas não pedem um cliente gerado. A
`google-auth-library` é a biblioteca oficial para assinar o JWT da conta de serviço e renovar o token
— a parte criptográfica, que não vale escrever à mão. Uma dependência nova só, no servidor, sem
script de instalação.

**Alternativas**:
- *`googleapis` ou `@googleapis/sheets`*: maiores, e os erros carregam a configuração da requisição
  (com o cabeçalho `Authorization`), o que exige mais cuidado com logs (R-04).
- *JWT assinado à mão com `node:crypto`*: sem dependência, mas é código de segurança sem ganho real.
- *Google Apps Script na planilha*: a lógica ficaria fora do repositório, do contrato e dos testes.

## R-04 — Credencial da planilha só no servidor

**Decisão**: a chave JSON da conta de serviço fica num arquivo da pasta `deploy/secrets/` do PC
(ignorada pelo Git, menos o README), montada **só para leitura** no container em
`/run/secrets/commercial-sheet` (`COMMERCIAL_SHEET_SECRETS_DIR` troca a pasta). Variáveis novas:
`COMMERCIAL_SHEET_KEY_FILE` (caminho do arquivo dentro do container) e `COMMERCIAL_SHEET_ID`
(identificador da planilha).

*Ajuste na implementação (T002)*: o plano previa um `secret` do Compose (`secrets: file:`), mas o
Compose recusa subir quando o arquivo não existe, o que quebraria toda instalação sem a planilha
configurada (inclusive a produção atual). A pasta montada só para leitura tem o mesmo efeito — a
chave não passa por variável de ambiente nem aparece no `docker inspect` — e existe sempre. Sem as duas, a integração fica **desligada**: o
servidor sobe, o envio é recusado com `commercial_sheet_not_configured` e o estado da planilha mostra
"não configurada". Com só uma das duas, o servidor não sobe (erro de configuração, como as outras
variáveis).

Proteções (spec FR-022, SC-009):
- ao carregar a chave, `private_key`, `client_email`, o `private_key_id` e o `COMMERCIAL_SHEET_ID` são
  registrados no `SecretRegistry` (001, R-12): logs, eventos e evidências apagam qualquer ocorrência;
- o adaptador converte toda falha em um código (`sheet_unavailable`, `sheet_forbidden`,
  `sheet_not_found`, `sheet_layout_invalid`, `sheet_rate_limited`) com o status HTTP; **nunca** passa
  adiante nem registra o objeto de erro da biblioteca ou a resposta (podem conter o token e o
  endereço da planilha);
- a API e o app só recebem o código e uma mensagem genérica em português;
- o arquivo nunca entra no repositório: `deploy/secrets/` no `.gitignore` e um teste que confere o
  `docker-compose.yml` (o segredo vem de arquivo, não de variável com o conteúdo).

**Justificativa**: a chave dá acesso de edição à planilha; como segredo de arquivo, não aparece em
`docker inspect` nem no ambiente do processo. O ID não dá acesso sozinho, mas a spec pede que o acesso
não apareça em lugar nenhum: tratá-lo como segredo custa pouco.

**Alternativas**: conteúdo da chave numa variável de ambiente (aparece em `docker inspect` e no
`/proc`); OAuth com a conta de uma pessoa (depende de alguém logado e do token dela).

## R-05 — A planilha é criada por quem administra e preparada por um comando

**Decisão**: quem administra o servidor cria uma planilha vazia na própria conta Google e a compartilha
como **editor** com o e-mail da conta de serviço (contas de serviço não têm cota de armazenamento no
Drive e não conseguem ser donas de arquivos novos). Depois roda o comando administrativo
`commercial-sheet setup` (spec FR-008a; constitution III, exceção de comandos de implantação: não é
usado pelos clientes, não acessa o Hunit e tudo o que o sistema grava fica visível pela API). Ele, de
forma repetível:
- cria as abas **"A cobrar"** e **"Concluídas"** e os cabeçalhos ([contracts/sheet-layout.md](./contracts/sheet-layout.md));
- define a localidade `pt_BR` e o fuso `America/Sao_Paulo`, os formatos (Reserva como texto, datas
  `dd/mm/aaaa`, valores em reais) e congela a linha 1;
- protege as colunas do sistema de "A cobrar" (colunas inteiras, valendo para linhas novas) e a aba
  "Concluídas" inteira, com a conta de serviço como única editora (o dono do arquivo sempre pode
  editar, e é quem administra);
- confere o acesso e mostra o resultado sem mostrar a chave nem o ID.

`commercial-sheet check` só confere acesso e formato, sem mudar nada. O compartilhamento com o
Comercial é feito no Google, fora do sistema (spec, premissas). O sincronizador (R-06) confere o
formato a cada rodada e, se alguém mudou cabeçalhos ou abas, para e relata `sheet_layout_invalid`
até o `setup` ser rodado de novo.

**Justificativa**: preparar o formato uma vez, de forma explícita e testável, evita que o servidor
mexa em proteções a cada rodada. O comando cabe na exceção do princípio III.

**Alternativas**: o servidor preparar a planilha sozinho ao subir (mudaria proteções em produção sem
ninguém ver); rota na API para isso (rota de alto risco sem uso pelos clientes).

## R-06 — A planilha é uma projeção: estado desejado no banco e rodadas de sincronização

**Decisão**: o banco guarda o estado desejado de cada linha (`commercial_lines`, uma por reserva
enviada, com `version` e `synced_version`). Um **sincronizador** no processo do servidor
(`apps/server/src/commercial-sheet/sync.ts`) faz rodadas, uma por vez (fila em memória; *ajuste
na implementação, T025*: sem `pg_try_advisory_lock`, porque o servidor é um processo só —
constitution V — e uma trava de sessão do banco precisaria de uma conexão presa durante as chamadas
ao Google). Cada rodada:

1. lê as duas abas inteiras numa chamada (`values.batchGet`);
2. confere o formato (cabeçalhos e abas, R-05);
3. lê os retornos das linhas de "A cobrar" (R-08) e grava o que mudou, na mesma transação que marca
   as linhas afetadas para escrita;
4. compara cada linha da planilha com o estado desejado (casamento por R-07) e aplica tudo num único
   `spreadsheets.batchUpdate`: atualiza só as células do sistema que diferem, acrescenta as linhas
   novas no fim de "A cobrar", **move** as linhas (acrescenta em "Concluídas" com os valores lidos do
   retorno e apaga em "A cobrar", de baixo para cima), apaga as vencidas de "Concluídas" (90 dias) e
   reconstrói as apagadas ou alteradas, relatando o caso (spec FR-011);
5. marca `synced_version = version` das linhas aplicadas e grava o estado da rodada
   (`commercial_sheet_state`).

O sincronizador **nunca escreve nas colunas de retorno de uma linha que continua em "A cobrar"**: só
escreve as colunas do sistema daquela linha. Assim, uma rodada não apaga o que o Comercial está
digitando. Retorno só é escrito ao mover a linha para "Concluídas" (cópia do que foi lido).

Gatilhos: cada mudança que afeta uma linha (envio, execução que muda a situação, validação, ações da
003) incrementa `version` e agenda uma rodada em 5 s (agrupando mudanças próximas); a cada 10 min
(spec FR-014); "Ler retornos agora" (spec US2, cenário 8). Depois de uma falha, novas tentativas em 1,
2, 4 e 5 min (e daí a cada 5 min), o que cumpre a SC-010 (15 min depois de a planilha voltar).

"Pendências da planilha" (spec FR-013) = linhas com `version > synced_version`; "desde quando" = o
menor `changed_at` entre elas. Como a planilha é refeita a partir do estado final, "aplicar na ordem"
é automático: o resultado é o mesmo de aplicar cada mudança na ordem em que aconteceu.

Volume: "A cobrar" com centenas de linhas e "Concluídas" com 90 dias de concluídas cabem com folga
numa leitura; cada rodada usa 2 ou 3 chamadas, bem abaixo da cota da API (60 leituras e 60 escritas
por minuto por usuário).

**Justificativa**: estado desejado + reconciliação é o jeito mais simples de cumprir "nada se perde"
(FR-013), "restaura o que foi alterado" (FR-011) e "pode ser refeita inteira" (FR-012) com uma só
rotina. Um único `batchUpdate` por rodada é aplicado pelo Google por inteiro ou não aplicado.

**Alternativas**: *fila de operações* (outbox de "acrescentar linha", "mover linha"): precisa de
ordem, deduplicação e reconciliação de qualquer forma quando alguém mexe na planilha; *reescrever as
abas inteiras a cada rodada*: apagaria o que o Comercial digita entre a leitura e a escrita.

**Risco aceito**: uma linha movida para "Concluídas" no mesmo segundo em que o Comercial digita nela
pode perder essa digitação. Só acontece com reserva já concluída ou com envio desfeito (não há mais
retorno a esperar), e o que foi lido antes fica no histórico.

## R-07 — Casamento das linhas por Hotel + Reserva visíveis

**Decisão**: cada linha é identificada pelas colunas visíveis **Hotel** (nome do hotel no catálogo) e
**Reserva** (número, formatado como texto). O sincronizador monta o mapa nome → código a partir do
catálogo; se dois hotéis do catálogo tiverem o mesmo nome, a coluna mostra "Nome (código)" para os
dois. Linha sem correspondência no sistema:
- com colunas de retorno preenchidas → relatada ("linha sem envio correspondente") e deixada como
  está; o sistema nunca cria nem altera reserva a partir da planilha (spec, edge cases);
- duplicada (cópia de uma linha) → a primeira vale; as outras são relatadas e apagadas na rodada.

Como as colunas do sistema ficam protegidas, o Comercial não consegue escrever Hotel ou Reserva numa
linha nova; na prática, só cópias e linhas com retorno solto aparecem.

**Justificativa**: a spec fixa as colunas da planilha (FR-010); uma coluna escondida de chave seria uma
coluna a mais. Metadados de linha do Sheets (*developer metadata*) não acompanham cópia e colagem e
complicariam a leitura.

**Alternativas**: coluna escondida com a chave; *developer metadata* por linha.

## R-08 — Leitura do retorno: regras puras no domínio

**Decisão**: `packages/domain/src/commercial-return.ts` interpreta as quatro colunas de retorno de uma
linha (spec FR-015, FR-018) e devolve um destes resultados:
- `empty` — as quatro vazias (nada a fazer);
- `incomplete` — alguma vazia (lista das que faltam);
- `illegible` — preenchidas, mas algum valor inválido (lista dos problemas);
- `complete` — os quatro valores normalizados.

Regras: textos com espaços nas pontas removidos e até 100 caracteres; **Valor cobrado** aceita número
(célula numérica, o normal com a localidade `pt_BR`) ou texto `1.234,56`, `1234,56`, `1234.56`, com ou
sem `R$`; tem de ser maior que zero e ter até 2 casas; **Hotel da cobrança** é texto livre (clarify
2026-11-17).

Detecção de mudança: a linha guarda o último retorno lido, já normalizado (`last_read_return`). Um
retorno `complete` diferente do último lido cria um retorno novo `awaiting_validation`, que substitui
(`superseded`) o anterior aguardando validação ou recusado (spec FR-017, FR-019). `incomplete` e
`illegible` só gravam o problema da linha (aparece no app e na coluna "Validação do Financeiro") e
**nada** muda na reserva. Linha cuja reserva não aceita retorno no momento (comprovante já registrado,
envio desfeito) registra o retorno no histórico como `return_ignored`, sem mudar a situação (spec,
edge cases).

Encerramento sem validação (análise 2026-11-17, "A verificar"): quando a linha deixa de estar aberta
com um retorno `awaiting_validation` — comprovante por arquivo ou o Hunit deixou de exigir cobrança
(desfazer o envio com retorno aguardando é recusado, R-11) —, o retorno vai para `closed` com o evento `return_closed` e o motivo. Não pode mais
ser confirmado nem recusado (`return_not_awaiting_validation`), e nenhuma recusa chega a uma linha de
"Concluídas". No caso do Hunit, a reserva fica com o alerta "Verificar" (R-09), e o Financeiro confere
o retorno encerrado no histórico.

**Justificativa**: as regras de interpretação são de negócio e precisam de testes unitários
(constitution VII); o ESLint do domínio impede I/O.

## R-09 — "Validar comprovante" como campo novo, não como valor novo de `situation`

**Decisão**: `ReservationTreatment.situation` (contrato 1.6.0) **não ganha valor**. O app atual faz
`SITUATION_LABELS[treatment.situation]` e quebra com um valor desconhecido. Em vez disso:
- campo novo `treatment.detailedSituation`, com os valores de `situation` **mais** `return_pending`
  ("Validar comprovante"); para as reservas com retorno aguardando validação, `situation` continua
  `treatment_sent` (o app atual mostra "Tratativa enviada", o que é verdade);
- filtro novo `detailedSituation` (mesmos valores), que o app novo usa no lugar de `situation`;
- histórico do Comercial em lista própria (`GET /reservations/{h}/{n}/commercial`), porque o app atual
  também quebraria com tipos novos de `TreatmentEvent`.

No domínio, `treatmentStatus` passa a receber "tem tratativa" = documento de tratativa atual **ou**
linha na planilha não cancelada (`open` ou `concluded`: o pedido ao Comercial continua registrado
depois que a linha vai para "Concluídas", o que mantém o alerta "Verificar" quando o Hunit deixa de
exigir cobrança, como na 003), e "tem comprovante" = documento de comprovante atual **ou** retorno
confirmado. A função nova `detailedSituation(classification, status, hasReturnAwaiting)` devolve
`return_pending` quando `reservationSituation` daria `treatment_sent` e há retorno aguardando
validação. Isso implementa a ordem da spec (premissas): comprovante → status do Hunit que não exige
mais cobrança (com o alerta "Verificar") → "Validar comprovante" → "Tratativa enviada" → status do
Hunit. `isPendingCharge` não muda: "Validar comprovante" continua em "Falta cobrar" (clarify Q1).

**Justificativa**: a spec pede API só com acréscimos, sem quebrar o app atual. Um campo e um filtro
novos são acréscimos; um valor novo num enum que o app atual usa como chave não é.

**Alternativas**: valor novo em `ReservationSituation` (quebra o app 0.x em uso); booleano
`returnAwaitingValidation` combinado com `situation` no app (o filtro por várias situações ao mesmo
tempo deixaria de ser um "ou" simples).

## R-10 — Valor cobrado com origem

**Decisão**: `effectiveChargedAmount` passa a considerar o valor do Comercial confirmado, nesta ordem
(spec FR-024): Hunit → manual (003 FR-005, exige comprovante; o retorno confirmado conta como
comprovante) → Comercial confirmado. Campo novo `treatment.chargedAmountOrigin`
(`hunit` | `manual` | `commercial` | `null`). A lista do app ganha a coluna "Valor cobrado" com a
origem, ao lado de "Valor total". O filtro `amount` (002) passa a encontrar também o valor do
Comercial.

**Ajuste da implementação (T062)**: as capturas mostraram "R$ 0,00 (Hunit)" nas reservas com o cartão
só validado — o Hunit registra a validação como uma cobrança de zero. Com a ordem acima, uma reserva
dessas que o Comercial cobrou e o Financeiro confirmou continuaria mostrando R$ 0,00. Valor do Hunit
igual a zero passou a não contar como valor cobrado (`effectiveChargedAmount` e
`chargedAmountWithOrigin` no domínio; spec FR-024 atualizada): vale o manual ou o do Comercial. O
filtro `amount` não muda (procurar "0,00" continua achando essas reservas).

## R-11 — Desfazer o envio e a confirmação são ações próprias, não documentos da 003

**Decisão**: a tratativa de envio e o comprovante por retorno **não** viram linhas de
`treatment_documents`. Na 003, o documento exige arquivo e há no máximo um documento atual por tipo:
registrar o envio como tratativa substituiria o e-mail já anexado, que seria apagado em 30 dias — o
contrário do que a spec pede (US1, cenário 9: "o documento continua registrado"). Em vez disso:
- **Desfazer o envio**: `POST /reservations/{h}/{n}/commercial/cancel` → linha `cancelled` (vai para
  "Concluídas" com "Pedido cancelado pelo Financeiro", clarify Q2). Recusado com retorno aguardando
  validação. **Reverter** em até 30 dias: `.../commercial/restore` (mesmo prazo da 003, FR-013a).
- **Desfazer a confirmação**: `POST /commercial-returns/{id}/undo-confirmation` → o retorno volta a
  `awaiting_validation`, a reserva volta a "Validar comprovante" e a linha volta para "A cobrar"
  (spec, edge cases).

As regras de elegibilidade e de prazo ficam no domínio (`commercial-dispatch.ts`), ao lado das da 003.

## R-12 — Lotes, "selecionar todas do filtro" e cópia para e-mail

**Decisão**:
- **Confirmar retornos em lote** (FR-016a) e **confirmar o alerta "Verificar" em lote** (FR-029)
  seguem o padrão dos lotes da 003 (R-05 da 003): uma transação por reserva, `batch_id` comum,
  resultado por reserva (`done`, `ignored` com motivo, `failed`), até 2 000 reservas. O "Verificar" em
  lote reaproveita o evento `review_confirmed` da 003, com `batch_id`.
- **Selecionar todas do filtro** (FR-030): rota nova `GET /reservations/selection`, com os mesmos
  filtros de `GET /reservations`, que devolve até 2 000 reservas compactas (só os campos que a seleção
  e a cópia usam), na ordem da lista, e o total encontrado. O app soma à seleção e avisa as que não
  couberam. Uma consulta só, sem paginar 40 páginas de 50 (SC-015).
- **Copiar para e-mail** (FR-027, FR-028): o app usa as reservas selecionadas ou a mesma rota de
  seleção. A tabela é montada no **processo principal** do Electron (o renderer não tem acesso à área
  de transferência do sistema) e gravada com `clipboard.write({ html, text })`: HTML com estilos
  embutidos (o Outlook ignora CSS externo) e texto com tabulação. Nada vai para o disco. O montador
  recebe só as colunas da planilha (nunca o nome do hóspede), e um teste confere isso.

## R-13 — Contrato 1.6.0 → 1.7.0

**Decisão**: só acréscimos ([contracts/api-changes.md](./contracts/api-changes.md)): rotas dos envios
(`/commercial-dispatches` e as de token, acompanhamento, cancelar e retomar), do retorno
(`/commercial-returns/...`), da planilha (`/commercial-sheet`, `/commercial-sheet/read`), do
Comercial por reserva (`/reservations/{h}/{n}/commercial` e ações), `/treatment-reviews` (lote do
"Verificar") e `/reservations/selection`; campos novos em `Reservation` e `ReservationTreatment`;
filtro `detailedSituation` (sem filtro próprio de "enviada ao Comercial": a análise de 2026-11-17 o
retirou, porque "Tratativa enviada" já reúne os dois caminhos). A cópia do contrato vai para
`specs/005-envio-comercial/contracts/openapi.yaml` na implementação; a da 004 fica congelada na 1.6.0.

## R-14 — App desktop: área "Comercial" e o envio no fluxo das execuções

**Decisão**:
- **Reservas**: ação "Enviar ao Comercial" ao lado de "Anexar tratativa/comprovante"; "Selecionar todas
  do filtro"; "Copiar para e-mail"; "Confirmar 'Verificar'" e "Confirmar retornos" no lote; coluna
  "Valor cobrado"; "Validar comprovante" no filtro de situação; seção "Comercial" no
  detalhe (linha, retorno, validação, histórico mesclado com o da tratativa, por data).
- **Envio**: diálogo com o resumo de elegibilidade (`/commercial-dispatches/check`), o mesmo formulário
  de credenciais das execuções (credenciais em memória até o app fechar, 002) e a tela de
  acompanhamento com o mesmo aviso do token (`attention.ts`: notificação, janela à frente e som). O
  `execution-watcher` passa a observar também os envios iniciados nesta máquina.
- **Área "Comercial"** (item novo na navegação): abas "Envios" (lista e resultado de cada um),
  "Retornos a validar" (lista com confirmação individual, em lote e recusa), "Retornos com problema" e
  "Planilha" (pendências, última leitura, falha atual e "Ler retornos agora").
- Perfil consulta: tudo visível, nenhuma ação (o app já esconde ações pelo papel de `/me`).

Feature dentro da faixa do espelho do Figma (002 a 006): ao fim, a skill `figma-screens-sync`
atualiza a página `005-envio-comercial` (AGENTS.md, "Telas no Figma").

## R-15 — Retenção

**Decisão**: linhas de "Concluídas" saem da planilha 90 dias depois de concluídas
(`COMMERCIAL_SHEET_DONE_RETENTION_DAYS`, padrão 90; spec FR-026); no banco a linha fica com
`removed_from_sheet_at`. Na anonimização da reserva (001 FR-026, rotina diária existente), a linha sai
da planilha e são apagados os textos livres que podem ter dado pessoal: o motivo da recusa e o último
retorno lido (o código de autorização, o valor e o responsável ficam, como os dados de cobrança do
Hunit, 001 FR-016). Envios, retornos e eventos entram nas cópias de segurança (001 FR-030); depois de
uma restauração, a primeira rodada reconstrói a planilha a partir do banco.

## R-16 — Testes

**Decisão** (constitution VII):
- `domain`: leitura do retorno, situação detalhada, valor cobrado, elegibilidade do envio, desfazer e
  reverter, rótulos da planilha;
- `server`: adaptador do Sheets contra um servidor HTTP falso (`undici` `MockAgent`): pedidos montados,
  conversão de erros em códigos, nenhum segredo em mensagens; sanitização;
- `server-db`: envio ponta a ponta com o Hunit simulado e a planilha em memória (enviada, retirada, não
  verificada, cancelar, retomar, conta ocupada), sincronizador (linhas novas, mover, restaurar,
  duplicadas, falha e nova tentativa, pendências), retornos (completo, incompleto, ilegível,
  alterado, depois da recusa), lotes, seleção, retenção, marcadores de segredo (SC-009) e de nome do
  hóspede na planilha (SC-007), cópia e restauração;
- `contracts`: rotas e campos novos validados contra o `openapi.yaml` 1.7.0; um teste confere que
  `ReservationSituation` e `TreatmentEvent.type` não ganharam valores (R-09);
- `desktop` e `desktop-ui`: área de transferência sem nome do hóspede, telas novas, perfil consulta;
- `desktop-e2e`: envio com token e acompanhamento contra a API com o Hunit simulado e a planilha em
  memória; roteiro de captura com as telas novas.

A planilha real só é tocada na homologação (quickstart §3), com uma planilha de teste e dados fictícios.

## R-17 — Homologação com planilha própria

**Decisão**: o ambiente de homologação (`deploy/homolog/`, 003) usa outra planilha e outra chave
(`COMMERCIAL_SHEET_ID` e segredo próprios no `.env.homolog`), compartilhada só com quem homologa. Os
dados são fictícios; nenhum dado real vai para a planilha de homologação.

## R-18 — Aparência da planilha: formatação condicional e bordas por linha

Pedido na homologação (spec, sessão 2026-11-17 "homologação"; FR-010a): aparência de tabela, cabeçalho
preto e lima, bordas tracejadas fora do cabeçalho e a coluna "Validação do Financeiro" colorida pelo
status.

**Decisão**: o `setup` aplica a aparência com recursos clássicos da API do Google Sheets, sem a
"tabela" do Google e sem lista suspensa:

- cabeçalho por `repeatCell` (fundo, letra, negrito, sem bordas), larguras por
  `updateDimensionProperties`;
- cores da coluna J e listras alternadas por **formatação condicional** (`addConditionalFormatRule`):
  valem para linhas novas e antigas sem o sincronizador escrever formato. As cores usam `TEXT_EQ` e
  `TEXT_STARTS_WITH` com os textos do domínio (`FINANCE_VALIDATION_TONES`); as listras usam uma fórmula
  sem separador de argumentos (`=ISEVEN(ROW())*($B2<>"")=1`), porque o separador muda com a
  localidade `pt_BR`. As regras das duas abas são do sistema: o `setup` apaga as que houver e grava as
  dele, e a ordem (cores antes das listras) decide qual vale numa célula;
- bordas tracejadas (`DASHED`) por `updateBorders` nas linhas de dados existentes, e cada linha
  acrescentada pelo sincronizador já leva bordas e formatos das colunas (`appendCells` com
  `userEnteredFormat`). As atualizações continuam escrevendo só o valor.

A coluna J passa a mostrar "Aguardando retorno do Comercial" na linha aberta sem retorno, para ter a
cor de "nova tratativa". A migration 0012 marca as linhas abertas como pendentes (`version + 1`), para
a primeira rodada depois da atualização reescrever a coluna J sem relatar "célula do sistema
alterada".

**Alternativas rejeitadas**:

- *Tabela do Google* (`addTable`, colunas tipadas, `DROPDOWN`): a documentação não diz como a tabela se
  comporta com as linhas que o sincronizador acrescenta (`appendCells` sem `tableId`) e apaga
  (`deleteDimension`), nem com valores fora da lista numa coluna de lista suspensa. O risco cai numa
  projeção que precisa ser refeita sozinha (R-06).
- *Lista suspensa na coluna J*: nem `ConditionValue` nem a regra de validação da tabela têm campo de
  cor por opção — as cores dos chips só são escolhidas à mão, no Google, e seriam perdidas quando o
  `setup` regravasse a regra. A lista também exigiria valores fixos, e o motivo da recusa e o que falta
  no retorno (FR-017, FR-018) iriam para uma nota, visível só ao passar o mouse.
- *Faixas alternadas* (`addBanding`): a documentação não diz se a faixa cresce com linhas acrescentadas
  pela API; a formatação condicional com intervalo aberto (`A2:N`) cobre isso sem depender do tamanho.

## Homologação (T064, 2026-11-17)

Ambiente de homologação (`deploy/homolog/`, quickstart §2.1 da 003) com a planilha de teste e a chave
própria (R-17); dados fictícios. A homologação não acessa o Hunit: o envio fictício foi gravado pelo
`homolog-commercial` (quickstart §3, passo 6), com 12 reservas por hotel em "A cobrar" e 3 em
"Concluídas" com o alerta "Verificar".

| Teste (quickstart §3) | Resultado |
|---|---|
| Preparação: servidor com as migrations da 005, `commercial-sheet setup` e `check` ("acesso OK", abas, cabeçalhos, proteções), colunas A:J de "A cobrar" e "Concluídas" bloqueadas para a segunda conta Google, envio fictício na planilha em até 30 s, sem nome de hóspede | Aprovado |
| Retorno completo com hotel da cobrança diferente e "Ler retornos agora": "Validar comprovante" em até 1 min, hotel da cobrança destacado, valores e diferença no detalhe (SC-004) | Aprovado |
| Retorno lido sozinho, sem "Ler retornos agora", em até 15 min (SC-004) | Aprovado |
| Retorno só com o código e com valor ilegível: "Retornos com problema" e coluna J, sem mudar a reserva | Aprovado |
| Confirmar: "Comprovante enviado", "Valor cobrado" com origem Comercial, linha em "Concluídas" | Aprovado |
| Recusar com "Valor diferente" e corrigir: "Tratativa enviada" e a recusa na coluna J; depois da correção, "Validar comprovante" de novo e a recusa sai da linha | Aprovado |
| "Confirmar retornos" em lote: lista de revisão com código, hotel da cobrança, valores e diferença; as sem retorno ficam de fora com o motivo | Aprovado |
| Desfazer envio e reverter: "Pedido cancelado pelo Financeiro" em "Concluídas" e de volta a "A cobrar" | Aprovado |
| Internet desligada por cerca de 5 min com uma confirmação no meio: gravada no app, "Com falha" com as pendências e desde quando; ao voltar, pendências zeradas e planilha atualizada sozinha (SC-010) | Aprovado |
| "A verificar" → "Selecionar todas do filtro" → "Confirmar 'Verificar'": contagem por status do Hunit; filtro vazio depois | Aprovado |
| "Copiar para e-mail" colado no cliente de e-mail (tabela com as 8 colunas, total, filtros e momento, sem hóspede) e no Bloco de Notas (colunas por tabulação) | Aprovado |
| Perfil consulta: vê as quatro abas da área Comercial e o detalhe, sem nenhuma ação | Aprovado |
| "Enviar ao Comercial" pelo app sem Hunit: falha no acesso e nada vai para a planilha | Aprovado (esperado) |
| Logs do servidor sem o ID da planilha, o e-mail da conta de serviço, a chave e nomes de hóspede | Aprovado |

SC-002 (20 reservas na planilha em até 5 min depois do token) depende do Hunit real: medir na
primeira semana da produção (T066).

**Ajustes pedidos**: aparência da planilha — formatação de tabela, bordas tracejadas fora do
cabeçalho, cabeçalho preto e lima e a coluna "Validação do Financeiro" colorida pelo status (lima,
laranja, vermelho). Viraram a FR-010a e a R-18, implementados em T067 a T070 e homologados em T071.

### Homologação dos ajustes da planilha (T071, 2026-11-17)

Mesmo ambiente, com o servidor atualizado (migration 0012 aplicada ao subir) e o `commercial-sheet
setup` rodado de novo na planilha de teste.

| Teste | Resultado |
|---|---|
| `setup` com a linha "Aparência" na saída | Aprovado |
| Cabeçalho de A a J preto com letra lima e de K a N lima com letra preta, sem bordas; listras e bordas tracejadas nas linhas de dados; coluna J em lima nas linhas abertas, sem casos de "célula alterada" em Problemas | Aprovado |
| Retorno completo e "Ler retornos agora": coluna J em laranja | Aprovado |
| Recusa e retorno só com o código: coluna J em vermelho | Aprovado |
| Desfazer o envio e reverter: as linhas acrescentadas em "Concluídas" e de volta em "A cobrar" chegam com as bordas | Aprovado |
