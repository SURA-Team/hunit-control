# Data model: Redesign visual do app desktop

A feature não cria entidades nem muda o banco (spec, "Key Entities"): nenhuma tabela, coluna,
enum do PostgreSQL ou migration. O que há de modelo é a regra dos filtros rápidos (domínio), a
resposta das contagens (contrato) e o estado de tela que precisa sobreviver ao redimensionamento.

## 1. Filtros rápidos (domínio)

`packages/domain/src/quick-filters.ts` (novo), exportado pelo `index.ts`:

```ts
export const QUICK_FILTERS = ['pending_charge', 'to_review', 'with_error', 'done'] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

export function quickFiltersOf(input: {
  pendingCharge: boolean;                       // isPendingCharge(...) — "Falta cobrar" da 003
  needsReview: boolean;                         // needsReview(...) — alerta "Verificar" da 003
  detailedSituation: ReservationDetailedSituation; // detailedSituation(...) — 005
}): QuickFilter[];
```

| Grupo | A reserva está nele quando |
|---|---|
| `pending_charge` | `pendingCharge` |
| `to_review` | `needsReview`, ou `detailedSituation` é `not_virtual_card` ("A revisar (sistema anterior)") ou `return_pending` ("Validar comprovante") |
| `with_error` | `detailedSituation` é `virtual_card_charge_error` ou `analysis_error` |
| `done` | `detailedSituation` é `proof_sent`, `invoiced`, `virtual_card_already_charged`, `cancelled_no_charge` ou `ignored_hotelbeds_258` |

Exemplos que os testes unitários cobrem:

| Reserva | Grupos |
|---|---|
| Pendente de cobrança, sem tratativa | `pending_charge` |
| Tratativa enviada com retorno do Comercial aguardando ("Validar comprovante") | `pending_charge`, `to_review` |
| Tratativa enviada e o Hunit passou a "Já cobrada" (alerta "Verificar") | `to_review`, `done` |
| "A revisar (sistema anterior)" | `to_review` |
| Erro na cobrança ou erro de análise, sem comprovante | `with_error`, `pending_charge` (as duas exigem cobrança) |
| Cobrar na maquininha, sem comprovante | `pending_charge` |
| Faturada, sem tratativa | `done` |
| Comprovante enviado | `done` |

Pelas regras atuais, toda reserva cai em pelo menos um grupo: sem comprovante, as classificações que
exigem cobrança estão em "Falta cobrar", "A revisar (sistema anterior)" está em "A verificar" e as
demais estão em "Concluídas"; com comprovante, em "Concluídas". A regra continua dizendo "a reserva
fora de todos os grupos aparece só em Todas" (spec FR-016) para o caso de uma classificação nova.

A tabela acima segue as regras atuais de `isPendingCharge`, `needsReview` e `requiresCharge`; se um
exemplo divergir delas na implementação, vale a regra do domínio e o exemplo é corrigido aqui.

No servidor, cada grupo vira uma condição SQL montada com as condições que já existem em
`reservations-repo.ts` (research R-09); o teste de paridade garante que SQL e domínio dizem o mesmo.

## 2. Contagens (contrato)

`ReservationQuickFilterCounts` = `{ all, pendingCharge, toReview, withError, done }`, inteiros ≥ 0
([contracts/api-changes.md](./contracts/api-changes.md)). Calculadas sob demanda a cada consulta;
nada é guardado.

## 3. Estado das telas que sobrevive ao redimensionamento (FR-048)

O estado já vive em memória no renderer (002, FR-008a) e não depende da largura. A regra da 006 é
não criar estado novo atrelado à largura (research R-07):

| Estado | Onde fica | Observação |
|---|---|---|
| Busca digitada, Origem, filtros do painel, filtro rápido | `ReservationsScreen` (estado React) | O painel aberto ou fechado também |
| Seleção do lote | `state/selection.tsx` (acima das telas) | Como na 003 |
| Reserva aberta na gaveta, execução aberta | Estado das telas | A gaveta não fecha ao cruzar uma quebra |
| Aba ativa da área Comercial | `CommercialScreen` | |
| Texto em diálogos (motivo da recusa, valor a corrigir, token) | Estado dos diálogos | |
| Menu recolhido (só ícones) | Só CSS (largura da janela) | Não é estado; não há botão de recolher |

Nada disso é gravado em disco ou no navegador (002, FR-008a).

## 4. Tokens de design

Não são dados de negócio, mas são o "modelo" do visual: `ui/tokens.ts` guarda os valores das
variáveis do design com os mesmos nomes e valores (research R-02), e os pares de cor usados em texto
passam pelo teste de contraste (SC-005). Os três pares do design abaixo de 4,5:1 (research, UX-1)
ficam numa lista de exceções do teste, com o comentário de que vão para uma próxima spec.

## 5. Ordem da lista

`ReservationOrder` = `hotel_number` (padrão) | `hotel_check_in` (research R-18). O cursor de
paginação passa a carregar a ordem: `[order, hotelCode, checkIn, reservationNumber]` para
`hotel_check_in`; o formato da 1.7.0 (`[hotelCode, reservationNumber]`) continua aceito como
`hotel_number`. Nada é gravado; o índice `reservations_hotel_check_in_idx` já existe.
