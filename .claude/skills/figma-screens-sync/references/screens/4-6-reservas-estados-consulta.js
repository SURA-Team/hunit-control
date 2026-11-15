// Telas 4.x — Reservas (screens/reservations/), 5.x — Estados do sistema (components/ConnectionBanner.tsx,
// StaleDataNotice.tsx) e 6.x — Perfil consulta. Requer o figma-prelude.js antes deste arquivo.

// Dados fictícios: os mesmos do roteiro de captura (apps/desktop/test/e2e/screens-capture.test.ts).
const GUESTS = ['Ana Ribeiro', 'Bruno Carvalho', 'Carla Mendes', 'Diego Fernandes', 'Elisa Martins', 'Fábio Rocha', 'Gabriela Lima', 'Henrique Alves', 'Isabela Costa', 'João Pereira'];
const CHANNELS = ['Booking.com', 'Expedia', 'Decolar', 'Site próprio', 'Airbnb'];
const CLASS = [['Amarelo', 'Pendente de cobrança'], ['Verde', 'Já cobrada'], ['Vermelho', 'Erro na cobrança'], ['Amarelo', 'Cartão validado (não cobrado)'], ['Verde', 'Faturada'], ['Amarelo', 'Cobrar na maquininha'], ['Vermelho', 'Erro de análise']];
const HOTELS = [['101', 'Hotel Praia Azul', 6], ['102', 'Pousada Serra Verde', 4], ['103', 'Hotel Centro Histórico', 5], ['104', 'Resort Lagoa Clara', 7]];
const money = (v) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const RESERVATIONS = [];
{ let n = 0; for (const [code, name, count] of HOTELS) for (let i = 0; i < count; i++, n++) RESERVATIONS.push([name, `${code}-${1000 + n}`, GUESTS[n % 10], CHANNELS[n % 5], `${16 + (n % 5)}/11/2026`, `${18 + (n % 5)}/11/2026`, money(380 + n * 137.5), { badge: CLASS[n % 7][0], text: CLASS[n % 7][1] }, '', { badge: 'Cinza', text: 'Ativa' }]); }
// Colunas da lista (specs/003: coluna "Tratativa"; o operador ganha a caixa de seleção na frente).
const RES_COLS = [['Hotel', 150], ['Número', 80], ['Hóspede', 130], ['Canal', 105], ['Check-in', 95], ['Check-out', 95], ['Valor total', 95], ['Situação de cobrança', 230], ['Tratativa', 95], ['Reserva', 'fill']];
/** Linhas da lista: tratativas por número ({ '101-1000': ['Verde', 'Cobrada'] }) e caixas marcadas. */
function reservationRows({ count = 12, treatments = {}, checked = [], operator = true } = {}) {
  return RESERVATIONS.slice(0, count).map((r) => {
    const row = [...r];
    const t = treatments[r[1]];
    row[8] = t ? { badge: t[0], text: t[1] } : '';
    return operator ? [{ check: checked.includes(r[1]) }, ...row] : row;
  });
}
const resCols = (operator = true) => (operator ? [[' ', 36], ...RES_COLS] : RES_COLS);

