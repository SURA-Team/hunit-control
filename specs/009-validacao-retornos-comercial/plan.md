# Implementation Plan: Validação dos retornos do Comercial

**Branch**: `009-validacao-retornos-comercial` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-validacao-retornos-comercial/spec.md`

## Summary

O Comercial passa a escrever a situação real da cobrança. Com a situação e o responsável, o retorno vai para
o Financeiro, que decide: "Confirmar como cobrada", "Confirmar como cancelada sem cobrança" ou "Recusar". Só
"Cobrada na maquininha" continua exigindo código, hotel, valor e data. As linhas que esperam o Financeiro (ou a
verificação no Hunit) há 10 minutos saem de "A cobrar" para a aba nova "Aguardando validação do Financeiro",
só para consulta.

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Leitura** (domínio): `readReturn` decide o que é exigido pela situação reconhecida; a situação livre vira a
  leitura nova `situation`, com código, hotel, valor e data opcionais (R-02).
- **Situação livre = retorno do Comercial** com tipo `other` e campos opcionais ("retorno de situação"). Assim
  "Confirmar como cobrada" reaproveita tudo o que faz de um retorno confirmado um comprovante. Os campos e as
  rotas que os apps 0.3 a 0.5.1 usam não mostram nem aceitam esse retorno; o app novo lê campos novos (R-03).
- **Decisões**: uma rota nova (`situation/confirm`, com `as: charged | no_charge`). Sem valor do Comercial, o
  valor digitado vira o valor informado à mão da 003; a cancelada reusa a marcação da 008, e desfazer a devolve
  para validar (R-04, R-05).
- **Aba nova**: projeção do estado, como as outras duas. Uma função pura do domínio decide a aba pela validação
  e pelo `read_at` da versão aguardando; o sincronizador só troca o alvo. O `setup` cria a aba protegida, e a
  planilha sem ela fica "Formato alterado" (R-06).
- **Contrato 1.11.0 → 1.12.0**, só acréscimos, sem valor novo em enum congelada; app 0.6.0 (R-01,
  [contracts/api-changes.md](./contracts/api-changes.md)).
- **Telas**: "Retornos a validar", a gaveta e dois diálogos, com os componentes que já existem até o desenho da
  UX chegar (R-08).

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`); Node 24 no servidor; Electron e React do app sem mudança de
versão

**Primary Dependencies**: as que já existem — Fastify, Drizzle e googleapis no servidor; Mantine, TanStack
Query e electron-vite no app. Nenhuma dependência nova

**Storage**: PostgreSQL — uma migration: três colunas de `commercial_returns` passam a aceitar nulo, uma coluna
nova (`no_charge_mark_id`) e duas restrições novas ([data-model.md](./data-model.md)). Nenhum enum novo

**Testing**: Vitest nos grupos que já existem — `domain`, `contracts`, `server`, `server-db`, `desktop-ui`,
`desktop-e2e` (R-09)

**Target Platform**: servidor Linux em container; app Windows 10/11 x64, de 960 × 640 a monitores grandes

**Project Type**: web-service + desktop-app (monorepo)

**Performance Goals**: "Retornos a validar" e as contagens em até 1 s com 20 000 reservas (meta da 006); a
decisão em até 1 s de resposta da API (SC-004 pede menos de 1 minuto para a pessoa toda); a rodada da planilha
no tempo de hoje (a aba nova só acrescenta comparações na memória)

**Constraints**: Hunit só leitura (lista de rotas sem mudança); apps 0.3 a 0.5.1 funcionando contra a 1.12.0
sem confirmar uma situação livre por engano; planilha sem dado do hóspede; servidor antes do app e `setup` logo
depois do servidor; linha muda de aba só depois de 10 minutos sem mudança; dados fictícios em prints e testes

