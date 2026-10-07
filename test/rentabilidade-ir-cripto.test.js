'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

const dias = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15'];
const serieCDI = { inicio: '2026-01-01', dados: dias.map((d) => [d, 0.05]) };
const item = (o) => Object.assign({ valorAplicado: 1000000, aplicadoEm: '2026-09-01', vencimento: '', tipo: 'cdb', indexador: 'cdi', taxaNum: 100, valorAtual: 1000000, atualizadoEm: '2026-09-01' }, o);
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 0.01), a + ' ≉ ' + b);

test('RF: rentabilidade bruta, líquida, ao ano e % do CDI', () => {
  const r = E.estimarRF(item({ taxaNum: 110 }), { 12: serieCDI }, '2026-09-16', {});
  const cdi = (Math.pow(1.0005, 10) - 1) * 100;
  perto(r.rentBrutaPct, r.juros / 1000000 * 100);
  perto(r.rentLiqPct, (r.liquido / 1000000 - 1) * 100);
  perto(r.cdiPeriodoPct, cdi, 1e-9);
  perto(r.pctCDI, 110, 0.6);                 // 110% do CDI (juros compostos dão um pouco mais, e centavos arredondam)
  perto(r.rentAA, (Math.pow(r.bruto / 1000000, 365 / 15) - 1) * 100);
  const cem = E.estimarRF(item(), { 12: serieCDI }, '2026-09-16', {});
  perto(cem.pctCDI, 100, 0.05);
});

test('RF saldo informado: rentabilidade calculada até a data do saldo', () => {
  const r = E.estimarRF(item({ indexador: 'manual', valorAtual: 1005000, atualizadoEm: '2026-09-15' }), { 12: serieCDI }, '2026-10-07', {});
  assert.equal(r.dias, 14);
  perto(r.rentBrutaPct, 0.5);
  assert.ok(r.pctCDI > 0);
});

test('IR cripto: faixas progressivas', () => {
  assert.equal(E.irCriptoFaixas(100000), 15000);
  assert.equal(E.irCriptoFaixas(600000000), 75000000 + 17500000); // 5 mi a 15% + 1 mi a 17,5%
});

test('ações: rentabilidade com proventos e vendas', () => {
  const s = E.freshState();
  E.addOperacao(s, { data: '2026-01-05', ticker: 'TAEE11', classe: 'acao', tipo: 'compra', qtd: 100, preco: 3000, taxas: 0 });
  E.addOperacao(s, { data: '2026-03-05', ticker: 'TAEE11', classe: 'acao', tipo: 'venda', qtd: 50, preco: 3400, taxas: 0 }); // +20.000
  E.setCotacao(s, 'TAEE11', 3200, '2026-10-07');                                                                       // 50 × (32 − 30) = +10.000
  E.addProvento(s, { data: '2026-05-10', ticker: 'TAEE11', tipo: 'dividendo', valor: 15000 });
  const r = E.rentabilidadeAcoes(s);
  const t = r.porAtivo[0];
  assert.equal(t.vendas, 20000); assert.equal(t.valorizacao, 10000); assert.equal(t.proventos, 15000);
  assert.equal(t.total, 45000); assert.equal(t.investido, 300000); perto(t.pct, 15);
  assert.equal(r.total.total, 45000);
});
