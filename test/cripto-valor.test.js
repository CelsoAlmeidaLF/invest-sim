'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/invest-engine.js');

const serieDolar = { 1: { inicio: '2026-01-01', dados: [['2026-01-02', 5.0], ['2026-06-01', 5.2], ['2026-10-06', 5.5]] } };

test('cripto por valor em R$: aplicado, atual e resultado', () => {
  const s = E.freshState();
  const it = E.addCripto(s, { moeda: 'btc', valorAplicado: 500000, aplicadoEm: '2026-02-01', valorAtual: 620000, onde: 'Binance', hoje: '2026-10-07' }).item;
  const c = E.criptoResumo(s, { hoje: '2026-10-07' })[0];
  assert.equal(c.valor, 620000); assert.equal(c.custo, 500000); assert.equal(c.resultado, 120000);
  assert.ok(E.atualizarCripto(s, it.id, 700000, '2026-10-07').ok);
  assert.equal(E.criptoResumo(s, { hoje: '2026-10-07' })[0].valor, 700000);
  assert.equal(E.addCripto(s, { moeda: 'outra', valorAplicado: 1, aplicadoEm: '2026-01-01' }).ok, false); // "outra" exige nome
  assert.ok(E.addCripto(s, { moeda: 'outra', nome: 'Pepe', valorAplicado: 1, aplicadoEm: '2026-01-01' }).ok);
});

test('cripto em US$: convertido pela PTAX (custo na data da aplicação, valor de hoje)', () => {
  const s = E.freshState();
  E.addCripto(s, { moeda: 'eth', moedaValor: 'USD', valorAplicado: 100000, aplicadoEm: '2026-01-05', valorAtual: 120000 }); // US$ 1.000 → US$ 1.200
  const c = E.criptoResumo(s, { hoje: '2026-10-07', series: serieDolar })[0];
  assert.equal(c.custo, 500000);   // 1.000 × 5,00
  assert.equal(c.valor, 660000);   // 1.200 × 5,50
  assert.equal(c.resultado, 160000);
  assert.equal(c.aproximado, false);
  const semSerie = E.criptoResumo(s, { hoje: '2026-10-07' })[0];
  assert.equal(semSerie.aproximado, true); // sem dólar no aparelho usa R$ 5,50 e avisa
  assert.equal(E.dolarEm(serieDolar, '2026-06-03').centavos, 520);
});

test('venda parcial sem quantidade: baixa a fração do custo', () => {
  const s = E.freshState();
  const it = E.addCripto(s, { moeda: 'sol', valorAplicado: 300000, aplicadoEm: '2026-01-05', valorAtual: 400000 }).item;
  const r = E.venderCripto(s, it.id, 100000, 300000, '2026-03-10'); // vendeu 1/4 do que tinha
  assert.equal(r.custo, 75000);
  assert.equal(it.custoRest, 225000); assert.equal(it.valorAtual, 300000);
  E.venderCripto(s, it.id, 350000, 0, '2026-04-10');                 // vendeu o resto
  assert.equal(it.custoRest, 0);
  assert.equal(E.criptoResumo(s, { hoje: '2026-10-07' }).length, 0);
  const v = E.vendasCripto(s);
  assert.deepEqual(v.map((x) => [x.valor, x.custo, x.ganho]), [[100000, 75000, 25000], [350000, 225000, 125000]]);
});

test('IR cripto no Brasil: isento até R$ 35 mil; acima, 15% sobre os ganhos; DARF', () => {
  const s = E.freshState();
  const a = E.addCripto(s, { moeda: 'btc', valorAplicado: 3000000, aplicadoEm: '2026-01-05' }).item;
  const b = E.addCripto(s, { moeda: 'eth', valorAplicado: 2000000, aplicadoEm: '2026-01-05' }).item;
  E.venderCripto(s, a.id, 2000000, 2000000, '2026-02-10');  // custo 1.500.000 → ganho 500.000; vendas 20 mil → isento
  E.venderCripto(s, a.id, 2500000, 0, '2026-03-10');        // custo 1.500.000 → ganho 1.000.000
  E.venderCripto(s, b.id, 1500000, 0, '2026-03-12');        // custo 2.000.000 → perda 500.000 (não abate)
  const m = E.apuracaoCripto(s).meses;
  assert.equal(m[0].isento, true); assert.equal(m[0].darf, 0);
  assert.equal(m[1].vendas, 4000000); assert.equal(m[1].ganhos, 1000000); assert.equal(m[1].perdas, 500000);
  assert.equal(m[1].imposto, 150000); assert.equal(m[1].vencimento, '2026-04-30');
});

