'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

const op = (s, o) => { const r = E.addOperacao(s, Object.assign({ classe: 'acao', taxas: 0 }, o)); assert.ok(r.ok, r.erro); return r.operacao; };

test('preço médio ponderado com taxas no custo', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-10', ticker: 'petr4', tipo: 'compra', qtd: 100, preco: 3000, taxas: 500 });
  op(s, { data: '2026-02-10', ticker: 'PETR4', tipo: 'compra', qtd: 100, preco: 4000, taxas: 500 });
  const c = E.carteira(s);
  assert.equal(c.ativos.length, 1);
  assert.equal(c.ativos[0].qtd, 200);
  assert.equal(c.ativos[0].custo, 701000);
  assert.equal(c.ativos[0].precoMedio, 3505);
});

test('venda baixa custo proporcional e calcula ganho líquido de taxas', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-10', ticker: 'VALE3', tipo: 'compra', qtd: 3, preco: 1000 });
  op(s, { data: '2026-01-20', ticker: 'VALE3', tipo: 'venda', qtd: 1, preco: 1500, taxas: 100 });
  const r = E.processar(s);
  assert.equal(r.vendas[0].custo, 1000);
  assert.equal(r.vendas[0].ganho, 400);
  assert.equal(r.posicoes.VALE3.qtd, 2);
  assert.equal(r.posicoes.VALE3.custo, 2000);
});

test('não deixa vender mais do que a posição na data', () => {
  const s = E.freshState();
  op(s, { data: '2026-03-10', ticker: 'ITSA4', tipo: 'compra', qtd: 10, preco: 1000 });
  const r = E.addOperacao(s, { data: '2026-03-01', ticker: 'ITSA4', classe: 'acao', tipo: 'venda', qtd: 5, preco: 1000 });
  assert.equal(r.ok, false);
  assert.equal(s.operacoes.length, 1);
});

test('não deixa excluir compra da qual uma venda depende', () => {
  const s = E.freshState();
  const c = op(s, { data: '2026-03-10', ticker: 'ITSA4', tipo: 'compra', qtd: 10, preco: 1000 });
  op(s, { data: '2026-03-11', ticker: 'ITSA4', tipo: 'venda', qtd: 10, preco: 1100 });
  assert.equal(E.removeOperacao(s, c.id).ok, false);
  assert.equal(s.operacoes.length, 2);
});

test('ticker fracionário (F) é o mesmo ativo e classe não pode mudar', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-10', ticker: 'BBAS3F', tipo: 'compra', qtd: 7, preco: 2500 });
  op(s, { data: '2026-01-11', ticker: 'BBAS3', tipo: 'compra', qtd: 100, preco: 2500 });
  assert.equal(E.carteira(s).ativos[0].qtd, 107);
  assert.equal(E.addOperacao(s, { data: '2026-01-12', ticker: 'BBAS3', classe: 'fii', tipo: 'compra', qtd: 1, preco: 100 }).ok, false);
});

test('desdobramento e grupamento mudam a quantidade, não o custo', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-10', ticker: 'WEGE3', tipo: 'compra', qtd: 100, preco: 4000 });
  assert.ok(E.addEvento(s, { data: '2026-02-01', ticker: 'WEGE3', tipo: 'fator', de: 1, para: 2 }).ok);
  let a = E.carteira(s).ativos[0];
  assert.equal(a.qtd, 200); assert.equal(a.custo, 400000); assert.equal(a.precoMedio, 2000);
  assert.ok(E.addEvento(s, { data: '2026-03-01', ticker: 'WEGE3', tipo: 'fator', de: 3, para: 1 }).ok);
  a = E.carteira(s).ativos[0];
  assert.equal(a.qtd, 66); assert.equal(a.custo, 400000);
});

test('evento no mesmo dia vale antes da compra do dia (data ex)', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-10', ticker: 'WEGE3', tipo: 'compra', qtd: 100, preco: 4000 });
  op(s, { data: '2026-02-01', ticker: 'WEGE3', tipo: 'compra', qtd: 10, preco: 2000 });
  E.addEvento(s, { data: '2026-02-01', ticker: 'WEGE3', tipo: 'fator', de: 1, para: 2 });
  assert.equal(E.carteira(s).ativos[0].qtd, 210);
});

