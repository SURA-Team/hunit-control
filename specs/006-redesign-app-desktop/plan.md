# Implementation Plan: Redesign visual do app desktop

**Branch**: `006-redesign-app-desktop` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-redesign-app-desktop/spec.md`

## Summary

Leva para o app desktop o design oficial da UX (arquivo "Hunit Control" do Figma, página
`006-redesign-app-desktop`, telas 1.1 a 7.14): identidade nova (fundo cinza, cards brancos, menu
flutuante, Manrope, monocromático com lima), hierarquia de ações, listas enxutas com filtros rápidos
e contagem, barra de lote escura, detalhe da reserva reorganizado, execuções com card escuro e
"Histórico", as telas da importação (004) e do Comercial (005) no visual novo, diálogos padronizados
e todas as telas responsivas de 960 px a monitores grandes. Regras de negócio, permissões e fluxos
não mudam.

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Fundação primeiro**: tokens com os nomes e valores das variáveis do Figma, tema do Mantine,
  Manrope embutida, ícones SVG do próprio design e a marca nova como ícone do app no Windows (16 a
  256 px) e da página (R-02 a R-04).
- **Componentes únicos** em `renderer/src/ui/`, um por componente do design, com variantes fechadas
  (botões só nas 6 variantes da hierarquia) e uma regra de lint que impede as telas de usar os
  componentes visuais do Mantine direto (R-05, R-06; [contracts/ui-components.md](./contracts/ui-components.md)).
- **Responsividade pelo espaço do conteúdo** (`@container`), só com CSS, para nada se perder ao
  redimensionar; menu só com ícones abaixo de 1 180 px (R-07).
- **Filtros rápidos com contagem e ordem por hotel e check-in**: grupos definidos no domínio
  (`quickFiltersOf`), parâmetros `quickFilter` e `order` e rota `GET /reservations/quick-filter-counts`
  — contrato 1.7.0 → 1.8.0, só acréscimos (R-09, R-18;
  [contracts/api-changes.md](./contracts/api-changes.md)).
- **Telas por prioridade**: Reservas, Execuções e Executar, Comercial e envio, Configuração e
  estados, adaptando os testes que já existem e somando os de larguras, redimensionamento, uma
  ação principal por bloco e contraste (R-16).
- **Conferência com o design** pelos prints do `screens-capture` (já em 1 440 px). O agente não
  redesenha telas no Figma: monta só a tela de exemplo do envio em andamento (7.7a) para a UX aprovar
  e, ao concluir, marca as telas em uso com ✅ e as substituídas com ❌ pela skill
  `figma-screens-sync`, reescrita para isso (R-13, R-17).

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`); Electron 45 e React 19 no app; Node 24 no servidor
(sem mudança de versão)

**Primary Dependencies**: app — `@fontsource-variable/manrope` 5.3.0 (nova, OFL-1.1, R-03). Já
existentes: Mantine 9 (`core`, `dates`, `hooks`), TanStack Query, electron-vite. Nenhuma biblioteca
de ícones (R-04). Servidor — nenhuma nova

**Storage**: N/A — nenhuma mudança no PostgreSQL ([data-model.md](./data-model.md))

**Testing**: Vitest nos grupos existentes — `domain`, `contracts`, `server-db`, `desktop`,
`desktop-ui`, `desktop-e2e` (roteiros novos de larguras e de redimensionamento) (R-16)

**Target Platform**: app Windows 10/11 x64, janela de 960 × 640 até monitores grandes, com e sem
escala de tela; servidor Linux em container (só a rota nova)

**Project Type**: desktop-app (apresentação) + acréscimo compatível no web-service

**Performance Goals**: contagens dos filtros rápidos em até 1 s com 20 000 reservas (R-16);
redimensionar sem recarregar dados (FR-048); lista de 50 linhas por página como hoje

**Constraints**: nenhuma mudança de regra de negócio, permissão ou fluxo (FR-031); API só com
acréscimos e o app 0.2 funcionando contra a 1.8.0 (ordem padrão mantida); fonte e ícones sem
internet (FR-004); política de conteúdo do renderer sem mudança (`font-src 'self'` e `img-src 'self'`
já bastam); contraste 4,5:1, com as três exceções do design que vão para uma próxima spec (SC-005);
nenhum dado real nos prints e no Figma (AGENTS.md)

