'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

// CDI diário fixo de 0,05% em 10 dias úteis a partir de 2026-09-01
const dias = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15'];
const serieCDI = { inicio: '2026-01-01', buscadoEm: '2026-09-16', dados: dias.map((d) => [d, 0.05]) };
const item = (o) => Object.assign({ valorAplicado: 1000000, aplicadoEm: '2026-09-01', vencimento: '', tipo: 'cdb', indexador: 'cdi', taxaNum: 100, valorAtual: 1000000, atualizadoEm: '2026-09-01' }, o);

test('CDB 100% do CDI: produto dos CDIs diários; IOF e IR como se resgatasse hoje', () => {
  const r = E.estimarRF(item(), { 12: serieCDI }, '2026-09-16', {});
  assert.equal(r.bruto, Math.round(1000000 * Math.pow(1.0005, 10)));
  assert.equal(r.juros, r.bruto - 1000000);
  assert.equal(r.dias, 15);
  assert.equal(r.iof, Math.round(r.juros * 0.5));                 // 15 dias → IOF 50%
  assert.equal(r.ir, Math.round((r.juros - r.iof) * 0.225));
  assert.equal(r.aproximado, false);
});

test('110% do CDI e LCI isenta', () => {
  const cdb = E.estimarRF(item({ taxaNum: 110 }), { 12: serieCDI }, '2026-09-16', {});
  assert.equal(cdb.bruto, Math.round(1000000 * Math.pow(1 + 0.0005 * 1.1, 10)));
  const lci = E.estimarRF(item({ tipo: 'lci', taxaNum: 90 }), { 12: serieCDI }, '2026-09-16', {});
  assert.equal(lci.ir, 0); assert.equal(lci.iof, 0); assert.equal(lci.liquido, lci.bruto);
});

test('o dia de hoje e dias depois do vencimento não rendem', () => {
  const r = E.estimarRF(item({ vencimento: '2026-09-08' }), { 12: serieCDI }, '2026-09-16', {});
  assert.equal(r.bruto, Math.round(1000000 * Math.pow(1.0005, 4)));
  assert.equal(r.vencido, true);
});

test('prefixado usa os dias úteis da série do CDI', () => {
  const r = E.estimarRF(item({ indexador: 'pre', taxaNum: 12 }), { 12: serieCDI }, '2026-09-16', {});
  assert.equal(r.bruto, Math.round(1000000 * Math.pow(1.12, 10 / 252)));
});

test('IPCA+: mês publicado proporcional aos dias e mês sem dado pela hipótese (aproximado)', () => {
  const series = { 433: { inicio: '2026-01-01', dados: [['2026-08-01', 0.5]] }, 12: { inicio: '2026-01-01', dados: [] } };
  const r = E.estimarRF(item({ indexador: 'ipca', taxaNum: 6, aplicadoEm: '2026-08-16', valorAplicado: 1000000 }), series, '2026-09-01', { ipca: 0 });
  // agosto: dias 16 a 31 = 16/31 do mês; setembro: 0 dias. Juro real com 0 dias úteis (série vazia) = 1.
  assert.equal(r.bruto, Math.round(1000000 * Math.pow(1.005, 16 / 31)));
});

test('sem série no aparelho: usa as hipóteses e marca aproximado', () => {
  const r = E.estimarRF(item(), null, '2026-09-16', { cdi: 13.65 });
  assert.equal(r.aproximado, true);
  assert.ok(r.juros > 0);
});

test('saldo informado (manual) continua valendo', () => {
  const r = E.estimarRF(item({ indexador: 'manual', valorAtual: 1100000, atualizadoEm: '2027-09-01' }), null, '2027-09-10', {});
  assert.equal(r.bruto, 1100000); assert.equal(r.juros, 100000);
  assert.equal(r.ir, Math.round(100000 * 0.175)); // 365 dias → 17,5% (20% só até 360)
});

