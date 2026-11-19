---

description: "Task list for feature 006 — Redesign visual do app desktop"
---

# Tasks: Redesign visual do app desktop

**Input**: Design documents from `/specs/006-redesign-app-desktop/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/ipc.md](./contracts/ipc.md), [contracts/ui-components.md](./contracts/ui-components.md),
[contracts/screens.md](./contracts/screens.md), [quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS, porque a constitution exige (princípio VII: domínio com testes unitários,
contrato com teste, testes junto com cada tarefa). Escreva os testes de cada bloco antes da
implementação e confirme que falham. Grupos: `domain`, `contracts`, `server-db`, `desktop`,
`desktop-ui` e `desktop-e2e` (research R-16).

**Organization**: fundação visual primeiro (todos os componentes de `ui/`, research R-01); depois uma
fase por história, aplicando os componentes nas telas, na ordem de prioridade da spec: US1, US9 e US2
(P1); US3, US4, US5, US7 e US8 (P2); US6 (P3).

**Base**: a 005 está na `master` (PR #10 e #13); a `006-redesign-app-desktop` foi atualizada com a
`master` em 2026-11-18.

**Como construir cada tela**: abrir o frame do design pelo node de
[contracts/screens.md](./contracts/screens.md) (`get_screenshot` e `get_design_context` do Figma,
`fileKey` `YCbxTAacFxbGuOF8uwoLtt`) e montar a tela **só com os componentes de `ui/`**
([contracts/ui-components.md](./contracts/ui-components.md)), adaptando, nunca copiando o código
gerado. A lógica das telas (consultas, estados, seleção, mutações) não muda (FR-031). Os testes
`desktop-ui` e `desktop-e2e` que já existem são adaptados aos componentes novos mantendo os seletores
por papel e nome acessível; uma jornada que passava antes tem de continuar passando (SC-002).

**Dados**: nenhuma tarefa acessa o Hunit real. Prints, Figma e testes só com os dados fictícios do
roteiro de captura (hóspedes "Ana Ribeiro"…, hotéis "Hotel Praia Azul"…) ou os dos testes. Sem nomes
de hotéis ou da empresa (AGENTS.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1 a US9)
- **⛔ UX / HOMOLOGAÇÃO / PRODUÇÃO / FIGMA**: depende de aprovação da UX, do PC do servidor ou do ok
  do usuário para escrever no Figma

## Path Conventions

Monorepo pnpm (ver plan.md). Renderer: `apps/desktop/src/renderer/src/` (abreviado `renderer/`
abaixo), com `ui/`, `components/`, `screens/`, `presentation/`, `state/`. Testes do app:
`apps/desktop/test/{main,renderer,e2e}`. Servidor: `apps/server/src/{persistence,http}`,
`apps/server/test/{contract,integration}`. Domínio: `packages/domain/{src,test}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependência nova, recursos exportados do design e a trava de lint que impede telas novas
fora do padrão.

- [X] T001 Em `apps/desktop/package.json`, acrescentar `@fontsource-variable/manrope` `5.3.0` (OFL-1.1) em `devDependencies` (o app não tem `dependencies`, AGENTS.md). Rodar `pnpm install` e conferir que o pacote não pede script de instalação (o `allowBuilds` do `pnpm-workspace.yaml` não muda) e que o `minimumReleaseAge` aceita a versão (research R-03)
  _Implementação:_ `@fontsource-variable/manrope` `^5.3.0` (publicada em 19/07/2026, sem script de instalação nem dependências; o lockfile só ganhou o pacote). O `pnpm install` exigiu reinstalar o `node_modules`, que ainda apontava para a pasta antiga do projeto (`C:\Dev\hunit-controll`); depois disso, `pnpm lint`, `pnpm typecheck` e `desktop-ui` (226 testes) verdes.
- [X] T002 [P] Exportar do Figma os SVGs do design (research R-04): a marca "Marca/Ícone — nova identidade" (node `24:70`) em `apps/desktop/resources/brand.svg`; os ícones de "Marca e ícones" (`135:1368`: Fechar, Seta esquerda, Seta direita, Olho, Seletor; menu: Executar, Execuções, Reservas, Comercial, Configuração — **sem** Relatórios, que é da 007) e os ícones usados dentro das telas 1.1 a 7.14 (documento, aceito, ignorado, alerta, upload, cópia, calendário, menu ▾, check, seta da linha). Gravar os SVGs crus em `apps/desktop/resources/icons/` (nome em inglês, `kebab-case`), com traço em `currentColor` e sem `width`/`height` fixos
  _Implementação:_ `resources/brand.svg` e 20 ícones em `resources/icons/` (`close`, `chevron-left`, `chevron-right`, `chevron-down`, `eye`, `selector`, `run`, `executions`, `reservations`, `settings`, `commercial`, `download`, `revert`, `undo`, `remove`, `check`, `minus`, `attention`, `document`, `search-empty`), com o node de origem de cada um no `resources/icons/README.md`. Os alertas do design não têm ícone; o quadrado de 40 px do documento no detalhe é o `document` sobre fundo sutil (CSS). O instalador só empacota `out/**`: os SVGs crus não vão para ele.
- [X] T003 Em `eslint.config.js`, no bloco de `apps/desktop/src/renderer/**`, acrescentar ao `no-restricted-imports` que já existe (os `paths` são somados aos de `forbiddenInRenderer`, porque um segundo bloco com a mesma regra substituiria o primeiro) a proibição de importar `Button`, `ActionIcon`, `Badge`, `Modal`, `Drawer`, `Checkbox`, `Alert`, `Table`, `Tabs`, `NavLink`, `Paper`, `Menu`, `AppShell`, `TextInput`, `PasswordInput`, `Select`, `MultiSelect`, `Radio`, `Switch` e `Progress` de `@mantine/core` (mensagem: "use o componente de ui/ — specs/006, FR-030"), valendo para `screens/**`, `components/**` e `App.tsx` e **não** para `ui/**`. Para não quebrar o lint antes da migração, criar a lista `NOT_YET_MIGRATED` com os arquivos atuais que importam esses nomes (ignorados pela regra) e o comentário "esvaziar até a T059" (research R-05)
  _Implementação:_ bloco novo no `eslint.config.js` para `App.tsx`, `components/**` e `screens/**`, que repete as restrições de toda a interface (`rendererImportRestrictions`) e acrescenta `@mantine/core` (`mantineOnlyInUi`: os nomes acima mais `CloseButton`, `Chip`, `Textarea` e `NumberInput`) e todo o `@mantine/dates`; `Title`, `Text` e o layout continuam livres. `NOT_YET_MIGRATED` com os 34 arquivos atuais. Conferido com arquivos de prova: numa tela, `Button`, `@mantine/dates` e `electron` barrados; em `ui/`, só `electron`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tokens, tema, fonte, ícones e todos os componentes de `ui/`
([contracts/ui-components.md](./contracts/ui-components.md)), com testes. Nenhuma tela muda aqui,
exceto o tema global.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Fundação visual

- [X] T004 Criar `renderer/ui/tokens.ts` com os valores das variáveis do design e os mesmos nomes (research R-02): cores (`fundo/app` `#ecedf0`, `fundo/padrão` `#ffffff`, `fundo/sutil` `#f4f5f7`, `superfície/escura` `#0e0e10`, `destaque/lima` `#d4f25a`, `destaque/lima suave` `#f0fad2`, `texto/padrão` `#0e0e10`, `texto/ícone` `#2a2c31`, `texto/apagado` `#787b83`, `texto/placeholder` `#a6a9b0`, `texto/inverso` `#ffffff`, `texto/inverso apagado` `#9a9ca3`, `borda/padrão` `#e7e8eb`, `borda/campo` `#dcdee2`, `verde/1` `#e2f5e7`, `verde/9` `#17703d`, `amarelo/1` `#fff0d9`, `amarelo/8` `#d97a00`, `amarelo/9` `#9a5500`, `vermelho/1` `#fde5e2`, `vermelho/9` `#a3282c`, `cinza/1` `#eeeff1`), sombras "card" e "flutuante", raios (cards 20 px; campos e botões 12 px) e os estilos de texto "Nova identidade/…" (Título da página Bold 34/1.15/-2.5; Título do app Bold 17; Corpo Medium 14/1.55; Corpo forte Bold 14; Rótulo SemiBold 13; Rótulo grande SemiBold 15; Descrição Medium 12/1.4; Botão SemiBold 14; Badge Bold 10 com espaçamento 6 %; Tabela cabeçalho SemiBold 12 com espaçamento 2 %). Exportar também `TEXT_COLOR_PAIRS` (pares texto/fundo usados nas telas) e `CONTRAST_EXCEPTIONS` = os três pares do design abaixo de 4,5:1 (`texto/apagado` em branco, em `fundo/app` e em `fundo/sutil`; `texto/placeholder` em `fundo/sutil`; texto branco em `amarelo/8`), com o comentário "SC-005: ficam para uma próxima spec (research UX-1)"
  _Implementação:_ ui/tokens.ts com as 32 cores do design (inclusive `fundo/desabilitado`, `superfície/escura 2`, `sobreposição`, `vermelho/6`, `vermelho/8`, `verde/8` e as `azul/*`, que no design guardam lima e preto), as sombras card, flutuante e diálogo, os raios (pílula nos botões, 28 nos diálogos, 24 no menu), os 17 estilos de texto (com "Título do diálogo" e "Cronômetro", lidos do Figma) e `layout`/`breakpoints`. O cabeçalho tem 56 px no design (research R-07 corrigida). `TEXT_COLOR_PAIRS` tem 29 pares e `CONTRAST_EXCEPTIONS` 11: os da UX-1 e os achados na Fundação (research UX-1a: botão Perigo, rótulos âmbar e verde do card de contagem, dias de fora do mês, texto apagado sobre cinza/1 e lima suave), com o SC-005 atualizado.
- [X] T005 [P] Teste `apps/desktop/test/renderer/tokens-contrast.test.ts` (SC-005): calcula a relação de contraste WCAG de cada par de `TEXT_COLOR_PAIRS` e falha se algum par fora de `CONTRAST_EXCEPTIONS` ficar abaixo de 4,5:1; confere também que as exceções continuam abaixo (para a lista não ficar velha quando a UX ajustar as cores)
  _Implementação:_ fórmula da WCAG 2.x; confere também as cinco relações do levantamento (UX-1). 31 testes.
- [X] T006 Criar `renderer/ui/theme.ts` (`createTheme` do Mantine a partir dos tokens: `fontFamily` "Manrope Variable", `primaryColor` preto, `defaultRadius` 12, paletas de 10 tons `lima`, `cinza`, `verde`, `amarelo`, `vermelho` com os tons 1, 8 e 9 do design nas posições certas) e `renderer/ui/global.css` (variáveis `--hc-*` de todos os tokens, `body` com `fundo/app` e a fonte). Em `renderer/main.tsx`, importar `@fontsource-variable/manrope`, `./ui/global.css` e trocar o tema atual (azul, Segoe UI) pelo de `ui/theme.ts`. Em `apps/desktop/test/renderer/render.tsx`, usar o mesmo tema no `MantineProvider`
  _Implementação:_ as variáveis `--hc-*` saem de `tokens.ts` pelo `cssVariablesResolver` do tema (uma fonte só, sem cópia no CSS); o `global.css` só tem o `body`. O tema também põe nos tons do design as paletas `gray`, `green`, `yellow` e `red` do Mantine, o texto apagado, o placeholder e o desabilitado (`fundo/desabilitado` e `texto/placeholder`), para as telas ainda não migradas já saírem com as cores novas.
- [X] T007 [P] Teste de build `apps/desktop/test/main/renderer-assets.test.ts` (FR-004, research R-03): depois do `pnpm --filter @hunit/desktop build`, `out/renderer` tem um `.woff2` da Manrope e nenhum arquivo do build referencia `fonts.googleapis.com`, `fonts.gstatic.com` ou outra URL `http(s)` de fonte; a política de conteúdo do `index.html` continua igual (`font-src 'self'`, `connect-src 'none'`)
  _Implementação:_ compila só a interface com o Vite e os plugins do `electron.vite.config.ts`, numa pasta temporária (não mexe no `out/` dos testes de ponta a ponta); leva cerca de 3 s.
