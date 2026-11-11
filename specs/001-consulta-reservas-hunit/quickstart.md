# Quickstart: validação da feature 001

**Feature**: [spec.md](./spec.md) | **Contrato**: [contracts/openapi.yaml](./contracts/openapi.yaml) |
**Modelo**: [data-model.md](./data-model.md)

Guia para provar, de ponta a ponta, que a feature funciona. Comandos exatos de build podem mudar
durante a implementação; mantenha este arquivo atualizado.

## Pré-requisitos

- Docker Desktop (com Docker Compose) e Node.js 24 LTS + pnpm (`npm install -g pnpm@<versão do
  campo packageManager>`).
- Para os testes: o Docker em execução (banco de testes) e o Chromium do Playwright
  (`pnpm --filter @hunit/server exec playwright install chromium`, uma vez).
- Fixtures anonimizadas do Hunit em `apps/server/test/fixtures/hunit/`: HTML das telas de login/token e JSON das respostas da API (research R-13/R-13a).
- Para os cenários reais: uma conta do Hunit e o aplicativo autenticador do 2FA.

## 1. Testes automatizados (sem acessar o Hunit)

```powershell
pnpm install
pnpm test                 # domínio + camada do Hunit (fixtures) + contrato + integração com banco
```

Resultado esperado: todos os testes passam, incluindo:

| Suíte | Prova |
|---|---|
| `packages/domain` | as 7 classificações na ordem da FR-013; ativa/cancelada independente (FR-014a); histórico e "não encontrada" (FR-018/018a) |
| `apps/server` camada do Hunit | telas de login/token reconhecidas; cada resposta JSON de fixture vira o `ReservationSnapshot` esperado; tela ou resposta alterada gera `hunit_screen_not_recognized` com evidência; o guard bloqueia rotas fora da lista de permissão |
| `apps/server` contrato | todas as respostas validam contra `openapi.yaml`; `reader` recebe 403 nas ações de operador |
| `apps/server` segurança (SC-004) | senha e token de teste não aparecem em nenhum log nem evidência gerados |

## 2. Subir o ambiente

```powershell
Copy-Item .env.example .env       # preencher ACCOUNT_KEY_SECRET e senhas do banco
docker compose up -d --build
curl http://localhost:3000/v1/health        # → {"status":"ok"}
docker compose exec server node dist/cli.js create-client --name desktop --role operator
docker compose exec server node dist/cli.js create-client --name leitura --role reader
```

Guarde as chaves exibidas (aparecem uma única vez). Nos exemplos abaixo: `$OP` = chave do operador,
`$RD` = chave de consulta.

## 3. Cenários de validação com o Hunit real (homologação)

### US1 — Acesso com token 2FA

```powershell
# terminal 1: acompanhar eventos
curl -N -H "Authorization: Bearer $OP" http://localhost:3000/v1/executions/<id>/events

# terminal 2: iniciar
curl -X POST -H "Authorization: Bearer $OP" -H "Content-Type: application/json" `
  -d '{"credentials":{"username":"...","password":"..."},"period":{"from":"2026-11-01","to":"2026-11-07"},"hotelCodes":["<um hotel>"]}' `
  http://localhost:3000/v1/executions
```

| Verificação | Esperado |
|---|---|
| Evento `status_changed` → `awaiting_2fa` | chega em até 5 s após a tela de token (SC-005), com `twoFactorDeadline` |
| `POST /executions/<id>/two-factor` com token correto | execução volta a `running` |
| Repetir com senha errada | `failed` / `invalid_credentials`, sem pedir token |
| Repetir com token errado | `failed` / `invalid_token` |
| Repetir sem enviar token | `failed` / `two_factor_timeout` ao fim da janela do Hunit |
| Segunda execução enquanto a primeira está ativa | `409 execution_already_active` |

### US2 — Consulta e classificação

| Verificação | Esperado |
|---|---|
| Execução de 1 hotel × 1 semana concluída | `GET /v1/reservations?executionId=<id>` lista todas as reservas da listagem do Hunit (SC-001) |
| Conferência manual de 50 reservas no Hunit | ≥ 98% iguais; nenhuma pendente registrada como cobrada (SC-002) |
| Filtro combinado | `?reservationStatus=cancelled&classification=virtual_card_pending_charge` retorna canceladas pendentes |
| Rodar a mesma execução de novo | `verificationCount` = 2; `firstVerifiedAt` preservado |
| Período retroativo de 3 meses | concluído sem erro (FR-010a) |
| Auditoria no Hunit | nenhuma cobrança disparada nem reserva alterada (SC-003) |

### US3 — Acompanhamento, cancelamento e retomada

| Verificação | Esperado |
|---|---|
| Execução com 3+ hotéis, `GET /executions/<id>` | hotel/página/reserva atuais e contagens |
| `POST /executions/<id>/cancel` durante o 2º hotel | `cancelled` em até 15 s (SC-008); 1º hotel gravado, 2º sem dados parciais |
| `POST /executions/<id>/resume` com credenciais + novo token | nova execução começa no 2º hotel; o 1º não é reprocessado (SC-007) |
| Chave `$RD` tentando iniciar/cancelar | `403 forbidden_for_role`; GETs funcionam |

### Desempenho (SC-009)

Execução de rotina: todos os hotéis, uma semana. Registrar a duração total em
[research.md](./research.md) (R-08). Meta: ≤ 1 h em modo sequencial; ≤ 30 min se o paralelismo for
validado.

## 4. Verificação de segurança (SC-004)

```powershell
docker compose logs server | Select-String -Pattern "<senha usada>","<token usado>"   # → nenhum resultado
Get-ChildItem -Recurse <volume de evidências> | Select-String -Pattern "<senha usada>"  # → nenhum resultado
```
