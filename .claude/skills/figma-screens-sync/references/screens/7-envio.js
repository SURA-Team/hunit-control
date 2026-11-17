// Telas 7.1 a 7.6 — envio ao Comercial (specs/005): conferência, acompanhamento, pedido de token,
// resultado, detalhe "Validar comprovante" e recusa do retorno. Requer o figma-prelude.js e o
// 4-6-reservas-estados-consulta.js antes deste arquivo. Dados fictícios, os do roteiro de captura.

// As 15 reservas do envio do roteiro, na ordem do acompanhamento.
const SENT = [['Hotel Praia Azul', '101-1002'], ['Hotel Praia Azul', '101-1003'], ['Hotel Praia Azul', '101-1005'], ['Hotel Praia Azul', 'SA-2001'],
  ['Pousada Serra Verde', '102-1006'], ['Pousada Serra Verde', '102-1009'], ['Hotel Centro Histórico', '103-1010'], ['Hotel Centro Histórico', '103-1012'],
  ['Hotel Centro Histórico', '103-1013'], ['Hotel Centro Histórico', '103-1014'], ['Resort Lagoa Clara', '104-1016'], ['Resort Lagoa Clara', '104-1017'],
  ['Resort Lagoa Clara', '104-1019'], ['Resort Lagoa Clara', '104-1020'], ['Resort Lagoa Clara', '104-1021']];
const OUTCOMES = { sent: ['Verde', 'Enviada'], nv: ['Vermelho', 'Não verificada'], wait: ['Cinza', 'Aguardando verificação'] };
/** Linha do resultado: 'sent', 'nv' (não verificada, com o motivo) ou 'wait'. */
const outcome = (i, kind) => [SENT[i][0], SENT[i][1], { badge: OUTCOMES[kind][0], text: OUTCOMES[kind][1] }, kind === 'nv' ? 'não encontrada no Hunit no check-in registrado (10/05/2026)' : ''];

/** Fundo das telas do envio: as 15 reservas selecionadas na lista. */
async function dispatchBase(main) {
  await reservationsPage(main, { checked: RESERVATIONS.map((r) => r[1]), selection: [15, 'R$ 29.517,06'], count: 10 });
}

/** Diálogo do envio (DispatchView): estado, progresso, ação e o resultado de cada reserva. */
async function dispatchDialog(root, { status, done, counts, fraction, current, currentColor = 'texto/apagado', action, outcomes, footer = false }) {
  overlay(root);
  const m = modal(root, 780, 'Diálogo — envio ao Comercial');
  await titleWithClose(m, 'Enviar ao Comercial');
  const h = row(m, 'Envio', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const hl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 10, counterAxisAlignItems: 'CENTER' }); h.appendChild(hl);
  hl.appendChild(await T('Envio ao Comercial', 'título seção')); await badge(hl, status[0], status[1]);
  h.appendChild(await T('17/11/2026 16:34 — Recepção — PC 1', 'corpo', 'texto/apagado'));
  const p = await card(m, null, 'fill', 10); p.name = 'Progresso'; p.paddingTop = p.paddingBottom = 12;
  const pr = row(p, 'Contagem', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  pr.appendChild(await rich(done)); pr.appendChild(await T(counts, 'corpo', 'texto/apagado'));
  const bar = figma.createFrame(); bar.name = 'Barra de progresso'; p.appendChild(bar); bar.resize(100, 8); bar.layoutSizingHorizontal = 'FILL';
  bar.cornerRadius = 4; bar.fills = [paint('fundo/sutil')];
  if (fraction > 0) { const f = figma.createRectangle(); f.name = 'Concluído'; bar.appendChild(f); f.resize(Math.round(bar.width * fraction), 8); f.cornerRadius = 4; f.fills = [paint('azul/6')]; }
  if (current) put(p, await T(current, 'corpo', currentColor), 'fill');
  const a = row(m, 'Ação', {}); await btn(a, action[0], action[1]);
  autoRows(await table(m, [['Hotel', 150], ['Reserva', 80], ['Resultado', 175], ['Motivo', 'fill']], outcomes));
  if (footer) {
    const f = row(m, 'Rodapé', { primaryAxisAlignItems: 'MAX' }); await btn(f, 'Fechar', 'Contorno');
    put(m, await T('Fechar não interrompe o envio: ele continua no servidor, e o pedido de token aparece nesta máquina.', 'descrição', 'texto/apagado'), 'fill');
  }
  // O diálogo rola dentro da tela, como no app.
  if (m.height > 810) { m.primaryAxisSizingMode = 'FIXED'; m.resize(780, 810); m.clipsContent = true; }
  topOf(root, m);
  return m;
}