**Scale/Scope**: 3 telas alteradas (7.8, 7.5 e o card "Comercial" da reserva) e 2 diálogos novos; 1 rota nova, 3 rotas com comportamento novo; 1 schema
novo e 3 campos novos na API; 1 aba nova na planilha; 4 usuárias no app e o Comercial na planilha

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec com as sugestões S1 a S7 decididas no clarify (27/11); nenhum `[NEEDS CLARIFICATION]`. A PM ainda revisa a spec ("Com a PM" no doc): se ela trocar uma decisão, a spec muda antes do código | ✅ |
| II | Isolamento do Hunit | Nada muda na camada do Hunit; a verificação de "Cobrada no Hunit" continua a da 008 | ✅ |
| III | API-First com Contrato | Decisões pela API 1.12.0; só acréscimos; os apps antigos não recebem a situação livre como retorno comum e as rotas antigas a recusam (R-03); o app só apresenta: regras no domínio e no servidor | ✅ |
| IV | Jobs Assíncronos com Intervenção Humana | Nenhum job novo; a aba é calculada nas rodadas que já existem | ✅ |
| V | Servidor Central e Containers | Nenhum serviço, variável ou volume novo | ✅ |
| VI | Dados e Segurança | PostgreSQL continua a fonte da verdade (a aba é projeção; K a P na aba nova são restaurados do banco); nada do hóspede vai para a planilha; o texto livre continua apagado na anonimização | ✅ |
| VII | Testes em Camadas | Domínio em tabela; rotas com testes de contrato; sincronizador com o gateway em memória e relógio simulado; paridade do valor cobrado; telas e jornada no app (R-09) | ✅ |
| VIII | Simplicidade | Nenhum estado de linha, enum, coluna de aba ou gatilho novo: a aba é derivada; as decisões reusam a confirmação, o valor à mão e a marcação | ✅ |

**Resultado pré-Fase 0**: aprovado.

**Resultado pós-Fase 1** (após data-model e contratos): aprovado. O ponto de atenção é a compatibilidade dos
apps antigos com retornos sem código, hotel ou valor: ela fica nos campos novos e nos 409 (R-03), com teste de
contrato.

## Project Structure

### Documentation (this feature)

```text
specs/009-validacao-retornos-comercial/
├── spec.md              # spec (rascunho para a PM) + clarificações de 27/11
├── plan.md              # este arquivo
├── research.md          # decisões técnicas (Fase 0)
├── data-model.md        # banco, domínio, estados e aba da linha (Fase 1)
├── quickstart.md        # testes, homologação, Figma e produção (Fase 1)
├── contracts/
│   ├── api-changes.md   # API 1.11.0 → 1.12.0 (Fase 1)
│   ├── sheet-layout.md  # aba nova e o que cada situação exige (Fase 1)
│   ├── ipc.md           # acréscimo à ponte do app (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.12.0 (criado na implementação)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
packages/domain/src/
├── commercial-return.ts      # readReturn por situação; leitura `situation`; isSituationReturn; snapshot com campos opcionais
├── commercial-sheet.ts       # aba awaitingValidation; AWAITING_TAB_DELAY_MINUTES; sheetTabOf
└── index.ts
packages/domain/test/         # commercial-return.test.ts, commercial-sheet.test.ts

packages/contracts/openapi.yaml     # 1.12.0 (contracts/api-changes.md)
packages/contracts/src/generated.ts # regenerado

apps/server/src/
├── persistence/schema.ts                   # commercial_returns: nulos, no_charge_mark_id, restrições
├── persistence/migrations/                 # NOVO — 0015 (db:generate)
├── persistence/commercial-returns-repo.ts  # grava a leitura `situation`; confirmSituationReturn (charged / no_charge); recusa do /confirm antigo e do lote
├── persistence/no-charge-repo.ts           # desfazer devolve o retorno de situação para validar
├── persistence/treatments-repo.ts          # treatmentFlags: valor nulo do retorno confirmado
├── persistence/commercial-repo.ts          # SheetLineSource com o read_at da versão aguardando
├── persistence/reservations-repo.ts, reports-repo.ts  # valor cobrado com retorno sem valor (R-05)
├── commercial-sheet/gateway.ts, google-sheet-gateway.ts, memory-sheet-gateway.ts  # terceira aba (setup, proteção, aparência)
├── commercial-sheet/sheet-appearance.ts    # aparência de "A cobrar" na aba nova
├── commercial-sheet/layout.ts, command.ts  # aba que falta; check
├── commercial-sheet/sync.ts                # alvo por sheetTabOf; K a P restaurados na aba nova
└── http/handlers/commercial.ts, http/commercial-views.ts  # rota nova, situationReturn(s), sheetTab, currentReturn sem retorno de situação
apps/server/test/
├── unit/                    # handlers e enums congelados
├── contract/                # 1.12.0
└── integration/             # migration, retorno de situação, paridade, sincronizador e setup (server-db)

apps/desktop/
├── package.json             # 0.6.0
└── src/
    ├── shared/ipc-types.ts, ipc-schemas.ts, ipc-channels.ts   # contracts/ipc.md
    ├── main/commercial-handlers.ts, api-client.ts
    ├── preload/index.ts
    └── renderer/src/
        ├── presentation/labels.ts                 # selo "Outra situação", aba nova, erros
        ├── screens/commercial/ReturnsTab.tsx      # linha da situação livre e as três ações
        ├── screens/commercial/SituationReturnDialogs.tsx  # NOVO — "Confirmar como cobrada" e "como cancelada sem cobrança"
        └── screens/reservations/CommercialSection.tsx     # gaveta: situação livre e aba da linha
apps/desktop/test/                                 # renderer (telas e diálogos), e2e (jornada e captura)

AGENTS.md    # contrato 1.12.0 e cópia em specs/009; parágrafo da feature 009
README.md    # Planilha do Comercial: aba nova e regra da situação; atualização com o setup
```