- [X] T008 [P] Criar os ícones em `renderer/ui/icons/` (um componente React por SVG de `apps/desktop/resources/icons/`, T002): `size` (padrão 20), traço em `currentColor`, `aria-hidden="true"`, e um `index.ts` com os nomes em inglês (`CloseIcon`, `ChevronRightIcon`, `RunIcon`, `ExecutionsIcon`, `ReservationsIcon`, `CommercialIcon`, `SettingsIcon`, `DocumentIcon`…) e o `BrandMark` (marca do cabeçalho). Teste `apps/desktop/test/renderer/ui-icons.test.tsx`: todos renderizam um `svg` oculto do leitor de tela e herdam a cor
  _Implementação:_ `ui/icons/icons.tsx` gerado dos 20 SVGs (um componente por SVG; tamanho padrão = o do desenho: 14, 16, 20 ou 48 px), `BrandMark.tsx` e `index.ts`. O teste confere, para cada SVG, o mesmo `viewBox` e os mesmos traços, nos dois sentidos (SVG sem componente ou componente sem SVG falham).
- [X] T009 [P] Criar `renderer/ui/Surface.tsx` (contexto `light` | `dark`, `useSurface()`) e `renderer/ui/Action.tsx` (research R-06): `variant` só `primary` | `secondary` | `text` | `warning` | `danger-light` | `danger`; `size` `xs` | `md` | `lg`; `primary` vira lima dentro de `Surface dark`; `data-variant` no elemento; estilos em `Action.module.css` a partir das variáveis `--hc-*`; sem prop `color`. Junto, `renderer/ui/DocumentAction.tsx` (`kind` `download` | `revert` | `undo` | `remove`, cada um com cor e ícone fixos, FR-010), `renderer/ui/MenuButton.tsx` (botão com ▾ e itens) e `renderer/ui/FilterChip.tsx` (rótulo, contagem abreviada "12,3 mil" com o número inteiro no `title`, `aria-pressed`). Teste `apps/desktop/test/renderer/ui-actions.test.tsx`: variantes, troca para lima em superfície escura, os quatro tipos de ação de documento com ícones diferentes, menu acessível pelo teclado e a contagem abreviada
  _Implementação:_ `Action` sobre o `Button` do Mantine (variante em `data-variant`, cores nas variáveis `--button-*`), pílula, tamanhos `xs` 30, `sm` 36 (rodapé de diálogos e gavetas, como nas telas; o conjunto "Botão" não tem), `md` 40 e `lg` 48. O design não tem botão âmbar (a "atenção" é a ação de documento Reverter): `warning` ficou com os tons do selo âmbar. `MenuButton` com o suspenso da tela 4.12 (o design não desenha o menu dele). Contagem do chip com `formatCount`/`formatInteger` em `presentation/format.ts` ("12,3 mil").
- [X] T010 [P] Criar os campos em `renderer/ui/fields/`: `Field` (texto, 40 px, fundo sutil, foco com contorno preto, rótulo acima, erro), `PasswordField` (ícone Olho), `SelectField`, `MultiSelectField` (ícone Seletor), `SelectionBox` (desmarcada, marcada preta com check lima, parcial), `CheckboxField`, `RadioField`, `SwitchField`, e mover o `PeriodPicker` de `renderer/screens/run/PeriodPicker.tsx` para `renderer/ui/PeriodPicker.tsx` com o calendário do design (hoje com contorno; escolhido preto; intervalo em lima suave; hoje escolhido em círculo lima), atualizando quem o importa. Teste `apps/desktop/test/renderer/ui-fields.test.tsx`: rótulo e erro acessíveis, estados da caixa de seleção (`aria-checked="mixed"` na parcial) e escolha de período
  _Implementação:_ campos sobre o Mantine com as classes de `fields.module.css` (o design não desenha erro nem desabilitado: erro em `vermelho/9`, desabilitado como o botão "Desabilitado"); `RadioField` é o grupo, com as opções. O `PeriodPicker` foi refeito com `Popover` + `DatePicker` para ter o rodapé do design (resumo "13/11 → 19/11/2026 · 6 noites" e "Ir para hoje") e o botão "Limpar o período"; o campo continua com o rótulo e o texto "DD/MM/AAAA a DD/MM/AAAA", e os dias, com o nome por extenso. `run-screen`, `reservations-screen` e o roteiro `us1-run-and-token` passam sem mudança.
- [X] T011 [P] Criar os status em `renderer/ui/`: `StatusBadge` (`tone` `lime` | `amber` | `green` | `red` | `gray` | `alert`, sempre com texto, `data-no-truncate`), `SituationBadges` (pilha: situação, "Verificar" em `alert`, "Sistema anterior", "Não identificada"; empilhados, nunca cortados), `Notice` (tom `lime` | `green` | `red` | `amber`, ícone e ação opcional), `ProgressBar`, `CountCard`, `IndicatorCard` (número grande, FR-004/US1-3) e `EmptyState` (ícone, título, explicação e ação opcional "Limpar busca e filtros"). Teste `apps/desktop/test/renderer/ui-status.test.tsx`
  _Implementação:_ `StatusBadge` e `SituationBadges` em `StatusBadge.tsx` (a pilha recebe os selos prontos, na ordem), `Notice` (anunciado como `alert` por padrão, como o Alert do Mantine), `ProgressBar` (lima no escuro, preto no claro: o design só tem o escuro), `CountCard` e `IndicatorCard` em `CountCards.tsx` e `EmptyState`; estilos em `status.module.css`.
- [X] T012 [P] Criar a estrutura em `renderer/ui/`: `Card` (`padding` 16 ou 24, cantos 20, sombra card, sem borda, `data-block`), `PageHeader` (título 34 px, subtítulo, ação à direita), `AppDialog` (`size` `sm` = 520 px e `lg` = 780 px, limitados a `100vw − 48px` e à altura visível; espaçamento 24 px; título no estilo do design; `dark` usa `Surface dark`; rola por dentro com o fechar fixo; rodapé com "Cancelar" `text` à esquerda da principal) e `AppDrawer` (direita, `min(780px, 100vw − 96px)`, cards de 16 px, fechar com `aria-label`) (FR-042, FR-047). Teste `apps/desktop/test/renderer/ui-structure.test.tsx`: as duas larguras, o `data-block` e o fechar acessível
  _Implementação:_ `Card` (`padding` 0, 12, 16 ou 24; `tone="subtle"` = caixa cinza sem sombra), `PageHeader` e `SectionTitle`, `AppDialog` (Modal do Mantine em partes: 520/780 px com 24 px de margem da janela, cantos de 28, sombra "diálogo", sobreposição a 60 % com desfoque, cabeçalho fixo, `onCancel` = "Cancelar" em texto à esquerda das ações, `dark`) e `AppDrawer` (até 780 px com 96 px livres, cantos só à esquerda); estilos em `structure.module.css`.
- [X] T013 [P] Criar a navegação em `renderer/ui/`: `AppHeader` (transparente, 72 px, `BrandMark` + "HUNIT Control", selo branco com o cliente e o perfil: operador, consulta, sem conexão), `SideMenu`/`SideMenuItem` (card flutuante 196 px; ativo em pílula preta com ícone lima, `aria-current="page"`; abaixo de 1 180 px de janela só ícones de 64 px com `aria-label` e dica) e `Tabs` (abas com contagem, quebram linha). Teste `apps/desktop/test/renderer/ui-navigation.test.tsx`
  _Implementação:_ `AppHeader` com 56 px (a altura do design; a spec falava em 72, que é onde o conteúdo começa), `SideMenu`/`SideMenuItem` (abaixo de 1 180 px só por CSS: o nome continua para o leitor de tela e vira dica ao passar o mouse) e `Tabs` + `TabPanel` sobre o Tabs do Mantine (as setas trocam de aba).
- [X] T014 [P] Criar as listas em `renderer/ui/lists/`: `ListCard` + `ListHeader` (cabeçalho "Tabela cabeçalho"), `ReservationRow` (research R-08: `<tr>` com caixa de seleção, Hóspede — nome; número · canal —, Hotel, Período `17/11 → 19/11/2026` e noites, Valor — total; "cobrado R$ X · Hunit/· manual" só quando houver, nunca "R$ 0,00" —, `SituationBadges` e seta como botão "Abrir a reserva N"; linha inteira clicável e com Enter; caixa de seleção sem abrir; aberta ou marcada em lima suave; nomes cortados em 2 linhas com `title`; valores com `data-no-truncate`; o hotel vai para a segunda linha do hóspede quando o contêiner tem menos de 1 000 px, por `@container`), `CompactReservationRow`, `ExecutionRow`, `HotelRow` (nome, resumo, situação; também para documentos), `SelectionBar` (barra escura com estado parcial, "N reservas selecionadas · total de R$ X", "Ver seleção", `MenuButton` "Anexar ▾" e "Confirmar ▾", "Enviar ao Comercial" `primary` em superfície escura = lima, "Desmarcar todas" `text`; quebra linha) e `RunningJobCard` (card escuro: título, linhas de apoio, "N de M …", `ProgressBar`, percentual e ação principal lima). Teste `apps/desktop/test/renderer/ui-lists.test.tsx`: clique na linha × na caixa, teclado, segunda linha do valor só com valor cobrado, nome longo com `title`
  _Implementação:_ `ListCard`/`ListHeader` com as colunas do design (`RESERVATION_COLUMNS`, `EXECUTION_COLUMNS`; larguras no CSS por `data-col`; abaixo de 1 000 px de conteúdo, por `@container`, o hotel sai da coluna e vai para a linha do hóspede), `ReservationRow` e `ExecutionRow` (linhas da tabela), `HotelRow` e `CompactReservationRow` dentro de `RowList`, `SelectionBar` (as ações chegam prontas da tela) e `RunningJobCard`. As linhas recebem os textos já formatados.
- [X] T015 Criar o auxiliar de teste `apps/desktop/test/renderer/hierarchy.ts` (`expectOnePrimaryPerBlock(container)`: no máximo um `[data-variant="primary"]` por `[data-block]` e por diálogo, research R-06) e usá-lo no `ui-structure.test.tsx`. Em `apps/desktop/test/e2e/app-fixture.ts`, `launchApp` ganha `window?: { width; height }` e `zoomFactor?`, e o arquivo novo `apps/desktop/test/e2e/layout-checks.ts` exporta `expectNoHorizontalScroll(page)` (`scrollWidth ≤ clientWidth` no documento) e `expectNothingTruncated(page)` (todo `[data-no-truncate]` com `scrollWidth ≤ clientWidth`) (research R-16)
  _Implementação:_ `hierarchy.ts` agrupa cada `primary` pelo bloco mais próximo (`data-block` ou diálogo) e é usado no `ui-structure.test.tsx`; `launchApp({ window, zoomFactor })` e `resizeWindow(app, window, size, zoom)` no `app-fixture.ts`; `layout-checks.ts` também aponta `data-no-truncate` em elemento `inline` (sem largura medível).

**Checkpoint**: `pnpm lint`, `pnpm typecheck` e `pnpm test --project desktop-ui` verdes; o app abre com a
fonte e as cores novas (as telas ainda com a estrutura antiga).

---

## Phase 3: User Story 1 - Reconhecer o app e navegar com a nova identidade (Priority: P1) 🎯 MVP

**Goal**: estrutura nova (cabeçalho, menu flutuante, fundo, cards), a marca como ícone do app e as
áreas Configuração e Executar no visual novo.

**Independent Test**: abrir o app, percorrer todas as áreas pelo menu e comparar fundo, cards, menu,
cabeçalho, tipografia e paleta com as telas 1.1 a 2.10 e 5.1; conferir o ícone do app instalado
(quickstart, cenários 1, 2 e 17).

- [X] T016 [US1] Em `renderer/App.tsx`, trocar o `AppShell`/`NavLink` pelo `AppHeader` e pelo `SideMenu` de `ui/` (ícone por área, item ativo em pílula; perfil consulta sem "Executar"; sem conexão só "Configuração"), com a área de conteúdo como contêiner (`container-type: inline-size`, largura máxima 1 600 px, centralizada, FR-046) em `renderer/App.module.css`. Ajustar `apps/desktop/test/renderer/*` que dependem do menu (papéis `navigation` e `link`/`button` com o nome da área) e acrescentar em `apps/desktop/test/renderer/app-shell.test.tsx`: item ativo com `aria-current`, os dois perfis e "sem conexão" (FR-002, FR-003, US1-1, US1-2)
  _Implementação:_ `App.tsx` com `AppHeader`, `SideMenu` (ícone por área) e o conteúdo em `App.module.css`: cabeçalho preso no topo ao rolar (fundo da página, como o transparente do design), menu fixo à esquerda (12 px das bordas, 4 px abaixo do cabeçalho), conteúdo com 16 px de margem, largura máxima de 1 600 px e `container: content`. Nenhum teste da interface renderizava o `App`: o `app-shell.test.tsx` é novo (4 testes). Os roteiros `us1-run-and-token`, `us3-reservations` e `untrusted-server` passam sem mudança (o menu continua `navigation` e cada área encontrada pelo nome).
