-- Busca de reservas pelo nome do hóspede sem diferenciar acentos (specs/002, FR-020a, research R-10).
-- A extensão vem com o PostgreSQL (contrib); não cria tabela nem coluna.
CREATE EXTENSION IF NOT EXISTS unaccent;
