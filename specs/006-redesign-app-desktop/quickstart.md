# Quickstart: validar o redesign do app desktop

Como provar que a feature funciona: testes automáticos, conferência com o design e homologação.
Comandos e pré-requisitos gerais no [AGENTS.md](../../AGENTS.md) (Docker em execução, Chromium do
Playwright instalado, `ELECTRON_RUN_AS_NODE` fora do terminal).

## 1. Testes automáticos

```powershell
pnpm install
pnpm build
pnpm lint          # inclui a regra dos componentes únicos (research R-05) e o contrato 1.8.0
pnpm typecheck
pnpm test --project domain        # quickFiltersOf
pnpm test --project contracts     # quickFilter e /reservations/quick-filter-counts
pnpm test --project server-db     # paridade contagens × lista × domínio; desempenho com 20 000; ordem hotel_check_in
pnpm test --project desktop       # canal reservations:quickFilterCounts
pnpm test --project desktop-ui    # telas, uma ação principal por bloco, contraste
pnpm test --project desktop-e2e   # jornadas da 002 a 005 (SC-002), larguras e redimensionamento
```

Esperado: tudo verde. Os roteiros `desktop-e2e` que já existiam continuam passando com as mesmas
jornadas e o mesmo resultado (SC-002).

## 2. Conferir com o design (SC-001)

```powershell
$env:HUNIT_SCREENS_DIR = "C:\temp\telas-006"
pnpm test --project desktop-e2e screens-capture
```

Para cada print (1 440 × 900, números 1.1 a 7.14 de [contracts/screens.md](./contracts/screens.md)),
abra o frame correspondente na página `006-redesign-app-desktop` do Figma e compare estrutura, cor,
rótulos e ícones. Registre as diferenças em `research.md` ("Comparação com o design"); a feature
termina sem diferenças pendentes, ou com cada uma aceita pela UX.

Repita a captura em 960 × 640 e 1 280 × 820 (variável `HUNIT_SCREENS_WIDTH`, acrescentada ao roteiro)
para registrar como as telas ficaram nas larguras menores (research, UX-5; ajustes numa feature
seguinte).

Antes de implementar o card do envio em andamento, a tela de exemplo 7.7a fica pronta no Figma e
aprovada pela UX ([contracts/screens.md](./contracts/screens.md), "Tela para aprovação").

Ao concluir a feature, sem diferenças pendentes: rode a skill `figma-screens-sync` (simulação, ok do
usuário, aplicação) para marcar as telas da 006 com ✅ e as das páginas 002 a 005 com ❌ (FR-032).

## 3. Cenários de aceite, à mão (app em desenvolvimento contra a homologação)

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --filter @hunit/desktop dev
```

| # | Cenário | Esperado | Spec |
|---|---|---|---|
| 1 | Abrir o app sem internet (cabo ou Wi-Fi desligado, servidor local) | Fonte Manrope e ícones aparecem | US1-5, FR-004 |
| 2 | Percorrer as áreas pelo menu | Item ativo em pílula preta com ícone lima; cabeçalho com a marca e o cliente no selo branco | US1, FR-002, FR-003 |
| 3 | Reservas: usar cada filtro rápido | Lista e contagens batem; "Validar comprovante" aparece em Falta cobrar e em A verificar | US2-3, FR-016, FR-017 |
| 4 | Digitar `380,00` na busca; depois `101-1000` | Primeiro filtra pelo valor; depois pelo número da reserva | R-10 |
| 5 | "Filtros" → escolher hotel e período | Lista, contagens e "Filtros aplicados" acompanham; Origem não se repete | US2-4, FR-034 |
| 6 | Busca sem resultado | Estado vazio com "Limpar busca e filtros", que volta à lista completa | US2-6, FR-021 |
| 7 | Clicar no meio de uma linha; marcar a caixa de outra | A primeira abre o detalhe em lima suave; a segunda só marca | US2-5, FR-018 |
| 8 | Marcar 3 reservas em pesquisas diferentes | Barra escura com o total; "Anexar comprovante" mostra aceitas (verde) e ignoradas (âmbar) | US4, FR-023, FR-024 |
| 9 | Abrir uma reserva com "Verificar" | Alerta com "Confirmar"; anexar desabilitado com o motivo; ao confirmar, libera | US5-5, FR-029 |
| 10 | Execuções com uma execução rodando | Card escuro no topo com progresso; as outras no "Histórico" | US6, FR-019 |
| 11 | Enviar ao Comercial a partir da seleção | Conferência, andamento, token no diálogo escuro e concluído, em no máximo 2 cliques a partir da seleção | US8, SC-010 |
| 12 | Janela em 960 px; redimensionar até 1 920 px com filtros, seleção, gaveta e texto no motivo da recusa | Sem rolagem horizontal, nada cortado; nada se perde | US9, SC-007, SC-008 |
| 13 | Perfil consulta | Listas, abas e retornos visíveis, sem ações de registro, envio, confirmação, recusa ou desfazer | Casos de borda |
| 14 | Servidor parado com a lista aberta | Aviso "dados de HH:MM — servidor indisponível" legível no novo cabeçalho | Casos de borda |
| 15 | Lista de reservas com vários hotéis e check-ins; "Carregar mais" | Ordenada por hotel e, dentro dele, por check-in; o rodapé diz "ordenadas por hotel e check-in"; a segunda página continua a ordem | FR-014, R-18 |
| 16 | Aba "Envios" com um envio em andamento | Card escuro com lima e progresso no topo, como aprovado pela UX na tela 7.7a | FR-039, R-13 |
| 17 | Instalar o app (seção 4) e olhar a barra de tarefas, o Menu Iniciar, a janela e o instalador | Marca nova (H lima no quadrado preto), nítida em 16 e 24 px; se o atalho mostrar o ícone antigo, é o cache do Windows (some ao reiniciar o Explorer) | FR-003, US1-6 |

## 4. Homologação

No ambiente de homologação (`deploy/homolog/`, quickstart §2.1 da 003), com dados fictícios: subir o
servidor com a API 1.8.0 (`pnpm build` e `docker compose --env-file .env.homolog up -d --build`),
gerar o instalador (`pnpm build` e `pnpm --filter @hunit/desktop dist`) e percorrer os cenários da
seção 3 com os dois perfis de acesso (operador e consulta). Registrar o resultado em `research.md`
("Homologação").

O app 0.2 já instalado continua funcionando contra a API 1.8.0 (só acréscimos): abrir uma vez antes
de instalar o novo para conferir.

## 5. Produção

Depois da homologação: atualizar o servidor de produção (API 1.8.0) **antes** de instalar o app
novo, que usa a rota de contagens. Instalar o app nas máquinas do Financeiro e da Controladoria.