- [X] T017 [P] [US1] Avisos de conexão no visual novo: `renderer/components/ConnectionBanner.tsx` com `Notice` e `renderer/components/StaleDataNotice.tsx` ("dados de HH:MM — servidor indisponível") legível no `PageHeader` (tela 5.1, caso de borda). Atualizar `apps/desktop/test/renderer/connection-banner.test.tsx`
  _Implementação:_ `ConnectionBanner` com `Notice` (indisponível âmbar, servidor não confirmado e chave recusada vermelhos, com "Abrir configuração" secundária; conectando e primeiro uso lima) e `StaleDataNotice` como aviso âmbar compacto (`Notice compact`), para ficar ao lado do título da página. Feito sem a tela 5.1, porque o conector do Figma caiu: a comparação com o design fica para a revisão das telas (T061 a T065).
- [X] T018 [P] [US1] Ícone do app (FR-003, US1-6, research R-04): reescrever `apps/desktop/scripts/generate-icon.mjs` para rasterizar `resources/brand.svg` com o Chromium do `playwright` (já em `devDependencies`) em 16, 24, 32, 48, 64, 128 e 256 px e gravar `resources/icon.ico` (os 7 tamanhos, PNG dentro do ICO) e `resources/icon.png` (256 px); rodar o script e versionar os arquivos gerados. Teste `apps/desktop/test/main/icon.test.ts`: o `.ico` tem exatamente os 7 tamanhos e o `.png` tem 256 × 256. Em `apps/desktop/src/main/window.ts`, passar `icon` (o `icon.png`) só quando `!app.isPackaged` (em desenvolvimento a janela não usa o ícone do executável). Em `apps/desktop/src/renderer/index.html`, `<link rel="icon" type="image/svg+xml" href="…brand.svg">` servido pelo Vite (política `img-src 'self'` sem mudança). O `electron-builder.yml` continua apontando para `resources/icon.ico` (conferir no `apps/desktop/test/main/builder-config.test.ts`)
  _Implementação:_ `generate-icon.mjs` rasteriza `resources/brand.svg` com o Chromium do Playwright nos 7 tamanhos; `icon.ico` (os 7, PNG dentro do ICO) e `icon.png` (256 px) regenerados e versionados. `window.ts` passa o `icon.png` só fora do pacote; `index.html` com `<link rel="icon">` da marca (o Vite a embute; política de conteúdo igual, conferida no `renderer-assets.test.ts`). `icon.test.ts` novo e `builder-config.test.ts` confere o `win.icon`.
- [X] T019 [P] [US1] Configuração (telas 1.1 a 1.3, nodes `24:757`, `24:786`, `24:821`): `renderer/screens/setup/SetupScreen.tsx` e `PreferencesForm.tsx` com `PageHeader`, `Card`, campos de `ui/fields`, `Notice` e `Action` ("Limpar acesso" = `danger-light`, FR-009). Tirar os dois arquivos da `NOT_YET_MIGRATED` (T003). Atualizar `apps/desktop/test/renderer/setup-screen.test.tsx` e acrescentar `expectOnePrimaryPerBlock`
  _Implementação:_ telas 1.1 a 1.3 com `PageHeader`, cards de 760 px (`Card` + `SectionTitle`), campos de 36 px como no design, a caixa cinza do certificado com a impressão digital em `CodeText`, "Testar conexão" em contorno e "Salvar conexão" como a principal; o prazo de inatividade aparece como o campo com seletor do design (`NumberField` sem os controles, as setas do teclado mudam o número: a validação de 1 a 24 continua); "Remover a configuração desta máquina" `danger-light` e a confirmação em `AppDialog` com "Sim, remover" `danger`. Teste novo de hierarquia e das variantes no `setup-screen.test.tsx`. Os campos passaram a ter 36 px por padrão (`size`), porque é a altura de todas as telas do design; a barra de busca usa 40.
- [X] T020 [US1] Executar (telas 2.1 a 2.5 e 2.8 a 2.10, nodes em [contracts/screens.md](./contracts/screens.md)): `renderer/screens/run/RunScreen.tsx`, `CredentialsForm.tsx`, `HotelSelect.tsx` e `renderer/components/HunitAccess.tsx` com os componentes de `ui/` (período pelo `ui/PeriodPicker`); `renderer/components/TwoFactorDialog.tsx` com `AppDialog` `dark` (token, cronômetro, aceito em verde, recusado em vermelho; "Enviar" = `primary` lima). Tirar os arquivos da `NOT_YET_MIGRATED`. Atualizar `apps/desktop/test/renderer/run-screen.test.tsx` e `two-factor-dialog.test.tsx`; os roteiros `apps/desktop/test/e2e/us1-run-and-token.test.ts` continuam passando
  _Implementação:_ telas 2.1 a 2.5, 2.8 e 2.9 com cards de 980 px: "Acesso ao Hunit" (duas colunas; "Guardar acesso" em contorno xs; acesso guardado com "Limpar acesso" `danger-light` xs), "Consulta" (período, rádios, seletor com busca e "Iniciar execução" `primary` `lg` — o design desenha 42 px, a biblioteca 48); o diálogo do token em `AppDialog` escuro (`Countdown`, campo de 50 px, "Enviar token" lima; sem fechar) e claro no desfecho (alerta e "Fechar"). O X dos diálogos passou a se chamar "Fechar o diálogo", para não se confundir com um "Fechar" no rodapé; os roteiros e2e passaram a procurar o "Fechar" pelo nome exato. O card do resultado (2.6, 2.7, 2.8 e 2.10) é do `ExecutionResult`, que migra na T057. Corrigido junto: no Mantine 9, `className` em `Modal.Content`/`Drawer.Content` também ia para o contêiner de tela cheia, que cobria a sobreposição de branco; as classes passaram para o `classNames` do Root.

**Checkpoint**: navegação, Configuração e Executar no visual novo; ícone novo no instalador.

---

## Phase 4: User Story 9 - Janelas de tamanhos diferentes e diálogos padronizados (Priority: P1)

**Goal**: o roteiro que prova a responsividade e a padronização, valendo para o que já foi migrado e
crescendo a cada história.

**Independent Test**: `pnpm test --project desktop-e2e responsive resize` verde para as áreas já
migradas (quickstart, cenário 12).

- [X] T021 [US9] Roteiro `apps/desktop/test/e2e/responsive.test.ts` (SC-007, FR-043 a FR-045): com o app contra a API da 001 com o Hunit simulado (como os outros roteiros), abrir cada área já migrada em 960 × 640, 1 280 × 820 e 1 920 × 1 080 e em 960 × 640 com zoom 125 %, e aplicar `expectNoHorizontalScroll` e `expectNothingTruncated`; em 960 px, conferir o menu só com ícones e a área ativa ainda identificável. Começa com Configuração e Executar; cada história seguinte acrescenta as telas dela (tarefas "registrar no roteiro de larguras")
  _Implementação:_ sete estados, cada um nos quatro tamanhos: Configuração no primeiro uso e salva (1.1 e 1.3), o diálogo "Remover a configuração?", Executar preenchido com três hotéis escolhidos (2.1 e 2.3), com o calendário aberto (2.2) e com o acesso guardado, e o diálogo do token no pedido e no desfecho (2.4 e 2.5). Além de `expectNoHorizontalScroll` e `expectNothingTruncated`, `layout-checks.ts` ganhou `expectReachable` (cada informação e ação do design visível depois de rolar e inteira na largura), `expectDialogFits` (diálogo dentro da área visível e centralizado, medido depois da animação de entrada), `expectDialogSpacing` (os 24 px calculados pelo navegador, SC-009) e `expectSideMenu` (abaixo de 1 180 px só os ícones, com a dica do nome; a ativa em pílula, com o nome acessível). Cada tamanho confere também a largura da página em px de CSS: o zoom do Electron chega à página depois, e o `resizeWindow` passou a esperar a largura bater (sem isso, o caso de 125 % às vezes era medido a 100 %). Numa tela menor que a janela pedida, o `resizeWindow` compensa com zoom. Nada precisou mudar nas telas.
- [X] T022 [P] [US9] Roteiro `apps/desktop/test/e2e/resize.test.ts` (SC-008, FR-048): com a janela em 1 440 px, preencher o formulário de Executar (período e hotéis), redimensionar para 960 px e de volta para 1 920 px e conferir que nada se perdeu; cada história seguinte acrescenta o próprio estado (filtros, seleção, gaveta aberta, aba ativa, texto de diálogo)
  _Implementação:_ dois estados, de 1 440 para 960 e 1 920 px: Executar com usuário e senha digitados, período, "Escolher hotéis" com dois hotéis e uma busca digitada no seletor; e o diálogo "Remover a configuração?" aberto. Uma marca posta na página antes de redimensionar prova que ela não recarregou.
- [X] T023 [P] [US9] Teste `apps/desktop/test/renderer/dialogs-standard.test.tsx` (SC-009, FR-042): renderiza cada diálogo do app (token, cancelar execução e, à medida que forem migrados, anexar, recusar retorno, confirmações em lote, cópia para e-mail, envio) e confere que usam `AppDialog` com largura `sm` ou `lg`, o espaçamento de 24 px e um título; começa com os diálogos já migrados e cresce com as histórias
  _Implementação:_ registro `DIALOGS` com o token (pedido e desfecho) e "Remover a configuração?", os diálogos já migrados; "cancelar execução" entra com a T058. Confere a classe do `AppDialog` no conteúdo e no título, `data-size` `sm` ou `lg` com a largura do Mantine correspondente e o espaçamento de 24 px, e que nenhum outro diálogo fora do padrão abre junto. O espaçamento calculado (o jsdom não calcula CSS) é conferido no roteiro de larguras.
- [X] T024 [US9] Em `apps/desktop/test/e2e/screens-capture.test.ts`, aceitar `HUNIT_SCREENS_WIDTH` (960 ou 1280; padrão 1440 × 900) para capturar as mesmas telas nas larguras menores (quickstart §2, research UX-5)
  _Implementação:_ `HUNIT_SCREENS_WIDTH` = `960` (960 × 640), `1280` (1 280 × 820) ou `1440` (padrão); outro valor para a captura antes de subir o servidor. Os nomes dos arquivos não mudam (uma pasta por largura; anotado no `AGENTS.md`). Captura em 960 conferida: todas as telas, sem falhas.

**Checkpoint**: larguras e redimensionamento provados para as áreas migradas.

---

## Phase 5: User Story 2 - Achar e abrir reservas numa lista mais enxuta (Priority: P1)

**Goal**: lista de 5 colunas ordenada por hotel e check-in, busca única, Origem na barra, painel
"Filtros avançados", "Filtros aplicados", filtros rápidos com contagem e estado vazio.

**Independent Test**: com reservas em várias situações, usar a busca, cada filtro rápido e o painel, e
abrir uma reserva pela linha (quickstart, cenários 3 a 7 e 15; telas 4.1, 4.3, 4.12 e 6.2).

### Domínio e API (contrato 1.8.0)

- [X] T025 [P] [US2] Testes `packages/domain/test/quick-filters.test.ts` com os exemplos de [data-model.md](./data-model.md) §1: pendente sem tratativa → `pending_charge`; "Validar comprovante" → `pending_charge` e `to_review`; tratativa e Hunit "Já cobrada" com o alerta → `to_review` e `done`; "A revisar (sistema anterior)" → `to_review`; erro na cobrança ou de análise sem comprovante → `with_error` e `pending_charge`; cobrar na maquininha sem comprovante → `pending_charge`; faturada sem tratativa → `done`; comprovante enviado → `done`
  _Implementação:_ os exemplos partem das funções do domínio (`isPendingCharge`, `needsReview`, `detailedSituation`), mais os casos de cada classificação sem tratativa, "Já cobrada" com o alerta já confirmado e "A revisar (sistema anterior)" com comprovante; um teste percorre todas as combinações e confere que toda reserva cai em algum grupo. Nenhum exemplo do data-model divergiu das regras.
