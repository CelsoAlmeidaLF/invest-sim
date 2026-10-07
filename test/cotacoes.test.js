'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../src/invest-engine.js');

const ts = (iso) => Math.floor(new Date(iso + 'T10:00:00').getTime() / 1000);
const resposta = (hist, extra) => ({ results: [Object.assign({ symbol: 'HGLG11', regularMarketPrice: 165, regularMarketChangePercent: -1.25,
  regularMarketTime: '2026-10-06T21:31:30.000Z', historicalDataPrice: hist }, extra)] });

test('parseBrapi: preço em centavos, variação do dia, do mês e do ano', () => {
  const q = E.parseBrapi(resposta([
    { date: ts('2025-12-30'), close: 150 }, { date: ts('2025-12-31'), close: 125 },  // fechamento do ano anterior
    { date: ts('2026-09-29'), close: 160 }, { date: ts('2026-09-30'), close: 150 },  // fechamento do mês anterior
    { date: ts('2026-10-06'), close: 165 },
  ]), '2026-10-07');
  assert.equal(q.preco, 16500);
  assert.equal(q.varDia, -1.25);
  assert.ok(Math.abs(q.varMes - 10) < 1e-9);
  assert.ok(Math.abs(q.varAno - 32) < 1e-9);
});

test('parseBrapi: histórico de 3 meses não alcança o ano → ano null (não inventa)', () => {
  const q = E.parseBrapi(resposta([{ date: ts('2026-07-07'), close: 140 }, { date: ts('2026-09-30'), close: 150 }]), '2026-10-07');
  assert.equal(q.varAno, null);
  assert.ok(q.varMes !== null);
});

test('parseBrapi: erros da API e preço inválido', () => {
  assert.equal(E.parseBrapi({ error: true, code: 'MISSING_TOKEN', message: 'x' }, '2026-10-07').erro, 'MISSING_TOKEN');
  assert.equal(E.parseBrapi({ results: [] }, '2026-10-07').erro, 'SEM_PRECO');
  assert.equal(E.parseBrapi(resposta([], { regularMarketPrice: 'abc' }), '2026-10-07').erro, 'SEM_PRECO');
});

test('cotação da brapi entra na carteira e a manual zera as variações', () => {
  const s = E.freshState();
  E.addOperacao(s, { data: '2026-01-05', ticker: 'HGLG11', classe: 'fii', tipo: 'compra', qtd: 10, preco: 15000, taxas: 0 });
  const q = E.parseBrapi(resposta([{ date: ts('2026-09-30'), close: 150 }]), '2026-10-07');
  assert.ok(E.aplicarCotacaoBrapi(s, 'HGLG11', q, new Date('2026-10-07T12:00:00Z')));
  let a = E.carteira(s).ativos[0];
  assert.equal(a.cotacao, 16500); assert.equal(a.cotacaoFonte, 'brapi'); assert.equal(a.varDia, -1.25);
  E.setCotacao(s, 'HGLG11', 16000, '2026-10-07');
  a = E.carteira(s).ativos[0];
  assert.equal(a.cotacaoFonte, 'manual'); assert.equal(a.varDia, null);
});

test('busca de novo só depois de 30 minutos da última busca', () => {
  const s = E.freshState();
  E.addOperacao(s, { data: '2026-01-05', ticker: 'PETR4', classe: 'acao', tipo: 'compra', qtd: 10, preco: 3000, taxas: 0 });
  assert.deepEqual(E.tickersParaAtualizar(s, new Date('2026-10-07T12:00:00Z')), ['PETR4']);
  E.aplicarCotacaoBrapi(s, 'PETR4', E.parseBrapi(resposta([]), '2026-10-07'), new Date('2026-10-07T12:00:00Z'));
  assert.deepEqual(E.tickersParaAtualizar(s, new Date('2026-10-07T12:20:00Z')), []);
  assert.deepEqual(E.tickersParaAtualizar(s, new Date('2026-10-07T12:31:00Z')), ['PETR4']);
});

test('normalizeState mantém os campos da cotação e descarta lixo', () => {
  const s = E.normalizeState({ cotacoes: { PETR4: { preco: 5382, fonte: 'brapi', varDia: -2.78, varMes: 'x', hora: '2026-10-06T21:31:30.000Z', buscadoEm: 'lixo' } } });
  assert.equal(s.cotacoes.PETR4.varDia, -2.78);
  assert.equal(s.cotacoes.PETR4.varMes, null);
  assert.equal(s.cotacoes.PETR4.buscadoEm, '');
});

// Pendente: a tela de cotações automáticas (brapi) aguarda decisão do usuário; a CSP ainda não libera brapi.dev.
test.skip('URL só leva o código do ativo (e a chave, se houver); CSP libera brapi.dev', () => {
  assert.equal(E.BRAPI.url('HGLG11', '1y', ''), 'https://brapi.dev/api/quote/HGLG11?range=1y&interval=1d');
  assert.match(E.BRAPI.url('HGLG11', '3mo', 'a b'), /&token=a%20b$/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(html.match(/Content-Security-Policy" content="([^"]+)"/)[1], /connect-src [^;]*https:\/\/brapi\.dev[ ;]/);
});
