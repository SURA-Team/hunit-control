# Research: App desktop para operar o HUNIT Control

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-12

Cada item registra a decisão, a justificativa e as alternativas avaliadas. Versões conferidas no
registro do npm em 2026-11-12; a política do `pnpm-workspace.yaml` (versões com 3 dias ou mais)
continua valendo na instalação. Itens marcados **A verificar** dependem do Windows real e são
cobertos pelo [quickstart.md](./quickstart.md).

---

## R-01 — Stack e organização do app

- **Decision**: novo pacote `apps/desktop` no monorepo, com **Electron 45** (Chromium 156,
  **Node 24.22** embutido), **electron-vite 6** (desenvolvimento e build dos três processos, sobre
  **Vite 8**), **React 19.3** e TypeScript `strict`. O código fica separado por processo:
  `src/main` (processo principal, Node), `src/preload` (ponte mínima), `src/renderer` (interface
  React, sem Node) e `src/shared` (tipos e validações do canal entre processos). Os tipos da API vêm
  de `@hunit/contracts` (somente `import type`).
- **Rationale**: a constitution fixa Electron e TypeScript e pede tipos compartilhados entre API e
  Electron. O Node do Electron 45 é da mesma linha (24) usada no resto do monorepo, então o processo
  principal compila com os mesmos tipos e alvo (ES2023). O electron-vite gera os três processos com
  uma configuração só e recarrega a interface na hora durante o desenvolvimento; é a ferramenta
  recomendada pela skill `electron-best-practices`.
- **Alternatives considered**: Electron Forge com o plugin de Vite (empacotador oficial, mas a
  integração com Vite foi experimental por muito tempo e o instalador padrão, Squirrel, instala de
  forma silenciosa e menos conhecida para o usuário — ver R-11); webpack (mais lento e verboso);
  Tauri (fora da constitution, que exige Electron).

## R-02 — Fronteira de segurança entre os processos

- **Decision**: tudo o que é sensível ou acessa rede e disco fica **só no processo principal**:
  endereço e chave da API, certificado do servidor, usuário e senha do Hunit, chamadas HTTP, fluxo
  de eventos, notificações e gravação de arquivos. A interface (renderer) só desenha telas e conversa
  com o principal por uma **API estreita** exposta pelo preload via `contextBridge` — uma função por
  canal, sem expor o `ipcRenderer`, com eventos que devolvem a função de cancelar a inscrição
  (contrato em [contracts/ipc.md](./contracts/ipc.md)). O principal valida **toda** entrada vinda da
  interface com `zod` (já usado no servidor).
  Endurecimento da janela e do processo:
  - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`,
    `spellcheck: false` (evita dicionário pessoal gravado com o que se digita) e `devTools` só fora
    do pacote instalado;
  - política de conteúdo (CSP) na própria página: `default-src 'self'; script-src 'self';
    style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self';
    connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`. A interface não
    faz nenhuma requisição de rede (`connect-src 'none'`); estilos inline são liberados porque a
    biblioteca de componentes injeta variáveis CSS (R-09) — injeção de estilo é de baixo risco,
    scripts continuam travados;
  - navegação para fora do app bloqueada (`will-navigate`), abertura de janelas negada
    (`setWindowOpenHandler`), todas as permissões do navegador negadas
    (`setPermissionRequestHandler`);
  - *fuses* do Electron no pacote (R-11): sem `runAsNode`, sem `NODE_OPTIONS`, sem argumentos de
    inspeção, `asar` só com verificação de integridade.
- **Rationale**: a chave da API dá acesso a dados de hóspedes e a senha do Hunit dá acesso à conta;
  mantê-las fora da interface faz com que um eventual XSS na interface não as alcance. A interface
  sem rede também impede que dados saiam por ela. É o checklist da skill `electron-best-practices`
  (seções 1 a 5) aplicado ao app. Mantém o princípio III: o app não tem regra de negócio, só chama a
  API.
- **Alternatives considered**: a interface chamar a API direto com `fetch` (exigiria a chave na
  interface, CORS no servidor e `connect-src` aberto); `electron-trpc` (tipagem ponta a ponta, mas
  mais uma dependência e um roteador para cerca de 25 funções — o contrato tipado com `zod` basta).

## R-03 — Conexão com o servidor e confiança no certificado (FR-001, FR-002, SC-007)

- **Decision**: o processo principal usa o `fetch` do **undici 8** com um `Agent` cujo `ca` é
  **somente** o certificado raiz do servidor (a autoridade interna do Caddy, feature 001 R-20). A
  verificação TLS é a padrão do Node — cadeia, validade e **nome do servidor** — mas confiando apenas
  nessa raiz: nem certificados públicos nem a loja do Windows são aceitos para o servidor. As
  chamadas tipadas usam `openapi-fetch` com os tipos `paths` de `@hunit/contracts`.
  Configuração em três passos, na tela de configuração: o operador informa o endereço
  (`https://<SERVER_HOSTNAME>`), escolhe o arquivo `hunit-raiz.crt` exportado do servidor (o
  principal lê o arquivo e mostra a impressão digital SHA-256, o emissor e a validade, com
  `crypto.X509Certificate` do Node) e cola a chave da API. "Testar conexão" chama `/v1/health` e
  `/v1/me`; só salva se as duas responderem. Falha de TLS vira o estado "servidor não confirmado",
  sem opção de ignorar.