**Structure Decision**: nenhum pacote ou app novo. As regras ficam em `packages/domain`; o servidor estende o
repositório dos retornos e o sincronizador; o app ganha um arquivo de diálogos e muda duas telas.

## Fluxos de referência

### Retorno da planilha → o que acontece

```text
Planilha "A cobrar" (K..P) ──rodada──► readReturn (domínio)
   empty ───────────────► nada
   complete (maquininha) ► commercial_returns awaiting_validation ─────────────► "Retornos a validar" (Confirmar)
   situation (livre) ────► commercial_returns awaiting_validation, kind other ─► "Retornos a validar" (3 decisões)
   report cancelada ─────► commercial_reports (validação) ──────────────────────► "Retornos a validar"
   report hunit ─────────► commercial_reports ──────────────────────────────────► fila "Cobradas no Hunit"
   incomplete/illegible ─► return_problem ──────────────────────────────────────► "Retornos com problema"
```

### Aba da linha (a cada rodada)

```text
sheetTabOf(lineState, validation, awaitingSince = read_at da versão aguardando, now)
   concluded/cancelled ───────────────────────────────► Concluídas
   open + aguardando (Financeiro ou Hunit) + ≥ 10 min ► Aguardando validação do Financeiro (protegida; K..P restaurados)
   open + o resto ────────────────────────────────────► A cobrar
mudou de aba ─► acrescenta no destino copiando K..P e apaga a de origem (mecanismo de hoje)
```

### Decisão sobre um retorno de situação

```text
App (operador) ─► POST /commercial-returns/{id}/situation/confirm
   as=charged   ─► state confirmed (comprovante) [+ valor à mão se o Comercial não informou] ─► linha "Concluídas"
   as=no_charge ─► markNoChargeTx + state closed (no_charge_mark_id) ─► linha "Concluídas"
                    desfazer a marcação ─► awaiting_validation (mesma leitura)
Recusar ─► POST /commercial-returns/{id}/reject (como hoje) ─► J "Recusado…", linha em "A cobrar"
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| App antigo confirmar uma situação livre como retorno da maquininha | Comprovante com valor errado | `currentReturn` nulo, `/confirm` com 409 e fora do lote (R-03), com teste de contrato |
| `charged_amount` nulo num lugar que contava com ele | Valor cobrado ou relatório errado | R-05: domínio e SQL tratam o nulo; teste de paridade lista × detalhe × relatório |
| Linha some enquanto o Comercial digita | Retorno digitado na linha errada | Só muda de aba depois de 10 minutos sem mudança (S7); a aba nova é protegida |
| Planilha sem a aba até o `setup` | Envios e retornos param de ir para a planilha | `setup` é o passo 3 da produção (quickstart §4); o app mostra "Formato alterado" |
| "Cancelada" sem responsável que aguardava validação na atualização | Continua em "Retornos a validar" com a coluna J pedindo o responsável | Decidido (R-07, opção A): fica como a regra da 005 e a spec foi ajustada; aviso ao Comercial antes da produção (quickstart §4) |
| PM trocar uma das decisões S1 a S7 | Retrabalho | A spec está "Com a PM"; cada decisão está isolada (S1 no repositório e nas telas, S7 numa constante) |
| Telas sem o desenho da UX | Diferença do design | R-08: pedir o desenho antes das tarefas de tela; componentes que já existem; comparação com os prints |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