**Scale/Scope**: 45 telas do design em 5 áreas, cerca de 30 componentes novos em `ui/`, ~35
arquivos de tela e componente alterados, 1 rota e 2 parâmetros novos na API, ícone do app, 4
usuárias

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec 006 escrita, clarificada e revisada para o plano (2026-11-18). As decisões tomadas no plano que mudam o comportamento (ordem por hotel e check-in, ícone do app, exceções de contraste, card do envio em andamento, marcação no Figma) foram registradas antes na spec (clarificações "Session 2026-11-18 (plano)"); o único ponto aberto (UX-3) tem escolha provisória registrada | ✅ |
| II | Isolamento do Hunit | A feature não toca a camada do Hunit nem o `read-only-guard`; a rota nova só lê o banco | ✅ |
| III | API-First com Contrato | As contagens e o filtro rápido entram antes no `openapi.yaml` 1.8.0, só com acréscimos; nenhum enum existente ganha valores (teste da 005). O app só apresenta: a regra dos grupos fica no domínio e no servidor, não no renderer (R-09) | ✅ |
| IV | Jobs Assíncronos com Intervenção Humana | Não muda execuções nem envios; só a apresentação do andamento e do token | ✅ |
| V | Servidor Central e Containers | Nenhum serviço, variável ou volume novo | ✅ |
| VI | Dados e Segurança | Nenhum dado novo sai do servidor; a política de conteúdo do renderer não abre rede (fonte, ícones e favicon embutidos, R-03, R-04); prints, tela de exemplo e Figma só com dados fictícios | ✅ |
| VII | Testes em Camadas | `quickFiltersOf` com testes unitários; rota nova com teste de contrato; paridade SQL × domínio em `server-db`; telas com `desktop-ui` e jornadas com `desktop-e2e` (R-16) | ✅ |
| VIII | Simplicidade | Uma dependência nova (a fonte). Os componentes de `ui/` são exigidos pela spec (FR-030) e ficam dentro do app, sem pacote novo. Nenhuma biblioteca de ícones, de CSS ou de estado; o ícone do app é gerado com o Chromium do Playwright que o projeto já tem. A skill do Figma ficou menor (só marca) | ✅ |

**Resultado pré-Fase 0**: aprovado.

**Resultado pós-Fase 1** (após data-model e contratos): aprovado. As únicas mudanças fora do app são
uma leitura nova do banco com filtros que já existem e uma ordem opcional que usa um índice existente;
a regra dos grupos está no domínio com teste de paridade no servidor. A apresentação continua sem
regra de negócio.

## Project Structure

### Documentation (this feature)

```text
specs/006-redesign-app-desktop/
├── spec.md              # especificação (/speckit-specify + clarificações)
├── plan.md              # este arquivo
├── research.md          # decisões técnicas e pontos para a UX (Fase 0)
├── data-model.md        # grupos dos filtros rápidos e estado das telas (Fase 1)
├── quickstart.md        # testes, conferência com o design, cenários e homologação (Fase 1)
├── contracts/
│   ├── api-changes.md   # acréscimos à API 1.7.0 → 1.8.0 (Fase 1)
│   ├── ipc.md           # acréscimos à ponte do app (Fase 1)
│   ├── ui-components.md # componentes únicos e regras de uso (Fase 1)
│   ├── screens.md       # as 45 telas do design, com node do Figma, história e código (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.8.0 (criado na implementação)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
packages/domain/src/
├── quick-filters.ts                # NOVO — QUICK_FILTERS e quickFiltersOf (data-model §1)
└── index.ts
packages/domain/test/quick-filters.test.ts

packages/contracts/openapi.yaml     # 1.8.0: ReservationQuickFilter, ReservationOrder, quickFilter, order, /reservations/quick-filter-counts
packages/contracts/src/generated.ts # regenerado

apps/server/src/
├── persistence/reservations-repo.ts  # quickFilterCondition(grupo); countQuickFilters (uma consulta); ordem e cursor hotel_check_in
└── http/handlers/reservations.ts     # parâmetro quickFilter; rota de contagens
apps/server/test/
├── contract/                         # rota e parâmetro 1.8.0
└── integration/                      # paridade e desempenho das contagens; paginação na ordem hotel_check_in (server-db)

apps/desktop/
├── package.json                      # @fontsource-variable/manrope
├── eslint (config da raiz)           # no-restricted-imports do @mantine/core fora de ui/ (R-05)
├── resources/brand.svg               # NOVO — marca exportada do Figma (24:70)
├── resources/icon.ico, icon.png      # regenerados da marca: .ico com 16 a 256 px (R-04)
├── scripts/generate-icon.mjs         # gera os ícones a partir do brand.svg (Chromium do Playwright)
└── src/
    ├── shared/ipc-types.ts, ipc-schemas.ts, ipc-channels.ts   # contracts/ipc.md
    ├── main/api-client.ts, ipc-handlers.ts                    # contagens; quickFilter e order
    ├── main/window.ts                                         # ícone da janela em desenvolvimento
    ├── preload/index.ts                                       # reservations.quickFilterCounts
    └── renderer/
        ├── index.html                # favicon com a marca
        └── src/
            ├── main.tsx                  # tema novo, fonte, global.css
            ├── App.tsx                   # AppHeader, SideMenu, área de conteúdo como container
            ├── ui/                       # NOVO — tokens, tema, ícones e componentes (contracts/ui-components.md)
            ├── components/               # TwoFactorDialog, ConnectionBanner, DocumentPreview, EvidenceList… sobre ui/
            ├── presentation/labels.ts    # rótulos do design; tons dos selos
            ├── screens/reservations/     # lista, barra de busca, painel, filtros rápidos, lote, gaveta
            ├── screens/executions/       # card escuro, Histórico, gaveta
            ├── screens/run/              # Executar
            ├── screens/commercial/       # abas e listas
            ├── screens/dispatch/         # envio
            └── screens/setup/            # Configuração
apps/desktop/test/
├── renderer/                         # testes adaptados + novos (filtros rápidos, busca, vazio, hierarquia, contraste)
├── main/                             # canal novo
├── main/icon.test.ts                 # .ico com os 7 tamanhos, png de 256 px
└── e2e/                              # screens-capture com 4.12 e larguras; responsive.test.ts; resize.test.ts

.claude/skills/figma-screens-sync/    # reescrita no plano: só marca ✅/❌ (mark-screens.js); catálogo com "Ativa em" (R-17)
AGENTS.md                             # "Telas no Figma" (atualizado no plano); contrato 1.8.0, cópia em specs/006, ui/ e a regra de lint, feature 006
```

