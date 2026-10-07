'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

const P = { cdi: 10, selic: 10, ipca: 4, tr: 0, custodia: 0.2 };
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 1), a + ' ≉ ' + b);

test('IR regressivo nas faixas', () => {
  assert.equal(E.irAliquotaBps(180), 2250);
  assert.equal(E.irAliquotaBps(181), 2000);
  assert.equal(E.irAliquotaBps(360), 2000);
  assert.equal(E.irAliquotaBps(361), 1750);
  assert.equal(E.irAliquotaBps(720), 1750);
  assert.equal(E.irAliquotaBps(721), 1500);
});

test('IOF regressivo: 96% no 1º dia, zero a partir do 30º', () => {
  assert.equal(E.iofPct(1), 96);
  assert.equal(E.iofPct(15), 50);
  assert.equal(E.iofPct(29), 3);
  assert.equal(E.iofPct(30), 0);
  assert.equal(E.IOF_TABELA.length, 29);
});

test('CDB 100% do CDI em 365 dias rende o CDI anual bruto, IR 17,5%', () => {
  const r = E.simular(1000000, 365, { tipo: 'cdb_cdi', taxa: 100 }, P);
  perto(r.bruto, 1100000, 5);     // 10% a.a. em 252 dias úteis
  assert.equal(r.iof, 0);
  assert.equal(r.aliquotaIR, 17.5);
  perto(r.ir, Math.round(r.rendimento * 0.175), 0);
  assert.equal(r.liquido, r.bruto - r.ir);
});

test('LCI é isenta de IR e IOF', () => {
  const r = E.simular(1000000, 20, { tipo: 'lci_cdi', taxa: 90 }, P);
  assert.equal(r.ir, 0); assert.equal(r.iof, 0);
  assert.equal(r.liquido, r.bruto);
});

test('IOF antes de 30 dias reduz a base do IR', () => {
  const r = E.simular(1000000, 10, { tipo: 'cdb_cdi', taxa: 100 }, P);
  assert.equal(r.iof, Math.round(r.rendimento * 0.66));
  assert.equal(r.ir, Math.round((r.rendimento - r.iof) * 0.225));
});

test('poupança com Selic acima de 8,5%: 0,5% a.m. + TR, só meses cheios', () => {
  const r = E.simular(1000000, 365, { tipo: 'poupanca' }, P);
  perto(r.bruto, Math.round(1000000 * Math.pow(1.005, 12)), 0);
  const curto = E.simular(1000000, 20, { tipo: 'poupanca' }, P);
  assert.equal(curto.bruto, 1000000);
  const baixa = E.simular(1000000, 365, { tipo: 'poupanca' }, Object.assign({}, P, { selic: 7 }));
  perto(baixa.bruto, Math.round(1000000 * 1.049), 2); // 70% de 7% = 4,9% a.a.
});

test('Tesouro desconta custódia antes do IR', () => {
  const r = E.simular(1000000, 365, { tipo: 'tesouro_selic', taxa: 0 }, P);
  assert.ok(r.custodia > 0);
  assert.equal(r.ir, Math.round((r.rendimento - r.custodia) * 0.175));
});

test('comparar ordena pelo líquido e LCI equivalente', () => {
  const lista = E.comparar(1000000, 400, [{ tipo: 'cdb_cdi', taxa: 100 }, { tipo: 'lci_cdi', taxa: 90 }, { tipo: 'poupanca' }], P);
  assert.equal(lista.length, 3);
  for (let i = 1; i < lista.length; i++) assert.ok(lista[i - 1].liquido >= lista[i].liquido);
  perto(E.cdbEquivalente(90, 400), 109.09, 0.01); // 90 / (1 − 17,5%)
});

test('% do CDI líquido de um CDB 100% CDI é 100% − IR', () => {
  const r = E.simular(1000000, 800, { tipo: 'cdb_cdi', taxa: 100 }, P);
  perto(r.pctCDILiquido, 85, 0.05);
});

test('calculadora usa só as aplicações anotadas, com as regras de cada uma', () => {
  const s = E.freshState();
  assert.deepEqual(s.ofertas, []); // nada de ofertas de exemplo
  E.addRendaFixa(s, { nome: 'CDB X', instituicao: 'Inter', tipo: 'cdb', indexador: 'cdi', taxaNum: 110, valorAplicado: 100, aplicadoEm: '2026-01-01' });
  E.addRendaFixa(s, { nome: 'LCA pré', tipo: 'lca', indexador: 'pre', taxaNum: 11, valorAplicado: 100, aplicadoEm: '2026-01-01' });
  E.addRendaFixa(s, { nome: 'Tesouro', tipo: 'tesouro', indexador: 'ipca', taxaNum: 7, valorAplicado: 100, aplicadoEm: '2026-01-01' });
  E.addRendaFixa(s, { nome: 'Sem taxa', tipo: 'cdb', indexador: 'manual', valorAplicado: 100, aplicadoEm: '2026-01-01' });
  const l = E.rfParaCalculadora(s);
  assert.deepEqual(l.map((x) => [x.nome, x.tipo, x.isento, x.custodia]),
    [['CDB X', 'cdb_cdi', false, false], ['LCA pré', 'cdb_pre', true, false], ['Tesouro', 'tesouro_ipca', false, true]]);
  const lca = E.simular(1000000, 400, l[1], P);
  assert.equal(lca.ir, 0); assert.equal(lca.isento, true); assert.equal(lca.custodia, 0);
  const tes = E.simular(1000000, 400, l[2], P);
  assert.ok(tes.custodia > 0);
});