- [X] T026 [US2] Implementar `packages/domain/src/quick-filters.ts` (`QUICK_FILTERS = ['pending_charge', 'to_review', 'with_error', 'done'] as const`, `QuickFilter`, `quickFiltersOf({ pendingCharge, needsReview, detailedSituation })` com as regras do data-model §1) e exportar no `packages/domain/src/index.ts`
  _Implementação:_ o grupo de cada situação detalhada num `Record` completo (uma situação nova não compila sem decidir o grupo) e `QUICK_FILTER_SITUATIONS`, as listas por grupo que o servidor usa no SQL (research R-09).
- [X] T027 [US2] Contrato 1.8.0 ([contracts/api-changes.md](./contracts/api-changes.md)): em `packages/contracts/openapi.yaml`, versão 1.8.0 e a descrição dos acréscimos; enums `ReservationQuickFilter` (`pending_charge`, `to_review`, `with_error`, `done`) e `ReservationOrder` (`hotel_number`, `hotel_check_in`); parâmetros opcionais `quickFilter` e `order` em `GET /reservations` e `GET /reservations/selection`; rota `GET /reservations/quick-filter-counts` (mesmos filtros da lista, sem `quickFilter`, `cursor`, `limit` e `order`; resposta `ReservationQuickFilterCounts` = `{ all, pendingCharge, toReview, withError, done }`, inteiros ≥ 0 obrigatórios; 400 `validation_error`; 401). Rodar `pnpm --filter @hunit/contracts generate` e copiar o arquivo para `specs/006-redesign-app-desktop/contracts/openapi.yaml` (idêntico; a cópia da 005 fica na 1.7.0). Conferir que `apps/server/test/unit/contract-frozen-enums.test.ts` continua verde
  _Implementação:_ `quickFilter` e `order` como parâmetros reutilizados (`components/parameters`); a rota nova tem os filtros da seleção. Os erros são `validation_error`, o código que o contrato já tem para cursor e filtro inválidos: o plano citava `invalid_cursor` e `invalid_parameters`, que não existem no `Problem.code` (corrigido em api-changes.md e research R-18). O teste de enums congelados passou a conferir a versão 1.8.0; os enums congelados não mudaram.
- [X] T028 [P] [US2] Testes de contrato `apps/server/test/contract/reservations-quick-filters.test.ts`: `quickFilter` e `order` aceitos nas duas rotas e 400 com valor fora do enum; `/reservations/quick-filter-counts` validado contra o esquema, com e sem filtros, para operador e consulta; 401 sem chave
- [X] T029 [P] [US2] Testes `server-db` `apps/server/test/integration/reservations-quick-filters.test.ts` (research R-09, R-18): semear reservas em todas as situações (inclusive com tratativa, comprovante, retorno aguardando, alerta "Verificar" e "A revisar (sistema anterior)"); para cada grupo, a contagem é igual ao tamanho da lista com aquele `quickFilter` e ao que `quickFiltersOf` diz de cada reserva; `order=hotel_check_in` percorre todas as páginas por cursor sem repetir nem pular, na ordem hotel → check-in → número; cursor de uma ordem com a outra → 400 `validation_error`; cursor no formato da 1.7.0 (`[hotel, número]`) aceito como `hotel_number`; seleção com `order` corta nas 2 000 primeiras dessa ordem. Desempenho: com 20 000 reservas, a contagem responde em até 1 s (como `legacy-import-perf.test.ts`)
  _Implementação:_ a paridade compara contagem, lista com o `quickFilter` e `quickFiltersOf` aplicado ao que a própria API devolve de cada reserva, sem filtros e com filtros. O teste de 20 000 reservas roda sempre (semeia em lotes, em poucos segundos), ao contrário do da 004; a contagem leva cerca de 40 ms (research R-09).
- [X] T030 [US2] Em `apps/server/src/persistence/reservations-repo.ts`: `quickFilterCondition(filter)` montada com as condições existentes (`pending_charge` = `pendingChargeCondition()`; `to_review` = `or(needsReviewCondition(), situationCondition('not_virtual_card'), detailedSituationCondition('return_pending'))`; `with_error` e `done` = `or` de `detailedSituationCondition` com as listas de [contracts/api-changes.md](./contracts/api-changes.md)); `quickFilter` em `ReservationFilters`/`filterConditions`; `countQuickFilters(db, filters)` numa consulta só com `count(*) filter (where …)`; `order` em `listReservations` e `selectReservations` (`hotel_check_in` = `hotel_code`, `check_in`, `reservation_number`), com o cursor `[order, hotelCode, checkIn, reservationNumber]` e o formato antigo `[hotelCode, reservationNumber]` aceito como `hotel_number` (data-model §5). Nenhuma migration (índice `reservations_hotel_check_in_idx` já existe)
  _Implementação:_ os grupos são escritos sobre os fatos da tratativa (research R-09), não com `or` das condições de situação: a contagem assim levava 2,1 s com 20 000 reservas. O cursor passou a ser `[ordem, …]` nas duas ordens; o de dois elementos (1.7.0) vale como `hotel_number`.
- [X] T031 [US2] Em `apps/server/src/http/handlers/reservations.ts`: ler e validar `quickFilter` e `order` nas duas rotas e registrar `GET /reservations/quick-filter-counts` (perfis operador e consulta), respondendo com `countQuickFilters`. T028 e T029 verdes
- [X] T032 [US2] Ponte do app ([contracts/ipc.md](./contracts/ipc.md)): em `apps/desktop/src/shared/ipc-types.ts`, `ReservationQuickFilter`, `ReservationOrder`, `quickFilter` e `order` em `ReservationListInput`, `ReservationCountFilters` e `ReservationQuickFilterCounts`; em `ipc-schemas.ts`, os campos novos e `reservationCountFiltersSchema` (`strictObject`, sem `cursor`, `limit`, `quickFilter` e `order`); em `ipc-channels.ts`, `reservationsQuickFilterCounts: 'reservations:quickFilterCounts'`; `apps/desktop/src/main/api-client.ts` (rota nova e parâmetros), `ipc-handlers.ts` e `apps/desktop/src/preload/index.ts` (`reservations.quickFilterCounts`). Testes em `apps/desktop/test/main/api-client.test.ts` e `ipc-handlers.test.ts` (entrada inválida → `invalid_input`)
  _Implementação:_ o canal fica em `story-handlers.ts`, com a lista de reservas; como o `ipc-handlers.test.ts` só cobre os canais da fundação, o teste do canal (entrada inválida → `invalid_input`, falha da API repassada) ficou em `apps/desktop/test/main/reservations-quick-filters.test.ts`. A seleção do filtro e a cópia aceitam `quickFilter` e `order` por derivarem dos filtros da lista. O `fakeHunit` dos testes da interface ganhou `quickFilterCounts`.

### Telas

- [X] T033 [US2] Barra e painel de filtros (telas 4.1 e 4.12, nodes `71:9228` e `125:3670`; research R-10, R-11): reescrever `renderer/screens/reservations/ReservationFilters.tsx` como a barra (campo único "Buscar por hóspede, nº da reserva, transação, autorização ou valor", aplicado 400 ms depois da última tecla: texto com centavos ou "R$" → `amount`, o resto → `q` com mínimo de 2 caracteres e a mensagem de hoje; "Origem" com Todas / Sistema anterior / HUNIT Control; botão "Filtros") e o painel "Filtros avançados" (hotéis, período de check-in com `ui/PeriodPicker`, situação da reserva, "Ativa ou cancelada" como seleção única — Ativas e canceladas, Só ativas, Só canceladas e Só não identificadas (research UX-3, decidido pelo usuário em 2026-11-18) —, canal e "Só as não encontradas na última verificação"), valendo na hora; e a linha "Filtros aplicados" com um chip removível por filtro do painel em vigor e o da execução, sem a Origem (FR-034). "Falta cobrar" e "A verificar" saem do painel
  _Implementação:_ `ReservationFilters.tsx` com `ReservationFilterBar` (busca `md`, "Origem" com o rótulo ao lado, "Filtros" em contorno que fica preto com o painel aberto) e `AppliedFilterChips`. Componentes novos em `ui/FilterBar.tsx`: `FilterBar`, `FilterPanel` (região "Filtros avançados", card flutuante preso à barra; não é popover nem diálogo, porque os seletores e o calendário de dentro abrem listas fora dele; fecha pelo X, por Esc ou pelo botão), `AppliedFilters` e `RemovableChip`; o `SelectField` ganhou `inlineLabel` e `optionDescriptions` (as descrições da tela 4.12). "Ativa ou cancelada" é uma escolha só, com "Só não identificadas" (UX-3); o período só vale com início e fim, e só o início mostra o aviso. A regra texto × valor da busca ficou em `presentation/reservations.ts` (`parseSearch`).
- [X] T034 [US2] Filtros rápidos e contagens (FR-016, FR-017; research R-09): em `renderer/screens/reservations/ReservationsScreen.tsx`, os `FilterChip` Todas · Falta cobrar · A verificar · Com erro · Concluídas com as contagens de `reservations.quickFilterCounts` (consulta própria do TanStack Query com os mesmos filtros da lista; invalidada junto com a lista: mudança de filtro, volta do servidor, tratativa, envio, confirmação, revisão); o chip escolhido vira `quickFilter` da lista, da seleção do filtro e da cópia para e-mail; falha nas contagens não esconde a lista (chips sem número)
  _Implementação:_ chave `['reservations', 'quick-filter-counts', filtros]`: começa com "reservations", então tudo o que já invalidava a lista (tratativa, envio, confirmação, revisão, retornos) invalida as contagens sem mudar outra tela. Sem nenhuma reserva para a busca e os filtros, só "Todas" (tela 4.3) e o filtro em vigor. A cópia para e-mail descreve o filtro rápido ("Filtros: Falta cobrar").
- [X] T035 [US2] Lista (tela 4.1, research R-08): em `ReservationsScreen.tsx`, `PageHeader` "Reservas" com "Copiar para e-mail" (`secondary`) à direita; `ListCard` com `ReservationRow` (5 colunas, "Ativa/Cancelada" só no detalhe, FR-014); pedido sempre com `order: 'hotel_check_in'`; rodapé "Mostrando X de Y reservas · ordenadas por hotel e check-in" (Y = `all` das contagens) e "Carregar mais" quando houver próxima página; linha aberta em lima suave; estado vazio com `EmptyState` e "Limpar busca e filtros" quando houver busca ou filtro (tela 4.3, FR-021); perfil consulta sem caixas de seleção (tela 6.2). Trocar `ChargedAmount`, `SituationBadge`, `StatusBadge` e `LegacyBadge` de `renderer/components/` pelos de `ui/` (apagar os antigos quando ninguém mais os usar). Tirar `ReservationsScreen.tsx` e `ReservationFilters.tsx` da `NOT_YET_MIGRATED`
  _Implementação:_ `ListCard` + `ReservationRow` com os textos de `presentation/reservations.ts` (período "17/11 → 19/11/2026", noites, "cobrado R$ X · Hunit", selos com o tom de cada situação: verde, âmbar, vermelho e cinza; "Sistema anterior" ao lado do nome). O rodapé segue o estado do design: "ordenadas por hotel e check-in" (4.1), "N selecionadas (M fora desta página)" (4.4) ou "origem: sistema anterior (…)" (4.10); com filtro rápido, Y é o total do grupo. A gaveta passou para `AppDrawer` (com `closeLabel` "Fechar detalhe", o nome que os roteiros procuram); o conteúdo dela continua o da 005 até a T044. Para tirar a tela da `NOT_YET_MIGRATED`, a barra de seleção passou junto para o `SelectionBar` com os menus da tela 4.4 (o que a T041 pede). `ChargedAmount`, `SituationBadge`, `StatusBadge` e `LegacyBadge` de `components/` continuam: o detalhe, a seleção e outras telas ainda não migradas os usam.
