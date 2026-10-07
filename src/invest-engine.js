/**
 * invest-engine.js - Motor de cálculo do app Investimentos
 * Carteira (B3 + renda fixa), apuração de IR da renda variável e simulador de renda fixa.
 * Funções puras (UMD): rodam no navegador e no Node. Dinheiro sempre em centavos inteiros.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvestEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ==========================================
  // CONSTANTES (legislação vigente em out/2026; a MP 1.303/2025 caducou)
  // ==========================================
  const SCHEMA_VERSION = 1;
  const MAX_CENTS = 99999999999;          // R$ 999.999.999,99 por valor digitado
  const MAX_QTD = 100000000;              // 100 milhões de cotas/ações por operação
  const ISENCAO_ACOES = 2000000;          // R$ 20.000,00 em vendas de ações no mês (swing trade)
  const DARF_MINIMO = 1000;               // DARF abaixo de R$ 10,00 não é pago: acumula para o mês seguinte
  const ALIQUOTA_COMUM_BPS = 1500;        // ações, ETF de renda variável e BDR: 15%
  const ALIQUOTA_FII_BPS = 2000;          // fundos imobiliários: 20%
  const CLASSES = {
    acao: { nome: 'Ações', grupo: 'comum' },
    etf: { nome: 'ETFs', grupo: 'comum' },
    bdr: { nome: 'BDRs', grupo: 'comum' },
    fii: { nome: 'FIIs', grupo: 'fii' },
  };
  const TIPOS_PROVENTO = { dividendo: 'Dividendo', jcp: 'JCP', rendimento: 'Rendimento (FII)', outro: 'Outro' };
  // Como o app calcula o valor atual: pelas séries do Banco Central ou pelo saldo que o usuário informa.
  const INDEXADORES = {
    cdi: { nome: '% do CDI', faixa: [0, 1000] },
    selic: { nome: 'Selic +', faixa: [-10, 100] },
    pre: { nome: 'Prefixado', faixa: [0, 100] },
    ipca: { nome: 'IPCA +', faixa: [-10, 100] },
    poupanca: { nome: 'Poupança', faixa: null },
    manual: { nome: 'Saldo informado', faixa: null },
  };
  const RF_ISENTOS = ['lci', 'lca', 'poupanca'];
  // Criptos com cotação em reais pela CoinGecko (mesma fonte do app Cripto). Só o id da moeda vai na consulta.
  const MOEDAS = {
    btc: { nome: 'Bitcoin', gecko: 'bitcoin' }, eth: { nome: 'Ethereum', gecko: 'ethereum' }, sol: { nome: 'Solana', gecko: 'solana' },
    bnb: { nome: 'BNB', gecko: 'binancecoin' }, xrp: { nome: 'XRP', gecko: 'ripple' }, ada: { nome: 'Cardano', gecko: 'cardano' },
    doge: { nome: 'Dogecoin', gecko: 'dogecoin' }, link: { nome: 'Chainlink', gecko: 'chainlink' }, ltc: { nome: 'Litecoin', gecko: 'litecoin' },
    avax: { nome: 'Avalanche', gecko: 'avalanche-2' }, usdt: { nome: 'Tether (USDT)', gecko: 'tether' }, usdc: { nome: 'USD Coin (USDC)', gecko: 'usd-coin' },
  };
  const DOLAR_RESERVA = 550; // R$ 5,50: só se não houver cotação do Banco Central no aparelho (marcado como aproximado)
  const TIPOS_META = { patrimonio: 'Patrimônio', objetivo: 'Objetivo', aporte: 'Aporte mensal' };
  const CATEGORIAS_OUTROS = { previdencia: 'Previdência', fundo: 'Fundos', conta: 'Poupança/conta', outro: 'Outros' };
  const TIPOS_RF = { cdb: 'CDB/RDB', lci: 'LCI', lca: 'LCA', tesouro: 'Tesouro Direto', poupanca: 'Poupança', debenture: 'Debênture/CRI/CRA', outro: 'Outro' };
  // IOF regressivo sobre o rendimento nos primeiros 29 dias (dia 1 = 96%, dia 30 em diante = 0%).
  const IOF_TABELA = [96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3];

  // ==========================================
  // DATAS (sempre locais, AAAA-MM-DD; nunca UTC)
  // ==========================================
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const localISO = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hojeISO = (now) => localISO(now instanceof Date ? now : new Date());
  const parseISO = (iso) => { const p = String(iso).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; };
  const lastDayOfMonth = (y, m) => new Date(y, m, 0).getDate();
  function isValidISO(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const p = parseISO(text);
    return p.y >= 1900 && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= lastDayOfMonth(p.y, p.m);
  }
  const monthKey = (iso) => String(iso || '').slice(0, 7);
  function addMonthKey(mk, n) {
    const p = mk.split('-'); const total = (+p[0]) * 12 + (+p[1] - 1) + n;
    return Math.floor(total / 12) + '-' + pad((total % 12 + 12) % 12 + 1);
  }
  function diasEntre(a, b) {
    const x = parseISO(a), y = parseISO(b);
    return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
  }
  /** Último dia útil (seg–sex) do mês; feriados não são considerados. */
  function ultimoDiaUtil(mk) {
    const p = mk.split('-'); let d = lastDayOfMonth(+p[0], +p[1]);
    while ([0, 6].includes(new Date(+p[0], +p[1] - 1, d).getDay())) d--;
    return mk + '-' + pad(d);
  }
  const dateBR = (iso) => { if (!iso) return ''; const p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  const monthBR = (mk) => { const p = String(mk).split('-'); return p[1] + '/' + p[0]; };

  // ==========================================
  // DINHEIRO (centavos inteiros)
  // ==========================================
  function parseCents(value) {
    let s;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      s = String(value);
      if (/e/i.test(s)) return Math.round(value * 100);
    } else if (typeof value === 'string') {
      s = value.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
    } else return null;
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    let intPart, frac = '';
    if (lastComma >= 0 && lastDot >= 0) {
      const decPos = Math.max(lastComma, lastDot);
      intPart = s.slice(0, decPos).replace(/[.,]/g, ''); frac = s.slice(decPos + 1);
    } else if (lastComma >= 0) {
      if (s.indexOf(',') !== lastComma) return null;
      intPart = s.slice(0, lastComma); frac = s.slice(lastComma + 1);
    } else if (lastDot >= 0) {
      if (s.indexOf('.') !== lastDot) intPart = s.replace(/\./g, '');
      else { intPart = s.slice(0, lastDot); frac = s.slice(lastDot + 1); }
    } else intPart = s;
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
    let cents = (parseInt(intPart || '0', 10) * 100) + parseInt((frac + '00').slice(0, 2), 10);
    if (frac.length > 2 && frac.charCodeAt(2) >= 53) cents += 1;
    return neg ? -cents : cents;
  }
  function fmtBRL(cents) { return ((Number(cents) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function centsToInput(cents) {
    let c = Math.round(Number(cents) || 0); const neg = c < 0; if (neg) c = -c;
    return (neg ? '-' : '') + Math.floor(c / 100) + '.' + pad(c % 100);
  }
  function fmtPct(n, casas) {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: casas === undefined ? 2 : casas, maximumFractionDigits: casas === undefined ? 2 : casas }) + '%';
  }
  /** a × b ÷ c com arredondamento (metade para cima), sem estourar o Number (BigInt). */
  function mulDiv(a, b, c) {
    if (!c) return 0;
    const neg = (a < 0) !== (b < 0) !== (c < 0);
    const A = BigInt(Math.abs(Math.round(a))), B = BigInt(Math.abs(Math.round(b))), C = BigInt(Math.abs(Math.round(c)));
    const r = Number((A * B * 2n + C) / (C * 2n));
    return neg ? -r : r;
  }
  const sum = (list, fn) => list.reduce((t, x) => t + fn(x), 0);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const safeText = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 80);
  const safeId = (v) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || uid();
  const safeCents = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= MAX_CENTS ? n : 0; };
  const safeInt = (v, min, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const safeRate = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : def; };

  /** Código de negociação: maiúsculas, sem espaços; o sufixo F do fracionário vira o mesmo ativo (PETR4F → PETR4). */
  function normTicker(text) {
    let t = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^[A-Z0-9]{4}\d{1,2}F$/.test(t)) t = t.slice(0, -1);
    return /^[A-Z0-9]{3,12}$/.test(t) ? t : '';
  }

  // ==========================================
  // ESTADO
  // ==========================================
  function defaultParams() {
    // Hipóteses do simulador (% ao ano). Valores de reserva (Banco Central em 06/10/2026), usados até a primeira busca.
    // fonte: 'bcb' = buscados no Banco Central; 'manual' = editados pelo usuário (a busca automática não sobrescreve).
    return { cdi: 13.65, selic: 13.65, ipca: 4.59, tr: 1.97, custodia: 0.2, atualizadoEm: '', fonte: '', bcbEm: '', refs: {} };
  }
  function freshState() {
    return { schemaVersion: SCHEMA_VERSION, operacoes: [], eventos: [], proventos: [], cotacoes: {}, rendaFixa: [],
      prejuizoInicial: { comum: 0, fii: 0 }, params: defaultParams(), ofertas: defaultOfertas(), cripto: [], outros: [], rentInformada: {}, historico: [], metas: [], plano: {} };
  }
  function defaultOfertas() {
    return [];
  }
  function normalizeState(raw) {
    const s = freshState();
    if (!raw || typeof raw !== 'object') return s;
    const arr = (v) => (Array.isArray(v) ? v : []);
    let seq = 0;
    arr(raw.operacoes).forEach((o) => {
      const ticker = normTicker(o && o.ticker), qtd = safeInt(o && o.qtd, 1, MAX_QTD), preco = safeCents(o && o.preco);
      if (!ticker || !qtd || !(preco > 0) || !isValidISO(o.data) || !CLASSES[o.classe] || !['compra', 'venda'].includes(o.tipo)) return;
      s.operacoes.push({ id: safeId(o.id), seq: Number.isFinite(o.seq) ? o.seq : seq, data: o.data, ticker, classe: o.classe, tipo: o.tipo, qtd, preco, taxas: safeCents(o.taxas),
        instituicao: safeText(o.instituicao, 60) });
      seq++;
    });
    arr(raw.eventos).forEach((e) => {
      const ticker = normTicker(e && e.ticker);
      if (!ticker || !isValidISO(e.data)) return;
      if (e.tipo === 'fator') {
        const de = safeInt(e.de, 1, 1000000), para = safeInt(e.para, 1, 1000000);
        if (de && para && de !== para) s.eventos.push({ id: safeId(e.id), data: e.data, ticker, tipo: 'fator', de, para });
      } else if (e.tipo === 'bonificacao') {
        const pct = safeRate(e.pct, 0.0001, 10000, null);
        if (pct) s.eventos.push({ id: safeId(e.id), data: e.data, ticker, tipo: 'bonificacao', pct, custoUnit: safeCents(e.custoUnit) });
      }
    });
    arr(raw.proventos).forEach((p) => {
      const ticker = normTicker(p && p.ticker), valor = safeCents(p && p.valor);
      if (ticker && valor > 0 && isValidISO(p.data)) s.proventos.push({ id: safeId(p.id), data: p.data, ticker, tipo: TIPOS_PROVENTO[p.tipo] ? p.tipo : 'outro', valor });
    });
    if (raw.cotacoes && typeof raw.cotacoes === 'object') {
      Object.keys(raw.cotacoes).forEach((k) => {
        const t = normTicker(k), c = raw.cotacoes[k], preco = safeCents(c && c.preco);
        if (t && preco > 0) s.cotacoes[t] = normCotacao(c, preco);
      });
    }
    arr(raw.rendaFixa).forEach((r) => {
      const valorAplicado = safeCents(r && r.valorAplicado);
      if (!(valorAplicado > 0) || !isValidISO(r.aplicadoEm)) return;
      const resg = r.resgate && isValidISO(r.resgate.data) && safeCents(r.resgate.valor) > 0 ? { data: r.resgate.data, valor: safeCents(r.resgate.valor) } : null;
      const indexador = INDEXADORES[r.indexador] ? r.indexador : 'manual';
      const lim = INDEXADORES[indexador].faixa;
      s.rendaFixa.push({ id: safeId(r.id), nome: safeText(r.nome) || 'Aplicação', tipo: TIPOS_RF[r.tipo] ? r.tipo : 'outro', instituicao: safeText(r.instituicao, 60),
        indexador, taxaNum: lim ? safeRate(r.taxaNum, lim[0], lim[1], 0) : 0, aplicadoEm: r.aplicadoEm,
        valorAplicado, vencimento: isValidISO(r.vencimento) ? r.vencimento : '', taxa: safeText(r.taxa, 40),
        valorAtual: safeCents(r.valorAtual) || valorAplicado, atualizadoEm: isValidISO(r.atualizadoEm) ? r.atualizadoEm : r.aplicadoEm, resgate: resg,
        ajuste: r.ajuste && isValidISO(r.ajuste.data) && Number.isInteger(r.ajuste.juros) && Math.abs(r.ajuste.juros) <= MAX_CENTS ? { data: r.ajuste.data, juros: r.ajuste.juros } : null });
    });
    arr(raw.cripto).forEach((c) => {
      if (!c || typeof c !== 'object') return;
      if (c.tipo === 'compra' && c.qtd !== undefined && c.valorAplicado === undefined) { // formato antigo (com quantidade)
        c = { id: c.id, moeda: c.moeda, moedaValor: 'BRL', valorAplicado: c.valor, aplicadoEm: c.data, onde: c.onde, custodia: c.custodia };
      }
      const valorAplicado = safeCents(c.valorAplicado), moeda = MOEDAS[c.moeda] || c.moeda === 'outra' ? c.moeda : '';
      if (!moeda || !(valorAplicado > 0) || !isValidISO(c.aplicadoEm)) return;
      const vendas = arr(c.vendas).filter((v) => v && isValidISO(v.data) && safeCents(v.recebido) > 0 && Number.isInteger(v.custo) && v.custo >= 0)
        .map((v) => ({ data: v.data, recebido: safeCents(v.recebido), custo: v.custo }));
      const custoRest = Number.isInteger(c.custoRest) && c.custoRest >= 0 && c.custoRest <= valorAplicado ? c.custoRest : valorAplicado - sum(vendas, (v) => v.custo);
      s.cripto.push({ id: safeId(c.id), moeda, nome: moeda === 'outra' ? (safeText(c.nome, 40) || 'Cripto') : MOEDAS[moeda].nome,
        moedaValor: c.moedaValor === 'USD' ? 'USD' : 'BRL', aplicadoEm: c.aplicadoEm, valorAplicado, custoRest: Math.max(0, custoRest),
        valorAtual: c.valorAtual === 0 ? 0 : (safeCents(c.valorAtual) || (custoRest > 0 ? valorAplicado : 0)),
        atualizadoEm: isValidISO(c.atualizadoEm) ? c.atualizadoEm : c.aplicadoEm, onde: safeText(c.onde, 60),
        custodia: c.custodia === 'exterior' ? 'exterior' : 'nacional', vendas });
    });
    arr(raw.historico).forEach((h) => {
      if (h && isValidISO(h.data) && Number.isInteger(h.patrimonio) && h.patrimonio >= 0 && Number.isInteger(h.aplicado) && h.aplicado >= 0) s.historico.push({ data: h.data, patrimonio: h.patrimonio, aplicado: h.aplicado });
    });
    s.historico.sort((a, b) => a.data.localeCompare(b.data));
    s.historico = s.historico.filter((h, i, l) => i === l.length - 1 || l[i + 1].data !== h.data).slice(-4000);
    arr(raw.metas).forEach((m) => {
      if (!m || !TIPOS_META[m.tipo] || !(safeCents(m.valor) > 0)) return;
      s.metas.push({ id: safeId(m.id), tipo: m.tipo, nome: safeText(m.nome, 60) || TIPOS_META[m.tipo], valor: safeCents(m.valor), prazo: isValidISO(m.prazo) ? m.prazo : '',
        vinculos: arr(m.vinculos).filter((v) => v && ['rf', 'outro', 'cripto', 'acao'].includes(v.tipo) && typeof v.id === 'string').map((v) => ({ tipo: v.tipo, id: v.tipo === 'acao' ? normTicker(v.id) : safeId(v.id) })),
        criadoEm: isValidISO(m.criadoEm) ? m.criadoEm : '' });
    });
    if (raw.plano && typeof raw.plano === 'object') {
      Object.keys(raw.plano).forEach((ano) => {
        if (!/^\d{4}$/.test(ano) || !raw.plano[ano] || typeof raw.plano[ano] !== 'object') return;
        Object.keys(raw.plano[ano]).forEach((mes) => { const v = safeCents(raw.plano[ano][mes]); if (/^(0[1-9]|1[0-2])$/.test(mes) && v > 0) (s.plano[ano] = s.plano[ano] || {})[mes] = v; });
      });
    }
    if (raw.rentInformada && typeof raw.rentInformada === 'object') {
      Object.keys(raw.rentInformada).forEach((k) => {
        const t = normTicker(k), r = raw.rentInformada[k];
        if (t && r && Number.isInteger(r.ganho) && Math.abs(r.ganho) <= MAX_CENTS && isValidISO(r.data)) s.rentInformada[t] = { ganho: r.ganho, data: r.data };
      });
    }
    arr(raw.outros).forEach((o) => {
      const valorAplicado = safeCents(o && o.valorAplicado);
      if (!(valorAplicado > 0) || !isValidISO(o.aplicadoEm) || !CATEGORIAS_OUTROS[o.categoria]) return;
      const resg = o.resgate && isValidISO(o.resgate.data) && safeCents(o.resgate.valor) > 0 ? { data: o.resgate.data, valor: safeCents(o.resgate.valor) } : null;
      s.outros.push({ id: safeId(o.id), categoria: o.categoria, nome: safeText(o.nome) || CATEGORIAS_OUTROS[o.categoria], instituicao: safeText(o.instituicao, 60),
        aplicadoEm: o.aplicadoEm, valorAplicado, valorAtual: safeCents(o.valorAtual) || valorAplicado,
        atualizadoEm: isValidISO(o.atualizadoEm) ? o.atualizadoEm : o.aplicadoEm, resgate: resg });
    });
    if (raw.prejuizoInicial) { s.prejuizoInicial.comum = safeCents(raw.prejuizoInicial.comum); s.prejuizoInicial.fii = safeCents(raw.prejuizoInicial.fii); }
    if (raw.params) {
      const d = defaultParams(), p = raw.params;
      const refs = {};
      if (p.refs && typeof p.refs === 'object') {
        ['cdi', 'selic', 'ipca', 'tr'].forEach((k) => {
          const r = p.refs[k];
          if (r && isValidISO(r.data)) refs[k] = { data: r.data, bruto: safeRate(r.bruto, -100, 1000, null) };
        });
      }
      s.params = { cdi: safeRate(p.cdi, 0, 100, d.cdi), selic: safeRate(p.selic, 0, 100, d.selic), ipca: safeRate(p.ipca, -10, 100, d.ipca),
        tr: safeRate(p.tr, 0, 50, d.tr), custodia: safeRate(p.custodia, 0, 5, d.custodia), atualizadoEm: isValidISO(p.atualizadoEm) ? p.atualizadoEm : '',
        fonte: ['bcb', 'manual'].includes(p.fonte) ? p.fonte : '', bcbEm: isValidISO(p.bcbEm) ? p.bcbEm : '', refs };
    }
    if (Array.isArray(raw.ofertas)) {
      s.ofertas = raw.ofertas.filter((o) => o && PRODUTOS[o.tipo]).slice(0, 12).map((o) => ({ tipo: o.tipo, taxa: safeRate(o.taxa, 0, 1000, PRODUTOS[o.tipo].taxaPadrao || 0) }));
    }
    return s;
  }

  // ==========================================
  // RENDA VARIÁVEL: processamento cronológico (custo médio)
  // ==========================================
  /**
   * Percorre eventos e operações em ordem de data. No mesmo dia, eventos (desdobramento etc.) entram antes
   * das operações, porque a data do evento é a data a partir da qual a nova quantidade vale (data "ex").
   * Custo guardado como total (centavos); o preço médio é derivado — a venda baixa custo proporcional.
   */
  function processar(state) {
    const itens = [];
    state.eventos.forEach((e) => itens.push({ k: 0, data: e.data, seq: 0, e }));
    state.operacoes.forEach((o) => itens.push({ k: 1, data: o.data, seq: o.seq || 0, o }));
    itens.sort((a, b) => a.data.localeCompare(b.data) || a.k - b.k || a.seq - b.seq);

    const pos = {}, vendas = [], erros = [];
    const compraDia = {};
    state.operacoes.forEach((o) => { if (o.tipo === 'compra') compraDia[o.ticker + '|' + o.data] = true; });
    const getPos = (t, classe) => (pos[t] = pos[t] || { ticker: t, classe: classe || 'acao', qtd: 0, custo: 0 });

    itens.forEach((it) => {
      if (it.e) {
        const e = it.e, p = pos[e.ticker];
        if (!p || p.qtd <= 0) { erros.push({ id: e.id, erro: 'Sem posição em ' + e.ticker + ' em ' + dateBR(e.data) + ' para aplicar o evento.' }); return; }
        if (e.tipo === 'fator') {
          const nova = Math.floor((p.qtd * e.para) / e.de);
          if (nova < 1) { erros.push({ id: e.id, erro: 'O grupamento zeraria a posição em ' + e.ticker + '.' }); return; }
          p.qtd = nova; // custo total não muda; frações são leiloadas pela empresa
        } else {
          const novas = Math.floor(p.qtd * e.pct / 100 + 1e-9);
          p.qtd += novas; p.custo += novas * e.custoUnit;
        }
        return;
      }
      const o = it.o, p = getPos(o.ticker, o.classe);
      p.classe = o.classe;
      const bruto = o.qtd * o.preco;
      if (o.tipo === 'compra') { p.qtd += o.qtd; p.custo += bruto + o.taxas; return; }
      if (o.qtd > p.qtd) { erros.push({ id: o.id, erro: 'Venda de ' + o.qtd + ' ' + o.ticker + ' em ' + dateBR(o.data) + ', mas a posição era ' + p.qtd + '.' }); return; }
      const custo = mulDiv(p.custo, o.qtd, p.qtd);
      const liquido = bruto - o.taxas;
      p.qtd -= o.qtd; p.custo -= custo;
      if (p.qtd === 0) p.custo = 0;
      vendas.push({ id: o.id, data: o.data, ticker: o.ticker, classe: o.classe, qtd: o.qtd, valorBruto: bruto, valorLiquido: liquido, custo, ganho: liquido - custo,
        dayTrade: !!compraDia[o.ticker + '|' + o.data] });
    });
    return { posicoes: pos, vendas, erros };
  }

  function validarCom(state, mutar) {
    const copia = JSON.parse(JSON.stringify(state));
    mutar(copia);
    const r = processar(copia);
    return r.erros.length ? { ok: false, erro: r.erros[0].erro } : { ok: true, estado: copia };
  }

  function addOperacao(state, o) {
    const ticker = normTicker(o.ticker), qtd = safeInt(o.qtd, 1, MAX_QTD), preco = Number(o.preco), taxas = Number(o.taxas) || 0;
    if (!ticker) return { ok: false, erro: 'Código do ativo inválido (ex.: PETR4, HGLG11).' };
    if (!CLASSES[o.classe]) return { ok: false, erro: 'Classe do ativo inválida.' };
    if (!['compra', 'venda'].includes(o.tipo)) return { ok: false, erro: 'Tipo de operação inválido.' };
    if (!isValidISO(o.data)) return { ok: false, erro: 'Data inválida.' };
    if (o.hoje && o.data > o.hoje) return { ok: false, erro: 'A data não pode estar no futuro.' };
    if (!qtd) return { ok: false, erro: 'Quantidade deve ser um número inteiro entre 1 e ' + MAX_QTD.toLocaleString('pt-BR') + '.' };
    if (!(Number.isInteger(preco) && preco > 0)) return { ok: false, erro: 'Preço inválido.' };
    if (qtd * preco > MAX_CENTS) return { ok: false, erro: 'Valor total da operação acima do limite.' };
    if (!(Number.isInteger(taxas) && taxas >= 0 && taxas <= MAX_CENTS)) return { ok: false, erro: 'Taxas inválidas.' };
    if (o.tipo === 'venda' && taxas >= qtd * preco) return { ok: false, erro: 'As taxas não podem ser maiores que o valor da venda.' };
    const outra = state.operacoes.find((x) => x.ticker === ticker && x.classe !== o.classe);
    if (outra) return { ok: false, erro: ticker + ' já está cadastrado como ' + CLASSES[outra.classe].nome + '.' };
    const nova = { id: uid(), seq: state.operacoes.reduce((m, x) => Math.max(m, x.seq || 0), -1) + 1, data: o.data, ticker, classe: o.classe, tipo: o.tipo, qtd, preco, taxas,
      instituicao: safeText(o.instituicao, 60) };
    const v = validarCom(state, (s) => s.operacoes.push(nova));
    if (!v.ok) return v;
    state.operacoes.push(nova);
    return { ok: true, operacao: nova };
  }
  function removeOperacao(state, id) {
    const v = validarCom(state, (s) => { s.operacoes = s.operacoes.filter((x) => x.id !== id); });
    if (!v.ok) return { ok: false, erro: 'Excluir esta operação deixaria uma venda ou evento posterior sem posição. ' + v.erro };
    state.operacoes = state.operacoes.filter((x) => x.id !== id);
    return { ok: true };
  }
  function addEvento(state, e) {
    const ticker = normTicker(e.ticker);
    if (!ticker) return { ok: false, erro: 'Código do ativo inválido.' };
    if (!isValidISO(e.data)) return { ok: false, erro: 'Data inválida.' };
    let novo;
    if (e.tipo === 'fator') {
      const de = safeInt(e.de, 1, 1000000), para = safeInt(e.para, 1, 1000000);
      if (!de || !para || de === para) return { ok: false, erro: 'Informe a proporção (ex.: 1 para 2 no desdobramento, 10 para 1 no grupamento).' };
      novo = { id: uid(), data: e.data, ticker, tipo: 'fator', de, para };
    } else if (e.tipo === 'bonificacao') {
      const pct = safeRate(e.pct, 0.0001, 10000, null), custoUnit = Number(e.custoUnit) || 0;
      if (!pct) return { ok: false, erro: 'Informe o percentual da bonificação.' };
      if (!(Number.isInteger(custoUnit) && custoUnit >= 0 && custoUnit <= MAX_CENTS)) return { ok: false, erro: 'Custo atribuído inválido.' };
      novo = { id: uid(), data: e.data, ticker, tipo: 'bonificacao', pct, custoUnit };
    } else return { ok: false, erro: 'Tipo de evento inválido.' };
    const v = validarCom(state, (s) => s.eventos.push(novo));
    if (!v.ok) return v;
    state.eventos.push(novo);
    return { ok: true, evento: novo };
  }
  function removeEvento(state, id) {
    const v = validarCom(state, (s) => { s.eventos = s.eventos.filter((x) => x.id !== id); });
    if (!v.ok) return { ok: false, erro: 'Excluir este evento deixaria uma venda posterior sem posição. ' + v.erro };
    state.eventos = state.eventos.filter((x) => x.id !== id);
    return { ok: true };
  }
  const pctOuNull = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && Math.abs(n) < 100000 ? n : null; };
  /** Cotação guardada: preço em centavos; variações em % (null = sem dado); fonte 'manual' ou 'brapi'. */
  function normCotacao(c, preco) {
    const brapi = c && c.fonte === 'brapi';
    return { preco, data: isValidISO(c && c.data) ? c.data : '', fonte: brapi ? 'brapi' : 'manual',
      hora: brapi && typeof c.hora === 'string' && !isNaN(Date.parse(c.hora)) ? new Date(c.hora).toISOString() : '',
      buscadoEm: brapi && typeof c.buscadoEm === 'string' && !isNaN(Date.parse(c.buscadoEm)) ? new Date(c.buscadoEm).toISOString() : '',
      varDia: brapi ? pctOuNull(c.varDia) : null, varMes: brapi ? pctOuNull(c.varMes) : null, varAno: brapi ? pctOuNull(c.varAno) : null };
  }
  /** Rentabilidade informada pelo usuário (como a corretora mostra): em R$ ou em % sobre o custo atual do ativo. */
  function setRentabilidadeAtivo(state, ticker, o) {
    const t = normTicker(ticker), pos = processar(state).posicoes[t];
    if (!t || !pos || pos.qtd <= 0) return { ok: false, erro: 'Ativo não está na carteira.' };
    if (!isValidISO(o.data)) return { ok: false, erro: 'Data inválida.' };
    let ganho;
    if (Number.isInteger(o.ganho)) ganho = o.ganho;
    else if (Number.isFinite(Number(o.pct))) ganho = Math.round(pos.custo * Number(o.pct) / 100);
    else return { ok: false, erro: 'Informe a rentabilidade em R$ ou em %.' };
    if (Math.abs(ganho) > MAX_CENTS || pos.custo + ganho < 0) return { ok: false, erro: 'Rentabilidade inválida (o ativo não pode valer menos que zero).' };
    state.rentInformada[t] = { ganho, data: o.data };
    delete state.cotacoes[t];
    return { ok: true, ganho };
  }
  function setCotacao(state, ticker, preco, data) {
    const t = normTicker(ticker);
    if (!t) return { ok: false, erro: 'Código do ativo inválido.' };
    if (!(Number.isInteger(preco) && preco > 0 && preco <= MAX_CENTS)) return { ok: false, erro: 'Cotação inválida.' };
    if (state.rentInformada) delete state.rentInformada[t];
    state.cotacoes[t] = normCotacao({ data, fonte: 'manual' }, preco);
    return { ok: true };
  }

  // ==========================================
  // COTAÇÕES (brapi.dev) — só o código do ativo é enviado; a chave fica no cofre, fora do backup
  // ==========================================
  const BRAPI = {
    url: (ticker, range, token) => 'https://brapi.dev/api/quote/' + encodeURIComponent(ticker) + '?range=' + range + '&interval=1d' +
      (token ? '&token=' + encodeURIComponent(token) : ''),
    // Sem chave a brapi só responde estes ativos de teste.
    semChave: ['PETR4', 'VALE3', 'MGLU3', 'ITUB4'],
    validadeMin: 30, // o plano gratuito atualiza o preço a cada 30 minutos
  };
  /** Fechamento mais recente com data anterior a `antesDe` (ISO). */
  function fechamentoAntes(hist, antesDe) {
    let ref = null;
    hist.forEach((h) => { if (h.data < antesDe && (!ref || h.data > ref.data)) ref = h; });
    return ref;
  }
  /**
   * Resposta da brapi → {preco (centavos), data, hora, varDia, varMes, varAno} ou {erro}.
   * Mês: contra o último fechamento do mês anterior; ano: contra o último fechamento do ano anterior.
   * Sem histórico que alcance a referência (plano de 3 meses no caso do ano), a variação fica null.
   */
  function parseBrapi(json, hoje) {
    if (!json || json.error) return { erro: (json && json.code) || 'ERRO', mensagem: (json && json.message) || '' };
    const r = Array.isArray(json.results) ? json.results[0] : null;
    const precoNum = r ? Number(r.regularMarketPrice) : NaN;
    if (!r || !Number.isFinite(precoNum) || precoNum <= 0) return { erro: 'SEM_PRECO', mensagem: 'Ativo sem cotação na brapi.' };
    const preco = Math.round(precoNum * 100);
    if (preco <= 0 || preco > MAX_CENTS) return { erro: 'SEM_PRECO', mensagem: 'Cotação fora da faixa.' };
    const hora = r.regularMarketTime && !isNaN(Date.parse(r.regularMarketTime)) ? new Date(r.regularMarketTime) : null;
    const hist = (Array.isArray(r.historicalDataPrice) ? r.historicalDataPrice : [])
      .filter((h) => h && Number.isFinite(Number(h.date)) && Number(h.close) > 0)
      .map((h) => ({ data: localISO(new Date(Number(h.date) * 1000)), close: Number(h.close) }));
    const varPct = (ref) => (ref ? (precoNum / ref.close - 1) * 100 : null);
    const mk = monthKey(hoje), ano = String(hoje).slice(0, 4);
    const refMes = fechamentoAntes(hist, mk + '-01'), refAno = fechamentoAntes(hist, ano + '-01-01');
    return { preco, data: hora ? localISO(hora) : hoje, hora: hora ? hora.toISOString() : '',
      varDia: pctOuNull(r.regularMarketChangePercent), varMes: varPct(refMes), varAno: varPct(refAno), dias: hist.length };
  }
  function aplicarCotacaoBrapi(state, ticker, q, agora) {
    const t = normTicker(ticker);
    if (!t || !q || q.erro) return false;
    const quando = (agora instanceof Date ? agora : new Date()).toISOString();
    state.cotacoes[t] = normCotacao({ data: q.data, hora: q.hora, buscadoEm: quando, fonte: 'brapi', varDia: q.varDia, varMes: q.varMes, varAno: q.varAno }, q.preco);
    return true;
  }
  /** Ativos em carteira cuja cotação precisa ser buscada (sem cotação da brapi ou mais velha que 30 min). */
  function tickersParaAtualizar(state, agora) {
    const t0 = (agora instanceof Date ? agora : new Date()).getTime();
    return carteira(state).ativos.map((a) => a.ticker).filter((t) => {
      const c = state.cotacoes[t];
      return !c || c.fonte !== 'brapi' || !c.buscadoEm || t0 - Date.parse(c.buscadoEm) > BRAPI.validadeMin * 60000;
    });
  }
  function addProvento(state, p) {
    const ticker = normTicker(p.ticker), valor = Number(p.valor);
    if (!ticker) return { ok: false, erro: 'Código do ativo inválido.' };
    if (!isValidISO(p.data)) return { ok: false, erro: 'Data inválida.' };
    if (!(Number.isInteger(valor) && valor > 0 && valor <= MAX_CENTS)) return { ok: false, erro: 'Valor inválido.' };
    const novo = { id: uid(), data: p.data, ticker, tipo: TIPOS_PROVENTO[p.tipo] ? p.tipo : 'outro', valor };
    state.proventos.push(novo);
    return { ok: true, provento: novo };
  }

  // ==========================================
  // CRIPTO (só valores: quanto apliquei e quanto vale hoje, em R$ ou US$)
  // ==========================================
  // Dólar: PTAX venda do Banco Central (SGS 1), cotação do dia ou do último dia útil antes dele.
  const SERIE_DOLAR = 1;
  function dolarEm(series, data) {
    const s = series && series[SERIE_DOLAR];
    let ref = null;
    if (s && s.dados) for (let i = s.dados.length - 1; i >= 0; i--) if (s.dados[i][0] <= data) { ref = s.dados[i]; break; }
    return ref ? { centavos: Math.round(ref[1] * 100), data: ref[0], aproximado: false } : { centavos: DOLAR_RESERVA, data: '', aproximado: true };
  }
  /** Valor na moeda da anotação (centavos de R$ ou de US$) → centavos de R$ na data. */
  function emReais(valor, moedaValor, series, data) {
    if (moedaValor !== 'USD') return { valor, aproximado: false };
    const d = dolarEm(series, data);
    return { valor: mulDiv(valor, d.centavos, 100), aproximado: d.aproximado, dolar: d.centavos };
  }
  function addCripto(state, c) {
    const moeda = MOEDAS[c.moeda] || c.moeda === 'outra' ? c.moeda : '';
    if (!moeda) return { ok: false, erro: 'Escolha a moeda.' };
    if (moeda === 'outra' && !safeText(c.nome, 40)) return { ok: false, erro: 'Informe o nome da cripto.' };
    if (!isValidISO(c.aplicadoEm)) return { ok: false, erro: 'Data inválida.' };
    if (c.hoje && c.aplicadoEm > c.hoje) return { ok: false, erro: 'A data não pode estar no futuro.' };
    const valor = Number(c.valorAplicado);
    if (!(Number.isInteger(valor) && valor > 0 && valor <= MAX_CENTS)) return { ok: false, erro: 'Valor aplicado inválido.' };
    const atual = c.valorAtual === null || c.valorAtual === undefined || c.valorAtual === '' ? valor : Number(c.valorAtual);
    if (!(Number.isInteger(atual) && atual >= 0 && atual <= MAX_CENTS)) return { ok: false, erro: 'Valor atual inválido.' };
    const novo = { id: uid(), moeda, nome: moeda === 'outra' ? safeText(c.nome, 40) : MOEDAS[moeda].nome, moedaValor: c.moedaValor === 'USD' ? 'USD' : 'BRL',
      aplicadoEm: c.aplicadoEm, valorAplicado: valor, custoRest: valor, valorAtual: atual, atualizadoEm: c.hoje || c.aplicadoEm,
      onde: safeText(c.onde, 60), custodia: c.custodia === 'exterior' ? 'exterior' : 'nacional', vendas: [] };
    state.cripto.push(novo);
    return { ok: true, item: novo };
  }
  function atualizarCripto(state, id, valorAtual, data) {
    const x = state.cripto.find((c) => c.id === id);
    if (!x || !x.custoRest && !x.valorAtual) return { ok: false, erro: 'Anotação não encontrada.' };
    if (!(Number.isInteger(valorAtual) && valorAtual >= 0 && valorAtual <= MAX_CENTS)) return { ok: false, erro: 'Valor inválido.' };
    x.valorAtual = valorAtual; x.atualizadoEm = isValidISO(data) ? data : x.atualizadoEm;
    return { ok: true };
  }
  /**
   * Venda (total ou parcial) sem quantidade: a parte vendida é recebido ÷ (recebido + o que ficou na exchange);
   * baixa essa fração do custo. Valores na moeda da anotação.
   */
  function venderCripto(state, id, recebido, restante, data) {
    const x = state.cripto.find((c) => c.id === id);
    if (!x || !(x.custoRest > 0)) return { ok: false, erro: 'Anotação não encontrada ou já vendida.' };
    if (!(Number.isInteger(recebido) && recebido > 0 && recebido <= MAX_CENTS)) return { ok: false, erro: 'Valor recebido inválido.' };
    if (!(Number.isInteger(restante) && restante >= 0 && restante <= MAX_CENTS)) return { ok: false, erro: 'Valor que ficou inválido.' };
    if (!isValidISO(data) || data < x.aplicadoEm) return { ok: false, erro: 'A data da venda deve ser depois da aplicação.' };
    const custo = restante === 0 ? x.custoRest : mulDiv(x.custoRest, recebido, recebido + restante);
    x.vendas.push({ data, recebido, custo });
    x.custoRest -= custo; x.valorAtual = restante; x.atualizadoEm = data;
    if (restante === 0) x.custoRest = 0;
    return { ok: true, custo };
  }
  function removeCripto(state, id) { state.cripto = state.cripto.filter((x) => x.id !== id); return { ok: true }; }
  /** Posições em aberto, em reais (US$ convertido pela PTAX de hoje; custo pela PTAX da data da aplicação). */
  function criptoResumo(state, ctx, filtro) {
    ctx = ctx || {};
    const hoje = ctx.hoje || hojeISO();
    return state.cripto.filter((x) => x.custoRest > 0 || x.valorAtual > 0).filter(filtro || (() => true)).map((x) => {
      const atual = emReais(x.valorAtual, x.moedaValor, ctx.series, hoje), custo = emReais(x.custoRest, x.moedaValor, ctx.series, x.aplicadoEm);
      return Object.assign({}, x, { valor: atual.valor, custo: custo.valor, resultado: atual.valor - custo.valor,
        resultadoPct: custo.valor ? (atual.valor - custo.valor) / custo.valor * 100 : null, aproximado: atual.aproximado || custo.aproximado,
        resultadoMoeda: x.valorAtual - x.custoRest });
    }).sort((a, b) => b.valor - a.valor);
  }
  /** Vendas em reais para o IR: recebido pela PTAX da venda, custo pela PTAX da aplicação. */
  function vendasCripto(state, series) {
    const out = [];
    state.cripto.forEach((x) => x.vendas.forEach((v) => {
      const rec = emReais(v.recebido, x.moedaValor, series, v.data), cus = emReais(v.custo, x.moedaValor, series, x.aplicadoEm);
      out.push({ id: x.id, data: v.data, nome: x.nome, valor: rec.valor, custo: cus.valor, ganho: rec.valor - cus.valor, custodia: x.custodia, aproximado: rec.aproximado || cus.aproximado });
    }));
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }

  // ==========================================
  // IR DE CRIPTO (mesmas regras do app Cripto; legislação vigente em out/2026)
  // ==========================================
  const CRIPTO_ISENCAO = 3500000;  // R$ 35 mil em vendas no mês (exchange no Brasil)
  const CRIPTO_FAIXAS = [[500000000, 1500], [1000000000, 1750], [3000000000, 2000], [Infinity, 2250]]; // até R$ 5 mi 15%; 10 mi 17,5%; 30 mi 20%; acima 22,5%
  const CRIPTO_EXTERIOR_BPS = 1500;
  /** Imposto progressivo sobre o ganho (centavos), faixa a faixa. */
  function irCriptoFaixas(ganho) {
    let antes = 0, ir = 0;
    CRIPTO_FAIXAS.forEach(([ate, bps]) => { if (ganho > antes) { ir += Math.round((Math.min(ganho, ate) - antes) * bps / 10000); antes = ate; } });
    return ir;
  }
  /**
   * Exchange no Brasil: apuração mensal; isento se as vendas do mês (todas as moedas) somarem até R$ 35 mil; acima,
   * imposto progressivo sobre a soma dos ganhos positivos (postura conservadora: prejuízo do mês não abate, como no app
   * Cripto); DARF 4600 até o último dia útil do mês seguinte; abaixo de R$ 10 acumula.
   * Exchange no exterior (Lei 14.754/2023): 15% sobre o ganho do ano, na declaração anual, sem isenção; prejuízo passa
   * para os anos seguintes. O valor anotado na venda é tratado como o valor recebido (já sem taxas).
   */
  function apuracaoCripto(state, series) {
    const vendas = vendasCripto(state, series), meses = {}, anos = {};
    vendas.forEach((v) => {
      if (v.custodia === 'exterior') {
        const a = anos[v.data.slice(0, 4)] = anos[v.data.slice(0, 4)] || { ano: v.data.slice(0, 4), vendas: 0, resultado: 0, qtdVendas: 0 };
        a.vendas += v.valor; a.resultado += v.ganho; a.qtdVendas++;
        return;
      }
      const m = meses[monthKey(v.data)] = meses[monthKey(v.data)] || { mes: monthKey(v.data), vendas: 0, ganhos: 0, perdas: 0, qtdVendas: 0 };
      m.vendas += v.valor; m.qtdVendas++;
      if (v.ganho > 0) m.ganhos += v.ganho; else m.perdas += -v.ganho;
    });
    let acumulado = 0;
    const listaMeses = Object.keys(meses).sort().map((k) => {
      const m = meses[k], isento = m.vendas <= CRIPTO_ISENCAO;
      const imposto = isento ? 0 : irCriptoFaixas(m.ganhos);
      const acumuladoAnterior = acumulado, devido = imposto + acumulado, pagar = devido >= DARF_MINIMO;
      acumulado = pagar ? 0 : devido;
      return Object.assign(m, { isento, imposto, acumuladoAnterior, darf: pagar ? devido : 0, acumuladoProximo: acumulado,
        vencimento: pagar ? ultimoDiaUtil(addMonthKey(k, 1)) : '' });
    });
    let prejuizo = 0;
    const listaAnos = Object.keys(anos).sort().map((k) => {
      const a = anos[k], prejAntes = prejuizo, ajustado = a.resultado - prejuizo;
      const base = Math.max(0, ajustado); prejuizo = ajustado < 0 ? -ajustado : 0;
      return Object.assign(a, { prejAntes, base, imposto: Math.round(base * CRIPTO_EXTERIOR_BPS / 10000), prejDepois: prejuizo });
    });
    return { meses: listaMeses, anosExterior: listaAnos };
  }
  function darfsCriptoPendentes(state, hoje, series) { return apuracaoCripto(state, series).meses.filter((m) => m.darf > 0 && m.vencimento >= hoje); }

  // ==========================================
  // RENTABILIDADE DAS AÇÕES COM PROVENTOS
  // ==========================================
  /**
   * Por ativo: valorização (cotação − custo do que ainda tenho) + resultado das vendas + proventos recebidos.
   * Percentual sobre tudo o que já foi investido no ativo (soma das compras, com taxas).
   */
  function rentabilidadeAcoes(state) {
    const r = processar(state), cart = carteira(state).ativos, porT = {};
    const t = (k) => (porT[k] = porT[k] || { ticker: k, valorizacao: 0, vendas: 0, proventos: 0, investido: 0, classe: '' });
    state.operacoes.forEach((o) => { const x = t(o.ticker); x.classe = o.classe; if (o.tipo === 'compra') x.investido += o.qtd * o.preco + o.taxas; });
    r.vendas.forEach((v) => { t(v.ticker).vendas += v.ganho; });
    state.proventos.forEach((p) => { t(p.ticker).proventos += p.valor; });
    cart.forEach((a) => { t(a.ticker).valorizacao += a.resultado; });
    const lista = Object.keys(porT).map((k) => porT[k]).map((x) => Object.assign(x, { total: x.valorizacao + x.vendas + x.proventos }))
      .map((x) => Object.assign(x, { pct: x.investido ? x.total / x.investido * 100 : null }));
    const tot = { valorizacao: sum(lista, (x) => x.valorizacao), vendas: sum(lista, (x) => x.vendas), proventos: sum(lista, (x) => x.proventos), investido: sum(lista, (x) => x.investido) };
    tot.total = tot.valorizacao + tot.vendas + tot.proventos; tot.pct = tot.investido ? tot.total / tot.investido * 100 : null;
    return { porAtivo: lista.sort((a, b) => b.total - a.total), total: tot };
  }

  // ==========================================
  // OUTROS (previdência, fundos, poupança/conta, livre) — valor atual informado pelo usuário
  // ==========================================
  function addOutro(state, o) {
    if (!CATEGORIAS_OUTROS[o.categoria]) return { ok: false, erro: 'Escolha a categoria.' };
    const valor = Number(o.valorAplicado);
    if (!(Number.isInteger(valor) && valor > 0 && valor <= MAX_CENTS)) return { ok: false, erro: 'Valor aplicado inválido.' };
    if (!isValidISO(o.aplicadoEm)) return { ok: false, erro: 'Data inválida.' };
    if (o.hoje && o.aplicadoEm > o.hoje) return { ok: false, erro: 'A data não pode estar no futuro.' };
    const atual = o.valorAtual === null || o.valorAtual === undefined || o.valorAtual === '' ? valor : Number(o.valorAtual);
    if (!(Number.isInteger(atual) && atual > 0 && atual <= MAX_CENTS)) return { ok: false, erro: 'Valor atual inválido.' };
    const novo = { id: uid(), categoria: o.categoria, nome: safeText(o.nome) || CATEGORIAS_OUTROS[o.categoria], instituicao: safeText(o.instituicao, 60),
      aplicadoEm: o.aplicadoEm, valorAplicado: valor, valorAtual: atual, atualizadoEm: o.hoje || o.aplicadoEm, resgate: null };
    state.outros.push(novo);
    return { ok: true, item: novo };
  }
  function lista(state, qual) { return qual === 'outros' ? state.outros : state.rendaFixa; }
  function atualizarOutro(state, id, valorAtual, data) { return atualizarItem(state, 'outros', id, valorAtual, data); }
  function resgatarOutro(state, id, valor, data) { return resgatarItem(state, 'outros', id, valor, data); }
  function removeOutro(state, id) { state.outros = state.outros.filter((x) => x.id !== id); return { ok: true }; }

  // ==========================================
  // CARTEIRA
  // ==========================================
  function carteira(state, ctx) {
    ctx = ctx || {};
    const hoje = ctx.hoje || hojeISO();
    const r = processar(state);
    const ativos = Object.keys(r.posicoes).map((t) => r.posicoes[t]).filter((p) => p.qtd > 0).map((p) => {
      const inf = state.rentInformada && state.rentInformada[p.ticker];
      const c = inf ? null : state.cotacoes[p.ticker];
      const valor = inf ? Math.max(0, p.custo + inf.ganho) : c ? p.qtd * c.preco : p.custo;
      return { ticker: p.ticker, classe: p.classe, qtd: p.qtd, custo: p.custo, precoMedio: Math.round(p.custo / p.qtd), rentInformada: inf || null,
        cotacao: c ? c.preco : null, cotacaoData: c ? c.data : '', cotacaoFonte: c ? c.fonte : '', cotacaoHora: c ? c.hora : '',
        varDia: c ? c.varDia : null, varMes: c ? c.varMes : null, varAno: c ? c.varAno : null, valor, resultado: c || inf ? valor - p.custo : 0,
        resultadoPct: (c || inf) && p.custo > 0 ? (valor - p.custo) / p.custo * 100 : null };
    }).sort((a, b) => b.valor - a.valor);
    const rf = state.rendaFixa.filter((x) => !x.resgate).map((x) => Object.assign({}, x, { est: estimarRF(x, ctx.series, hoje, state.params) }));
    const cripto = criptoResumo(state, ctx), outros = state.outros.filter((x) => !x.resgate);
    const totalRV = sum(ativos, (a) => a.valor), totalRF = sum(rf, (x) => x.est.bruto), totalCripto = sum(cripto, (c) => c.valor), totalOutros = sum(outros, (x) => x.valorAtual);
    const total = totalRV + totalRF + totalCripto + totalOutros;
    const porClasse = {};
    ativos.forEach((a) => { porClasse[a.classe] = (porClasse[a.classe] || 0) + a.valor; });
    const alocacao = Object.keys(CLASSES).filter((k) => porClasse[k]).map((k) => ({ chave: k, nome: CLASSES[k].nome, valor: porClasse[k] }));
    if (totalRF) alocacao.push({ chave: 'rf', nome: 'Renda fixa', valor: totalRF });
    if (totalCripto) alocacao.push({ chave: 'cripto', nome: 'Cripto', valor: totalCripto });
    Object.keys(CATEGORIAS_OUTROS).forEach((k) => {
      const v = sum(outros.filter((x) => x.categoria === k), (x) => x.valorAtual);
      if (v) alocacao.push({ chave: 'o-' + k, nome: CATEGORIAS_OUTROS[k], valor: v });
    });
    alocacao.forEach((a) => { a.pct = total ? a.valor / total * 100 : 0; });
    alocacao.sort((a, b) => b.valor - a.valor);
    ativos.forEach((a) => { a.pctCarteira = total ? a.valor / total * 100 : 0; });
    return {
      ativos, alocacao, total, totalRV, totalRF, totalCripto, totalOutros, cripto, outros,
      custoCripto: sum(cripto, (c) => c.custo), aplicadoOutros: sum(outros, (x) => x.valorAplicado),
      resultadoCripto: sum(cripto, (c) => c.resultado),
      custoRV: sum(ativos, (a) => a.custo),
      naoRealizado: sum(ativos, (a) => a.resultado),
      semCotacao: ativos.filter((a) => a.cotacao === null && !a.rentInformada).map((a) => a.ticker),
      realizado: sum(r.vendas, (v) => v.ganho),
      aplicadoRF: sum(rf, (x) => x.valorAplicado),
      jurosRF: sum(rf, (x) => x.est.juros),
      liquidoRF: sum(rf, (x) => x.est.liquido),
      rendaFixa: rf,
      instituicoes: porInstituicao(state, ativos, rf, outros, cripto),
      erros: r.erros,
    };
  }
  /** Quanto saiu do seu bolso (custos e aplicações ainda em carteira) e o ganho sobre isso. */
  function totaisCarteira(c) {
    const aplicado = c.custoRV + c.aplicadoRF + c.custoCripto + c.aplicadoOutros;
    return { aplicado, ganho: c.total - aplicado };
  }
  const chaveInst = (nome) => (nome || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  /** Lista das instituições já usadas (para sugestão nos formulários), com a grafia mais recente. */
  function instituicoesUsadas(state) {
    const m = {};
    state.operacoes.concat(state.rendaFixa, state.outros || []).forEach((x) => { if (x.instituicao) m[chaveInst(x.instituicao)] = x.instituicao; });
    (state.cripto || []).forEach((x) => { if (x.onde) m[chaveInst(x.onde)] = x.onde; });
    return Object.keys(m).map((k) => m[k]).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  /**
   * Agrupa por banco/corretora. Renda variável: posição de cada ativo nas operações daquela instituição
   * (preço médio próprio, só para exibição — o IR usa o preço médio geral). Sem instituição: grupo "Sem instituição".
   */
  function porInstituicao(state, ativosGerais, rf, outros, cripto) {
    const grupos = {};
    const g = (nome) => { const k = chaveInst(nome) || '~'; return (grupos[k] = grupos[k] || { nome: nome || 'Sem instituição', ativos: [], rendaFixa: [], cripto: [], outros: [],
      valorRV: 0, custoRV: 0, valorRF: 0, aplicadoRF: 0, jurosRF: 0, valorCripto: 0, valorOutros: 0 }); };
    const opsPorInst = {};
    state.operacoes.forEach((o) => { const k = chaveInst(o.instituicao) || '~'; (opsPorInst[k] = opsPorInst[k] || { nome: o.instituicao, ops: [] }).ops.push(o); });
    Object.keys(opsPorInst).forEach((k) => {
      const sub = processar({ operacoes: opsPorInst[k].ops, eventos: state.eventos });
      Object.keys(sub.posicoes).forEach((t) => {
        const p = sub.posicoes[t];
        if (p.qtd <= 0) return;
        // Valor proporcional ao do ativo na carteira toda (vale para cotação e para rentabilidade informada).
        const geral = ativosGerais.find((a) => a.ticker === t), valor = geral && geral.custo ? mulDiv(geral.valor, p.custo, geral.custo) : p.custo, grupo = g(opsPorInst[k].nome);
        grupo.ativos.push({ ticker: t, classe: p.classe, qtd: p.qtd, custo: p.custo, valor, resultado: geral && (geral.cotacao !== null || geral.rentInformada) ? valor - p.custo : 0 });
        grupo.valorRV += valor; grupo.custoRV += p.custo;
      });
    });
    rf.forEach((x) => { const grupo = g(x.instituicao); grupo.rendaFixa.push(x); grupo.valorRF += x.est.bruto; grupo.aplicadoRF += x.valorAplicado; grupo.jurosRF += x.est.juros; });
    (cripto || []).forEach((c) => { const grupo = g(c.onde); grupo.cripto.push(c); grupo.valorCripto += c.valor; });
    (outros || []).forEach((x) => { const grupo = g(x.instituicao); grupo.outros.push(x); grupo.valorOutros += x.valorAtual; });
    return Object.keys(grupos).map((k) => grupos[k]).map((x) => Object.assign(x, { total: x.valorRV + x.valorRF + x.valorCripto + x.valorOutros }))
      .filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  }

  // ==========================================
  // ACOMPANHAMENTO (foto diária do patrimônio, guardada no aparelho)
  // ==========================================
  /** Grava (ou troca) a foto do dia. Devolve true se mudou algo. */
  function registrarHistorico(state, hoje, c) {
    const t = totaisCarteira(c), h = state.historico, ult = h[h.length - 1];
    const foto = { data: hoje, patrimonio: c.total, aplicado: t.aplicado };
    if (ult && ult.data === hoje) {
      if (ult.patrimonio === foto.patrimonio && ult.aplicado === foto.aplicado) return false;
      h[h.length - 1] = foto; return true;
    }
    if (!c.total && !h.length) return false; // nada anotado ainda
    h.push(foto); if (h.length > 4000) h.shift();
    return true;
  }
  /**
   * Série do acompanhamento: 'dia' (últimas 30 fotos), 'mes' (última foto de cada mês, 24 meses), 'ano' (última de cada ano).
   * "Rendeu" = variação do patrimônio sem contar dinheiro novo: Δpatrimônio − Δaplicado; % sobre o patrimônio anterior.
   */
  function acompanhamento(state, periodo) {
    const chave = periodo === 'ano' ? (d) => d.slice(0, 4) : periodo === 'mes' ? (d) => d.slice(0, 7) : (d) => d;
    const ult = {};
    state.historico.forEach((h) => { ult[chave(h.data)] = h; });
    let pontos = Object.keys(ult).sort().map((k) => Object.assign({ chave: k }, ult[k]));
    pontos = pontos.slice(periodo === 'ano' ? -10 : periodo === 'mes' ? -24 : -30);
    return pontos.map((p, i) => {
      const ant = i ? pontos[i - 1] : null, rendeu = ant ? (p.patrimonio - ant.patrimonio) - (p.aplicado - ant.aplicado) : null;
      return Object.assign(p, { ganho: p.patrimonio - p.aplicado, aportouLiq: ant ? p.aplicado - ant.aplicado : null, rendeu,
        rendeuPct: ant && ant.patrimonio ? rendeu / ant.patrimonio * 100 : null });
    });
  }

  // ==========================================
  // MOVIMENTOS, RELATÓRIOS, METAS E PLANEJAMENTO
  // ==========================================
  /** Todo dinheiro que entrou (aporte) ou saiu (resgate/venda) dos investimentos, em reais. */
  function movimentos(state, series) {
    const out = [];
    state.rendaFixa.forEach((x) => {
      out.push({ data: x.aplicadoEm, tipo: 'aporte', grupo: 'Renda fixa', nome: x.nome, valor: x.valorAplicado });
      if (x.resgate) out.push({ data: x.resgate.data, tipo: 'resgate', grupo: 'Renda fixa', nome: x.nome, valor: x.resgate.valor });
    });
    state.operacoes.forEach((o) => out.push({ data: o.data, tipo: o.tipo === 'compra' ? 'aporte' : 'resgate', grupo: CLASSES[o.classe].nome, nome: o.ticker,
      valor: o.tipo === 'compra' ? o.qtd * o.preco + o.taxas : o.qtd * o.preco - o.taxas }));
    (state.cripto || []).forEach((x) => {
      out.push({ data: x.aplicadoEm, tipo: 'aporte', grupo: 'Cripto', nome: x.nome, valor: emReais(x.valorAplicado, x.moedaValor, series, x.aplicadoEm).valor });
      x.vendas.forEach((v) => out.push({ data: v.data, tipo: 'resgate', grupo: 'Cripto', nome: x.nome, valor: emReais(v.recebido, x.moedaValor, series, v.data).valor }));
    });
    (state.outros || []).forEach((x) => {
      out.push({ data: x.aplicadoEm, tipo: 'aporte', grupo: CATEGORIAS_OUTROS[x.categoria], nome: x.nome, valor: x.valorAplicado });
      if (x.resgate) out.push({ data: x.resgate.data, tipo: 'resgate', grupo: CATEGORIAS_OUTROS[x.categoria], nome: x.nome, valor: x.resgate.valor });
    });
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }
  function aportesPorMes(state, series) {
    const m = {};
    movimentos(state, series).filter((x) => x.tipo === 'aporte').forEach((x) => { const k = monthKey(x.data); m[k] = (m[k] || 0) + x.valor; });
    return m;
  }
  /** Foto mais recente com data ≤ limite. */
  function fotoAte(state, limite) {
    let ref = null;
    state.historico.forEach((h) => { if (h.data <= limite) ref = h; });
    return ref;
  }
  /**
   * Relatório de um mês ('AAAA-MM') ou ano ('AAAA'): aportes, resgates, proventos, IR do período e, se houver fotos
   * do acompanhamento, patrimônio no início e no fim e quanto rendeu (fim − início − aportes + resgates).
   */
  function relatorio(state, periodo, ctx) {
    ctx = ctx || {};
    const anual = /^\d{4}$/.test(periodo);
    const ini = anual ? periodo + '-01-01' : periodo + '-01', fim = anual ? periodo + '-12-31' : periodo + '-' + pad(lastDayOfMonth(+periodo.slice(0, 4), +periodo.slice(5, 7)));
    const dentro = (d) => d >= ini && d <= fim;
    const mov = movimentos(state, ctx.series).filter((x) => dentro(x.data));
    const aportes = sum(mov.filter((x) => x.tipo === 'aporte'), (x) => x.valor), resgates = sum(mov.filter((x) => x.tipo === 'resgate'), (x) => x.valor);
    const proventos = sum(state.proventos.filter((p) => dentro(p.data)), (p) => p.valor);
    const noPeriodo = (m) => dentro(m.mes + '-01');
    const irAcoes = sum(apuracaoIR(state).filter(noPeriodo), (m) => m.impostoMes);
    const irCripto = sum(apuracaoCripto(state, ctx.series).meses.filter(noPeriodo), (m) => m.imposto) +
      (anual ? sum(apuracaoCripto(state, ctx.series).anosExterior.filter((a) => a.ano === periodo), (a) => a.imposto) : 0);
    const fIni = fotoAte(state, addDaysISO(ini, -1)), fFim = fotoAte(state, fim);
    const temFotos = !!(fIni && fFim && fFim.data >= ini);
    const rendeu = temFotos ? fFim.patrimonio - fIni.patrimonio - aportes + resgates : null;
    const porGrupo = {};
    mov.forEach((x) => { const g = porGrupo[x.grupo] = porGrupo[x.grupo] || { grupo: x.grupo, aportes: 0, resgates: 0 }; g[x.tipo === 'aporte' ? 'aportes' : 'resgates'] += x.valor; });
    return { periodo, anual, ini, fim, aportes, resgates, liquido: aportes - resgates, proventos, irAcoes, irCripto,
      patrimonioIni: fIni ? fIni.patrimonio : null, patrimonioFim: fFim && fFim.data >= ini ? fFim.patrimonio : null, rendeu,
      rendeuPct: temFotos && fIni.patrimonio ? rendeu / fIni.patrimonio * 100 : null,
      movimentos: mov.reverse(), porGrupo: Object.keys(porGrupo).map((k) => porGrupo[k]) };
  }
  function addDaysISO(iso, n) { const p = parseISO(iso); return localISO(new Date(p.y, p.m - 1, p.d + n)); }

  function addMeta(state, m) {
    if (!TIPOS_META[m.tipo]) return { ok: false, erro: 'Escolha o tipo de meta.' };
    const valor = Number(m.valor);
    if (!(Number.isInteger(valor) && valor > 0 && valor <= MAX_CENTS)) return { ok: false, erro: 'Valor da meta inválido.' };
    if (m.tipo === 'objetivo' && !safeText(m.nome, 60)) return { ok: false, erro: 'Dê um nome ao objetivo.' };
    if (m.prazo && (!isValidISO(m.prazo) || (m.hoje && m.prazo <= m.hoje))) return { ok: false, erro: 'O prazo deve ser uma data futura.' };
    const nova = { id: uid(), tipo: m.tipo, nome: safeText(m.nome, 60) || TIPOS_META[m.tipo], valor, prazo: m.tipo === 'aporte' ? '' : (m.prazo || ''),
      vinculos: m.tipo === 'objetivo' ? (m.vinculos || []) : [], criadoEm: m.hoje || '' };
    state.metas.push(nova);
    return { ok: true, meta: nova };
  }
  function removeMeta(state, id) { state.metas = state.metas.filter((m) => m.id !== id); return { ok: true }; }
  function setVinculosMeta(state, id, vinculos) { const m = state.metas.find((x) => x.id === id); if (!m) return { ok: false }; m.vinculos = vinculos; return { ok: true }; }
  const mesesAte = (hoje, prazo) => { const a = parseISO(hoje), b = parseISO(prazo); return Math.max(0, (b.y - a.y) * 12 + (b.m - a.m) + (b.d >= a.d ? 0 : -1)); };
  /**
   * Situação da meta. Patrimônio: patrimônio de hoje. Objetivo: soma dos investimentos ligados a ele.
   * "Aporte por mês" = quanto falta ÷ meses até o prazo, sem contar rendimento (conta simples, não é previsão).
   * Aporte mensal: aportes do mês atual e dos últimos 12 meses contra o valor da meta.
   */
  function situacaoMeta(state, meta, c, ctx) {
    ctx = ctx || {};
    const hoje = ctx.hoje || hojeISO();
    if (meta.tipo === 'aporte') {
      const apm = aportesPorMes(state, ctx.series), mk = monthKey(hoje), meses = [];
      for (let i = 11; i >= 0; i--) { const k = addMonthKey(mk, -i); meses.push({ mes: k, valor: apm[k] || 0, cumpriu: (apm[k] || 0) >= meta.valor }); }
      const atual = apm[mk] || 0;
      return { atual, pct: atual / meta.valor * 100, falta: Math.max(0, meta.valor - atual), meses, cumpridos: meses.filter((m) => m.cumpriu).length };
    }
    let atual = c.total, itens = [];
    if (meta.tipo === 'objetivo') {
      itens = meta.vinculos.map((v) => {
        if (v.tipo === 'rf') { const x = c.rendaFixa.find((r) => r.id === v.id); return x && { nome: x.nome, valor: x.est.bruto }; }
        if (v.tipo === 'outro') { const x = c.outros.find((r) => r.id === v.id); return x && { nome: x.nome, valor: x.valorAtual }; }
        if (v.tipo === 'cripto') { const x = c.cripto.find((r) => r.id === v.id); return x && { nome: x.nome, valor: x.valor }; }
        const a = c.ativos.find((r) => r.ticker === v.id); return a && { nome: a.ticker, valor: a.valor };
      }).filter(Boolean);
      atual = sum(itens, (x) => x.valor);
    }
    const falta = Math.max(0, meta.valor - atual), meses = meta.prazo ? mesesAte(hoje, meta.prazo) : null;
    return { atual, pct: atual / meta.valor * 100, falta, itens, meses, porMes: meses ? Math.ceil(falta / meses) : meses === 0 ? falta : null,
      atingida: atual >= meta.valor, vencida: !!(meta.prazo && meta.prazo < hoje && atual < meta.valor) };
  }
  function setPlano(state, ano, mes, valor) {
    if (!/^\d{4}$/.test(String(ano)) || !/^(0[1-9]|1[0-2])$/.test(mes)) return { ok: false, erro: 'Mês inválido.' };
    if (!(Number.isInteger(valor) && valor >= 0 && valor <= MAX_CENTS)) return { ok: false, erro: 'Valor inválido.' };
    const a = state.plano[ano] = state.plano[ano] || {};
    if (valor) a[mes] = valor; else delete a[mes];
    return { ok: true };
  }
  /** Planejado x feito no ano: feito = aportes anotados no mês (dinheiro que entrou nos investimentos). */
  function planejamento(state, ano, ctx) {
    ctx = ctx || {};
    const apm = aportesPorMes(state, ctx.series), plano = state.plano[ano] || {}, hojeMk = monthKey(ctx.hoje || hojeISO());
    const meses = [];
    for (let i = 1; i <= 12; i++) {
      const mm = pad(i), k = ano + '-' + mm, planejado = plano[mm] || 0, feito = apm[k] || 0;
      meses.push({ mes: k, planejado, feito, diferenca: feito - planejado, passado: k < hojeMk, atual: k === hojeMk });
    }
    const planejado = sum(meses, (m) => m.planejado), feito = sum(meses, (m) => m.feito);
    return { ano: String(ano), meses, planejado, feito, diferenca: feito - planejado, pct: planejado ? feito / planejado * 100 : null };
  }

  // ==========================================
  // IMPOSTO DE RENDA — renda variável (swing trade)
  // ==========================================
  /**
   * Apuração mensal:
   * - Ações: vendas do mês (valor bruto, só ações) ≤ R$ 20 mil → ganho isento; prejuízo do mês continua compensável.
   * - Ações, ETFs e BDRs formam o grupo "comum" (15%); prejuízos se compensam entre si.
   * - FIIs: 20%, sem isenção; prejuízo só compensa com ganho de FII.
   * - DARF 6015, vence no último dia útil do mês seguinte; abaixo de R$ 10,00 acumula para o mês seguinte.
   * - Day trade (compra e venda do mesmo ativo no mesmo dia) não é separado: o mês fica sinalizado.
   * - IRRF de 0,005% ("dedo-duro") não é descontado aqui (a estimativa fica um pouco acima).
   */
  function apuracaoIR(state) {
    const r = processar(state);
    const porMes = {};
    r.vendas.forEach((v) => {
      const m = monthKey(v.data);
      const x = porMes[m] = porMes[m] || { vendasAcoes: 0, vendasTotal: 0, acao: 0, etf: 0, bdr: 0, fii: 0, dayTrade: false, qtdVendas: 0 };
      if (v.classe === 'acao') x.vendasAcoes += v.valorBruto;
      x.vendasTotal += v.valorBruto;
      x[v.classe] += v.ganho;
      x.qtdVendas++;
      if (v.dayTrade) x.dayTrade = true;
    });
    const meses = Object.keys(porMes).sort();
    let prejComum = state.prejuizoInicial.comum, prejFii = state.prejuizoInicial.fii, acumulado = 0;
    return meses.map((m) => {
      const x = porMes[m];
      const isentoAcoes = x.vendasAcoes <= ISENCAO_ACOES;
      const ganhoIsento = isentoAcoes && x.acao > 0 ? x.acao : 0;
      const resComum = (ganhoIsento ? 0 : x.acao) + x.etf + x.bdr;
      const prejComumAntes = prejComum, prejFiiAntes = prejFii;
      let baseComum = 0;
      if (resComum < 0) prejComum += -resComum;
      else { const comp = Math.min(prejComum, resComum); prejComum -= comp; baseComum = resComum - comp; }
      let baseFii = 0;
      if (x.fii < 0) prejFii += -x.fii;
      else { const comp = Math.min(prejFii, x.fii); prejFii -= comp; baseFii = x.fii - comp; }
      const impostoComum = Math.round(baseComum * ALIQUOTA_COMUM_BPS / 10000);
      const impostoFii = Math.round(baseFii * ALIQUOTA_FII_BPS / 10000);
      const impostoMes = impostoComum + impostoFii;
      const acumuladoAnterior = acumulado;
      const devido = impostoMes + acumulado;
      const pagar = devido >= DARF_MINIMO;
      acumulado = pagar ? 0 : devido;
      return { mes: m, vendasAcoes: x.vendasAcoes, vendasTotal: x.vendasTotal, qtdVendas: x.qtdVendas, isentoAcoes, ganhoIsento,
        resultado: { acao: x.acao, etf: x.etf, bdr: x.bdr, fii: x.fii },
        baseComum, baseFii, prejComumAntes, prejComumDepois: prejComum, prejFiiAntes, prejFiiDepois: prejFii,
        impostoComum, impostoFii, impostoMes, acumuladoAnterior, darf: pagar ? devido : 0, acumuladoProximo: acumulado,
        vencimento: pagar ? ultimoDiaUtil(addMonthKey(m, 1)) : '', dayTrade: x.dayTrade };
    });
  }
  /** DARFs ainda não vencidos ou do mês corrente (para o resumo). */
  function darfsPendentes(state, hoje) {
    return apuracaoIR(state).filter((m) => m.darf > 0 && m.vencimento >= hoje);
  }

  // ==========================================
  // PROVENTOS
  // ==========================================
  function removeProvento(state, id) { state.proventos = state.proventos.filter((x) => x.id !== id); return { ok: true }; }
  function proventosResumo(state, hoje) {
    const inicio12 = addMonthKey(monthKey(hoje), -11) + '-01';
    const porTicker = {}, porTipo = {}, porMes = {};
    let total = 0, ult12 = 0;
    state.proventos.forEach((p) => {
      total += p.valor;
      if (p.data >= inicio12 && p.data <= hoje) { ult12 += p.valor; const m = monthKey(p.data); porMes[m] = (porMes[m] || 0) + p.valor; }
      porTicker[p.ticker] = (porTicker[p.ticker] || 0) + p.valor;
      porTipo[p.tipo] = (porTipo[p.tipo] || 0) + p.valor;
    });
    const meses = [];
    for (let i = 11; i >= 0; i--) { const m = addMonthKey(monthKey(hoje), -i); meses.push({ mes: m, valor: porMes[m] || 0 }); }
    return { total, ult12, mediaMensal12: Math.round(ult12 / 12), meses,
      porTicker: Object.keys(porTicker).map((t) => ({ ticker: t, valor: porTicker[t] })).sort((a, b) => b.valor - a.valor),
      porTipo: Object.keys(porTipo).map((t) => ({ tipo: t, nome: TIPOS_PROVENTO[t], valor: porTipo[t] })) };
  }

  // ==========================================
  // RENDA FIXA (posições informadas pelo usuário)
  // ==========================================
  function addRendaFixa(state, o) {
    const valor = Number(o.valorAplicado);
    if (!(Number.isInteger(valor) && valor > 0 && valor <= MAX_CENTS)) return { ok: false, erro: 'Valor aplicado inválido.' };
    if (!isValidISO(o.aplicadoEm)) return { ok: false, erro: 'Data da aplicação inválida.' };
    if (o.vencimento && (!isValidISO(o.vencimento) || o.vencimento < o.aplicadoEm)) return { ok: false, erro: 'O vencimento deve ser depois da aplicação.' };
    if (o.hoje && o.aplicadoEm > o.hoje) return { ok: false, erro: 'A data da aplicação não pode estar no futuro.' };
    const indexador = INDEXADORES[o.indexador] ? o.indexador : 'manual', lim = INDEXADORES[indexador].faixa, taxaNum = Number(o.taxaNum);
    if (lim && !(Number.isFinite(taxaNum) && taxaNum >= lim[0] && taxaNum <= lim[1])) return { ok: false, erro: 'Informe a taxa (' + INDEXADORES[indexador].nome + ').' };
    const novo = { id: uid(), nome: safeText(o.nome) || TIPOS_RF[o.tipo] || 'Aplicação', tipo: TIPOS_RF[o.tipo] ? o.tipo : 'outro', instituicao: safeText(o.instituicao, 60),
      indexador, taxaNum: lim ? taxaNum : 0, aplicadoEm: o.aplicadoEm,
      valorAplicado: valor, vencimento: o.vencimento || '', taxa: safeText(o.taxa, 40), valorAtual: valor, atualizadoEm: o.aplicadoEm, resgate: null };
    state.rendaFixa.push(novo);
    return { ok: true, item: novo };
  }
  function atualizarRendaFixa(state, id, valorAtual, data) { return atualizarItem(state, 'rf', id, valorAtual, data); }
  function atualizarItem(state, qual, id, valorAtual, data) {
    const x = lista(state, qual).find((r) => r.id === id);
    if (!x || x.resgate) return { ok: false, erro: 'Aplicação não encontrada.' };
    if (!(Number.isInteger(valorAtual) && valorAtual > 0 && valorAtual <= MAX_CENTS)) return { ok: false, erro: 'Valor inválido.' };
    x.valorAtual = valorAtual; x.atualizadoEm = isValidISO(data) ? data : x.atualizadoEm;
    return { ok: true };
  }
  function resgatarRendaFixa(state, id, valor, data) { return resgatarItem(state, 'rf', id, valor, data); }
  function resgatarItem(state, qual, id, valor, data) {
    const x = lista(state, qual).find((r) => r.id === id);
    if (!x || x.resgate) return { ok: false, erro: 'Aplicação não encontrada.' };
    if (!(Number.isInteger(valor) && valor > 0 && valor <= MAX_CENTS)) return { ok: false, erro: 'Valor inválido.' };
    if (!isValidISO(data) || data < x.aplicadoEm) return { ok: false, erro: 'A data do resgate deve ser depois da aplicação.' };
    x.resgate = { data, valor };
    return { ok: true };
  }
  /**
   * Informa os juros de hoje (ou de uma data) de uma aplicação. Com taxa conhecida, a conta segue rendendo a partir daí;
   * com "saldo informado", vira o novo saldo. Juros podem ser negativos (ex.: Tesouro marcado a mercado).
   */
  function informarJurosRF(state, id, juros, data, hoje) {
    const x = state.rendaFixa.find((r) => r.id === id);
    if (!x || x.resgate) return { ok: false, erro: 'Aplicação não encontrada.' };
    if (!(Number.isInteger(juros) && Math.abs(juros) <= MAX_CENTS) || x.valorAplicado + juros <= 0) return { ok: false, erro: 'Valor de juros inválido.' };
    if (!isValidISO(data) || data < x.aplicadoEm || (hoje && data > hoje)) return { ok: false, erro: 'A data deve estar entre a aplicação e hoje.' };
    if (x.indexador === 'manual') { x.valorAtual = x.valorAplicado + juros; x.atualizadoEm = data; x.ajuste = null; }
    else x.ajuste = { data, juros };
    return { ok: true };
  }
  function limparJurosRF(state, id) { const x = state.rendaFixa.find((r) => r.id === id); if (x) x.ajuste = null; return { ok: !!x }; }
  function removeRendaFixa(state, id) { state.rendaFixa = state.rendaFixa.filter((x) => x.id !== id); return { ok: true }; }

  // ==========================================
  // ÍNDICES DO BANCO CENTRAL (consulta pública; nenhum dado do usuário é enviado)
  // ==========================================
  const BCB = {
    // SGS: 4389 = CDI anualizado (base 252); 1178 = Selic efetiva anualizada (base 252); 226 = TR (% no mês).
    sgs: (serie) => 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + serie + '/dados/ultimos/1?formato=json',
    series: { cdi: 4389, selic: 1178, tr: 226 },
    // Boletim Focus: mediana da expectativa de IPCA para os próximos 12 meses (suavizada).
    focus: 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoInflacao12Meses' +
      "?$top=1&$filter=Indicador%20eq%20'IPCA'%20and%20Suavizada%20eq%20'S'%20and%20baseCalculo%20eq%200&$orderby=Data%20desc&$format=json&$select=Data,Mediana",
  };
  const round2 = (n) => Math.round(n * 100) / 100;
  /** Resposta do SGS ([{data:'dd/mm/aaaa', valor:'13.65'}]) → {valor, data ISO} ou null. */
  function parseSgs(json) {
    const last = Array.isArray(json) ? json[json.length - 1] : null;
    if (!last) return null;
    const v = Number(String(last.valor).replace(',', '.')), m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(last.data || ''));
    if (!Number.isFinite(v) || !m) return null;
    const data = m[3] + '-' + m[2] + '-' + m[1];
    return isValidISO(data) ? { valor: v, data } : null;
  }
  /** Resposta do Focus ({value:[{Data:'aaaa-mm-dd', Mediana:4.59}]}) → {valor, data} ou null. */
  function parseFocus(json) {
    const it = json && Array.isArray(json.value) ? json.value[0] : null;
    if (!it) return null;
    const v = Number(it.Mediana), data = String(it.Data || '').slice(0, 10);
    return Number.isFinite(v) && isValidISO(data) ? { valor: v, data } : null;
  }
  /** TR mensal (% a.m.) → % ao ano composto. */
  function trAnual(mensalPct) { return (Math.pow(1 + mensalPct / 100, 12) - 1) * 100; }
  /**
   * Aplica os índices obtidos (os que vierem; falha parcial mantém o valor anterior). Valores fora de faixa são ignorados.
   * indices: {cdi, selic, tr (mensal), ipca} cada um {valor, data}. Devolve a lista de chaves atualizadas.
   */
  function aplicarIndices(params, indices, hoje) {
    const faixas = { cdi: [0, 100], selic: [0, 100], ipca: [-10, 100], tr: [0, 50] }, ok = [];
    params.refs = params.refs || {};
    Object.keys(faixas).forEach((k) => {
      const x = indices && indices[k];
      if (!x || !Number.isFinite(x.valor) || !isValidISO(x.data)) return;
      const v = round2(k === 'tr' ? trAnual(x.valor) : x.valor);
      if (v < faixas[k][0] || v > faixas[k][1]) return;
      params[k] = v; params.refs[k] = { data: x.data, bruto: x.valor }; ok.push(k);
    });
    if (ok.length) { params.fonte = 'bcb'; params.bcbEm = hoje; params.atualizadoEm = hoje; }
    return ok;
  }
  /** Busca automática: só se os índices não foram editados à mão e não foram buscados hoje. */
  function precisaBuscarIndices(params, hoje) { return params.fonte !== 'manual' && params.bcbEm !== hoje; }

  // ==========================================
  // RENDA FIXA: valor atual pelas séries históricas do Banco Central
  // ==========================================
  // SGS diárias: 12 = CDI (% ao dia), 11 = Selic (% ao dia). Mensal: 433 = IPCA (% no mês). Janela máxima de 10 anos.
  const SERIES_RF = { cdi: 12, selic: 11, ipca: 433 };
  function urlSerie(codigo, inicioISO, fimISO) {
    return 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + codigo + '/dados?formato=json&dataInicial=' + dateBR(inicioISO) + '&dataFinal=' + dateBR(fimISO);
  }
  /** Janelas de no máximo 10 anos (menos 1 dia) entre início e fim. */
  function janelasSerie(inicioISO, fimISO) {
    const out = []; let ini = inicioISO;
    while (ini <= fimISO) {
      const p = parseISO(ini), lim = localISO(new Date(p.y + 10, p.m - 1, p.d - 1));
      const fim = lim < fimISO ? lim : fimISO;
      out.push([ini, fim]);
      const q = parseISO(fim); ini = localISO(new Date(q.y, q.m - 1, q.d + 1));
    }
    return out;
  }
  /** Resposta SGS por período → [[ISO, valor], ...] ordenado. */
  function parseSerie(json) {
    // Sem dado no período o SGS responde (às vezes com HTTP 200) {erro:{statusCode:404, detail:'Value(s) not found'}}: é "nada novo", não falha.
    if (json && json.erro && Number(json.erro.statusCode) === 404) return [];
    if (!Array.isArray(json)) return null;
    const out = [];
    json.forEach((x) => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(x && x.data || '')), v = Number(String(x && x.valor).replace(',', '.'));
      if (m && Number.isFinite(v)) { const iso = m[3] + '-' + m[2] + '-' + m[1]; if (isValidISO(iso)) out.push([iso, v]); }
    });
    return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  /** Junta pontos novos ao cache (sem duplicar datas). */
  function mergeSerie(atual, novos) {
    const m = {};
    (atual || []).concat(novos || []).forEach((x) => { m[x[0]] = x[1]; });
    return Object.keys(m).sort().map((k) => [k, m[k]]);
  }
  /** O que falta buscar: códigos e período, a partir das aplicações ativas e do cache. */
  function seriesNecessarias(state, cache, hoje) {
    const ativas = state.rendaFixa.filter((x) => !x.resgate);
    const precisa = {};
    ativas.forEach((x) => {
      const cods = x.indexador === 'cdi' || x.indexador === 'pre' ? [SERIES_RF.cdi] : x.indexador === 'selic' ? [SERIES_RF.selic] : x.indexador === 'ipca' ? [SERIES_RF.ipca, SERIES_RF.cdi] : [];
      cods.forEach((c) => { if (!precisa[c] || x.aplicadoEm < precisa[c]) precisa[c] = x.aplicadoEm; });
    });
    (state.cripto || []).filter((x) => x.moedaValor === 'USD').forEach((x) => {
      const d = addMonthKey(monthKey(x.aplicadoEm), -1) + '-01'; // um pouco antes, para cobrir fins de semana e feriados
      if (!precisa[SERIE_DOLAR] || d < precisa[SERIE_DOLAR]) precisa[SERIE_DOLAR] = d;
    });
    return Object.keys(precisa).map((c) => {
      const s = cache && cache[c];
      // Busca de novo: sem cache, cache começando depois da aplicação mais antiga ou cache não atualizado hoje.
      if (!s || !s.inicio || s.inicio > precisa[c]) return { codigo: +c, inicio: precisa[c], fim: hoje };
      if (s.buscadoEm !== hoje) return { codigo: +c, inicio: s.dados.length ? s.dados[s.dados.length - 1][0] : precisa[c], fim: hoje };
      return null;
    }).filter(Boolean);
  }

  /**
   * Valor estimado de uma aplicação de renda fixa no dia de hoje (ou no vencimento, se já venceu).
   * - % do CDI: produto de (1 + CDI do dia × %) em cada dia útil desde a aplicação (o CDI do dia da aplicação conta).
   * - Selic +: produto da Selic diária × (1 + spread)^(dias úteis/252).
   * - Prefixado: (1 + taxa)^(dias úteis/252); dias úteis = dias com CDI publicado no período.
   * - IPCA +: IPCA mensal publicado, proporcional aos dias do mês em que o dinheiro ficou aplicado; meses ainda não
   *   publicados usam o IPCA esperado das hipóteses; mais (1 + taxa)^(dias úteis/252).
   * - Poupança: meses cheios com a regra atual (hipóteses de Selic e TR).
   * - Sem série no aparelho (offline), usa as hipóteses atuais (taxa anual) e marca como aproximado.
   * IOF (até 29 dias) e IR regressivo são calculados como se resgatasse na data; LCI, LCA e poupança são isentas.
   * Valores aproximados: o banco pode arredondar de outro jeito e alguns papéis pagam juros antes do vencimento.
   */
  function estimarRF(item, series, hoje, params) {
    const p = Object.assign(defaultParams(), params || {});
    const ate = item.vencimento && item.vencimento < hoje ? item.vencimento : hoje;
    const dias = Math.max(0, diasEntre(item.aplicadoEm, ate));
    const isento = RF_ISENTOS.includes(item.tipo);
    const base = { bruto: item.valorAplicado, juros: 0, iof: 0, ir: 0, liquido: item.valorAplicado, dias, ate, aproximado: false, isento, vencido: !!(item.vencimento && item.vencimento <= hoje) };
    if (item.indexador === 'manual') {
      const juros = item.valorAtual - item.valorAplicado, diasM = Math.max(0, diasEntre(item.aplicadoEm, item.atualizadoEm)), impM = impostos(juros, diasM, isento);
      Object.assign(base, { bruto: item.valorAtual, juros, ate: item.atualizadoEm, dias: diasM, liquido: item.valorAtual - impM.total, iof: impM.iof, ir: impM.ir, manual: true });
      const sCdi = series && series[SERIES_RF.cdi];
      const pts = sCdi && sCdi.dados && sCdi.inicio && sCdi.inicio <= item.aplicadoEm ? sCdi.dados.filter((x) => x[0] >= item.aplicadoEm && x[0] < item.atualizadoEm) : null;
      const cdiF = pts ? pts.reduce((f, x) => f * (1 + x[1] / 100), 1) : Math.pow(1 + p.cdi / 100, diasUteis(diasM) / 252);
      return Object.assign(base, rentabilidadeRF(base, item.valorAplicado, cdiF));
    }
    // Juros informados pelo usuário (ex.: o que o banco mostra): a conta recomeça desse valor e dessa data.
    const aj = item.ajuste && item.ajuste.data >= item.aplicadoEm && item.ajuste.data <= hoje ? item.ajuste : null;
    const inicio = aj ? (aj.data < ate ? aj.data : ate) : item.aplicadoEm, principal = aj ? item.valorAplicado + aj.juros : item.valorAplicado;
    const pontosDe = (cod, de) => { const s = series && series[cod]; return s && s.dados && s.inicio && s.inicio <= item.aplicadoEm ? s.dados.filter((x) => x[0] >= de && x[0] < ate) : null; };
    const pontos = (cod) => pontosDe(cod, inicio);
    const cdi = pontos(SERIES_RF.cdi);
    const du = cdi ? cdi.length : diasUteis(Math.max(0, diasEntre(inicio, ate)));
    let fator = 1, aproximado = !cdi, ipcaProjetado = false;
    const t = item.taxaNum;
    if (item.indexador === 'cdi') {
      fator = cdi ? cdi.reduce((f, x) => f * (1 + x[1] / 100 * t / 100), 1) : Math.pow(1 + (Math.pow(1 + p.cdi / 100, 1 / 252) - 1) * t / 100, du);
    } else if (item.indexador === 'selic') {
      const sel = pontos(SERIES_RF.selic); aproximado = !sel;
      const fs = sel ? sel.reduce((f, x) => f * (1 + x[1] / 100), 1) : Math.pow(1 + p.selic / 100, (sel ? sel.length : du) / 252);
      fator = fs * Math.pow(1 + t / 100, (sel ? sel.length : du) / 252);
    } else if (item.indexador === 'pre') {
      fator = Math.pow(1 + t / 100, du / 252);
    } else if (item.indexador === 'ipca') {
      const s = series && series[SERIES_RF.ipca], mensal = {};
      if (s && s.dados) s.dados.forEach((x) => { mensal[x[0].slice(0, 7)] = x[1]; });
      let fi = 1, mk = monthKey(inicio);
      const fimMk = monthKey(ate);
      while (mk <= fimMk) {
        const pm = mk.split('-'), dm = lastDayOfMonth(+pm[0], +pm[1]);
        const ini = mk === monthKey(inicio) ? parseISO(inicio).d : 1;
        const fim = mk === fimMk ? parseISO(ate).d : dm + 1;
        const frac = Math.max(0, fim - ini) / dm;
        let mes = mensal[mk];
        if (mes === undefined) { mes = (Math.pow(1 + p.ipca / 100, 1 / 12) - 1) * 100; if (frac > 0) aproximado = true; }
        fi *= Math.pow(1 + mes / 100, frac);
        mk = addMonthKey(mk, 1);
      }
      fator = fi * Math.pow(1 + t / 100, du / 252);
      ipcaProjetado = aproximado && !!cdi;
    } else if (item.indexador === 'poupanca') {
      fator = fatorBruto('poupanca', 0, Math.max(0, diasEntre(inicio, ate)), p); aproximado = true;
    }
    const bruto = Math.round(principal * fator), juros = bruto - item.valorAplicado, imp = impostos(juros, dias, isento);
    // % do CDI compara com o CDI de todo o período desde a aplicação (não só desde o ajuste).
    const cdiTodo = pontosDe(SERIES_RF.cdi, item.aplicadoEm);
    const cdiFator = cdiTodo ? cdiTodo.reduce((f, x) => f * (1 + x[1] / 100), 1) : Math.pow(1 + p.cdi / 100, diasUteis(dias) / 252);
    // ipcaProjetado: só os meses de IPCA ainda não divulgados vieram da hipótese (o resto é oficial).
    const est = Object.assign(base, { bruto, juros, iof: imp.iof, ir: imp.ir, liquido: bruto - imp.total, aproximado: aproximado && !ipcaProjetado, ipcaProjetado, ajuste: aj });
    return Object.assign(est, rentabilidadeRF(est, item.valorAplicado, cdiFator));
  }
  /** Rentabilidade da aplicação: % bruta e líquida no período, % ao ano (bruta) e % do CDI do mesmo período. */
  function rentabilidadeRF(est, aplicado, cdiFator) {
    const dias = est.dias;
    const rentBrutaPct = aplicado ? est.juros / aplicado * 100 : 0, rentLiqPct = aplicado ? (est.liquido / aplicado - 1) * 100 : 0;
    const rentAA = dias > 0 && aplicado ? (Math.pow(est.bruto / aplicado, 365 / dias) - 1) * 100 : null;
    const cdiPct = cdiFator > 1 ? (cdiFator - 1) * 100 : null;
    return { rentBrutaPct, rentLiqPct, rentAA, cdiPeriodoPct: cdiPct, pctCDI: cdiPct ? rentBrutaPct / cdiPct * 100 : null };
  }
  function impostos(juros, dias, isento) {
    if (isento || juros <= 0) return { iof: 0, ir: 0, total: 0 };
    const iof = Math.round(juros * iofPct(dias) / 100), ir = Math.round((juros - iof) * irAliquotaBps(dias) / 10000);
    return { iof, ir, total: iof + ir };
  }

  // ==========================================
  // SIMULADOR DE RENDA FIXA
  // ==========================================
  /** IR regressivo (bps): até 180 dias 22,5%; até 360, 20%; até 720, 17,5%; acima, 15%. */
  function irAliquotaBps(dias) { return dias <= 180 ? 2250 : dias <= 360 ? 2000 : dias <= 720 ? 1750 : 1500; }
  function iofPct(dias) { return dias >= 30 ? 0 : IOF_TABELA[Math.max(1, dias) - 1]; }
  /** Dias úteis aproximados (sem calendário de feriados): dias corridos × 252/365. */
  function diasUteis(dias) { return Math.round(dias * 252 / 365); }

  const PRODUTOS = {
    poupanca: { nome: 'Poupança', isento: true, taxaRotulo: '' },
    cdb_cdi: { nome: 'CDB/RDB pós (% do CDI)', isento: false, taxaRotulo: '% do CDI', taxaPadrao: 100 },
    lci_cdi: { nome: 'LCI/LCA (% do CDI)', isento: true, taxaRotulo: '% do CDI', taxaPadrao: 90 },
    cdb_pre: { nome: 'CDB prefixado', isento: false, taxaRotulo: '% a.a.', taxaPadrao: 14 },
    cdb_ipca: { nome: 'CDB IPCA+', isento: false, taxaRotulo: 'IPCA + % a.a.', taxaPadrao: 7 },
    tesouro_selic: { nome: 'Tesouro Selic', isento: false, custodia: true, taxaRotulo: 'Selic + % a.a.', taxaPadrao: 0.05 },
    tesouro_pre: { nome: 'Tesouro Prefixado', isento: false, custodia: true, taxaRotulo: '% a.a.', taxaPadrao: 13.5 },
    tesouro_ipca: { nome: 'Tesouro IPCA+', isento: false, custodia: true, taxaRotulo: 'IPCA + % a.a.', taxaPadrao: 7.5 },
  };

  /** Fator bruto do período (1,xx) para o produto. Taxas em % ao ano. */
  function fatorBruto(tipo, taxa, dias, p) {
    const du = diasUteis(dias), a = (x) => x / 100;
    switch (tipo) {
      case 'poupanca': {
        // Selic > 8,5% a.a.: 0,5% a.m. + TR; senão 70% da Selic mensalizada + TR. Só rende mês cheio (aniversário).
        const meses = Math.floor(dias * 12 / 365 + 1e-9);
        const base = p.selic > 8.5 ? 0.005 : Math.pow(1 + a(p.selic) * 0.7, 1 / 12) - 1;
        const trMes = Math.pow(1 + a(p.tr), 1 / 12) - 1;
        return Math.pow((1 + base) * (1 + trMes), meses);
      }
      case 'cdb_cdi': case 'lci_cdi': {
        const cdiDia = Math.pow(1 + a(p.cdi), 1 / 252) - 1;
        return Math.pow(1 + cdiDia * taxa / 100, du);
      }
      case 'cdb_pre': case 'tesouro_pre': return Math.pow(1 + a(taxa), du / 252);
      case 'cdb_ipca': case 'tesouro_ipca': return Math.pow(1 + a(p.ipca), dias / 365) * Math.pow(1 + a(taxa), du / 252);
      case 'tesouro_selic': return Math.pow((1 + a(p.selic)) * (1 + a(taxa)), du / 252);
      default: return 1;
    }
  }

  /**
   * Simula uma aplicação levada até o fim do prazo.
   * Ordem dos descontos: IOF sobre o rendimento (só antes de 30 dias), custódia B3 do Tesouro (pro rata sobre o saldo
   * final, aproximação), IR regressivo sobre o rendimento já sem IOF e custódia. LCI/LCA e poupança: isentos de IR e IOF.
   */
  function simular(valor, dias, produto, params) {
    const prod = PRODUTOS[produto.tipo];
    if (!prod) return null;
    const p = Object.assign(defaultParams(), params || {});
    const taxa = Number.isFinite(Number(produto.taxa)) ? Number(produto.taxa) : (prod.taxaPadrao || 0);
    // A aplicação anotada pode mudar o tratamento (ex.: LCA prefixada é isenta; CDB não paga custódia).
    const isento = typeof produto.isento === 'boolean' ? produto.isento : !!prod.isento;
    const temCustodia = typeof produto.custodia === 'boolean' ? produto.custodia : !!prod.custodia;
    const bruto = Math.round(valor * fatorBruto(produto.tipo, taxa, dias, p));
    const rendimento = bruto - valor;
    const iof = isento || rendimento <= 0 ? 0 : Math.round(rendimento * iofPct(dias) / 100);
    const custodia = temCustodia ? Math.round(bruto * (p.custodia / 100) * dias / 365) : 0;
    const baseIR = Math.max(0, rendimento - iof - custodia);
    const aliq = isento ? 0 : irAliquotaBps(dias);
    const ir = Math.round(baseIR * aliq / 10000);
    const liquido = bruto - iof - custodia - ir;
    const rentLiqPct = valor > 0 ? (liquido / valor - 1) * 100 : 0;
    const rentLiqAA = valor > 0 && dias > 0 ? (Math.pow(liquido / valor, 365 / dias) - 1) * 100 : 0;
    const cdiPeriodo = (fatorBruto('cdb_cdi', 100, dias, p) - 1) * 100;
    return { tipo: produto.tipo, nome: produto.nome || prod.nome, taxa, taxaRotulo: prod.taxaRotulo, isento,
      valor, dias, bruto, rendimento, iof, custodia, aliquotaIR: aliq / 100, id: produto.id || '', ir, liquido, ganhoLiquido: liquido - valor,
      rentLiqPct, rentLiqAA, pctCDILiquido: cdiPeriodo > 0 ? rentLiqPct / cdiPeriodo * 100 : null };
  }
  /** Compara várias ofertas; ordenado do maior para o menor valor líquido. */
  function comparar(valor, dias, ofertas, params) {
    return ofertas.map((o) => simular(valor, dias, o, params)).filter(Boolean).sort((a, b) => b.liquido - a.liquido);
  }
  /**
   * Aplicações anotadas em Renda fixa → itens da calculadora (taxa e regras de IR da própria aplicação).
   * Ficam de fora as de "saldo informado" (sem taxa) e as já resgatadas.
   */
  function rfParaCalculadora(state) {
    const tes = (x) => x.tipo === 'tesouro';
    return state.rendaFixa.filter((x) => !x.resgate && ['cdi', 'pre', 'ipca', 'selic'].includes(x.indexador)).map((x) => {
      const tipo = x.indexador === 'cdi' ? 'cdb_cdi' : x.indexador === 'selic' ? 'tesouro_selic' : x.indexador === 'pre' ? (tes(x) ? 'tesouro_pre' : 'cdb_pre') : (tes(x) ? 'tesouro_ipca' : 'cdb_ipca');
      return { id: x.id, tipo, taxa: x.taxaNum, nome: x.nome, instituicao: x.instituicao, isento: RF_ISENTOS.includes(x.tipo), custodia: tes(x) };
    });
  }
  /** Oferta do simulador → dados para cadastrar a aplicação na Renda fixa. */
  function ofertaParaRF(oferta) {
    const map = {
      poupanca: ['poupanca', 'poupanca'], cdb_cdi: ['cdb', 'cdi'], lci_cdi: ['lci', 'cdi'], cdb_pre: ['cdb', 'pre'], cdb_ipca: ['cdb', 'ipca'],
      tesouro_selic: ['tesouro', 'selic'], tesouro_pre: ['tesouro', 'pre'], tesouro_ipca: ['tesouro', 'ipca'],
    }[oferta.tipo];
    return map ? { tipo: map[0], indexador: map[1], taxaNum: map[1] === 'poupanca' ? 0 : Number(oferta.taxa) || 0 } : null;
  }
  /** Taxa (% do CDI) que um CDB precisa pagar para empatar com uma LCI/LCA isenta no mesmo prazo. */
  function cdbEquivalente(pctIsento, dias) { return pctIsento / (1 - irAliquotaBps(dias) / 10000); }

  return {
    SCHEMA_VERSION, MAX_CENTS, MAX_QTD, ISENCAO_ACOES, DARF_MINIMO, CLASSES, TIPOS_PROVENTO, TIPOS_RF, PRODUTOS, IOF_TABELA,
    hojeISO, isValidISO, monthKey, addMonthKey, diasEntre, ultimoDiaUtil, dateBR, monthBR,
    parseCents, fmtBRL, centsToInput, fmtPct, mulDiv, uid, normTicker,
    freshState, normalizeState, defaultParams, defaultOfertas,
    MOEDAS, CATEGORIAS_OUTROS, SERIE_DOLAR, dolarEm, emReais, addCripto, atualizarCripto, venderCripto, removeCripto, criptoResumo, vendasCripto, setRentabilidadeAtivo,
    apuracaoCripto, darfsCriptoPendentes, irCriptoFaixas, CRIPTO_ISENCAO, rentabilidadeAcoes,
    informarJurosRF, limparJurosRF, TIPOS_META, registrarHistorico, acompanhamento, movimentos, aportesPorMes, relatorio,
    addMeta, removeMeta, setVinculosMeta, situacaoMeta, setPlano, planejamento,
    addOutro, atualizarOutro, resgatarOutro, removeOutro, totaisCarteira,
    INDEXADORES, RF_ISENTOS, SERIES_RF, rfParaCalculadora, urlSerie, janelasSerie, parseSerie, mergeSerie, seriesNecessarias, estimarRF, ofertaParaRF,
    instituicoesUsadas, chaveInst,
    BRAPI, parseBrapi, aplicarCotacaoBrapi, tickersParaAtualizar,
    BCB, parseSgs, parseFocus, trAnual, aplicarIndices, precisaBuscarIndices,
    processar, addOperacao, removeOperacao, addEvento, removeEvento, setCotacao, addProvento, removeProvento,
    carteira, apuracaoIR, darfsPendentes, proventosResumo,
    addRendaFixa, atualizarRendaFixa, resgatarRendaFixa, removeRendaFixa,
    irAliquotaBps, iofPct, diasUteis, fatorBruto, simular, comparar, cdbEquivalente,
  };
});
