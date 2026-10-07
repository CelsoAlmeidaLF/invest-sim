# Investimentos

Registro pessoal dos investimentos que você já tem em bancos e corretoras. **O app só anota**: não compra, não vende,
não movimenta dinheiro e não recomenda produtos. Página estática (GitHub Pages); os dados ficam só no aparelho,
criptografados com o cofre local e o PIN FINANC.

## Telas

Navegação pelo botão **Seções** (as abas ficam ocultas). O aviso "o app só anota" some sozinho e pode ser fechado de vez.

- **Carteira**: patrimônio atual, quanto apliquei, ganho, juros da renda fixa; por tipo e por banco/corretora.
- **Renda fixa**: banco, tipo, rentabilidade (% do CDI, prefixado, IPCA+, Selic+ ou saldo informado), valor, datas.
  Juros calculados com as séries oficiais do Banco Central; **"informar juros"** corrige pelo valor do banco e a conta
  segue rendendo pela taxa a partir dali ("cálculo automático" desfaz); resgate.
- **Ações**: compras e vendas de ações, FIIs, ETFs e BDRs com corretora; **rentabilidade informada** (R$ ou %, como a
  corretora mostra) ou cotação; rentabilidade com vendas e proventos.
- **Cripto**: só valores — quanto apliquei e quanto vale hoje, em R$ ou US$ (dólar PTAX do Banco Central); venda total
  ou parcial informando quanto recebeu e quanto ficou; IR das vendas.
- **Outros**: previdência, fundos, poupança/conta e livre, com valor atual informado.
- **Acompanhamento**: foto diária do patrimônio (guardada quando o app abre); visão diária, mensal e anual com gráfico
  patrimônio x quanto apliquei e quanto rendeu em cada período (sem contar dinheiro novo).
- **Relatórios**: mensal e anual — patrimônio no início e no fim, aportes, resgates, proventos, IR e quanto rendeu.
- **Metas**: patrimônio (valor até uma data), objetivo com nome (soma dos investimentos ligados) e aporte mensal
  (12 meses cumpridos ou não). "Quanto por mês" = quanto falta ÷ meses, sem contar rendimento.
- **Planejamento**: aportes planejados x feitos em cada mês e no ano; pode preencher com a meta de aporte.
- **Proventos**, **Imposto de renda** e **Calculadora de renda fixa**: no menu Seções (grupo "Mais") e no menu ⋮.
- Backup criptografado, certificado FINANC, painel Apoiar · Avaliar · Sugerir, offline (service worker).

## Regras de cálculo (legislação vigente em out/2026; a MP 1.303/2025 caducou)

- **Dinheiro em centavos inteiros**; quantidades inteiras. Custo guardado como total; a venda baixa custo
  proporcional (`custo × qtd vendida ÷ qtd`, em BigInt) — o preço médio não acumula erro de arredondamento.
- **Taxas** entram no custo da compra e reduzem o valor da venda.
- **Eventos** valem a partir da data ex: no mesmo dia entram antes das operações. Desdobramento/grupamento mudam só a
  quantidade (frações descartadas); bonificação soma ações com o custo atribuído informado.
- **Ticker fracionário** (`PETR4F`) é o mesmo ativo de `PETR4`. Um ticker não pode mudar de classe.
- **IR renda variável (swing trade)**:
  - Ações: isenção se as vendas de ações do mês (valor bruto) forem ≤ R$ 20.000; prejuízo de mês isento continua compensável.
  - Ações, ETFs e BDRs: 15%, prejuízos compensáveis entre si. ETFs e BDRs não têm isenção.
  - FIIs: 20%, sem isenção; prejuízo só compensa com FII.
  - Prejuízo de antes do app pode ser informado na tela de IR.
  - DARF 6015 no último dia útil do mês seguinte (fins de semana, sem feriados); abaixo de R$ 10,00 acumula.
  - Não descontado: IRRF de 0,005% ("dedo-duro"). Day trade (20%) não é separado: o mês é sinalizado.