test('IR cripto no exterior: 15% no ano, prejuízo passa adiante', () => {
  const s = E.freshState();
  const a = E.addCripto(s, { moeda: 'btc', valorAplicado: 4000000, aplicadoEm: '2025-01-05', custodia: 'exterior' }).item;
  E.venderCripto(s, a.id, 1500000, 2000000, '2025-06-05');  // custo 4.000.000 × 15/35 = 1.714.286 → −214.286
  E.venderCripto(s, a.id, 3000000, 0, '2026-06-05');        // custo 2.285.714 → +714.286
  const r = E.apuracaoCripto(s);
  assert.equal(r.meses.length, 0);
  assert.deepEqual(r.anosExterior.map((x) => [x.ano, x.prejDepois]), [['2025', 214286], ['2026', 0]]);
  assert.equal(r.anosExterior[1].base, 500000); assert.equal(r.anosExterior[1].imposto, 75000);
});

test('renda fixa: juros informados viram a nova base e seguem rendendo', () => {
  const dias = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15'];
  const series = { 12: { inicio: '2026-01-01', dados: dias.map((d) => [d, 0.05]) } };
  const s = E.freshState();
  const it = E.addRendaFixa(s, { tipo: 'cdb', indexador: 'cdi', taxaNum: 100, valorAplicado: 1000000, aplicadoEm: '2026-09-01' }).item;
  assert.ok(E.informarJurosRF(s, it.id, 3000, '2026-09-08', '2026-09-16').ok); // banco mostra R$ 30 de juros em 08/09
  const r = E.estimarRF(it, series, '2026-09-16', {});
  assert.equal(r.bruto, Math.round(1003000 * Math.pow(1.0005, 6)));            // 6 dias úteis de 08/09 a 15/09
  assert.equal(r.juros, r.bruto - 1000000);
  assert.equal(E.informarJurosRF(s, it.id, 1, '2026-08-01', '2026-09-16').ok, false); // antes da aplicação
  E.limparJurosRF(s, it.id);
  assert.equal(E.estimarRF(it, series, '2026-09-16', {}).bruto, Math.round(1000000 * Math.pow(1.0005, 10)));
  const man = E.addRendaFixa(s, { tipo: 'cdb', indexador: 'manual', valorAplicado: 100000, aplicadoEm: '2026-09-01' }).item;
  E.informarJurosRF(s, man.id, 2500, '2026-09-10', '2026-09-16');
  assert.equal(man.valorAtual, 102500);
});

test('ações: rentabilidade informada (R$ ou %) substitui a cotação', () => {
  const s = E.freshState();
  E.addOperacao(s, { data: '2026-01-05', ticker: 'PETR4', classe: 'acao', tipo: 'compra', qtd: 100, preco: 3000, taxas: 0, instituicao: 'XP' });
  E.setCotacao(s, 'PETR4', 3500, '2026-10-01');
  assert.ok(E.setRentabilidadeAtivo(s, 'PETR4', { pct: 12.5, data: '2026-10-07' }).ok);
  let a = E.carteira(s, { hoje: '2026-10-07' }).ativos[0];
  assert.equal(a.resultado, 37500); assert.equal(a.valor, 337500); assert.equal(a.cotacao, null);
  assert.equal(E.carteira(s, { hoje: '2026-10-07' }).instituicoes[0].valorRV, 337500);
  E.setRentabilidadeAtivo(s, 'PETR4', { ganho: -50000, data: '2026-10-07' });
  assert.equal(E.carteira(s, { hoje: '2026-10-07' }).ativos[0].valor, 250000);
  assert.equal(E.setRentabilidadeAtivo(s, 'PETR4', { ganho: -400000, data: '2026-10-07' }).ok, false);
  E.setCotacao(s, 'PETR4', 3100, '2026-10-07');           // voltar a usar cotação apaga a rentabilidade informada
  assert.equal(E.carteira(s, { hoje: '2026-10-07' }).ativos[0].valor, 310000);
});