- **Rationale**: confiar só na raiz própria é o mais estreito possível e não exige instalar nada no
  Windows (nem administrador). A verificação de nome impede que outra máquina da rede com um
  certificado da mesma raiz se passe pelo servidor. `openapi-fetch` deixa o cliente tipado pelo mesmo
  contrato do servidor (princípio III) e aceita um `fetch` próprio. O `fetch` global do Node não
  aceita `Agent` de outra versão do undici, por isso o `fetch` e o `Agent` vêm do mesmo pacote.
- **Alternatives considered**: instalar a raiz na loja de certificados do Windows e usar o
  `net.fetch` do Electron (afeta todos os programas do usuário e depende de passo manual por máquina
  fora do app); `net.fetch` com `setCertificateVerifyProc` para "aceitar se a raiz bater" (fácil de
  errar: a sobreposição também desliga outras verificações, como a do nome); fixar a impressão
  digital do certificado final (o Caddy renova a cada poucas horas).

## R-04 — Chave de acesso guardada protegida (FR-003)

- **Decision**: a chave da API é cifrada com o `safeStorage` do Electron (no Windows, DPAPI:
  só o mesmo usuário do Windows decifra) e gravada cifrada, em base64, no arquivo de configuração
  (`config.json` na pasta de dados do app). Se o `safeStorage` não estiver disponível, o app **não**
  salva a chave e explica o motivo — não existe gravação em texto puro. Trocar ou remover a chave
  regrava o arquivo.
- **Rationale**: DPAPI é o mecanismo nativo do Windows para segredos por usuário e não exige senha
  extra; outro usuário da mesma máquina não consegue ler a chave (FR-003).
- **Alternatives considered**: `keytar`/Gerenciador de Credenciais do Windows (módulo nativo
  abandonado, com script de instalação); `electron-store` com criptografia por senha fixa no código
  (a senha estaria no próprio app, proteção apenas aparente).

## R-05 — Usuário e senha do Hunit na memória (FR-006 a FR-008, clarificação de 2026-11-12)

- **Decision**: um "cofre" em memória no processo principal guarda usuário e senha depois que o
  operador os informa. A interface recebe de volta só o usuário e um indicador "senha guardada" e
  descarta o que digitou; iniciar ou retomar usa o que está no cofre. O cofre se esvazia: ao fechar
  o app; por ação "Limpar acesso"; ou após **8 horas sem ação do operador** (ajustável de 1 a 24 h
  nas preferências). "Ação do operador" é tecla ou clique na janela — a interface avisa o
  principal no máximo uma vez por minuto; eventos em segundo plano (atualizações, fluxo de eventos)
  não contam. Ao esvaziar por inatividade, a próxima tentativa de executar explica o motivo e pede
  de novo.
- **Rationale**: atende ao pedido de não redigitar a cada execução sem deixar a senha por dias numa
  máquina esquecida aberta. Manter a senha só no principal reduz as cópias dela na memória e a tira
  do alcance da interface (R-02).
- **Limite conhecido**: em JavaScript não é possível apagar uma string da memória; "esvaziar"
  significa soltar a referência para o coletor de lixo — o mesmo limite aceito no servidor
  (feature 001, R-12). Por isso o app nunca grava a memória em disco (R-14).