test('janelas de até 10 anos e séries a buscar', () => {
  assert.deepEqual(E.janelasSerie('2010-01-01', '2026-10-07'), [['2010-01-01', '2019-12-31'], ['2020-01-01', '2026-10-07']]);
  const s = E.freshState();
  E.addRendaFixa(s, { tipo: 'cdb', indexador: 'cdi', taxaNum: 100, valorAplicado: 100, aplicadoEm: '2026-01-10' });
  E.addRendaFixa(s, { tipo: 'tesouro', indexador: 'ipca', taxaNum: 7, valorAplicado: 100, aplicadoEm: '2025-05-02' });
  const n = E.seriesNecessarias(s, {}, '2026-10-07');
  assert.deepEqual(n.map((x) => [x.codigo, x.inicio]).sort(), [[12, '2025-05-02'], [433, '2025-05-02']]);
  assert.deepEqual(E.seriesNecessarias(s, { 12: { inicio: '2025-01-01', buscadoEm: '2026-10-07', dados: [] }, 433: { inicio: '2025-01-01', buscadoEm: '2026-10-07', dados: [] } }, '2026-10-07'), []);
  assert.equal(E.urlSerie(12, '2026-01-10', '2026-10-07'), 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=10/01/2026&dataFinal=07/10/2026');
});

test('parseSerie e mergeSerie', () => {
  const a = E.parseSerie([{ data: '02/01/2026', valor: '0.055131' }, { data: 'x', valor: '1' }]);
  assert.deepEqual(a, [['2026-01-02', 0.055131]]);
  assert.deepEqual(E.mergeSerie(a, [['2026-01-02', 0.06], ['2026-01-05', 0.05]]), [['2026-01-02', 0.06], ['2026-01-05', 0.05]]);
  assert.equal(E.parseSerie({ erro: 1 }), null);
  assert.deepEqual(E.parseSerie({ erro: { statusCode: 404, detail: 'Value(s) not found' } }), []); // período sem dado novo
});

test('cadastro valida taxa por indexador e não aceita data futura', () => {
  const s = E.freshState();
  assert.equal(E.addRendaFixa(s, { indexador: 'cdi', valorAplicado: 100, aplicadoEm: '2026-01-01' }).ok, false);
  assert.equal(E.addRendaFixa(s, { indexador: 'cdi', taxaNum: 100, valorAplicado: 100, aplicadoEm: '2026-12-01', hoje: '2026-10-07' }).ok, false);
  assert.ok(E.addRendaFixa(s, { indexador: 'poupanca', valorAplicado: 100, aplicadoEm: '2026-01-01' }).ok);
});

test('carteira agrupa por instituição e soma juros', () => {
  const s = E.freshState();
  E.addOperacao(s, { data: '2026-01-05', ticker: 'PETR4', classe: 'acao', tipo: 'compra', qtd: 10, preco: 3000, taxas: 0, instituicao: 'XP' });
  E.addOperacao(s, { data: '2026-01-06', ticker: 'PETR4', classe: 'acao', tipo: 'compra', qtd: 5, preco: 3200, taxas: 0, instituicao: 'Rico' });
  E.addRendaFixa(s, { nome: 'CDB', tipo: 'cdb', indexador: 'cdi', taxaNum: 100, valorAplicado: 1000000, aplicadoEm: '2026-09-01', instituicao: 'Banco Inter' });
  E.addRendaFixa(s, { nome: 'LCI', tipo: 'lci', indexador: 'manual', valorAplicado: 500000, aplicadoEm: '2026-01-01', instituicao: 'xp ' });
  E.atualizarRendaFixa(s, s.rendaFixa[1].id, 530000, '2026-09-01');
  const c = E.carteira(s, { series: { 12: serieCDI }, hoje: '2026-09-16' });
  const nomes = c.instituicoes.map((i) => i.nome);
  assert.equal(c.instituicoes.length, 3);                  // XP e "xp " são a mesma
  assert.ok(nomes.includes('Banco Inter'));
  const xp = c.instituicoes.find((i) => E.chaveInst(i.nome) === 'xp');
  assert.equal(xp.valorRV, 30000); assert.equal(xp.valorRF, 530000); assert.equal(xp.jurosRF, 30000);
  assert.equal(c.jurosRF, 30000 + (Math.round(1000000 * Math.pow(1.0005, 10)) - 1000000));
  assert.equal(c.total, c.totalRV + c.totalRF);
  assert.deepEqual(E.instituicoesUsadas(s), ['Banco Inter', 'Rico', 'xp']);
});

test('oferta do simulador vira aplicação', () => {
  assert.deepEqual(E.ofertaParaRF({ tipo: 'lci_cdi', taxa: 92 }), { tipo: 'lci', indexador: 'cdi', taxaNum: 92 });
  assert.deepEqual(E.ofertaParaRF({ tipo: 'tesouro_ipca', taxa: 7.5 }), { tipo: 'tesouro', indexador: 'ipca', taxaNum: 7.5 });
  assert.deepEqual(E.ofertaParaRF({ tipo: 'poupanca' }), { tipo: 'poupanca', indexador: 'poupanca', taxaNum: 0 });
});

test('IPCA+ com séries no aparelho: só o mês não divulgado é estimado (não "sem internet")', () => {
  const series = { 433: { inicio: '2026-01-01', dados: [['2026-08-01', 0.5]] }, 12: { inicio: '2026-01-01', dados: [['2026-09-01', 0.05]] } };
  const r = E.estimarRF(item({ indexador: 'ipca', taxaNum: 6, aplicadoEm: '2026-08-16' }), series, '2026-09-10', { ipca: 4 });
  assert.equal(r.aproximado, false);
  assert.equal(r.ipcaProjetado, true);
});
