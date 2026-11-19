# Research: Ajustes de cobrança e do aviso de token

Fase 0 do `/speckit-plan` (2026-11-19). Cada decisão traz o porquê e as alternativas descartadas. As
decisões de produto tomadas ao planejar estão na spec (clarificações, sessão "plano"); aqui ficam as
de **como**.

Ponto de partida conferido no código (branch `008-ajustes-cobranca-e-aviso`, com a `master` da 006):

- o retorno da 005 tem só quatro campos (`COMMERCIAL_RETURN_FIELDS`, colunas K a N); não existe
  "Cobrada no Hunit" nem data da cobrança;
- "Cancelada sem cobrança" já existe como **classificação** calculada do Hunit (`cancelled_no_charge`),
  no grupo "Concluídas" dos filtros rápidos e fora de "Falta cobrar";
- o aviso do token chama a notificação do Windows **com som** (`silent: false`, `main/attention.ts`) e
  o renderer toca `token-alert.wav` por cima, sem volume (`App.tsx`): daí os dois sons;
- o envio ao Comercial já verifica reservas no Hunit uma a uma, com token, cancelamento, retomada e a
  regra de uma automação por conta (`dispatches/runner.ts`);
- o exe instalado (0.3.201) tem a marca no ícone e o atalho do Menu Iniciar tem o AUMID do app, mas a
  barra de tarefas mostra o ícone do Electron (produção, 006 T067);
- nos filtros da lista, "Hotéis" e "Canal" aceitam digitar; "Situação da reserva", "Ativa ou
  cancelada" e "Origem" não (`ReservationFilters.tsx`);
- a busca livre da lista de reservas não olha o código de autorização do retorno do Comercial (R-15).

## R-01 — Versões, ordem de implantação e relação com a 007

**Decisão**: contrato **1.8.0 → 1.9.0**, só acréscimos; app **0.3 → 0.4**. Ordem padrão da
atualização (README, passo 9): servidor primeiro (migration nova), em seguida o comando
`commercial-sheet setup` (as colunas novas da planilha, R-05) e, por último, o instalador nas
máquinas. O app 0.3 continua funcionando contra a 1.9.0 (R-02). A 008 vem antes da 007 (relatórios):
se a 007 mexer no contrato, ela parte da 1.9.0.

**Por quê**: é o mesmo caminho das features 005 e 006, já exercitado em produção; o app em uso não
quebra durante a troca.

**Alternativas**: atualizar app e servidor juntos (exige parar o Financeiro); versão maior da API
(não há mudança incompatível).

## R-02 — Enumerações que o app 0.3 usa como chave não ganham valores

**Decisão**: o teste `contract-frozen-enums.test.ts` passa a congelar também, como a 1.8.0 entregou:
`ReservationDetailedSituation`, `CommercialEvent.type`, `CommercialReturnState` e
`CommercialSheetProblem.kind` (além dos três da 005). Todo valor novo da 008 vai num **campo novo**:
`Reservation.noCharge`, `Reservation.commercial.report`, `CommercialReturnBrief.chargeSituation`,
`CommercialDetail.history`, `CommercialSheetStatus.reports`, `CommercialDispatch.purpose`,
`CommercialDispatchItem.checkResult` ([contracts/api-changes.md](./contracts/api-changes.md)).

Única exceção: `CommercialDispatchItem.outcome` ganha `checked`, que só aparece em verificações
(`purpose = hunit_check`, R-07). O app 0.3 nunca recebe uma verificação: a lista de envios as deixa
de fora por padrão, e um teste de servidor confere isso.

**Por quê**: o app 0.3 faz `DETAILED_SITUATION_LABELS[...]`, `COMMERCIAL_EVENT_NAMES[...]`,
`RETURN_STATE_LABELS[...].name` e `SHEET_PROBLEM_NAMES[...]`; um valor desconhecido quebra a tela ou
mostra texto vazio (mesma razão da 005, R-09).

**Destaque**: "Cancelada sem cobrança" **não precisa de valor novo**: a situação marcada é
`cancelled_no_charge`, que já existe em `ReservationSituation` e `ReservationDetailedSituation`
(R-08). O app 0.3 mostra a reserva marcada com o selo certo e em "Concluídas".

