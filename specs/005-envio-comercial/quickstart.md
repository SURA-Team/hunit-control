# Quickstart: validar o envio ao Comercial

Roteiro para provar que a feature funciona de ponta a ponta. Os detalhes estão no
[data-model.md](./data-model.md) e nos [contratos](./contracts/); este arquivo só diz o que rodar e o
que esperar.

## 1. Testes automatizados (sem Hunit e sem Google)

Pré-requisitos do `AGENTS.md`: Docker em execução e Chromium do Playwright instalado.

```powershell
pnpm install
pnpm build
pnpm typecheck; pnpm lint
pnpm test --project domain          # leitura do retorno, situação detalhada, valor cobrado, elegibilidade
pnpm test --project contracts       # 1.7.0; ReservationSituation e TreatmentEvent.type sem valores novos
pnpm test --project server          # adaptador do Sheets (HTTP falso), conversão de erros, segredos
pnpm test --project server-db       # envio, sincronizador, retornos, lotes, seleção, retenção, marcadores
pnpm test --project desktop         # área de transferência sem nome do hóspede
pnpm test --project desktop-ui      # telas novas e perfil consulta
pnpm test --project desktop-e2e     # envio com token contra o Hunit simulado e a planilha em memória
```

Esperado: tudo verde. Os testes de marcadores (SC-007, SC-009) gravam valores-marcador como nome do
hóspede e como chave da planilha e conferem que nenhum aparece na planilha em memória, nos logs, nas
respostas da API nem nas mensagens de erro.

## 2. Cenários de aceite com o Hunit simulado e a planilha em memória

Cobertos pelo `server-db` e pelo `desktop-e2e`; servem também de roteiro manual no app com o servidor
de desenvolvimento.

| # | Cenário (spec) | Esperado |
|---|---|---|
| 1 | US1 — 10 reservas, 2 "já cobradas" no Hunit, 1 não encontrada | 7 em "A cobrar" e "Tratativa enviada"; 2 retiradas com "Já cobrada"; 1 não verificada |
| 2 | US1 #6 — reenviar 3 das 7 | 7 linhas, nenhuma duplicada; retorno mantido; evento `dispatched` novo |
| 3 | US1 #2 — token não informado | envio `failed` com `two_factor_timeout`; nenhuma reserva enviada |
| 4 | US1 #7/#8 — cancelar no meio e retomar | processadas ficam; restantes `not_verified`; a retomada faz novo login e só processa essas |
| 5 | Conta ocupada | com uma execução ativa na mesma conta, o envio é recusado com `account_busy` (e vice-versa) |
| 6 | US2 — retorno completo, sem valor, valor ilegível | só o completo vira "Validar comprovante"; os outros aparecem em "Retornos com problema" e na coluna J |
| 7 | US2 #4 e #5 — confirmar e recusar | confirmado: "Comprovante enviado", valor com origem "Comercial", linha em "Concluídas"; recusado: "Tratativa enviada" e "Recusado pelo Financeiro: …" na coluna J |
| 8 | US2 #6 — Comercial corrige depois da recusa | retorno novo, "Validar comprovante", recusa sai da linha |
| 9 | US2 #9 — confirmar 20 em lote | lista de revisão; 20 "Comprovante enviado"; as sem retorno ficam de fora com o motivo |
| 10 | US3 #3 — planilha indisponível | envio e validação gravados; `GET /commercial-sheet` mostra pendências e falha; ao voltar, pendências aplicadas sozinhas |
| 11 | Desfazer o envio | linha em "Concluídas" com "Pedido cancelado pelo Financeiro"; reverter em 30 dias a devolve para "A cobrar" |
| 12 | Linha apagada e célula do sistema alterada na planilha | reconstruídas na rodada seguinte e relatadas |
| 13 | US3 #6/#7 — "Selecionar todas do filtro" com 5 000 "A verificar" e confirmar em lote | 2 000 selecionadas e aviso de 3 000 de fora; após confirmar, a próxima seleção traz as 2 000 seguintes |
| 14 | US4 — valor cobrado na lista | origem "Hunit", "manual" ou "Comercial"; vazio quando não há |
| 15 | US5 — copiar para e-mail (30 reservas em 2 páginas) | colar no Outlook mostra a tabela com 30 linhas, total, filtros e momento; sem nome do hóspede; nada muda nas reservas |
| 16 | Perfil consulta | vê envios, retornos, problemas e pendências; nenhuma ação aceita (403) nem oferecida |

## 3. Homologação com uma planilha de teste (dados fictícios)

No ambiente de homologação (`deploy/homolog/`, quickstart §2.1 da 003), separado da produção:

1. Criar, numa conta Google de quem administra, uma planilha vazia "HUNIT Comercial — homologação".
2. Criar a conta de serviço e a chave JSON no Google Cloud (API do Google Sheets ativada) e
   compartilhar a planilha com o e-mail da conta de serviço como **editor**.
3. Salvar a chave em `deploy/secrets/` (ignorada pelo Git) e preencher `COMMERCIAL_SHEET_ID` e
   `COMMERCIAL_SHEET_KEY_FILE` no `.env.homolog`.
4. Rodar `commercial-sheet setup` e depois `commercial-sheet check` ([contracts/cli.md](./contracts/cli.md)):
   esperado "acesso OK", as duas abas, os cabeçalhos e as proteções.
5. Compartilhar a planilha como editor com uma segunda conta Google (fazendo o papel do Comercial) e
   conferir, com ela, que as colunas A:J de "A cobrar" e a aba "Concluídas" não aceitam edição.
6. No app da homologação, repetir os cenários 1, 6, 7, 8, 10 (desligando a internet do PC por alguns
   minutos) e 11 com reservas fictícias. A verificação no Hunit real só com autorização do usuário
   (AGENTS.md): sem ela, usar o Hunit simulado.
7. Medir: SC-002 (20 reservas na planilha em até 5 min depois do token), SC-004 (retorno no app em até
   15 min sozinho e em até 1 min com "Ler retornos agora") e SC-010.
8. Conferir nos logs do servidor (`docker compose logs server`) que não aparecem a chave, o e-mail da
   conta de serviço, o ID da planilha, credenciais do Hunit nem nomes de hóspede.

Opcional (research R-02): com o `hunit:reservations-check`, observar se o filtro "nº da reserva" da
listagem tem um parâmetro reconhecível; se sim, registrar no research e avaliar a otimização.

## 4. Produção

Mesmos passos 1 a 5 da homologação, com a planilha real do Comercial e o `.env` da produção
(`C:\Dev\producao\hunit-control`). O passo a passo entra no `README.md` na implementação ("Planilha do
Comercial"). Depois, compartilhar a planilha com as contas do Comercial no Google.
