(async function(){
  "use strict";
  await window.vaultReady;
  const localStorage = window.secureStorage;
  const STATE_KEY = "investimentos_state_v1";
  var Engine = window.InvestEngine;
  var FinancCert = window.FinancCert;
  // Data local recalculada a cada uso: nunca congelada na abertura e nunca em UTC.
  function hoje(){ return Engine.hojeISO(); }
  function fmt(cents){ return Engine.fmtBRL(cents); }
  function dateBR(iso){ return Engine.dateBR(iso); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function qtdFmt(n){ return Number(n).toLocaleString('pt-BR'); }
  function signCls(v){ return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function signed(v){ return (v > 0 ? '+\u00a0' : v < 0 ? '−\u00a0' : '') + fmt(Math.abs(v)); } // sinal colado ao valor (não quebra linha)

  var state = Engine.freshState();

  async function load(){
    var raw = localStorage.getItem(STATE_KEY);
    state = Engine.normalizeState(raw ? JSON.parse(raw) : null);
    if (!raw) await save();
    document.body.classList.remove('locked');
  }
  async function save(){
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    await localStorage.flush();
    document.getElementById('saveStatus').textContent = 'salvo e criptografado neste navegador';
  }

  // ---------- diálogos (mesmo padrão modal dos apps: <dialog class="vault-dialog">) ----------
  function iconSvg(name, size){ return window.FinancIcons ? window.FinancIcons.svg(name, {size:size}) : ''; }
  function dialogBox(build){
    return new Promise(function(resolve){
      var dialog = document.createElement('dialog'); dialog.className = 'vault-dialog';
      var result = null;
      build(dialog, function(value){ result = value; dialog.close(); });
      dialog.onclose = function(){ dialog.remove(); resolve(result); };
      document.body.append(dialog); dialog.showModal();
    });
  }
  function dialogHead(title, text, iconName, danger){
    var head = document.createElement('div'); head.className = 'vault-dialog-head';
    head.innerHTML = '<span class="vault-badge' + (danger ? ' vault-badge-danger' : '') + '">' + iconSvg(iconName || 'info', 18) + '</span>';
    var p = document.createElement('p'); var b = document.createElement('b'); b.textContent = title; p.append(b); head.append(p);
    var frag = [head];
    if (text) { var t = document.createElement('p'); t.className = 'vault-dim'; t.textContent = text; frag.push(t); }
    return frag;
  }
  function askConfirm(o){
    return dialogBox(function(dialog, close){
      var actions = document.createElement('div'); actions.className = 'vault-dialog-actions';
      var no = document.createElement('button'); no.type = 'button'; no.textContent = o.cancel || 'Cancelar'; no.onclick = function(){ close(false); };
      var yes = document.createElement('button'); yes.type = 'button'; yes.textContent = o.action || 'Confirmar';
      yes.className = o.danger ? 'vault-dialog-danger' : 'vault-dialog-primary'; yes.onclick = function(){ close(true); };
      actions.append(no, yes);
      dialog.append.apply(dialog, dialogHead(o.title, o.text, o.danger ? 'alert' : 'info', o.danger).concat([actions]));
    }).then(function(v){ return v === true; });
  }
  function showMessage(title, text, danger){
    return dialogBox(function(dialog, close){
      var actions = document.createElement('div'); actions.className = 'vault-dialog-actions';
      var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'vault-dialog-primary'; ok.textContent = 'Entendi'; ok.onclick = function(){ close(true); };
      actions.append(ok);
      dialog.append.apply(dialog, dialogHead(title, text, danger === false ? 'info' : 'alert', danger !== false).concat([actions]));
    });
  }
  /** Modal com valor (R$) e data. Resolve {valor (centavos), data} ou null. */
  function askValue(o){
    return dialogBox(function(dialog, close){
      var form = document.createElement('form'); form.method = 'dialog'; form.className = 'pay-form';
      form.innerHTML = '<label class="field">' + escapeHtml(o.label) + '<input class="input" type="number" name="valor" step="0.01" min="0.01" max="999999999.99" inputmode="decimal" required></label>' +
        '<label class="field">' + escapeHtml(o.dateLabel || 'Data') + '<input class="input" type="date" name="data" required max="' + hoje() + '" value="' + hoje() + '"></label>';
      var inValor = form.elements.valor;
      if (o.valor) inValor.value = Engine.centsToInput(o.valor);
      var actions = document.createElement('div'); actions.className = 'vault-dialog-actions';
      var no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancelar'; no.onclick = function(){ close(null); };
      var yes = document.createElement('button'); yes.type = 'submit'; yes.className = 'vault-dialog-primary'; yes.textContent = o.action || 'Salvar';
      actions.append(no, yes); form.append(actions);
      form.onsubmit = function(ev){
        ev.preventDefault();
        var c = Engine.parseCents(inValor.value);
        if (!(c > 0) || c > Engine.MAX_CENTS) { inValor.setCustomValidity('Informe um valor válido.'); inValor.reportValidity(); return; }
        close({ valor: c, data: form.elements.data.value });
      };
      inValor.addEventListener('input', function(){ inValor.setCustomValidity(''); });
      dialog.append.apply(dialog, dialogHead(o.title, o.text, o.icon || 'pencil').concat([form]));
      setTimeout(function(){ inValor.focus(); inValor.select(); }, 0);
    });
  }

  /**
   * Diálogo com campos livres. fields: [{name, label, type ('money' | 'date' | 'number' | 'text'), value, neg (aceita negativo),
   * optional, step, min, max, placeholder}]. Resolve com {name: valor} (money em centavos; vazio = null) ou null.
   */
  function askForm(o){
    return dialogBox(function(dialog, close){
      var form = document.createElement('form'); form.method = 'dialog'; form.className = 'pay-form';
      o.fields.forEach(function(f){
        var lbl = document.createElement('label'); lbl.className = 'field'; lbl.textContent = f.label;
        var inp = document.createElement('input'); inp.className = 'input'; inp.name = f.name;
        if (f.type === 'date') { inp.type = 'date'; inp.max = f.max || hoje(); if (f.min) inp.min = f.min; inp.value = f.value || hoje(); }
        else if (f.type === 'text') { inp.type = 'text'; inp.maxLength = 80; inp.value = f.value || ''; }
        else { inp.type = 'number'; inp.step = f.step || '0.01'; inp.inputMode = 'decimal'; if (!f.neg) inp.min = f.min !== undefined ? f.min : '0'; inp.max = f.max || '999999999.99';
          if (f.value !== undefined && f.value !== null && f.value !== '') inp.value = f.type === 'money' ? Engine.centsToInput(f.value) : f.value; }
        if (f.placeholder) inp.placeholder = f.placeholder;
        inp.required = !f.optional;
        inp.addEventListener('input', function(){ inp.setCustomValidity(''); });
        lbl.append(inp); form.append(lbl);
      });
      if (o.note) { var n = document.createElement('p'); n.className = 'note'; n.style.margin = '0'; n.textContent = o.note; form.append(n); }
      var actions = document.createElement('div'); actions.className = 'vault-dialog-actions';
      var no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancelar'; no.onclick = function(){ close(null); };
      var yes = document.createElement('button'); yes.type = 'submit'; yes.className = 'vault-dialog-primary'; yes.textContent = o.action || 'Salvar';
      actions.append(no, yes); form.append(actions);
      form.onsubmit = function(ev){
        ev.preventDefault();
        var out = {};
        for (var i = 0; i < o.fields.length; i++) {
          var f = o.fields[i], el = form.elements[f.name], v = el.value.trim();
          if (f.type === 'money') {
            var c = v === '' ? null : Engine.parseCents(v);
            if (v !== '' && (c === null || Math.abs(c) > Engine.MAX_CENTS || (!f.neg && c < 0))) { el.setCustomValidity('Informe um valor válido.'); el.reportValidity(); return; }
            out[f.name] = c;
          } else if (f.type === 'number') { out[f.name] = v === '' ? null : Number(v.replace(',', '.')); }
          else out[f.name] = v;
        }
        close(out);
      };
      dialog.append.apply(dialog, dialogHead(o.title, o.text, o.icon || 'pencil').concat([form]));
      setTimeout(function(){ var f0 = form.querySelector('input'); if (f0) { f0.focus(); if (f0.select) f0.select(); } }, 0);
    });
  }

  // ---------- seções (botão "Seções" no lugar das abas) ----------
  var SECOES = [
    { grupo: 'Meus investimentos', id: 'resumo', nome: 'Carteira', icon: 'wallet', desc: 'Patrimônio por tipo e por banco' },
    { grupo: 'Meus investimentos', id: 'rendafixa', nome: 'Renda fixa', icon: 'percent', desc: 'CDB, LCI, LCA, Tesouro…' },
    { grupo: 'Meus investimentos', id: 'acoes', nome: 'Ações', icon: 'trending-up', desc: 'Ações, FIIs, ETFs e BDRs' },
    { grupo: 'Meus investimentos', id: 'cripto', nome: 'Cripto', icon: 'bitcoin', desc: 'Valor aplicado e valor de hoje' },
    { grupo: 'Meus investimentos', id: 'outros', nome: 'Outros', icon: 'database', desc: 'Previdência, fundos, poupança' },
    { grupo: 'Acompanhar', id: 'acompanhamento', nome: 'Acompanhamento', icon: 'chart-line', desc: 'Diário, mensal e anual, com gráfico' },
    { grupo: 'Acompanhar', id: 'relatorios', nome: 'Relatórios', icon: 'file-text', desc: 'Mensal e anual' },
    { grupo: 'Acompanhar', id: 'metas', nome: 'Metas', icon: 'target', desc: 'Patrimônio, objetivos e aporte mensal' },
    { grupo: 'Acompanhar', id: 'planejamento', nome: 'Planejamento', icon: 'calendar', desc: 'Aportes planejados x feitos' },
    { grupo: 'Mais', tela: 'proventos', nome: 'Proventos', icon: 'trending-up', desc: 'Dividendos, JCP e rendimentos' },
    { grupo: 'Mais', tela: 'ir', nome: 'Imposto de renda', icon: 'file-text', desc: 'IR das vendas e DARF' },
    { grupo: 'Mais', tela: 'simulador', nome: 'Calculadora de renda fixa', icon: 'calculator', desc: 'Projeta as aplicações anotadas' },
  ];
  var secaoAtual = 'resumo';
  function irPara(id){
    if (document.body.classList.contains('report-mode')) { document.body.classList.remove('report-mode'); if (history.state && history.state.invScreen) history.back(); }
    var sec = SECOES.find(function(x){ return x.id === id; }) || SECOES[0];
    secaoAtual = sec.id;
    document.querySelectorAll('section.panel').forEach(function(p){ p.classList.remove('active'); });
    document.getElementById('panel-' + sec.id).classList.add('active');
    document.getElementById('secaoTitulo').textContent = sec.nome;
    renderAll();
  }
  /** Menu suspenso das seções, preso ao botão "Seções": fecha ao escolher, ao tocar fora ou com Esc; setas navegam. */
  function abrirSecoes(){
    var btn = document.getElementById('btnSecoes'), menu = document.getElementById('menuSecoes');
    if (!menu.hidden) { fecharSecoes(); return; }
    var grupo = '', html = '';
    SECOES.forEach(function(sec, i){
      if (sec.grupo !== grupo) { grupo = sec.grupo; html += '<div class="menu-group" role="presentation">' + escapeHtml(grupo) + '</div>'; }
      var atual = sec.id && sec.id === secaoAtual && !document.body.classList.contains('report-mode');
      html += '<button type="button" class="menu-item" role="menuitem" data-i="' + i + '"' + (atual ? ' aria-current="page"' : '') + '>' +
        iconSvg(sec.icon, 18) + '<span>' + escapeHtml(sec.nome) + '</span>' + (atual ? iconSvg('check', 16) : '') + '</button>';
    });
    menu.innerHTML = html;
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    var itens = [].slice.call(menu.querySelectorAll('.menu-item'));
    (menu.querySelector('[aria-current]') || itens[0]).focus();
    setTimeout(function(){ document.addEventListener('pointerdown', foraDoMenu); }, 0);
    document.addEventListener('keydown', teclaMenu);
  }
  function fecharSecoes(foco){
    var menu = document.getElementById('menuSecoes'), btn = document.getElementById('btnSecoes');
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', foraDoMenu); document.removeEventListener('keydown', teclaMenu);
    if (foco) btn.focus();
  }
  function foraDoMenu(e){ if (!e.target.closest('#menuSecoes, #btnSecoes')) fecharSecoes(); }
  function teclaMenu(e){
    var itens = [].slice.call(document.querySelectorAll('#menuSecoes .menu-item')), i = itens.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); fecharSecoes(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); itens[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); itens[itens.length - 1].focus(); }
    else if (e.key === 'Tab') fecharSecoes();
  }
  function escolherSecao(e){
    var b = e.target.closest('.menu-item'); if (!b) return;
    var sec = SECOES[+b.dataset.i];
    fecharSecoes();
    if (sec.tela) openScreen(sec.tela); else { irPara(sec.id); window.scrollTo({ top: 0, behavior: 'instant' }); document.getElementById('btnSecoes').focus({ preventScroll: true }); }
  }

  // ---------- aviso do topo: some sozinho e pode ser fechado de vez ----------
  var PREFS_KEY = 'investimentos_prefs_v1';
  function prefs(){ try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { return {}; } }
  async function setPref(k, v){ var p = prefs(); p[k] = v; localStorage.setItem(PREFS_KEY, JSON.stringify(p)); await localStorage.flush(); }
  function mostrarAviso(){
    var el = document.getElementById('avisoTopo');
    if (prefs().avisoFechado) return;
    el.hidden = false;
    setTimeout(function(){ el.hidden = true; }, 12000);
  }

  // ---------- render helpers ----------
  function rowHtml(opts){
    var actionsHtml = (opts.actions || []).map(function(a){
      var cls = a.cls === 'del' ? 'btn btn-danger btn-sm' : a.cls === 'pay' ? 'btn btn-secondary btn-sm acc' : 'btn btn-secondary btn-sm';
      return '<button type="button" class="' + cls + '" data-action="' + a.action + '">' + a.label + '</button>';
    }).join('');
    return '<div class="row' + (opts.paid ? ' paid' : '') + '" data-id="' + escapeHtml(opts.id) + '">' +
      '<div class="row-main"><div style="min-width:0"><div class="row-title">' + opts.title + '</div><div class="row-meta">' + opts.meta + '</div>' +
      (actionsHtml ? '<div class="row-actions" style="justify-content:flex-start">' + actionsHtml + '</div>' : '') + '</div></div>' +
      '<div class="row-amt ' + (opts.amtClass || '') + '">' + opts.amt + '</div>' +
    '</div>';
  }
  function empty(text, icon){
    return '<div class="empty-state">' + iconSvg(icon || 'file-text', 34) + '<div class="desc">' + text + '</div></div>';
  }
  function classeNome(k){ return k === 'rf' ? 'Renda fixa' : (Engine.CLASSES[k] ? Engine.CLASSES[k].nome : k); }
  function classeTag(k){ return '<span class="badge badge-neutral">' + ({acao:'ação', fii:'FII', etf:'ETF', bdr:'BDR'}[k] || k) + '</span>'; }

  // ---------- resumo ----------
  function renderSummary(c){
    var t = Engine.totaisCarteira(c);
    document.getElementById('sumTotal').textContent = fmt(c.total);
    document.getElementById('sumTotalSub').textContent = c.total ? 'apliquei ' + fmt(t.aplicado) : 'anote seus investimentos nas abas abaixo';
    var pct = t.aplicado ? t.ganho / t.aplicado * 100 : null;
    document.getElementById('sumDelta').innerHTML = pct === null ? '' :
      '<span class="delta ' + (t.ganho > 0 ? 'pos' : t.ganho < 0 ? 'neg' : 'flat') + '">' + iconSvg(t.ganho < 0 ? 'trending-down' : 'trending-up', 14) + ' ' + Engine.fmtPct(pct) + ' sobre o aplicado</span>';
    document.getElementById('sumGanho').textContent = signed(t.ganho);
    document.getElementById('statGanho').className = 'stat ' + signCls(t.ganho);
    var prov = Engine.proventosResumo(state, hoje()).total;
    document.getElementById('sumGanhoSub').textContent = prov ? '+ ' + fmt(prov) + ' em proventos' : '';
    document.getElementById('sumJuros').textContent = signed(c.jurosRF);
    document.getElementById('statJuros').className = 'stat ' + signCls(c.jurosRF);
    document.getElementById('sumJurosSub').textContent = c.rendaFixa.length ? 'sem o IR: ' + signed(c.liquidoRF - c.aplicadoRF) : '';
    var darfs = Engine.darfsPendentes(state, hoje()).map(function(m){ return { v: m.darf, d: m.vencimento, o: 'ações' }; })
      .concat(Engine.darfsCriptoPendentes(state, hoje(), seriesCache).map(function(m){ return { v: m.darf, d: m.vencimento, o: 'cripto' }; }))
      .sort(function(a, b){ return a.d.localeCompare(b.d); });
    var al = document.getElementById('darfAlerta');
    al.hidden = !darfs.length;
    al.innerHTML = darfs.length ? iconSvg('alert', 18) + '<div>DARF a pagar: ' + darfs.map(function(x){ return '<b>' + fmt(x.v) + '</b> (' + x.o + ') até ' + dateBR(x.d); }).join(' · ') + '. Detalhes em ⋮ → Imposto de renda.</div>' : '';
  }

  // ---------- renda fixa: textos comuns ----------
  function taxaRF(x){
    var t = String(x.taxaNum).replace('.', ',');
    return x.indexador === 'cdi' ? t + '% do CDI' : x.indexador === 'pre' ? t + '% a.a.' : x.indexador === 'ipca' ? 'IPCA + ' + t + '%' :
      x.indexador === 'selic' ? 'Selic + ' + t + '%' : x.indexador === 'poupanca' ? 'regra da poupança' : (x.taxa ? escapeHtml(x.taxa) : 'saldo informado');
  }
  function vencTag(x){
    var h = hoje();
    return x.vencimento ? (x.vencimento <= h ? ' <span class="badge badge-neg">venceu</span>' : Engine.diasEntre(h, x.vencimento) <= 30 ? ' <span class="badge badge-warn">vence em breve</span>' : '') : '';
  }

  // ---------- carteira ----------
  var ALLOC_N = 10;
  function itemInst(title, meta, valor, sub, subCls){
    return '<div class="row"><div class="row-main"><div style="min-width:0"><div class="row-title">' + title + '</div><div class="row-meta">' + meta + '</div></div></div>' +
      '<div class="row-amt">' + fmt(valor) + (sub ? '<small class="' + (subCls || '') + '">' + sub + '</small>' : '') + '</div></div>';
  }
  function renderCarteira(c){
    var aloc = document.getElementById('alocacao');
    aloc.innerHTML = c.alocacao.length ? '<div class="alloc-bar" role="img" aria-label="' + escapeHtml(c.alocacao.map(function(a){ return a.nome + ' ' + Engine.fmtPct(a.pct, 1); }).join(', ')) + '">' +
      c.alocacao.map(function(a, i){ return '<span style="width:' + a.pct.toFixed(2) + '%;background:var(--c-' + (i % ALLOC_N + 1) + ')"></span>'; }).join('') + '</div>' +
      '<div class="legend">' + c.alocacao.map(function(a, i){
        return '<div class="lg"><span class="dot" style="background:var(--c-' + (i % ALLOC_N + 1) + ')"></span><span>' + escapeHtml(a.nome) + '</span><span class="num">' + Engine.fmtPct(a.pct, 1) + '</span><span class="num lg-val">' + fmt(a.valor) + '</span></div>';
      }).join('') + '</div>'
      : empty('Nada anotado ainda. Use as abas Renda fixa, Ações, Cripto e Outros.', 'database');

    document.getElementById('listInstituicoes').innerHTML = c.instituicoes.length ? c.instituicoes.map(function(g){
      var itens = g.rendaFixa.map(function(x){
        return itemInst(escapeHtml(x.nome) + vencTag(x), Engine.TIPOS_RF[x.tipo] + ' · ' + taxaRF(x) + ' · aplicado ' + fmt(x.valorAplicado) + ' em ' + dateBR(x.aplicadoEm),
          x.est.bruto, 'juros ' + signed(x.est.juros) + ' (' + Engine.fmtPct(x.est.rentBrutaPct) + ')', signCls(x.est.juros));
      }).concat(g.ativos.map(function(a){
        return itemInst(escapeHtml(a.ticker) + classeTag(a.classe), qtdFmt(a.qtd) + ' × PM ' + fmt(Math.round(a.custo / a.qtd)) + ' · custo ' + fmt(a.custo), a.valor, a.resultado ? signed(a.resultado) : '', signCls(a.resultado));
      })).concat(g.cripto.map(function(x){
        return itemInst(escapeHtml(x.nome) + ' <span class="badge badge-warn">cripto</span>', 'aplicado ' + fmt(x.custo) + (x.moedaValor === 'USD' ? ' (em US$)' : ''), x.valor, x.resultado ? signed(x.resultado) : '', signCls(x.resultado));
      })).concat(g.outros.map(function(x){
        var r = x.valorAtual - x.valorAplicado;
        return itemInst(escapeHtml(x.nome), Engine.CATEGORIAS_OUTROS[x.categoria] + ' · aplicado ' + fmt(x.valorAplicado), x.valorAtual, r ? signed(r) : '', signCls(r));
      })).join('');
      var sub = [];
      if (g.valorRF) sub.push('renda fixa ' + fmt(g.valorRF) + ' · juros <span class="' + signCls(g.jurosRF) + '">' + signed(g.jurosRF) + '</span>');
      if (g.valorRV) sub.push('ações ' + fmt(g.valorRV));
      if (g.valorCripto) sub.push('cripto ' + fmt(g.valorCripto));
      if (g.valorOutros) sub.push('outros ' + fmt(g.valorOutros));
      return '<details class="card inst"><summary><div style="min-width:0"><div class="row-title">' + escapeHtml(g.nome) + '</div><div class="row-meta">' + sub.join(' · ') + '</div></div>' +
        '<div class="row-amt inst-total">' + fmt(g.total) + '<small>' + Engine.fmtPct(c.total ? g.total / c.total * 100 : 0, 1) + '</small></div></summary>' + itens + '</details>';
    }).join('') + '<div class="inst-sum"><span>Total</span><span class="num">' + fmt(c.total) + '</span></div>'
      : '<div class="card">' + empty('Os bancos e corretoras aparecem aqui quando você anotar algo.', 'database') + '</div>';
    var aprox = c.rendaFixa.some(function(x){ return x.est.aproximado; });
    document.getElementById('fonteHint').textContent = !c.rendaFixa.length ? '' : seriesStatus === 'buscando' ? 'Buscando CDI, Selic e IPCA no Banco Central…' :
      aprox ? 'Juros aproximados: sem as séries do Banco Central neste aparelho (sem internet?), o app usa os índices atuais da calculadora.' :
      'Juros da renda fixa calculados com o CDI, a Selic e o IPCA oficiais do Banco Central desde cada aplicação.';
    if (c.cripto.some(function(x){ return x.moedaValor === 'USD'; })) document.getElementById('fonteHint').textContent += ' Cripto em US$: dólar do Banco Central.';

    document.getElementById('listAtivos').innerHTML = c.ativos.length ? c.ativos.map(function(a){
      var meta = qtdFmt(a.qtd) + ' × PM ' + fmt(a.precoMedio) + ' · custo ' + fmt(a.custo);
      meta += a.rentInformada ? '<br>rentabilidade <span class="' + signCls(a.resultado) + '">' + signed(a.resultado) + ' (' + Engine.fmtPct(a.resultadoPct) + ')</span> · informada em ' + dateBR(a.rentInformada.data)
        : a.cotacao !== null ? '<br>cotação ' + fmt(a.cotacao) + (a.cotacaoData ? ' em ' + dateBR(a.cotacaoData) : '') + ' · <span class="' + signCls(a.resultado) + '">' + signed(a.resultado) + ' (' + Engine.fmtPct(a.resultadoPct) + ')</span>'
        : '<br><span class="warn-txt">sem rentabilidade nem cotação: valor pelo custo</span>';
      return rowHtml({ id: a.ticker, title: escapeHtml(a.ticker) + classeTag(a.classe), meta: meta,
        amt: fmt(a.valor) + '<small>' + Engine.fmtPct(a.pctCarteira, 1) + ' da carteira</small>', actions: [{label:'rentabilidade', cls:'pay', action:'rent-ativo'}, {label:'cotação', cls:'', action:'set-quote'}] });
    }).join('') : empty('Nenhuma ação, FII, ETF ou BDR anotado.', 'trending-up');
  }

  // ---------- operações ----------
  function renderOperacoes(){
    var list = state.operacoes.slice().sort(function(a,b){ return b.data.localeCompare(a.data) || (b.seq||0) - (a.seq||0); });
    var vendas = {}; Engine.processar(state).vendas.forEach(function(v){ vendas[v.id] = v; });
    document.getElementById('listOperacoes').innerHTML = list.length ? list.map(function(o){
      var v = vendas[o.id], total = o.qtd * o.preco;
      var meta = dateBR(o.data) + (o.instituicao ? ' · ' + escapeHtml(o.instituicao) : '') + ' · ' + qtdFmt(o.qtd) + ' × ' + fmt(o.preco) + (o.taxas ? ' · taxas ' + fmt(o.taxas) : '');
      if (v) meta += ' · <span class="' + signCls(v.ganho) + '">resultado ' + signed(v.ganho) + '</span>' + (v.dayTrade ? ' <span class="badge badge-warn">day trade</span>' : '');
      return rowHtml({ id: o.id, title: (o.tipo === 'compra' ? 'Compra ' : 'Venda ') + escapeHtml(o.ticker) + classeTag(o.classe), meta: meta,
        amt: fmt(o.tipo === 'compra' ? total + o.taxas : total - o.taxas), amtClass: o.tipo === 'compra' ? 'neg' : 'pos', actions: [{label:'excluir', cls:'del', action:'del-op'}] });
    }).join('') : empty('Nenhuma compra anotada.');

    var tickers = {};
    state.operacoes.forEach(function(o){ tickers[o.ticker] = o.classe; });
    document.getElementById('tickerList').innerHTML = Object.keys(tickers).sort().map(function(t){ return '<option value="' + escapeHtml(t) + '">'; }).join('');
    document.getElementById('addOp').open = !state.operacoes.length;
    var ra = Engine.rentabilidadeAcoes(state);
    var linha = function(x, titulo){
      return '<div class="r"><span>' + titulo + '<span class="r-sub">valorização ' + signed(x.valorizacao) + ' · vendas ' + signed(x.vendas) + ' · proventos ' + signed(x.proventos) + '</span></span>' +
        '<span class="num ' + signCls(x.total) + '">' + signed(x.total) + (x.pct !== null ? '<span class="r-sub">' + Engine.fmtPct(x.pct) + '</span>' : '') + '</span></div>';
    };
    document.getElementById('rentAcoes').innerHTML = ra.porAtivo.length ? '<div class="card kv total">' + ra.porAtivo.map(function(x){ return linha(x, escapeHtml(x.ticker)); }).join('') +
      linha(ra.total, 'Total') + '</div>' + (Engine.carteira(state).semCotacao.length ? '<p class="note warn-txt">Ativos sem cotação entram com valorização zero: informe a cotação para o número ficar completo.</p>' : '') : empty('Nada anotado ainda.');
    document.getElementById('instList').innerHTML = Engine.instituicoesUsadas(state).map(function(n){ return '<option value="' + escapeHtml(n) + '">'; }).join('');
  }

  // ---------- proventos ----------
  function renderProventos(){
    var r = Engine.proventosResumo(state, hoje());
    var max = Math.max.apply(null, r.meses.map(function(m){ return m.valor; }).concat([1]));
    document.getElementById('provTotal').textContent = fmt(r.ult12) + (r.ult12 ? ' (média ' + fmt(r.mediaMensal12) + '/mês)' : '');
    document.getElementById('proventosMeses').innerHTML = r.ult12 ? r.meses.map(function(m){
      var h = Math.round(m.valor / max * 100);
      return '<div class="bar" title="' + Engine.monthBR(m.mes) + ': ' + fmt(m.valor) + '"><i style="height:' + (m.valor ? Math.max(3, h) : 0) + '%"></i><span>' + m.mes.slice(5) + '</span></div>';
    }).join('') : empty('Nenhum provento nos últimos 12 meses.');
    document.getElementById('listProventosAtivo').innerHTML = r.porTicker.length ? r.porTicker.map(function(p){
      return rowHtml({ id: p.ticker, title: escapeHtml(p.ticker), meta: r.total ? Engine.fmtPct(p.valor / r.total * 100, 1) + ' do total recebido' : '', amt: fmt(p.valor), amtClass: 'pos' });
    }).join('') : empty('Nenhum provento lançado.');
    var list = state.proventos.slice().sort(function(a,b){ return b.data.localeCompare(a.data); });
    document.getElementById('listProventos').innerHTML = list.length ? list.map(function(p){
      return rowHtml({ id: p.id, title: escapeHtml(p.ticker) + ' · ' + Engine.TIPOS_PROVENTO[p.tipo], meta: dateBR(p.data), amt: fmt(p.valor), amtClass: 'pos', actions: [{label:'excluir', cls:'del', action:'del-prov'}] });
    }).join('') : '';
  }

  // ---------- renda fixa ----------
  function renderRF(c){
    var ativas = c.rendaFixa.slice().sort(function(a,b){ return (a.vencimento || '9999').localeCompare(b.vencimento || '9999'); });
    var resg = state.rendaFixa.filter(function(x){ return x.resgate; }).sort(function(a,b){ return b.resgate.data.localeCompare(a.resgate.data); });
    document.getElementById('listRFAtivas').innerHTML = ativas.length ? ativas.map(function(x){
      var e = x.est;
      var meta = (x.instituicao ? escapeHtml(x.instituicao) + ' · ' : '') + Engine.TIPOS_RF[x.tipo] + ' · ' + taxaRF(x) + '<br>aplicado ' + fmt(x.valorAplicado) + ' em ' + dateBR(x.aplicadoEm) +
        (x.vencimento ? ' · vence ' + dateBR(x.vencimento) : '') +
        '<br>juros <span class="' + signCls(e.juros) + '">' + signed(e.juros) + '</span> em ' + qtdFmt(e.dias) + ' dias' +
        '<br>rentabilidade <b class="' + signCls(e.rentBrutaPct) + '">' + Engine.fmtPct(e.rentBrutaPct) + '</b> (sem IR ' + Engine.fmtPct(e.rentLiqPct) + ')' +
        (e.rentAA !== null && e.dias >= 30 ? ' · ' + Engine.fmtPct(e.rentAA) + ' a.a.' : '') + (e.pctCDI !== null && e.dias >= 1 ? ' · ' + Engine.fmtPct(e.pctCDI, 1) + ' do CDI no período' : '') + '<br>' +
        (e.isento ? ' · isento de IR' : ' · IR ' + fmt(e.ir) + (e.iof ? ' · IOF ' + fmt(e.iof) : '')) + ' · líquido ' + fmt(e.liquido) +
        (e.ajuste ? ' · <span class="warn-txt">juros informados por você em ' + dateBR(e.ajuste.data) + ', rendendo pela taxa desde então</span>' : '') +
        (e.manual ? ' · saldo informado em ' + dateBR(x.atualizadoEm) : e.aproximado ? ' · <span class="warn-txt">aproximado</span>' : e.ipcaProjetado ? ' · <span class="warn-txt">IPCA do mês ainda não divulgado: estimado</span>' : '');
      var acts = [{label:'informar juros', cls:'pay', action:'juros-rf'}].concat(e.ajuste ? [{label:'cálculo automático', cls:'', action:'auto-rf'}] : [])
        .concat([{label:'resgatar', cls:'', action:'resg-rf'}, {label:'excluir', cls:'del', action:'del-rf'}]);
      return rowHtml({ id: x.id, title: escapeHtml(x.nome) + vencTag(x), meta: meta, amt: fmt(e.bruto) + '<small>valor bruto</small>', actions: acts });
    }).join('') : empty('Nenhuma aplicação ativa.');
    document.getElementById('listRFResgatadas').innerHTML = resg.length ? resg.map(function(x){
      var res = x.resgate.valor - x.valorAplicado;
      return rowHtml({ id: x.id, title: escapeHtml(x.nome), meta: (x.instituicao ? escapeHtml(x.instituicao) + ' · ' : '') + 'resgatado em ' + dateBR(x.resgate.data) + ' · aplicado ' + fmt(x.valorAplicado) + ' · <span class="' + signCls(res) + '">' + signed(res) + '</span>',
        amt: fmt(x.resgate.valor), paid: true, actions: [{label:'excluir', cls:'del', action:'del-rf'}] });
    }).join('') : empty('Nenhuma aplicação resgatada.');
    document.getElementById('addRF').open = !state.rendaFixa.length;
    if (!ativas.length) document.getElementById('listRFAtivas').innerHTML = empty('Nenhuma aplicação anotada.');
  }
  function syncRFTaxa(){
    var ix = document.getElementById('rfIndexador').value, lbl = document.getElementById('rfTaxaLabel'), inp = document.getElementById('rfTaxaNum');
    var rot = {cdi: 'Taxa (% do CDI)', pre: 'Taxa (% ao ano)', ipca: 'Taxa acima do IPCA (% a.a.)', selic: 'Taxa acima da Selic (% a.a.)'}[ix];
    lbl.hidden = !rot; if (rot) lbl.firstChild.textContent = rot;
    inp.value = {cdi: 100, pre: 13, ipca: 7, selic: 0.05}[ix] || '';
  }
  // Tipo isento/Tesouro/Poupança sugere a rentabilidade mais comum.
  function syncRFTipo(){
    var t = document.getElementById('rfTipo').value, ix = document.getElementById('rfIndexador');
    if (t === 'poupanca') ix.value = 'poupanca'; else if (t === 'tesouro') ix.value = 'selic'; else if (ix.value === 'poupanca' || ix.value === 'selic') ix.value = 'cdi';
    syncRFTaxa();
  }

  // ---------- cripto ----------
  function fillMoedas(){
    document.getElementById('cMoeda').innerHTML = Object.keys(Engine.MOEDAS).map(function(k){ return '<option value="' + k + '">' + escapeHtml(Engine.MOEDAS[k].nome) + '</option>'; }).join('') +
      '<option value="outra">Outra…</option>';
  }
  var simbolo = function(m){ return m === 'USD' ? 'US$ ' : 'R$ '; };
  function fmtMoeda(cents, m){ return m === 'USD' ? 'US$ ' + ((Number(cents) || 0) / 100).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : fmt(cents); }
  function renderCripto(c){
    document.getElementById('listCriptoPos').innerHTML = c.cripto.length ? c.cripto.map(function(x){
      var usd = x.moedaValor === 'USD';
      var meta = (x.onde ? escapeHtml(x.onde) + ' · ' : '') + (x.custodia === 'exterior' ? 'exchange no exterior · ' : '') + 'desde ' + dateBR(x.aplicadoEm) +
        '<br>apliquei ' + fmtMoeda(x.custoRest, x.moedaValor) + ' · hoje ' + fmtMoeda(x.valorAtual, x.moedaValor) + ' (em ' + dateBR(x.atualizadoEm) + ')' +
        '<br><span class="' + signCls(x.resultado) + '">' + signed(x.resultado) + (x.resultadoPct !== null ? ' (' + Engine.fmtPct(x.resultadoPct) + ')' : '') + '</span>' +
        (usd ? ' em reais' + (x.aproximado ? ' · <span class="warn-txt">dólar aproximado (R$ 5,50)</span>' : '') : '');
      return rowHtml({ id: x.id, title: escapeHtml(x.nome) + (usd ? ' <span class="badge badge-neutral">US$</span>' : ''), meta: meta, amt: fmt(x.valor) + (usd ? '<small>' + fmtMoeda(x.valorAtual, 'USD') + '</small>' : ''),
        actions: [{label:'atualizar', cls:'pay', action:'upd-cripto'}, {label:'vendi', cls:'', action:'vender-cripto'}, {label:'excluir', cls:'del', action:'del-cripto'}] });
    }).join('') : empty('Nenhuma cripto anotada.', 'bitcoin');
    var vendas = Engine.vendasCripto(state, seriesCache).reverse();
    document.getElementById('listCripto').innerHTML = vendas.length ? vendas.map(function(v){
      return rowHtml({ id: v.id, title: 'Vendi ' + escapeHtml(v.nome), meta: dateBR(v.data) + (v.custodia === 'exterior' ? ' · exterior' : '') + ' · custo ' + fmt(v.custo) + ' · <span class="' + signCls(v.ganho) + '">resultado ' + signed(v.ganho) + '</span>',
        amt: fmt(v.valor), amtClass: 'pos' });
    }).join('') : empty('Nenhuma venda anotada.');
    var d = Engine.dolarEm(seriesCache, hoje());
    document.getElementById('criptoHint').textContent = state.cripto.some(function(x){ return x.moedaValor === 'USD'; }) ?
      (d.aproximado ? 'Sem o dólar do Banco Central neste aparelho: usando R$ 5,50 até atualizar.' : 'Dólar do Banco Central (PTAX) de ' + dateBR(d.data) + ': ' + fmt(d.centavos) + '.') : '';
    document.getElementById('addCripto').open = !state.cripto.length;
  }
  function syncCriptoNome(){ document.getElementById('cNomeLabel').hidden = document.getElementById('cMoeda').value !== 'outra'; }

  // ---------- acompanhamento (fotos diárias + gráfico) ----------
  var acompPeriodo = 'mes', resizeTimer = null;
  function compacto(cents){
    var v = (cents || 0) / 100, a = Math.abs(v);
    return a >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' mi' : a >= 1e3 ? 'R$ ' + (v / 1e3).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' mil' : 'R$ ' + v.toLocaleString('pt-BR', {maximumFractionDigits: 0});
  }
  function rotuloPonto(p){ return acompPeriodo === 'ano' ? p.chave : acompPeriodo === 'mes' ? Engine.monthBR(p.chave) : dateBR(p.chave).slice(0, 5); }
  /** Linha do patrimônio (acento) e linha tracejada do aplicado (referência); a área entre elas é o ganho. Um eixo, em R$. */
  function grafico(pts){
    var box = document.getElementById('acompGrafico');
    if (pts.length < 2) { box.innerHTML = empty(pts.length ? 'O gráfico aparece quando houver pelo menos dois ' + (acompPeriodo === 'dia' ? 'dias' : acompPeriodo === 'mes' ? 'meses' : 'anos') + ' de histórico.' : 'Ainda não há histórico.', 'chart-line'); return; }
    // Desenha na largura real do card: o texto do eixo fica no tamanho certo (sem encolher junto com o SVG).
    var W = Math.max(300, Math.round(box.clientWidth || 340)), H = 220, L = 58, R = 74, T = 14, B = 26, iw = W - L - R, ih = H - T - B;
    var vals = []; pts.forEach(function(p){ vals.push(p.patrimonio, p.aplicado); });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var pad = (max - min) * 0.12 || max * 0.1 || 100; min = Math.max(0, min - pad); max = max + pad;
    var x = function(i){ return L + (pts.length === 1 ? iw / 2 : i * iw / (pts.length - 1)); }, y = function(v){ return T + ih - (v - min) / (max - min) * ih; };
    var linha = function(k){ return pts.map(function(p, i){ return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[k]).toFixed(1); }).join(' '); };
    var area = linha('patrimonio') + ' ' + pts.slice().reverse().map(function(p, j){ var i = pts.length - 1 - j; return 'L' + x(i).toFixed(1) + ' ' + y(p.aplicado).toFixed(1); }).join(' ') + ' Z';
    var grid = '', ticks = 4;
    for (var g = 0; g <= ticks; g++) { var v = min + (max - min) * g / ticks, yy = y(v).toFixed(1);
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text class="axis" x="' + (L - 8) + '" y="' + (Number(yy) + 3) + '" text-anchor="end">' + compacto(v) + '</text>'; }
    var idxs = (W < 420 ? [0, pts.length - 1] : [0, Math.floor((pts.length - 1) / 2), pts.length - 1]).filter(function(v, i, a){ return a.indexOf(v) === i; });
    var xlab = idxs.map(function(i){ return '<text class="axis" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle') + '">' + rotuloPonto(pts[i]) + '</text>'; }).join('');
    var u = pts[pts.length - 1], yP = y(u.patrimonio), yA = y(u.aplicado);
    if (Math.abs(yP - yA) < 14) { if (yP <= yA) yA = yP + 14; else yP = yA + 14; }
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Patrimônio e quanto apliquei, ' + escapeHtml(rotuloPonto(pts[0])) + ' a ' + escapeHtml(rotuloPonto(u)) + '">' +
      '<g class="grid">' + grid + '</g>' + xlab + '<path class="area" d="' + area + '"/>' +
      '<path class="line-ref" d="' + linha('aplicado') + '"/><path class="line" d="' + linha('patrimonio') + '"/>' +
      '<circle class="dot" cx="' + x(pts.length - 1).toFixed(1) + '" cy="' + y(u.patrimonio).toFixed(1) + '" r="4"/>' +
      '<text class="label" x="' + (W - R + 8) + '" y="' + (yP + 4).toFixed(1) + '">' + compacto(u.patrimonio) + '</text>' +
      '<text class="label-dim" x="' + (W - R + 8) + '" y="' + (yA + 4).toFixed(1) + '">' + compacto(u.aplicado) + '</text>' +
      '<line class="crosshair" id="gCross" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" visibility="hidden"/>' +
      '<rect id="gHit" x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>' +
      '<div class="chart-tip" id="gTip" hidden></div>' +
      '<div class="chart-legend"><span><i></i>Patrimônio</span><span><i class="ref"></i>Quanto apliquei</span><span>área entre as linhas = ganho</span></div>';
    var svg = box.querySelector('svg'), tip = document.getElementById('gTip'), cross = document.getElementById('gCross');
    var mover = function(ev){
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(pts.length - 1, Math.round((px - L) / iw * (pts.length - 1)))), p = pts[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + rotuloPonto(p) + '</b><br>Patrimônio ' + fmt(p.patrimonio) + '<br>Apliquei ' + fmt(p.aplicado) + '<br>Ganho ' + signed(p.ganho) +
        (p.rendeu !== null ? '<br>Rendeu no período ' + signed(p.rendeu) : '');
      tip.style.left = (x(i) / W * 100) + '%'; tip.style.top = (y(p.patrimonio) / H * r.height) + 'px'; tip.hidden = false;
    };
    var sair = function(){ tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    var hit = document.getElementById('gHit');
    hit.addEventListener('pointermove', mover); hit.addEventListener('pointerdown', mover); hit.addEventListener('pointerleave', sair);
  }
  function renderAcompanhamento(){
    var pts = Engine.acompanhamento(state, acompPeriodo);
    grafico(pts);
    var h = state.historico;
    document.getElementById('acompHint').textContent = h.length ? 'O app guarda o seu patrimônio uma vez por dia, quando você o abre. Histórico desde ' + dateBR(h[0].data) + '. "Rendeu" já desconta o dinheiro novo que você aplicou.' :
      'O app passa a guardar o seu patrimônio uma vez por dia, quando você o abre.';
    document.getElementById('acompTabela').innerHTML = pts.length ? pts.slice().reverse().map(function(p){
      return '<div class="r"><span>' + rotuloPonto(p) + '<span class="r-sub">patrimônio ' + fmt(p.patrimonio) + ' · apliquei ' + fmt(p.aplicado) + '</span></span>' +
        '<span class="' + (p.rendeu === null ? '' : signCls(p.rendeu)) + '">' + (p.rendeu === null ? '—' : signed(p.rendeu)) + (p.rendeuPct !== null ? '<span class="r-sub">' + Engine.fmtPct(p.rendeuPct) + '</span>' : '') + '</span></div>';
    }).join('') : empty('Sem histórico ainda.');
  }

  // ---------- relatórios ----------
  var relTipo = 'mes';
  function renderRelatorio(){
    document.getElementById('relMesLabel').hidden = relTipo !== 'mes';
    document.getElementById('relAnoLabel').hidden = relTipo !== 'ano';
    var per = relTipo === 'mes' ? document.getElementById('relMes').value : String(document.getElementById('relAno').value);
    if (!(relTipo === 'mes' ? /^\d{4}-\d{2}$/ : /^\d{4}$/).test(per)) return;
    var r = Engine.relatorio(state, per, { series: seriesCache });
    var line = function(label, v, sinal, sub){ return '<div class="r"><span>' + label + (sub ? '<span class="r-sub">' + sub + '</span>' : '') + '</span><span class="' + (sinal ? signCls(v) : '') + '">' + (v === null ? '—' : sinal ? signed(v) : fmt(v)) + '</span></div>'; };
    document.getElementById('relResumo').innerHTML =
      line('Patrimônio no início', r.patrimonioIni) + line('Patrimônio no fim', r.patrimonioFim) +
      line('Apliquei (aportes e compras)', r.aportes) + line('Resgatei / vendi', r.resgates) +
      line('Proventos recebidos', r.proventos) + line('IR das vendas (ações e cripto)', r.irAcoes + r.irCripto) +
      line('Quanto rendeu', r.rendeu, true, r.rendeu === null ? 'precisa do histórico do Acompanhamento no início e no fim do período' : (r.rendeuPct !== null ? Engine.fmtPct(r.rendeuPct) + ' sobre o patrimônio do início' : ''));
    document.getElementById('relGrupos').innerHTML = r.porGrupo.length ? r.porGrupo.map(function(g){
      return '<div class="r"><span>' + escapeHtml(g.grupo) + '<span class="r-sub">apliquei ' + fmt(g.aportes) + ' · resgatei ' + fmt(g.resgates) + '</span></span><span>' + signed(g.aportes - g.resgates) + '</span></div>';
    }).join('') : empty('Nenhuma movimentação no período.');
    document.getElementById('relMov').innerHTML = r.movimentos.length ? r.movimentos.map(function(m, i){
      return rowHtml({ id: 'mov' + i, title: escapeHtml(m.nome) + ' <span class="badge ' + (m.tipo === 'aporte' ? 'badge-info">aplicação' : 'badge-neutral">resgate/venda') + '</span>',
        meta: dateBR(m.data) + ' · ' + escapeHtml(m.grupo), amt: fmt(m.valor), amtClass: m.tipo === 'aporte' ? '' : 'pos' });
    }).join('') : empty('Nenhuma movimentação no período.');
  }

  // ---------- metas ----------
  function syncMetaForm(){
    var t = document.getElementById('mTipo').value;
    document.getElementById('mNomeLabel').hidden = t !== 'objetivo';
    document.getElementById('mPrazoLabel').hidden = t === 'aporte';
    document.getElementById('mValorLabel').firstChild.textContent = t === 'aporte' ? 'Quanto por mês (R$)' : 'Valor (R$)';
  }
  function renderMetas(c){
    document.getElementById('listMetas').innerHTML = state.metas.length ? state.metas.map(function(m){
      var st = Engine.situacaoMeta(state, m, c, { hoje: hoje(), series: seriesCache }), pct = Math.min(100, Math.max(0, st.pct));
      var corpo;
      if (m.tipo === 'aporte') {
        corpo = '<div class="row-meta">Este mês: ' + fmt(st.atual) + ' de ' + fmt(m.valor) + (st.falta ? ' · faltam ' + fmt(st.falta) : ' · cumprido') + ' · ' + st.cumpridos + ' de 12 meses cumpridos</div>' +
          '<div class="meses-12">' + st.meses.map(function(x){ return '<span class="' + (x.cumpriu ? 'ok' : '') + '" title="' + Engine.monthBR(x.mes) + ': ' + fmt(x.valor) + '">' + x.mes.slice(5) + '</span>'; }).join('') + '</div>';
      } else {
        corpo = '<div class="row-meta">' + fmt(st.atual) + ' de ' + fmt(m.valor) + (st.atingida ? ' · meta atingida' : ' · faltam ' + fmt(st.falta)) +
          (m.prazo ? ' · até ' + dateBR(m.prazo) : '') + '</div>' +
          (!st.atingida && st.porMes !== null ? '<div class="row-meta">Para chegar lá: ' + fmt(st.porMes) + ' por mês' + (st.meses ? ' em ' + st.meses + ' meses' : '') + ' (sem contar rendimento)</div>' : '') +
          (st.vencida ? '<div class="row-meta warn-txt">O prazo passou e a meta não foi atingida.</div>' : '') +
          (m.tipo === 'objetivo' ? '<div class="row-meta">' + (st.itens.length ? 'Conta: ' + st.itens.map(function(i){ return escapeHtml(i.nome); }).join(', ') : 'Nenhum investimento ligado ainda.') + '</div>' : '');
      }
      var acts = (m.tipo === 'objetivo' ? '<button type="button" class="btn btn-secondary btn-sm acc" data-meta="' + m.id + '" data-acao="ligar">investimentos</button>' : '') +
        '<button type="button" class="btn btn-danger btn-sm" data-meta="' + m.id + '" data-acao="del">excluir</button>';
      return '<div class="card meta-card"><div class="meta-top"><div><div class="row-title" style="white-space:normal">' + escapeHtml(m.nome) + ' <span class="badge badge-neutral">' + Engine.TIPOS_META[m.tipo] + '</span></div></div>' +
        '<div class="row-amt">' + Engine.fmtPct(st.pct, 0) + '</div></div>' +
        '<div class="progress' + (st.vencida ? ' danger' : '') + '"><span style="width:' + pct.toFixed(1) + '%"></span></div>' + corpo +
        '<div class="row-actions" style="justify-content:flex-start;margin-top:10px">' + acts + '</div></div>';
    }).join('') : '<div class="card">' + empty('Crie sua primeira meta: patrimônio, um objetivo com nome ou quanto investir por mês.', 'target') + '</div>';
    document.getElementById('addMeta').open = !state.metas.length;
  }
  /** Lista de investimentos para ligar a um objetivo. */
  function escolherInvestimentos(meta, c){
    var opcoes = c.rendaFixa.map(function(x){ return { tipo: 'rf', id: x.id, nome: x.nome + (x.instituicao ? ' · ' + x.instituicao : ''), valor: x.est.bruto }; })
      .concat(c.outros.map(function(x){ return { tipo: 'outro', id: x.id, nome: x.nome, valor: x.valorAtual }; }))
      .concat(c.cripto.map(function(x){ return { tipo: 'cripto', id: x.id, nome: x.nome + (x.onde ? ' · ' + x.onde : ''), valor: x.valor }; }))
      .concat(c.ativos.map(function(a){ return { tipo: 'acao', id: a.ticker, nome: a.ticker, valor: a.valor }; }));
    var marcado = function(o){ return meta.vinculos.some(function(v){ return v.tipo === o.tipo && v.id === o.id; }); };
    return dialogBox(function(dialog, close){
      var box = document.createElement('div'); box.className = 'stack'; box.style.marginTop = '12px'; box.style.maxHeight = '50vh'; box.style.overflow = 'auto';
      if (!opcoes.length) { var p = document.createElement('p'); p.className = 'note'; p.textContent = 'Anote investimentos primeiro.'; box.append(p); }
      opcoes.forEach(function(o, i){
        var l = document.createElement('label'); l.className = 'check';
        l.innerHTML = '<input type="checkbox" data-i="' + i + '"' + (marcado(o) ? ' checked' : '') + '> <span style="flex:1">' + escapeHtml(o.nome) + '</span><span class="num">' + fmt(o.valor) + '</span>';
        box.append(l);
      });
      var actions = document.createElement('div'); actions.className = 'vault-dialog-actions';
      var no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancelar'; no.onclick = function(){ close(null); };
      var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'vault-dialog-primary'; yes.textContent = 'Salvar';
      yes.onclick = function(){ close([].slice.call(box.querySelectorAll('input:checked')).map(function(i){ var o = opcoes[+i.dataset.i]; return { tipo: o.tipo, id: o.id }; })); };
      actions.append(no, yes);
      dialog.append.apply(dialog, dialogHead('Investimentos de "' + meta.nome + '"', 'Marque o que conta para este objetivo.', 'target').concat([box, actions]));
    });
  }

  // ---------- planejamento ----------
  function renderPlanejamento(){
    var ano = String(document.getElementById('planAno').value || hoje().slice(0, 4));
    if (!/^\d{4}$/.test(ano)) return;
    var p = Engine.planejamento(state, ano, { hoje: hoje(), series: seriesCache });
    document.getElementById('planResumo').innerHTML = '<div class="stat-grid">' +
      '<div class="stat"><div class="k">planejado ' + ano + '</div><div class="v">' + fmt(p.planejado) + '</div></div>' +
      '<div class="stat ' + (p.planejado && p.feito >= p.planejado ? 'pos' : '') + '"><div class="k">feito</div><div class="v">' + fmt(p.feito) + '</div></div>' +
      '<div class="stat ' + signCls(p.diferenca) + '"><div class="k">diferença</div><div class="v">' + signed(p.diferenca) + '</div></div></div>' +
      (p.pct !== null ? '<div class="progress" style="margin-top:12px"><span style="width:' + Math.min(100, p.pct).toFixed(1) + '%"></span></div><p class="note" style="margin-top:6px">' + Engine.fmtPct(p.pct, 0) + ' do planejado no ano</p>' : '');
    var nomes = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    document.getElementById('planMeses').innerHTML = '<div class="plan-row plan-head"><span>mês</span><span>planejado</span><span style="text-align:right">feito</span></div>' + p.meses.map(function(m, i){
      return '<div class="plan-row' + (m.atual ? ' atual' : '') + '"><span class="mes">' + nomes[i] + '</span>' +
        '<input class="input" type="number" step="0.01" min="0" max="999999999.99" inputmode="decimal" data-plan="' + m.mes.slice(5) + '" value="' + (m.planejado ? Engine.centsToInput(m.planejado) : '') + '" placeholder="0,00" aria-label="Planejado em ' + nomes[i] + '">' +
        '<span class="feito"><span class="' + (m.planejado && (m.passado || m.atual) ? (m.feito >= m.planejado ? 'pos' : 'neg') : '') + '">' + fmt(m.feito) + '</span>' +
        (m.planejado && (m.passado || m.atual) ? '<span class="r-sub">' + signed(m.diferenca) + '</span>' : '') + '</span></div>';
    }).join('');
  }

  // ---------- outros ----------
  function renderOutros(){
    var ativos = state.outros.filter(function(x){ return !x.resgate; }), resg = state.outros.filter(function(x){ return x.resgate; });
    document.getElementById('listOutros').innerHTML = ativos.length ? ativos.map(function(x){
      var r = x.valorAtual - x.valorAplicado;
      return rowHtml({ id: x.id, title: escapeHtml(x.nome), meta: (x.instituicao ? escapeHtml(x.instituicao) + ' · ' : '') + Engine.CATEGORIAS_OUTROS[x.categoria] +
        '<br>aplicado ' + fmt(x.valorAplicado) + ' em ' + dateBR(x.aplicadoEm) + ' · valor de ' + dateBR(x.atualizadoEm) + ' · <span class="' + signCls(r) + '">' + signed(r) + '</span>',
        amt: fmt(x.valorAtual), actions: [{label:'atualizar', cls:'pay', action:'upd-outro'}, {label:'resgatar', cls:'', action:'resg-outro'}, {label:'excluir', cls:'del', action:'del-outro'}] });
    }).join('') : empty('Nada anotado em Outros.');
    document.getElementById('listOutrosResg').innerHTML = resg.length ? resg.map(function(x){
      var r = x.resgate.valor - x.valorAplicado;
      return rowHtml({ id: x.id, title: escapeHtml(x.nome), meta: 'resgatado em ' + dateBR(x.resgate.data) + ' · aplicado ' + fmt(x.valorAplicado) + ' · <span class="' + signCls(r) + '">' + signed(r) + '</span>',
        amt: fmt(x.resgate.valor), paid: true, actions: [{label:'excluir', cls:'del', action:'del-outro'}] });
    }).join('') : empty('Nenhum resgate.');
    document.getElementById('addOutro').open = !state.outros.length;
  }

  // ---------- séries do Banco Central para os juros da renda fixa ----------
  // Ficam no cofre (chave própria, fora do backup); só o código da série e o período vão na consulta.
  var SERIES_KEY = 'investimentos_series_v1', seriesCache = {}, seriesStatus = '', seriesPendente = false;
  function loadSeries(){ try { var raw = localStorage.getItem(SERIES_KEY); seriesCache = raw ? JSON.parse(raw) || {} : {}; } catch (_) { seriesCache = {}; } }
  /** Devolve 'ok', 'nada' (já em dia), 'erro', 'offline' ou 'ocupado'. forcar = buscar de novo mesmo já tendo buscado hoje. */
  async function atualizarSeries(forcar){
    if (seriesStatus === 'buscando') { seriesPendente = true; return 'ocupado'; } // repete ao terminar a busca atual
    if (!navigator.onLine) return 'offline';
    var base = seriesCache;
    if (forcar) { base = {}; Object.keys(seriesCache).forEach(function(k){ base[k] = Object.assign({}, seriesCache[k], { buscadoEm: '' }); }); }
    var falta = Engine.seriesNecessarias(state, base, hoje());
    if (!falta.length) return 'nada';
    seriesStatus = 'buscando'; renderAll();
    var mudou = false, falhou = false;
    for (var i = 0; i < falta.length; i++) {
      var f = falta[i], pontos = [], ok = true;
      var janelas = Engine.janelasSerie(f.inicio, f.fim);
      for (var j = 0; j < janelas.length && ok; j++) {
        try { var d = Engine.parseSerie(await getJSON(Engine.urlSerie(f.codigo, janelas[j][0], janelas[j][1]))); if (d) pontos = pontos.concat(d); else ok = false; }
        catch (err) { if (err && err.status === 404) continue; ok = false; } // 404 = nenhum dado no período (ex.: aplicação de hoje)
      }
      if (!ok) { falhou = true; continue; }
      var atual = seriesCache[f.codigo] || { inicio: '', dados: [] };
      seriesCache[f.codigo] = { inicio: !atual.inicio || f.inicio < atual.inicio ? f.inicio : atual.inicio, buscadoEm: hoje(), dados: Engine.mergeSerie(atual.dados, pontos) };
      mudou = true;
    }
    seriesStatus = '';
    if (mudou) { localStorage.setItem(SERIES_KEY, JSON.stringify(seriesCache)); await localStorage.flush(); }
    renderAll();
    // Aplicações cadastradas durante a busca podem precisar de outra série ou de um período mais antigo.
    if (seriesPendente && mudou) { seriesPendente = false; atualizarSeries(); } else seriesPendente = false;
    return falhou ? 'erro' : 'ok';
  }

  // ---------- simulador ----------
  function simDias(){
    var n = Math.trunc(Number(document.getElementById('sPrazo').value));
    if (!(n >= 1)) return 0;
    var u = document.getElementById('sUnidade').value;
    return Math.min(36500, u === 'anos' ? Math.round(n * 365) : u === 'meses' ? Math.round(n * 365 / 12) : n);
  }
  function fillParams(){
    var p = state.params;
    document.getElementById('parCdi').value = p.cdi; document.getElementById('parSelic').value = p.selic;
    document.getElementById('parIpca').value = p.ipca; document.getElementById('parTr').value = p.tr; document.getElementById('parCustodia').value = p.custodia;
    renderParamsHint();
  }
  function pctBR(n, casas){ return Number(n).toLocaleString('pt-BR', {minimumFractionDigits: casas || 2, maximumFractionDigits: casas || 2}) + '%'; }
  function renderParamsHint(){
    var p = state.params, r = p.refs || {}, partes = [];
    if (r.cdi) partes.push('CDI ' + pctBR(p.cdi) + ' em ' + dateBR(r.cdi.data));
    if (r.selic) partes.push('Selic ' + pctBR(p.selic) + ' em ' + dateBR(r.selic.data));
    if (r.ipca) partes.push('IPCA esperado (Focus, mediana 12 meses) ' + pctBR(p.ipca) + ' em ' + dateBR(r.ipca.data));
    if (r.tr) partes.push('TR ' + pctBR(r.tr.bruto, 4) + ' a.m. (' + pctBR(p.tr) + ' a.a.) desde ' + dateBR(r.tr.data));
    var txt;
    if (p.fonte === 'manual') txt = 'Índices editados por você' + (p.atualizadoEm ? ' em ' + dateBR(p.atualizadoEm) : '') + ': a busca automática não sobrescreve. Use o botão para voltar aos do Banco Central.';
    else if (p.fonte === 'bcb') txt = 'Banco Central, buscado em ' + dateBR(p.bcbEm) + (partes.length ? ': ' + partes.join(' · ') : '') + '. Atualiza sozinho uma vez por dia.';
    else txt = 'Valores de reserva (Banco Central em 06/10/2026). Toque em "Buscar no Banco Central" para atualizar.';
    document.getElementById('paramsHint').textContent = txt + ' A custódia do Tesouro não tem fonte automática: confira no site do Tesouro Direto.';
  }
  /** GET público com tempo-limite; nenhum dado do usuário vai na requisição. */
  function getJSON(url){
    var ctrl = new AbortController(), t = setTimeout(function(){ ctrl.abort(); }, 12000);
    return fetch(url, {signal: ctrl.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'})
      .then(function(r){ if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); })
      .finally(function(){ clearTimeout(t); });
  }
  var bcbBusy = false;
  async function buscarIndices(manual){
    if (bcbBusy) return;
    var st = document.getElementById('bcbStatus'), btn = document.getElementById('btnBcb');
    if (!navigator.onLine) { if (manual) st.textContent = 'sem internet: mantidos os valores atuais.'; return; }
    bcbBusy = true; btn.disabled = true; st.textContent = 'buscando…';
    var S = Engine.BCB.series, sgs = function(k){ return getJSON(Engine.BCB.sgs(S[k])).then(Engine.parseSgs); };
    var res = await Promise.allSettled([sgs('cdi'), sgs('selic'), sgs('tr'), getJSON(Engine.BCB.focus).then(Engine.parseFocus)]);
    var v = function(i){ return res[i].status === 'fulfilled' ? res[i].value : null; };
    var ok = Engine.aplicarIndices(state.params, {cdi: v(0), selic: v(1), tr: v(2), ipca: v(3)}, hoje());
    bcbBusy = false; btn.disabled = false;
    if (!ok.length) { st.textContent = 'não foi possível buscar agora: mantidos os valores atuais.'; return; }
    var falhou = ['cdi','selic','tr','ipca'].filter(function(k){ return ok.indexOf(k) < 0; });
    st.textContent = falhou.length ? 'atualizado, exceto ' + falhou.map(function(k){ return k.toUpperCase(); }).join(', ') + '.' : 'atualizado.';
    save(); fillParams(); renderSimulador();
  }
  function renderSimulador(){
    var box = document.getElementById('simResultado');
    var itens = Engine.rfParaCalculadora(state);
    var semTaxa = state.rendaFixa.filter(function(x){ return !x.resgate && x.indexador === 'manual'; }).length;
    var nota = semTaxa ? '<p class="note">' + semTaxa + ' aplicação(ões) anotada(s) como "informo o saldo" ficam de fora: sem taxa, não dá para projetar.</p>' : '';
    if (!itens.length) { box.innerHTML = empty('Anote suas aplicações na aba Renda fixa (com a taxa) para vê-las aqui.') + nota; return; }
    var valor = Engine.parseCents(document.getElementById('sValor').value), dias = simDias();
    if (!(valor > 0) || valor > Engine.MAX_CENTS || !dias) { box.innerHTML = empty('Informe valor e prazo.'); return; }
    var lista = Engine.comparar(valor, dias, itens.map(function(x){
      return Object.assign({}, x, { nome: x.nome + (x.instituicao ? ' · ' + x.instituicao : '') });
    }), state.params);
    var porId = {}; state.rendaFixa.forEach(function(x){ porId[x.id] = x; });
    box.innerHTML = '<p class="note">' + fmt(valor) + ' por ' + qtdFmt(dias) + ' dias corridos (~' + qtdFmt(Engine.diasUteis(dias)) + ' úteis) · IR ' + String(Engine.irAliquotaBps(dias) / 100).replace('.', ',') + '%' + (Engine.iofPct(dias) ? ' · IOF ' + Engine.iofPct(dias) + '% do rendimento' : '') + '</p>' +
      lista.map(function(r){
        var x = porId[r.id] || {}, desc = [];
        if (r.iof) desc.push('IOF ' + fmt(r.iof));
        if (r.custodia) desc.push('custódia ' + fmt(r.custodia));
        if (r.ir) desc.push('IR ' + fmt(r.ir));
        if (r.isento) desc.push('isento de IR');
        return '<div class="card" style="margin-bottom:10px"><div class="row" style="padding:0;border:0;align-items:flex-start">' +
          '<div style="min-width:0"><div class="row-title" style="white-space:normal">' + escapeHtml(r.nome) + '</div><div class="row-meta">' + Engine.TIPOS_RF[x.tipo] + ' · ' + taxaRF(x) + '</div></div>' +
          '<div class="row-amt">' + fmt(r.liquido) + '<small>líquido</small></div></div>' +
          '<div class="row-meta" style="margin-top:8px">bruto ' + fmt(r.bruto) + (desc.length ? ' · ' + desc.join(' · ') : '') + '</div>' +
          '<div class="row-meta">ganho líquido <b class="' + signCls(r.ganhoLiquido) + '">' + signed(r.ganhoLiquido) + '</b> · ' + Engine.fmtPct(r.rentLiqPct) + ' no período · ' + Engine.fmtPct(r.rentLiqAA) + ' a.a.' +
          (r.pctCDILiquido !== null ? ' · ' + Engine.fmtPct(r.pctCDILiquido, 1) + ' do CDI líquido' : '') + '</div></div>';
      }).join('') + nota;
  }

  // ---------- imposto de renda ----------
  function renderIR(){
    document.getElementById('prejComum').value = state.prejuizoInicial.comum ? Engine.centsToInput(state.prejuizoInicial.comum) : '';
    document.getElementById('prejFii').value = state.prejuizoInicial.fii ? Engine.centsToInput(state.prejuizoInicial.fii) : '';
    var meses = Engine.apuracaoIR(state).reverse();
    document.getElementById('irMeses').innerHTML = meses.length ? meses.map(function(m){
      var line = function(label, v, cls){ return '<div class="r"><span>' + label + '</span><span class="num ' + (cls === undefined ? signCls(v) : cls) + '">' + (cls === '' ? fmt(v) : signed(v)) + '</span></div>'; };
      var rows = '';
      rows += '<div class="r"><span>Vendas de ações no mês</span><span class="num">' + fmt(m.vendasAcoes) + (m.isentoAcoes && m.vendasAcoes ? ' <span class="badge badge-pos">isento</span>' : '') + '</span></div>';
      if (m.resultado.acao) rows += line('Resultado em ações' + (m.ganhoIsento ? ' (isento)' : ''), m.resultado.acao);
      if (m.resultado.etf) rows += line('Resultado em ETFs', m.resultado.etf);
      if (m.resultado.bdr) rows += line('Resultado em BDRs', m.resultado.bdr);
      if (m.resultado.fii) rows += line('Resultado em FIIs', m.resultado.fii);
      if (m.prejComumAntes || m.prejComumDepois) rows += line('Prejuízo a compensar (ações/ETF/BDR) depois do mês', m.prejComumDepois, '');
      if (m.prejFiiAntes || m.prejFiiDepois) rows += line('Prejuízo a compensar (FII) depois do mês', m.prejFiiDepois, '');
      if (m.baseComum) rows += line('Base tributável 15%', m.baseComum, '');
      if (m.baseFii) rows += line('Base tributável 20% (FII)', m.baseFii, '');
      rows += line('Imposto do mês', m.impostoMes, '');
      if (m.acumuladoAnterior) rows += line('Saldo abaixo de R$ 10 de meses anteriores', m.acumuladoAnterior, '');
      var status = m.darf ? '<span class="badge badge-neg">DARF ' + fmt(m.darf) + ' · vence ' + dateBR(m.vencimento) + '</span>'
        : m.acumuladoProximo ? '<span class="badge badge-warn">' + fmt(m.acumuladoProximo) + ' acumula para o próximo mês</span>' : '<span class="badge badge-pos">nada a pagar</span>';
      return '<div class="ir-month"><div class="ir-head"><b>' + Engine.monthBR(m.mes) + '</b>' + status + '</div>' +
        (m.dayTrade ? '<p class="warn-txt">Este mês tem compra e venda do mesmo ativo no mesmo dia (day trade, 20%). O app não separa day trade: confira com um contador.</p>' : '') +
        '<div class="card kv total">' + rows + '</div></div>';
    }).join('') : empty('Nenhuma venda anotada na aba Ações.');

    var ic = Engine.apuracaoCripto(state, seriesCache);
    document.getElementById('irCriptoMeses').innerHTML = ic.meses.length ? ic.meses.slice().reverse().map(function(m){
      var line = function(label, v){ return '<div class="r"><span>' + label + '</span><span class="num">' + fmt(v) + '</span></div>'; };
      var rows = '<div class="r"><span>Vendas no mês (todas as moedas)</span><span class="num">' + fmt(m.vendas) + (m.isento ? ' <span class="badge badge-pos">isento</span>' : '') + '</span></div>' +
        line('Lucros nas vendas', m.ganhos) + (m.perdas ? line('Prejuízos (não abatem)', m.perdas) : '') + line('Imposto do mês', m.imposto) +
        (m.acumuladoAnterior ? line('Saldo abaixo de R$ 10 de meses anteriores', m.acumuladoAnterior) : '');
      var status = m.darf ? '<span class="badge badge-neg">DARF 4600 ' + fmt(m.darf) + ' · vence ' + dateBR(m.vencimento) + '</span>'
        : m.acumuladoProximo ? '<span class="badge badge-warn">' + fmt(m.acumuladoProximo) + ' acumula para o próximo mês</span>' : '<span class="badge badge-pos">nada a pagar</span>';
      return '<div class="ir-month"><div class="ir-head"><b>' + Engine.monthBR(m.mes) + '</b>' + status + '</div><div class="card kv">' + rows + '</div></div>';
    }).join('') : empty('Nenhuma venda de cripto em exchange no Brasil.');
    document.getElementById('irCriptoAnos').innerHTML = ic.anosExterior.length ? ic.anosExterior.slice().reverse().map(function(a){
      var rows = '<div class="r"><span>Vendas no ano</span><span class="num">' + fmt(a.vendas) + '</span></div>' +
        '<div class="r"><span>Resultado das vendas</span><span class="num ' + signCls(a.resultado) + '">' + signed(a.resultado) + '</span></div>' +
        (a.prejAntes ? '<div class="r"><span>Prejuízo de anos anteriores abatido</span><span class="num">' + fmt(Math.min(a.prejAntes, Math.max(0, a.resultado))) + '</span></div>' : '') +
        (a.prejDepois ? '<div class="r"><span>Prejuízo que passa para o ano seguinte</span><span class="num">' + fmt(a.prejDepois) + '</span></div>' : '') +
        '<div class="r"><span>Imposto (15%, na declaração de ' + (Number(a.ano) + 1) + ')</span><span class="num">' + fmt(a.imposto) + '</span></div>';
      return '<div class="ir-month"><div class="ir-head"><b>' + a.ano + '</b>' + (a.imposto ? '<span class="badge badge-warn">' + fmt(a.imposto) + ' na declaração</span>' : '<span class="badge badge-pos">nada a pagar</span>') + '</div><div class="card kv">' + rows + '</div></div>';
    }).join('') : empty('Nenhuma venda de cripto em exchange no exterior.');
  }

  function renderAll(){
    var c = Engine.carteira(state, { series: seriesCache, hoje: hoje() });
    // Foto do dia para o acompanhamento (só depois de buscar as séries, para não gravar juros aproximados).
    if (seriesStatus !== 'buscando' && Engine.registrarHistorico(state, hoje(), c)) save();
    renderSummary(c);
    renderCarteira(c);
    renderOperacoes();
    renderProventos();
    renderRF(c);
    renderCripto(c);
    renderOutros();
    renderMetas(c);
    renderPlanejamento();
    renderAcompanhamento();
    renderRelatorio();
    renderSimulador();
    renderIR();
  }
  function commit(){ save(); renderAll(); }

  // ---------- menu ⋮ ----------
  var clickById = function(id){ return function(){ document.getElementById(id).click(); }; };
  FinancSettings.addSection({ title: 'Mais', rows: [
    { icon: 'trending-up', label: 'Proventos', description: 'Dividendos, JCP e rendimentos de FII que recebi', onClick: function(){ openScreen('proventos'); } },
    { icon: 'file-text', label: 'Imposto de renda', description: 'IR das vendas de ações e DARF', onClick: function(){ openScreen('ir'); } },
    { icon: 'calculator', label: 'Calculadora de renda fixa', description: 'Só uma conta: compara rendimentos', onClick: function(){ openScreen('simulador'); } },
  ] });
  FinancSettings.addSection({ title: 'Dados e backup', rows: [
    { icon: 'download', label: 'Exportar backup (JSON)', description: 'Protegido pelas suas 12 palavras: abre em qualquer aparelho com elas.', onClick: clickById('btnExport') },
    { icon: 'upload', label: 'Importar backup (JSON)', description: 'Restaura um backup exportado.', onClick: clickById('btnImport') },
    { icon: 'shield', label: 'Exportar certificado', description: 'Sai das 12 palavras; pede só o PIN.', onClick: clickById('btnExportCert') },
    { icon: 'shield-check', label: 'Importar certificado', description: 'Usa o certificado de outro aparelho.', onClick: clickById('btnImportCert') },
    { icon: 'trash', label: 'Limpar tudo', description: 'Apaga tudo o que foi anotado neste app.', danger: true, onClick: clickById('btnReset') },
  ] });

  // ---------- telas do menu ⋮ (proventos, IR, calculadora) ----------
  // Entram no histórico para o "voltar" do celular fechar a tela em vez de sair do app.
  function openScreen(nome){
    document.querySelectorAll('section.panel').forEach(function(p){ p.classList.remove('active'); });
    document.getElementById('panel-' + nome).classList.add('active');
    var jaAberta = document.body.classList.contains('report-mode');
    document.body.classList.add('report-mode');
    if (!jaAberta) history.pushState({invScreen: true}, ''); else history.replaceState({invScreen: true}, '');
    window.scrollTo({ top: 0, behavior: 'instant' });
    setTimeout(function(){ var h = document.querySelector('#panel-' + nome + ' h2'); if (h) h.focus({preventScroll: true}); }, 0);
    if (nome === 'simulador' && Engine.precisaBuscarIndices(state.params, hoje())) buscarIndices(false);
  }
  function closeScreen(){
    if (!document.body.classList.contains('report-mode')) return;
    document.body.classList.remove('report-mode');
    irPara(secaoAtual);
    document.getElementById('btnSecoes').focus({preventScroll: true});
  }

  // ---------- forms ----------
  function readCents(id){ var c = Engine.parseCents(document.getElementById(id).value); return c === null ? null : c; }
  /** Ao digitar um ativo já lançado, a classe acompanha o cadastro existente. */
  function syncClasse(){
    var t = Engine.normTicker(document.getElementById('oTicker').value);
    var o = t && state.operacoes.find(function(x){ return x.ticker === t; });
    if (o) document.getElementById('oClasse').value = o.classe;
    else if (/11$/.test(t) && document.getElementById('oClasse').value === 'acao') document.getElementById('oClasse').value = 'fii';
    else if (/3[2-5]$/.test(t)) document.getElementById('oClasse').value = 'bdr';
  }
  function readParams(){
    var num = function(id, def){ var v = Number(String(document.getElementById(id).value).replace(',', '.')); return document.getElementById(id).value === '' || !Number.isFinite(v) ? def : v; };
    var p = state.params;
    var mudouIndice = num('parCdi', p.cdi) !== p.cdi || num('parSelic', p.selic) !== p.selic || num('parIpca', p.ipca) !== p.ipca || num('parTr', p.tr) !== p.tr;
    state.params = Engine.normalizeState({ params: { cdi: num('parCdi', p.cdi), selic: num('parSelic', p.selic), ipca: num('parIpca', p.ipca), tr: num('parTr', p.tr), custodia: num('parCustodia', p.custodia),
      atualizadoEm: hoje(), fonte: mudouIndice ? 'manual' : p.fonte, bcbEm: p.bcbEm, refs: mudouIndice ? {} : p.refs } }).params;
  }

  // ---------- Dicionário de Eventos UI ----------
  var paramsTimer = null;
  var UiEvents = {
    btnSecoes_click: function(){ abrirSecoes(); },
    menuSecoes_click: escolherSecao,
    btnAvisoFechar_click: function(){ document.getElementById('avisoTopo').hidden = true; setPref('avisoFechado', true); },
    screenBack_click: function(){ if (history.state && history.state.invScreen) history.back(); else closeScreen(); },
    window_popstate: closeScreen,
    oTicker_input: syncClasse,
    btnAtualizar_click: async function(){
      var btn = document.getElementById('btnAtualizar'), st = document.getElementById('atualizarStatus');
      if (!navigator.onLine) { st.textContent = 'Sem internet: os valores continuam os da última atualização.'; return; }
      btn.disabled = true; st.textContent = 'atualizando…';
      // Se a atualização automática da abertura ainda estiver rodando, espera ela terminar (até 20 s) e busca de novo.
      for (var w = 0; w < 40 && seriesStatus === 'buscando'; w++) await new Promise(function(r){ setTimeout(r, 500); });
      var res = [await atualizarSeries(true)];
      btn.disabled = false;
      var falhas = [];
      if (res[0] === 'erro') falhas.push('juros e dólar (Banco Central)');
      var hora = new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
      st.textContent = (falhas.length ? 'Não foi possível atualizar: ' + falhas.join(' e ') + '. Tente de novo em instantes.' : 'Atualizado às ' + hora + '.') +
        (state.operacoes.length ? ' Rentabilidade das ações: informe na seção Ações.' : '');
    },
    formCripto_submit: async function(e){
      e.preventDefault();
      var atual = readCents('cAtual');
      var r = Engine.addCripto(state, { moeda: document.getElementById('cMoeda').value, nome: document.getElementById('cNome').value, moedaValor: document.getElementById('cMoedaValor').value,
        valorAplicado: readCents('cValor'), valorAtual: atual === null ? '' : atual, aplicadoEm: document.getElementById('cData').value,
        onde: document.getElementById('cOnde').value, custodia: document.getElementById('cCustodia').value, hoje: hoje() });
      if (!r.ok) { await showMessage('Não anotado', r.erro); return; }
      var keep = ['cOnde', 'cMoeda', 'cCustodia', 'cMoedaValor'].map(function(id){ return document.getElementById(id).value; });
      document.getElementById('formCripto').reset(); document.getElementById('cData').value = hoje();
      ['cOnde', 'cMoeda', 'cCustodia', 'cMoedaValor'].forEach(function(id, i){ document.getElementById(id).value = keep[i]; });
      syncCriptoNome();
      commit(); if (r.item.moedaValor === 'USD') atualizarSeries();
    },
    cMoeda_change: syncCriptoNome,
    acompPeriodo_click: function(e){
      var b = e.target.closest('button[data-p]'); if (!b) return;
      acompPeriodo = b.dataset.p;
      document.querySelectorAll('#acompPeriodo button').forEach(function(x){ x.setAttribute('aria-pressed', String(x === b)); });
      renderAcompanhamento();
    },
    relTipo_click: function(e){
      var b = e.target.closest('button[data-t]'); if (!b) return;
      relTipo = b.dataset.t;
      document.querySelectorAll('#relTipo button').forEach(function(x){ x.setAttribute('aria-pressed', String(x === b)); });
      renderRelatorio();
    },
    relPeriodo_input: renderRelatorio,
    mTipo_change: syncMetaForm,
    formMeta_submit: async function(e){
      e.preventDefault();
      var r = Engine.addMeta(state, { tipo: document.getElementById('mTipo').value, nome: document.getElementById('mNome').value, valor: readCents('mValor'),
        prazo: document.getElementById('mPrazo').value, hoje: hoje() });
      if (!r.ok) { await showMessage('Meta não criada', r.erro); return; }
      var tipo = document.getElementById('mTipo').value;
      document.getElementById('formMeta').reset(); document.getElementById('mTipo').value = tipo; syncMetaForm();
      commit();
      if (r.meta.tipo === 'objetivo') { var v = await escolherInvestimentos(r.meta, Engine.carteira(state, { series: seriesCache, hoje: hoje() })); if (v) { Engine.setVinculosMeta(state, r.meta.id, v); commit(); } }
    },
    listMetas_click: async function(e){
      var b = e.target.closest('button[data-meta]'); if (!b) return;
      var m = state.metas.find(function(x){ return x.id === b.dataset.meta; }); if (!m) return;
      if (b.dataset.acao === 'del') {
        if (!await askConfirm({ title: 'Excluir a meta "' + m.nome + '"?', text: 'Seus investimentos não mudam.', action: 'Excluir', danger: true })) return;
        Engine.removeMeta(state, m.id);
      } else {
        var v = await escolherInvestimentos(m, Engine.carteira(state, { series: seriesCache, hoje: hoje() })); if (!v) return;
        Engine.setVinculosMeta(state, m.id, v);
      }
      commit();
    },
    planAno_input: renderPlanejamento,
    window_resize: function(){ clearTimeout(resizeTimer); resizeTimer = setTimeout(renderAcompanhamento, 200); },
    planMeses_change: function(e){
      var inp = e.target.closest('input[data-plan]'); if (!inp) return;
      var c = inp.value === '' ? 0 : Engine.parseCents(inp.value);
      if (c === null || c < 0) { inp.setCustomValidity('Valor inválido'); inp.reportValidity(); return; }
      Engine.setPlano(state, String(document.getElementById('planAno').value), inp.dataset.plan, c);
      commit();
    },
    btnPlanMeta_click: async function(){
      var meta = state.metas.find(function(m){ return m.tipo === 'aporte'; });
      if (!meta) { await showMessage('Sem meta de aporte', 'Crie uma meta do tipo "Aporte mensal" em Metas para preencher o planejamento com ela.', false); return; }
      var ano = String(document.getElementById('planAno').value);
      if (!await askConfirm({ title: 'Preencher ' + ano + ' com ' + fmt(meta.valor) + ' por mês?', text: 'Os valores planejados dos 12 meses serão trocados.', action: 'Preencher' })) return;
      for (var i = 1; i <= 12; i++) Engine.setPlano(state, ano, (i < 10 ? '0' : '') + i, meta.valor);
      commit();
    },
    formOutro_submit: async function(e){
      e.preventDefault();
      var atual = readCents('xAtual');
      var r = Engine.addOutro(state, { categoria: document.getElementById('xCat').value, nome: document.getElementById('xNome').value, instituicao: document.getElementById('xInst').value,
        valorAplicado: readCents('xValor'), aplicadoEm: document.getElementById('xData').value, valorAtual: atual === null ? '' : atual, hoje: hoje() });
      if (!r.ok) { await showMessage('Não anotado', r.erro); return; }
      document.getElementById('formOutro').reset(); document.getElementById('xData').value = hoje();
      commit();
    },
    formOperacao_submit: async function(e){
      e.preventDefault();
      var r = Engine.addOperacao(state, { tipo: document.getElementById('oTipo').value, ticker: document.getElementById('oTicker').value, classe: document.getElementById('oClasse').value,
        data: document.getElementById('oData').value, qtd: document.getElementById('oQtd').value, preco: readCents('oPreco'), taxas: readCents('oTaxas') || 0,
        instituicao: document.getElementById('oInst').value, hoje: hoje() });
      if (!r.ok) { await showMessage('Operação não lançada', r.erro); return; }
      var data = document.getElementById('oData').value, inst = document.getElementById('oInst').value;
      document.getElementById('formOperacao').reset();
      document.getElementById('oData').value = data; document.getElementById('oInst').value = inst;
      commit();
    },
    formProvento_submit: async function(e){
      e.preventDefault();
      var r = Engine.addProvento(state, { ticker: document.getElementById('pTicker').value, tipo: document.getElementById('pTipo').value, data: document.getElementById('pData').value, valor: readCents('pValor') });
      if (!r.ok) { await showMessage('Provento não lançado', r.erro); return; }
      var tipo = document.getElementById('pTipo').value;
      document.getElementById('formProvento').reset(); document.getElementById('pData').value = hoje(); document.getElementById('pTipo').value = tipo;
      commit();
    },
    formRF_submit: async function(e){
      e.preventDefault();
      var r = Engine.addRendaFixa(state, { nome: document.getElementById('rfNome').value, instituicao: document.getElementById('rfInst').value, tipo: document.getElementById('rfTipo').value,
        indexador: document.getElementById('rfIndexador').value, taxaNum: Number(String(document.getElementById('rfTaxaNum').value).replace(',', '.')),
        valorAplicado: readCents('rfValor'), aplicadoEm: document.getElementById('rfData').value, vencimento: document.getElementById('rfVenc').value, hoje: hoje() });
      if (!r.ok) { await showMessage('Aplicação não cadastrada', r.erro); return; }
      document.getElementById('formRF').reset(); document.getElementById('rfData').value = hoje(); syncRFTaxa();
      commit(); atualizarSeries();
    },
    rfIndexador_change: syncRFTaxa,
    rfTipo_change: syncRFTipo,
    formSim_input: renderSimulador,
    formParams_input: function(){
      clearTimeout(paramsTimer);
      paramsTimer = setTimeout(function(){ readParams(); save(); renderSimulador(); renderParamsHint(); document.getElementById('bcbStatus').textContent = ''; }, 400);
    },
    btnBcb_click: function(){ buscarIndices(true); },
    formPrejuizo_submit: function(e){
      e.preventDefault();
      var c = readCents('prejComum'), f = readCents('prejFii');
      state.prejuizoInicial = { comum: c > 0 && c <= Engine.MAX_CENTS ? c : 0, fii: f > 0 && f <= Engine.MAX_CENTS ? f : 0 };
      commit();
    },
    wrap_click: async function(e){
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var row = btn.closest('.row');
      if (!row) return;
      var id = row.dataset.id, action = btn.dataset.action, r;
      if (action === 'set-quote') {
        var atual = state.cotacoes[id];
        var q = await askValue({ title: 'Cotação de ' + id, text: 'Preço atual de uma unidade. Fica só neste aparelho.', label: 'Cotação (R$)', dateLabel: 'Data da cotação', valor: atual ? atual.preco : 0, icon: 'trending-up' });
        if (!q) return;
        r = Engine.setCotacao(state, id, q.valor, q.data);
      } else if (action === 'del-op') {
        if (!await askConfirm({ title: 'Excluir esta operação?', text: 'O preço médio e a apuração de IR serão recalculados.', action: 'Excluir', danger: true })) return;
        r = Engine.removeOperacao(state, id);
      } else if (action === 'del-prov') {
        if (!await askConfirm({ title: 'Excluir este provento?', text: 'Esta ação não pode ser desfeita.', action: 'Excluir', danger: true })) return;
        r = Engine.removeProvento(state, id);
      } else if (action === 'upd-rf') {
        var it = state.rendaFixa.find(function(x){ return x.id === id; });
        if (!it) return;
        var u = await askValue({ title: 'Atualizar ' + it.nome, text: 'Saldo bruto mostrado pelo banco ou corretora.', label: 'Valor atual (R$)', dateLabel: 'Data do saldo', valor: it.valorAtual, icon: 'refresh' });
        if (!u) return;
        r = Engine.atualizarRendaFixa(state, id, u.valor, u.data);
      } else if (action === 'resg-rf') {
        var rs = state.rendaFixa.find(function(x){ return x.id === id; });
        if (!rs) return;
        var v = await askValue({ title: 'Resgatar ' + rs.nome, text: 'Valor líquido que caiu na conta (já sem IR e IOF).', label: 'Valor recebido (R$)', dateLabel: 'Data do resgate', valor: rs.valorAtual, action: 'Resgatar', icon: 'download' });
        if (!v) return;
        r = Engine.resgatarRendaFixa(state, id, v.valor, v.data);
      } else if (action === 'del-cripto') {
        if (!await askConfirm({ title: 'Excluir esta anotação?', text: 'As vendas dela também saem do imposto de renda. Esta ação não pode ser desfeita.', action: 'Excluir', danger: true })) return;
        r = Engine.removeCripto(state, id);
      } else if (action === 'upd-cripto') {
        var cx = state.cripto.find(function(x){ return x.id === id; }); if (!cx) return;
        var cu = await askForm({ title: 'Valor de hoje: ' + cx.nome, text: 'O que a exchange mostra agora, em ' + (cx.moedaValor === 'USD' ? 'dólares' : 'reais') + '.', icon: 'refresh',
          fields: [{ name: 'valor', label: 'Valor hoje (' + simbolo(cx.moedaValor).trim() + ')', type: 'money', value: cx.valorAtual }, { name: 'data', label: 'Data', type: 'date' }] });
        if (!cu) return;
        r = Engine.atualizarCripto(state, id, cu.valor, cu.data);
      } else if (action === 'vender-cripto') {
        var vx = state.cripto.find(function(x){ return x.id === id; }); if (!vx) return;
        var vv = await askForm({ title: 'Vendi ' + vx.nome, text: 'Quanto recebeu e quanto ainda ficou na exchange (0 se vendeu tudo), em ' + (vx.moedaValor === 'USD' ? 'dólares' : 'reais') + '.', icon: 'download', action: 'Anotar venda',
          fields: [{ name: 'recebido', label: 'Recebi (' + simbolo(vx.moedaValor).trim() + ')', type: 'money', min: '0.01' }, { name: 'restante', label: 'Ficou na exchange (' + simbolo(vx.moedaValor).trim() + ')', type: 'money', value: 0 },
            { name: 'data', label: 'Data da venda', type: 'date', min: vx.aplicadoEm }],
          note: 'A parte vendida baixa o custo na mesma proporção. Vender por outra cripto ou stablecoin também conta como venda.' });
        if (!vv) return;
        r = Engine.venderCripto(state, id, vv.recebido, vv.restante || 0, vv.data);
      } else if (action === 'juros-rf') {
        var jx = state.rendaFixa.find(function(x){ return x.id === id; }); if (!jx) return;
        var est = Engine.estimarRF(jx, seriesCache, hoje(), state.params);
        var jj = await askForm({ title: 'Juros de hoje: ' + jx.nome, text: 'Quanto de juros o banco mostra (valor bruto − valor aplicado de ' + fmt(jx.valorAplicado) + ').', icon: 'percent',
          fields: [{ name: 'juros', label: 'Juros (R$)', type: 'money', neg: true, value: est.juros }, { name: 'data', label: 'Data', type: 'date', min: jx.aplicadoEm }],
          note: jx.indexador === 'manual' ? 'Vira o saldo desta aplicação.' : 'A partir desta data o app continua calculando pela taxa (' + taxaRF(jx) + '). Para voltar ao cálculo só pelo Banco Central, use "cálculo automático".' });
        if (!jj || jj.juros === null) return;
        r = Engine.informarJurosRF(state, id, jj.juros, jj.data, hoje());
      } else if (action === 'auto-rf') {
        if (!await askConfirm({ title: 'Voltar ao cálculo automático?', text: 'Os juros que você informou deixam de valer e o app calcula de novo desde a aplicação.', action: 'Voltar' })) return;
        r = Engine.limparJurosRF(state, id);
      } else if (action === 'rent-ativo') {
        var ra = Engine.carteira(state, { series: seriesCache, hoje: hoje() }).ativos.find(function(a){ return a.ticker === id; }); if (!ra) return;
        var rr = await askForm({ title: 'Rentabilidade de ' + id, text: 'Como a corretora mostra. Preencha em R$ ou em % (sobre o custo de ' + fmt(ra.custo) + ').', icon: 'trending-up',
          fields: [{ name: 'ganho', label: 'Rentabilidade (R$)', type: 'money', neg: true, optional: true, value: ra.rentInformada ? ra.rentInformada.ganho : '' },
            { name: 'pct', label: 'ou rentabilidade (%)', type: 'number', neg: true, optional: true, step: '0.01', placeholder: 'ex: 12,5' }, { name: 'data', label: 'Data', type: 'date' }] });
        if (!rr) return;
        if (rr.ganho === null && rr.pct === null) { await showMessage('Nada informado', 'Preencha a rentabilidade em R$ ou em %.'); return; }
        r = Engine.setRentabilidadeAtivo(state, id, rr.ganho !== null ? { ganho: rr.ganho, data: rr.data } : { pct: rr.pct, data: rr.data });
      } else if (action === 'upd-outro') {
        var ou = state.outros.find(function(x){ return x.id === id; });
        if (!ou) return;
        var uo = await askValue({ title: 'Atualizar ' + ou.nome, text: 'Valor que o banco mostra hoje.', label: 'Valor atual (R$)', dateLabel: 'Data', valor: ou.valorAtual, icon: 'refresh' });
        if (!uo) return;
        r = Engine.atualizarOutro(state, id, uo.valor, uo.data);
      } else if (action === 'resg-outro') {
        var orr = state.outros.find(function(x){ return x.id === id; });
        if (!orr) return;
        var vo = await askValue({ title: 'Resgatei ' + orr.nome, text: 'Valor que caiu na conta.', label: 'Valor recebido (R$)', dateLabel: 'Data do resgate', valor: orr.valorAtual, action: 'Anotar resgate', icon: 'download' });
        if (!vo) return;
        r = Engine.resgatarOutro(state, id, vo.valor, vo.data);
      } else if (action === 'del-outro') {
        if (!await askConfirm({ title: 'Excluir esta anotação?', text: 'Esta ação não pode ser desfeita.', action: 'Excluir', danger: true })) return;
        r = Engine.removeOutro(state, id);
      } else if (action === 'del-rf') {
        if (!await askConfirm({ title: 'Excluir esta aplicação?', text: 'Esta ação não pode ser desfeita.', action: 'Excluir', danger: true })) return;
        r = Engine.removeRendaFixa(state, id);
      } else return;
      if (r && !r.ok) { await showMessage('Não foi possível concluir', r.erro); return; }
      commit();
    },
    btnExport_click: async function(){
      try { await window.exportProtected(state, 'invest-sim:backup', 'investimentos-' + hoje() + '.secure.json'); }
      catch (_) { showMessage('Exportação falhou', 'Não foi possível exportar o backup protegido.'); }
    },
    btnImport_click: function(){ document.getElementById('importFile').click(); },
    importFile_change: function(e){
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = async function(ev){
        try {
          var payload = JSON.parse(ev.target.result);
          var data = await window.importProtected(payload, 'invest-sim:backup');
          if (data === null) return;
          if (!await askConfirm({ title: 'Substituir todos os dados?', text: 'Importar este arquivo vai substituir todos os dados atuais.', action: 'Importar', danger: true })) return;
          state = Engine.normalizeState(data); commit();
          document.getElementById('saveStatus').textContent = 'backup importado e salvo criptografado';
        } catch (err) { showMessage('Backup inválido', (err && err.message) || 'Backup inválido.'); }
      };
      reader.readAsText(file); e.target.value = '';
    },
    btnRecover_click: window.lockVault,
    btnBiometric_click: () => window.vaultSettings(),
    btnReset_click: async function(){
      if (await askConfirm({ title: 'Apagar tudo?', text: 'Isso vai apagar TODAS as operações, proventos e aplicações deste navegador. Tem certeza?', action: 'Apagar tudo', danger: true })) {
        state = Engine.freshState(); commit(); fillParams();
      }
    },
    btnExportCert_click: async function(){
      try { await FinancCert.export(); } catch (err) { showMessage('Exportação falhou', (err && err.message) || 'Não foi possível exportar o certificado protegido.'); }
    },
    btnImportCert_click: function(){ document.getElementById('importCertFile').click(); },
    importCertFile_change: function(e){
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = async function(ev){
        try {
          var payload = JSON.parse(ev.target.result);
          if (!await askConfirm({ title: 'Importar certificado?', text: 'Ele passa a ser o certificado de todos os apps; o atual continua guardado para os backups antigos.', action: 'Importar' })) return;
          await FinancCert.importFile(payload);
          await showMessage('Certificado importado', 'Recarregue o aplicativo antes de abrir o backup.', false);
        } catch (err) { showMessage('Certificado inválido', 'Arquivo de certificado inválido.'); }
      };
      reader.readAsText(file); e.target.value = '';
    },
    document_visibilitychange: function(){
      if (document.visibilityState !== 'visible' || document.body.classList.contains('locked')) return;
      document.getElementById('dataHoje').textContent = new Date().toLocaleDateString('pt-BR', {day:'2-digit', month:'long', year:'numeric'});
      renderAll(); atualizarSeries();
    }
  };

  function bindEvents(){
    document.getElementById('btnSecoes').addEventListener('click', UiEvents.btnSecoes_click);
    document.getElementById('menuSecoes').addEventListener('click', UiEvents.menuSecoes_click);
    document.getElementById('btnAvisoFechar').addEventListener('click', UiEvents.btnAvisoFechar_click);
    document.querySelectorAll('[data-back]').forEach(function(b){ b.addEventListener('click', UiEvents.screenBack_click); });
    document.getElementById('btnAtualizar').addEventListener('click', UiEvents.btnAtualizar_click);
    document.getElementById('formCripto').addEventListener('submit', UiEvents.formCripto_submit);
    document.getElementById('cMoeda').addEventListener('change', UiEvents.cMoeda_change);
    document.getElementById('acompPeriodo').addEventListener('click', UiEvents.acompPeriodo_click);
    document.getElementById('relTipo').addEventListener('click', UiEvents.relTipo_click);
    document.getElementById('relMes').addEventListener('input', UiEvents.relPeriodo_input);
    document.getElementById('relAno').addEventListener('input', UiEvents.relPeriodo_input);
    document.getElementById('mTipo').addEventListener('change', UiEvents.mTipo_change);
    document.getElementById('formMeta').addEventListener('submit', UiEvents.formMeta_submit);
    document.getElementById('listMetas').addEventListener('click', UiEvents.listMetas_click);
    document.getElementById('planAno').addEventListener('input', UiEvents.planAno_input);
    document.getElementById('planMeses').addEventListener('change', UiEvents.planMeses_change);
    document.getElementById('btnPlanMeta').addEventListener('click', UiEvents.btnPlanMeta_click);
    window.addEventListener('resize', UiEvents.window_resize);
    document.getElementById('formOutro').addEventListener('submit', UiEvents.formOutro_submit);
    window.addEventListener('popstate', UiEvents.window_popstate);
    document.getElementById('oTicker').addEventListener('input', UiEvents.oTicker_input);
    document.getElementById('formOperacao').addEventListener('submit', UiEvents.formOperacao_submit);
    document.getElementById('formProvento').addEventListener('submit', UiEvents.formProvento_submit);
    document.getElementById('formRF').addEventListener('submit', UiEvents.formRF_submit);
    document.getElementById('rfIndexador').addEventListener('change', UiEvents.rfIndexador_change);
    document.getElementById('rfTipo').addEventListener('change', UiEvents.rfTipo_change);
    document.getElementById('formSim').addEventListener('input', UiEvents.formSim_input);
    document.getElementById('formParams').addEventListener('input', UiEvents.formParams_input);
    document.getElementById('btnBcb').addEventListener('click', UiEvents.btnBcb_click);
    document.getElementById('formPrejuizo').addEventListener('submit', UiEvents.formPrejuizo_submit);
    document.querySelector('.page').addEventListener('click', UiEvents.wrap_click);
    document.getElementById('btnExport').addEventListener('click', UiEvents.btnExport_click);
    document.getElementById('btnImport').addEventListener('click', UiEvents.btnImport_click);
    document.getElementById('importFile').addEventListener('change', UiEvents.importFile_change);
    document.getElementById('btnRecover').addEventListener('click', UiEvents.btnRecover_click);
    document.getElementById('btnBiometric').addEventListener('click', UiEvents.btnBiometric_click);
    document.getElementById('btnReset').addEventListener('click', UiEvents.btnReset_click);
    document.getElementById('btnExportCert').addEventListener('click', UiEvents.btnExportCert_click);
    document.getElementById('btnImportCert').addEventListener('click', UiEvents.btnImportCert_click);
    document.getElementById('importCertFile').addEventListener('change', UiEvents.importCertFile_change);
    document.addEventListener('visibilitychange', UiEvents.document_visibilitychange);
  }

  // ---------- init ----------
  bindEvents();
  document.getElementById('dataHoje').textContent = new Date().toLocaleDateString('pt-BR', {day:'2-digit', month:'long', year:'numeric'});
  ['oData','pData','rfData','cData','xData'].forEach(function(id){ var el = document.getElementById(id); el.value = hoje(); el.max = hoje(); });
  fillMoedas(); syncCriptoNome(); syncMetaForm();
  document.getElementById('planAno').value = hoje().slice(0, 4);
  document.getElementById('relMes').value = hoje().slice(0, 7);
  document.getElementById('relAno').value = hoje().slice(0, 4);
  await load();
  loadSeries();
  syncRFTaxa();
  fillParams();
  renderAll();
  mostrarAviso();
  atualizarSeries();
})().catch(() => window.lockVault());
