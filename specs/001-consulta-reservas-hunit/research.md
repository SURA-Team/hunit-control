# Research: Consulta de Reservas de Cartão Virtual no Hunit

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-11

Cada item registra a decisão, a justificativa e as alternativas avaliadas. Itens marcados como
**Verificar no mapeamento** dependem da interface atual do Hunit e têm uma decisão padrão segura
até serem confirmados (ver R-13).

---

## R-01 — Runtime e organização do código

- **Decision**: Node.js 24 LTS, TypeScript 5.x em modo `strict`, monorepo com **pnpm workspaces**.
- **Rationale**: exigido pela constitution (TypeScript em todo o projeto, tipos compartilhados com o
  futuro Electron). pnpm é rápido, econômico em disco e tem suporte nativo a workspaces.
- **Alternatives considered**: npm workspaces (mais lento, hoisting menos previsível); Nx/Turborepo
  (orquestração desnecessária para 3 pacotes — princípio VIII).
- **Atualização 2026-11-11 (implementação da Fase 1)**: versões fixadas — pnpm 12.18 (campo
  `packageManager`) e TypeScript 5.9.3. O TypeScript 7 já é a versão "latest" no npm, mas o
  `typescript-eslint` só aceita até a 6.0 e o `openapi-typescript` só a 5.x; por isso o 5.x do
  plano continua valendo. Rever quando essas duas ferramentas aceitarem versões mais novas.
  Node.js 24 LTS é o mínimo para desenvolvimento (`.nvmrc`, `engines`); em produção vale o Node da
  imagem oficial do Playwright (ver R-18).
- **Política de dependências** (`pnpm-workspace.yaml`, princípio VI): `minimumReleaseAge` de 3 dias
  (versões recém-publicadas não são instaladas) e `allowBuilds` negando os scripts de instalação
  de `esbuild`, `ssh2`, `cpu-features` e `protobufjs` — todos vêm de ferramentas de desenvolvimento
  e funcionam sem o script.

## R-02 — API e automação no mesmo processo

- **Decision**: um único serviço `server` (um container) contém a API HTTP e o executor da
  automação (Playwright). O PostgreSQL roda em um segundo container.
- **Rationale**: FR-005 proíbe armazenar senha e token. Com API e worker em processos separados,
  credenciais e token teriam de passar por fila/banco/rede interna. No mesmo processo, eles ficam
  apenas em memória, do request HTTP até o navegador. Como só há uma execução ativa por conta
  (FR-006), não há ganho em escalar workers separadamente. Se o servidor reiniciar, a execução fica
  interrompida e é retomada com novo login (já previsto em FR-023).
- **Alternatives considered**:
  - API + worker separados com fila (pg-boss/BullMQ): exigiria trafegar credenciais por um meio
    persistente ou criar um canal cifrado ad hoc — mais complexo e mais arriscado.
  - Redis para fila/pub-sub: infraestrutura extra sem necessidade descrita na spec.

## R-03 — Framework HTTP e contrato

- **Decision**: Fastify 5, **contract-first**: o arquivo `packages/contracts/openapi.yaml` é a
  fonte da verdade; tipos TypeScript gerados com `openapi-typescript`; rotas e validação de
  request/response carregadas do contrato com `fastify-openapi-glue`.
- **Rationale**: princípio III (contrato OpenAPI versionado como fonte da verdade). Gerar tipos a
  partir do contrato garante que servidor, Electron e Sura vejam o mesmo formato.
- **Alternatives considered**: code-first com TypeBox/zod gerando o OpenAPI (o contrato vira
  subproduto do código, invertendo a fonte da verdade); NestJS (estrutura pesada para o escopo).
- **Atualização 2026-11-11 (implementação da Fase 2)**: ajustes no contrato exigidos pela
  implementação — código de erro `internal_error` (falha inesperada, 500; operação ainda não
  implementada, 501; banco indisponível em `/health`, 503); resposta 400 declarada em todas as
  operações com parâmetros; corpo `problem+json` no 410. O servidor só aceita corpo em
  `application/json` e recusa campos desconhecidos em vez de descartá-los em silêncio: qualquer
  requisição fora do contrato vira `400 validation_error`, com uma mensagem que cita o campo e a
  regra, nunca o valor enviado. A autenticação acontece antes de o corpo ser lido.

## R-04 — Acompanhamento em tempo real (SC-005: aviso de token em até 5 s)

- **Decision**: Server-Sent Events em `GET /v1/executions/{id}/events`, mais `GET
  /v1/executions/{id}` para o estado completo (fallback por polling).
- **Rationale**: SSE é HTTP simples, unidirecional (servidor → cliente), funciona no Electron e em
  qualquer linguagem do Sura; atende 5 s com folga. Comandos (token, cancelar) usam POST normal.
- **Alternatives considered**: WebSocket (bidirecional, desnecessário); somente polling (exigiria
  intervalos ≤ 2 s para garantir 5 s, gerando tráfego inútil); webhooks (Sura precisaria expor
  endpoint — fica para spec futura de integração).

## R-05 — Banco de dados e acesso

- **Decision**: PostgreSQL 17; Drizzle ORM para schema tipado e `drizzle-kit` para migrations SQL
  versionadas no repositório.
- **Rationale**: Postgres é a fonte da verdade (princípio VI). Drizzle mantém o SQL explícito, tipa
  as consultas e gera migrations revisáveis.
- **Alternatives considered**: Prisma (engine própria, menos controle do SQL, imagem maior);
  Kysely (ótimo, mas sem ferramenta de migration integrada); SQL puro (sem tipos).
- **Atualização 2026-11-11 (implementação da Fase 2)**: as migrations ficam em
  `apps/server/src/persistence/migrations/` e são aplicadas pelo próprio servidor (e pelo CLI) ao
  iniciar, sob um bloqueio no banco (`pg_advisory_lock`), para que dois processos não as apliquem
  ao mesmo tempo. O build copia os arquivos SQL para `dist/`. Para gerar uma migration depois de
  mudar o schema: `pnpm --filter @hunit/server db:generate --name=<descrição>` (não precisa de
  banco).

## R-06 — Isolamento do Hunit e regras de classificação

- **Decision**: duas camadas separadas:
  1. **Page Objects** (`apps/server/src/hunit/`): únicos lugares com seletores, URLs e textos do
     Hunit. Extraem da tela um objeto neutro `ReservationSnapshot` (pré-pagamento presente?,
     registro "Cobrado em"?, ação de cobrar visível?, estado de falha?, situação da reserva, dados
     da cobrança).
  2. **Domínio** (`packages/domain/`): função pura `classifyReservation(snapshot)` com as regras da
     FR-013 na ordem definida, sem nenhuma dependência de navegador ou HTML.
- **Rationale**: princípio II. No legado, regras e marcadores HTML estavam misturados
  (`'class="pre-payment-container'` dentro da classificação), por isso uma mudança de tela quebrou
  regra de negócio. Agora uma mudança de tela afeta só o Page Object; o domínio e seus testes não
  mudam.
- **Alternatives considered**: classificar diretamente o HTML (modelo do legado — rejeitado pelo
  motivo acima).

## R-07 — Botão "Exportar reservas" do Hunit

- **Decision**: **não usar**. A coleta lê a listagem na tela e abre cada reserva.
- **Rationale**: confirmado pelo usuário em 2026-11-11: o arquivo exportado não traz status do
  pagamento, código de autorização, valor cobrado nem quem cobrou — justamente os dados que definem
  a classificação.
- **Alternatives considered**: exportar para obter a listagem e abrir só as reservas com
  pré-pagamento — rejeitado porque a indicação de pré-pagamento também não vem no arquivo, então
  todas as reservas teriam de ser abertas de qualquer forma; o ganho seria pequeno e adicionaria
  uma segunda fonte (download + parsing de arquivo) a manter.

## R-08 — Paralelismo entre hotéis (SC-009) — **Verificar no mapeamento**

- **Decision**: processar **um hotel por vez** por padrão, com a concorrência configurável
  (`HOTEL_CONCURRENCY`, padrão `1`). Habilitar valores > 1 somente após o teste descrito abaixo
  passar em homologação.