## R-03 — Som do aviso: um só, com volume

**Decisão**:

- A notificação do pedido de token e a do "Testar aviso" passam a `silent: true`; o único som é o do
  app (FR-003). A notificação de fim de execução não muda (não há som do app nela).
- Preferência nova `soundVolume` (inteiro de 0 a 100) ao lado de `soundEnabled`, no `ConfigStore`. O
  esquema da configuração aceita o arquivo antigo, sem o campo, e assume **100** (o som de hoje, que
  toca no volume do sistema); `soundEnabled: false` antigo continua desligado (FR-005).
- O principal manda o volume junto do pedido de som (`attention:playSound` com `{ volume }`); o
  renderer toca o `token-alert.wav` com `audio.volume = volume / 100`. Falha ao tocar (sem
  dispositivo de áudio) é ignorada, como hoje: aviso visual e notificação continuam (edge case).
- O card "Aviso do pedido de token" grava na hora (chave e volume), sem botão "Salvar"; ao soltar o
  controle de volume (`onChangeEnd`), com o som ligado, o renderer toca a amostra no volume escolhido
  (FR-006). Volume 0 é aceito: a chave continua ligada (edge case).
- A chave "Som do aviso dentro do app" sai do card "Preferências" (FR-004), que fica só com o prazo de
  inatividade e "Salvar preferências".

**Por quê**: o Windows não deixa um app controlar o volume do som da própria notificação; tocar o som
só no app é a única forma de ter um som só e com volume. Gravar na hora segue a tela 1.1 (o card não
tem botão).

**Alternativas**: deixar o som só na notificação (sem volume, e o Windows pode suprimi-lo no modo
"Não incomodar"); volume no sistema (afetaria tudo).

## R-04 — Componentes: Switch desligado e Controle de volume

**Decisão**: `SwitchField` ganha o estilo do estado desligado do design (o comentário de hoje diz que
o design só tinha o ligado). Componente novo `VolumeField` em `ui/fields/` (sobre o `Slider` do
Mantine, permitido dentro de `ui/`): rótulo "Volume", ícones de som baixo e alto, trilho preto com o
botão lima, valor em "70 %", estados ativo e desabilitado. Teclado: setas (±5), Page Up/Down (±10),
Home/End; foco visível; `aria-label` "Volume do aviso" e `aria-valuetext` com a porcentagem (US5-3).
Catálogo em [contracts/ui-components.md](./contracts/ui-components.md).

**Por quê**: regra da 006 — o que se repete é componente único, e as telas não usam os componentes
visuais do Mantine direto (lint).

## R-05 — Planilha: colunas "Situação da cobrança" e "Data da cobrança"

**Decisão**: duas colunas novas **no fim**: **O "Situação da cobrança"** e **P "Data da cobrança"**,
preenchidas pelo Comercial, como K a N ([contracts/sheet-layout.md](./contracts/sheet-layout.md)).

- O: validação de dados `ONE_OF_LIST` com "Cobrada na maquininha", "Cobrada no Hunit" e "Não
  cobrada", **`strict: false`** e `showCustomUi: true`: o Comercial escolhe na lista suspensa ou
  digita outro texto (a planilha só marca o texto com um aviso). É o formato 1 do FR-008.
- P: validação `DATE_IS_VALID` com `strict: true` (a planilha recusa o que não é data) e formato
  `dd/mm/aaaa`.
- "A cobrar": as colunas O e P ficam fora da proteção (K a P editáveis pelo Comercial); cabeçalho em
  lima, como K a N. "Concluídas" continua protegida inteira.
- O cabeçalho esperado passa a ter 16 colunas (`COMMERCIAL_SHEET_HEADERS`). A planilha em uso fica com
  `layout_invalid` (nada é escrito) até o `commercial-sheet setup` rodar de novo: o comando acrescenta
  as duas colunas sem mexer nas linhas que já existem. Por isso o `setup` entra no passo da
  atualização, logo depois do servidor (R-01).