- [X] T036 [P] [US2] Testes `desktop-ui`: atualizar `apps/desktop/test/renderer/reservations-screen.test.tsx` e acrescentar `apps/desktop/test/renderer/reservations-quick-filters.test.tsx` (contagens nos chips, filtro rápido aplicado na lista, abreviação de contagem grande, falha das contagens), `reservations-search.test.tsx` (busca única: `380,00` vira `amount`, `101-1000` vira `q`, 1 caractere mostra o erro, espera de 400 ms) e `reservations-filters-panel.test.tsx` (painel, "Filtros aplicados" sem a Origem, remover um chip, "Limpar busca e filtros"); os roteiros `apps/desktop/test/e2e/us3-reservations.test.ts` continuam passando
  _Implementação:_ arquivos novos `reservations-quick-filters`, `reservations-search` e `reservations-filters-panel`, com o apoio em `test/renderer/reservations-helpers.ts`; `reservations-screen` reescrito (lista, detalhe, rodapé, estado vazio, servidor indisponível, uma ação principal por bloco). Adaptados aos componentes novos, com os mesmos papéis e nomes: `selection`, `commercial-reservations`, `dispatch` e `legacy-origin` (o "Buscar" saiu; "Falta cobrar" e "A verificar" viraram filtros rápidos; "Anexar" e "Confirmar" viraram menus). Nos roteiros de ponta a ponta, `us3-reservations`, `treatments`, `dispatch`, `offline-recovery` (sem "Buscar", a ação desabilitada sem servidor passou a ser "Copiar para e-mail"), `no-sensitive-data-on-disk` e o roteiro de captura (com a tela 4.12 nova); o fixture ganhou `searchReservations`, `waitForReservationRows` e `openReservationFilters`.
- [X] T037 [US2] Registrar a área Reservas (lista, painel aberto, estado vazio) em `apps/desktop/test/e2e/responsive.test.ts` e o estado "busca digitada + filtro do painel + filtro rápido" em `resize.test.ts`
  _Implementação:_ `responsive.test.ts` com a lista e a barra de seleção (4.1 e 4.4), o painel aberto (4.12) e o estado vazio (4.3), com reservas de nome longo, valor de seis dígitos e selo comprido; `resize.test.ts` com "busca + canal no painel aberto + Falta cobrar". A gaveta da reserva entra com a T046. O roteiro achou rolagem horizontal de 27 px na lista em 960 px com zoom de 125 % (conteúdo de cerca de 620 px): abaixo de 720 px de conteúdo, o período passou para a segunda linha do hóspede (research R-07). A captura mostrou também linhas de 84 px em vez de 64: as células são `content-box`, e a altura passou a ser a do conteúdo (44 + 20).

**Checkpoint**: MVP — identidade, navegação e a lista de reservas nova, com contagens e ordem por
check-in, funcionando nas três larguras.

---

## Phase 6: User Story 3 - Ver a hierarquia das ações de relance (Priority: P2)

**Goal**: cada botão do app na variante certa, uma principal por bloco, destrutivas inconfundíveis.

**Independent Test**: percorrer telas e diálogos e classificar cada botão (quickstart, cenário 2;
`expectOnePrimaryPerBlock` verde em todos os testes de tela).

- [X] T038 [US3] Em `renderer/screens/reservations/TreatmentSection.tsx`, documentos com `DocumentAction` ("Baixar", "Reverter", "Desfazer" e "Remover valor" = `remove`, FR-009, FR-010) e "Substituir tratativa" e "Substituir comprovante" na mesma variante `secondary` (FR-012). Atualizar `apps/desktop/test/renderer/treatment-section.test.tsx`
  _Implementação:_ "Baixar", "Desfazer", "Reverter" e "Remover valor" com `DocumentAction` (`download`, `undo`, `revert`, `remove`); "Anexar/Substituir tratativa" e "Anexar/Substituir comprovante" em `secondary` (antes o comprovante era preenchido); "Informar valor" `primary` (tela 4.7); "Confirmar" do alerta "Verificar" `primary`, com o alerta como bloco à parte (`data-block="Verificar"`, tela 4.9), e o card como bloco "Tratativa"; "Mostrar mais" `text`; a confirmação "Desfazer o comprovante?" virou `AppDialog` com "Manter" em texto e "Desfazer" `danger`. Para fechar a US3 sem nenhum "Leve" (FR-013), também em `ExecutionDetail.tsx`: "Cancelar execução" `danger-light`, "Retomar" `primary`, "Abrir a retomada" `secondary` e a tela 3.3 ("Cancelar a execução?") em `AppDialog` com "Não" em contorno e "Sim, cancelar" `danger`, como no design. O resto do card (documentos em linhas, valor salvo separado do campo) continua para a T045; o arquivo segue na `NOT_YET_MIGRATED`. Testes: `treatment-section.test.tsx` (tipos das ações de documento, mesmo peso, uma principal por bloco, desfazer em vermelho cheio) e `executions-screen.test.tsx` (variantes do cancelar).
- [X] T039 [P] [US3] Em `renderer/screens/reservations/AttachDialog.tsx`: `AppDialog`, "Cancelar" = `text` e "Escolher outro arquivo" = `secondary` (FR-011), uma principal. Atualizar `apps/desktop/test/renderer/attach-dialog.test.tsx`
  _Implementação:_ `AppDialog` `lg` (780 px, como as telas 4.6 e 4.8), título em texto ("Anexar comprovante a 4 reservas"), "Cancelar" pelo `onCancel` (texto), "Escolher outro arquivo" e "Tentar de novo" (conferir de novo) em `secondary` e "Confirmar" `primary`; no desfecho, "Tentar de novo" (envio interrompido) é a principal e "Fechar" fica em contorno, ou "Fechar" é a principal quando não há o que reenviar. O resumo com os ícones de aceitas e ignoradas fica para a T042. `attach-dialog.test.tsx` ganhou os testes de hierarquia; `dialogs-standard.test.tsx` passou a conferir anexar (uma reserva e lote), "Desfazer o comprovante?" e "Cancelar a execução?".
- [X] T040 [P] [US3] Teste `apps/desktop/test/renderer/actions-audit.test.ts` (FR-013, FR-007): varre o código de `renderer/` e falha se aparecer `variant="light"` ou outro nome fora das variantes de `Action`, e roda `expectOnePrimaryPerBlock` nas telas principais já migradas (a lista cresce com as histórias)
  _Implementação:_ em dois arquivos, porque a interface não tem os tipos do Node: `apps/desktop/test/main/actions-audit.test.ts` lê com o analisador do TypeScript cada `.tsx` de `renderer/` fora de `ui/` e falha com `Action` fora das seis variantes, `DocumentAction` fora dos quatro tipos, variante calculada (só literal ou condição entre literais) e qualquer `Button`/`ActionIcon` com `variant="light"`; um autoteste prova que ele acusa cada caso. `apps/desktop/test/renderer/actions-hierarchy.test.tsx` roda `expectOnePrimaryPerBlock` em Configuração, Executar, Reservas com a barra de seleção e a tratativa com "Verificar" e o campo do valor (lista `SCREENS`, que cresce com as histórias).

**Checkpoint**: nenhuma ação destrutiva com cara de segura; nenhum "Leve".

---

## Phase 7: User Story 4 - Operar um lote de reservas pela barra de seleção (Priority: P2)

**Goal**: caixa de seleção e barra escura do design, com as ações agrupadas, e o resumo do anexo em
lote.

**Independent Test**: marcar reservas de situações variadas em pesquisas diferentes e anexar um
comprovante (quickstart, cenário 8; telas 4.4 a 4.6).

- [X] T041 [US4] Em `ReservationsScreen.tsx`, trocar a barra atual pela `SelectionBar` (tela 4.4, node `71:10052`): oculta sem seleção; "Ver seleção"; "Anexar ▾" (Anexar tratativa, Anexar comprovante); "Confirmar ▾" (Confirmar retornos, Confirmar "Verificar"); "Enviar ao Comercial" lima; "Desmarcar todas"; total marcado e soma; caixa do cabeçalho com estado parcial; "Selecionar todas do filtro" no fim da linha dos filtros rápidos (FR-016) e os avisos de limite com `Notice`. A seleção continua em `renderer/state/selection.tsx` sem mudança (US4-4). Atualizar `apps/desktop/test/renderer/selection.test.tsx`
  _Implementação:_ adiantada na T035: a barra no `SelectionBar` com "Ver seleção", "Anexar ▾", "Confirmar ▾", "Enviar ao Comercial" lima e "Desmarcar todas", "Selecionar todas do filtro" no fim da linha dos filtros rápidos e os avisos em `Notice`; `selection.test.tsx` atualizado. Comparada com o design (tela 4.4) na captura de 1 440 px da US4: mesma ordem, tons e textos. O cenário 2 da US4 na spec dizia "Anexar comprovante" em lima (texto da descrição inicial); foi corrigido para a FR-023 e o design ("Enviar ao Comercial" em lima).
- [X] T042 [P] [US4] `renderer/screens/reservations/SelectionDrawer.tsx` com `AppDrawer` e `CompactReservationRow` (tela 4.5) e `AttachDialog.tsx` com o resumo de aceitas (ícone verde) e ignoradas (ícone âmbar) e a quantidade de cada grupo antes da confirmação (tela 4.6, FR-024; tela 4.8 para o e-mail). Tirar os arquivos da `NOT_YET_MIGRATED`; testes em `selection.test.tsx` e `attach-dialog.test.tsx`; `apps/desktop/test/e2e/treatments.test.ts` continua passando
  _Implementação:_ `SelectionDrawer` com `AppDrawer` ("Reservas selecionadas", fechar "Fechar seleção"), o resumo "N reservas — total de R$ X" com "Limpar seleção" em texto e uma `CompactReservationRow` por reserva dentro de `RowList` (hóspede, "número · hotel", valor, selos e o X "Desmarcar a reserva N"). No `AttachDialog`, o resumo do lote com os componentes novos `BatchSummary`, `SummaryLine` (ícone num círculo verde, âmbar ou vermelho) e `ReasonList` (a caixa cinza com a reserva e o motivo), em `ui/BatchSummary.tsx`: aceitas em verde com o total, as que terão o documento substituído e as ignoradas em âmbar (a linha das ignoradas só aparece quando há alguma), e o desfecho com o mesmo formato (vermelho quando alguma falhou); os alertas viraram `Notice`. Os dois arquivos saíram da `NOT_YET_MIGRATED`. Testes: `selection.test.tsx`, `attach-dialog.test.tsx` (tons e ícones do resumo) e `ui-status.test.tsx`; `treatments.test.ts` e o roteiro de captura acompanharam a troca de tabela por lista. Captura conferida com as telas 4.5 e 4.6.
- [X] T043 [US4] Registrar a barra de seleção (com muitas ações em 960 px) em `responsive.test.ts` e "seleção feita + gaveta da seleção aberta" em `resize.test.ts`
  _Implementação:_ a barra de seleção já estava no `responsive.test.ts` (T037); entraram nele a gaveta da seleção e o diálogo de anexar em lote (cabe na área visível e mantém o espaçamento nos quatro tamanhos), e no `resize.test.ts` o estado "seleção feita + gaveta da seleção aberta" (caixas marcadas, linhas da gaveta e total da barra iguais em 960 e 1 920 px, sem recarregar).

**Checkpoint**: lote completo no visual novo.

---

## Phase 8: User Story 5 - Entender e corrigir uma reserva nos detalhes (Priority: P2)

**Goal**: gaveta da reserva reorganizada, com "Status do Hunit", valor salvo × "Corrigir o valor",
histórico, "Verificações" e o alerta "Verificar" bloqueando novos anexos.

**Independent Test**: abrir reservas comum, com valor salvo, com muito histórico e com "Verificar"
(quickstart, cenário 9; telas 4.2, 4.7 e 4.9).

- [X] T044 [US5] `renderer/screens/reservations/ReservationDetail.tsx` (tela 4.2, node `71:9562`) com `AppDrawer`: cabeçalho com "Reserva N", hotel e `SituationBadges` + Ativa/Cancelada; dados (hóspede, canal, forma de pagamento, check-in, check-out, valor total, "Valor cobrado"); card "Status do Hunit" (selo, motivo e, quando houver `previousClassification`, "Classificação anterior", FR-025); card "Cobrança" ("Valor cobrado no Hunit", FR-040); card "Verificações" (primeira, última, quantidade, FR-028). Tirar da `NOT_YET_MIGRATED`; atualizar `apps/desktop/test/renderer/reservation-detail.test.tsx`
  _Implementação:_ a gaveta já era `AppDrawer` desde a T035; o conteúdo passou para os componentes novos de `ui/Detail.tsx`: `DetailHeader` (número, "hotel N" e os selos: "Sistema anterior", situação, "Verificar", "Não identificada" ou ativa/cancelada, sem repetir "Não identificada"), `DataGrid`/`DataField` (dados da reserva com "Valor cobrado" e a origem; cobrança com "Valor cobrado no Hunit"; verificações) e `CardHeader`. "Status do Hunit" é a caixa cinza (`Card tone="subtle"`) com o selo, o motivo e "Classificação anterior:" com o selo (também a situação anterior da reserva e a data em que não foi encontrada); "Cobrança", "Verificações" e "Sistema anterior" são cards, cada um um bloco. O "Comercial" continua o da 005 até a US8. `components/ChargedAmount.tsx` foi apagado (só o detalhe o usava). Saiu da `NOT_YET_MIGRATED`. Testes novos em `reservation-detail.test.tsx` (selos do cabeçalho, dados, cards); `legacy-origin.test.tsx` procura o selo no cabeçalho.
