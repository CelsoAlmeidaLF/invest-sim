'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

test('outros: cadastrar, atualizar, resgatar', () => {
  const s = E.freshState();
  const it = E.addOutro(s, { categoria: 'previdencia', nome: 'VGBL', instituicao: 'Itaú', valorAplicado: 1000000, aplicadoEm: '2025-01-01', valorAtual: 1150000, hoje: '2026-10-07' }).item;
  assert.equal(it.valorAtual, 1150000);
  assert.equal(E.addOutro(s, { categoria: 'x', valorAplicado: 1, aplicadoEm: '2025-01-01' }).ok, false);
  assert.ok(E.atualizarOutro(s, it.id, 1200000, '2026-10-07').ok);
  assert.equal(E.carteira(s, { hoje: '2026-10-07' }).totalOutros, 1200000);
  assert.ok(E.resgatarOutro(s, it.id, 1190000, '2026-10-07').ok);
  assert.equal(E.carteira(s, { hoje: '2026-10-07' }).totalOutros, 0);
});

test('resumo junta tudo: total, aplicado, ganho, alocação e instituições', () => {
  const s = E.freshState();
  E.addOperacao(s, { data: '2026-01-05', ticker: 'PETR4', classe: 'acao', tipo: 'compra', qtd: 10, preco: 3000, taxas: 0, instituicao: 'XP' });
  E.addRendaFixa(s, { nome: 'CDB', tipo: 'cdb', indexador: 'manual', valorAplicado: 100000, aplicadoEm: '2026-01-01', instituicao: 'XP' });
  E.atualizarRendaFixa(s, s.rendaFixa[0].id, 110000, '2026-10-01');
  E.addCripto(s, { aplicadoEm: '2026-01-10', moeda: 'eth', valorAplicado: 1000000, valorAtual: 1283160, onde: 'Binance' });
  E.addOutro(s, { categoria: 'conta', nome: 'Caixinha', instituicao: 'Nubank', valorAplicado: 50000, aplicadoEm: '2026-01-01', valorAtual: 52000 });
  const c = E.carteira(s, { hoje: '2026-10-07' });
  assert.equal(c.total, 30000 + 110000 + 1283160 + 52000);
  const t = E.totaisCarteira(c);
  assert.equal(t.aplicado, 30000 + 100000 + 1000000 + 50000);
  assert.equal(t.ganho, c.total - t.aplicado);
  assert.deepEqual(c.alocacao.map((a) => a.chave).sort(), ['acao', 'cripto', 'o-conta', 'rf']);
  assert.deepEqual(c.instituicoes.map((i) => i.nome).sort(), ['Binance', 'Nubank', 'XP']);
  assert.equal(c.instituicoes.find((i) => i.nome === 'XP').total, 140000);
});

test('normalizeState mantém cripto e outros e descarta lixo', () => {
  const s = E.normalizeState({ cripto: [{ data: '2026-01-01', moeda: 'btc', tipo: 'compra', qtd: 100, valor: 5 }, { moeda: 'xyz' }],
    outros: [{ categoria: 'fundo', valorAplicado: 1, aplicadoEm: '2026-01-01' }, { categoria: 'nada' }] });
  assert.equal(s.cripto.length, 1); assert.equal(s.cripto[0].valorAplicado, 5); assert.equal(s.cripto[0].moedaValor, 'BRL'); // migrado do formato antigo
  assert.equal(s.outros.length, 1);
});
