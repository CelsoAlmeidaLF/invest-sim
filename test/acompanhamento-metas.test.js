'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

const foto = (s, data, patrimonio, aplicado) => { s.historico.push({ data, patrimonio, aplicado }); };

test('histórico: uma foto por dia, troca a do mesmo dia', () => {
  const s = E.freshState();
  E.addOutro(s, { categoria: 'conta', valorAplicado: 100000, aplicadoEm: '2026-01-01' });
  const c = E.carteira(s, { hoje: '2026-10-07' });
  assert.equal(E.registrarHistorico(s, '2026-10-07', c), true);
  assert.equal(E.registrarHistorico(s, '2026-10-07', c), false); // nada mudou
  E.atualizarOutro(s, s.outros[0].id, 101000, '2026-10-07');
  assert.equal(E.registrarHistorico(s, '2026-10-07', E.carteira(s, { hoje: '2026-10-07' })), true);
  assert.equal(s.historico.length, 1); assert.equal(s.historico[0].patrimonio, 101000);
  assert.equal(E.registrarHistorico(E.freshState(), '2026-10-07', E.carteira(E.freshState())), false); // vazio não grava
});

test('acompanhamento: rendeu desconta o dinheiro novo', () => {
  const s = E.freshState();
  foto(s, '2026-08-31', 100000, 90000);
  foto(s, '2026-09-15', 112000, 100000);
  foto(s, '2026-09-30', 115000, 100000);  // de 31/08 a 30/09: +15.000 de patrimônio, 10.000 foram aporte → rendeu 5.000
  foto(s, '2026-10-06', 116000, 100000);
  const m = E.acompanhamento(s, 'mes');
  assert.deepEqual(m.map((x) => x.chave), ['2026-08', '2026-09', '2026-10']);
  assert.equal(m[1].rendeu, 5000); assert.equal(m[1].aportouLiq, 10000);
  assert.ok(Math.abs(m[1].rendeuPct - 5) < 1e-9);
  assert.equal(m[0].rendeu, null);
  assert.equal(E.acompanhamento(s, 'dia').length, 4);
  assert.equal(E.acompanhamento(s, 'ano').length, 1);
});

test('relatório mensal e anual: aportes, resgates, proventos e rendimento', () => {
  const s = E.freshState();
  E.addRendaFixa(s, { tipo: 'cdb', indexador: 'manual', valorAplicado: 1000000, aplicadoEm: '2026-09-05' });
  E.addOperacao(s, { data: '2026-09-10', ticker: 'PETR4', classe: 'acao', tipo: 'compra', qtd: 100, preco: 3000, taxas: 100 });
  E.addOperacao(s, { data: '2026-09-20', ticker: 'PETR4', classe: 'acao', tipo: 'venda', qtd: 50, preco: 3200, taxas: 0 });
  E.addProvento(s, { data: '2026-09-25', ticker: 'PETR4', tipo: 'dividendo', valor: 5000 });
  foto(s, '2026-08-31', 2000000, 2000000);
  foto(s, '2026-09-30', 3200000, 3140100);
  const r = E.relatorio(s, '2026-09');
  assert.equal(r.aportes, 1000000 + 300100);
  assert.equal(r.resgates, 160000);
  assert.equal(r.proventos, 5000);
  assert.equal(r.rendeu, 3200000 - 2000000 - 1300100 + 160000);
  assert.equal(r.movimentos.length, 3);
  const a = E.relatorio(s, '2026');
  assert.equal(a.aportes, r.aportes); assert.equal(a.rendeu, null); // sem foto antes de 2026
  assert.equal(E.relatorio(s, '2026-11').aportes, 0);
});

test('metas: patrimônio, objetivo com investimentos ligados e aporte mensal', () => {
  const s = E.freshState();
  const cdb = E.addRendaFixa(s, { nome: 'Reserva', tipo: 'cdb', indexador: 'manual', valorAplicado: 1000000, aplicadoEm: '2026-01-05' }).item;
  E.addOutro(s, { categoria: 'conta', nome: 'Caixinha', valorAplicado: 500000, aplicadoEm: '2026-10-02' });
  const c = E.carteira(s, { hoje: '2026-10-07' });
  const p = E.addMeta(s, { tipo: 'patrimonio', valor: 2700000, prazo: '2027-10-07', hoje: '2026-10-07' }).meta;
  let st = E.situacaoMeta(s, p, c, { hoje: '2026-10-07' });
  assert.equal(st.atual, 1500000); assert.equal(st.falta, 1200000); assert.equal(st.meses, 12); assert.equal(st.porMes, 100000);
  const o = E.addMeta(s, { tipo: 'objetivo', nome: 'Reserva de emergência', valor: 3000000, prazo: '2027-04-07', vinculos: [{ tipo: 'rf', id: cdb.id }], hoje: '2026-10-07' }).meta;
  st = E.situacaoMeta(s, o, c, { hoje: '2026-10-07' });
  assert.equal(st.atual, 1000000); assert.equal(st.meses, 6); assert.equal(st.itens[0].nome, 'Reserva');
  const a = E.addMeta(s, { tipo: 'aporte', valor: 400000, hoje: '2026-10-07' }).meta;
  st = E.situacaoMeta(s, a, c, { hoje: '2026-10-07' });
  assert.equal(st.atual, 500000); assert.equal(st.meses[11].cumpriu, true); assert.equal(st.meses[0].mes, '2025-11');
  assert.equal(E.addMeta(s, { tipo: 'objetivo', valor: 1 }).ok, false);                       // objetivo precisa de nome
  assert.equal(E.addMeta(s, { tipo: 'patrimonio', valor: 1, prazo: '2026-01-01', hoje: '2026-10-07' }).ok, false); // prazo no passado
});

test('planejamento: planejado x feito por mês e no ano', () => {
  const s = E.freshState();
  E.setPlano(s, '2026', '09', 150000); E.setPlano(s, '2026', '10', 150000);
  E.addOutro(s, { categoria: 'conta', valorAplicado: 200000, aplicadoEm: '2026-09-10' });
  const p = E.planejamento(s, '2026', { hoje: '2026-10-07' });
  assert.equal(p.meses[8].planejado, 150000); assert.equal(p.meses[8].feito, 200000); assert.equal(p.meses[8].diferenca, 50000);
  assert.equal(p.meses[9].atual, true);
  assert.equal(p.planejado, 300000); assert.equal(p.feito, 200000);
  E.setPlano(s, '2026', '10', 0);
  assert.equal(E.planejamento(s, '2026', { hoje: '2026-10-07' }).planejado, 150000);
  const n = E.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(n.plano, { 2026: { '09': 150000 } });
});