- **Rationale**: no legado, o hotel é escolhido numa tela `Account/SelectCompany` após o login,
  o que indica que o **hotel ativo é estado da sessão**. Abas paralelas na mesma sessão
  provavelmente trocariam o hotel umas das outras; sessões separadas exigiriam **um token 2FA por
  sessão**, inviável para o operador. Por isso a meta realista tende a ser a de 1 hora (SC-009,
  modo sequencial).
- **Atualização 2026-11-11 (HAR)**: a API nova recebe o hotel no cabeçalho `X-Company-Id` de cada
  requisição; o risco de "hotel como estado de sessão" não se confirma para a API. Manter
  `HOTEL_CONCURRENCY=1` até medir, depois subir gradualmente (ex.: 3) observando erros/limites do
  Hunit; a meta de 30 min da SC-009 volta a ser plausível.
- **Teste de verificação**: com uma sessão logada, abrir duas abas, selecionar hotéis diferentes
  em cada uma e conferir se a listagem de reservas da primeira aba continua no hotel original.
- **Atualização 2026-11-11 (Fase 4)**: o executor processa os hotéis **sempre um por vez**;
  `HOTEL_CONCURRENCY` é lido da configuração, mas ainda não é usado. O teste de verificação passa
  a ser o `hunit:reservations-check --parallel-hotel <código>` (compara a leitura simultânea de
  dois hotéis com a leitura um por vez). Só depois dele a concorrência entra no executor.
- **Resultado 2026-11-11 (Hunit real)**: a leitura simultânea da primeira página dos hotéis 3544
  e 4909 devolveu o mesmo que a leitura um por vez, sem `SelectCompany`. O hotel vai em cada
  requisição, não na sessão: **o paralelismo entre hotéis é viável** com um único login. Ainda
  não medido: limite de requisições simultâneas do Hunit (erros 429/5xx com mais hotéis).
- **Implementado 2026-11-11 (T063)**: o executor usa `HOTEL_CONCURRENCY` (padrão 1). Os hotéis
  saem de uma fila para até N trabalhadores com a mesma sessão; cada hotel continua gravado na
  sua própria transação. Sessão expirada (ou parada) num hotel faz os outros em andamento
  pararem antes da próxima página ou reserva, sem gravar; os não iniciados ficam pendentes para
  a retomada. Na homologação, subir aos poucos (ex.: 1 → 3 → 5) medindo a duração da rotina
  (SC-009) e observando erros 429/5xx, que hoje fazem só o hotel afetado falhar.
- **Alternatives considered**: várias sessões com vários tokens (péssimo para o operador);
  paralelizar a abertura de reservas dentro do mesmo hotel (possível ganho, avaliar após medir o
  tempo do modo sequencial).

## R-08a — Medição de tempo e estimativa (FR-021a, SC-010)

- **Decision**: `execution_hotels` guarda `started_at`/`finished_at` e `reservations_seen`; o runner
  calcula a média móvel de segundos por reserva aberta (reservas "258-" não contam) e estima o
  restante = média × reservas ainda não processadas nas páginas conhecidas + média histórica por
  hotel × hotéis ainda não iniciados. No início da execução usa a média das últimas execuções.
- **Rationale**: o tempo varia mais com o número de reservas do que com o número de hotéis; a média
  por reserva corrige a estimativa conforme a execução avança.
- **Alternatives considered**: média por hotel apenas (distorcida por hotéis muito grandes ou
  vazios).
- **Implementado 2026-11-11 (Fase 5, T054)** em `apps/server/src/executions/timing.ts` (funções
  puras) e calculado a cada `GET /v1/executions/{id}`:
  - **"Reservas ainda não processadas nas páginas conhecidas"** exigiu um dado novo:
    `execution_hotels.reservations_total` (migration `0001`), o total que o Hunit informa na
    listagem (`totalItems`), somado entre os blocos do período. Restante do hotel em andamento =
    `reservations_total − reservations_seen`. Antes de a primeira página responder, vale "média
    por hotel − tempo já gasto no hotel".
  - O andamento do hotel (`pages_*`, `reservations_*`, contagens) passa a ser gravado também logo
    após cada listagem e após cada reserva, não só no fim de cada página: o acompanhamento e a
    estimativa refletem a reserva em curso.
  - **Média por reserva** = tempo dos hotéis que abriram reservas ÷ reservas abertas (o hotel em
    andamento conta até agora; hotéis com falha ou cancelados também, porque o tempo foi real).
    **Média por hotel** = duração média dos hotéis concluídos. As duas, em `timing`, são sempre
    as **da própria execução** (FR-021a: "consultável por execução"); sem medição, `null`.
  - **Média histórica** (início da execução): últimos 50 hotéis concluídos de outras execuções
    (`loadTimingHistory`), usada só na estimativa enquanto a execução não mediu nada.
  - Com `HOTEL_CONCURRENCY` > 1, o trabalho restante é dividido pelo número de hotéis processados
    ao mesmo tempo (limitado aos hotéis que faltam).
  - Sem estimativa (`null`): execução encerrada; antes do acesso ao Hunit (os hotéis ainda não
    foram definidos — o catálogo só é lido depois do token); ou falta medição para alguma parte
    (ex.: primeira execução da história, antes de o primeiro hotel terminar).
  - `current` (FR-021) é o hotel em andamento com o evento mais recente, a página em leitura
    (`pages_done + 1`, limitada a `pages_total`) e a **última reserva analisada** nele (o evento é
    publicado depois da análise). Com hotéis em paralelo, os demais aparecem em `hotels`.
  - A SC-010 (erro da estimativa) continua a medir na homologação (T062).

## R-09 — Limite de tamanho do período no Hunit (FR-010a) — **Verificar no mapeamento**

- **Decision**: o executor divide o período em blocos de até `MAX_PERIOD_DAYS` dias (variável de
  ambiente; sem valor = sem divisão). As reservas dos blocos são unidas e deduplicadas por
  hotel + número antes da gravação do hotel.
- **Rationale**: atende períodos retroativos longos sem depender de saber agora o limite do Hunit.
- **Alternatives considered**: recusar períodos longos (contraria FR-010a).
- **Atualização 2026-11-11 (Hunit real)**: um período de 3 dias foi aceito sem divisão. O limite
  do Hunit continua desconhecido; medir com um período retroativo longo na homologação (T062).

## R-10 — Autenticação dos clientes (FR-007)

- **Decision**: chave de API por cliente, enviada em `Authorization: Bearer <chave>`. O banco
  guarda apenas o hash SHA-256 da chave, o nome do cliente e o nível (`operator` | `reader`).
  Chaves são criadas por um comando administrativo no servidor e mostradas uma única vez.
- **Rationale**: simples para clientes máquina-a-máquina (Sura) e para o Electron; revogável por
  cliente; nenhuma chave em texto puro no banco.
- **Alternatives considered**: OAuth2 client credentials (exige provedor de identidade — fora do
  escopo); JWT próprio (complexidade de emissão/rotação sem benefício agora).
- **Atualização 2026-11-11 (implementação da Fase 2)**: a chave tem o formato
  `hunit_<43 caracteres>` (256 bits aleatórios). O nome do cliente aceita de 2 a 50 caracteres
  entre letras minúsculas, números, "-" e "_", porque aparece em logs e respostas. Toda linha de
  log de uma requisição autenticada leva o nome do cliente (auditoria da FR-007).

## R-11 — Identificação da conta do Hunit sem guardar credenciais (FR-006)

- **Decision**: `account_key = HMAC-SHA256(usuário normalizado, ACCOUNT_KEY_SECRET)`.
- **Rationale**: permite aplicar "uma execução ativa por conta" e auditar execuções por conta sem
  armazenar o usuário do Hunit.
- **Alternatives considered**: guardar o usuário em texto (dado de credencial — evitado);
  hash sem segredo (vulnerável a dicionário de e-mails).

## R-12 — Credenciais e token fora de logs e evidências (FR-005, SC-004)

