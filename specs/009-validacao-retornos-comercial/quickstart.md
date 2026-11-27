# Quickstart: validar a 009

Roteiro para provar que a feature funciona de ponta a ponta. As regras estão no
[data-model.md](./data-model.md) e os contratos em [contracts/](./contracts/). Use sempre dados fictícios
(homologação e prints).

## 1. Testes automáticos

Pré-requisitos do `AGENTS.md` (Node 24, pnpm, Docker em execução, Chromium do Playwright).

```powershell
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Esperado: tudo verde. Os grupos que cobrem a 009 estão no research (R-09). Se a rodada completa passar do
tempo nos testes de banco (esta máquina também roda a produção e a homologação no Docker), rode de novo,
sozinhos, os arquivos que falharam.

Prints para comparar com o design (PowerShell, pasta fora do repositório):

```powershell
$env:HUNIT_SCREENS_DIR = "C:\prints-009"; pnpm test --project desktop-e2e screens-capture
```

Confira as telas do research (R-08) ao lado dos frames da página `009-validacao-retornos-comercial` e
registre o resultado em `research.md` ("Comparação com o design").

## 2. Homologação

Use o ambiente padrão do `README.md` ("Homologação": atualizar para uma feature), com a planilha de teste do
Comercial. Depois de subir o servidor da 009, **rode o `commercial-sheet setup` da homologação**, que cria a
aba nova. Depois instale o app 0.6.0 gerado pelo `dist`.

Os cenários de aba (3.14 a 3.19) pedem 10 minutos sem mudança. Faça-os em lote: prepare as linhas, faça os
cenários de app e use "Ler agora" depois do prazo. Os testes automáticos cobrem o prazo com o relógio
simulado.

| # | Passo | Esperado |
|---|---|---|
| 3.1 | Antes do `setup`: abrir o app | Área Comercial com "Formato alterado": falta a aba nova (FR-014) |
| 3.2 | Rodar o `setup`; `check` | Três abas, a nova no meio, protegida, com a aparência de "A cobrar"; linhas antigas intactas |
| 3.3 | Situação livre ("Cobrada pela OTA") com o responsável; "Ler agora" | Em "Retornos a validar" com o selo "Outra situação"; J "Aguardando validação do Financeiro" |
| 3.4 | Situação livre sem o responsável | "Retornos com problema": "Retorno incompleto: falta o responsável pela cobrança" (só ele) |
| 3.5 | "Cobrada na maquininha" só com o responsável | "faltam o código de autorização, o hotel da cobrança, o valor cobrado e a data da cobrança" |
| 3.6 | "Cobrada na maquininha" completo | Retornos a validar, "Confirmar" como hoje |
| 3.7 | "Cancelada" sem o responsável; depois com ele | Primeiro "falta o responsável pela cobrança"; depois em "Retornos a validar" |
| 3.8 | "Cobrada no Hunit" com o responsável, sem data | Fila "Cobradas no Hunit", "Aguardando verificação" |
| 3.9 | 3.3: "Confirmar como cobrada", sem valor do Comercial | O diálogo pede o valor; sem ele não confirma; com ele, a reserva fica "Comprovante enviado", o valor cobrado é o digitado (origem "informado à mão") e a linha vai para "Concluídas" |
| 3.10 | Situação livre com o valor do Comercial; "Confirmar como cobrada" | Usa o valor do Comercial, sem campo de valor |
| 3.11 | Outra situação livre: "Confirmar como cancelada sem cobrança"; depois "Desfazer" | Marcada (R$ 0,00, "Concluídas"); desfeita, volta para "Retornos a validar" |
| 3.12 | Outra situação livre: "Recusar" com o motivo | J "Recusado pelo Financeiro: <motivo>"; a linha fica (ou volta) em "A cobrar" |
| 3.13 | Seleção em "Retornos a validar" | As situações livres não têm caixa de marcar e ficam fora de "Confirmar marcados" |
| 3.14 | Esperar 10 minutos depois de 3.3, sem mexer na linha; "Ler agora" | A linha sai de "A cobrar" e aparece na aba nova, com K a P iguais |
| 3.15 | Na aba nova, tentar editar uma célula | A planilha não deixa (aba protegida) |
| 3.16 | Recusar uma linha que está na aba nova | A linha volta para o fim de "A cobrar", com o motivo |
| 3.17 | Confirmar uma linha que está na aba nova | Vai para "Concluídas" |
| 3.18 | Preencher um retorno e confirmar no app antes dos 10 minutos | A linha vai direto de "A cobrar" para "Concluídas" |
| 3.19 | 3.8 depois de 10 minutos | A linha fica na aba nova até a verificação no Hunit; "Não encontrada no Hunit" a devolve para "A cobrar" |
| 3.20 | Perfil consulta em "Retornos a validar" | Vê as situações livres, sem as ações |
| 3.21 | Card "Comercial" da reserva de 3.14 | Mostra a linha em "Aguardando validação do Financeiro" |
| 3.22 | App 0.5.1 contra o servidor da 009 | Funciona; a situação livre aparece como "Validar comprovante" com "—"; "Confirmar" é recusado com mensagem; fora do lote |

## 3. Figma

Depois de comparar o app com o design (prints de §1), rode a skill `figma-screens-sync` com a 009 como
feature concluída (regra do `AGENTS.md`).

## 4. Produção

1. **Avisar o Comercial antes** (R-07): a situação da cobrança passa a aceitar o que aconteceu de fato; o
   responsável é obrigatório em toda situação; só a maquininha pede código, hotel, valor e data; uma
   "Cancelada" sem responsável que aguardava validação volta a pedir o responsável; e a aba nova é só para
   consulta.
2. Atualizar o servidor (migration automática ao subir).
3. Rodar `docker compose exec server node dist/cli.js commercial-sheet setup`, logo depois do servidor: até
   ele rodar, a planilha fica "Formato alterado" e nada é escrito nela.
4. Conferir com `commercial-sheet check`.
5. Instalar o app 0.6.0 nas máquinas. O app 0.5.1 continua funcionando até lá (§2, 3.22).
