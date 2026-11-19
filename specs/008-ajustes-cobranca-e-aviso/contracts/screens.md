# Telas da 008

**Feature**: [spec.md](../spec.md) | Figma: arquivo "Hunit Control", página
`008-ajustes-cobranca-e-aviso` (node `242:42`), com a numeração da 006. Onde a 008 difere da 006, vale
a 008 (spec, contexto). Diferenças entre o design e o código: [research R-13](../research.md#r-13--diferenças-do-design-levadas-à-ux).

| Tela | Nome no Figma | Node | História | Código (renderer, salvo indicação) |
|---|---|---|---|---|
| 1.1 | Configuração — primeiro uso · som do aviso | `242:44` | US1, US5 | `screens/setup/SetupScreen.tsx` (card "Aviso do pedido de token"), `ui/fields/VolumeField.tsx` |
| 1.2 | Configuração — conexão confirmada · som desligado | `242:73` | US1, US5 | idem, chave desligada e volume desabilitado |
| 1.3 | Configuração — conectado (operador) · som do aviso | `242:108` | US1 | idem + `screens/setup/PreferencesForm.tsx` (sem a chave de som) |
| 7.5 | Reservas — detalhe "Validar comprovante" | `242:159` | US2 | `screens/reservations/CommercialSection.tsx` (situação e data no "Retorno do Comercial") |
| 7.7 | Comercial — Envios | `242:375` | US3 | `screens/commercial/CommercialScreen.tsx` (aba "Cobradas no Hunit" com contagem) |
| 7.8 | Comercial — Retornos a validar | `242:399` | US2 | `screens/commercial/ReturnsTab.tsx` (situação e data na coluna "Responsável e cobrança") |
| 7.12 | Reservas — confirmar retornos em lote | `242:466` | US2 | `screens/reservations/ConfirmBatchDialog.tsx` |
| 7.15 | Comercial — Cobradas no Hunit (fila de verificação) | `243:1281` | US3 | `screens/commercial/HunitChargesTab.tsx` (novo) |
| 7.17 | Reservas — marcar como cancelada sem cobrança | `242:544` | US4 | `screens/reservations/NoChargeSection.tsx` (novo, card e diálogo) |
| 7.18 | Reservas — cancelada sem cobrança (em Concluídas) | `244:1673` | US4 | idem + `ReservationDetail.tsx` (selo do cabeçalho), `TreatmentSection.tsx` (histórico), `CommercialSection.tsx` |

Telas sem desenho na 008, montadas com os padrões da 006 (R-13): diálogo "Desfazer" da marcação;
relato "Não cobrada" em `screens/commercial/ProblemsTab.tsx`; linha da lista de reservas marcada
(`ui/lists/ReservationRow.tsx`, selo e "R$ 0,00 · antes R$ …"); seletores com busca em
`screens/reservations/ReservationFilters.tsx` (US6); destaque da linha dentro do card em todas as
listas (`ui/lists/lists.module.css`, US6, FR-030).

Fora do renderer (US6): ícone na barra de tarefas — `apps/desktop/src/main/window.ts`,
`src/main/index.ts` e `electron-builder.yml`.

O roteiro `screens-capture` ganha as telas 1.2, 7.15, 7.17 e 7.18 (as outras já são capturadas pela
006) e captura a 1.1, 1.3, 7.5, 7.7, 7.8 e 7.12 no visual novo; a conferência com o design fica em
`research.md`, seção "Comparação com o design" (criada na implementação).
