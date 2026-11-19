# Componentes únicos do app (FR-030)

Cada componente do design (`Componentes — nova identidade`, frame `135:1361`) tem **um** componente
em `apps/desktop/src/renderer/src/ui/`. As telas montam a interface só com eles e com o layout
neutro do Mantine (`Stack`, `Group`, `Text`, `SimpleGrid`, `Box`); o ESLint barra nas telas os
componentes visuais do `@mantine/core` (research R-05).

Cores, raios, sombras e tipografia vêm só de `ui/tokens.ts` (research R-02), nunca de valores
escritos nas telas.

## Fundação

| Arquivo | O que é | Origem no design |
|---|---|---|
| `ui/tokens.ts` | Cores, sombras, raios, espaçamentos e estilos de texto, com os nomes das variáveis do Figma | Variáveis da coleção "Cores do app" (modo "Nova identidade") e estilos "Nova identidade/…" |
| `ui/theme.ts` | `createTheme` do Mantine a partir dos tokens (fonte, `primaryColor`, raios, paletas) | — |
| `ui/global.css` | Variáveis `--hc-*`, fundo do app, fonte | — |
| `ui/icons/*.tsx` | Ícones SVG (traço 1,8 px, `currentColor`) e a marca do cabeçalho | "Marca e ícones" (`135:1368`) e os ícones das telas |
| `resources/brand.svg` → `icon.ico`, `icon.png` | Ícone do app no Windows (16 a 256 px) e da página, gerados do SVG da marca (research R-04) | "Marca/Ícone — nova identidade" (`24:70`) |
| `ui/Surface.tsx` | Contexto de superfície clara ou escura (o principal vira lima no escuro) | Regra de hierarquia (`135:1379`) |

## Ações

| Componente | Variantes e regras | Origem |
|---|---|---|
| `Action` (botão) | `variant`: `primary` · `secondary` · `text` · `warning` · `danger-light` · `danger`; `size`: `xs` · `sm` (36 px: rodapé de diálogos e gavetas, como nas telas) · `md` · `lg`; `primary` vira lima em `Surface dark`. Nenhuma outra cor | "Botão" `21:75` (Preenchido, Contorno, Desabilitado, Perigo leve, Perigo, Destaque, Texto) |
| `DocumentAction` | `kind`: `download` · `revert` · `undo` · `remove`, cada um com cor e ícone fixos (FR-010) | "Ação de documento" `80:89` |
| `MenuButton` | Botão com menu (▾) para ações agrupadas: "Anexar ▾", "Confirmar ▾" | "Botão com menu" `182:1171` |
| `FilterChip` | Chip com rótulo e contagem; estados ativo (preto) e padrão; contagem abreviada com o número inteiro no `title` | "Chip de filtro" `53:58` |
| `FilterBar`, `FilterBarSearch`, `FilterPanel`, `FilterPanelWide` | A barra da lista (card de 12 px com busca, Origem e "Filtros", que quebra linha) e o painel "Filtros avançados": card flutuante à direita, abaixo da barra, campos em duas colunas (uma no conteúdo estreito), valendo na hora; fecha pelo X ("Fechar os filtros"), por Esc ou pelo botão; não fecha ao clicar fora (os seletores de dentro abrem listas fora dele). Não é diálogo: região "Filtros avançados" (T033) | Telas 4.1 e 4.12 |
| `AppliedFilters`, `RemovableChip` | A linha "Filtros aplicados": um chip por filtro do painel em vigor, com o X "Tirar o filtro …", e "Limpar busca e filtros"; só nomes cortam, com o texto inteiro na dica (T033) | R-11 (o design não desenha a linha) |

## Formulário