- [X] T045 [US5] `renderer/screens/reservations/TreatmentSection.tsx` (telas 4.7 e 4.9): card "Tratativa" com os documentos em `HotelRow` (nome, resumo, situação; FR-020) e as ações de documento; valor salvo com "Remover" separado do campo "Corrigir o valor" com "Informar valor" `primary` (o digitado não substitui o salvo antes de confirmar, FR-026); histórico com os 5 mais recentes e "Mostrar mais" (FR-027); com o alerta "Verificar", `Notice` no topo com "Confirmar" `primary` e "Anexar tratativa"/"Anexar comprovante" desabilitados com o motivo ao lado, documentos existentes ainda com "Baixar" (FR-029; research R-12: só apresentação, o servidor não muda). Testes em `treatment-section.test.tsx` (anexos desabilitados com o texto do motivo; ao confirmar, liberam)
  _Implementação:_ card "Tratativa" (bloco) com a situação ao lado do título ou "Sem tratativa"; documentos em `HotelRow` dentro de `RowList` "Documentos da tratativa" (ícone de documento, tipo, arquivo e tamanho, "Anexado em … por …", "Substituído em … · pode ser revertido até …", selo da situação do documento e as ações de documento); o valor salvo numa caixa cinza com "Remover valor", à parte do campo "Corrigir o valor cobrado (R$)" com "Informar valor" `primary` (o rótulo antigo "Valor que foi cobrado" seguiu o design); histórico com "Histórico", os 5 mais recentes e "Mostrar mais". Com "Verificar": `Notice` âmbar com o "!" num círculo (o `Notice` ganhou o ícone em círculo e `block`) e "Confirmar" como a principal dele; os botões de anexar ficam desabilitados com o motivo logo abaixo ("Confirme o alerta “Verificar” antes de anexar novos documentos.", ou o de "não exige cobrança" quando a reserva não aceita documentos); "Baixar" continua. Saiu da `NOT_YET_MIGRATED`. Testes em `treatment-section.test.tsx` (anexos desabilitados com o motivo e liberados ao confirmar; o digitado não substitui o salvo; linhas dos documentos).
- [X] T046 [US5] Registrar a gaveta da reserva em `responsive.test.ts` (as três larguras; fechar sempre alcançável) e "gaveta aberta + valor digitado em Corrigir o valor" em `resize.test.ts`
  _Implementação:_ `responsive.test.ts` abre a gaveta de uma reserva com comprovante e valor informado (registrados pela API) e confere nos quatro tamanhos o fechar, o cabeçalho, "Status do Hunit", as ações do card "Tratativa", o campo "Corrigir o valor", "Valor cobrado no Hunit" e "Verificações"; `resize.test.ts` mantém a gaveta aberta com "1.234,56" digitado em "Corrigir o valor" ao ir para 960 e 1 920 px.

**Checkpoint**: detalhe da reserva completo no visual novo.

---

## Phase 9: User Story 7 - Reconhecer as reservas do sistema anterior (Priority: P2)

**Goal**: telas 4.10 e 4.11 no visual novo (o comportamento é da 004).

**Independent Test**: filtrar Origem "Sistema anterior" e abrir uma reserva "A revisar (sistema
anterior)" (telas 4.10 e 4.11).

- [X] T047 [US7] Na lista: selo "Sistema anterior" ao lado do nome do hóspede e os selos empilhados ("Selo extra" para "Verificar" e "Não identificada", FR-033); com Origem "Sistema anterior", a barra mostra a Origem escolhida e nem "Filtros aplicados" nem o painel a repetem (FR-034); "A revisar (sistema anterior)" conta e aparece em "A verificar" (vem do T030). Arquivos: `renderer/ui/lists/ReservationRow.tsx` (se preciso) e `renderer/screens/reservations/ReservationsScreen.tsx`. Atualizar `apps/desktop/test/renderer/legacy-origin.test.tsx`
  _Implementação:_ veio com a US2: o selo "Sistema anterior" ao lado do nome e os selos empilhados na coluna Situação (`ReservationRow` e `presentation/reservations.ts`, T035), a Origem só na barra, sem repetir em "Filtros aplicados" nem no painel, e o rodapé "origem: sistema anterior (…)" (T033 e T035), e "A revisar (sistema anterior)" em "A verificar" (T030, testado no domínio e no servidor). Conferido com a tela 4.10 na captura de 1 440 px. `legacy-origin.test.tsx` ganhou a ordem dos selos empilhados.
- [X] T048 [US7] Na gaveta (tela 4.11, node `150:5826`): selos aplicáveis no topo, "Status do Hunit", tratativa importada com "Baixar" e "Desfazer", "Cobrança", "Verificações" com o aviso "Ainda não verificada…" e o card "Sistema anterior" (FR-035), em `ReservationDetail.tsx` e `TreatmentSection.tsx`. Testes em `legacy-origin.test.tsx`
  _Implementação:_ veio com a US5 (T044 e T045): selos no topo na ordem da tela 4.11 ("Sistema anterior", a situação e "Não identificada"), "Status do Hunit", tratativa importada "por Sistema anterior" com "Baixar" e "Desfazer", "Cobrança", "Verificações" com "Ainda não verificada…" e o card "Sistema anterior". Conferido com a tela 4.11 na captura de 1 440 px. `legacy-origin.test.tsx` ganhou a ordem dos selos do cabeçalho, o aviso dentro de "Verificações" e a tratativa importada com as ações do operador; o teste "sem selo" passou a olhar o cabeçalho (procurava o `data-testid` do selo antigo e passava à toa).

**Checkpoint**: reservas do sistema anterior reconhecíveis em até 5 s numa lista (SC-010).

---

## Phase 10: User Story 8 - Enviar ao Comercial e trabalhar na área Comercial (Priority: P2)

**Goal**: telas 7.1 a 7.14 no visual novo e o envio em andamento como card escuro (o comportamento é da
005).

**Independent Test**: percorrer as telas 7.1 a 7.14 com dados de teste e abrir o envio a partir de
uma seleção em no máximo 2 cliques (quickstart, cenários 11 e 16).

- [X] T049 [US8] ⛔ FIGMA/UX: montar no Figma a tela de exemplo **7.7a Comercial — Envios com envio em andamento (para aprovação)** (research R-13; [contracts/screens.md](./contracts/screens.md), "Tela para aprovação"): numa seção nova "Para aprovação da UX" da página `006-redesign-app-desktop`, a partir da tela 7.7 (`190:7635`) e só com componentes de `Componentes — nova identidade`, com o card escuro no topo (data, cliente, "N de M reservas verificadas", progresso lima, percentual e "Ver envio" lima) e o histórico abaixo; dados fictícios. Não alterar nenhum frame existente. Carregar antes `skill://figma/figma-use/SKILL.md`. Pedir ao usuário que leve à UX e registrar a resposta em `research.md` (R-13)
  _Implementação:_ tela montada na seção "Para aprovação da UX" (node `211:9211`), frame `211:9212`, a partir de uma cópia da 7.7 com uma instância do "Card — execução em andamento" (`53:131`) entre as abas e o "Histórico"; exemplo com 8 de 16 reservas (50 %), porque a largura da barra não pode ser mudada numa instância sem desconectá-la da biblioteca. Aprovada pela UX em 2026-11-18, sem ajustes (registrado no R-13).
- [X] T050 [P] [US8] Envio (telas 7.1 a 7.4): `renderer/screens/dispatch/DispatchDialog.tsx` e `DispatchView.tsx` com `AppDialog` (`lg`), conferência com aceitas e as que ficam de fora com o motivo, andamento com `ProgressBar` e a lista de resultados, token no `TwoFactorDialog` escuro, concluído com as contagens. Atualizar `apps/desktop/test/renderer/dispatch.test.tsx`; `apps/desktop/test/e2e/dispatch.test.ts` continua passando
  _Implementação:_ `AppDialog` com a largura de cada tela: a conferência estreita (`sm`, 520 px, como a tela 7.1; a tarefa dizia `lg`) e o andamento e o resultado largos (`lg`, telas 7.2 e 7.4), fechando pelo X, sem botão no rodapé. Conferência: o resumo, a explicação, as que ficam de fora com o ícone âmbar e a caixa cinza com o motivo (os mesmos `SummaryLine` e `ReasonList` do anexo em lote), o acesso ao Hunit numa caixa cinza (`CredentialsForm` ganhou `inset`), "Cancelar" em texto e "Enviar N ao Comercial" `primary`. Andamento: "Envio ao Comercial" com o selo ("Em andamento" em lima: `presentation/jobs.ts`, que a US6 também usa), a data e o cliente à direita; a caixa cinza com "N de M verificadas — faltam X", as contagens no singular ou plural ("1 enviada · 0 retiradas"), a `ProgressBar` e a reserva em verificação; "Cancelar envio" `danger-light` e "Retomar as não verificadas (N)" `primary`; cada reserva numa `HotelRow` (número, hotel · motivo, selo do resultado). O aviso "Fechar não interrompe o envio…" não está no design, mas ficou, pequeno, enquanto o envio roda (diferença a registrar na T062). O token (7.3) já era o `TwoFactorDialog` escuro da US1. Os dois arquivos saíram da `NOT_YET_MIGRATED`. Testes: `dispatch.test.tsx` (larguras, variantes, selo lima, contagens, linhas do resultado); `dialogs-standard.test.tsx` com a conferência e o andamento; `test/e2e/dispatch.test.ts` e o roteiro de captura acompanharam o texto das contagens e o fechar pelo X.
- [X] T051 [P] [US8] Gaveta "Validar comprovante" e recusa (telas 7.5 e 7.6): `renderer/screens/reservations/CommercialSection.tsx` com o card "Comercial" de 16 px (FR-042), retorno com hotel diferente e diferença de valor em destaque, "Confirmar" `primary` e "Recusar" `secondary`; `RejectDialog` com `AppDialog` `sm`, motivos rápidos e campo de texto (FR-038). Atualizar `apps/desktop/test/renderer/commercial-validation.test.tsx`
  _Implementação:_ card "Comercial" (bloco) com o selo da linha (e "Atualização da planilha pendente" em âmbar), "Desfazer envio" `danger-light` e "Reverter envio desfeito" `secondary`; os dados do envio em `DataGrid`; o retorno numa caixa cinza com o selo, "lido em …", o hotel da cobrança em âmbar e negrito com o selo "Diferente do hotel da reserva" quando diferem, e a diferença de valor em âmbar e negrito quando não é zero (`AmountDifference`); "Confirmar" `primary` e "Recusar" `danger-light`, como no design (a tarefa dizia `secondary`); "Desfazer confirmação" `danger-light`; os retornos anteriores em `HotelRow`; "Desfazer o envio ao Comercial?" em `AppDialog` com "Manter" em texto e "Desfazer envio" `danger`. `RejectDialog`: `AppDialog` `sm`, o aviso em `Notice` âmbar, "Motivos mais comuns" em `FilterChip` (a escolhida em preto, `aria-pressed`), o campo novo `TextAreaField` com o contador na linha do rótulo e "Voltar" em texto e "Recusar retorno" `danger` (o botão se chamava "Recusar"). Saiu da `NOT_YET_MIGRATED`. Testes em `commercial-validation.test.tsx` (variantes, tons e o diálogo), `ui-fields.test.tsx` (`TextAreaField`) e `dialogs-standard.test.tsx` (a recusa e o desfazer envio).
