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

## R-09 — Limite de tamanho do período no Hunit (FR-010a) — **Verificar no mapeamento**

- **Decision**: o executor divide o período em blocos de até `MAX_PERIOD_DAYS` dias (variável de
  ambiente; sem valor = sem divisão). As reservas dos blocos são unidas e deduplicadas por
  hotel + número antes da gravação do hotel.
- **Rationale**: atende períodos retroativos longos sem depender de saber agora o limite do Hunit.
- **Alternatives considered**: recusar períodos longos (contraria FR-010a).

## R-10 — Autenticação dos clientes (FR-007)

- **Decision**: chave de API por cliente, enviada em `Authorization: Bearer <chave>`. O banco
  guarda apenas o hash SHA-256 da chave, o nome do cliente e o nível (`operator` | `reader`).
  Chaves são criadas por um comando administrativo no servidor e mostradas uma única vez.
- **Rationale**: simples para clientes máquina-a-máquina (Sura) e para o Electron; revogável por
  cliente; nenhuma chave em texto puro no banco.
- **Alternatives considered**: OAuth2 client credentials (exige provedor de identidade — fora do
  escopo); JWT próprio (complexidade de emissão/rotação sem benefício agora).

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

## R-13 — Mapeamento da interface atual do Hunit — **Ação necessária**

- **Decision**: antes de implementar os Page Objects, gravar o fluxo real com
  `npx playwright codegen https://extranet.hunit.com.br/HUNIT/Account/Login` e salvar o HTML das
  telas (login, token, seleção de hotel, filtro/listagem de reservas, detalhe de reserva em cada
  situação: sem pré-pagamento, cobrada, pendente, falha, cancelada). O HTML é **anonimizado** e vira
  fixture em `apps/server/test/fixtures/hunit/`.
- **Rationale**: o legado parou por mudança de UI; nenhum seletor antigo é confiável. Fixtures
  permitem testar os Page Objects sem acessar o Hunit (princípio VII).
- **Responsável**: operador com acesso ao Hunit e ao autenticador (usuário do projeto). As tasks de
  Page Objects dependem dessas fixtures.

## R-13a — Coleta pela tela ou pelas respostas HTTP do Hunit — **Spike pendente**

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