| Componente | Variantes e regras | Origem |
|---|---|---|
| `Field`, `SelectField`, `MultiSelectField`, `PasswordField`, `NumberField` | Fundo sutil, foco com contorno preto; rótulo e ajuda acima. Altura `size`: `sm` 36 px (padrão: é a das telas do design), `md` 40 px (barra de busca, como a biblioteca) e `lg` 50 px (token). `SelectField` aceita `inlineLabel` (rótulo à esquerda: "Origem") e `optionDescriptions` (segunda linha da opção: "Só ativas — Esconde as canceladas") | "Campo" `21:113` |
| `TextAreaField` | Texto longo com rótulo acima, o contador ("15/500") à direita na linha do rótulo, fora do nome do campo, e o erro ligado ao campo (T051) | Tela 7.6 |
| `SelectionBox` | Caixa de seleção: desmarcada, marcada (preta com check lima) e parcial | "Caixa de seleção" `76:71` |
| `CheckboxField`, `RadioField`, `SwitchField` | Com rótulo | "Checkbox" `21:195`, "Rádio" `21:145`, "Switch" `21:198` |
| `PeriodPicker` | Calendário de período: hoje com contorno, escolhido em preto, intervalo em lima suave, hoje escolhido em círculo lima | "Calendário" `135:1405` |

## Status e avisos

| Componente | Variantes e regras | Origem |
|---|---|---|
| `StatusBadge` | `tone`: `lime` (em andamento/destaque) · `amber` (atenção) · `green` (concluído) · `red` (erro) · `gray` (neutro/enviado) · `alert` (âmbar cheio, só para o que pede ação, como "Verificar"); sempre com texto (FR-006) | "Badge" `21:102` |
| `SituationBadges` | Pilha de selos da reserva: situação, "Verificar", "Sistema anterior", "Não identificada" (o "Selo extra" do design); um embaixo do outro, nunca cortados | "Linha de reserva" `53:93` |
| `Notice` | Alerta com tom `lime` · `green` · `red` · `amber`, ícone (num círculo cheio do tom, como o "!" do "Verificar") e ação opcionais; `block` faz dele um bloco à parte para a regra de uma principal por bloco | "Alerta" `21:163`; tela 4.9 |
| `BatchSummary`, `SummaryLine`, `ReasonList` | Resumo de ação em lote: linhas com o ícone num círculo do tom (`green` ✓ para as aceitas; `amber` ! para as ignoradas e o que pede atenção; `red` ! para as que falharam) e o texto com o grupo e a quantidade (FR-006, FR-024); a caixa cinza com cada reserva que fica de fora e o motivo (T042) | "Resumo do lote" da tela 4.6 (`88:3565`) |
| `ProgressBar` | Progresso da execução e do envio | "Progresso da execução" `26:1648` |
| `CountCard` | Card de contagem (âmbar, vermelho, verde) | "Card de contagem" `21:153` |
| `EmptyState` | Ícone, explicação e, com busca ou filtro em vigor, "Limpar busca e filtros" (FR-021) | Tela 4.3 |
| `StaleDataNotice` | "dados de HH:MM — servidor indisponível" na linha do título (`Notice compact`: só o texto, em negrito; `amarelo/9` em vez do `amarelo/8` do design, que fica abaixo de 4,5:1) | Tela 5.1 |
| `Countdown` | Contagem regressiva do token: rótulo à esquerda e o tempo no estilo "Cronômetro" (lima no escuro, vermelho no fim) | Tela 2.4 |
| `CodeText` | Código em fonte monoespaçada (impressão digital do certificado) | Tela 1.2 |

## Navegação e estrutura

