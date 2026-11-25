# Research: Módulo de Relatórios do app desktop

Fase 0 do `/speckit-plan` (2026-11-25). Cada decisão traz o porquê e as alternativas descartadas. As
decisões de produto estão na spec (clarificações de 2026-11-25, sessões "clarify" e "plano"); aqui
ficam as de **como**.

Ponto de partida conferido no código (branch `007-relatorios-app-desktop`, com a `master` da 008):

- a spec é de 16/11, de antes da 005, da 006 e da 008 entrarem na `master`; o clarify a alinhou com o
  design (página `007-relatorios-app-desktop` do Figma, telas 8.1 a 8.7) e com as regras atuais;
- o servidor já calcula, numa consulta só, os fatos da tratativa de cada reserva (classificação
  efetiva, tratativa, comprovante, retorno aguardando, revisão e marcação) para as contagens dos
  filtros rápidos (`countQuickFilters` em `apps/server/src/persistence/reservations-repo.ts`, uma CTE
  materializada; 20 000 reservas em 0,6 s);
- o valor cobrado exibido já tem regra no domínio (`chargedAmountWithOrigin`: Hunit, informado à mão
  com comprovante, Comercial confirmado) e o valor a cobrar também (`amountToCharge`);
- `reservations` tem índice por hotel e check-in e por check-in;
- o app já tem o calendário de período (`ui/PeriodPicker.tsx`, dois meses, "Ir para hoje"), a gaveta
  (`ui/AppDrawer.tsx`), o aviso de servidor indisponível com a hora dos dados
  (`components/StaleDataNotice.tsx`, tela 5.1), os selos de situação e o menu sem "Executar" no
  perfil consulta (`App.tsx`);
- a área Reservas só recebe de fora um filtro: a execução (`initialExecutionId`);
- o sistema anterior calculava as mesmas quatro faixas de valor (`VALUE_BUCKETS` do legado: cobrado
  sem tratativa, cobrado depois da tratativa, solicitado e pendente); a regra foi confirmada no
  clarify (FR-014).

## R-01 — Versões e implantação

**Decisão**: contrato **1.9.0 → 1.10.0**, só acréscimos (uma rota nova e um valor novo no parâmetro
`order` das reservas); app **0.4 → 0.5**. Sem migration, sem variável nova, sem passo na planilha.
Atualização pelo passo 9 do README: servidor e depois o instalador. O app 0.4 continua funcionando
contra a 1.10.0 (não recebe nada novo).

**Por quê**: o módulo é só leitura sobre dados que já existem; o caminho de sempre (005, 006, 008).

**Alternativas**: versão maior da API (nada incompatível); calcular tudo no app a partir de
`/reservations` (35 mil reservas pela rede, regra de negócio no Electron — constitution III).

## R-02 — Uma rota de resumo com os hotéis

**Decisão**: `GET /reports/overview?checkInFrom=AAAA-MM-DD&checkInTo=AAAA-MM-DD` (os dois
obrigatórios, mesma validação do período das reservas, `InvalidPeriodError`), para os dois perfis.
Devolve, numa resposta, os totais do período e a linha de cada hotel com reservas no período
([data-model.md](./data-model.md) §2). O ranking, "Todos os hotéis" (busca e ordenação no app, R-09)
e o resumo da gaveta do hotel saem dessa resposta; só a lista de reservas da gaveta faz outra
chamada (R-07).

**Por quê**: são dezenas de hotéis (83 no design); uma resposta pequena, sem paginação, deixa a troca de
período numa ida ao servidor (SC-003) e garante que ranking, gavetas e cards falem do mesmo cálculo
(mesmo `generatedAt`).

**Alternativas**: uma rota por bloco (totais, ranking, hotel) — várias idas e momentos diferentes
para números da mesma tela; paginação dos hotéis — desnecessária para dezenas.

## R-03 — As faixas de valor numa regra só, no domínio

**Decisão**: módulo novo `packages/domain/src/report.ts`, com:

