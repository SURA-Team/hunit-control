# Research: Redesign visual do app desktop

Decisões técnicas da feature 006 (Fase 0 do `/speckit-plan`). Cada uma tem decisão, justificativa e
alternativas. "Spec" é a [spec.md](./spec.md); "002" a "005" são as specs e os researches dessas
features. "Design" é o design oficial da UX no arquivo "Hunit Control" do Figma: a página
`006-redesign-app-desktop` (telas 1.1 a 7.14) e a página `Componentes — nova identidade` (biblioteca).

Levantamento feito em 2026-11-18 sobre o app no `master` (com a 005), o contrato 1.7.0 e o design.

## R-01 — Escopo: todas as telas do app, construídas por camadas

**Decisão**: a 006 refaz a apresentação de **todas** as áreas do app (Configuração, Executar,
Execuções, Reservas, Comercial), dos diálogos e das gavetas, conforme as 45 telas do design
([contracts/screens.md](./contracts/screens.md)). A implementação vai em camadas, cada uma usável
sozinha:

1. **Fundação**: tokens, tema, fonte, ícones e os componentes únicos (R-02 a R-06).
2. **Estrutura**: cabeçalho, menu lateral flutuante, área de conteúdo responsiva (R-07).
3. **Telas**, na ordem das prioridades da spec: Reservas (lista, filtros, lote, detalhe — US2, US4,
   US5, US7), Execuções e Executar (US6), Comercial e envio (US8), Configuração e estados (US1).
4. **Verificação**: larguras, redimensionamento, contraste e comparação com o design (R-16, R-17).

A lógica das telas (consultas, estados, seleção, envio, tratativas) não muda: o trabalho é trocar os
componentes Mantine usados direto nas telas pelos componentes únicos e reorganizar a informação.

**Justificativa**: o redesenho troca a base visual de tudo; começar pelos componentes evita refazer
telas duas vezes e cumpre a FR-030 desde o primeiro dia. A ordem das telas segue a frequência de uso
(spec, prioridades).

**Alternativas**: *tela por tela, com estilos locais*: mais rápido para a primeira tela, mas espalha
cores e tamanhos e falha na FR-030.

## R-02 — Tokens de design a partir das variáveis do Figma

**Decisão**: um único arquivo de tokens (`ui/tokens.ts`) com os valores das variáveis do design, com
os mesmos nomes (`fundo/app`, `superfície/escura`, `destaque/lima`, `texto/apagado`, `verde/1`,
`verde/9`, `amarelo/1`, `amarelo/8`, `amarelo/9`, `vermelho/1`, `vermelho/9`, `borda/padrão`,
`borda/campo`, sombras "card" e "flutuante", estilos de texto "Título da página", "Corpo",
"Rótulo", "Badge", "Tabela cabeçalho" e os demais). Dele saem:

- o tema do Mantine (`createTheme`): `fontFamily` Manrope, `primaryColor` preto (o botão principal),
  raio de 20 px nos cards e 12 px nos campos e botões, paletas de 10 tons para `lima`, `cinza`,
  `verde`, `amarelo` e `vermelho` (os tons 1, 8 e 9 do design nos lugares certos; os outros
  interpolados e não usados direto);
- variáveis CSS `--hc-*`, usadas pelos módulos CSS dos componentes.

Valores lidos do design em 2026-11-18: fundo do app `#ecedf0`, card `#ffffff`, fundo sutil
`#f4f5f7`, escuro `#0e0e10`, lima `#d4f25a`, lima suave `#f0fad2`, texto `#0e0e10`, ícone
`#2a2c31`, texto apagado `#787b83`, placeholder `#a6a9b0`, inverso apagado `#9a9ca3`, bordas
`#e7e8eb`/`#dcdee2`, verde `#e2f5e7`/`#17703d`, âmbar `#fff0d9`/`#d97a00`/`#9a5500`, vermelho
`#fde5e2`/`#a3282c`.

**Justificativa**: uma fonte da verdade para cores e tipografia no código, com os nomes da UX,
torna a revisão lado a lado (SC-001) e a manutenção diretas. O tema do Mantine cobre os
componentes de terceiros (calendário, menus); as variáveis CSS cobrem os componentes próprios.

