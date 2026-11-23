# Componentes únicos: acréscimos da 008

**Feature**: [spec.md](../spec.md) | **Research**: [R-04](../research.md#r-04--componentes-switch-desligado-e-controle-de-volume), [R-11](../research.md#r-11--busca-pelo-teclado-em-todos-os-seletores)

Catálogo da 006 em
[specs/006-redesign-app-desktop/contracts/ui-components.md](../../006-redesign-app-desktop/contracts/ui-components.md),
que continua valendo. Na implementação, a coluna "Ativa em" do catálogo da skill `figma-screens-sync`
e este arquivo são atualizados juntos. Biblioteca no Figma: "Componentes — nova identidade".

| Componente | Onde | Mudança | Design |
|---|---|---|---|
| `SwitchField` | `ui/fields/` | Estado desligado do design (variante "Desligado" do Switch): trilho na cor da borda, botão branco; ligado continua preto com o botão lima | Switch, variantes "Ligado" e "Desligado" |
| `VolumeField` | `ui/fields/` (novo) | Rótulo "Volume", ícone de som baixo à esquerda e alto à direita, trilho preto com botão lima, valor "70 %" à direita; desabilitado em cinza. Props: `value`, `onChange`, `onChangeEnd` (amostra), `disabled`. Teclado: setas ±5, Page Up/Down ±10, Home/End; foco visível; `aria-label` e `aria-valuetext` em porcentagem | "Controle de volume", versões "Ativo" e "Desabilitado" |
| `SelectField`, `MultiSelectField` | `ui/fields/` | Busca pelo teclado por padrão (`searchable`), sem acento e sem maiúsculas, com "Nenhuma opção encontrada"; nenhuma tela desliga | — (comportamento) |
| `ListCard` e listas internas | `ui/lists/lists.module.css` | O card (`.card`) e a caixa cinza (`.inset`) cortam o conteúdo no arredondado (`overflow: clip`): o destaque da linha (seleção, linha aberta, mouse) fica dentro, em qualquer posição (FR-030, research R-16) | Card de lista da 006 |
| Ícones | `ui/icons/` | Som baixo (só o alto-falante) e som alto (duas ondas), exportados do "Controle de volume" (`242:1984`); `info` da nota do som (`242:1996`); Desfazer já existe | Ícones do design |
| `SwitchField` | `ui/fields/` | `inlineDescription`: a descrição ao lado do rótulo, na mesma linha, quebrando se não couber (comparação, T039) | Telas 1.1 a 1.3 |
| `Notice` | `ui/` | Tom `gray` (neutro): caixa cinza com borda, texto de descrição e o ícone sem círculo, para notas sem urgência (comparação, T039) | Nota do som, telas 1.1 a 1.3 |
| `ListCard` (colunas) | `ui/lists/` | Chaves `toCharge`, `reportedBy` e `hunitCheck` da fila "Cobradas no Hunit", com as quebras do "Retornos a validar" | Tela 7.15 |

Composições usadas pelas telas novas, só com componentes que já existem: `StatusBadge` nos tons da
006 para a fila (laranja "Aguardando verificação", verde "Confirmada no Hunit", vermelho "Não
encontrada no Hunit") e para "Cancelada sem cobrança" (neutro); `Notice` neutro (`gray`) com o ícone de
informação na nota do som; `AppDialog` pequeno (520 px) no "Marcar como cancelada sem cobrança" e no "Desfazer";
`Action` com as variantes da 006 ("Marcar como cancelada" é a perigosa cheia, "Desfazer" a perigosa
suave, "Voltar" a de texto).
