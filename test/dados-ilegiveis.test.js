// Dados do aparelho que não abrem: o PIN certo nunca pode parecer errado e nada é apagado nem sobrescrito.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../src/invest-engine.js');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('abrirEstadoGuardado: sem nada guardado é primeiro uso (vazio, estado novo)', () => {
  for (const raw of [null, undefined, '']) {
    const r = Engine.abrirEstadoGuardado(raw);
    assert.equal(r.ok, true); assert.equal(r.vazio, true);
    assert.deepEqual(r.state, Engine.freshState());
  }
});

test('abrirEstadoGuardado: JSON válido é normalizado', () => {
  const r = Engine.abrirEstadoGuardado(JSON.stringify(Engine.freshState()));
  assert.equal(r.ok, true); assert.equal(r.vazio, false);
  assert.ok(Array.isArray(r.state.operacoes));
});

test('abrirEstadoGuardado: JSON quebrado não lança e vira ilegível', () => {
  const r = Engine.abrirEstadoGuardado('{"operacoes": [');
  assert.deepEqual(r, { ok: false, motivo: 'json' });
});

test('abrirEstadoGuardado: JSON que não é objeto de dados vira ilegível', () => {
  for (const raw of ['123', '"texto"', 'null', '[1,2]', 'true']) {
    assert.deepEqual(Engine.abrirEstadoGuardado(raw), { ok: false, motivo: 'formato' }, raw);
  }
});

test('app.js: abertura sem JSON.parse solto e sem voltar ao PIN por erro de leitura', () => {
  const load = app.slice(app.indexOf('async function load()'), app.indexOf('async function save()'));
  assert.doesNotMatch(load, /JSON\.parse/);
  assert.match(load, /abrirEstadoGuardado/);
  assert.doesNotMatch(load, /lockVault/);
});

test('app.js: com dados ilegíveis, save() não grava e mostra a mensagem exata', () => {
  const save = app.slice(app.indexOf('async function save()'), app.indexOf('/** Tela de recuperação'));
  assert.ok(save.indexOf('if (dadosIlegiveis)') < save.indexOf('setItem'), 'guarda vem antes da gravação');
  assert.match(app, /Seu PIN está certo, mas não conseguimos ler os dados deste aparelho\. Restaure um backup ou exporte o que houver\./);
  assert.match(app, /Restaurar backup/);
});

test('app.js: importar backup libera a gravação e "Apagar tudo" fica bloqueado enquanto ilegível', () => {
  assert.match(app, /dadosIlegiveis = false; dadosBrutos = null; commit\(\)/);
  assert.match(app, /btnReset_click: async function\(\)\{\s*if \(dadosIlegiveis\)/);
});

test('app.js e Program.js idênticos', () => {
  assert.equal(app, fs.readFileSync(path.join(__dirname, '..', 'src', 'Program.js'), 'utf8'));
});