**Alternativas**: *ler as variáveis do Figma na compilação*: dependeria de rede e de credencial do
Figma no build. *Só props do Mantine (como hoje)*: não alcança sombras, pílula do menu e estados
de linha sem repetir valores pelas telas.

## R-03 — Fonte Manrope embutida no app

**Decisão**: `@fontsource-variable/manrope` 5.3.0 (licença OFL-1.1) em `devDependencies` do
`@hunit/desktop` (regra do AGENTS.md: o app empacota tudo pelo Vite), importada no `main.tsx`. O
Vite copia o `.woff2` para `out/renderer`; a política de conteúdo já tem `font-src 'self'`. Um teste
confere que o build tem o arquivo da fonte e nenhuma URL de fonte externa (FR-004: funciona sem
internet).

**Justificativa**: a fonte variável cobre os pesos 500 a 700 do design num arquivo só; o pacote
fontsource é a forma padrão de embutir fontes do Google sem CDN.

**Alternativas**: *Google Fonts por URL*: quebra sem internet e exigiria abrir a política de
conteúdo. *Copiar o `.woff2` à mão para `resources/`*: funciona, mas perde a versão e a licença
rastreadas pelo lock.

## R-04 — Ícones do próprio design e ícone do app

**Decisão**: os ícones são os do design (traço de 1,8 px): marca, Fechar, Setas, Olho, Seletor, os
ícones de menu (Executar, Execuções, Reservas, Comercial, Configuração) e os usados dentro das telas
(documento, aceito, ignorado, alerta, etc.). Cada um é exportado do Figma como SVG e vira um
componente React em `ui/icons/`, com `currentColor` no traço, tamanho por prop e `aria-hidden`
(o texto ao lado ou o `aria-label` do botão dá o nome). Nenhuma biblioteca de ícones nova. O ícone
"Relatórios" fica para a 007.

**Ícone do app no Windows e da página** (FR-003, US1-6): hoje é um provisório (H branco em quadrado
azul) gerado por `apps/desktop/scripts/generate-icon.mjs`, num `.ico` com um tamanho só (256 px), que
o Windows reduz e borra em 16 e 24 px. Passa a ser a marca nova:

- a marca "Marca/Ícone — nova identidade" (`24:70`) é exportada do Figma como SVG
  (`resources/brand.svg`, versionado);
- o `generate-icon.mjs` passa a gerar, a partir do SVG, o `resources/icon.ico` com 16, 24, 32, 48,
  64, 128 e 256 px e o `resources/icon.png` (256 px), rasterizando o SVG com o Chromium do Playwright
  que o projeto já tem (nenhuma dependência nova); os arquivos gerados continuam versionados;
- o `electron-builder.yml` já aponta para `resources/icon.ico`: o executável, a janela, a barra de
  tarefas, o atalho do Menu Iniciar e o instalador NSIS passam a usá-lo sem mudar a configuração;
- em desenvolvimento (`electron-vite dev`), a janela não usa o ícone do executável: o
  `createMainWindow` passa `icon` só quando o app não está empacotado;
- "favicon": o `index.html` do renderer ganha `<link rel="icon">` com o SVG da marca (copiado pelo
  Vite, liberado por `img-src 'self'`). No Electron o título da janela não mostra favicon; ele vale
  para as ferramentas de desenvolvimento e mantém a marca coerente;
- um teste confere que o `.ico` tem os 7 tamanhos e que o `icon.png` tem 256 × 256.

O cache de ícones do Windows pode mostrar o ícone antigo no atalho logo depois de atualizar; o
instalador recria o atalho (quickstart, cenário do ícone).

**Justificativa**: fidelidade ao design (SC-001) e nada a baixar em tempo de execução. São poucos
ícones (cerca de 25).

**Alternativas**: *Tabler Icons* (traço parecido, MIT): mais de 5 000 ícones para usar 25, e o
desenho difere do da UX em detalhes visíveis lado a lado.

## R-05 — Componentes únicos (FR-030) e como a regra é garantida

