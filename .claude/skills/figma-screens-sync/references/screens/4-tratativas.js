// Telas 4.4 a 4.8 — Tratativas manuais (specs/003): seleção do lote, lista da seleção, anexar em
// lote, detalhe com tratativa e pré-visualização de e-mail. Requer o figma-prelude.js e o
// 4-6-reservas-estados-consulta.js antes deste arquivo (usa reservationsPage, kvGrid e
// treatmentSection). Dados fictícios, os mesmos do roteiro de captura.

const TREATED = { '101-1000': ['Verde', 'Cobrada'], '101-1003': ['Azul', 'Enviada'] };
const SELECTED = ['101-1002', '101-1003', '101-1005'];
const SELECTION = [4, 'R$ 4.957,50'];

/** Gaveta do detalhe da reserva: título, situações, dados e motivo. */
async function detailHead(d, number, badges, pairs, reason) {
  await titleWithClose(d, 'Detalhe da reserva');
  const t = row(d, 'Reserva', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const tl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 8, counterAxisAlignItems: 'BASELINE' }); t.appendChild(tl);
  tl.appendChild(await T(`Reserva ${number}`, 'título seção')); tl.appendChild(await T('hotel 101', 'corpo', 'texto/apagado'));
  const tr = AL('HORIZONTAL', { name: 'Situações', itemSpacing: 8 }); t.appendChild(tr);
  for (const [tone, text] of badges) await badge(tr, tone, text);
  await kvGrid(d, pairs, 'Dados da reserva');
  const m = AL('VERTICAL', { name: 'Motivo da classificação', itemSpacing: 2, paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12, cornerRadius: 8 });
  m.strokes = [paint('borda/padrão')]; put(d, m, 'fill');
  m.appendChild(await T('Motivo da classificação', 'descrição', 'texto/apagado')); m.appendChild(await T(reason));
}

/** Linha "arquivo  tamanho" do topo do diálogo de anexar. */
async function fileLine(parent, name, size) {
  const r = row(parent, 'Arquivo', { itemSpacing: 10 });
  r.appendChild(await T(name, 'corpo forte')); r.appendChild(await T(size, 'descrição', 'texto/apagado'));
}

async function dialogButtons(parent) {
  const b = row(parent, 'Botões', { itemSpacing: 12, primaryAxisAlignItems: 'MAX' });
  await btn(b, 'Cancelar', 'Contorno'); await btn(b, 'Escolher outro arquivo', 'Contorno'); await btn(b, 'Confirmar');
}

SCREENS['4.4'] = { name: 'Reservas — seleção do lote', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ main }) {
    await reservationsPage(main, { treatments: TREATED, checked: SELECTED, selection: SELECTION, count: 10 });
  } };

SCREENS['4.5'] = { name: 'Reservas — reservas selecionadas', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await reservationsPage(main, { treatments: TREATED, checked: SELECTED, selection: SELECTION, count: 10 });
    overlay(root);
    const d = drawer(root, 'Gaveta — reservas selecionadas');
    await titleWithClose(d, 'Reservas selecionadas', 'título página');
    const r = row(d, 'Resumo', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
    r.appendChild(await rich([['4', 'b'], [' reservas — total de '], ['R$ 4.957,50', 'b']]));
    await btn(r, 'Limpar seleção', 'Contorno xs');
    await table(d, [['Hotel', 150], ['Número', 105], ['Hóspede', 140], ['Valor total', 105], ['Situação', 'fill'], [' ', 44]], [
      ['Hotel Praia Azul', '101-1002', 'Carla Mendes', 'R$ 655,00', { badge: 'Vermelho', text: 'Erro na cobrança' }, { build: async (c) => { await closeIcon(c); } }],
      ['Hotel Praia Azul', '101-1003', 'Diego Fernandes', 'R$ 792,50', { badge: 'Amarelo', text: 'Cartão validado (não cobrado)' }, { build: async (c) => { await closeIcon(c); } }],
      ['Hotel Praia Azul', '101-1005', 'Fábio Rocha', 'R$ 1.067,50', { badge: 'Amarelo', text: 'Cobrar na maquininha' }, { build: async (c) => { await closeIcon(c); } }],
      ['Resort Lagoa Clara', '104-1015', 'Fábio Rocha', 'R$ 2.442,50', { badge: 'Verde', text: 'Já cobrada' }, { build: async (c) => { await closeIcon(c); } }],
    ]);
  } };

