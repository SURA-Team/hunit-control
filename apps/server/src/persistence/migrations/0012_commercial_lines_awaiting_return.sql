-- specs/005, FR-010a (research R-18): a coluna "Validação do Financeiro" passa a mostrar
-- "Aguardando retorno do Comercial" nas linhas abertas sem retorno, que antes ficavam vazias.
-- Marca as linhas abertas como pendentes, para a primeira rodada reescrevê-las como mudança do
-- sistema, sem relatar "célula do sistema alterada na planilha" (FR-011).
UPDATE "commercial_lines"
SET "version" = "version" + 1, "changed_at" = now()
WHERE "state" = 'open' AND "removed_from_sheet_at" IS NULL;