async function reservationFilters(main, q = '') {
  const c = await card(main, null); c.name = 'Card — Filtros';
  const r1 = row(c, 'Linha 1', { itemSpacing: 12, counterAxisAlignItems: 'MIN' });
  (await field(r1, { label: 'Busca livre', desc: 'Número da reserva, hóspede, transação, código de autorização ou referência da operadora', value: q, variant: q ? 'Preenchido' : 'Placeholder' })).layoutSizingHorizontal = 'FILL';
  (await field(r1, { label: 'Valor (R$)', desc: 'Valor total ou valor cobrado, como no extrato (ex.: 1.234,56)', variant: 'Placeholder' })).layoutSizingHorizontal = 'FILL';
  const r2 = row(c, 'Linha 2', { itemSpacing: 12, counterAxisAlignItems: 'MIN' });
  for (const [label, ph, v] of [['Hotéis', 'Todos os hotéis', 'Placeholder/Seletor'], ['Período de check-in', 'Qualquer data', 'Placeholder'], ['Situação de cobrança', 'Todas as situações de cobrança', 'Placeholder/Seletor']])
    (await field(r2, { label, value: ph, variant: v })).layoutSizingHorizontal = 'FILL';
  const r3 = row(c, 'Linha 3', { itemSpacing: 12, counterAxisAlignItems: 'MIN' });
  for (const [label, ph] of [['Situação da reserva', 'Ativas e canceladas'], ['Tratativa', 'Com ou sem tratativa'], ['Canal', 'Todos os canais']])
    (await field(r3, { label, value: ph, variant: 'Placeholder/Seletor' })).layoutSizingHorizontal = 'FILL';
  const r4 = row(c, 'Ações', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const quick = AL('HORIZONTAL', { name: 'Atalhos', itemSpacing: 12, counterAxisAlignItems: 'CENTER' }); r4.appendChild(quick);
  await btn(quick, 'Falta cobrar', 'Leve xs');
  quick.appendChild(await I(K.checkbox, { [P.checkbox]: 'Só as não encontradas na última verificação' }));
  const b = AL('HORIZONTAL', { name: 'Botões', itemSpacing: 12 }); r4.appendChild(b); await btn(b, 'Limpar', 'Contorno'); await btn(b, 'Buscar');
}
/** Barra da seleção do lote (specs/003, FR-006a). */
async function selectionBar(main, count, total) {
  const c = await card(main, null, 'fill', 0); c.name = 'Card — Seleção do lote'; c.paddingTop = c.paddingBottom = 12;
  const r = row(c, 'Seleção', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  r.appendChild(await rich([[String(count), 'b'], [` reservas selecionadas — total de `], [total, 'b']]));
  const b = AL('HORIZONTAL', { name: 'Ações do lote', itemSpacing: 10, counterAxisAlignItems: 'CENTER' }); r.appendChild(b);
  await btn(b, 'Ver seleção', 'Contorno xs'); await btn(b, 'Anexar tratativa', 'Contorno xs');
  await btn(b, 'Anexar comprovante', 'Preenchido xs'); await btn(b, 'Desmarcar todas', 'Leve xs');
}
async function reservationsPage(main, { q = '', empty = false, operator = true, treatments = {}, checked = [], selection = null, count = 12 } = {}) {
  put(main, await T('Reservas', 'título página'));
  await reservationFilters(main, q);
  if (selection) await selectionBar(main, selection[0], selection[1]);
  if (empty) put(main, await T('Nenhuma reserva encontrada com estes filtros.', 'corpo grande', 'texto/apagado'));
  else {
    const rows = reservationRows({ count, treatments, checked, operator });
    const t = await table(main, resCols(operator), rows);
    if (operator) { // caixa do cabeçalho: parcial quando só parte da página está marcada
      const head = t.children[0].children[0];
      head.children.forEach((n) => n.remove());
      head.appendChild(tick(checked.length === 0 ? false : checked.length >= rows.length ? true : 'some'));
    }
  }
}
/** Seção "Tratativa" do detalhe (specs/003, FR-017). docs: linhas [rótulo, arquivo, tamanho, anexado, estado, ações]. */
async function treatmentSection(parent, { status, buttons, docs: docs0, manual, history }) {
  const c = await card(parent, null, 'fill', 12); c.name = 'Card — Tratativa';
  const h = row(c, 'Cabeçalho', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const hl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 8, counterAxisAlignItems: 'CENTER' }); h.appendChild(hl);
  hl.appendChild(await T('Tratativa', 'corpo forte'));
  if (status) await badge(hl, status[0], status[1]); else hl.appendChild(await T('Sem tratativa', 'corpo', 'texto/apagado'));
  const hb = AL('HORIZONTAL', { name: 'Ações', itemSpacing: 8 }); h.appendChild(hb);
  await btn(hb, buttons[0], 'Contorno xs'); await btn(hb, buttons[1], 'Preenchido xs');
  // Documentos em linhas de altura automática: arquivo, anexado e situação em duas ou três linhas,
  // como no app (FR-013a: "pode ser revertido até ...").
  const lines = (parts) => async (cell) => {
    cell.layoutMode = 'VERTICAL'; cell.primaryAxisAlignItems = 'CENTER'; cell.counterAxisAlignItems = 'MIN'; cell.itemSpacing = 2;
    for (const [text, style, color] of parts) {
      if (style === 'badge') { await badge(cell, text[0], text[1]); continue; }
      const t = await T(text, style, color); cell.appendChild(t); t.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT';
    }
  };
  const docs = await table(c, [['Documento', 122], ['Arquivo', 158], ['Anexado', 140], ['Situação', 125], [' ', 'fill']], docs0.map((d) => [
    d[0],
    d[1] ? { build: lines([[d[1], 'corpo'], [d[2], 'descrição', 'texto/apagado']]) } : { rich: [['Nenhum', 'dim']] },
    d[3] ? { build: lines([[d[3], 'corpo'], ['por Recepção — PC 1', 'descrição', 'texto/apagado']]) } : '',
    d[4] ? { build: lines([[d[4], 'badge'], ...(d[4][2] ? [[d[4][2], 'descrição', 'texto/apagado']] : [])]) } : '',
    d[5] ? { build: async (cell) => { cell.primaryAxisAlignItems = 'MAX'; cell.itemSpacing = 6; for (const a of d[5]) await btn(cell, a, 'Contorno xs'); } } : '',
  ]));
  docs.children.forEach((r, index) => {
    if (index === 0) return;
    for (const cell of r.children) { cell.paddingTop = 8; cell.paddingBottom = 8; cell.layoutSizingVertical = 'HUG'; }
    r.layoutSizingVertical = 'HUG';
    for (const cell of r.children) cell.layoutSizingVertical = 'FILL';
    const doc = r.children[0].children.find((n) => n.type === 'TEXT');
    if (doc) { doc.layoutSizingHorizontal = 'FILL'; doc.textAutoResize = 'HEIGHT'; }
  });
  const v = row(c, 'Valor informado à mão', { itemSpacing: 16, counterAxisAlignItems: 'MAX' });
  const vv = AL('VERTICAL', { name: 'Valor', itemSpacing: 2 }); v.appendChild(vv);
  vv.appendChild(await T('Valor informado à mão', 'descrição', 'texto/apagado')); vv.appendChild(await T(manual ? `${manual} (informado à mão)` : '—'));
  if (manual) await btn(v, 'Remover valor', 'Contorno xs');
  if (history) {
    await field(v, { label: 'Valor que foi cobrado (R$)', value: '1.234,56', variant: 'Placeholder', width: 220 });
    await btn(v, 'Informar valor', 'Contorno xs');
    put(c, await T('Histórico', 'corpo forte'));
    for (const line of history) put(c, await T('•  ' + line), 'fill');
  }
  return c;
}
/** Pares rótulo/valor em 3 colunas. */
async function kvGrid(parent, pairs, name) {
  const g = AL('VERTICAL', { name, itemSpacing: 12 }); put(parent, g, 'fill');
  for (let i = 0; i < pairs.length; i += 3) {
    const r = AL('HORIZONTAL', { itemSpacing: 16, name: 'Linha' }); put(g, r, 'fill');
    for (const [k, v] of pairs.slice(i, i + 3)) {
      const c = AL('VERTICAL', { name: k, itemSpacing: 2 }); r.appendChild(c); c.layoutSizingHorizontal = 'FILL';
      c.appendChild(await T(k, 'descrição', 'texto/apagado')); c.appendChild(await T(v));
    }
  }
}

SCREENS['4.1'] = { name: 'Reservas — lista', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ main }) { await reservationsPage(main); } };