- **Simulador**: dias úteis ≈ dias corridos × 252/365. CDI diário = (1+CDI)^(1/252) − 1, multiplicado pelo % contratado.
  IR regressivo 22,5% (≤180 d), 20% (≤360), 17,5% (≤720), 15%. IOF regressivo nos primeiros 29 dias.
  Poupança: 0,5% a.m. + TR com Selic > 8,5% a.a., senão 70% da Selic + TR; só meses cheios.
  Custódia do Tesouro aproximada sobre o saldo final e deduzida da base do IR. LCI/LCA e poupança isentas.
  CDI, Selic, IPCA, TR e custódia são editáveis e ficam salvos no aparelho.
- **Juros da renda fixa**: SGS 12 (CDI diário), 11 (Selic diária) e 433 (IPCA mensal), buscadas desde a aplicação
  mais antiga (janelas de 10 anos), guardadas no cofre fora do backup e atualizadas uma vez por dia. % do CDI = produto de
  (1 + CDI do dia × %); prefixado e juro real usam como dias úteis os dias com CDI publicado; IPCA proporcional aos dias
  do mês; mês ainda não divulgado usa o IPCA esperado. IR/IOF como se resgatasse hoje; após o vencimento não rende.
  Sem as séries (offline), usa os índices do Simulador e marca "aproximado".
- Eventos societários (desdobramento etc.) saíram da tela; o motor ainda os aplica a dados antigos.
- **Cripto (só valor)**: custo e valor de hoje na moeda anotada; US$ → R$ pela PTAX venda (SGS 1) da data (custo na
  data da aplicação, valor de hoje pela última PTAX); sem PTAX no aparelho, R$ 5,50 marcado como aproximado. Venda
  parcial baixa custo × recebido ÷ (recebido + o que ficou). Nenhuma cotação externa de cripto (CoinGecko removida).
- **Rentabilidade da renda fixa** (por aplicação): bruta e sem IR no período, % ao ano (a partir de 30 dias) e % do
  CDI do mesmo período (produto dos CDIs diários; offline, CDI das hipóteses).
- **Rentabilidade das ações com proventos**: valorização do que ainda tenho + resultado das vendas + proventos, sobre
  tudo o que já foi comprado do ativo (com taxas).
- **IR de cripto** (mesmas regras do app Cripto): exchange no Brasil — mensal, isento com vendas até R$ 35 mil no mês,
  imposto progressivo 15/17,5/20/22,5% sobre a soma dos lucros (prejuízo do mês não abate), DARF 4600, abaixo de R$ 10
  acumula; exchange no exterior (Lei 14.754/2023) — 15% sobre o lucro do ano na declaração, prejuízo passa adiante.
  DARFs pendentes (ações e cripto) aparecem em alerta na Carteira.
- **Índices do Banco Central** (consulta pública, só GET, sem nenhum dado do usuário; CSP libera só esses dois domínios):
  CDI = SGS 4389, Selic efetiva = SGS 1178, TR = SGS 226 (mensal → anual composta), IPCA = mediana da expectativa
  para 12 meses do Boletim Focus. Busca automática uma vez por dia ao abrir o Simulador, exceto se o usuário editou os
  índices à mão (o botão "Buscar no Banco Central" volta a usá-los). Falha parcial mantém o valor anterior; offline,
  usa os últimos salvos. A custódia do Tesouro não tem fonte automática.

> Simulação educativa: não substitui contador, corretora, o GCAP/declaração nem recomendação de investimento.

## Estrutura

- `src/invest-engine.js`: regras de cálculo (funções puras, UMD; roda no navegador e no Node).
- `src/app.js`: interface e persistência (`UiEvents`, seções, gráfico, diálogos).
- `src/financ-ui.css`: design system FINANC v1.1 (cópia de `stk-pkg-design-system/`; não editar aqui).
- `src/index.css`: só o que é próprio do app.
- `src/stk-pkg-*.js|css`: kit de segurança e ícones (cópias de `stk-pkg-security/`; não editar aqui).
- `src/apoio/`: painel compartilhado (id `INVEST`).
- `test/`: testes com `node --test`, sem dependências.
- Documentação: `.documents/specs/stk-app-invest-sim/` (requisitos, arquitetura, entidades) e
  `.documents/specs/global/SPEC_ENDPOINTS_GLOBAL_2026-10-06.md` (endpoints).

## Testes

```
npm test        # node --test test/
```