- **Alternatives considered**: manter a senha no estado do React (some ao recarregar a interface e
  fica ao alcance de um XSS); apagar ao bloquear o Windows (descartada na clarificação, opção C).

## R-06 — Tempo real e estado das execuções (FR-015 a FR-019, SC-002)

- **Decision**: o processo principal consome o fluxo de eventos (`GET /executions/{id}/events`,
  SSE) com `eventsource-parser`, mandando `Authorization` e `Last-Event-ID` na reconexão. Os eventos
  servem de **sinal**: ao receber um, o principal avisa a interface, que busca de novo o estado
  completo da execução (`GET /executions/{id}`, no máximo uma vez por segundo). Assim a interface
  nunca recalcula progresso nem contagens a partir de eventos — o estado vem sempre do servidor
  (princípio III).
  - **Execuções desta máquina**: o principal acompanha pelo fluxo todas as execuções ativas
    iniciadas ou retomadas por esta chave (`requestedClient` igual ao nome devolvido por `/me`). Ao
    abrir o app ou reconectar, busca as ativas (`GET /executions?active=true`, R-10) e retoma o
    acompanhamento — inclusive um pedido de token ainda dentro do prazo (FR-019).
  - **Execuções de outras máquinas**: a lista é atualizada a cada 10 s enquanto está na tela; o
    detalhe aberto usa o fluxo de eventos como qualquer outra execução.
- **Rationale**: o servidor já garante o evento `awaiting_2fa` em até 5 s (SC-005 da 001); com o
  fluxo aberto no principal, o aviso chega em segundos mesmo com a janela minimizada (SC-002).
  Buscar o estado em vez de somar eventos evita divergência e lógica duplicada no cliente.
- **Alternatives considered**: só consultas periódicas (atraso ou carga maior); um fluxo global de
  eventos de todas as execuções no servidor (mudança maior na API sem necessidade para 4 usuários).

## R-07 — Aviso do pedido de token (FR-011 a FR-013, SC-002, SC-003)

- **Decision**: quando uma execução **desta máquina** passa a aguardar o token, o principal, no
  mesmo instante: (1) mostra uma notificação do Windows (toast) com som; (2) restaura e mostra a
  janela, deixa-a "sempre por cima" por um instante e pisca o botão na barra de tarefas; (3) manda a
  interface abrir o diálogo do token com o campo em foco e a contagem regressiva; (4) toca um som
  curto dentro do app (desligável nas preferências). A contagem usa o prazo informado pelo servidor
  corrigido pela diferença de relógio, medida pelo cabeçalho `Date` das respostas da API — o relógio
  da máquina pode estar adiantado ou atrasado em relação ao servidor. O diálogo fecha sozinho quando
  a execução sai da espera (token aceito por qualquer caminho, prazo vencido, cancelamento).
  Execuções de outras máquinas não disparam aviso (FR-012), mas o detalhe delas tem o campo de token
  para quem tem perfil operador, porque o servidor aceita o token de qualquer cliente autorizado
  (constitution, princípio IV).
  A notificação do Windows exige a identidade do app (`AppUserModelID`) igual à do atalho criado
  pelo instalador (R-11); fora do app instalado (desenvolvimento) ela pode não aparecer, e o aviso
  dentro do app continua valendo.
- **A verificar no Windows real**: (a) o Windows pode impedir que um programa em segundo plano tome
  o foco do teclado; o efeito garantido é a janela à frente e piscando, e o foco vai para o campo
  do token assim que o operador clica na janela; (b) o app não consegue saber de forma confiável
  se o usuário desativou as notificações do app nas configurações do Windows (o Electron não expõe
  essa informação). Por isso, em vez de "indicar o bloqueio", a configuração oferece **"Testar
  aviso"**, que dispara o aviso completo para o operador conferir. A spec foi ajustada (caso de
  borda e premissa).
- **Rationale**: combina o canal do sistema (visível mesmo com outro programa em foco) com o aviso
  dentro do app (independe das notificações do Windows), cobrindo a janela de 1 a 2 minutos.