**Structure Decision**: nenhum pacote ou app novo. O app ganha a pasta `renderer/src/ui/` (tokens,
tema, ícones e componentes únicos) e as telas passam a usá-la. A regra dos filtros rápidos fica em
`packages/domain`; o servidor ganha só uma condição e uma contagem no repositório de reservas.

## Fluxos de referência

### Lista de reservas

```text
Barra (busca 400 ms, Origem, Filtros)   Filtro rápido (chip)        API 1.8.0
──────────────────────────────────────  ─────────────────────       ─────────────────────────────
filtros ──────────────────────────────────────────────────────────► GET /reservations/quick-filter-counts
                                         chips com contagem ◄─────── { all, pendingCharge, … }
filtros + quickFilter + order=hotel_check_in ─────────────────────► GET /reservations (cursor, 50)
                                         linhas + "Mostrando X de all" + "Carregar mais"
tratativa, envio, confirmação, servidor de volta ──► invalida lista e contagens
```

### Construção de uma tela

```text
Figma (node da tela, contracts/screens.md) ─► get_screenshot + get_design_context
  └─► adaptar com os componentes de ui/ (nunca copiar o código gerado)
      └─► testes desktop-ui da tela (papéis e nomes acessíveis)
          └─► screens-capture 1 440 px ─► comparação lado a lado ─► research "Comparação com o design"
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Mexer nas telas da UX no Figma | Perda de trabalho da UX | A skill só renomeia e oculta frames, simula antes e aplica com o ok do usuário; a tela de exemplo fica numa seção própria (R-13, R-17) |
| Cores do design abaixo de 4,5:1 (texto apagado, placeholder, selo "Verificar") | Leitura mais difícil para algumas pessoas | Exceções explícitas no SC-005 e no teste de contraste; ajuste numa próxima spec com a UX (UX-1) |
| Card do envio em andamento sem desenho | Retrabalho | Tela de exemplo 7.7a, aprovada pela UX em 2026-11-18, antes da implementação (R-13) |
| Ícone antigo no atalho depois de atualizar | Usuária não vê a marca nova | Cache de ícones do Windows; o instalador recria o atalho (quickstart, cenário 17) |
| Reescrever 35 telas e componentes quebra jornadas | Regressão (SC-002) | Os testes `desktop-ui` e `desktop-e2e` existentes rodam a cada tela; seletores por papel e nome acessível |
| Contagens lentas com muitas reservas | Filtros rápidos demoram | Uma consulta só com `count(*) filter`; teste de desempenho com 20 000 reservas (R-16) |
| App novo contra servidor ainda na 1.7.0 | Contagens falham | Ordem de implantação: servidor antes do app (quickstart §5); falha das contagens não esconde a lista |
| Quebras responsivas decididas sem desenho da UX | Retrabalho | Prints em 960 e 1 280 px para revisão da UX (UX-5) |
| "Ativa ou cancelada" sem "Não identificada" no design | Filtro a menos ou tela diferente do Figma | Quarta opção provisória até a resposta (UX-3) |
| 004 e 005 deixaram telas com componentes Mantine direto | Visual misturado | Lint da R-05 falha em qualquer tela que ainda use componente visual do Mantine |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
