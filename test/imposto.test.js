'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

const op = (s, o) => { const r = E.addOperacao(s, Object.assign({ classe: 'acao', taxas: 0 }, o)); assert.ok(r.ok, r.erro); };
const mes = (s, m) => E.apuracaoIR(s).find((x) => x.mes === m);

test('ações: vendas até R$ 20 mil no mês → ganho isento', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-05', ticker: 'PETR4', tipo: 'compra', qtd: 500, preco: 3000 });
  op(s, { data: '2026-02-05', ticker: 'PETR4', tipo: 'venda', qtd: 500, preco: 4000 }); // vende exatamente R$ 20.000
  const m = mes(s, '2026-02');
  assert.equal(m.isentoAcoes, true);
  assert.equal(m.ganhoIsento, 500000);
  assert.equal(m.impostoMes, 0);
  assert.equal(m.darf, 0);
});

test('ações: vendas acima de R$ 20 mil → 15% sobre o ganho, DARF no último dia útil do mês seguinte', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-05', ticker: 'PETR4', tipo: 'compra', qtd: 1000, preco: 3000 });
  op(s, { data: '2026-01-20', ticker: 'PETR4', tipo: 'venda', qtd: 1000, preco: 3500 });
  const m = mes(s, '2026-01');
  assert.equal(m.isentoAcoes, false);
  assert.equal(m.baseComum, 500000);
  assert.equal(m.impostoComum, 75000);
  assert.equal(m.darf, 75000);
  assert.equal(m.vencimento, '2026-02-27'); // 28/02/2026 é sábado
});

test('prejuízo de mês isento continua compensável', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-05', ticker: 'MGLU3', tipo: 'compra', qtd: 100, preco: 10000 });
  op(s, { data: '2026-01-25', ticker: 'MGLU3', tipo: 'venda', qtd: 100, preco: 8000 }); // −R$ 2.000, vendas R$ 8 mil
  op(s, { data: '2026-02-02', ticker: 'BOVA11', classe: 'etf', tipo: 'compra', qtd: 100, preco: 10000 });
  op(s, { data: '2026-02-20', ticker: 'BOVA11', classe: 'etf', tipo: 'venda', qtd: 100, preco: 15000 }); // +R$ 5.000 ETF (sem isenção)
  const jan = mes(s, '2026-01'), fev = mes(s, '2026-02');
  assert.equal(jan.prejComumDepois, 200000);
  assert.equal(fev.baseComum, 300000);
  assert.equal(fev.impostoComum, 45000);
  assert.equal(fev.prejComumDepois, 0);
});

test('ETF e BDR não têm isenção de R$ 20 mil', () => {
  const s = E.freshState();
  op(s, { data: '2026-03-02', ticker: 'AAPL34', classe: 'bdr', tipo: 'compra', qtd: 10, preco: 5000 });
  op(s, { data: '2026-03-20', ticker: 'AAPL34', classe: 'bdr', tipo: 'venda', qtd: 10, preco: 15000 });
  const m = mes(s, '2026-03');
  assert.equal(m.impostoComum, 15000);
  assert.equal(m.darf, 15000);
});

test('FII: 20%, prejuízo separado do grupo comum', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-05', ticker: 'MXRF11', classe: 'fii', tipo: 'compra', qtd: 1000, preco: 1000 });
  op(s, { data: '2026-01-25', ticker: 'MXRF11', classe: 'fii', tipo: 'venda', qtd: 500, preco: 900 }); // −R$ 500 FII
  op(s, { data: '2026-02-05', ticker: 'PETR4', tipo: 'compra', qtd: 1000, preco: 3000 });
  op(s, { data: '2026-02-20', ticker: 'PETR4', tipo: 'venda', qtd: 1000, preco: 3100 }); // +R$ 1.000 ações (vendas R$ 31 mil)
  op(s, { data: '2026-02-21', ticker: 'MXRF11', classe: 'fii', tipo: 'venda', qtd: 500, preco: 1200 }); // +R$ 1.000 FII
  const fev = mes(s, '2026-02');
  assert.equal(fev.baseComum, 100000);       // o prejuízo de FII não abate ações
  assert.equal(fev.baseFii, 50000);          // 1.000 − 500 de prejuízo de FII
  assert.equal(fev.impostoFii, 10000);
  assert.equal(fev.impostoComum, 15000);
  assert.equal(fev.darf, 25000);
});

test('DARF abaixo de R$ 10 acumula para o mês seguinte', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-05', ticker: 'BOVA11', classe: 'etf', tipo: 'compra', qtd: 10, preco: 10000 });
  op(s, { data: '2026-01-20', ticker: 'BOVA11', classe: 'etf', tipo: 'venda', qtd: 5, preco: 10500 }); // ganho 2.500 → IR 375
  op(s, { data: '2026-02-20', ticker: 'BOVA11', classe: 'etf', tipo: 'venda', qtd: 5, preco: 11000 }); // ganho 5.000 → IR 750
  const jan = mes(s, '2026-01'), fev = mes(s, '2026-02');
  assert.equal(jan.impostoMes, 375); assert.equal(jan.darf, 0); assert.equal(jan.acumuladoProximo, 375);
  assert.equal(fev.impostoMes, 750); assert.equal(fev.darf, 1125); assert.equal(fev.acumuladoProximo, 0);
});

test('prejuízo inicial informado pelo usuário é compensado', () => {
  const s = E.freshState();
  s.prejuizoInicial.comum = 100000;
  op(s, { data: '2026-01-05', ticker: 'PETR4', tipo: 'compra', qtd: 1000, preco: 3000 });
  op(s, { data: '2026-01-20', ticker: 'PETR4', tipo: 'venda', qtd: 1000, preco: 3100 });
  assert.equal(mes(s, '2026-01').baseComum, 0);
});

test('day trade é sinalizado', () => {
  const s = E.freshState();
  op(s, { data: '2026-01-05', ticker: 'PETR4', tipo: 'compra', qtd: 10, preco: 3000 });
  op(s, { data: '2026-01-05', ticker: 'PETR4', tipo: 'venda', qtd: 10, preco: 3100 });
  assert.equal(mes(s, '2026-01').dayTrade, true);
});

test('último dia útil ignora fim de semana', () => {
  assert.equal(E.ultimoDiaUtil('2026-05'), '2026-05-29'); // 31/05/2026 é domingo
  assert.equal(E.ultimoDiaUtil('2026-10'), '2026-10-30'); // 31/10/2026 é sábado
  assert.equal(E.ultimoDiaUtil('2026-09'), '2026-09-30');
});
