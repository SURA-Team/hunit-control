// Telas 4.10 e 4.11 — reservas importadas do sistema anterior (specs/004): selo "Sistema anterior",
// filtro "Origem", "A revisar (sistema anterior)" e a seção "Sistema anterior" do detalhe.
// Requer o figma-prelude.js e o 4-6-reservas-estados-consulta.js antes deste arquivo.

// Dados fictícios: os do passo "4.10 e 4.11 sistema anterior" do roteiro de captura.
const LEGACY_ROWS = [
  ['SA-2001', 'Lúcia Barros', ['Amarelo', 'Pendente de cobrança']],
  ['SA-2002', 'Marcos Teixeira', ['Amarelo', 'A revisar (sistema anterior)']],
];
// O número ganha o selo ao lado: coluna mais larga; as outras estreitam para "Não identificada"
// caber inteira na última coluna.
// A 005 acrescentou a coluna "Valor cobrado".
const LEGACY_COLS = [[' ', 36], ['Hotel', 125], ['Número', 185], ['Hóspede', 110], ['Canal', 95], ['Check-in', 88], ['Check-out', 88], ['Valor total', 92], ['Valor cobrado', 95], ['Situação da reserva', 180], ['Reserva', 'fill']];
const legacyRows = () => LEGACY_ROWS.map(([number, guest, [tone, situation]]) => [
  { check: false }, 'Hotel Praia Azul', legacyNumberCell(number), guest, 'Canal Fictício', '10/05/2026', '12/05/2026', 'R$ 1.234,56', '—',
  { badge: tone, text: situation }, { badge: 'Amarelo', text: 'Não identificada' },
]);

SCREENS['4.10'] = { name: 'Reservas — filtro "Sistema anterior"', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ main }) { await reservationsPage(main, { origin: 'Sistema anterior', rows: legacyRows(), cols: LEGACY_COLS }); } };

SCREENS['4.11'] = { name: 'Reservas — detalhe da reserva do sistema anterior', h: 1300, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await reservationsPage(main, { origin: 'Sistema anterior', rows: legacyRows(), cols: LEGACY_COLS });
    overlay(root);
    const d = drawer(root, 'Gaveta — detalhe da reserva do sistema anterior');
    await titleWithClose(d, 'Detalhe da reserva');
    const t = row(d, 'Reserva', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
    const tl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 8, counterAxisAlignItems: 'BASELINE' }); t.appendChild(tl);
    tl.appendChild(await T('Reserva SA-2002', 'título seção')); tl.appendChild(await T('hotel 101', 'corpo', 'texto/apagado'));
    const tr = AL('HORIZONTAL', { name: 'Situações', itemSpacing: 8 }); t.appendChild(tr);
    await legacyBadge(tr); await badge(tr, 'Amarelo', 'A revisar (sistema anterior)'); await badge(tr, 'Amarelo', 'Não identificada');
    await kvGrid(d, [['Hóspede', 'Marcos Teixeira'], ['Canal', 'Canal Fictício'], ['Forma de pagamento', '—'], ['Check-in', '10/05/2026'], ['Check-out', '12/05/2026'], ['Valor total', 'R$ 1.234,56'], ['Valor cobrado', '—']], 'Dados da reserva');
    await hunitStatus(d, ['Amarelo', 'A revisar (sistema anterior)'], 'Sistema anterior: "Sem cartão virtual" sem correspondência (o sistema anterior não guardava a forma de pagamento); a revisar na próxima verificação no Hunit');
    await treatmentSection(d, {
      status: ['Amarelo', 'A revisar (sistema anterior)'],
      buttons: ['Substituir tratativa', 'Anexar comprovante'],
      author: 'Sistema anterior',
      docs: [
        ['Tratativa', 'Pedido de cobrança SA-2002.pdf', '40 B', '02/05/2026 09:30', ['Verde', 'Atual'], ['Baixar', 'Desfazer']],
        ['Comprovante'],
      ],
      history: ['02/05/2026 09:30 — Anexou tratativa — Sistema anterior'],
    });
    const cb = await card(d, null, 'fill', 12); cb.name = 'Card — Cobrança'; put(cb, await T('Cobrança', 'corpo forte'));
    await kvGrid(cb, [['Data', '—'], ['Responsável', '—'], ['Valor cobrado no Hunit', '—'], ['Transação', '—'], ['Autorização', '—'], ['Referência da operadora', '—'], ['Parcelamento', '—'], ['Estado do pré-pagamento', '—'], ['Mensagem do pré-pagamento', '—']], 'Dados da cobrança');
    const vf = await card(d, null, 'fill', 12); vf.name = 'Card — Verificações'; put(vf, await T('Verificações', 'corpo forte'));
    await kvGrid(vf, [['Primeira', '01/05/2026 10:00'], ['Última', '08/05/2026 10:00'], ['Quantidade', '3']], 'Verificações');
    put(vf, await T('Ainda não verificada pelo HUNIT Control: os dados são os do sistema anterior.', 'corpo', 'texto/apagado'), 'fill');
    const sa = await card(d, null, 'fill', 12); sa.name = 'Card — Sistema anterior'; put(sa, await T('Sistema anterior', 'corpo forte'));
    await kvGrid(sa, [['Classificação original', 'Sem cartão virtual'], ['Importada em', '16/11/2026 17:28'], ['Verificações no sistema anterior', '3'], ['Primeira verificação', '01/05/2026 10:00'], ['Última verificação', '08/05/2026 10:00']], 'Origem');
  } };