SCREENS['7.1'] = { name: 'Envio — conferência', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await dispatchBase(main);
    overlay(root);
    const m = modal(root, 780, 'Diálogo — enviar ao Comercial');
    await titleWithClose(m, 'Enviar ao Comercial');
    put(m, await rich([['15', 'b'], [' reservas aceitas — total de '], ['R$ 29.517,06', 'b'], ['.']]), 'fill');
    put(m, await T('Antes de ir para a planilha, cada reserva é verificada no Hunit: as que não exigirem mais cobrança são retiradas, e as que não puderem ser verificadas não são enviadas.', 'corpo', 'texto/apagado'), 'fill');
    const c = await card(m, 'Acesso ao Hunit', 'fill', 12);
    const r = row(c, 'Acesso guardado', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
    r.appendChild(await rich([['Usuário '], ['operador@exemplo.com.br', 'b'], [' — senha guardada nesta sessão']]));
    await btn(r, 'Limpar acesso', 'Contorno xs');
    const b = row(m, 'Botões', { itemSpacing: 12, primaryAxisAlignItems: 'MAX' });
    await btn(b, 'Cancelar', 'Contorno'); await btn(b, 'Enviar 15 ao Comercial');
    topOf(root, m);
  } };

SCREENS['7.2'] = { name: 'Envio — em andamento', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await dispatchBase(main);
    await dispatchDialog(root, {
      status: ['Azul', 'Em andamento'], done: [['6', 'b'], [' de '], ['15', 'b'], [' verificadas — faltam 9']],
      counts: '5 enviada(s) · 0 retirada(s) · 1 não verificada(s)', fraction: 0.4,
      current: 'Verificando a reserva 103-1010 (Hotel Centro Histórico) no Hunit…', action: ['Cancelar envio', 'Contorno xs'],
      outcomes: SENT.map((_, i) => outcome(i, i === 3 ? 'nv' : i < 6 ? 'sent' : 'wait')),
    });
  } };

SCREENS['7.3'] = { name: 'Envio — pedido de token', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await dispatchBase(main);
    await dispatchDialog(root, {
      status: ['Amarelo', 'Aguardando token'], done: [['0', 'b'], [' de '], ['15', 'b'], [' verificadas — faltam 15']],
      counts: '0 enviada(s) · 0 retirada(s) · 0 não verificada(s)', fraction: 0,
      current: 'Aguardando o token do Hunit.', currentColor: 'laranja/8', action: ['Cancelar envio', 'Contorno xs'],
      outcomes: SENT.map((_, i) => outcome(i, 'wait')), footer: true,
    });
    // O mesmo diálogo do token das execuções, com "Envio ao Comercial" (TwoFactorDialog).
    overlay(root);
    const m = modal(root, 440, 'Diálogo — pedido de token');
    const t = AL('VERTICAL', { name: 'Título', itemSpacing: 2 }); put(m, t, 'fill');
    t.appendChild(await T('O Hunit pediu o token', 'título diálogo')); t.appendChild(await T('Envio ao Comercial', 'corpo', 'texto/apagado'));
    const r = row(m, 'Tempo restante', { primaryAxisAlignItems: 'SPACE_BETWEEN' }); r.appendChild(await T('Tempo restante')); r.appendChild(await T('2:23', 'cronômetro'));
    const f = AL('VERTICAL', { name: 'Campo — Token do autenticador', itemSpacing: 4 }); put(m, f, 'fill'); put(f, await T('Token do autenticador', 'rótulo grande'));
    const inp = await I(K.campo['Foco'], { [P.campo]: '' }); put(f, inp, 'fill'); inp.resize(inp.width, 50);
    const a = row(m, 'Ações', { primaryAxisAlignItems: 'MAX' }); await btn(a, 'Enviar token');
    center(root, m);
  } };

SCREENS['7.4'] = { name: 'Envio — concluído', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await dispatchBase(main);
    await dispatchDialog(root, {
      status: ['Verde', 'Concluído'], done: [['15', 'b'], [' de '], ['15', 'b'], [' verificadas']],
      counts: '14 enviada(s) · 0 retirada(s) · 1 não verificada(s)', fraction: 1,
      action: ['Retomar as não verificadas (1)', 'Preenchido xs'],
      outcomes: SENT.map((_, i) => outcome(i, i === 3 ? 'nv' : 'sent')),
    });
  } };

