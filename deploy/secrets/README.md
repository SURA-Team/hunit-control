# Segredos de arquivo do servidor

Esta pasta é montada **só para leitura** no container `server`, em `/run/secrets/commercial-sheet`
(`docker-compose.yml`). Nada aqui, além deste README, entra no Git (`.gitignore`).

## Chave da planilha do Comercial (specs/005)

1. Salve aqui a chave JSON da conta de serviço do Google, com o nome
   `commercial-sheet-key.json`.
2. No `.env`, preencha `COMMERCIAL_SHEET_ID` e
   `COMMERCIAL_SHEET_KEY_FILE=/run/secrets/commercial-sheet/commercial-sheet-key.json`.
3. Rode `docker compose up -d` e depois
   `docker compose exec server node dist/cli.js commercial-sheet setup`.

A chave dá acesso de edição à planilha: nunca a copie para fora desta pasta, nunca a envie por
e-mail ou chat e nunca a cole no `.env`. Passo a passo completo no `README.md` da raiz
("Planilha do Comercial").