**Decisão**: uma pasta `apps/desktop/src/renderer/src/ui/` com um componente React por componente do
design ([contracts/ui-components.md](./contracts/ui-components.md)): botão (variantes da R-06),
ação de documento, chip de filtro, botão com menu, aba, caixa de seleção, selo, alerta, card, card
de indicador, card de execução em andamento, progresso, linha de lista (reserva, execução, hotel),
barra de lote, estado vazio, campo, calendário, diálogo, gaveta, item de menu, cabeçalho. Eles usam
o Mantine por baixo (acessibilidade, foco, portais, calendário), com estilos em módulos CSS
(`*.module.css`) que leem as variáveis `--hc-*`.

Para garantir que as telas usem só esses componentes, o ESLint ganha `no-restricted-imports` nos
arquivos de `screens/` e `components/`: `Button`, `Badge`, `Modal`, `Drawer`, `Checkbox`,
`Alert`, `Table`, `Tabs`, `NavLink`, `Paper` e `Menu` do `@mantine/core` só podem ser importados
dentro de `ui/`. Layout neutro (`Stack`, `Group`, `Text`, `SimpleGrid`) continua livre.

**Justificativa**: a FR-030 pede que uma mudança valha para todas as telas; com a regra no lint,
uma tela que tente estilizar um botão por conta própria falha no `pnpm lint`.

**Alternativas**: *só tema global do Mantine* (`theme.components`): cobre estilos de base, mas não
os componentes compostos (linha de reserva, barra de lote, card escuro), que precisam de estrutura
própria. *Biblioteca à parte em `packages/`*: só o app desktop a usa (constitution VIII).

## R-06 — Hierarquia de ações como variantes fechadas