test('bonificação soma ações com custo atribuído', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-10', ticker: 'ITSA4', tipo: 'compra', qtd: 105, preco: 1000 });
  assert.ok(E.addEvento(s, { data: '2026-04-01', ticker: 'ITSA4', tipo: 'bonificacao', pct: 10, custoUnit: 150 }).ok);
  const a = E.carteira(s).ativos[0];
  assert.equal(a.qtd, 115);
  assert.equal(a.custo, 105000 + 10 * 150);
});

test('evento sem posição é recusado', () => {
  const s = E.freshState();
  assert.equal(E.addEvento(s, { data: '2026-04-01', ticker: 'XPTO3', tipo: 'fator', de: 1, para: 2 }).ok, false);
});

test('carteira: cotação, resultado não realizado e alocação com renda fixa', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-10', ticker: 'HGLG11', classe: 'fii', tipo: 'compra', qtd: 10, preco: 15000 });
  E.setCotacao(s, 'HGLG11', 16000, '2026-10-01');
  E.addRendaFixa(s, { nome: 'CDB X', tipo: 'cdb', valorAplicado: 150000, aplicadoEm: '2026-01-01' });
  const c = E.carteira(s);
  assert.equal(c.totalRV, 160000);
  assert.equal(c.naoRealizado, 10000);
  assert.equal(c.total, 310000);
  assert.deepEqual(c.alocacao.map((x) => x.chave), ['fii', 'rf']);
  assert.ok(Math.abs(c.ativos[0].resultadoPct - 6.6667) < 0.001);
});

test('mulDiv não perde precisão com valores grandes', () => {
  assert.equal(E.mulDiv(99999999999, 99999999, 100000000), 99999998999);
  assert.equal(E.mulDiv(1, 1, 2), 1);
  assert.equal(E.mulDiv(-3, 1, 2), -2);
});

test('normalizeState descarta lixo e mantém dados válidos', () => {
  const s = E.normalizeState({ operacoes: [{ data: '2026-01-01', ticker: 'petr4', classe: 'acao', tipo: 'compra', qtd: 1, preco: 100 },
    { data: 'x', ticker: '<script>', classe: 'acao', tipo: 'compra', qtd: 1, preco: 1 }], cotacoes: { '<b>': { preco: 1 } }, params: { cdi: 'abc' } });
  assert.equal(s.operacoes.length, 1);
  assert.equal(s.operacoes[0].ticker, 'PETR4');
  assert.deepEqual(s.cotacoes, {});
  assert.equal(s.params.cdi, E.defaultParams().cdi);
});

test('proventos: total, últimos 12 meses e por ativo', () => {
  const s = E.freshState();
  E.addProvento(s, { data: '2025-01-15', ticker: 'TAEE11', tipo: 'dividendo', valor: 1000 });
  E.addProvento(s, { data: '2026-09-15', ticker: 'TAEE11', tipo: 'jcp', valor: 2000 });
  E.addProvento(s, { data: '2026-10-05', ticker: 'HGLG11', tipo: 'rendimento', valor: 1100 });
  const r = E.proventosResumo(s, '2026-10-07');
  assert.equal(r.total, 4100);
  assert.equal(r.ult12, 3100);
  assert.equal(r.meses.length, 12);
  assert.equal(r.meses[11].mes, '2026-10');
  assert.equal(r.porTicker[0].ticker, 'TAEE11');
});

test('renda fixa: atualizar, resgatar e sair da carteira', () => {
  const s = E.freshState();
  const it = E.addRendaFixa(s, { nome: 'LCI', tipo: 'lci', valorAplicado: 100000, aplicadoEm: '2026-01-01', vencimento: '2027-01-01' }).item;
  assert.ok(E.atualizarRendaFixa(s, it.id, 108000, '2026-10-01').ok);
  assert.equal(E.carteira(s).totalRF, 108000);
  assert.equal(E.resgatarRendaFixa(s, it.id, 109000, '2025-12-01').ok, false);
  assert.ok(E.resgatarRendaFixa(s, it.id, 109000, '2026-10-05').ok);
  assert.equal(E.carteira(s).totalRF, 0);
  assert.equal(E.addRendaFixa(s, { valorAplicado: 1, aplicadoEm: '2026-01-02', vencimento: '2026-01-01' }).ok, false);
});