- **Decision**:
  - logs com Pino (padrão do Fastify), com `redact` para `password`, `token`, `authorization` e
    `credentials.*`;
  - corpo das rotas de início/retomada/token nunca logado;
  - capturas de tela da tela de login usam a opção `mask` do Playwright sobre todos os campos de
    entrada; o HTML salvo como evidência passa por um sanitizador que remove o atributo `value` de
    todos os `<input>`;
  - teste automatizado de SC-004: roda o fluxo contra fixtures com senha/token conhecidos e procura
    essas strings em todos os logs e evidências gerados.
- **Rationale**: defesa em camadas; o teste transforma SC-004 em verificação contínua.
- **Atualização 2026-11-11 (implementação da Fase 2)** — as camadas ficaram assim:
  1. `redact` do Pino para campos com nome sensível (senha, token, autorização, credenciais e o
     corpo das requisições);
  2. **registro de segredos em uso** (`apps/server/src/secrets.ts`): usuário, senha e token ficam
     registrados em memória enquanto a execução precisa deles, e todo texto que o servidor grava
     (linhas de log, HTML e respostas das evidências, mensagens de eventos, motivo das evidências)
     tem essas ocorrências trocadas por `[REDACTED]`, inclusive quando escritas como JSON, HTML ou
     URL. Cobre o caso que o `redact` não alcança: uma biblioteca citar a senha numa mensagem de
     erro;
  3. erros de banco são registrados sem os valores das linhas (o PostgreSQL e o Drizzle repetem
     os dados da linha na mensagem, o que levaria nomes de hóspedes para o log);
  4. as capturas de tela cobrem os campos de entrada **e** os textos sensíveis informados pela
     camada do Hunit (a tela do token mostra o usuário por extenso). O HTML passa pelo sanitizador
     na captura e de novo na gravação.

  Testes no Chromium conferem, pixel a pixel, que as áreas cobertas saem pretas na captura.

## R-13 — Mapeamento da interface atual do Hunit — **Login e 2FA mapeados (faltam telas de erro)**

- **Decision**: antes de implementar os Page Objects, gravar o fluxo real com
  `npx playwright codegen https://hunit.hsystem.com.br/login` e salvar o HTML das
  telas (login, token, seleção de hotel, filtro/listagem de reservas, detalhe de reserva em cada
  situação: sem pré-pagamento, cobrada, pendente, falha, cancelada). O HTML é **anonimizado** e vira
  fixture em `apps/server/test/fixtures/hunit/`.
- **Rationale**: o legado parou por mudança de UI; nenhum seletor antigo é confiável. Fixtures
  permitem testar os Page Objects sem acessar o Hunit (princípio VII).
- **Responsável**: operador com acesso ao Hunit e ao autenticador (usuário do projeto). As tasks de
  Page Objects dependem dessas fixtures.

### Resultado dos HARs de login (2026-11-11, analisados sem expor valores)

Com a coleta pela rede (R-13a), a tela só é usada no login. O login **não é do Hunit**: é um
SSO **Keycloak** (OpenID Connect com PKCE) em `login.hsystem.com.br`, realm `hsystem`.

1. `https://hunit.hsystem.com.br/login` mostra a **tela de entrada** do Hunit, só com o botão
   **"LOGIN ÚNICO"** (MUI, clique tratado por JavaScript); o clique leva a
   `GET hunit-api…/api/Account/SSOLogin?returnUrl=…` → **302** para
   `login.hsystem.com.br/auth/realms/hsystem/protocol/openid-connect/auth`. *(Corrigido em
   2026-11-11 no primeiro login real: os HARs não mostravam o clique, e a versão anterior deste
   item dizia que o redirecionamento era automático — o login falhava por esperar os campos.)*
