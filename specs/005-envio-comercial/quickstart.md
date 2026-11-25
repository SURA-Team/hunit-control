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
3. Salvar a chave, com o nome `commercial-sheet-key.json`, na pasta de `COMMERCIAL_SHEET_SECRETS_DIR`
   do `.env.homolog` (o modelo sugere `C:/hunit-homolog/secrets`, fora do repositório; também serve a
   `deploy/secrets` deste repositório, ignorada pelo Git, com `COMMERCIAL_SHEET_SECRETS_DIR=./deploy/secrets`
   — a pasta e a variável têm de bater) e preencher, juntas,
   `COMMERCIAL_SHEET_ID` e `COMMERCIAL_SHEET_KEY_FILE` no `.env.homolog` (modelo em
   `deploy/homolog/homolog.env.example`). Comandos com `docker compose --env-file .env.homolog …`, por
   exemplo `docker compose --env-file .env.homolog exec server node dist/cli.js commercial-sheet setup`.
4. Rodar `commercial-sheet setup` e depois `commercial-sheet check` ([contracts/cli.md](./contracts/cli.md)):
   esperado "acesso OK" e "OK" nas duas abas, com a quantidade de linhas (o "OK" já confere o
   cabeçalho e as proteções; se algo estiver errado, o `check` diz o quê). Na planilha, a aparência de
   [sheet-layout.md](./contracts/sheet-layout.md) ("Aparência"): cabeçalho de A a J preto com letra
   lima e de K a N lima com letra preta, sem bordas; linhas de dados com listras e bordas
   tracejadas; coluna J em lima ("Aguardando retorno do Comercial"), laranja ("Aguardando validação
   do Financeiro") ou vermelho (recusa e retorno com problema). Uma linha que entra depois do
   `setup` já chega com as bordas.
5. Compartilhar a planilha como editor com uma segunda conta Google (fazendo o papel do Comercial) e
   conferir, com ela, que as colunas A:J de "A cobrar" e a aba "Concluídas" não aceitam edição.
6. Gravar o envio fictício. A homologação não acessa o Hunit (endereço inválido de propósito), então
   o "Enviar ao Comercial" do app falha no acesso e nada chega à planilha. O script abaixo grava, no
   banco já preparado pelo `homolog-prepare` da 003, o resultado de um envio: por hotel, 12 reservas em
   "A cobrar" e 3 que o Hunit "mostrou como cobradas" depois (em "Concluídas", com o alerta
   "Verificar"). Recusa banco que não seja o da homologação ou que já tenha linhas da planilha. Com o
   servidor da homologação no ar e a planilha configurada, as linhas aparecem na planilha em até 30 s,
   e `C:\hunit-homolog\arquivos\envios.txt` lista os hotéis e números enviados.
   ```powershell
   $pw = (Select-String -Path .env.homolog -Pattern '^POSTGRES_PASSWORD=(.+)$').Matches[0].Groups[1].Value
   $env:HUNIT_HOMOLOG_DATABASE_URL = "postgres://hunit:$pw@127.0.0.1:55432/hunit"
   $env:HUNIT_HOMOLOG_FILES_DIR = "C:\hunit-homolog\arquivos"
   $env:HUNIT_HOMOLOG_COMMERCIAL = "1"
   pnpm test --project desktop homolog-commercial   # deve dar "1 passed", não "skipped"
   ```
7. Com a segunda conta Google (o Comercial) e o app da homologação, repetir os cenários 6 a 11, 13
   (com o filtro "A verificar"), 14, 15 e 16 da tabela acima, com as reservas de `envios.txt`; o 10
   desligando a internet do PC por alguns minutos. O envio em si (cenários 1 a 5: token, verificação
   no Hunit, cancelar, retomar, conta ocupada) fica com os testes automáticos e o Hunit simulado
   (`dispatch-runner.test.ts` e `desktop-e2e`); contra o Hunit real, só com autorização do usuário
   (AGENTS.md) e reservas reais.
   Medir: SC-004 (retorno no app em até 15 min sozinho e em até 1 min com "Ler retornos agora") e
   SC-010. SC-002 (20 reservas na planilha em até 5 min depois do token) depende do Hunit: medir na
   primeira semana da produção.
8. Conferir nos logs do servidor (`docker compose logs server`) que não aparecem a chave, o e-mail da
   conta de serviço, o ID da planilha, credenciais do Hunit nem nomes de hóspede.

Opcional (research R-02): com o `hunit:reservations-check`, observar se o filtro "nº da reserva" da
listagem tem um parâmetro reconhecível; se sim, registrar no research e avaliar a otimização.

## 4. Produção

Mesmos passos 1 a 5 da homologação, com a planilha real do Comercial e o `.env` da produção
(`C:\Dev\producao\hunit-control`). O passo a passo entra no `README.md` na implementação ("Planilha do
Comercial"). Depois, compartilhar a planilha com as contas do Comercial no Google.