/** Coluna rótulo/valor de uma grade (o valor é montado por `fill`). */
async function kvCol(parent, label, fill) {
  const c = AL('VERTICAL', { name: label, itemSpacing: 2 }); parent.appendChild(c); c.layoutSizingHorizontal = 'FILL';
  c.appendChild(await T(label, 'descrição', 'texto/apagado')); await fill(c);
  return c;
}
const kvText = (text, style = 'corpo', color = 'texto/padrão') => async (c) => { put(c, await T(text, style, color), 'fill'); };

/** Seção "Comercial" do detalhe (CommercialSection): aba, envios e o retorno aguardando validação. */
async function commercialCard(d) {
  const c = await card(d, null, 'fill', 12); c.name = 'Card — Comercial';
  const h = row(c, 'Cabeçalho', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const hl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 8, counterAxisAlignItems: 'CENTER' }); h.appendChild(hl);
  hl.appendChild(await T('Comercial', 'título seção')); await badge(hl, 'Azul', 'A cobrar');
  await btn(h, 'Desfazer envio', 'Contorno xs');
  await kvGrid(c, [['Aba da planilha', 'A cobrar'], ['Último envio', [['17/11/2026 16:34\n'], ['por Recepção — PC 1', 'dimsm']]], ['Primeiro envio', '17/11/2026 16:34']], 'Envio');
  const r = AL('VERTICAL', { name: 'Retorno do Comercial', itemSpacing: 12, paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12, cornerRadius: 8 });
  r.strokes = [paint('borda/padrão')]; put(c, r, 'fill');
  const rh = row(r, 'Cabeçalho', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const rl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 8, counterAxisAlignItems: 'CENTER' }); rh.appendChild(rl);
  rl.appendChild(await T('Retorno do Comercial', 'corpo forte')); await badge(rl, 'Amarelo', 'Aguardando validação');
  rh.appendChild(await T('lido em 17/11/2026 16:34', 'descrição', 'texto/apagado'));
  const g1 = row(r, 'Retorno', { itemSpacing: 16, counterAxisAlignItems: 'MIN' });
  await kvCol(g1, 'Código de autorização', kvText('AUT-55210'));
  await kvCol(g1, 'Hotel da cobrança', async (col) => { col.itemSpacing = 4; await chargeHotelBlock(col, 'Maquininha Centro de Convenções', true); });
  await kvCol(g1, 'Responsável pela cobrança', kvText('Paula (Comercial)'));
  const g2 = row(r, 'Valores', { itemSpacing: 16, counterAxisAlignItems: 'MIN' });
  await kvCol(g2, 'Valor cobrado', kvText('R$ 1.280,00'));
  await kvCol(g2, 'Valor a cobrar', kvText('R$ 655,00'));
  await kvCol(g2, 'Diferença', kvText('R$ 625,00', 'corpo forte', 'laranja/8'));
  const b = row(r, 'Ações', { itemSpacing: 8 }); await btn(b, 'Confirmar', 'Preenchido xs'); await btn(b, 'Recusar', 'Contorno xs');
}