SCREENS['4.6'] = { name: 'Reservas — anexar comprovante em lote', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await reservationsPage(main, { treatments: TREATED, checked: SELECTED, selection: SELECTION, count: 10 });
    overlay(root);
    const m = modal(root, 780, 'Diálogo — anexar comprovante em lote');
    await titleWithClose(m, 'Anexar comprovante a 4 reservas', 'corpo forte');
    await fileLine(m, 'comprovante-cobranca.png', '70 B');
    const img = AL('VERTICAL', { name: 'Pré-visualização da imagem', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', cornerRadius: 4 });
    img.fills = [paint('fundo/sutil')]; img.strokes = [paint('borda/padrão')]; put(m, img, 'fill');
    img.primaryAxisSizingMode = 'FIXED'; img.resize(img.width, 300);
    img.appendChild(await T('imagem escolhida (pré-visualização)', 'corpo', 'texto/apagado'));
    put(m, await rich([['•  '], ['3', 'b'], [' reservas aceitam o documento — total de '], ['R$ 2.515,00', 'b']]), 'fill');
    put(m, await rich([['•  '], ['1', 'b'], [' será ignorada']]), 'fill');
    await table(m, [['Reserva', 300], ['Motivo', 'fill']], [['104-1015 (hotel 104)', 'Esta reserva não exige cobrança.']]);
    await dialogButtons(m);
    center(root, m);
  } };

SCREENS['4.7'] = { name: 'Reservas — detalhe com tratativa', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await reservationsPage(main, { treatments: TREATED });
    overlay(root);
    const d = drawer(root, 'Gaveta — detalhe com tratativa');
    await detailHead(d, '101-1000', [['Amarelo', 'Pendente de cobrança'], ['Verde', 'Cobrada'], ['Cinza', 'Ativa']],
      [['Hóspede', 'Ana Ribeiro'], ['Canal', 'Booking.com'], ['Forma de pagamento', '—'], ['Check-in', '16/11/2026'], ['Check-out', '18/11/2026'], ['Valor total', 'R$ 380,00']],
      'Pré-pagamento sem registro de cobrança e com a ação de cobrar disponível.');
    await treatmentSection(d, {
      status: ['Verde', 'Cobrada'],
      buttons: ['Substituir tratativa', 'Substituir comprovante'],
      docs: [
        ['Tratativa', 'pedido-ao-comercial.eml', '252 B', '15/11/2026 10:19', ['Verde', 'Atual'], ['Baixar', 'Desfazer']],
        ['Comprovante', 'comprovante-101-1000.pdf', '595 B', '15/11/2026 10:19', ['Verde', 'Atual'], ['Baixar', 'Desfazer']],
        ['Comprovante anterior', 'comprovante-antigo.pdf', '593 B', '15/11/2026 10:19', ['Cinza', 'Substituído', '15/11/2026 10:19 por Recepção — PC 1\npode ser revertido até 15/12/2026'], ['Baixar', 'Reverter']],
      ],
      manual: 'R$ 380,00',
      history: [
        '15/11/2026 10:19 — Informou valor: R$ 380,00 — Recepção — PC 1',
        '15/11/2026 10:19 — Substituiu comprovante — Recepção — PC 1',
        '15/11/2026 10:19 — Anexou comprovante — Recepção — PC 1',
        '15/11/2026 10:19 — Anexou tratativa — Recepção — PC 1',
      ],
    });
  } };

SCREENS['4.8'] = { name: 'Reservas — anexar tratativa (e-mail)', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await reservationsPage(main, { treatments: TREATED });
    overlay(root);
    const d = drawer(root, 'Gaveta — detalhe da reserva');
    await detailHead(d, '101-1005', [['Amarelo', 'Cobrar na maquininha'], ['Cinza', 'Ativa']],
      [['Hóspede', 'Fábio Rocha'], ['Canal', 'Booking.com'], ['Forma de pagamento', 'cartão de crédito'], ['Check-in', '16/11/2026'], ['Check-out', '18/11/2026'], ['Valor total', 'R$ 1.067,50']],
      'Sem pré-pagamento e forma de pagamento cartão de crédito: cobrar na maquininha.');
    overlay(root);
    const m = modal(root, 780, 'Diálogo — anexar tratativa');
    await titleWithClose(m, 'Anexar tratativa', 'corpo forte');
    await fileLine(m, 'pedido-de-cobranca.eml', '659 B');
    const h = AL('VERTICAL', { name: 'Cabeçalhos do e-mail', itemSpacing: 6, paddingLeft: 10 }); put(m, h, 'fill');
    for (const [k, v] of [['De', 'Financeiro Teste <financeiro@exemplo.test>'], ['Para', 'Comercial Teste <comercial@exemplo.test>'], ['Assunto', 'Pedido de cobrança — reserva 101-1005'], ['Data', '13/11/2026 10:00']]) {
      const r = row(h, k, { itemSpacing: 0 }); put(r, await T(k, 'corpo forte'), 110); r.appendChild(await T(v));
    }
    const body = await card(m, null, 'fill', 6); body.name = 'Mensagem';
    for (const line of ['Olá, equipe do Comercial.', ' ', 'Favor cobrar na maquininha a reserva 101-1005 (Fábio Rocha), check-out amanhã.', ' ', 'Obrigado,', 'Financeiro']) put(body, await T(line), 'fill');
    const att = AL('VERTICAL', { name: 'Anexos do e-mail', itemSpacing: 4 }); put(m, att, 'fill');
    att.appendChild(await T('Anexos do e-mail (1)', 'corpo forte'));
    att.appendChild(await T('Os anexos vão junto com o e-mail; eles não são abertos aqui.', 'descrição', 'texto/apagado'));
    att.appendChild(await T('•  resumo-da-reserva.txt — 16 B'));
    put(m, await T('Confira o arquivo acima. Ao confirmar, ele será registrado como a tratativa desta reserva.'), 'fill');
    await dialogButtons(m);
    center(root, m);
  } };