- [X] T052 [US8] Área Comercial (telas 7.7 a 7.10): `renderer/screens/commercial/CommercialScreen.tsx` com `PageHeader` e `Tabs` (Envios, Retornos a validar com contagem, Retornos com problema com contagem, Planilha; FR-039); `DispatchesTab.tsx` com `ListCard` e linhas de lista e, para envio em andamento, o `RunningJobCard` no topo **como aprovado no T049**; `ReturnsTab.tsx`, `ProblemsTab.tsx` e `SheetTab.tsx` com os componentes de `ui/`. Tirar os arquivos da `NOT_YET_MIGRATED`; atualizar `apps/desktop/test/renderer/commercial-screen.test.tsx` (inclui o card do envio em andamento)
  _Implementação:_ `CommercialScreen` com `PageHeader` (título e a explicação da área) e `Tabs` com a contagem dos retornos a validar e dos retornos com problema (da situação da planilha). "Envios": o envio em andamento no `RunningJobCard`, como na 7.7a aprovada ("Iniciado em … · …", quem enviou com "(esta máquina)" e quantas reservas, "N de M reservas verificadas", o percentual e "Ver envio"), e os encerrados no "Histórico" em `ListCard` com `DISPATCH_COLUMNS` e `ExecutionRow`; o detalhe numa `AppDrawer` "Detalhe do envio" (o `DispatchView` já tem "Envio ao Comercial" no topo). "Retornos a validar": `ListCard` com a faixa de ações (`toolbar`: marcar todos, "Confirmar marcados (N)" em contorno e "a recusa é uma a uma"), as colunas da tela 7.8 em `ListRow`/`ListCell` (o número da reserva abre o detalhe), o hotel da cobrança e a diferença em âmbar (os mesmos `ChargeHotel` e `AmountDifference` do card "Comercial") e "Confirmar" `primary` e "Recusar" `danger-light` em cada linha, que é um bloco. "Retornos com problema": a reserva e o hotel, o problema num selo âmbar, a mensagem e quando; a seta abre o detalhe da reserva (o `ReservationDetailLoader` passou a aceitar só a chave). "Planilha": card "Situação da planilha" com o selo, "Ler retornos agora" `primary`, os avisos em `Notice` e os números em `DataTiles`. Em conteúdo estreito, o responsável vai para a linha da reserva (abaixo de 1 000 px), as ações ficam uma embaixo da outra (abaixo de 820 px) e a diferença e o "quando" vão para a célula vizinha (abaixo de 720 px); conferido no roteiro de larguras da T054. Componentes novos: `ListRow`, `ListCell`, `ListActions`, `DataTiles`, `DataTile`, `toolbar` no `ListCard` e `DISPATCH_COLUMNS`; helpers em `presentation/jobs.ts` (`formatWhen`, `requesterName`, `dispatchTally`). O "Acesso ao Hunit" embutido deixa "Limpar acesso" à direita do texto, como na 7.1. Os cinco arquivos saíram da `NOT_YET_MIGRATED`. Testes: `commercial-screen.test.tsx` (cabeçalho e contagens, card do envio em andamento e histórico, faixa e variantes dos retornos, seta dos problemas, caixas da planilha) e `ui-lists.test.tsx`; captura conferida com as telas 7.7 a 7.10.
- [X] T053 [P] [US8] Lote e e-mail (telas 7.11 a 7.14): aviso de "Selecionar todas do filtro" com `Notice`; `renderer/screens/reservations/ConfirmBatchDialog.tsx` (retornos em lote e "Verificar" em lote) e `CopyDialog.tsx` com `AppDialog` e `CompactReservationRow`; a cópia usa o filtro rápido e a ordem da lista (T034, T035). Atualizar `apps/desktop/test/renderer/commercial-reservations.test.tsx`
  _Implementação:_ "Selecionar todas do filtro" (tela 7.11): quando o filtro inteiro cabe e a seleção é só ele, o botão dá lugar ao texto "As N reservas do filtro estão selecionadas (até 2.000, na ordem da lista)", a barra mostra "· todas do filtro" (`SelectionBar` ganhou `scope`) e o rodapé "Mostrando X de Y reservas selecionadas do filtro"; vale enquanto os filtros e a seleção não mudam. Os casos com limite (o filtro passa de 2 000 ou nem todas couberam) e os erros continuam no `Notice` (âmbar ou vermelho). `ConfirmBatchDialog` (telas 7.12 e 7.13): `AppDialog` largo para os retornos e estreito para o "Verificar", o resumo com as quantidades em negrito, a revisão dos retornos e a contagem por status do Hunit (com os selos) em `InsetList`, a lista em tabela dentro de uma caixa cinza com as mesmas `ListRow`/`ListHeader` das listas (coluna nova `count`), "Cancelar" em texto e "Confirmar N retornos" (o botão se chamava "Confirmar N") ou "Confirmar N" como principal; o desfecho com `SummaryLine` e `ReasonList`. `CopyDialog` (tela 7.14): `AppDialog` estreito, "O que copiar" em `RadioField`, "Cancelar" em texto e "Copiar" como principal; depois, o resultado em `Notice` verde e "Fechar". A cópia já seguia o filtro rápido e a ordem da lista (T034, T035). Os dois diálogos saíram da `NOT_YET_MIGRATED`. Testes em `commercial-reservations.test.tsx` e `commercial-validation.test.tsx`.
- [X] T054 [US8] Registrar a área Comercial (as quatro abas) e os diálogos do envio em `responsive.test.ts`, a aba ativa e o motivo da recusa digitado em `resize.test.ts`, e os diálogos de T050, T051 e T053 em `dialogs-standard.test.tsx`
  _Implementação:_ `responsive.test.ts` sobe o servidor com a planilha em memória e monta, direto no banco e na planilha (as fábricas do servidor, sem passar pelo Hunit), um envio encerrado com duas reservas pendentes, uma com o retorno preenchido (maquininha de outro estabelecimento, valor diferente) e outra com o retorno incompleto; confere nas quatro larguras as abas "Envios", "Retornos a validar", "Retornos com problema" e "Planilha", o diálogo de recusa (7.6) e a conferência do envio (7.1). O roteiro achou a diferença de valor marcada como "não cortar" num `span` que não dá para medir; ela passou a `inline-block`. `resize.test.ts` mantém a aba "Retornos a validar" ativa com o motivo da recusa digitado. `dialogs-standard.test.tsx` tem os diálogos da T050, T051 e T053; `actions-hierarchy.test.tsx` passou a incluir "Retornos a validar" e "Planilha".

**Checkpoint**: Comercial e envio no visual novo; envio em andamento conforme aprovado pela UX.

---

## Phase 11: User Story 6 - Acompanhar execuções e ler hotéis e documentos (Priority: P3)

**Goal**: execuções ativas em cards escuros e o "Histórico"; hotéis da execução como linhas simples;
resultado da execução no visual novo.

**Independent Test**: com uma execução em andamento e várias encerradas, abrir Execuções e o detalhe
(quickstart, cenário 10; telas 2.6, 2.7, 3.1 a 3.4 e 6.1).

- [X] T055 [US6] `renderer/screens/executions/ExecutionsScreen.tsx` (tela 3.1, node `24:1524`): `PageHeader`; um `RunningJobCard` por execução com `active = true` (data, período, cliente, "N de M hotéis concluídos", progresso, percentual, "Ver detalhes" lima), sem card quando não houver (US6-3); seção "Histórico" com `ListCard` e `ExecutionRow` (data, período, cliente, resultado, situação). Envios não aparecem aqui (research R-13). Atualizar `apps/desktop/test/renderer/executions-screen.test.tsx` (uma ativa, duas ativas de contas diferentes, nenhuma)
  _Implementação:_ `PageHeader` "Execuções" com o aviso de dados antigos ao lado; um `RunningJobCard` por execução em andamento (na fila, rodando ou aguardando o token), com "Iniciada em … · …", "Check-in 13/11 a 19/11/2026 · quem iniciou (esta máquina)", "N de M hotéis concluídos" e o percentual (do detalhe da execução, buscado a cada 10 s no mesmo cache da gaveta, sem abrir a escuta dos eventos) e "Ver detalhes"; as demais no "Histórico" em `ListCard` com `ExecutionRow` (o resultado: "Encerrada às HH:MM · duração" ou o motivo de término) e o rodapé "N execuções · as mais recentes primeiro". A gaveta virou `AppDrawer`. Helpers em `presentation/jobs.ts` (`formatWhen`, `requesterName`, `jobStatusBadge`, que passou a aceitar a situação do hotel). Testes em `executions-screen.test.tsx`: uma em andamento, duas de contas diferentes e nenhuma.
- [X] T056 [US6] `renderer/screens/executions/ExecutionDetail.tsx` (telas 3.2 a 3.4) com `AppDrawer`: hotel atual, tempo restante, contagens com `CountCard`/`IndicatorCard`, hotéis em `HotelRow` (FR-020), evidências (`renderer/components/EvidenceList.tsx` no visual novo), "Cancelar execução" e o diálogo "Cancelar a execução?" com `AppDialog` e "Sim, cancelar" `danger` (FR-009). Atualizar os testes; `apps/desktop/test/e2e/us2-monitor-cancel-resume.test.ts` continua passando
  _Implementação:_ "Execução" (`SectionTitle`) com o selo e quem iniciou; o período; "Retomada de …" em texto; o motivo de término em `Notice` (vermelho, âmbar se cancelada); o hotel atual numa caixa cinza; o tempo restante; o campo do token numa caixa cinza com "Enviar token" `primary`; a faixa `ProgressStrip` enquanto roda; as contagens em `CountCard`; os hotéis em `HotelRow` (`ExecutionParts.tsx`, com o resumo "Código 101 · 6 reservas · 42 s", "lendo reservas · página 1 de 5" ou "aguardando na fila", o motivo da falha e o último aviso); os avisos do servidor num card; `EvidenceList` como card "Evidências de falha" com os botões em contorno; "Ver as reservas desta execução" `secondary`; "Cancelar execução" `danger-light`, "Retomar" `primary` e "Abrir a retomada" `secondary`; "Cancelar a execução?" e "Acesso ao Hunit para retomar" em `AppDialog`. Testes em `executions-screen.test.tsx`; `us2-monitor-cancel-resume.test.ts` continua passando.
- [X] T057 [P] [US6] Resultado da execução em Executar (telas 2.6 e 2.7): `renderer/screens/run/ExecutionResult.tsx` e `renderer/components/ClassificationCountsGrid.tsx` com `IndicatorCard`/`CountCard` (números grandes, US1-3) e hotéis em `HotelRow`. Atualizar `apps/desktop/test/renderer/execution-result.test.tsx`
  _Implementação:_ `ExecutionResult` num card com "Execução em andamento" ou "Resultado da execução", o selo e o período à direita, o motivo de término em `Notice` com "Iniciar de novo" `primary` (tela 2.10), a faixa de progresso enquanto roda e as mesmas peças do detalhe (contagens e hotéis). `ClassificationCountsGrid` passou a `CountGrid` com `CountCard` (tom de cada situação; cinza para as neutras). Testes em `execution-result.test.tsx`.
- [X] T058 [US6] Registrar Execuções (lista e gaveta) em `responsive.test.ts`, o diálogo de cancelamento em `dialogs-standard.test.tsx` e a gaveta aberta em `resize.test.ts`
  _Implementação:_ `responsive.test.ts` cria uma execução em andamento direto no banco e confere nas quatro larguras a lista (card e "Histórico"), a gaveta de uma encerrada, a gaveta da em andamento e o "Cancelar a execução?"; `resize.test.ts` mantém a gaveta de uma execução aberta ao ir para 960 e 1 920 px. `dialogs-standard.test.tsx` já tinha o "Cancelar a execução?" (T038) e ganhou o "Acesso ao Hunit para retomar"; `actions-hierarchy.test.tsx` passou a incluir Execuções com a gaveta e o resultado com "Iniciar de novo". Com isso, a `NOT_YET_MIGRATED` ficou só com `DocumentPreview` e os selos antigos de `components/` (T059).

**Checkpoint**: todas as áreas no visual novo.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: fechar a regra dos componentes, documentar, comparar com o design, homologar, marcar no
Figma e implantar.

