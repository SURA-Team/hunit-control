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
| `SelectField`, `MultiSelectField` | `ui/fields/` | Busca pelo teclado por padrão (`searchable`), sem acento e sem maiúsculas, com "Nenhuma opção encontrada"; uma tela pode desligar só com motivo escrito no código | — (comportamento) |
| Ícones | `ui/icons/` | Som baixo e som alto (do controle de volume), Desfazer já existe | Ícones do design |

Composições usadas pelas telas novas, só com componentes que já existem: `StatusBadge` nos tons da
006 para a fila (laranja "Aguardando verificação", verde "Confirmada no Hunit", vermelho "Não
encontrada no Hunit") e para "Cancelada sem cobrança" (neutro); `Notice` com ícone de informação na
nota do som; `AppDialog` pequeno (520 px) no "Marcar como cancelada sem cobrança" e no "Desfazer";
`Action` com as variantes da 006 ("Marcar como cancelada" é a perigosa cheia, "Desfazer" a perigosa
suave, "Voltar" a de texto).
