# HUNIT Control Constitution

Reescrita da automação HUNIT. O sistema legado (Python/PySide) em `legacy/` serve apenas como
referência de comportamento; nenhum código novo pode depender dele.

## Core Principles

### I. Spec-First

- Todo comportamento novo ou alterado MUST começar por uma spec em `specs/NNN-<nome>/`
  antes de qualquer código.
- Código que diverge da spec é bug. Se o comportamento desejado muda, a spec MUST ser
  atualizada antes do código.
- Specs descrevem **o quê** e **por quê**; decisões de **como** ficam no `plan.md`.

**Justificativa**: o Hunit muda sem aviso; specs estáveis separam o que o sistema faz de
como ele interage com a UI, tornando correções localizadas e rastreáveis.

### II. Isolamento da UI do Hunit (Page Objects)

- O Hunit não tem API pública. Todo seletor e toda interação com páginas do Hunit MUST
  ficar exclusivamente na camada de Page Objects.
- Regras de negócio, jobs e a API MUST NOT referenciar seletores, URLs internas ou
  estrutura HTML do Hunit.
- Seletores SHOULD preferir localizadores semânticos (role, label, texto visível) a
  CSS/XPath acoplados à estrutura.
- Falha de seletor ou de navegação MUST gerar erro explícito e tipado, acompanhado de
  screenshot e HTML da página como evidência. Falhas silenciosas são proibidas.

**Justificativa**: a quebra que motivou esta reescrita foi uma mudança de UI do Hunit;
mudanças futuras devem exigir alterações apenas nos Page Objects.

### III. API-First com Contrato

- Toda funcionalidade MUST ser exposta pela API HTTP/JSON.
- O contrato OpenAPI é versionado no repositório e é a fonte da verdade da integração;
  mudanças incompatíveis MUST incrementar a versão da API.
- O app Electron e, futuramente, o Sura são clientes da mesma API. O Electron MUST NOT
  conter lógica de negócio nem acessar diretamente o banco ou o navegador automatizado.

**Justificativa**: integração com o Sura independe de linguagem; um contrato único
evita que desktop e integrações divirjam.

### IV. Jobs Assíncronos com Intervenção Humana

- Automações MUST rodar como jobs com estados explícitos: `queued`, `running`,
  `awaiting_2fa`, `completed`, `failed`, `cancelled`.
- O login no Hunit exige token 2FA informado por um operador humano: o job MUST pausar
  em `awaiting_2fa` e aceitar o token de qualquer cliente autorizado (Electron ou Sura),
  com tempo limite definido em spec.
- Jobs MUST ser retomáveis a partir do último hotel concluído.
- No máximo uma automação MUST rodar por vez para a mesma conta/sessão do Hunit.

**Justificativa**: execuções levam minutos e dependem de um humano; requisições
síncronas e concorrência na mesma conta causam falhas e dados inconsistentes.

### V. Servidor Central e Containers

- API, worker (Playwright/Chromium headless) e PostgreSQL MUST rodar em containers
  Docker, orquestrados por Docker Compose, num servidor central.
- Configuração MUST vir exclusivamente de variáveis de ambiente.
- Caminhos específicos de sistema operacional e estado em disco fora de volumes
  declarados são proibidos.

**Justificativa**: o Sura só consegue integrar com uma API acessível em rede; containers
garantem o mesmo ambiente em desenvolvimento e produção.

### VI. Dados e Segurança (NÃO NEGOCIÁVEL)

- PostgreSQL é a fonte da verdade. Arquivos XLSX são exportações geradas sob demanda e o
  Google Sheets é uma projeção sincronizada para o comercial; nenhum deles MUST ser lido
  como fonte da verdade.
- Dados de reservas e cartões virtuais são pessoais e financeiros. Credenciais, senha e
  token 2FA MUST trafegar apenas em memória e MUST NOT aparecer em logs, banco,
  evidências ou mensagens de erro.
- Segredos MUST vir de variáveis de ambiente ou secrets; dados operacionais, evidências e
  segredos MUST NOT ser versionados no Git.
- Todo cliente da API MUST se autenticar com credencial própria (API key ou token).

**Justificativa**: vazamento de dados de cartões e hóspedes tem impacto legal (LGPD) e
financeiro direto.

### VII. Testes em Camadas

- Lógica de domínio MUST ter testes unitários.
- Endpoints MUST ter testes de contrato validados contra o OpenAPI.
- Page Objects MUST ser testados contra fixtures HTML salvas do Hunit, permitindo
  detectar quebras de UI sem acessar o Hunit real. Fixtures MUST ser anonimizadas.
- Testes são escritos junto com a implementação de cada task; uma task não está
  concluída sem seus testes passando.

**Justificativa**: a automação depende de um sistema externo instável; testes por camada
apontam rapidamente se a falha é de domínio, de contrato ou de UI.

### VIII. Simplicidade

- Cada entrega começa pelo menor fluxo ponta a ponta que gera valor (YAGNI).
- Nenhuma abstração, serviço ou infraestrutura MUST ser adicionada sem necessidade
  descrita numa spec; exceções MUST ser justificadas na seção de complexidade do plan.

**Justificativa**: o legado acumulou modos e caminhos alternativos (XLSX, Sheets, modos
de execução) que aumentaram o custo de manutenção.

## Restrições Técnicas

- **Linguagem**: TypeScript em todo o projeto, sobre Node.js LTS.
- **Estrutura**: monorepo com pacote de tipos compartilhados entre API e Electron.
- **API**: Fastify, com contrato OpenAPI.
- **Automação**: Playwright com Chromium; o worker usa a imagem oficial do Playwright.
- **Banco**: PostgreSQL.
- **Desktop**: Electron, consumindo apenas a API.
- **Observabilidade**: logs estruturados em JSON, com id de job e hotel, sem dados
  sensíveis.

## Fluxo de Desenvolvimento

- Uma branch por feature, seguindo specify → (clarify) → plan → tasks → implement.
- Todo `plan.md` MUST passar pelo Constitution Check antes de gerar tasks; violações
  MUST ser corrigidas ou justificadas por escrito.
- Commits pequenos, em português, referenciando a spec correspondente.

## Governance

- Esta constitution prevalece sobre qualquer outra prática ou documento do projeto.
- Emendas MUST ser feitas neste arquivo, com justificativa, data e incremento de versão
  semântica:
  - MAJOR: remoção ou redefinição incompatível de princípio;
  - MINOR: novo princípio ou seção, ou expansão material de orientação;
  - PATCH: esclarecimentos e correções de redação.
- Toda revisão de plan, tasks e código MUST verificar conformidade com estes princípios.
- Orientações operacionais para agentes de código ficam em `AGENTS.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-11 | **Last Amended**: 2026-11-11