**Por quê**: acrescentar no fim não desloca os retornos já preenchidos em K a N; inserir colunas no
meio mexeria em dados do Comercial durante a atualização. A validação não estrita é o recurso do
próprio Google para "opções sugeridas, mas aceita outro texto".

**Alternativas**: lista estrita (formato 2: o Comercial não registraria um caso novo); texto livre
puro (formato 3: mais erros de digitação); colunas antes de K (mais natural de preencher, mas move os
retornos existentes).

## R-06 — Leitura do retorno com situação e data

**Decisão**: `readReturn` (domínio) passa a ler as seis colunas de retorno (K a P) e devolve:

| Resultado | Quando | O que o servidor faz |
|---|---|---|
| `empty` | as seis vazias | nada |
| `report` (`charged_in_hunit`) | situação reconhecida como "Cobrada no Hunit" e o responsável preenchido | grava o relato; a reserva entra na fila (R-07) |
| `report` (`not_charged`) | situação reconhecida como "Não cobrada" e o responsável preenchido | grava o relato; aparece em "Retornos com problema" (lista `reports`) |
| `incomplete` | relato sem responsável, ou retorno comum com algum dos quatro campos vazio | problema "Retorno incompleto: falta …" (como hoje) |
| `illegible` | algum valor não entendido, inclusive a data | problema "Retorno não entendido: …" (a data entra na lista de problemas) |
| `complete` | os quatro campos de hoje entendidos (situação "Cobrada na maquininha", vazia ou outra) | retorno a validar, como hoje, agora com situação e data |

- **Reconhecimento da situação** (FR-008): compara sem acento, sem maiúsculas e sem espaços extras;
  começa com "nao cobrad" → `not_charged`; contém "hunit" → `charged_in_hunit`; contém "maquininha" →
  `charged_at_terminal`; qualquer outro texto → `other`, guardado e mostrado como veio. A situação
  manda: um relato "Cobrada no Hunit" com os quatro campos também preenchidos continua sendo relato
  (os quatro campos são ignorados). Até 100 caracteres, como os outros textos.