SCREENS['4.2'] = { name: 'Reservas — detalhe da reserva', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await reservationsPage(main);
    overlay(root);
    const d = drawer(root, 'Gaveta — detalhe da reserva');
    await titleWithClose(d, 'Detalhe da reserva');
    const t = row(d, 'Reserva', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
    const tl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 8, counterAxisAlignItems: 'BASELINE' }); t.appendChild(tl);
    tl.appendChild(await T('Reserva 101-1002', 'título seção')); tl.appendChild(await T('hotel 101', 'corpo', 'texto/apagado'));
    const tr = AL('HORIZONTAL', { name: 'Situações', itemSpacing: 8 }); t.appendChild(tr); await badge(tr, 'Vermelho', 'Erro na cobrança'); await badge(tr, 'Cinza', 'Ativa');
    await kvGrid(d, [['Hóspede', 'Carla Mendes'], ['Canal', 'Decolar'], ['Forma de pagamento', '—'], ['Check-in', '18/11/2026'], ['Check-out', '20/11/2026'], ['Valor total', 'R$ 655,00']], 'Dados da reserva');
    const m = AL('VERTICAL', { name: 'Motivo da classificação', itemSpacing: 2, paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12, cornerRadius: 8 });
    m.strokes = [paint('borda/padrão')]; put(d, m, 'fill');
    m.appendChild(await T('Motivo da classificação', 'descrição', 'texto/apagado')); m.appendChild(await T('O estado atual do pré-pagamento indica falha na cobrança.'));
    await treatmentSection(d, { buttons: ['Anexar tratativa', 'Anexar comprovante'], docs: [['Tratativa'], ['Comprovante']] });
    const cb = await card(d, null, 'fill', 12); cb.name = 'Card — Cobrança'; put(cb, await T('Cobrança', 'corpo forte'));
    await kvGrid(cb, [['Data', '—'], ['Responsável', '—'], ['Valor cobrado', '—'], ['Transação', '—'], ['Autorização', '—'], ['Referência da operadora', '—'], ['Parcelamento', '—'], ['Estado do pré-pagamento', 'Fail'], ['Mensagem do pré-pagamento', 'Cartão recusado pela operadora']], 'Dados da cobrança');
    const vf = await card(d, null, 'fill', 12); vf.name = 'Card — Verificações'; put(vf, await T('Verificações', 'corpo forte'));
    await kvGrid(vf, [['Primeira', '13/11/2026 15:46'], ['Última', '13/11/2026 15:46'], ['Quantidade', '1']], 'Verificações');
  } };

