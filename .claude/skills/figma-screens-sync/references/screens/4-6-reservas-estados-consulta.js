// Telas 4.x — Reservas (screens/reservations/), 5.x — Estados do sistema (components/ConnectionBanner.tsx,
// StaleDataNotice.tsx) e 6.x — Perfil consulta. Requer o figma-prelude.js antes deste arquivo.

// Dados fictícios: os mesmos do roteiro de captura (apps/desktop/test/e2e/screens-capture.test.ts).
const GUESTS = ['Ana Ribeiro', 'Bruno Carvalho', 'Carla Mendes', 'Diego Fernandes', 'Elisa Martins', 'Fábio Rocha', 'Gabriela Lima', 'Henrique Alves', 'Isabela Costa', 'João Pereira'];
const CHANNELS = ['Booking.com', 'Expedia', 'Decolar', 'Site próprio', 'Airbnb'];
const CLASS = [['Amarelo', 'Pendente de cobrança'], ['Verde', 'Já cobrada'], ['Vermelho', 'Erro na cobrança'], ['Amarelo', 'Cartão validado (não cobrado)'], ['Verde', 'Faturada'], ['Amarelo', 'Cobrar na maquininha'], ['Vermelho', 'Erro de análise']];
const HOTELS = [['101', 'Hotel Praia Azul', 6], ['102', 'Pousada Serra Verde', 4], ['103', 'Hotel Centro Histórico', 5], ['104', 'Resort Lagoa Clara', 7]];
const money = (v) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const RESERVATIONS = [];
{ let n = 0; for (const [code, name, count] of HOTELS) for (let i = 0; i < count; i++, n++) RESERVATIONS.push([name, `${code}-${1000 + n}`, GUESTS[n % 10], CHANNELS[n % 5], `${14 + (n % 5)}/11/2026`, `${16 + (n % 5)}/11/2026`, money(380 + n * 137.5), { badge: CLASS[n % 7][0], text: CLASS[n % 7][1] }, { badge: 'Cinza', text: 'Ativa' }]); }
const RES_COLS = [['Hotel', 180], ['Número', 89], ['Hóspede', 141], ['Canal', 115], ['Check-in', 104], ['Check-out', 104], ['Valor total', 104], ['Situação de cobrança', 254], ['Reserva', 'fill']];

async function reservationFilters(main, q = '') {
  const c = await card(main, null); c.name = 'Card — Filtros';
  const r1 = row(c, 'Linha 1', { itemSpacing: 12, counterAxisAlignItems: 'MIN' });
  (await field(r1, { label: 'Busca livre', desc: 'Número da reserva, hóspede, transação, código de autorização ou referência da operadora', value: q, variant: q ? 'Preenchido' : 'Placeholder' })).layoutSizingHorizontal = 'FILL';
  (await field(r1, { label: 'Valor (R$)', desc: 'Valor total ou valor cobrado, como no extrato (ex.: 1.234,56)', variant: 'Placeholder' })).layoutSizingHorizontal = 'FILL';
  const r2 = row(c, 'Linha 2', { itemSpacing: 12, counterAxisAlignItems: 'MIN' });
  for (const [label, ph, v] of [['Hotéis', 'Todos os hotéis', 'Placeholder/Seletor'], ['Período de check-in', 'Qualquer data', 'Placeholder'], ['Situação de cobrança', 'Todas as situações de cobrança', 'Placeholder/Seletor']])
    (await field(r2, { label, value: ph, variant: v })).layoutSizingHorizontal = 'FILL';
  const r3 = row(c, 'Linha 3', { itemSpacing: 12, counterAxisAlignItems: 'MIN' });
  for (const [label, ph] of [['Situação da reserva', 'Ativas e canceladas'], ['Canal', 'Todos os canais']])
    (await field(r3, { label, value: ph, variant: 'Placeholder/Seletor' })).layoutSizingHorizontal = 'FILL';
  spacer(r3);
  const r4 = row(c, 'Ações', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  r4.appendChild(await I(K.checkbox, { [P.checkbox]: 'Só as não encontradas na última verificação' }));
  const b = AL('HORIZONTAL', { name: 'Botões', itemSpacing: 12 }); r4.appendChild(b); await btn(b, 'Limpar', 'Contorno'); await btn(b, 'Buscar');
}
async function reservationsPage(main, { q = '', empty = false } = {}) {
  put(main, await T('Reservas', 'título página'));
  await reservationFilters(main, q);
  if (empty) put(main, await T('Nenhuma reserva encontrada com estes filtros.', 'corpo grande', 'texto/apagado'));
  else await table(main, RES_COLS, RESERVATIONS.slice(0, 12));
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
    await kvGrid(d, [['Hóspede', 'Carla Mendes'], ['Canal', 'Decolar'], ['Forma de pagamento', '—'], ['Check-in', '16/11/2026'], ['Check-out', '18/11/2026'], ['Valor total', 'R$ 655,00']], 'Dados da reserva');
    const m = AL('VERTICAL', { name: 'Motivo da classificação', itemSpacing: 2, paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12, cornerRadius: 8 });
    m.strokes = [paint('borda/padrão')]; put(d, m, 'fill');
    m.appendChild(await T('Motivo da classificação', 'descrição', 'texto/apagado')); m.appendChild(await T('O estado atual do pré-pagamento indica falha na cobrança.'));
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
  async build({ main }) { await reservationsPage(main); } };