- **Alternatives considered**: só a notificação do Windows (pode estar desativada ou no modo "não
  perturbe"); janela "sempre por cima" permanente (atrapalha o trabalho e não resolve o foco).

## R-08 — Servidor indisponível e dados só em memória (FR-005, FR-008a, SC-006)

- **Decision**: a interface usa **TanStack Query 5** como cache **somente em memória** (sem
  persistência) para as respostas que vêm do principal. Quando uma atualização falha por servidor
  indisponível, a última resposta continua na tela com o horário em que foi obtida
  (`dataUpdatedAt`) e o aviso "servidor indisponível"; ações que dependem do servidor ficam
  desabilitadas. O principal mantém o estado da conexão (`conectando`, `online`, `indisponível`,
  `servidor não confirmado`, `chave recusada`, `não configurado`) e, quando indisponível, testa
  `/v1/health` a cada 5 s; ao voltar, a interface refaz as consultas da tela atual (SC-006: até
  30 s).
- **Rationale**: é exatamente o comportamento da clarificação (opção B): nada de reservas em
  disco, mas sem perder o que estava na tela. O TanStack Query já resolve cache, reconsulta,
  tentativas e horário da última resposta, que seria código próprio sujeito a erros.
- **Alternatives considered**: estado manual com `useEffect` (mais código e mais casos de erro);
  cache em disco (descartado na clarificação: dados pessoais espalhados pelas máquinas).

## R-09 — Interface (FR-009, FR-020 a FR-023)

- **Decision**: biblioteca de componentes **Mantine 9** (`@mantine/core`, `@mantine/hooks`,
  `@mantine/dates` com `dayjs` em `pt-br`): seletor de período com datas em DD/MM/AAAA, seleção de
  hotéis com busca, tabelas, diálogos, avisos e tema com as cores de situação. **Sem roteador**: o
  app tem quatro áreas fixas (Executar, Execuções, Reservas, Configuração) num `AppShell`, com
  detalhes em painéis laterais e diálogos — a navegação é um estado simples.
  - Nomes em português e tons de cor de cada situação (cobrança, reserva, execução, hotel e motivos
    de término) ficam numa tabela de apresentação tipada por `Record<Enum, ...>` com os enums de
    `@hunit/contracts`: se o servidor ganhar uma situação nova, a compilação do app falha até ela
    ganhar nome e cor (tabela em [data-model.md](./data-model.md)).
  - Datas e valores com `Intl` em `pt-BR` (`BRL`). O campo de valor da busca aceita "1.234,56" e o
    converte para o formato da API ("1234.56") — conversão de formato, não regra de negócio.
- **Rationale**: o Mantine traz pronto o que a spec pede (período em pt-BR, seleção múltipla com
  busca, componentes acessíveis por teclado) com uma dependência só, menos código próprio do que
  montar componente por componente (princípio VIII). Sem roteador porque não há links nem
  histórico a preservar.
- **Alternatives considered**: shadcn/ui com Tailwind (componentes copiados para o projeto e
  calendário montado à parte — mais arquivos para manter; boa opção se o visual personalizado
  virar prioridade); React Router (sem necessidade para quatro áreas fixas).

## R-10 — O que a API ganha nesta feature (contrato 1.3.0 → 1.4.0)

A implementação revelou que a API da 001 não cobre quatro necessidades da spec 002. Todas são
**acréscimos compatíveis** (versão MINOR do contrato; nada existente muda de comportamento).
Detalhes em [contracts/api-changes.md](./contracts/api-changes.md).

| Necessidade (spec 002) | Acréscimo |
|---|---|
| Perfil da chave e nome do cliente (FR-004, FR-012) | `GET /v1/me` → `{ name, role }` |
| Quem iniciou, na lista de execuções (FR-015) e execuções ativas desta máquina (FR-019) | `ExecutionSummary.requestedClient`; filtro `active` em `GET /v1/executions` |
| Busca livre, canal e valor (FR-020, FR-020a, FR-020b) | parâmetros `q`, `channel` e `amount` em `GET /v1/reservations`; `GET /v1/channels` |
| Evidências de uma execução (FR-024) | `GET /v1/executions/{id}/evidence` |

- **Decision (busca)**: no servidor, `q` (2 a 100 caracteres, sem espaços nas pontas) encontra a
  reserva se **qualquer** destes bater: número da reserva, transação, código de autorização ou
  referência da operadora **iguais** ao texto (sem diferenciar maiúsculas); ou o nome do hóspede
  **contendo** o texto, sem diferenciar maiúsculas e acentos (`unaccent` do PostgreSQL, com uma
  migration que cria a extensão). `amount` (formato da API, "1234.56") encontra reservas cujo valor
  total **ou** valor cobrado seja igual. `channel` é igualdade exata; `GET /v1/channels` devolve os
  canais existentes para o filtro. Reservas anonimizadas não são encontradas pelo nome (FR-026 da
  001).
- **Decision (evidências)**: hoje o identificador da evidência só aparece dentro do texto da
  mensagem do evento `evidence_recorded`; ler esse texto no app seria frágil. A rota nova lista as
  evidências da execução com hotel, reserva, motivo, arquivos disponíveis e validade.
- **Rationale**: o princípio III exige que toda funcionalidade passe pela API; filtrar no app
  exigiria baixar todas as reservas. Volume estimado: algumas centenas de milhares de reservas em 5
  anos; comparações sem índice novo respondem em poucas centenas de milissegundos. **Medir** na
  homologação; se ficar lento, um índice de trigramas no nome resolve sem mudar o contrato.
- **Alternatives considered**: busca de texto completo (`tsvector`; complexidade sem ganho para
  nomes e códigos); filtro no cliente (viola o princípio III e baixa dados pessoais demais);
  status múltiplo em `listExecutions` em vez de `active` (o servidor já sabe o que é "ativa";
  o cliente não precisa repetir essa regra).

## R-11 — Empacotamento e distribuição (FR-025)

- **Decision**: **electron-builder 26** gera um instalador **NSIS por usuário** (`oneClick`,
  `perMachine: false`): instala em `%LOCALAPPDATA%` **sem administrador**, cria atalho no Menu
  Iniciar com a identidade do app (`appId` = `AppUserModelID`, necessária às notificações, R-07).
  Nome do produto: "HUNIT Control"; `appId`: `io.github.sura-team.hunit-control`.
  - Todas as bibliotecas do app são **empacotadas pelo Vite** dentro do código gerado; o
    `package.json` do app não tem `dependencies` de execução, então o electron-builder não precisa
    copiar `node_modules` — o que evita os problemas conhecidos dele com a estrutura de links do pnpm.
  - *Fuses* pela opção `electronFuses` do electron-builder (conferido no esquema da versão 26.18):
    `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`,
    `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`,
    `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true`.
  - O pacote `electron` baixa o binário num script de instalação: entra em `allowBuilds` do
    `pnpm-workspace.yaml` com justificativa (é a origem oficial e o download confere o checksum).
  - **Sem assinatura de código**: com 4 máquinas internas, o certificado de assinatura não se paga.
    Consequência: na primeira execução o Windows SmartScreen mostra "O Windows protegeu o
    computador"; o guia de instalação explica "Mais informações → Executar assim mesmo". Reavaliar
    se o Comercial entrar.
  - Atualização: novo instalador entregue manualmente (premissa da spec); sem atualização
    automática, o que também elimina o vetor de ataque de atualização.
- **Rationale**: o NSIS é o instalador mais conhecido no Windows e o modo por usuário dispensa a TI
  para instalar. As *fuses* fecham caminhos de abuso do binário do Electron (rodar como Node,
  injetar opções, inspecionar o processo que guarda a senha).
- **Alternatives considered**: Electron Forge com Squirrel (instalação silenciosa e atalhos menos
  previsíveis); MSIX (exige assinatura); assinatura com certificado comercial (custo anual sem
  necessidade para 4 máquinas).

## R-12 — Testes (princípio VII)

- **Decision**: três grupos novos no `vitest.config.ts`, mais testes de contrato no servidor:

  | Grupo | O que cobre | Dependências |
  |---|---|---|
  | `desktop` | processo principal: configuração e chave cifrada (`safeStorage` simulado), cofre e inatividade (relógio simulado), cliente da API com TLS fixado contra um servidor HTTPS local com autoridade gerada no teste (SC-007: raiz errada, nome errado e certificado válido são testados), validação de toda entrada da interface, fluxo de eventos com reconexão e `Last-Event-ID` | nenhuma externa |
  | `desktop-ui` | interface com Testing Library em `jsdom`: todos os valores dos enums têm nome e cor, diálogo do token e contagem regressiva, aviso de dados antigos, perfil consulta sem ações de operador (SC-009), conversão do campo de valor | nenhuma externa |
  | `desktop-e2e` | o app empacotado pelo electron-vite aberto pelo Playwright (`_electron`) contra um servidor de teste: API da 001 com `FakeHunitGateway` programável e PostgreSQL do Testcontainers, atrás de um terminador TLS com certificado gerado no teste. Cenários das três histórias, servidor caindo e voltando (SC-006) e varredura da pasta de dados do app atrás de senha, token e nomes de hóspedes (SC-004) | Docker (como o `server-db`) |

  - O servidor ganha testes de contrato (`server-db`) para cada acréscimo do R-10.
  - Certificados de teste gerados em tempo de execução com `@peculiar/x509` — nada de chave privada
    versionada (o `.gitignore` já bloqueia `*.pem` e `*.key`).
  - O E2E usa o app compilado sem as *fuses*: o Playwright precisa do argumento de inspeção que as
    *fuses* desligam no instalador. As *fuses* são conferidas por um teste que lê a configuração do
    electron-builder.
  - A notificação do Windows é verificada no E2E substituindo `Notification` no processo principal
    pelo `electronApp.evaluate` do Playwright; o efeito real no Windows fica no quickstart.
- **Rationale**: mantém o padrão do projeto (Vitest para tudo, grupos por dependência externa) e as
  camadas do princípio VII; a skill `playwright-best-practices` orienta os testes de ponta a ponta.
- **Alternatives considered**: `@playwright/test` como segundo executor de testes (o projeto já
  padronizou no Vitest com a biblioteca do Playwright); testar só manualmente (não cobre SC-004 e
  SC-007 a cada mudança).

## R-13 — Janela, instância única e fechamento (FR-026, FR-027)

- **Decision**: `app.requestSingleInstanceLock()` — uma segunda abertura traz a janela existente
  para a frente. Fechar a janela encerra o app (sem ícone na área de notificação); antes, se houver
  execução ativa desta máquina, um diálogo avisa que ela continua no servidor mas o pedido de token
  não será recebido com o app fechado. Ao encerrar, o cofre é esvaziado.
- **Rationale**: atende à clarificação de 2026-11-12 (o comportamento de "só sair pela área de
  notificação" do legado incomodava). A execução roda no servidor, então fechar o app não a
  interrompe.

## R-14 — O que o app grava no disco (FR-003, FR-007, FR-008a, SC-004)

- **Decision**: o app grava somente o `config.json` (endereço, certificado raiz — público —,
  chave cifrada e preferências). Nenhum arquivo de registro (*log*) no pacote instalado — os erros
  são mostrados na tela com um código; no desenvolvimento, só no console. A interface não usa
  `localStorage`, `sessionStorage` nem IndexedDB (regra de lint no renderer). Evidências só são
  gravadas onde o operador escolher no diálogo "Salvar como".
- **A verificar na implementação**: se o Electron 45 grava *minidumps* de falha
  (`app.getPath('crashDumps')`) mesmo sem `crashReporter.start()` — eles podem conter a memória do
  processo, inclusive a senha. Se gravar, o app esvazia essa pasta ao iniciar e a varredura do
  SC-004 inclui a pasta. O app nunca chama `crashReporter.start()`.
- **Rationale**: o princípio VI proíbe credenciais em registros, e a clarificação proíbe reservas
  em disco; não ter arquivo de registro elimina a classe inteira de vazamento. Diagnóstico de falhas
  do servidor continua nos registros do servidor.
- **Alternatives considered**: `electron-log` com filtro de dados sensíveis (um filtro esquecido
  basta para vazar).

## R-15 — Onde fica o contrato da API nas specs

- **Decision**: `packages/contracts/openapi.yaml` continua sendo a fonte da verdade. A partir desta
  feature, a cópia espelhada vai para `specs/002-app-desktop/contracts/openapi.yaml` (versão 1.4.0);
  a cópia de `specs/001-consulta-reservas-hunit/contracts/` fica congelada como o contrato que a
  001 entregou (1.3.0). O `AGENTS.md` passa a dizer "copie para a pasta `contracts/` da feature em
  andamento".
- **Rationale**: cada spec documenta o contrato que entregou; reescrever o artefato da 001 com
  mudanças da 002 apagaria esse histórico.