SCREENS['4.3'] = { name: 'Reservas — nenhum resultado', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ main }) { await reservationsPage(main, { q: 'Maria Oliveira', empty: true }); } };

// Sem conexão o app não sabe o perfil da chave: o cabeçalho fica sem cliente e "Executar" some do menu.
SCREENS['5.1'] = { name: 'Servidor indisponível (dados guardados na tela)', h: 900, profile: 'Sem conexão', nav: NAV_RD, active: 'Execuções',
  async build({ main }) {
    await alert(main, 'Amarelo', 'Servidor indisponível', 'O app vai reconectar sozinho assim que o servidor voltar. O que já estava na tela continua visível, com o horário em que foi obtido; as ações ficam desabilitadas até lá.');
    const h = row(main, 'Título', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
    h.appendChild(await T('Execuções', 'título página')); h.appendChild(await T('dados de 15:46 — servidor indisponível', 'corpo forte', 'amarelo/8'));
    await table(main, [['Iniciada em', 168], ['Quem iniciou', 276], ['Período de check-in', 233], ['Estado', 163], ['Motivo de término', 300], ['Encerrada em', 'fill']], [
      ['13/11/2026 15:46', 'Recepção — PC 1', PERIOD, { badge: 'Azul', text: 'Em andamento' }, '', ''],
      ['12/11/2026 09:12', 'Recepção — PC 1', '12/11/2026 a 18/11/2026', { badge: 'Vermelho', text: 'Falhou' }, 'O Hunit recusou o token.', '12/11/2026 09:13'],
    ]);
  } };

SCREENS['6.1'] = { name: 'Consulta — execuções', h: 900, profile: 'Consulta', nav: NAV_RD, active: 'Execuções',
  async build({ main }) {
    put(main, await T('Execuções', 'título página'));
    await table(main, [['Iniciada em', 168], ['Quem iniciou', 170], ['Período de check-in', 233], ['Estado', 130], ['Motivo de término', 330], ['Encerrada em', 'fill']], [
      ['13/11/2026 15:48', 'Recepção — PC 1', PERIOD, { badge: 'Verde', text: 'Concluída' }, '', '13/11/2026 15:49'],
      ['13/11/2026 15:48', 'Recepção — PC 1', PERIOD, { badge: 'Vermelho', text: 'Falhou' }, 'O Hunit recusou o token.', '13/11/2026 15:48'],
      ['13/11/2026 15:47', 'Recepção — PC 1', PERIOD, { badge: 'Vermelho', text: 'Falhou' }, 'Usuário ou senha do Hunit incorretos.', '13/11/2026 15:47'],
      ['13/11/2026 15:46', 'Recepção — PC 1', PERIOD, { badge: 'Verde', text: 'Concluída' }, '', '13/11/2026 15:49'],
    ]);
  } };

SCREENS['6.2'] = { name: 'Consulta — reservas', h: 900, profile: 'Consulta', nav: NAV_RD, active: 'Reservas',
  async build({ main }) { await reservationsPage(main, { operator: false, treatments: { '101-1000': ['Verde', 'Cobrada'], '101-1003': ['Azul', 'Enviada'] } }); } };
