# Specification Quality Checklist: Ajustes de cobrança e do aviso de token

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Removida só a regra "só confirma cobrança de ontem ou antes" (informação errada): a situação e a data da cobrança continuam, apenas informativas; a tela de bloqueio 7.16 fica de fora.
- Cenário de borda "Cancelada sem cobrança…" cita FR-018; revisar na clarificação se as reservas com retorno em andamento devem mesmo recusar a ação (suposição registrada).
- Pontos para `/speckit-clarify`, se desejado: regra exata de quais classificações aceitam "Cancelada sem cobrança" e se a 005 já entrega a marcação "Cobrada no Hunit".
- 2026-11-19 (plano): as quatro perguntas abertas foram respondidas pelo usuário e registradas nas clarificações (sessão "plano"); corrigida a premissa de que a 005 já tinha a marcação "Cobrada no Hunit" (não tinha: situação e data da cobrança são colunas novas); a fila passa a contar também as leituras feitas por execuções; entrou a história 6 (ícone na barra de tarefas e busca pelo teclado nos filtros, FR-027, FR-028, SC-009, SC-010). Nenhum marcador [NEEDS CLARIFICATION] restante.
- 2026-11-19 (plano, depois): entrou a história 7 (busca pelo código de autorização do retorno do Comercial confirmado; item 1 do doc de ajustes, autorizado pela PM), com FR-029 e SC-011.
- 2026-11-19 (análise): regra da fila decidida pelo usuário (só "Confirmada no Hunit" quando o Hunit mostra a cobrança; senão, "Recusado pelo Financeiro: cobrança não encontrada no Hunit" na planilha); FR-022 reescrito (comprovante), escopo, marcação no Figma (FR-024, SC-008), 7 dias da fila (FR-013), relato "Não cobrada" de reserva marcada (FR-020); bug do destaque da linha (FR-030, história 6).
- 2026-11-19 (2ª análise): ciclo de vida dos relatos (não encontradas sem exigir cobrança saem da fila em 7 dias e não são conferidas de novo; "Não cobrada" só com a linha em "A cobrar" e sem marcação), resultado da verificação `not_found` (era `still_pending`) e história 6 com os três incômodos.