- `REPORT_EXCLUDED_SITUATIONS = ['ignored_hotelbeds_258', 'not_virtual_card', 'invoiced']` (FR-008a),
  aplicado sobre a **situação detalhada** (a coluna da lista, depois da marcação "Cancelada sem
  cobrança" e do comprovante);
- `reportBucket({ detailedSituation, pendingCharge, hasRequest })` → `previous_charged` |
  `recovered` | `requested` | `pending` | `none` | `excluded`:
  - situação excluída → `excluded`;
  - "Falta cobrar" com tratativa → `requested` (inclui "Tratativa enviada" e "Validar comprovante");
  - "Falta cobrar" sem tratativa → `pending`;
  - "Comprovante enviado" ou "Já cobrada" → `recovered` com tratativa, senão `previous_charged`
    (FR-014: "tratativa" = documento de tratativa vigente ou linha enviada ao Comercial não
    cancelada, a mesma regra da lista);
  - o resto ("Cancelada sem cobrança") → `none` (conta em "Reservas", sem valor);
- `reportAmount(bucket, { amountToCharge, chargedAmount })`: em aberto, o valor a cobrar; cobrado, o
  valor cobrado exibido (`chargedAmountWithOrigin`) ou, sem ele, o total da reserva (como o legado);
  `null` = sem valor (conta em `withoutAmount`, Edge Cases);
- `distributionPercentages(values)`: percentuais com uma casa pelo maior resto (somam 100,0) e
  `belowMinimum` para os menores que 0,1% ("<0,1%", FR-016);
- `reportPeriod(shortcut, today)`: "Últimos 7 dias" (hoje − 6 a hoje), "Últimos 30 dias" (hoje − 29 a
  hoje), "Este mês" (dia 1 ao último dia do mês), em datas `AAAA-MM-DD`.

O servidor monta a mesma regra em SQL (R-04) e um teste de paridade confere SQL × domínio com
reservas em todas as situações, com e sem tratativa, comprovante, retorno do Comercial e marcação.

**Por quê**: o mesmo padrão dos filtros rápidos da 006 (regra no domínio, SQL a partir das listas do
domínio, paridade testada); FR-028 depende de o relatório e a lista usarem exatamente a mesma regra.

**Alternativas**: regra só no SQL (sem teste unitário legível); somar no app (constitution III).

## R-04 — SQL: a CTE dos fatos da tratativa, compartilhada

**Decisão**: a CTE de `countQuickFilters` vira uma função do repositório (`treatmentFactsSql(where)`)
usada pelas contagens e pelo relatório, acrescida das colunas que o relatório precisa (valor a
cobrar, valor cobrado exibido). Módulo novo `apps/server/src/persistence/reports-repo.ts`:
`reportOverview(db, period)` faz uma consulta que agrupa por hotel (contagens com `count(*) filter`,
somas com `sum(...) filter`, `max(last_verified_at)`) e junta o nome do catálogo (`hotels`); os
totais são a soma das linhas, no servidor. O filtro do período usa o índice de check-in que já existe.

**Por quê**: uma regra, um lugar; a CTE já foi medida (0,6 s em 20 000). Meta: até 1 s no servidor com
35 000 reservas, para o relatório completo aparecer em até 3 s (SC-003). A medida entra no teste de
volume do grupo `server-db`, como na 006.

**Alternativas**: tabela de resumo atualizada por gatilho ou job (infraestrutura sem necessidade,
constitution VIII; e números atrasados); view materializada (o mesmo problema de atualização).

## R-05 — "Hotéis com dados" e "Última verificação"

**Decisão**:

- `hotels.withData` = hotéis com ao menos uma reserva do relatório no período; `hotels.total` = hotéis
  do catálogo disponíveis (`hotels.available`) mais os indisponíveis que tenham dados no período (o
  "X de Y" nunca fica com X > Y);
- `lastVerifiedAt` = a leitura mais recente no Hunit entre as reservas do relatório no período (a
  linha "Última verificação das reservas" do design, 8.1); sem reservas, `null` e a linha some.

**Por quê**: "todos os hotéis cadastrados" (FR-011) é o catálogo que as contas acessam; a hora da
última leitura diz se os números refletem o Hunit, que é o que a spec quer do selo (US5).

**Alternativas**: total = todo o catálogo, inclusive hotéis que nenhuma conta acessa mais (infla o Y).

## R-06 — Período, atalhos e o estado dos dados no app

**Decisão**:

- período padrão "Últimos 30 dias" (premissa da spec; o "Este mês" ativo no design é só o exemplo);
  lembrado enquanto o app está aberto (estado do `App`, não em disco);
- atalhos aplicados na hora; "Personalizado" e o campo abrem o `PeriodPicker` (o mesmo componente,
  FR-006, sem "limpar": o período é obrigatório); início depois do fim não acontece (o seletor ordena
  o intervalo) e o servidor recusa por garantia (400);
- consulta do TanStack Query com a chave do período, sem dados de outro período no lugar (nada de
  `placeholderData`, FR-009): troca rápida mostra o carregamento, e uma resposta antiga nunca entra
  na tela de outro período;
- sem atualização automática (`staleTime: Infinity`, sem refazer ao focar a janela); "Atualizar dados"
  refaz a consulta;
- selo do topo: "Atualizando…" (lima) durante a consulta, "Dados atualizados" (verde) com a resposta
  do período mostrado, e servidor indisponível = o `StaleDataNotice` da 5.1 ("dados de HH:MM —
  servidor indisponível") com o alerta do app no topo e as ações desabilitadas (8.5); na primeira
  abertura sem servidor, só o alerta (FR-025).

**Por quê**: reaproveita o que a 002 e a 006 já fazem no resto do app; o comportamento pedido (US2, US5)
sai do cache por período.

**Alternativas**: guardar o período em disco (a spec pede só enquanto aberto); atualizar sozinho a
cada N minutos (fora da spec).

## R-07 — Gaveta do hotel e a ida para Reservas

**Decisão**:

- a lista "Reservas em aberto (N)" da gaveta usa `GET /reservations` com o hotel, o período,
  `quickFilter=pending_charge` e `order=amount_desc` (valor novo: valor total do maior para o menor,
  que nas reservas em aberto é o valor a cobrar, sem valor no fim, depois hotel e número; cursor
  próprio). Mostra a primeira página (50) com
  rolagem; o resto fica em "Ver as N reservas em Reservas". A rota é a mesma da lista, liberada aos
  dois perfis (o hóspede aparece aqui, clarificação de 2026-11-25);
- "Ver as N reservas em Reservas" e "Ver reservas em aberto" abrem a área Reservas com filtros
  iniciais: período de check-in, filtro rápido "Falta cobrar" e, no primeiro, o hotel. O `App` passa
  a guardar um `ReservationsPreset` (que generaliza o `initialExecutionId` de hoje); a área mostra os
  filtros aplicados como sempre, e a pessoa pode tirá-los;
- o preset leva a quantidade anunciada; se a contagem de "Falta cobrar" da lista for diferente, a área
  Reservas mostra o aviso "Os números do relatório podem estar desatualizados" (Edge Cases).

**Por quê**: "Falta cobrar" é exatamente o "em aberto" (FR-012); com o mesmo SQL de condição, a lista
dá a mesma quantidade (FR-022, SC-004). Nenhuma rota nova para listar reservas.

**Alternativas**: devolver as reservas em aberto no resumo (dado de hóspede numa rota de relatório,
FR-027; resposta grande); ordenar no app só a primeira página (ordem errada).

## R-08 — Menu e perfis

**Decisão**: área nova `reports` ("Relatórios", ícone de gráfico novo em `ui/icons`), entre
"Comercial" e "Configuração", nos dois perfis (ordem do design: Executar, Execuções, Reservas,
Comercial, Relatórios, Configuração). O "Executar" continua só do operador, como hoje (FR-026); o
módulo não tem ação de operador. A área inicial do app não muda.

## R-09 — Ranking e "Todos os hotéis" no app

**Decisão**: o app ordena e filtra a lista de hotéis que veio no resumo (R-02):

- ranking: hotéis com valor em aberto > 0, do maior para o menor, empate pelo nome; barras na mesma
  escala (o maior valor do período = barra cheia), solicitado (cinza) + pendente (lima); rolagem
  dentro do card (FR-019);
- "Todos os hotéis": todos os hotéis com reservas no período (os de R$ 0,00 no fim), título "Todos os
  hotéis" (clarificação "plano"), busca pelo nome sem acento e sem maiúsculas, ordenações "Maior
  valor", "Mais pendente" e "Nome A-Z" (empate pelo nome), numeração da ordem mostrada;
- a ordenação das listas é uma função pura (`presentation/report.ts`) com teste.

**Por quê**: a lista é pequena e já está no app; buscar e reordenar sem ir ao servidor é instantâneo e
mantém o mesmo momento dos dados.

## R-10 — Componentes de interface

**Decisão**: telas montadas com `ui/` (regra da 006, lint), com três componentes novos e um ícone
([contracts/ui-components.md](./contracts/ui-components.md)):

- `ui/charts/StackedBar` — barra horizontal em segmentos (valores, cores do token, altura e fundo
  claro ou escuro), usada no card de valor em aberto, na distribuição, no ranking e na gaveta;
- `ui/charts/LegendList` — linhas de legenda com marcador de cor, nome, detalhe, valor e percentual;
- `ui/lists/RankingRow` — linha numerada (número em pílula, nome cortado numa linha, barra, valor e
  seta), botão acessível que abre o detalhe;
- `ReportsIcon` em `ui/icons`.

O card escuro "Valor em aberto" usa a superfície escura que a 006 já tem para as execuções em
andamento; os atalhos do período usam o `FilterChip` (sem contagem); a gaveta é o `AppDrawer`
(o maior dos dois tamanhos padrão da 006); o estado vazio é o `EmptyState`. Toda barra tem legenda em texto (FR-017).

**Alternativas**: biblioteca de gráficos (dependência nova para barras simples, constitution VIII).

## R-11 — Testes em camadas (constitution VII)

| Camada | O que | Grupo |
|---|---|---|
| Domínio | `reportBucket` (todas as situações × tratativa), `reportAmount`, `distributionPercentages` (soma 100, "<0,1%"), `reportPeriod` (virada de mês e ano, fevereiro) | `domain` |
| Contrato | `GET /reports/overview` (200, 400 período inválido, 401) e `order=amount_desc` contra o OpenAPI; cópia do contrato idêntica | `server`, `contracts` |
| SQL | paridade relatório × domínio × lista ("Falta cobrar" com o mesmo hotel e período dá a mesma quantidade e soma); volume com 35 000 reservas (até 1 s); cursor do `amount_desc` | `server-db` |
| App, principal | ponte `reports.overview` (validação do período, erro do servidor) | `desktop` |
| App, telas | estados (carregando, vazio, indisponível com e sem dados, atualizado), atalhos, ordenação e busca dos hotéis, gavetas, preset para Reservas e o aviso de divergência, perfil consulta | `desktop-ui` |
| Ponta a ponta | jornada: abrir Relatórios → hotel → "Ver as N reservas" → a lista mostra N; servidor desligado; larguras (960, 1 280, 1 920 e 125 %); roteiro `screens-capture` com 8.1 a 8.7 | `desktop-e2e` |

## R-12 — Diferenças do design (levadas à UX)

| Tela | Design | App | Motivo |
|---|---|---|---|
| 8.1, 8.3, 8.6, 8.7 | "Rede …" no subtítulo do ranking e das gavetas | sem rede | o app não tem cadastro de rede (clarificação 5) |
| 8.7 | título "Hotéis com valor em aberto", só hotéis com valor | "Todos os hotéis", inclusive os de R$ 0,00, no fim | clarificação "plano" (FR-020) |
| 8.1 | "Este mês" ativo | "Últimos 30 dias" ao abrir | premissa da spec (período padrão) |
| 8.1 a 8.7 | campo do período com "→" | o texto do `PeriodPicker` de hoje | mesmo componente dos outros filtros (FR-006) |
| — | botão "Filtros", painel e "Filtros aplicados" não desenhados | os da área Reservas (4.1 e 4.12), no card do período | pedido do usuário depois do merge (R-14); sugestão 8.8 e 8.9 na página 007 |
| — | estado de carregamento não desenhado | esqueleto dos números e selo "Atualizando…" | US5; padrão da 006 |
| — | aviso de divergência na área Reservas não desenhado | `Notice` âmbar no topo da lista | Edge Cases |
| 8.4 | ícone do calendário com X | o ícone de Reservas (calendário) | o app não tem o ícone do design; troca quando a UX exportar o SVG |
| 8.5 | menu com "Executar" e o ranking sem diferença | sem servidor, o app não sabe o perfil e esconde "Executar" (como na 5.1 da 006); as linhas do ranking ficam esmaecidas | comportamento do app desde a 002; abrir o hotel depende do servidor (FR-025) |

## R-13 — Figma ao concluir

**Decisão**: a 007 conclui depois da 008, que tem número maior. A marcação (`figma-screens-sync`)
roda com `FEATURE = '008-ajustes-cobranca-e-aviso'`, sem `SKIP`: assim a página 007 entra na
varredura (telas 8.x, que não existem em outra página) e as telas 1.x e 7.x continuam com a versão da
008. Rodar com `FEATURE = '007-…'` deixaria a 008 de fora e marcaria de novo as versões da 006 como
ativas — não fazer.

## R-14 — Filtros do relatório (ajuste depois do merge, 25/11/2026)

**Pedido**: o usuário pediu, depois do merge do PR #12, o botão de filtro ao lado do período, "como
é na parte de reservas", sem esperar o design; a tela vai para a UX como sugestão na página 007
(FR-005a).

**Decisão**:
- **API 1.10.0 → 1.11.0, só acréscimos**: `GET /reports/overview` aceita os filtros opcionais da
  lista (`hotelCode`, `detailedSituation`, `reservationStatus`, `channel`, `fromLegacy` e
  `notFound`). O servidor usa as mesmas condições da lista (`filterConditions`, agora exportada) na
  CTE dos fatos; a paridade relatório × lista é conferida filtro a filtro
  (`test/contract/reports.test.ts`). Com `hotelCode`, "X de Y" conta só os hotéis escolhidos. Sem os
  parâmetros, a resposta é a da 1.10.0; o app 0.5 continua funcionando.
- **App 0.5.0 → 0.5.1**: botão "Filtros" no card do período, depois dos atalhos (primário com o
  painel aberto, como em Reservas); o painel é o mesmo `FilterPanel` com os mesmos campos
  (`PanelFields`, extraído de `ReservationFilters.tsx`), sem o período (o relatório tem o próprio)
  e com a Origem (o relatório não tem a barra de busca); a Situação não oferece as três do FR-008a.
  Os chips ficam em "Filtros aplicados", com "Limpar filtros". Os filtros ficam no `App`, como o
  período, e vão no `ReservationsPreset` (`filters`, `origin`) e na lista da gaveta do hotel. Com
  filtros e sem reservas, o estado vazio diz "Nenhuma reserva com estes filtros" e oferece "Limpar
  filtros". Componente novo: `FilterAnchor` (âncora do painel fora da `FilterBar`); `AppliedFilters`
  ganhou `clearLabel`.
- **Busca e valor** ficam fora: o relatório é agregado, e a busca livre é da lista.
- **Correção junto**: abrir "Personalizado" e fechar o calendário sem escolher deixava
  "Personalizado" ativo com o período de um atalho; agora volta o atalho.
- **Implantação**: servidor antes do app (o servidor 1.10.0 ignoraria os filtros e mostraria os
  números sem eles). Sem migration e sem passo na planilha.

**Alternativas**: filtros só no app sobre `hotelRows` (só daria para o hotel; os outros filtros
precisam das reservas); uma rota nova (duplicaria a do resumo).

## Comparação com o design (T027, 25/11/2026)

Roteiro `screens-capture` em 1 440 × 900 (prints fora do Git), as sete telas ao lado dos frames da
página `007-relatorios-app-desktop`:

| Tela | Resultado |
|---|---|
| 8.1 | Igual na estrutura, nos textos e nas cores: topo com o selo e "Atualizar dados", o card do período com os atalhos e "N reservas no recorte", os três indicadores, o card escuro do valor em aberto com a barra e as duas partes, o card do valor já cobrado com as duas caixas, a distribuição dos valores com as quatro linhas e o ranking numerado com barras na mesma escala e a legenda. Corrigido depois do primeiro print: o selo virou pílula com o ponto (componente `DataStatus`) e os dois cards de baixo ficaram da mesma altura |
| 8.2 | O calendário dos filtros (dois meses, hoje em lima, resumo e "Ir para hoje"), aberto por "Personalizado" |
| 8.3 | Igual: subtítulo com a posição e o período, card escuro, os três resumos e as reservas em aberto com o selo, maiores primeiro, e "Ver as N reservas em Reservas" |
| 8.4 | Igual no texto e na ação; corrigido o card duplo e o "entre … a …" (agora "entre … e …"); o ícone é o de Reservas (R-12) |
| 8.5 | O alerta do app, a pílula "dados de HH:MM — servidor indisponível", o subtítulo "dados obtidos às …" e as ações desabilitadas; diferenças do R-12 (menu e ranking) |
| 8.6 | Igual à 8.1, com o menu do perfil consulta |
| 8.7 | Igual, com as diferenças decididas: título "Todos os hotéis", hotéis de R$ 0,00 no fim e sem rede |

Diferenças que ficam (todas no R-12): sem nome de rede, "Todos os hotéis", período padrão "Últimos 30
dias", o texto do campo do período, o ícone do estado vazio e o menu sem "Executar" com o servidor fora
do ar. A lista vai para a UX.

## Homologação (T030, 25/11/2026)

Ambiente de homologação com o servidor da 1.10.0 e o app 0.5, nos dois perfis (quickstart §2 e §3).
O usuário aprovou os testes automáticos (§1), a montagem (§2) e todos os cenários, de 3.1 a 3.22. No
3.22, o relatório completo apareceu em menos de 1 s na troca de período (meta do SC-003: até 3 s).
Falta o SC-007 (as 4 usuárias, com a PM, T031).

**Filtros do relatório (R-14, T043), 25/11/2026**: com o servidor da 1.11.0 e o app 0.5.1, o usuário
aprovou os cenários 3.23 a 3.28 (painel, recorte dos números, ida para Reservas, chips e "Limpar
filtros", estado vazio com filtros e o "Personalizado" ao fechar o calendário). Falta a produção.
