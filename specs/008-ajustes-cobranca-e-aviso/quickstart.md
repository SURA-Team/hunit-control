# Quickstart: validar a 008

Roteiro para provar que a feature funciona de ponta a ponta. Detalhes das regras em
[data-model.md](./data-model.md) e dos contratos em [contracts/](./contracts/). Dados sempre
fictícios (homologação e prints).

## 1. Testes automáticos

Pré-requisitos do `AGENTS.md` (Node 24, pnpm, Docker em execução, Chromium do Playwright).

```powershell
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Esperado: tudo verde. Grupos que cobrem a 008 (research R-12): `domain` (leitura do retorno com
situação e data, classificação efetiva, fila), `contracts` (1.9.0), `server` (enums congelados),
`server-db` (migration, paridade, rotas novas, confirmação com data de hoje, `setup` com O e P),
`server-browser` (verificação da fila com o Hunit simulado), `desktop` (volume, notificação sem som,
AUMID e ícone por modo), `desktop-ui` (telas e seletores pelo teclado) e `desktop-e2e` (jornadas da fila
e da marcação, larguras e redimensionamento).

Prints para comparar com o design (PowerShell, pasta fora do repositório):

```powershell
$env:HUNIT_SCREENS_DIR = "C:\prints-008"; pnpm test --project desktop-e2e screens-capture
```

Conferir 1.1, 1.2, 1.3, 7.5, 7.7, 7.8, 7.12, 7.15, 7.17 e 7.18 ao lado dos frames da página
`008-ajustes-cobranca-e-aviso` e registrar em `research.md` ("Comparação com o design").

## 2. Homologação

Ambiente padrão do `README.md` ("Homologação": atualizar para uma feature), com a planilha de teste do
Comercial. Depois de subir o servidor da 008, **rodar o `commercial-sheet setup` da homologação** (as
colunas O e P) e instalar o app 0.4 gerado pelo `dist`.

## 3. Cenários

| # | Cenário | Esperado |
|---|---|---|
| 3.1 | Configuração com o som ligado: mexer no volume e soltar | Toca uma amostra no volume escolhido; reabrir o app mantém chave e volume (US1-6, FR-005) |
| 3.2 | "Testar aviso" com o som ligado, volume baixo | Notificação do Windows **sem som** e um único som, baixo (US1-3, SC-001) |
| 3.3 | Desligar "Tocar som do aviso" e "Testar aviso" | Volume desabilitado; nenhum som; a notificação aparece (US1-2) |
| 3.4 | Máquina que tinha o som desligado na 0.3, atualizada para 0.4 | Continua desligado; volume em 100 % (US1-5) |
| 3.5 | Card "Preferências" | Sem chave de som (US1-4, tela 1.3) |
| 3.6 | Na planilha: retorno completo com "Cobrada na maquininha" e data de hoje; "Ler agora" | Em "Retornos a validar", com "Cobrada na maquininha em <hoje> (hoje)"; gaveta e lote mostram situação e data; **Confirmar aceita** (US2, FR-011) |
| 3.7 | Retorno completo sem situação e sem data; depois, "Cobrada na maquininha" sem data | Os dois em "Retornos com problema" ("faltam a situação da cobrança e a data da cobrança"; depois "falta a data da cobrança"), sem aparecer para validar (US2-6, FR-007b) |
| 3.8 | Situação digitada "Cancelada na Expedia", com o resto vazio | Em "Retornos a validar", no topo, com o selo "Cancelada" e o texto como veio; coluna J "Cancelada: aguardando validação do Financeiro" (US2-1a, FR-007c) |
| 3.9 | "Cancelada" (só a situação) → "Confirmar" na linha (ou "Confirmar cancelamento" na gaveta) | A reserva fica "Cancelada sem cobrança" (R$ 0,00, "Concluídas"), sai de "Retornos a validar" e a linha da planilha vai para "Concluídas"; "Desfazer" no detalhe devolve a "Cancelada" para validar (FR-007c, FR-020) |
| 3.9a | Outra "Cancelada" → "Recusar" com motivo | Sai de "Retornos a validar"; coluna J "Recusado pelo Financeiro: <motivo>"; o Comercial muda a linha → volta para validar |
| 3.9b | "Cancelada" e um retorno marcados juntos → "Confirmar ▾" → "Confirmar retornos" | O diálogo mostra a "Cancelada" com o selo; confirmar marca a reserva e confirma o retorno (US2-7) |
| 3.10 | "Cobrada no Hunit" + responsável em três reservas | Aba "Cobradas no Hunit (3)", todas "Aguardando verificação"; coluna J "Aguardando verificação no Hunit" (US3-1, US3-2) |
| 3.11 | **Só nos testes automáticos** (na homologação o acesso ao Hunit é bloqueado; jornada `hunit-charges.test.ts`). "Verificar agora" (Hunit simulado: uma cobrada, uma não) | Pede o token como o envio; card de andamento; ao terminar, "Confirmada no Hunit — foi para Concluídas" e "Não encontrada no Hunit — continua pendente"; a confirmada vai para "Concluídas" na planilha; a não encontrada fica com a J "Recusado pelo Financeiro: cobrança não encontrada no Hunit" (US3-4 a US3-6) |
| 3.11a | **Só nos testes automáticos** (`dispatch-runner.test.ts`). Relato "Cobrada no Hunit" de uma reserva que o Hunit passa a mostrar como cancelada sem cobrança (Hunit simulado) | Depois da leitura: "Não encontrada no Hunit" com a situação do Hunit na segunda linha; J com a mesma recusa; a reserva em "Concluídas" pela situação do Hunit; o próximo "Verificar agora" não a confere de novo, e ela sai da fila 7 dias depois (US3-6a, FR-013, FR-014) |
| 3.12 | **Só nos testes automáticos** (`commercial-reports.test.ts`). Execução que lê uma reserva da fila | A situação na fila é atualizada pela execução (US3-4a) |
| 3.13 | "Verificar agora" com o Hunit fora do ar | Mensagem clara; situações como estavam (FR-016) |
| 3.14 | Comercial troca "Cobrada no Hunit" por outra situação | Sai da fila na rodada seguinte (FR-012) |
| 3.15 | Perfil consulta na fila e no detalhe marcado | Vê situações, selo e histórico; sem "Verificar agora", sem marcar e sem "Desfazer" (US3-7, US4-8) |
| 3.16 | Reserva enviada, sem retorno: "Marcar como cancelada sem cobrança" com observação | Diálogo com R$ 655,00 → R$ 0,00 e "Concluídas"; "Voltar" não grava; confirmar: selo, R$ 0,00, quem e quando, observação, histórico; contagens de "Falta cobrar" e "Concluídas" mudam; linha da planilha vai para "Concluídas" com E = R$ 0,00 (US4, tela 7.18) |
| 3.17 | "Desfazer" na reserva marcada | Valor, situação, contagens e a linha "A cobrar" voltam; histórico registra (US4-7) |
| 3.18 | Duas janelas: marcar na primeira com a segunda aberta e depois marcar na segunda | A segunda avisa que a situação mudou e não aplica (edge case) |
| 3.19 | Abrir uma reserva que está em "Retornos a validar" com retorno de cobrança (como a do 3.6, antes de confirmar) | O card "Reserva cancelada sem nada a cobrar?" aparece com "Marcar como cancelada sem cobrança" **desabilitado** e o texto "Há retorno do Comercial aguardando validação: confirme ou recuse o retorno antes." (FR-022) |
| 3.20 | Filtros de Reservas: escolher cada seletor só pelo teclado | Digitar filtra (sem acento), setas e Enter escolhem, Esc fecha; texto sem opção mostra "Nenhuma opção encontrada" (US6-5, US6-6, SC-010) |
| 3.21 | Telas novas em 960, 1 280 e 1 920 px e zoom de 125 % | Mesma informação e ações, sem rolagem horizontal (FR-025) |
| 3.22 | Confirmar um retorno com o código "AUT-TESTE-1" e buscar "aut-teste-1" em Reservas | A reserva aparece; a contagem dos filtros rápidos e "selecionar todas do filtro" também a trazem (US7-1, US7-2) |
| 3.23 | Buscar o código de um retorno aguardando validação; depois desfazer a confirmação do 3.22 e buscar de novo | Nos dois casos a reserva não aparece por esse código (US7-3, US7-4) |
| 3.24 | Buscar uma reserva só, selecioná-la e passar o mouse sobre ela; repetir em "Retornos a validar" com um retorno só | O lima e o cinza ficam dentro do card, acompanhando os cantos arredondados (US6-7, FR-030) |

## 4. Ícone na barra de tarefas (US6, research R-10)

Numa máquina que já teve o 0.3 instalado **e** rodou o app em desenvolvimento ou os testes:

1. Instalar o 0.4 por cima. Abrir pelo Menu Iniciar.
2. Conferir a marca na barra de tarefas com a janela aberta; "Testar aviso" e conferir o botão
   piscando com a marca.
3. Fixar na barra de tarefas, fechar, abrir pelo atalho fixado: marca, e a janela agrupa no mesmo
   botão.
4. Rodar `pnpm --filter @hunit/desktop dev` (sem `ELECTRON_RUN_AS_NODE`) e depois abrir o instalado de
   novo: o instalado continua com a marca (US6-4).

Se algum passo mostrar o ícone do Electron, registrar em `research.md` e testar com o cache de ícones
limpo (`ie4uinit.exe -show`) antes de concluir.

## 5. Figma

Depois da comparação com o design: skill `figma-screens-sync` com
`FEATURE = '008-ajustes-cobranca-e-aviso'` — simulação, relatório ao usuário e, com o ok dele,
aplicação (research R-14).

## 6. Produção

Pelo passo 9 do `README.md` ("Atualizar para uma versão nova"), nesta ordem:

1. Servidor na 1.9.0 (com a migration da 008).
2. `docker compose exec server node dist/cli.js commercial-sheet setup` — sem ele, a planilha fica
   "Formato alterado" e nada é escrito; o `check` confirma.
3. Instalador 0.4 nas máquinas do Financeiro e da Controladoria.
4. Avisar o Comercial das colunas "Situação da cobrança" e "Data da cobrança", **obrigatórias**
   (homologação, R-19): os retornos que já aguardavam validação passam a "Retornos com problema" até
   ele preencher a situação e a data; "Cancelada" basta para reserva cancelada.

Registrar o resultado em `research.md` ("Produção").