| Componente | Variantes e regras | Origem |
|---|---|---|
| `AppHeader` | Transparente, 56 px; marca à esquerda; cliente e perfil num selo branco (operador, consulta, sem conexão) | "Cabeçalho do app" `21:202` |
| `SideMenu`, `SideMenuItem` | Card flutuante; item ativo em pílula preta com ícone lima; abaixo de 1 180 px só ícones, com `aria-label` e dica (research R-07) | "Menu/Item" `21:140` |
| `Tabs` | Abas da área Comercial com contagem; quebram linha quando não cabem | "Aba" `182:1232` |
| `PageHeader` | Título da página (34 px), subtítulo opcional e ação à direita ("Copiar para e-mail") | Telas 4.1, 7.7 |
| `SectionTitle` | Título de seção dentro do conteúdo ("Histórico"), estilo "Título da seção" | Telas 3.1, 7.7 |
| `Card` | Branco, cantos de 20 px, sombra "card", sem borda; `padding` 0 (listas), 12 (barra de busca), 16 (formulários e gaveta) ou 24; `tone="subtle"` é a caixa cinza sem sombra ("Status do Hunit") | "Cards e relatórios" `135:1466` |
| `RunningJobCard` | Card escuro do que está em andamento: a execução (data, período, cliente, "N de M hotéis concluídos", progresso, %, "Ver detalhes" em lima) e o envio ao Comercial na aba "Envios" ("N de M reservas verificadas", "Ver envio"; research R-13) | "Card — execução em andamento" `53:131`; envio: tela 7.7a (frame `211:9212`), aprovada pela UX em 2026-11-18 |
| `IndicatorCard` | Número grande com rótulo (FR-004, US1-3) | "Card de indicador" `91:73` |
| `AppDialog` | `size`: `sm` (520 px) · `lg` (780 px); 24 px de espaçamento; título no estilo do design (e `subtitle`); `dark` para o token; limitado à área visível, rola por dentro, fechar sempre alcançável ("Fechar o diálogo", FR-042, FR-047); `onCancel`, `onSubmit` (formulário), `zIndex` e `instant` | Telas 2.4, 2.5, 2.9, 3.3, 4.6, 7.1, 7.6 |
| `DetailHeader` | Cabeçalho do detalhe numa gaveta: "Reserva N" (estilo "Título da seção"), a linha de apoio ("hotel 101") e os selos lado a lado à direita; quebra linha quando não cabe (T044) | Telas 4.2, 4.7, 4.9 |
| `DataGrid`, `DataField` | Dados em três colunas (rótulo "Descrição" apagado em cima, valor "Corpo" embaixo; 16 px entre colunas, 12 px entre linhas), duas abaixo de 520 px; valores longos quebram linha. Sem valor, "—" (T044) | "Dados da reserva", "Dados da cobrança" (tela 4.2) |
| `CardHeader`, `CardAside` | Título de card dentro da gaveta (estilo "Corpo forte": "Tratativa", "Cobrança", "Status do Hunit"), o que vai ao lado (selo ou texto apagado: "Sem tratativa") e as ações à direita (T044) | Tela 4.2 |
| `AppDrawer` | Gaveta à direita, `min(780px, 100vw − 96px)`, cards de 16 px; `closeLabel` dá o nome do fechar ("Fechar detalhe" na gaveta da reserva, o que os roteiros procuram) | Telas 3.2, 4.2, 7.5 |

## Listas

| Componente | Variantes e regras | Origem |
|---|---|---|
| `ListCard`, `ListHeader` | Card da lista com cabeçalho de colunas ("Tabela cabeçalho") | "Cabeçalho — lista de reservas" `53:94`, "… de execuções" `53:126` |
| `ReservationRow` | Colunas do design (research R-08); duas linhas por coluna; linha inteira clicável com seta; aberta ou marcada em lima suave; coluna Hotel some no conteúdo estreito | "Linha de reserva" `53:93` |
| `RowList` | Lista (`ul`) das linhas simples: `HotelRow`, `CompactReservationRow` | — |
| `CompactReservationRow` | Linha da seleção e dos diálogos de lote | "Linha de reserva compacta" `76:223` |
| `ExecutionRow` | Data e período; resultado; situação; seta | "Linha de execução" `53:125` |
| `HotelRow` | Nome, resumo e situação (FR-020); também para os documentos da reserva | "Linha de hotel" `55:2262` |
| `SelectionBar` | Barra escura: estado parcial, "N reservas selecionadas · total de R$ X", "Ver seleção", "Anexar ▾", "Confirmar ▾", "Enviar ao Comercial" (lima), "Desmarcar todas"; quebra linha quando não cabe | "Barra de seleção em lote" `76:117` |

## Regras de uso

- **Uma ação principal por bloco** (`data-block` no card ou no diálogo): no máximo um `Action`
  `primary` dentro de cada bloco; o teste da research R-06 confere.
- **Destrutivas**: "Limpar acesso", "Desfazer", "Remover valor" = `danger-light`; "Sim, cancelar" =
  `danger`.
- **Cancelar e Sair** = `text`; "Escolher outro arquivo" = `secondary` (FR-011).
- **"Substituir tratativa" e "Substituir comprovante"** = mesma variante (FR-012).
- **Não cortar**: valores em reais, selos e rótulos de ação têm `data-no-truncate`, que o teste de
  larguras usa (research R-16).