- **Data**: a API do Google devolve a data como número de série (dias desde 30/12/1899) com
  `UNFORMATTED_VALUE`; texto `dd/mm/aaaa` também é aceito. Outro valor → `illegible` ("data da
  cobrança não entendida"). A data não é comparada com hoje em nenhum lugar (FR-011): só é lida e
  exibida.
- **Mudança do Comercial**: `returnChanged` compara também situação e data; mudar qualquer uma num
  retorno completo gera `return_changed` (o anterior fica `superseded`), como hoje. Trocar um relato
  por outra situação apaga o relato e a reserva sai da fila na mesma rodada (FR-012).
- **Onde fica**: o retorno completo continua em `commercial_returns`, com três colunas novas
  (situação, tipo reconhecido e data). Os relatos ("Cobrada no Hunit", "Não cobrada") ficam numa
  tabela própria, `commercial_reports`, uma linha por reserva ([data-model.md](./data-model.md)).
- **Coluna J** (Validação do Financeiro) ganha textos para os relatos: "Aguardando verificação no
  Hunit" (laranja), "Cobrança não encontrada no Hunit" (vermelho) e "Não cobrada: aguardando o
  Financeiro" (vermelho).

**Por quê**: o relato não tem valor nem código para o Financeiro validar; pô-lo em
`commercial_returns` obrigaria a afrouxar as colunas obrigatórias e a criar estados que o app 0.3 não
conhece (R-02). Situação vazia seguindo a regra de hoje mantém os retornos já preenchidos válidos.

**Alternativas**: exigir situação em todo retorno (quebraria os retornos em andamento); um campo de
observação livre para "Não cobrada" (coluna a mais; a situação aceita texto, que já serve para isso).

## R-07 — Fila "Cobradas no Hunit" e o "Verificar agora"

**Decisão — situação derivada, sem estado próprio**: para cada relato `charged_in_hunit`, a situação
na fila é calculada na leitura:

- `awaiting` ("Aguardando verificação"): a reserva não foi lida no Hunit depois de `read_at` do relato
  (`reservations.last_verified_at <= read_at`);
- `confirmed` ("Confirmada no Hunit"): lida depois, e a classificação não exige mais cobrança
  (`requiresCharge` falso) — a reserva já está em "Concluídas" e a linha vai para "Concluídas" da
  planilha pela regra da 005 (`lineState`);
- `not_found` ("Não encontrada no Hunit"): lida depois, e ainda exige cobrança — continua pendente.

Qualquer leitura conta: o "Verificar agora" e as execuções (spec, sessão "plano"). Nada roda sozinho
em segundo plano. Um "Verificar agora" que não consegue ler uma reserva (Hunit indisponível, reserva
não encontrada) não muda `last_verified_at`, então a situação fica como estava (FR-016).

**Lista e contagem**: a aba mostra os relatos `awaiting` e `not_found` e os `confirmed` por **7
dias** depois da leitura que confirmou (a linha diz que a reserva foi para "Concluídas"); a contagem
da aba é o número de linhas mostradas, como na tela 7.15.

**"Verificar agora" = um envio com outro propósito**: o executor dos envios (`DispatchRunner`) ganha
o propósito `hunit_check`. Mesmo ciclo (`queued` → `running` → `awaiting_2fa` → `running` →
`completed`), mesmas credenciais do cofre, mesmo pedido de token e aviso, cancelamento, retomada,
eventos SSE e a regra de uma automação por conta (constitution IV). Diferenças: os itens são os
relatos `awaiting` e `not_found` no momento do pedido; cada reserva é lida com `findReservation` e
gravada com `commitVerifiedReservation` (como no envio), mas **não abre linha nem escreve evento de
envio**; o item termina `checked` com `checkResult` `confirmed` ou `still_pending`, ou
`not_verified` com o motivo. Sem relato para conferir → 409 `no_reports_to_check`.

**Compatibilidade**: `GET /commercial-dispatches` continua devolvendo só os envios (`purpose=send`)
por padrão; `?purpose=hunit_check` ou `all` traz as verificações. O app 0.3 nunca vê uma verificação
(e não precisa: só o 0.4 as inicia). O vigia do app 0.4 (`execution-watcher.ts`) acompanha os dois
propósitos para o aviso do token.

**Por quê**: a verificação é exatamente a metade "ler no Hunit e gravar" do envio; reaproveitar o
executor evita um segundo job com token, retomada e trava por conta (constitution VIII). Situação
derivada não fica desatualizada quando uma execução lê a reserva.

**Alternativas**: job novo com tabela própria (duplica o executor); conferência só pelo "Verificar
agora" com estado gravado (descartada pelo usuário, sessão "plano"); conferência automática periódica
(exigiria token sem humano; fora da constitution IV).

**Leitura e FR-015**: a conferência lê a reserva como o envio e a execução leem — os dados e a
classificação passam a ser os do Hunit. Ela nunca cria comprovante, valor cobrado ou documento: a
cobrança só "existe" para o sistema se o Hunit a mostrar (spec FR-015 reescrito na sessão "plano").

## R-08 — "Cancelada sem cobrança" como marcação do Financeiro

**Decisão — classificação efetiva**: a marcação é uma camada ao lado da reserva, como a tratativa
(003). Com uma marcação ativa, a reserva passa a ter, para tudo que é exibido e filtrado, a
**classificação efetiva** `cancelled_no_charge`; a classificação calculada do Hunit não muda e
continua no bloco "Status do Hunit" (tela 7.18). Com isso, sem regra nova em cada lugar:

- situação e situação detalhada = `cancelled_no_charge` (selo "Cancelada sem cobrança");
- fora de "Falta cobrar", dentro de "Concluídas" (grupo `done` que já existe);
- não aceita tratativa, comprovante nem envio enquanto marcada (`acceptsTreatment` falso);
- a linha da planilha vai para "Concluídas" (`lineState` → `concluded`), com "Valor a cobrar" R$ 0,00
  e a coluna J "Cancelada sem cobrança pelo Financeiro";
- o alerta "Verificar" não aparece numa reserva marcada (`needsReview` falso).

No domínio, `effectiveClassification(classification, noChargeMarked)` entra em `reservationSituation`,
`detailedSituation`, `isPendingCharge`, `needsReview`, `lineState` e `dispatchEligibility`; no
servidor, a mesma regra vira uma expressão SQL usada pelas condições e pelas contagens, conferida
pelo teste de paridade da 006.

**Valor**: `Reservation.amountToCharge` (novo) = `totalAmount`, ou `0.00` com a marcação; a lista e a
planilha mostram R$ 0,00 com "antes R$ 655,00" na segunda linha; `totalAmount` continua o do Hunit.

**Regras da ação** (`noChargeEligibility`, domínio): aceita as classificações que aceitam tratativa
(as mesmas da 003, estando ou não cancelada no Hunit), inclusive enviada ao Comercial sem retorno e
com relato "Não cobrada"; recusa (409, com o motivo em português) já concluída (classificação que não
aceita tratativa), com comprovante atual, com retorno aguardando validação ou já marcada (FR-022).
**Concorrência**: o pedido leva a `detailedSituation` que a pessoa viu; se mudou, 409
`reservation_changed` e o diálogo avisa sem aplicar (edge case "Duas pessoas").

**Desfazer**: marca a marcação como desfeita (quem e quando); tudo volta a ser derivado da
classificação do Hunit, inclusive a linha, que volta a "A cobrar" se a reserva ainda exigir cobrança.
Sem prazo para desfazer (a spec não limita). Concorrência: desfazer uma marcação já desfeita → 409.

**Histórico**: marcar e desfazer aparecem no histórico do card "Tratativa" (tela 7.18), vindos de
`Reservation.noCharge.history` (campo novo; `TreatmentEvent.type` é congelado).

**Hunit mostra cobrada** (FR-023): se a classificação do Hunit passar a `virtual_card_already_charged`
numa reserva marcada, a marcação continua e o card "Cancelada sem cobrança" mostra o aviso "O Hunit
mostra esta reserva como cobrada" (campo `noCharge.hunitShowsCharge`, calculado).

**Retenção**: a observação (até 500 caracteres) é apagada na anonimização da reserva, como o motivo da
recusa da 005.

**Alternativas**: gravar a classificação `cancelled_no_charge` na reserva (a próxima execução
apagaria a marcação, contra o FR-023); valor novo em `situation` (quebra o app 0.3, R-02).

## R-09 — Situação e data da cobrança no app

**Decisão**: `CommercialReturnBrief` e `CommercialReturn` ganham `chargeSituation` (`{ kind, text }` ou
nulo) e `chargeDate` (data ou nula). O app mostra:

- gaveta, bloco "Retorno do Comercial" (tela 7.5): "Situação da cobrança" e "Data da cobrança", com
  "hoje" ou "ontem" embaixo quando for o caso;
- "Retornos a validar" (tela 7.8): na coluna "Responsável e cobrança", "<situação> em <data> (hoje)";
- confirmação em lote (tela 7.12): a mesma linha por retorno;
- vazio → "não informada" (FR-011).

Nenhuma regra de data no servidor ou no app: um teste de servidor confirma um retorno com a data de
hoje pelos três caminhos (rota única, lote e gaveta) (FR-011, SC-003).

## R-10 — Ícone na barra de tarefas do Windows

**Diagnóstico até aqui** (19/11/2026, máquina de desenvolvimento com o 0.3.201 instalado): o `.exe`
instalado tem a marca (ícone extraído do arquivo), o atalho do Menu Iniciar aponta para ele e tem o
AUMID `io.github.sura-team.hunit-control`, igual ao `app.setAppUserModelId` do app; mesmo assim, a
barra de tarefas mostra o ícone do Electron, inclusive piscando no aviso. Duas causas prováveis, não
excludentes:

1. **O desenvolvimento e os testes usam o mesmo AUMID** com o `electron.exe`: o Windows guarda o ícone
   da barra de tarefas por AUMID, e a identidade do app instalado fica associada ao executável do
   Electron que rodou com ela (dev e `desktop-e2e` rodam muitas vezes nesta máquina).
2. **A janela empacotada não recebe ícone** (`window.ts` só passa `icon` em desenvolvimento) e a
   barra de tarefas usa o ícone da janela, que vem de um recurso do executável diferente do que o
   `rcedit` trocou.

**Decisão** (as três medidas, baratas e independentes, para cobrir as duas causas):

- desenvolvimento e testes passam a usar o AUMID `io.github.sura-team.hunit-control.dev`; só o app
  empacotado usa o AUMID do instalador;
- a janela empacotada também recebe o ícone: o `icon.ico` vai junto do app (`extraResources` do
  `electron-builder.yml`) e `createMainWindow` o usa nos dois modos;
- no Windows, `window.setAppDetails({ appId, appIconPath: process.execPath, appIconIndex: 0,
  relaunchDisplayName: 'HUNIT Control' })` liga o botão da barra de tarefas ao ícone do executável.

A tarefa começa reproduzindo o problema com o instalador atual e confirmando qual medida resolve
(registrar em "Comparação e homologação"); o cenário do quickstart roda numa máquina que já teve
versões anteriores e o app em desenvolvimento. Se o cache de ícones do Windows ainda mostrar o antigo
depois da correção, o README ganha o passo de limpar o cache (`ie4uinit.exe -show`).

**Testes**: `builder-config.test.ts` confere o `extraResources`; `window.test.ts` confere o ícone e os
detalhes da janela nos dois modos e o AUMID por modo.

**Alternativas**: só limpar o cache em cada máquina (volta no próximo `pnpm dev` com o mesmo AUMID);
assinar o executável (não muda o ícone; fora do escopo, 002 R-11).

## R-11 — Busca pelo teclado em todos os seletores

**Decisão**: `SelectField` e `MultiSelectField` (de `ui/fields/`) passam a ter busca por padrão
(`searchable`), com `nothingFoundMessage` "Nenhuma opção encontrada" e a busca sem acentos e sem
maiúsculas (`filter` do Mantine com normalização). Com o teclado: digitar filtra, setas andam, Enter
escolhe, Esc fecha (comportamento do `Combobox` do Mantine). Vale para todos os filtros de lista,
inclusive os de 3 opções ("Ativa ou cancelada", "Origem"), e para o "Hotéis" do Executar (já tinha).
Um teste de `desktop-ui` por seletor da tela de Reservas escolhe uma opção só pelo teclado (SC-010).

**Por quê**: o usuário escolheu "todos os seletores" (sessão "plano"); como padrão do componente
único, nenhuma tela nova esquece.

**Alternativas**: ligar só no "Situação da reserva".

## R-15 — Busca pelo código de autorização do Comercial (história 7)

**Causa conferida**: a busca livre (`freeTextCondition`, `apps/server/src/persistence/reservations-repo.ts`)
compara o texto com o número da reserva, a transação, o código de autorização **do Hunit**
(`reservations.authorization_code`), a referência da operadora e o hóspede; o código que o Comercial
informa fica em `commercial_returns.authorization_code` e nunca é olhado.

**Decisão**: `freeTextCondition` ganha mais uma alternativa: a reserva tem um retorno **confirmado**
(`state = 'confirmed'`) com `lower(authorization_code) = lower(texto)`, a mesma comparação do código do
Hunit (texto inteiro, sem maiúsculas). Como a lista, as contagens dos filtros rápidos e o
`GET /reservations/selection` montam as condições pela mesma função, os três passam a achar pelo código
de uma vez (FR-029). Retornos não confirmados ficam de fora por regra (spec, sessão "plano"); desfazer
a confirmação volta o retorno para `awaiting_validation`, e ele sai da busca sozinho.

**Desempenho**: a subconsulta usa a chave da reserva, coberta pelo índice único parcial dos retornos
(um `awaiting_validation` ou `confirmed` por reserva); nenhum índice novo. O teste de desempenho da 006
(contagens com 20 000 reservas em até 1 s) roda com a busca por código.

**Contrato**: sem campo novo; só a descrição do parâmetro `q` em `/reservations`,
`/reservations/selection` e `/reservations/quick-filter-counts` passa a citar o código do Comercial
confirmado. O texto de ajuda da busca no app ("Buscar por hóspede, nº da reserva, transação,
autorização ou valor") já cobre o caso.

**Alternativas**: incluir também retornos aguardando validação (descartado: o código só é o real
depois da confirmação, regra do usuário); copiar o código confirmado para `reservations.authorization_code`
(misturaria dado do Comercial com o do Hunit e a próxima execução o sobrescreveria).

## R-12 — Testes em camadas (constitution VII)

| Camada | O que entra |
|---|---|
| `domain` | `readReturn` com situação e data (todas as linhas da tabela do R-06, reconhecimento sem acento, data por número e por texto); `effectiveClassification` e as funções que a usam; `noChargeEligibility`; `hunitChargeStatus`; textos da coluna J |
| `contracts` | `openapi.yaml` 1.9.0 válido e tipos gerados em dia |
| `server` | enums congelados (R-02); `compose-config` sem mudança |
| `server-db` | migration; paridade SQL × domínio com reservas marcadas e relatos; rotas novas (marcar, desfazer, fila, verificação) com teste de contrato; confirmação com data de hoje (R-09); retenção apaga a observação; `setup` acrescenta O e P sem mexer nas linhas (planilha em memória); busca pelo código do Comercial confirmado na lista, nas contagens e na seleção, e não pelo de retorno aguardando, recusado, substituído ou com a confirmação desfeita (R-15) |
| `server-browser` | verificação `hunit_check` com o Hunit simulado: confirmada, ainda pendente, Hunit indisponível (situação mantida), token e cancelamento |
| `desktop` | preferências com volume (arquivo antigo sem o campo), notificação sem som, AUMID e ícone por modo, `extraResources` |
| `desktop-ui` | card do aviso (chave, volume, amostra, desabilitado), Preferências sem a chave, Retornos a validar/lote/gaveta com situação e data, fila e "Verificar agora" por perfil, marcar/desfazer com diálogo e 409, seletores pelo teclado |
| `desktop-e2e` | jornada da fila (relato na planilha simulada → "Verificar agora" com token → confirmada) e da marcação (marcar → Concluídas e contagens → desfazer); `screens-capture` com as telas 1.1 a 1.3, 7.5, 7.7, 7.8, 7.12, 7.15, 7.17 e 7.18; roteiros de larguras com as telas novas |

## R-13 — Diferenças do design levadas à UX

| Tela | Diferença | Decisão para o código |
|---|---|---|
| 7.18 | O card "Comercial" mostra o selo "Fora da planilha" | Mostra a linha em "Concluídas" (spec, sessão "plano"); "Fora da planilha" fica para linha que já saiu |
| 1.1 a 1.3 | Volume de exemplo em 70 % | O volume inicial é 100 % (o de hoje, FR-005); 70 % é só exemplo |
| 7.15 | "Verificar agora" sem o pedido de usuário e senha | Usa o mesmo passo do envio (credenciais do cofre; se faltarem, o diálogo de credenciais da 005) |
| — | Diálogo de "Desfazer" não desenhado | Diálogo pequeno padrão da 006 (spec FR-021) |
| — | Relato "Não cobrada" em "Retornos com problema" não desenhado | Linha da lista de problemas com a situação, o responsável e "Abrir" |
| — | Linha da lista de reservas marcada não desenhada | Selo "Cancelada sem cobrança" e valor R$ 0,00 com "antes R$ …" |
| — | Item da fila "Aguardando verificação" mostra "confere na próxima execução" | Mantido (sessão "plano") |

## R-14 — Figma ao concluir

**Decisão**: ao concluir, a skill `figma-screens-sync` com `FEATURE = '008-ajustes-cobranca-e-aviso'`
marca com ✅ as telas da página 008 (1.1, 1.2, 1.3, 7.5, 7.7, 7.8, 7.12, 7.15, 7.17, 7.18) e com ❌
(ocultas) as mesmas telas na página 006. O FR-024 fala em "espelho"; desde 18/11/2026 o agente não
desenha telas no Figma (AGENTS.md, "Telas no Figma"): atualizar o espelho é essa marcação.