**Decisão**: o botão aceita só as variantes do design: `primary` (preto; em superfície escura,
lima), `secondary` (contorno), `text` (cancelar e sair), `warning` (âmbar), `danger-light`
(vermelho suave: "Limpar acesso", "Desfazer", "Remover valor") e `danger` (vermelho cheio: "Sim,
cancelar"), nos tamanhos `xs`, `md` e `lg`. A superfície vem de um contexto (`<Surface dark>`), e o
botão `primary` troca sozinho para lima dentro dela (FR-007). O "Leve" não existe (FR-013). A ação
de documento tem tipos fechados (`download`, `revert`, `undo`, `remove`), cada um com cor e ícone
próprios (FR-010).

Um teste de interface percorre os diálogos e blocos (`data-block`) e confere no máximo um botão
`primary` por bloco (FR-007). Desde a T040, uma varredura do código das telas (analisador do
TypeScript, `test/main/actions-audit.test.ts`) também exige que a variante de cada `Action` e o tipo
de cada `DocumentAction` estejam escritos no código e dentro da lista, e barra o "Leve" em qualquer
botão, inclusive nas telas ainda não migradas.

**Justificativa**: variante fechada não deixa nascer um botão fora da regra; a superfície em contexto
evita que cada tela decida a cor do principal no card escuro e no diálogo do token.

**Alternativas**: *passar `color` em cada uso*: é como o app está hoje e foi o que gerou botões
parecidos com significados diferentes.

## R-07 — Estrutura e responsividade

**Decisão**:

- **Estrutura**: cabeçalho transparente de 56 px, como no design (o conteúdo começa a 72 px do topo: 56 + 16 de
  espaçamento) (marca à esquerda; cliente e perfil num selo
  branco à direita), menu lateral flutuante de 196 px (card branco com o item ativo em pílula
  preta e ícone lima) e a área de conteúdo com largura máxima de 1 600 px, centralizada (FR-046).
- **Medida pelo espaço do conteúdo, não da janela**: a área de conteúdo é um *container*
  (`container-type: inline-size`) e as listas, barras e grades reagem com `@container` (o Chromium
  do Electron 45 suporta). A gaveta abre por cima, sem mudar a largura do conteúdo.
- **Pontos de quebra** (janela de 960 a 1 920 px ou mais; a mínima continua 960 × 640, 002):
  - janela abaixo de 1 180 px: o menu recolhe para só os ícones (64 px), com o nome no
    `aria-label` e numa dica ao passar o mouse; a área ativa continua em pílula (FR-044, US9-4);
  - conteúdo abaixo de 1 000 px: a lista de reservas tira a coluna Hotel e mostra o hotel na segunda
    linha do hóspede; Período e Valor estreitam; os filtros rápidos e a barra de lote quebram linha;
  - conteúdo abaixo de 820 px: as grades de dados dos cards passam de 3 para 2 colunas; as abas da
    área Comercial quebram linha;
  - conteúdo abaixo de 720 px (a janela mínima com zoom de 125 %; acrescentado na T037, quando o
    roteiro de larguras achou 27 px de rolagem horizontal): o período também vai para a segunda
    linha do hóspede, porque Valor e Situação, que nunca cortam, não cabem com ele.
- **Nunca cortar** valores em reais, selos e rótulos de ação (`white-space: nowrap`, sem
  reticências); só nomes de hóspede e de hotel cortam, em até duas linhas, com o texto inteiro no
  `title` e no detalhe (FR-045).
- **Gavetas e diálogos**: gaveta com `min(780px, 100vw − 96px)`; diálogos de 520 e 780 px limitados a
  `100vw − 48px` e a altura visível, com rolagem interna e o fechar fixo no topo (FR-047).
- **Sem perda de estado ao redimensionar**: as quebras são só CSS; nenhuma tela troca de
  componente pela largura (nada de `useMediaQuery` para montar outra árvore), então filtros,
  seleção, texto digitado, aba e gaveta continuam (FR-048).

Os números acima são o ponto de partida; o comportamento entre as larguras é revisado pela UX
(spec, premissa "Responsividade").

**Justificativa**: medir o conteúdo funciona igual com e sem menu recolhido. Trocar só o CSS é o que
garante a FR-048 sem lógica extra.

**Alternativas**: *media queries pela janela*: a lista quebraria em pontos diferentes conforme o
menu. *Montar outra versão da tela em janela estreita*: perderia o estado ao cruzar a quebra.

## R-08 — Lista de reservas: tabela semântica com linhas de duas linhas

**Decisão**: a lista continua uma `<table>` (papéis `row` e `cell` para leitor de tela e para os
testes), com `table-layout: fixed` e as colunas do design: caixa de seleção, Hóspede (nome; número
· canal), Hotel, Período (`17/11 → 19/11/2026`; noites), Valor (total; "cobrado R$ X · Hunit" ou
"· manual" quando houver, nunca "R$ 0,00"), Situação da reserva (selos empilhados: situação,
"Verificar" em âmbar cheio, "Sistema anterior", "Não identificada") e a seta. "Ativa/Cancelada"
sai da lista e fica no detalhe (FR-014). O nome do hotel some quando o conteúdo é estreito e vai
para a segunda linha do hóspede (R-07).

A linha inteira abre o detalhe: clique na linha e Enter com o foco nela; a seta é um botão com
`aria-label` "Abrir a reserva N". A caixa de seleção para a propagação do clique (FR-018). Linha
aberta ou marcada em lima suave.

Abaixo da lista: "Mostrando X de Y reservas · ordenadas por hotel e check-in" (Y vem das contagens,
R-09; a ordem, da R-18) e "Carregar mais" quando houver próxima página (o design mostra só uma
página).

**Justificativa**: manter a tabela preserva a acessibilidade e a maior parte dos seletores dos
testes (`getAllByRole('row')`).

**Alternativas**: *grade de `div`s*: mais livre no CSS, mas exigiria refazer papéis ARIA à mão.

## R-09 — Filtros rápidos: filtro novo e contagens na API (contrato 1.8.0)

**Decisão**: a API ganha, só com acréscimos ([contracts/api-changes.md](./contracts/api-changes.md)):

- o parâmetro `quickFilter` em `GET /reservations` e `GET /reservations/selection`, com o enum novo
  `ReservationQuickFilter` = `pending_charge`, `to_review`, `with_error`, `done` ("Todas" = sem o
  parâmetro);
- a rota `GET /reservations/quick-filter-counts`, com os mesmos filtros da lista (menos
  `quickFilter`, `cursor` e `limit`), que devolve `{ all, pendingCharge, toReview, withError, done }`.

Os grupos (spec FR-016) são regras de negócio, então ficam no domínio: `packages/domain` ganha
`QUICK_FILTERS` e `quickFiltersOf(...)`, que a partir das funções que já existem (`isPendingCharge`,
`needsReview`, `detailedSituation`) diz em quais grupos uma reserva está
([data-model.md](./data-model.md)). O servidor monta a condição SQL de cada grupo com as condições
que já usa (`pendingChargeCondition`, `needsReviewCondition`, `detailedSituationCondition`,
`situationCondition`) e calcula as cinco contagens numa consulta só (`count(*) filter (where …)`).
Um teste `server-db` confere a paridade: para um conjunto de reservas em todas as situações, a
contagem de cada grupo é igual ao tamanho da lista com aquele `quickFilter` e igual ao que
`quickFiltersOf` diz de cada reserva.

_Na implementação (T026, T030)_: o domínio exporta também `QUICK_FILTER_SITUATIONS` (as situações
detalhadas de "A verificar", "Com erro" e "Concluídas"), e o SQL de cada grupo é escrito sobre
cinco fatos da reserva (classificação, tem tratativa, tem comprovante, retorno aguardando e
"Verificar" confirmado depois da mudança), com a situação detalhada numa expressão `case` (a mesma
regra de `detailedSituation`). Na lista, os fatos são as subconsultas de sempre; nas contagens, saem
de junções com os documentos, as linhas, os retornos e as revisões já agrupados por reserva, numa
CTE materializada. Com as subconsultas por reserva repetidas em cada grupo, a contagem de 20 000
reservas levava 2,1 s; com os fatos calculados uma vez por reserva, 0,6 s; com as junções, cerca
de 40 ms. O teste de paridade cobre as duas formas.

No app, as contagens são uma consulta própria do TanStack Query, com os mesmos filtros da lista, e
são invalidadas junto com a lista (mudança de filtro, volta do servidor, tratativa, envio,
confirmação). Contagem grande aparece abreviada ("12,3 mil") com o número inteiro no `title`.

"Selecionar todas do filtro" e "Copiar para e-mail" passam a respeitar o filtro rápido ativo.

**Justificativa**: "A verificar" junta três condições com "ou" (alerta "Verificar", "A revisar
(sistema anterior)" e "Validar comprovante"), e a API combina os filtros com "e"; e a lista é
paginada por cursor, sem total. Contar no app exigiria baixar todas as reservas. A spec permite o
acréscimo compatível (FR-017, FR-031).

**Alternativas**:
- *Cinco chamadas a `/reservations/selection`*: cada uma traz até 2 000 reservas para usar só o
  total, a cada mudança de filtro.
- *Contagens dentro da resposta da lista*: mudaria a resposta de uma rota que o app 0.2 usa e
  recalcularia as contagens a cada "Carregar mais".
- *Regra dos grupos só no SQL*: deixaria a regra de negócio fora do domínio (constitution VII exige
  teste unitário dela).

## R-10 — Busca única: texto ou valor

**Decisão**: a barra tem um campo só ("Buscar por hóspede, nº da reserva, transação, autorização ou
valor"), aplicado sozinho 400 ms depois da última tecla (não há mais "Buscar"). Regra: texto no
formato de dinheiro brasileiro com centavos ou com "R$" (`380,00`, `1.234,56`, `R$ 380`) vai como
`amount`; o resto vai como `q` (mínimo de 2 caracteres, como hoje). Só dígitos (`101-1000`, `1000`)
é número de reserva, então vai como `q`.

**Justificativa**: a API já tem os dois filtros, e o design juntou os dois campos. A regra é
previsível e não muda o servidor.

**Alternativas**: *mandar o texto nos dois filtros*: a API combina com "e" e não acharia nada.
*Parâmetro novo de busca combinada no servidor*: muda o significado de uma busca que o app 0.2 usa.

## R-11 — Barra de filtros, painel "Filtros avançados" e "Filtros aplicados"

**Decisão**: a barra tem a busca, a "Origem" visível (Todas, Sistema anterior, HUNIT Control) e o
botão "Filtros", que abre o painel "Filtros avançados" (tela 4.12: hotéis, período de check-in com o
calendário do design, situação da reserva, ativa ou cancelada, canal e "só as não encontradas na
última verificação"). Os campos do painel valem na hora. Abaixo da barra, a linha "Filtros
aplicados" mostra um chip removível por filtro do painel em vigor (e o da execução, quando a lista
veio do detalhe de uma execução), sem repetir a Origem (FR-034). "Limpar busca e filtros" volta tudo
ao início (FR-021).

Os filtros "Falta cobrar" e "A verificar" saem do painel: viraram filtros rápidos (R-09).

**Justificativa**: segue as telas 4.1, 4.10 e 4.12. Sem um "Buscar", tudo vale na hora, como os
filtros rápidos.

## R-12 — Detalhe da reserva (gaveta)

**Decisão**: a gaveta segue as telas 4.2, 4.7, 4.9, 4.11 e 7.5. Tem o cabeçalho com número, hotel e
selos (situação, ativa/cancelada, "Sistema anterior", "Não identificada"), os dados da reserva
(com "Valor cobrado") e os cards "Status do Hunit" (selo e, quando houver, "Classificação
anterior"), "Tratativa" (documentos com as ações de documento), valor (salvo com "Remover", à parte
do campo "Corrigir o valor" com "Informar valor"), "Cobrança" ("Valor cobrado no Hunit"),
"Comercial", "Verificações", "Sistema anterior" e o histórico (5 itens e "Mostrar mais", que já
existe desde a 003).

Com o alerta "Verificar" (FR-029), o alerta fica no topo com "Confirmar" (principal), e "Anexar
tratativa" e "Anexar comprovante" ficam desabilitados com o motivo ao lado; os documentos já
anexados continuam com "Baixar". Isso é só apresentação: o servidor continua aceitando o anexo (as
regras da 003 não mudam; o app só pede a confirmação antes).

Os dados vêm da reserva e da tratativa que a API já devolve (`previousClassification`,
verificações, histórico, `commercial`, `legacy`).

## R-13 — Execuções e envios em andamento: card escuro; "Histórico" para as encerradas

**Decisão**: a área Execuções lista as execuções com `active = true` em cards escuros no topo, um
por execução (caso de borda: mais de uma conta), com data, período, cliente, "N de M hotéis
concluídos", progresso, percentual e "Ver detalhes" em lima; as demais ficam no "Histórico", como
linhas de lista (tela 3.1). Envios ao Comercial não aparecem aqui: ficam na aba "Envios" da área
Comercial (tela 7.7), conferido no design em 2026-11-18. Dentro do detalhe, os hotéis são linhas
simples com nome, resumo e situação (FR-020).

**Envio em andamento na aba "Envios"** (FR-039; o design não tem essa tela): o mesmo card escuro,
com lima e barra de progresso, no topo da aba: data, cliente, "N de M reservas verificadas",
progresso, percentual e "Ver envio" em lima. É o mesmo componente do card da execução
(`RunningJobCard`, com os textos de cada caso). Antes de implementar, uma **tela de exemplo**
(`7.7a Comercial — Envios com envio em andamento (para aprovação)`) é montada no Figma com os
componentes da `Componentes — nova identidade`, numa seção "Para aprovação da UX" da página
`006-redesign-app-desktop`, sem tocar nas telas existentes; a implementação segue o que a UX aprovar.
Ajustes posteriores ficam para uma feature seguinte. Montada em 2026-11-18 (frame `211:9212`): cópia da
7.7 com uma instância do "Card — execução em andamento" (`53:131`) e o título "Histórico" da 3.1.
**Aprovada pela UX em 2026-11-18, sem ajustes**: o card do envio em andamento (T052) segue essa
tela.

## R-14 — Diálogos e gavetas padronizados

**Decisão**: um componente de diálogo (`AppDialog`) com duas larguras (`sm` = 520 px, `lg` =
780 px), espaçamento interno de 24 px, o estilo de título do design e rodapé de ações à direita
("Cancelar" em texto à esquerda da principal). Variante escura para o token (execução e envio) e
para a confirmação de cancelamento quando o design pede. Todos os diálogos do app passam por ele
(lint da R-05). A gaveta (`AppDrawer`) tem cards com 16 px de espaçamento interno, inclusive o
"Comercial" (FR-042).

## R-15 — Rótulos

**Decisão**: os rótulos continuam em `presentation/labels.ts` (002 a 005). O que o design renomeia
muda lá, e um teste confere os rótulos do design nas telas principais. Os rótulos de situação que
vêm do domínio (`commercial-sheet.ts`, usados na planilha e na cópia para e-mail) não mudam nesta
feature.

Na revisão final (T060), os nomes do design já estavam nos rótulos; entrou só o tom `progress`
(lima) para "Em andamento" (execução, hotel e envio) e "A cobrar" (linha da planilha), as cores fixas
da FR-005.

## R-16 — Testes

**Decisão**: nos grupos que já existem (002, R-12):

- `domain`: `quickFiltersOf` com uma reserva de cada situação, inclusive as que estão em dois grupos.
- `contracts`: `/reservations/quick-filter-counts` e `quickFilter` validados contra o 1.8.0; o teste
  de enums congelados continua (o enum novo não é usado pelo app 0.2).
- `server-db`: paridade contagens × lista × domínio (R-09); desempenho das contagens com 20 000
  reservas (até 1 s, como a importação da 004 mede).
- `desktop` (processo principal): rota nova no `api-client` e no canal da ponte.
- `desktop-ui`: os testes que existem são adaptados aos componentes novos (os papéis e os nomes
  acessíveis continuam a base dos seletores); novos: filtros rápidos e contagens, busca única,
  "Filtros aplicados", estado vazio, uma ação principal por bloco (R-06), anexos desabilitados com
  "Verificar", card escuro de execução e de envio, contraste dos pares de cor usados em texto
  (SC-005, a partir dos tokens; os três pares do design já conhecidos ficam numa lista de exceções
  do teste, para que só um par novo abaixo de 4,5:1 falhe).
- `desktop-e2e`: os roteiros que existem continuam (SC-002: mesmas jornadas, mesmo resultado); um
  roteiro novo de **larguras** abre cada área, a gaveta e os diálogos principais em 960, 1 280 e
  1 920 px e com zoom de 125 %, e confere que não há rolagem horizontal na página
  (`scrollWidth ≤ clientWidth`) e que nenhum elemento marcado como "não cortar" (valores, selos,
  rótulos de ação) está cortado (SC-007); outro **redimensiona** com filtros, seleção, texto, aba e
  gaveta abertos e confere que nada se perde (SC-008).
- Build: fonte embutida e nenhuma URL externa de fonte (R-03); `icon.ico` com os 7 tamanhos e
  `icon.png` de 256 px (R-04).
- `server-db`: a ordem `hotel_check_in` com cursor percorre todas as reservas sem repetir nem pular
  (R-18).

## R-17 — Comparação com o design e marcação no Figma

**Decisão**: o roteiro `screens-capture` (já em 1 440 × 900, a largura de referência do design)
passa a capturar as telas da 006 com os números do design (1.1 a 7.14 e a 4.12). A revisão lado a
lado (SC-001) compara cada print com o frame da página `006-redesign-app-desktop` e as diferenças vão
para este research ("Comparação com o design").

O agente **não escreve telas** no Figma (decisão de 2026-11-18: toda spec passa antes pela PM e chega
com as telas da UX). A skill `figma-screens-sync` foi reescrita para só **marcar**: ao concluir a
006, ela varre as páginas de feature 002 a 006 e deixa, para cada número de tela, a versão da página
mais recente com `✅` e visível, e as anteriores com `❌` e ocultas (FR-032). Ela roda primeiro em
simulação e só aplica com o ok do usuário. A única escrita prevista na página da UX antes disso é a
tela de exemplo para aprovação (R-13), numa seção própria.

**Alternativas**: *reconstruir um espelho da 006 a partir dos prints*: duplicaria 45 telas iguais ao
design e, com a skill antiga, apagaria as telas da UX (o `rebuild()` apagava o frame de mesmo número
na página da branch).

## R-18 — Ordem da lista: hotel e check-in

**Decisão**: `GET /reservations` e `GET /reservations/selection` ganham o parâmetro opcional `order`,
com o enum novo `ReservationOrder` = `hotel_number` (padrão, a ordem de hoje) e `hotel_check_in`
(hotel, data de check-in crescente, número da reserva para desempate). O app novo sempre pede
`hotel_check_in`; o app 0.2 e o Sura, que não mandam o parâmetro, continuam com a ordem de hoje. O
cursor passa a carregar a ordem e os campos dela (`[order, hotel, checkIn, número]`); um cursor de
uma ordem usado com a outra responde 400 `validation_error`, como um cursor inválido de hoje. A
seleção do filtro e a cópia para e-mail usam a mesma ordem da lista (a seleção corta nas 2 000
primeiras "na ordem da lista", 005 FR-030).

O índice `reservations_hotel_check_in_idx` (`hotel_code`, `check_in`) já existe e `check_in` não é
nulo: nenhuma migration.

**Justificativa**: a PM e a UX preferem a leitura por check-in (spec, clarificação do plano). Mudar
a ordem padrão mudaria o que o app 0.2 mostra e invalidaria os cursores dele no meio de uma
consulta; o parâmetro mantém a API só com acréscimos.

**Alternativas**: *trocar a ordem padrão*: mais simples, mas muda o comportamento de uma rota em
uso. *Ordenar no app*: só ordenaria a página carregada, não a lista inteira.

## Pontos levados à UX

Achados do levantamento que divergiam da spec ou entre si, com a decisão de 2026-11-18.

| # | Ponto | Decisão |
|---|---|---|
| UX-1 | **Contraste (SC-005, 4,5:1)**: "texto/apagado" `#787b83` dá 4,23:1 no branco e 3,62:1 no fundo do app; o placeholder `#a6a9b0` dá 2,16:1 no fundo do campo; o selo "Verificar" (texto branco em `#d97a00`) dá 3,12:1. Valores que passariam: `#686b71` (texto apagado, 4,56:1), `#6d6f74` (placeholder, 4,61:1), texto `#0e0e10` no selo (6,18:1) | A 006 usa as cores do design; os três pares viram exceção do SC-005 e vão para a UX numa próxima spec |
| UX-1a | **Contraste — pares achados na Fundação** (T004, 2026-11-18): botão "Perigo" (texto branco em `vermelho/6`, 3,91:1); rótulos âmbar e verde do card de contagem (`amarelo/8` e `verde/8` em `fundo/sutil`, 2,86:1 e 3,20:1); dias de fora do mês no calendário (`texto/placeholder` em branco, 2,35:1); "texto/apagado" sobre `cinza/1` (abas, 3,68:1) e sobre lima suave (linha marcada, 3,89:1) | Como na UX-1: a 006 usa as cores do design; os pares ficam na lista de exceções do teste de contraste (`CONTRAST_EXCEPTIONS`) e no SC-005, para a mesma próxima spec |
| UX-2 | Rodapé "ordenadas por hotel e check-in" × API ordenada por hotel e número | Hotel e check-in (R-18) |
| UX-3 | "Ativa ou cancelada" no painel tem 3 opções (Ativas e canceladas, Só ativas, Só canceladas); o filtro de hoje também tem "Não identificada" | Quarta opção "Só não identificadas" (decisão do usuário, 2026-11-18): nenhum filtro de hoje se perde, e nenhum filtro rápido cobre essas reservas. A opção a mais que o Figma vai para a UX na comparação com o design |
| UX-4 | Não há desenho do envio em andamento na aba "Envios" | Card escuro com lima e progresso; tela de exemplo 7.7a aprovada pela UX em 2026-11-18, sem ajustes (R-13) |
| UX-5 | O design só existe em 1 440 px | Responsivo como na R-07; ajustes numa feature seguinte |
| UX-6 | A skill do espelho escreveria na página da UX | Skill reescrita para só marcar ✅/❌ (R-17) |