2. **Tela de credenciais** (`<title>Entrar em hsystem</title>`, `h1#kc-page-title` "Entrar na sua
   conta"): `form#kc-form-login`; label **"Endereço de e-mail"** → `input#username`; label
   **"Senha"** → `input#password`; botão de envio `input#kc-login`.
3. `POST …/login-actions/authenticate` (form urlencoded) → **tela do token**:
   `form#kc-otp-login-form`; label **"Código do Autenticador"** no login real de 2026-11-11 (o HAR mostrava "Código de uso único"; os dois são aceitos) → `input#otp`; envio `input#kc-login`;
   `#kc-attempted-username` mostra o e-mail digitado (dado pessoal — anonimizar em fixtures).
4. Após o token, o Keycloak devolve o código ao `hunit-api` (callback OIDC), que cria os cookies de
   sessão e redireciona para o SPA. **Não capturado** (o DevTools limpa o HAR na navegação).

- **Page Objects**: localizar por label (`getByLabel('Endereço de e-mail')`, `getByLabel('Senha')`,
  `getByLabel('Código de uso único')`) e reconhecer a tela pelo título/`form#kc-*`. O sucesso do
  login é detectado pela chegada a `hunit.hsystem.com.br` e por `GetCurrentUser` = 200.
- **Primeiro login real (2026-11-11, `hunit-login-check`, rodado pelo operador)**: três rodadas,
  todas com o resultado esperado — senha e token corretos → acesso concluído e catálogo lido
  (`GetCurrentUser.companies` no formato esperado); senha errada → `invalid_credentials`; token
  errado → `invalid_token`. Mensagens reais: senha errada → `span#input-error` "Nome de usuário
  ou senha inválida."; token errado → `span#input-error-otp-code` "Código de uso único
  inválido." (ambas `.kc-feedback-text`, tema PatternFly). O acesso foi concluído sem nenhum
  redirecionamento fora da lista de permissão: a rota de retorno do login é aceita pela lista
  atual. Duas diferenças em relação aos HARs, corrigidas: a tela de entrada `/login` exige o
  clique em "LOGIN ÚNICO", e o rótulo do token é "Código do Autenticador".
- **(Histórico) Faltavam (T020)**: HTML das mensagens de erro de senha inválida e de token inválido/expirado
  (Keycloak costuma mostrar `#input-error` ou `.kc-feedback-text`, a confirmar). Gravar com senha e
  token **falsos**, nunca os verdadeiros.
- **Segurança**: o HAR da tela de token contém o POST com usuário e senha em texto puro (o
  "sanitizado" do Chrome não limpa corpos de requisição). HARs de login devem ser apagados logo após
  a análise e jamais anexados ou commitados.

## R-13a — Coleta pela tela ou pelas respostas HTTP do Hunit — **Spike concluído: rede (JSON)**

- **Hipótese** (sugerida pelo usuário em 2026-11-11): o front do Hunit obtém listagem e detalhe
  das reservas por requisições HTTP (JSON ou HTML parcial). Ler essas respostas pode ser mais
  rápido e mais estável do que abrir reserva por reserva na tela. No legado, o detalhe era um
  modal com `id="bookingDetailView"`, o que sugere um HTML parcial carregado sob demanda.
- **Spike**: com sessão já logada (login feito antes de gravar), capturar no DevTools um HAR
  **sanitizado** de: seleção de hotel → filtro → troca de página → abertura de 2–3 reservas. O HAR
  fica fora do repositório (contém dados de hóspedes) e é analisado para responder:
  1. a listagem vem de uma resposta própria (JSON/HTML parcial)? com paginação por parâmetro?
  2. o detalhe da reserva vem de uma requisição GET reproduzível com a sessão atual?
  3. essas respostas trazem todos os campos da FR-016 (pré-pagamento, "Cobrado em", autorização…)?
  4. a requisição depende do hotel ativo na sessão (impacta R-08)?
- **Decision (provisória até o spike)**: a camada `apps/server/src/hunit/` expõe uma interface
  `HunitGateway` (`login`, `submitToken`, `listHotels`, `selectHotel`, `searchReservations`,
  `readReservation` → `ReservationSnapshot`). A primeira implementação será escolhida pelo spike:
  - **Rede**: navegação pela tela só até o filtro; listagem e detalhe lidos das respostas HTTP
    (interceptadas ou requisitadas via `page.request` com a sessão do navegador);
  - **Tela**: Page Objects lendo o DOM (plano original).
  Ambas podem coexistir (rede como principal, tela como alternativa de diagnóstico).
- **Regras invioláveis**: somente requisições **GET** de leitura podem ser feitas diretamente;
  nenhuma requisição POST/PUT/DELETE do Hunit é reproduzida (FR-012). Respostas usadas em testes
  viram fixtures anonimizadas, como os HTML (princípio VII).
- **Rationale**: o domínio recebe `ReservationSnapshot` nos dois casos (R-06), então a escolha
  afeta só a camada do Hunit — exatamente o isolamento que o princípio II pede.

### Resultado parcial do spike (HAR sanitizado de 2026-11-11, analisado sem expor valores)

- O Hunit novo é uma SPA em `hunit.hsystem.com.br` que consome uma **API JSON** em
  `hunit-api.hsystem.com.br` (domínios diferentes do legado `extranet.hunit.com.br`).
- **Listagem**: `GET /api/Entity/GetBookings` com parâmetros `DateTypeId`, `StartDate`, `EndDate`
  (ISO `YYYY-MM-DD`), `StatusId`, `CollectTypeId`, `PrePaymentStatus`, `IntegrationStatusId`,
  `ChannelId`, `RoomRateId`, `GuestName`, `ChannelIdentifier`, `PMSIdentifier`, `Page`, `PageSize`.
  Mapeamento dos filtros da FR-010 observado: `DateTypeId=2` (Check-in), `StatusId=0` (Todas),
  `CollectTypeId=2` (Canal), `PrePaymentStatus=0` (Todos), `IntegrationStatusId=0` (Todas) —
  coincide com os códigos do legado (`runtime_options.py`).
- Resposta: `items.items[]` com `id`, `channelIdentifier`, `guestFullName`, `channelName`,
  `roomStayDescription`, `createDateTime`, `arrivalDate`, `departureDate`, `statusId`,
  `collectTypeId`, `prePaymentStatus` (valores vistos: `Unprocessed`, `Success`),
  `integrationStatusId`, `pmsIdentifier`, `bookingRetrievalId`, `lastUpdateDateTime`, `comission`,
  `total`; paginação em `items.page`, `items.pageSize`, `items.total`; totalizadores de ativas e
  canceladas.
- **Hotel por requisição**: cabeçalho `X-Company-Id` em cada chamada → o hotel **não** é estado de
  sessão. Isso invalida o principal risco do R-08: vários hotéis podem ser consultados em paralelo
  com um único login/token.
- Chamadas observadas são todas GET (mais `OPTIONS` de CORS) → compatível com FR-012.
- **Pendências** para concluir o spike: (1) requisição de **detalhe** da reserva com dados de
  cobrança (cobrado em, por quem, valor, autorização, transação, parcelamento, falha);
  (2) origem do catálogo de hotéis e dos IDs de `X-Company-Id` (`GetCurrentUser`/
  `MenuCapabilities` apareceram só como `OPTIONS`); (3) mecanismo de autenticação da API (o HAR
  sanitizado remove `Authorization`/cookies); (4) significado de `statusId` (vistos 1, 2, 3) para
  ativa/cancelada.
### Resultado do 2º HAR + leitura do bundle JS do front (2026-11-11)

O 2º HAR capturou um recarregamento da página (sem troca de hotel nem abertura de reserva), mas
incluiu o bundle JavaScript do front, que lista as rotas e enums usados pela tela:

- **Autenticação**: o cliente HTTP do front usa `withCredentials: true` (cookies), sem cabeçalho
  `Authorization`. Login por SSO: `GET /api/Account/SSOLogin?returnUrl=…` (redireciona para o
  provedor de login, onde ficam senha e 2FA). → O contexto do Playwright, depois do login, já
  carrega os cookies; chamadas à API podem usar o `APIRequestContext` do próprio contexto do
  navegador, sem extrair nem guardar nenhum segredo.
- **Hotel**: um interceptor adiciona `X-Company-Id` (hotel selecionado) em toda requisição. Existe
  também `POST /api/Account/SelectCompany` (a tela chama ao trocar de hotel) — verificar se a API
  aceita só o cabeçalho sem o `SelectCompany` antes de paralelizar.
- **Catálogo de hotéis**: `GET /api/Account/GetCurrentUser` (`companies[]` com `id`, `name`,
  `isActive`) e `GET /api/Account/GetCurrentUserCompanies?search&page&pageSize`.
- **Detalhe**: `GET /api/Company/BookingDetail?id=<id da reserva>`; também
  `GET /api/Company/ForBooking?bookingId=<id>`. Formato da resposta ainda não observado.
- **Situação da reserva**: `statusId` 1 = nova, 2 = alterada, 3 = **cancelada** (a tela mostra
  "cancelada" se `statusId === 3`, senão "ativa"). Atenção: no **filtro** `StatusId` os códigos
  são outros: 0 = Todas, 1 = Ativas, 2 = Canceladas.
- **Situação do pré-pagamento** (`prePaymentStatus`): `Success` = cobrado, `Fail` = falha na
  cobrança, `Unprocessed` = não cobrado; qualquer outro valor = sem pré-pagamento (`na`). A ação
  de cobrar aparece quando o status é `Unprocessed` ou `Fail`.
- **Nuance nova**: um evento de pré-pagamento com `justValidate = true` é exibido como "Validado
  em" em vez de "Cobrado em" — o cartão foi **validado, não cobrado**. Precisa de decisão de
  negócio (ver pendência na spec).

#### Rotas que o sistema NUNCA pode chamar (lista de bloqueio do `read-only-guard`)

| Rota | Motivo |
|---|---|
| `POST /api/Payment/CalculePrePayment` | primeiro passo da cobrança (no legado, o botão de cobrar tinha a classe `calculeprepayment`) |
| `POST /api/Payment/ChargePrePayment` | **executa a cobrança** |
| `GET /api/Payment/UpdatePrePaymentInformation`, `POST …/UpdatePrePaymentInformationPost` | atualiza informação de pagamento — GET com possível efeito colateral |
| `POST /api/Company/BookingPaymentDetails` | revela dados do cartão (exige captcha); o sistema não precisa nem pode ver dados de cartão |
| `POST /api/Company/CancelBooking`, `POST /api/Company/EditBooking`, `POST /api/Company/ReactivateIntegration` | alteram reservas |
| `POST /api/bookings/{id}/events/*` (`cancel-invalid-card`, `update-dates`) | alteram reservas |

Por isso o guard passa a ser **lista de permissão por rota**, não só por método: depois do login,
o cliente de API do sistema só conhece `GetCurrentUser`, `GetCurrentUserCompanies`, `GetBookings`,
`BookingDetail` e `ForBooking`; no navegador, qualquer requisição a `hunit-api` fora da lista de
permissão é abortada, e as rotas da tabela acima são bloqueadas mesmo se aparecerem na lista por
engano.

- **Direção provisória**: coleta **híbrida** — login e token pela interface (Playwright); listagem
  e detalhe lidos da API JSON com a sessão autenticada do navegador, somente GET, credenciais de
  sessão mantidas apenas em memória; HTML/tela apenas como diagnóstico.

### Resultado do 3º HAR — abertura de 4 reservas (2026-11-11)

Analisado sem imprimir valores (apenas formas, enums e booleanos). Fecha as perguntas 1–3 do spike.

1. **Listagem**: `GET /api/Entity/GetBookings` com `StatusId, CollectTypeId, PrePaymentStatus,
   IntegrationStatusId, DateTypeId, StartDate, EndDate (AAAA-MM-DD), Page, PageSize` → `items.items[]`
   (`id`, `channelIdentifier` = número da reserva exibido, `guestFullName`, `channelName`,
   `roomStayDescription`, `arrivalDate`, `departureDate`, `statusId`, `collectTypeId`,
   `prePaymentStatus`, `total`, …) + `items.page/pageSize/total` → paginação calculável
   (`ceil(total / pageSize)`), FR-011 atendida sem varrer a tela.
2. **Detalhe**: `GET /api/Company/BookingDetail?id=<id interno>` reproduzível com a sessão. Campos
   relevantes: `statusId`, `cancellationDate`, `hasCreditCardInfo`, `prePaymentStatus`, `canCharge`,
   `collectTypeId/collectTypeLabel`, `totals.total`, `guest.fullName`, e `lastPaymentEvent`
   (`null` quando nunca houve tentativa) com: `user`, `dateTime`, `valueCharged`, `status`,
   `justValidate`, `authorizationCode`, `transactionId`, `processorReferenceNumber`, `isParceled`,
   `numberOfInstallments`, `installmentValue`, `description`. → **todos os campos da FR-016**.
   `ForBooking` não foi chamada pela tela e sai da lista de permissão. A tela também chama
   `GET /api/bookings/{id}/channel-eligibility` (elegibilidade de no-show/cancelamento) — não
   necessária, fica fora da lista de permissão.
3. **Datas**: `DateTypeId=1` foi o padrão da tela nesta captura; o código de "Check-in" deve ser
   confirmado (o legado usava 2) antes de fixar o filtro.
4. **Hotel ativo**: só um `X-Company-Id` na captura e nenhuma chamada a `SelectCompany`; a pergunta
   4 (paralelismo, R-08) continua aberta e será verificada no primeiro acesso real autorizado.

**Mapeamento para `ReservationSnapshot`** (o front mostra o bloco de pagamento só se
`hasCreditCardInfo`, e o botão de cobrar só se `prePaymentStatus ∈ {Unprocessed, Fail}` **e**
`canCharge`):

| Regra FR-013 | Condição na resposta do detalhe |
|---|---|
| 2 não é cartão virtual | `hasCreditCardInfo = false` |
| 3 erro na cobrança | `prePaymentStatus = Fail` |
| 4 já cobrada | `prePaymentStatus = Success` e `lastPaymentEvent.justValidate = false` |
| 5 cartão validado (não cobrado) | `prePaymentStatus = Success` e `lastPaymentEvent.justValidate = true` |
| 6 pendente de cobrança | `prePaymentStatus = Unprocessed` e `canCharge = true` |
| 7 erro de análise | qualquer outro caso (ex.: `Success` sem `lastPaymentEvent`, `Unprocessed` sem `canCharge`, status desconhecido) |

Situação da reserva (FR-014a): `statusId = 3` → cancelada; `1`/`2` → ativa; outro → não identificada.

- **Decision (final)**: coleta **pela rede**. Playwright faz login + 2FA na tela; listagem e
  detalhe vêm da API JSON (`page.request`, mesma sessão), somente GET e somente as rotas da lista
  de permissão (`GetCurrentUser`, `GetCurrentUserCompanies`, `GetBookings`, `BookingDetail`).
  Page Objects ficam restritos a login, 2FA e detecção de sessão. Fixtures de teste da coleta são
  **JSON anonimizado**.
- **Tipo de coleta (resolvido 2026-11-11)**: a amostra do 3º HAR foi gravada sem o filtro de
  coleta (por isso vieram reservas Hotel Collect com cobranças). O usuário confirmou: a automação
  consulta **somente Canal Collect** (`collectTypeId = 2` na resposta; o código do filtro
  `CollectTypeId` é confirmado no primeiro acesso real).
- **A verificar no primeiro acesso real autorizado (T022)**: código de `DateTypeId` para Check-in
  (o padrão da tela foi 1; o legado usava 2); código de `CollectTypeId` para Canal Collect; se
  `X-Company-Id` basta para trocar de hotel sem `SelectCompany` e se dois hotéis podem ser lidos em
  paralelo (R-08); `PageSize` máximo aceito e limite de período (R-09); rota de retorno do login
  no `hunit-api` (ver o item seguinte).
- **Proteção de somente leitura (implementada na Fase 2, T045)**:
  `apps/server/src/hunit/read-only-guard.ts`. O cliente da API do sistema só faz GET nas 4 rotas
  permitidas, no endereço exato da API. A página do navegador só alcança o `hunit-api` nas rotas
  do login; o resto é abortado antes de sair da máquina, inclusive as chamadas que a tela do
  Hunit dispara sozinha depois do login e as conexões em tempo real. A lista de bloqueio
  reconhece as ações perigosas pelo nome, com qualquer método e em qualquer grafia (maiúsculas,
  `%xx`, barras repetidas), e é conferida antes de qualquer permissão. A rota de retorno do login
  ainda não foi observada: está liberada provisoriamente como `/signin-oidc` (o padrão desse tipo
  de login). Se estiver errada, o login falha e o bloqueio informa a rota pedida.

- **Atualização 2026-11-11 (implementação da Fase 3, T032)**:
  - **Limite do Playwright descoberto nos testes**: a interceptação (`context.route`) só alcança
    o primeiro endereço de um redirecionamento HTTP; o salto seguinte ("302, vá para X") sai do
    navegador sem poder ser abortado. A proteção passa a **detectar** esses saltos
    (`context.on('request')` com `redirectedFrom()`), informando-os com `sent: true`, e o gateway
    interrompe o acesso com `ScreenNotRecognizedError` citando a rota. Risco residual: só o login
    (Keycloak e o próprio `hunit-api`) redireciona, e um redirecionamento vira GET sem corpo
    (exceto 307/308). Requisições feitas pela página (XHR/fetch, navegação por script) continuam
    sendo abortadas antes de sair.
  - Esse mesmo mecanismo revela a rota real de retorno do login: se não for `/signin-oidc`, o
    primeiro login real falha mostrando a rota, que entra na lista de permissão com teste.
  - **Verificação manual do login** (`apps/server/src/hunit-login-check.ts`): o operador roda no
    próprio terminal, digita e-mail, senha e token (senha e token ocultos, nada gravado) e vê o
    resultado e as rotas barradas; com `--save-dir test/fixtures/hunit/raw` guarda as telas
    sanitizadas para a T020. Credenciais nunca passam pelo chat nem pelo agente.
  - Até a T020, os testes do login usam fixtures **reconstruídas** a partir dos HARs; as
    mensagens de erro seguem o padrão do Keycloak (`#input-error`, `.kc-feedback-text`,
    `.alert-error`, `[role=alert]`) e precisam ser confirmadas. Expiração da tentativa de login
    depois do token = voltar à tela de usuário e senha, ou página com título contendo "expir".

- **Atualização 2026-11-11 (implementação da Fase 4, T041/T046/T048)**:
  - **Leitores**: `network/bookings.ts` (`GetBookings`) e `network/booking-detail.ts`
    (`BookingDetail`), conferindo cada resposta com zod. Os códigos dos filtros ficam numa única
    constante (`BOOKING_FILTERS`): `DateTypeId=2` (Check-in) e `CollectTypeId=2` (Canal Collect),
    como no legado, **ainda a confirmar** (T022). Se estiverem errados, o próprio leitor percebe:
    reserva fora do período ou que não é Canal Collect recusa a página (FR-010).
  - **Paginação**: pede `PageSize=50` e calcula as páginas com o `pageSize` que o Hunit devolve,
    então um limite menor do Hunit não perde reservas. Supõe páginas a partir de 1 (a resposta
    tem de devolver a página pedida, senão é recusada). Ambos a confirmar na T022.
  - **Detalhe → `ReservationSnapshot`**: segue a tabela acima. Decisões que a tabela não cobria:
    - campo obrigatório ausente ou com tipo errado (`statusId`, `hasCreditCardInfo`,
      `canCharge`, `lastPaymentEvent.justValidate`, datas) → resposta não reconhecida; a reserva
      vira erro de análise com a resposta como evidência e o hotel segue (edge case "falha ao
      abrir uma reserva");
    - `prePaymentStatus` fora de `Success`/`Fail`/`Unprocessed` numa reserva com cartão → sinais
      `null` → erro de análise (linha 7 da tabela); sem cartão, o valor é ignorado;
    - `statusId` fora de 1, 2 e 3 → situação `unknown`, com evidência, sem impedir a
      classificação (FR-014a); se o detalhe não identificar a situação, vale a da listagem;
    - data/hora sem fuso é lida como horário de Brasília (UTC−3; o Brasil não tem horário de
      verão desde 2019). Nas respostas reais, `lastPaymentEvent.dateTime` **vem com fuso** e até
      7 casas nos segundos (ex.: `…T11:30:00.1234567-03:00`); o fuso informado é respeitado.
      Datas de check-in/check-out vêm sem fuso (`…T00:00:00`) e só a data é usada;
    - `prePaymentMessage` = `lastPaymentEvent.description`.
  - **Interface**: `readReservation` recebe o item da listagem (e não só o id) e devolve o
    retrato junto com a resposta recebida (`ReservationDetail`), para o erro de análise e a
    situação não identificada terem evidência (US2, cenário 8; FR-014a). A listagem do registro
    vem do `GetBookings` (o detalhe não foi mapeado para datas e canal).
  - **Executor**: a coleta fica em `executions/hotel-collection.ts`. Sessão expirada ou parada do
    servidor encerram a execução e o hotel em andamento fica `failed` sem gravar; os demais
    ficam `pending`, prontos para a retomada (US3). Qualquer outra falha marca só o hotel.
  - **Verificação no Hunit real**: `pnpm --filter @hunit/server hunit:reservations-check`
    (`apps/server/src/hunit-reservations-check.ts`), no mesmo modelo do `hunit:login-check`. Lê
    1 hotel num período curto, mostra o `pageSize` usado pelo Hunit, a classificação de algumas
    reservas (sem nome de hóspede) e, com `--parallel-hotel`, compara a leitura simultânea de
    dois hotéis com a leitura um por vez (R-08). Com `--save-dir`, guarda as respostas JSON em
    `test/fixtures/hunit/raw/` para a T020/T021. Nada é gravado no banco.

- **Resultado da verificação no Hunit real (2026-11-11, `hunit:reservations-check`)**: hotel
  3544 e, para o paralelismo, 4909; check-in de 10 a 12/11/2026. A forma das respostas salvas foi
  analisada só por nomes de campos, tipos e códigos, sem ler valores.
  - **Filtros confirmados**: `DateTypeId=2` (Check-in) e `CollectTypeId=2` (Canal Collect). As 32
    reservas devolvidas eram todas Canal Collect (`collectTypeId = 2`) e com check-in no período.
    Falta o operador confirmar que o total (32) bate com a tela de reservas do Hunit.
  - **Paginação**: começa em 1 (a resposta devolveu `page = 1`); `PageSize=50` foi aceito
    (`pageSize = 50` na resposta). O máximo aceito não foi medido.
  - **`X-Company-Id` basta**: os dois hotéis foram lidos sem `SelectCompany`.
  - **Formato**: `GetBookings` e `BookingDetail` têm todos os campos que os leitores conferem;
    valores vistos de `statusId` 1, 2 e 3 e de `prePaymentStatus` `Success` e `Unprocessed`. O
    detalhe também traz `arrivalDate`, `departureDate` e `channelName`, e a resposta da listagem
    traz totalizadores de ativas e canceladas (`generalTotalizers`, `pageTotalizers`), não usados.
  - **Classificação**: 7 reservas abertas, todas reconhecidas (6 já cobradas, 1 cancelada
    pendente de cobrança); 25 das 32 eram "258-" (Hotelbeds), ignoradas sem abrir. Nenhum erro de
    análise. A conferência com a tela do Hunit (SC-002) fica para a homologação (T062).

## R-14 — Testes

- **Decision**: Vitest em todos os pacotes.
  - **Domínio**: testes unitários das regras da FR-013 e do histórico de verificação (FR-018/018a).
  - **Page Objects**: Chromium real do Playwright carregando as fixtures HTML (`page.setContent` /
    rotas interceptadas).
  - **Contrato**: `fastify.inject` + validação das respostas contra o `openapi.yaml`.
  - **Integração com banco**: Testcontainers (PostgreSQL efêmero).
- **Rationale**: uma ferramenta só; cada camada indica onde está a falha (princípio VII).
- **Alternatives considered**: Jest (mais lento com ESM/TS); Playwright Test como runner geral
  (bom para E2E, desnecessário para unidade).
- **Atualização 2026-11-11 (implementação da Fase 1)**: Vitest 5. Os projetos por pacote ficam em
  `vitest.config.ts` (`test.projects`); o `vitest.workspace.ts` foi descontinuado. Nos testes e na
  checagem de tipos, `@hunit/domain` e `@hunit/contracts` são lidos direto do código-fonte (alias
  no Vitest, `paths` no `tsconfig.json` do servidor), sem depender de build; só o build de
  produção usa os `dist`.
- **Atualização 2026-11-11 (implementação da Fase 2)**: os testes do servidor ficam em três
  projetos do Vitest — `server` (unidade, sem dependências externas), `server-browser` (abre o
  Chromium; exige `playwright install chromium`) e `server-db` (PostgreSQL real via
  Testcontainers; exige o Docker em execução). Um container PostgreSQL atende a rodada inteira e
  cada arquivo de teste usa um banco próprio, então os arquivos rodam em paralelo sem
  interferência. O verificador de contrato usado nos testes tem os seus próprios testes, para
  garantir que ele acusa respostas fora do contrato.

## R-15 — Gravação por hotel e histórico (FR-017 a FR-019)

- **Decision**: durante o processamento de um hotel, os registros ficam em memória; ao concluir o
  hotel, uma **única transação** grava/atualiza as reservas, as observações da execução e aplica a
  marcação "não encontrada" (FR-018a). Se o hotel falhar ou for cancelado, a transação não ocorre.
- **Rationale**: FR-019 (sem resultados parciais) e FR-018a (marcação só em hotel concluído).
- **Alternatives considered**: gravar reserva a reserva (deixaria hotéis parciais).

## R-16 — Evidências e retenção (FR-024 a FR-027)

- **Decision**: arquivos (PNG + HTML sanitizado) no volume `/data/evidence/<execução>/`; metadados
  na tabela `evidence`. Uma rotina diária interna remove evidências com mais de 30 dias e anonimiza
  `guest_name` de reservas com check-in há mais de 5 anos.
- **Rationale**: arquivos binários fora do banco; volume declarado (princípio V); rotina interna
  evita infraestrutura de agendamento extra.
- **Alternatives considered**: armazenar binários no Postgres (banco cresce rápido); object storage
  S3/MinIO (container extra sem necessidade agora).
- **Atualização 2026-11-11 (implementação da Fase 2)**: arquivos em
  `<EVIDENCE_DIR>/<execução>/<evidência>.png|.html|.json`. Se o registro no banco falhar, os
  arquivos já gravados são removidos (sem o registro, a rotina de limpeza nunca os acharia).
  Quando a captura não obtém nada (página já fechada), nenhuma evidência é gravada.

## R-17 — Datas e valores

- **Decision**: a API usa datas ISO (`YYYY-MM-DD`) e horários ISO 8601 com fuso; DD/MM/AAAA é
  formato de exibição dos clientes. Valores monetários em `numeric(12,2)`, moeda BRL, expostos na
  API como string decimal (`"1234.56"`).
- **Rationale**: ISO evita ambiguidade entre linguagens (Sura); string decimal evita erro de ponto
  flutuante.

## R-18 — Containers

- **Decision**: `docker-compose.yml` com `server` (imagem construída a partir de
  `mcr.microsoft.com/playwright` na **mesma versão** do pacote `playwright` do projeto) e `db`
  (`postgres:17`), volumes `pgdata` e `evidence`. Configuração somente por variáveis de ambiente
  (`.env.example` versionado).
- **Rationale**: princípio V; a imagem oficial já traz o Chromium e as dependências de sistema.
- **Atualização 2026-11-11 (implementação da Fase 1)**: a imagem
  `mcr.microsoft.com/playwright:v1.65.0-noble` traz o **Node.js 26 LTS** (não o 24) e não inclui o
  corepack. Decisão: usar a imagem oficial como ela vem — o servidor roda em Node 26 no container;
  o código é compilado para ES2023 com os tipos do Node 24, então só usa o que existe nas duas
  versões. O pnpm é instalado no estágio de build com `npm`, na versão do campo `packageManager`.
  Alternativa descartada por ora: copiar o Node 24 para dentro da imagem (dois Node na mesma
  imagem, mais manutenção, sem ganho claro).
- O serviço `server` roda como `pwuser` (sem root), com `init: true` e `shm_size: 1gb` (exigências
  do Chromium). Verificado em 2026-11-11: a imagem constrói, contém só dependências de produção, o
  código fica somente leitura para o processo, `/data/evidence` é gravável e o Chromium abre dentro
  do container.
- O `docker-compose.yml` monta a `DATABASE_URL` do servidor a partir de `POSTGRES_PASSWORD`, para
  a senha do banco ser informada uma única vez no `.env`.

## R-19 — Cancelamento e retomada (FR-022, FR-023, SC-007, SC-008)

Decisões da implementação da Fase 5 (2026-11-11, T055–T057).

- **Cancelamento cooperativo com prazo**: `POST /cancel` marca o motivo da parada na execução em
  andamento (`stopReason = cancelled_by_client`, quem cancelou) e responde 202 na hora. Os hotéis
  checam a parada antes de cada página, de cada reserva e **da gravação** — este último ponto foi
  acrescentado porque um cancelamento durante a última reserva gravava o hotel. Se a chamada ao
  Hunit em andamento não terminar em 10 s (`cancelGraceMs`), o navegador é fechado à força, o que
  a interrompe; o pior caso fica dentro dos 15 s da SC-008. A espera do token é interrompida na
  hora.
  - Todos os hotéis em andamento (podem ser vários, com `HOTEL_CONCURRENCY`) ficam `cancelled`, sem
    gravar; os concluídos continuam gravados; os não iniciados ficam `pending`.
  - A execução termina como `cancelled/cancelled_by_client` com `cancelled_by_client_id`.
  - **Corrida com o fim da execução**: depois que o executor começa a gravar o estado final
    (concluída ou falha), o cancelamento não muda mais o resultado — o pedido espera o fim e
    responde `409 execution_already_finished`. O cancelamento de uma execução já encerrada também
    é 409.
  - **Cancelamento que chega depois de todos os hotéis terminarem** (ex.: logo após a gravação do
    último): não havia mais nada a interromper, então a execução termina `completed`, com um aviso
    na mensagem final. Antes da revisão de código ela ficava `cancelled` com todos os hotéis
    gravados e uma mensagem dizendo que algo não fora gravado. A parada só interrompe a execução
    se sobrar hotel na fila ou em andamento.
  - **Pedido repetido**: enquanto a execução está sendo cancelada, um novo pedido de cancelamento
    responde 202 como o primeiro (antes podia responder 409, conforme os milissegundos).
  - Execução ativa no banco que não está em andamento no processo (não deveria acontecer com um
    único servidor): cancelada direto no banco, com os hotéis em andamento marcados `cancelled`.
  - Desligamento do servidor: cancelamento pedido antes vale (a execução termina `cancelled`);
    cancelamento pedido depois de o desligamento começar responde `409 execution_already_finished`
    e a execução termina `failed/server_restarted` (antes respondia 202, prometendo um
    `cancelled` que não acontecia).
  - Ajuste: o evento `queued` passou a ser publicado pelo executor, depois que a execução já está
    registrada em memória — um cancelamento imediato após a criação sempre a encontra.
- **Retomada**: cria uma nova execução com `parent_execution_id`, o mesmo período, o cliente que
  pediu a retomada e novas credenciais (novo login e novo token). `requested_hotel_codes` = hotéis
  da original que não estão `completed` (`pending`, `failed` — inclusive os pedidos que não
  estavam no catálogo — e `cancelled`), na ordem do pedido original quando ele lista os hotéis.
  - Execução que terminou antes de definir os hotéis (ex.: token inválido): repete o pedido
    original (`null` = todos os hotéis).
  - **Também vale para execução `completed` com hotéis que falharam** (permite tentar de novo só
    os hotéis falhos). Se todos foram concluídos: `409 nothing_to_resume`.
  - Execução ainda ativa: `409 execution_already_active` (cancele ou aguarde). Conta das novas
    credenciais com execução ativa: `409 execution_already_active` (FR-006).
  - **Uma retomada por execução** (decisão de 2026-11-11, revisão de código): retomar de novo uma
    execução já retomada reprocessaria hotéis que a retomada anterior concluiu (SC-007). Agora é
    recusado com `409 execution_already_resumed` (código novo no contrato), citando a retomada em
    `detail`; para continuar, retoma-se a **última execução da sequência**, que só conhece os
    hotéis que ainda faltam. Garantido também pelo índice único `executions_one_resume_per_parent`
    (migration `0002`), que vale para pedidos simultâneos. Alternativa descartada: calcular os
    pendentes somando todas as retomadas anteriores (regra mais difícil de explicar ao operador).
  - A conta das novas credenciais não precisa ser a mesma da execução original (outro operador
    pode retomar).
- **Contas com acesso a hotéis diferentes** (decisão de 2026-11-11, revisão de código; spec
  FR-008 e FR-009a). Problema encontrado: o catálogo era um só para todas as contas, e cada leitura
  marcava como indisponível o hotel que a conta da vez não acessava — o catálogo refletia a
  última conta que rodou, e a retomada com outra conta fazia falhar os hotéis que ela não acessa.
  - **Catálogo por conta**: tabela `account_hotels` (conta pelo mesmo HMAC de R-11, sem guardar o
    usuário). `hotels.available` = alguma conta acessa o hotel.
  - **Hotel sem acesso na conta usada**, mas acessado por outra conta conhecida: fica `pending`,
    com o motivo, sem contar como falha nem entrar na estimativa; evento `warning`. Uma retomada
    com uma conta que tenha acesso o processa. Hotel que nenhuma conta conhecida acessa (ex.:
    código digitado errado) continua `failed`.
  - **Aviso antecipado**: ao iniciar ou retomar com hotéis definidos, se a conta já tem catálogo
    conhecido e ele não inclui algum hotel pedido, sai um evento `warning` logo no início (antes
    do token) e a execução segue — a conta pode ter ganhado acesso desde a última leitura, e quem
    decide é o catálogo lido nesta execução. Conta nunca vista: sem aviso antecipado.
  - Evento novo no contrato: `warning` (aviso ao operador que não muda o estado da execução).
  - **Versão do contrato 1.0.0 → 1.1.0** (constitution III): as mudanças desta revisão só
    acrescentam (evento `warning`, código `execution_already_resumed`) ou mudam o significado de
    um campo sem mudar o formato (`Hotel.available`). Nenhum cliente existia ainda; clientes
    futuros devem tolerar valores novos nos campos de lista fechada (tipo de evento, código de
    erro).
  - **1.1.0 → 1.1.1** (T061, 2026-11-11): só metadados para zerar os avisos do lint — licença
    (uso interno) e descrição das tags. Os tipos gerados não mudam. O `GET /health` fica sem
    resposta 4XX (não exige chave nem recusa nada); a exceção está em
    `packages/contracts/.redocly.lint-ignore.yaml`.
  - Transição: as leituras anteriores a esta mudança não têm conta; o catálogo de cada conta se
    forma na primeira execução dela depois da migration.
  - Alternatives considered: recusar o início quando a conta não acessa algum hotel pedido
    (descartado pelo usuário: só avisar); marcar o hotel sem acesso como `failed` (descartado: a
    retomada já o incluiria, mas o resultado apontaria uma falha que não é falha).
- **Limitações aceitas da estimativa** (revisão de código; medir o erro real na homologação,
  SC-010/T062): com `MAX_PERIOD_DAYS` preenchido, `reservations_total` só soma os blocos já
  consultados (subestima no início); reservas repetidas entre páginas e as "258-" fazem a
  estimativa do hotel em andamento sobrar um pouco. A média histórica é lida a cada consulta de uma
  execução ativa, sem índice próprio: o volume de `execution_hotels` é pequeno (dezenas de linhas
  por dia); criar um índice em `(status, finished_at)` se a consulta ficar lenta.
- **Alternatives considered**: o handler de cancelamento gravar `cancelled` direto no banco
  (atômico, mas o navegador seguiria aberto por até 10 s e a conta ficaria livre para outra
  execução com a sessão antiga ainda ativa); recusar a retomada de execução `completed` (obrigaria
  uma execução nova, que reprocessaria os hotéis já concluídos).

## R-20 — Implantação num PC da rede local e conexão cifrada (FR-028, FR-032, SC-013)

Contexto (clarificação de 2026-11-11, implantação): produção num PC comum da empresa, ligado
manualmente, usado por 2 pessoas em máquinas diferentes da mesma rede; nuvem (AWS) só com a
integração com o Sura. Dois ambientes: desenvolvimento (máquina do dev, Hunit simulado) e produção
(o PC). Sem servidor de homologação separado: o sistema só lê o Hunit (`read-only-guard`).

- **Decision**: um proxy reverso **Caddy** (container `proxy`, imagem oficial com versão fixada)
  recebe o HTTPS na porta `HTTPS_PORT` (padrão 443) de todas as interfaces e repassa para o
  `server` pela rede interna do Compose. O certificado vem da **autoridade certificadora interna do
  Caddy** (`tls internal`), emitido para o nome ou IP do PC (`SERVER_HOSTNAME`). A porta HTTP do
  `server` passa a ser publicada **só em `127.0.0.1`** (uso local: `curl`, testes do operador no
  próprio PC). Os clientes (app desktop, spec 002) confiam no certificado raiz do Caddy, exportado
  uma vez do volume `caddy-data` e configurado em cada máquina.
- **Rationale**: o app manda usuário, senha e token do Hunit e a chave da API ao servidor; em HTTP
  puro, qualquer máquina da rede poderia lê-los. O Caddy emite e renova o certificado sozinho, sem
  domínio público nem acesso à internet, e repassa fluxos SSE sem acumular (necessário para a
  SC-005). O `server` não muda: a cifra fica fora dele, como ficará na AWS (balanceador com
  certificado do provedor), o que atende a FR-028.
- **Alternatives considered**: HTTPS dentro do Fastify com certificado autoassinado (exigiria
  gerar, renovar e distribuir o certificado à mão, e código de TLS no servidor que some na AWS);
  HTTP na rede local (descartado: credenciais do Hunit em texto puro); VPN/túnel (infraestrutura
  maior que o problema para 2 usuários na mesma rede).
- **Consequências operacionais** (README): o PC precisa de IP fixo (reserva no roteador) ou nome
  resolvível na rede; liberar a porta HTTPS no Firewall do Windows; Docker Desktop configurado para
  iniciar com o Windows e o PC sem suspensão enquanto a ferramenta estiver em uso. Trocar
  `SERVER_HOSTNAME` gera um certificado novo, mas o certificado raiz continua o mesmo enquanto o
  volume `caddy-data` existir.
- **Verificação**: teste unitário lê o `docker-compose.yml` e confere que a porta do `server` está
  presa a `127.0.0.1` e que só o `proxy` publica porta em todas as interfaces (mesmo padrão de
  `docker-image-version.test.ts`); no quickstart, `curl` de outra máquina: HTTPS responde, HTTP
  na porta do `server` recusa a conexão.
- **Implementado (2026-11-11, T064/T065)**: imagem `caddy:2.11.9-alpine`; o Caddyfile atende
  `{$SERVER_HOSTNAME}` e `localhost` com `tls internal`, sem instalar a CA no sistema
  (`skip_install_trust`) e sem redirecionamento de HTTP (só a porta HTTPS é publicada).
  `flush_interval -1` deixa explícito o repasse imediato do SSE. Verificado com a imagem real:
  configuração válida para nome, IP e `localhost` (repetido); certificado emitido também para IP;
  eventos SSE chegam ao cliente no momento em que o servidor os envia; certificado raiz em
  `/data/caddy/pki/authorities/local/root.crt` (exportado com `docker compose cp`).

## R-21 — Cópia de segurança e restauração (FR-029, FR-030, FR-031, SC-011, SC-012)

- **Decision**: container `backup` com a **mesma imagem do banco** (`postgres:17`, que já traz
  `pg_dump`, `pg_restore` e `gpg` — verificado em 2026-11-11) rodando um script versionado
  (`deploy/backup/backup.sh`, montado somente leitura). A cada 15 minutos o script olha a cópia
  mais nova na pasta de destino; se ela tiver mais de `BACKUP_INTERVAL_HOURS` (padrão 24) horas, ou
  se não houver nenhuma, faz `pg_dump --format=custom` → `gpg --symmetric --cipher-algo AES256`
  com a senha `BACKUP_PASSPHRASE` → grava num arquivo temporário e renomeia para
  `hunit-AAAAMMDD-HHMMSS.dump.gpg` (nunca deixa cópia pela metade com nome final). Depois apaga as
  cópias com mais de `BACKUP_RETENTION_DAYS` (padrão 30) dias. A pasta de destino é
  `BACKUP_DIR`, montada no container como `/backups`: uma pasta do PC sincronizada com a nuvem
  (ex.: Google Drive para computador) ou um disco externo.
- **Restauração**: `deploy/backup/restore.sh <arquivo>`, rodado com `docker compose run --rm
  backup ...` com o `server` parado: decifra e aplica com `pg_restore --clean --if-exists`. Passo a
  passo no README e validação no quickstart (SC-011).
- **Rationale**: "olhar a idade da cópia mais nova" em vez de horário fixo resolve o PC desligado
  sem lógica extra: ao ligar, a primeira verificação (≤ 15 min) já faz a cópia atrasada (FR-029,
  SC-012). Mesma imagem do banco garante `pg_dump` da mesma versão do servidor. `gpg` simétrico
  com AES-256 cifra e detecta arquivo corrompido ou adulterado (o `openssl enc` cifra, mas não
  detecta). Nada disso entra no `server`, que continua igual na AWS (lá, o backup do RDS substitui
  este container).
- **Alternatives considered**: rotina dentro do `server` (a imagem do Playwright não tem o
  `pg_dump` 17; instalar o cliente do Postgres nela aumenta a imagem e mistura funções); Agendador
  de Tarefas do Windows chamando `docker compose exec` (fica fora do repositório e do Compose, e
  não roda se o horário passar com o PC desligado, sem configuração extra); copiar o volume
  `pgdata` (cópia inconsistente com o banco ligado).
- **O que fica fora das cópias**: evidências (temporárias, FR-025) e o `.env`. Para restaurar num
  PC novo é preciso também o `ACCOUNT_KEY_SECRET` original (sem ele, o controle de "uma execução
  por conta" e o histórico de execuções por conta deixam de bater) e a `BACKUP_PASSPHRASE`: os
  dois ficam guardados pelo responsável fora do PC (ex.: gerenciador de senhas). As chaves dos
  clientes da API estão no banco só como hash, então continuam valendo depois da restauração.
- **A verificar na implementação**: se o Docker Desktop no Windows monta corretamente a pasta
  sincronizada escolhida como `BACKUP_DIR` (unidades de rede mapeadas por letra costumam não
  funcionar; pasta local sincronizada funciona).
- **Implementado (2026-11-11, T066/T067)**:
  - a idade de cada cópia sai da **data no nome** (`hunit-AAAAMMDD-HHMMSS`, UTC), não da data do
    arquivo, que a sincronização com a nuvem pode alterar; o script só toca em arquivos com esse
    padrão de nome, então a pasta pode ter outras coisas;
  - cada cópia é decifrada e conferida com `pg_restore --list` antes de receber o nome final;
    falha no `pg_dump`, no `gpg` ou na conferência não deixa arquivo e não apaga nenhuma cópia
    antiga; a mais nova nunca é apagada pela retenção;
  - a frase vai ao `gpg` por descritor de arquivo (nunca na linha de comando nem na saída);
  - a restauração roda numa única transação (`--single-transaction --exit-on-error`): ou tudo,
    ou nada muda. Como o serviço `backup` tem `entrypoint` próprio, o comando é
    `docker compose run --rm --entrypoint bash backup /scripts/restore.sh <arquivo>`;
  - **verificado no Docker Desktop (Windows)**: uma pasta local do Windows montada como
    `BACKUP_DIR` recebe a cópia e a restauração pelo comando documentado funciona. Falta
    conferir com a pasta sincronizada que for escolhida no PC de produção (homologação, T062).