- [X] T059 Migrar o que sobrou (`renderer/components/DocumentPreview.tsx` e qualquer arquivo ainda em `NOT_YET_MIGRATED`) e **esvaziar e remover** a `NOT_YET_MIGRATED` de `eslint.config.js`: `pnpm lint` verde sem exceções (FR-030, research R-05). Apagar de `renderer/components/` os componentes substituídos por `ui/` sem uso
  _Implementação:_ `DocumentPreview` com os componentes de `ui/` (o nome em negrito com o tamanho, a imagem e o PDF numa caixa cinza, os botões de página em contorno, o cabeçalho do e-mail em linhas com o texto numa caixa cinza e o aviso de arquivo ilegível em `Notice` âmbar). Apagados de `components/` os selos antigos sem uso (`StatusBadge`, `SituationBadge`, `LegacyBadge`) e, de `presentation/labels.ts`, o `TONE_COLORS` (cores do Mantine que só eles usavam). A `NOT_YET_MIGRATED` saiu do `eslint.config.js`: `pnpm lint` passa sem exceções.
- [X] T060 [P] Rótulos (research R-15): conferir em `renderer/presentation/labels.ts` os nomes do design (selos em maiúsculas pelo estilo "Badge", não pelo texto) e os tons de cada situação nas cores de significado fixo (FR-005: verde concluído, âmbar atenção, vermelho erro, cinza neutro, lima em andamento). Atualizar `apps/desktop/test/renderer/labels.test.ts`
  _Implementação:_ conferidos com as capturas de todas as áreas: os nomes do design já estavam nos rótulos (escritos normalmente; a caixa alta vem do estilo do selo) e os tons batiam, menos "em andamento". Entrou o tom `progress` (lima) para "Em andamento" da execução, do hotel e do envio e para "A cobrar" da linha da planilha (tela 7.5); o caso à parte que a US8 tinha criado (`jobStatusBadge`) saiu, e as telas usam `badgeOf`. `TONES` e `BADGE_TONES` documentam as cores fixas. `labels.test.ts` confere o mapeamento dos tons, os estados em lima, verde, vermelho e âmbar e que nenhum nome vem em caixa alta.
- [X] T061 [P] Roteiro de captura `apps/desktop/test/e2e/screens-capture.test.ts`: as telas 1.1 a 7.14 com os estados do design, a 4.12 (painel "Filtros avançados") nova, a 7.7 sem envio em andamento (como no design) e um print à parte, `7.7a`, com o card do envio em andamento (tela aprovada no T049); atualizar o catálogo `.claude/skills/figma-screens-sync/references/screens.md` (linha da 4.12, coluna "Código" conforme [contracts/screens.md](./contracts/screens.md))
  _Implementação:_ o roteiro já capturava as telas 1.1 a 7.14, a 4.12 e a 7.7 sem envio em andamento (o envio do roteiro termina antes); entrou a `7.7a`: um envio em andamento criado direto no banco (8 de 16 reservas verificadas, como na tela aprovada), fotografado na aba "Envios" e encerrado logo depois. Ao longo das histórias, o roteiro acompanhou as telas novas (a 3.1 pelo card escuro, o fechar pelo X nas 7.2 e 7.4, as listas da área Comercial). No catálogo da skill, a coluna "Código" de todas as telas passou a seguir `contracts/screens.md` (26 linhas mudaram, inclusive a 4.10, que citava o `LegacyBadge` apagado na T059); a nota de situação explica que "Ativa em" muda na T066.
- [ ] T062 Comparação com o design (SC-001, quickstart §2): capturar em 1 440 × 900 e comparar cada print com o frame do design; registrar as diferenças em `research.md` ("Comparação com o design") e corrigir até não sobrar diferença sem aceite. Capturar também em 960 e 1 280 px e guardar para a revisão da UX (research UX-5; os prints ficam fora do Git)
  _Diferenças já vistas nas comparações das histórias (a decidir na T062):_ tela 4.3, "Copiar para e-mail" desabilitado sem resultado (no design, ativo; o app mantém o da 005); tela 4.5, o título da gaveta maior no design que nas outras gavetas e a linha "N reservas — total de …" toda em negrito (no app, só o total); telas 7.2 e 7.4, o aviso "Fechar não interrompe o envio…", que não está no design; tela 7.11, a barra de seleção quebra o total para a segunda linha (no design o total aparece cortado); telas 4.10 e 7.11, o nome com o selo "Sistema anterior" quebra linha quando a página tem a barra de rolagem; tela 7.13, as linhas da contagem por status mais altas que no design.
  _Andamento (19/11/2026):_ feita em parte. Capturas em 1 440 × 900 (47 prints), 960 × 640 e 1 280 × 820, todas sem falhas (prints fora do Git, para a revisão da UX). Comparadas com o Figma as telas 2.6, 2.7, 2.10, 3.1 a 3.4, 4.1 a 4.12, 7.1, 7.2, 7.4 a 7.14 e o 7.7a; as diferenças estão em `research.md` ("Comparação com o design"). Corrigidas: o resumo da gaveta de seleção todo em negrito (4.5) e as linhas da lista interna com 48 px (7.13). As outras ficaram como estão, com o motivo, e as de decisão da UX vão para a homologação. Faltam as telas 1.1 a 1.3, 2.1 a 2.5, 2.8, 2.9, 5.1, 6.1, 6.2 e 7.3: o conector do Figma caiu no meio da comparação. A tarefa fica aberta até essas telas serem comparadas.
- [X] T063 [P] Documentação: `AGENTS.md` (estrutura com `renderer/src/ui/` e a regra de lint; contrato 1.8.0 com a cópia em `specs/006-redesign-app-desktop/contracts/`; a cópia da 005 congelada na 1.7.0; parágrafo "Desde a feature 006"; comando do `generate-icon.mjs`) e `README.md` (instalação do app: ícone novo; se o atalho mostrar o ícone antigo, cache do Windows)
  _Feito:_ `AGENTS.md` com o `src/renderer/src/ui/` e a regra do lint na linha do `apps/desktop`, a cópia da 006 entregando a 1.8.0, o comando do `generate-icon.mjs` e o parágrafo "Desde a feature 006"; `README.md` com o ícone novo e o cache de ícones do Windows. O app foi para a versão 0.3.0 (`apps/desktop/package.json`), como o `README.md` pede para uma feature que muda o app: o instalador novo sai como `0.3.<commits>`.
- [ ] T064 Verificação completa: `pnpm build`, `pnpm lint`, `pnpm typecheck` e `pnpm test` (todos os grupos, com o Docker) verdes; `git diff --cached --name-only` sem prints, planilhas ou dados reais
- [ ] T065 ⛔ HOMOLOGAÇÃO: quickstart §4 — servidor de homologação na API 1.8.0 e instalador novo; cenários 1 a 17 da seção 3 com os dois perfis; o app 0.2 contra a 1.8.0 continua funcionando. Registrar em `research.md` ("Homologação")
- [ ] T066 ⛔ FIGMA: rodar a skill `figma-screens-sync` com `FEATURE = '006-redesign-app-desktop'`: simulação, relatório ao usuário e, com o ok dele, aplicação — telas da 006 com ✅ e as das páginas 002 a 005 com ❌ e ocultas (FR-032, research R-17). Atualizar a coluna "Ativa em" do catálogo
- [ ] T067 ⛔ PRODUÇÃO: quickstart §5 — servidor de produção na 1.8.0 **antes** do app; instalador novo nas máquinas do Financeiro e da Controladoria. Registrar em `research.md` ("Produção")

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências. T002 antes de T008 e T018.
- **Foundational (Phase 2)**: depende do Setup; **bloqueia** todas as histórias. T004 → T005, T006;
  T006 → T009 a T014; T009 a T014 em paralelo entre si (arquivos diferentes); T012, T014 → T015.
- **US1 (Phase 3)**: depende da Foundational. T016 antes de T019 e T020 (o menu e o contêiner);
  T017 e T018 em paralelo.
- **US9 (Phase 4)**: depende de US1 (precisa de áreas migradas para testar). Cada história seguinte
  acrescenta as telas dela aos roteiros (T037, T043, T046, T054, T058).
- **US2 (Phase 5)**: depende da Foundational. API: T025 → T026; T027 → T028, T029 → T030 → T031 →
  T032. Telas: T032 → T033, T034, T035 → T036 → T037.
- **US3 (Phase 6)**: depende da US2 (T035) para a lista; T038 a T040 em paralelo.
- **US4 (Phase 7)**: depende da US2 (lista e filtros rápidos).
- **US5 (Phase 8)**: depende da Foundational; T045 depois de T038 (mesmo arquivo).
- **US7 (Phase 9)**: depende da US2 (T035) e da US5 (T044, T045).
- **US8 (Phase 10)**: depende da US4 (barra de seleção) e da US5 (gaveta); o card do envio em
  andamento do T052 segue a tela 7.7a, aprovada pela UX em 2026-11-18 (T049).
- **US6 (Phase 11)**: depende da Foundational e da US1 (T020, para o resultado em Executar).
- **Polish (Phase 12)**: depois de todas as histórias. T059 → T064; T061 → T062 → T065 → T066;
  T065 → T067.

### Within Each User Story

- Testes escritos antes e falhando; domínio → repositório → rotas → ponte do app → telas.
- Cada tela migrada sai da `NOT_YET_MIGRATED` na mesma tarefa.
- Uma tarefa só está concluída com os testes dela passando (constitution VII).

### Parallel Opportunities

- Setup: T002 com T001.
- Foundational: T005 e T007 com T006; T008 a T014 entre si.
- US1: T017, T018 e T019 em paralelo depois de T016.
- US9: T022 e T023 em paralelo com T021.
- US2: T025 com T027; T028 com T029; as telas (T033 a T035) começam depois de T032.
- US3: T039 e T040 em paralelo com T038.
- US5 e US6 podem andar em paralelo com a US2 (arquivos diferentes), se houver mais de uma pessoa.
- US8: T049 (Figma) concluído; T050, T051 e T053 em paralelo.
- Polish: T060, T061 e T063.

---

## Parallel Example: Foundational

```bash
# Depois de T004 e T006, em paralelo:
Task: "T009 Action, DocumentAction, MenuButton e FilterChip"
Task: "T010 Campos e PeriodPicker"
Task: "T011 Selos, avisos, progresso e estado vazio"
Task: "T012 Card, PageHeader, AppDialog e AppDrawer"
Task: "T013 AppHeader, SideMenu e Tabs"
Task: "T014 Linhas de lista, SelectionBar e RunningJobCard"
```

## Parallel Example: User Story 2

```bash
# API, em paralelo:
Task: "T025 Testes de quickFiltersOf"
Task: "T027 Contrato 1.8.0"
# Depois de T027:
Task: "T028 Testes de contrato do quickFilter, order e contagens"
Task: "T029 Paridade, ordem por check-in e desempenho (server-db)"
```

---

## Implementation Strategy

### MVP First (US1 + US9 + US2)

1. Phase 1 (Setup) e Phase 2 (Foundational): o app já abre com a fonte e as cores novas.
2. Phase 3 (US1): navegação, Configuração, Executar e o ícone novo.
3. Phase 4 (US9): roteiros de larguras e redimensionamento.
4. Phase 5 (US2): lista de reservas com filtros rápidos, contagem e ordem por check-in.
5. **PARAR E VALIDAR**: quickstart, cenários 1 a 7, 12 e 15; os roteiros `desktop-e2e` antigos verdes.

### Incremental Delivery

1. Setup + Foundational → base visual.
2. US1 → identidade e navegação.
3. US9 → prova das larguras (cresce com cada história).
4. US2 → lista de reservas (MVP).
5. US3 → hierarquia das ações.
6. US4 → lote.
7. US5 → detalhe da reserva.
8. US7 → sistema anterior.
9. US8 → Comercial e envio (o T049 vai para a UX logo no início da feature).
10. US6 → execuções.
11. Polish → lint sem exceções, comparação com o design, homologação, marcação no Figma e produção.

O app só é instalado nas máquinas no fim (T067): entre as fases, as telas novas convivem com as
antigas apenas no ambiente de desenvolvimento.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Commits pequenos, em português, citando a spec (ex.: `feat(specs/006): lista de reservas com filtros rápidos (T033-T035)`).
- Antes de cada commit: `git diff --cached --name-only` sem prints, `.env`, planilhas ou dados reais
  (AGENTS.md).
- UX-3 decidido (2026-11-18): o filtro "Ativa ou cancelada" tem a quarta opção "Só não identificadas";
  registrar a diferença em relação ao design na comparação (T062).
- Se a implementação mostrar que a spec está errada ou incompleta, **parar e atualizar a spec** antes
  de seguir.
