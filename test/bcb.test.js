'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../src/invest-engine.js');

test('parseSgs lê a última observação e converte a data', () => {
  assert.deepEqual(E.parseSgs([{ data: '05/10/2026', valor: '13.60' }, { data: '06/10/2026', valor: '13.65' }]), { valor: 13.65, data: '2026-10-06' });
  assert.deepEqual(E.parseSgs([{ data: '05/10/2026', dataFim: '05/11/2026', valor: '0.1630' }]), { valor: 0.163, data: '2026-10-05' });
  assert.equal(E.parseSgs([]), null);
  assert.equal(E.parseSgs({ erro: 'x' }), null);
  assert.equal(E.parseSgs([{ data: '31/02/2026', valor: '1' }]), null);
  assert.equal(E.parseSgs([{ data: '06/10/2026', valor: 'abc' }]), null);
});

test('parseFocus lê a mediana', () => {
  assert.deepEqual(E.parseFocus({ value: [{ Data: '2026-10-02', Mediana: 4.5905 }] }), { valor: 4.5905, data: '2026-10-02' });
  assert.equal(E.parseFocus({ value: [] }), null);
  assert.equal(E.parseFocus(null), null);
});

test('TR mensal vira taxa anual composta', () => {
  assert.equal(Math.round(E.trAnual(0.163) * 100) / 100, 1.97);
  assert.equal(E.trAnual(0), 0);
});

test('aplicarIndices: falha parcial mantém o anterior e valor absurdo é ignorado', () => {
  const p = E.defaultParams(); p.ipca = 9.99;
  const ok = E.aplicarIndices(p, { cdi: { valor: 13.65, data: '2026-10-06' }, selic: { valor: 500, data: '2026-10-06' }, tr: { valor: 0.163, data: '2026-10-05' }, ipca: null }, '2026-10-07');
  assert.deepEqual(ok, ['cdi', 'tr']);
  assert.equal(p.cdi, 13.65); assert.equal(p.tr, 1.97); assert.equal(p.ipca, 9.99); assert.equal(p.selic, E.defaultParams().selic);
  assert.equal(p.fonte, 'bcb'); assert.equal(p.bcbEm, '2026-10-07');
  assert.deepEqual(p.refs.tr, { data: '2026-10-05', bruto: 0.163 });
});

test('busca automática: uma vez por dia e nunca por cima de edição manual', () => {
  const p = E.defaultParams();
  assert.equal(E.precisaBuscarIndices(p, '2026-10-07'), true);
  p.fonte = 'bcb'; p.bcbEm = '2026-10-07';
  assert.equal(E.precisaBuscarIndices(p, '2026-10-07'), false);
  assert.equal(E.precisaBuscarIndices(p, '2026-10-08'), true);
  p.fonte = 'manual';
  assert.equal(E.precisaBuscarIndices(p, '2026-10-08'), false);
});

test('normalizeState preserva fonte e referências dos índices', () => {
  const s = E.normalizeState({ params: { cdi: 13.65, fonte: 'bcb', bcbEm: '2026-10-07', refs: { cdi: { data: '2026-10-06', bruto: 13.65 }, x: {} } } });
  assert.equal(s.params.fonte, 'bcb');
  assert.deepEqual(Object.keys(s.params.refs), ['cdi']);
  assert.equal(E.normalizeState({ params: { fonte: 'hack' } }).params.fonte, '');
});

test('CSP libera só os domínios do Banco Central além do painel', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src [^;]*https:\/\/api\.bcb\.gov\.br https:\/\/olinda\.bcb\.gov\.br[ ;]/);
  assert.doesNotMatch(csp, /coingecko/); // cripto é só por valor: nenhuma cotação externa
  assert.equal(E.BCB.sgs(4389), 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json');
  assert.ok(E.BCB.focus.startsWith('https://olinda.bcb.gov.br/'));
});
