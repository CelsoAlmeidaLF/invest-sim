/** Design System: todo CSS fica nos .css. Sem style="", <style>, cssText nem setAttribute('style') no HTML e nos scripts do app. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('index.html: sem style="" e sem bloco <style>', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
});

// Scripts do app (o kit stk-pkt-* e a pasta apoio/ são dos pacotes)
const APP_JS = ['Program.js', 'app.js', 'invest-engine.js'];
for (const f of APP_JS) {
  test(`${f}: estilo só por classe; valor calculado entra por custom property`, () => {
    const src = read(f);
    assert.doesNotMatch(src, /\sstyle\s*=\s*["'\\]/, 'atributo style="" em string HTML');
    assert.doesNotMatch(src, /\.style\.cssText/);
    assert.doesNotMatch(src, /setAttribute\(\s*['"]style['"]/);
    assert.doesNotMatch(src, /\.style\.(?!setProperty|removeProperty)[a-zA-Z]+\s*=/, 'use .style.setProperty("--x", v)');
  });
}

test('Program.js e app.js continuam idênticos', () => {
  assert.equal(read('Program.js'), read('app.js'));
});
