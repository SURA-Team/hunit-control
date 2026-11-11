# AGENTS.md

Guia operacional para agentes de código (Claude Code, Codex, Copilot etc.) neste repositório.
As regras de projeto estão na constitution: [.specify/memory/constitution.md](.specify/memory/constitution.md).
Em caso de conflito, a constitution prevalece sobre este arquivo.

## Projeto

HUNIT Control automatiza a consulta de reservas e cartões virtuais na extranet do Hunit
(que não tem API pública) via Playwright/Chromium, e expõe tudo por uma API HTTP consumida
por um app desktop Electron e, futuramente, pelo Sura.

Estado atual: **reescrita em andamento**. O sistema antigo (Python/PySide) parou de
funcionar porque o Hunit mudou a UI.

## Idioma

- Conversas, specs, commits e documentação: **português do Brasil**.
- Código (identificadores, nomes de arquivos): inglês. Mensagens exibidas ao usuário: português.

## Estrutura do repositório

| Caminho | Conteúdo |
|---|---|
| `.specify/memory/constitution.md` | Princípios não negociáveis do projeto |
| `.specify/templates/` | Templates de spec, plan, tasks (não editar sem motivo) |
| `specs/NNN-<feature>/` | `spec.md`, `plan.md`, `tasks.md` de cada feature |
| `legacy/` | Sistema antigo — **somente leitura**, referência de comportamento |

O código novo (monorepo TypeScript: API, worker, Electron, tipos compartilhados) ainda não
existe; a estrutura será definida no `plan.md` da primeira feature. Atualize esta tabela
quando ela for criada.

## Fluxo de trabalho (Spec-Driven Development)

1. `/speckit-specify` → descreve **o quê** e **por quê** (sem tecnologia).
2. `/speckit-clarify` (opcional) → resolve ambiguidades da spec.
3. `/speckit-plan` → define **como**; passa pelo Constitution Check.
4. `/speckit-tasks` → quebra em tarefas pequenas e testáveis.
5. `/speckit-analyze` (opcional) → checa coerência entre spec, plan e tasks.
6. `/speckit-implement` → implementa task a task.

Regras:
- Não escreva código de produção sem uma spec correspondente em `specs/`.
- Se a implementação revelar que a spec está errada ou incompleta, **pare e atualize a spec**
  antes de seguir.
- Uma branch por feature; commits pequenos, em português, citando a spec (ex.: `specs/001`).

## Usando o legado como referência

`legacy/` documenta o comportamento esperado; não copie a arquitetura.

- `legacy/README.md` e `legacy/contexto.md`: visão funcional (fluxos, telas, regras).
- `legacy/src/hunit_automation/automation/browser.py`: navegação no Hunit (login, 2FA,
  seleção de empresa/hotel, paginação, abertura de reservas). **Os seletores estão
  desatualizados** — use apenas para entender o fluxo, nunca para copiar seletores.
- `legacy/src/hunit_automation/core/execution.py`: orquestração por hotel e retomada.
- `legacy/src/hunit_automation/core/reservation_classification.py` e `payment_details.py`:
  regras de classificação de reservas e cobrança — candidatos a portar para o domínio.
- `legacy/src/hunit_automation/core/manual_treatments.py`: tratativas manuais
  (enviada/cobrada com comprovante).
- `legacy/tests/`: casos de teste úteis como exemplos de regras de negócio.

Não altere nada dentro de `legacy/`. O histórico completo está em
`github.com/EduardoKipper/automacao-hunit`.

## Segurança e dados (obrigatório)

- **Nunca** leia, imprima, copie ou commite: `legacy/.env`, `legacy/data/`,
  `legacy/config/hotel_mappings.json`, planilhas (`*.xlsx`, `*.csv`), logs ou evidências de
  execução. Contêm dados pessoais e financeiros (hóspedes, cartões virtuais).
- Credenciais, senha e token 2FA do Hunit nunca vão para logs, banco, fixtures ou mensagens
  de erro.
- Fixtures HTML do Hunit usadas em testes devem ser **anonimizadas** antes do commit.
- Antes de cada commit, confira `git diff --cached --name-only` em busca de arquivos sensíveis.

## Hunit (sistema externo)

- Acesso real ao Hunit só com autorização explícita do usuário — ele exige credenciais e
  token 2FA de um humano.
- Interações com o Hunit ficam exclusivamente nos Page Objects; prefira localizadores por
  role/label/texto a CSS/XPath.
- Para mapear a UI nova, peça ao usuário para gravar o fluxo com `npx playwright codegen` ou
  salvar o HTML das páginas (anonimizado).

## Comandos

Ainda não há comandos de build/teste. Documente aqui (instalar, testar, subir containers,
rodar o Electron) assim que forem criados pela primeira feature.
