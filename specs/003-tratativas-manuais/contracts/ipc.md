# Contrato: acréscimos à ponte do app (preload)

**Feature**: [spec.md](../spec.md) | **Research**: [R-08](../research.md), [R-09](../research.md) | **Base**: [specs/002 contracts/ipc.md](../../002-app-desktop/contracts/ipc.md)

Valem todas as regras da ponte da 002: um canal por função (`<área>:<ação>`), entrada validada com
`zod` no principal, `Result<T>` em todo pedido, nada sensível de volta para a interface. Esta
feature acrescenta a área `treatments` e um filtro em `reservations.list`.

Regras próprias desta feature:

- **O arquivo escolhido nunca vai para o disco** (FR-018a): o principal o lê para a memória e
  devolve à interface só o modelo de pré-visualização e um `selectionId`. Confirmar ou cancelar
  libera a memória.
- **A interface não decide elegibilidade nem situação** (constitution, princípio III): quantas
  aceitam, o total e os motivos vêm do `check` do servidor.
- Ações de registro são recusadas pelo servidor para o perfil consulta (`forbidden_for_role`), e a
  interface as esconde (FR-014, FR-017).

## Tipos

```ts
type TreatmentKind = Api.TreatmentDocumentKind;              // 'request' | 'proof'

interface PickedFile {
  selectionId: string;                                       // id em memória no principal
  fileName: string;
  sizeBytes: number;
  mediaType: string;                                         // pela extensão; o servidor confere de novo (R-03)
  preview: DocumentPreview;
}

type DocumentPreview =
  | { type: 'pdf'; bytes: Uint8Array }                       // desenhado com pdf.js na interface
  | { type: 'image'; bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' }
  | {
      type: 'email';
      from: string | null; to: string[]; cc: string[];
      subject: string | null; date: string | null;           // ISO quando o e-mail tem data válida
      text: string | null;                                   // corpo em texto, quando existe
      html: string | null;                                   // só quando não há texto; exibido em iframe isolado (R-08)
      attachments: Array<{ name: string | null; mediaType: string | null; sizeBytes: number | null }>;
    }
  | { type: 'unavailable'; reason: 'unreadable' };           // FR-018a: avisa e permite confirmar

interface ApplyResult {
  items: Api.ReservationOutcome[];                           // todas as partes de 200 juntas (R-05)
  failedKeys: Api.ReservationKey[];                          // continuam selecionadas (FR-006a)
}
```

## Pedidos (`invoke`)

| Função | Entrada | Saída | Observações |
|---|---|---|---|
| `treatments.pickFile(input)` | `{ kind }` | `PickedFile \| null` | abre o diálogo com as extensões aceitas; recusa acima de 25 MB **sem ler** (`file_too_large`) e extensões fora da lista (`unsupported_file_type`); `null` = cancelado |
| `treatments.discardFile(input)` | `{ selectionId }` | `null` | cancelar na pré-visualização: libera a memória, nada é enviado (FR-018) |
| `treatments.check(input)` | `{ kind, reservations: ReservationKey[] }` (1 a 2 000) | `Api` resposta do `check`, somada entre as partes | `POST /treatment-documents/check` em partes de 200 |
| `treatments.apply(input)` | `{ selectionId, kind, reservations: ReservationKey[] }` (1 a 2 000) | `ApplyResult` | envia o arquivo (`POST /treatment-files`) e registra em partes de 200; libera a memória no fim, com ou sem falhas |
| `treatments.get(input)` | `{ hotelCode, reservationNumber }` | resposta de `GET …/treatment` | documentos e histórico |
| `treatments.remove(input)` | `{ documentId }` | `null` | desfazer (a interface pede confirmação antes) |
| `treatments.revert(input)` | `{ documentId }` | `Api.ReservationTreatment` | |
| `treatments.setManualAmount(input)` | `{ hotelCode, reservationNumber, amount }` (`"1234.56"`) | `Api.ReservationTreatment` | |
| `treatments.clearManualAmount(input)` | `{ hotelCode, reservationNumber }` | `Api.ReservationTreatment` | |
| `treatments.saveDocument(input)` | `{ documentId }` | `{ savedTo: string } \| null` | baixa e abre "Salvar como" com o nome original (FR-009), como `evidence.save` da 002; a interface não recebe o conteúdo |
| `reservations.list(input)` | filtros da 002 + `treatmentStatus: TreatmentStatus[]` | sem mudança | |

Limites da entrada: `selectionId` é um UUID que o principal emitiu e ainda guarda (senão
`invalid_input`); `fileName` não é aceito da interface — o principal usa o nome que leu do disco.

## Sem eventos novos

A interface atualiza a lista e o detalhe com um novo `GET` depois de cada ação (TanStack Query), como
na 002.