/** Lista filtrada pela 101-1002 e a gaveta da reserva com o retorno aguardando validação. */
async function validateDetail(root, main) {
  const listed = [{ check: false }, ...RESERVATIONS[2].slice(0, 8), situationCell(['Amarelo', 'Validar comprovante']), { badge: 'Cinza', text: 'Ativa' }];
  await reservationsPage(main, { q: '101-1002', selection: [1, 'R$ 1.234,56'], rows: [listed] });
  overlay(root);
  const d = drawer(root, 'Gaveta — detalhe "Validar comprovante"');
  await titleWithClose(d, 'Detalhe da reserva');
  const t = row(d, 'Reserva', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const tl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 8, counterAxisAlignItems: 'BASELINE' }); t.appendChild(tl);
  tl.appendChild(await T('Reserva 101-1002', 'título seção')); tl.appendChild(await T('hotel 101', 'corpo', 'texto/apagado'));
  const tr = AL('HORIZONTAL', { name: 'Situações', itemSpacing: 8 }); t.appendChild(tr);
  await badge(tr, 'Amarelo', 'Validar comprovante'); await badge(tr, 'Cinza', 'Ativa');
  await kvGrid(d, [['Hóspede', 'Carla Mendes'], ['Canal', 'Decolar'], ['Forma de pagamento', '—'], ['Check-in', '20/11/2026'], ['Check-out', '22/11/2026'], ['Valor total', 'R$ 655,00'], ['Valor cobrado', '—']], 'Dados da reserva');
  await hunitStatus(d, ['Vermelho', 'Erro na cobrança'], 'O estado atual do pré-pagamento indica falha na cobrança.');
  await treatmentSection(d, {
    status: ['Amarelo', 'Validar comprovante'], buttons: ['Anexar tratativa', 'Anexar comprovante'], docs: [['Tratativa'], ['Comprovante']],
    history: ['17/11/2026 16:34 — Retorno do Comercial recebido — Comercial (planilha)', '17/11/2026 16:34 — Enviou ao Comercial — Recepção — PC 1'],
  });
  await commercialCard(d);
  const cb = await card(d, null, 'fill', 12); cb.name = 'Card — Cobrança'; put(cb, await T('Cobrança', 'corpo forte'));
  await kvGrid(cb, [['Data', '—'], ['Responsável', '—'], ['Valor cobrado no Hunit', '—'], ['Transação', '—'], ['Autorização', '—'], ['Referência da operadora', '—'], ['Parcelamento', '—'], ['Estado do pré-pagamento', 'Fail'], ['Mensagem do pré-pagamento', 'Cartão recusado pela operadora']], 'Dados da cobrança');
  const vf = await card(d, null, 'fill', 12); vf.name = 'Card — Verificações'; put(vf, await T('Verificações', 'corpo forte'));
  await kvGrid(vf, [['Primeira', '17/11/2026 16:33'], ['Última', '17/11/2026 16:34'], ['Quantidade', '2']], 'Verificações');
}

SCREENS['7.5'] = { name: 'Reservas — detalhe "Validar comprovante"', h: 1560, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) { await validateDetail(root, main); } };

/** Sugestão de motivo (Chip do Mantine): marcada = azul com o visto. */
async function chip(parent, label, on) {
  const c = AL('HORIZONTAL', { name: 'Sugestão — ' + label, itemSpacing: 6, paddingLeft: 14, paddingRight: 14, paddingTop: 5, paddingBottom: 5, cornerRadius: 16, counterAxisAlignItems: 'CENTER' });
  c.fills = [paint(on ? 'azul/6' : 'fundo/sutil')]; parent.appendChild(c);
  if (on) {
    const icon = figma.createNodeFromSvg('<svg width="12" height="12" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 9.5l3 3 6-6.5" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    icon.name = 'visto'; c.appendChild(icon);
  }
  c.appendChild(await T(label, 'descrição', on ? 'texto/inverso' : 'texto/padrão'));
}

SCREENS['7.6'] = { name: 'Reservas — recusar retorno', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await validateDetail(root, main);
    overlay(root);
    const m = modal(root, 440, 'Diálogo — recusar retorno');
    await titleWithClose(m, 'Recusar o retorno do Comercial', 'corpo forte');
    const n = AL('VERTICAL', { name: 'Aviso', paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, cornerRadius: 8 });
    n.fills = [paint('amarelo/1')]; put(m, n, 'fill');
    put(n, await T('O motivo aparece para o Comercial na planilha, na coluna "Validação do Financeiro". Não escreva dados do hóspede.'), 'fill');
    const chips = AL('HORIZONTAL', { name: 'Sugestões', itemSpacing: 8 }); put(m, chips, 'fill');
    chips.layoutWrap = 'WRAP'; chips.counterAxisSpacing = 8;
    for (const [label, on] of [['Código de autorização errado', false], ['Valor diferente', true], ['Pagamento não encontrado', false]]) await chip(chips, label, on);
    const f = await field(m, { label: 'Motivo da recusa', desc: '15/500', value: 'Valor diferente' });
    const area = f.children.at(-1); area.resize(area.width, 78); area.layoutSizingHorizontal = 'FILL';
    const b = row(m, 'Botões', { itemSpacing: 12, primaryAxisAlignItems: 'MAX' }); await btn(b, 'Voltar', 'Contorno'); await btn(b, 'Recusar', 'Perigo');
    topOf(root, m);
  } };
