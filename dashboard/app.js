// Token Radar's dashboard, radar-3. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's netted farm plan, plus a Method tab that shows the curve, the
// blind backtest and the set-aside rules. No network: every byte it shows is in data.js.
//
// The value model, in one function: impliedValue() in lib/model.ts. The page recomputes a row
// from the snapshot figures and checks the number board.json carries, so the page's code and the
// board's data are visibly the same arithmetic:
//   implied = curve(TVL carried two weeks at the 7-day rate) x family factor x seasoning x sibling
// where the curve is the least-squares fit of log10(mcap) on log10(TVL / $100M) over the
// snapshot's traded tokens, the family factor is the category's shrunk mean log-residual off
// the curve, and seasoning is a piecewise age factor. No protocol name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, capital: 1000, share: 0.1, verdict: 'all' };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var v = Math.abs(n);
    return sign + (v % 1 === 0 ? '$' + v.toLocaleString('en-US') : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : n.toFixed(2) + 'x'; }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + money(n);
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic.
  function impliedOf(row) {
    var curve = Math.pow(10, row.curve_a + row.curve_b * Math.log10(Math.max(1, row.tvl_carried_usd) / 1e8));
    return Math.max(1, Math.round(curve * row.family_factor * row.seasoning_multiplier * (row.sibling ? 0.5 : 1)));
  }
  // One position's economics at a capital and an airdrop share: slice minus fees minus the
  // T-bill, with the verdict and the smallest deposit that nets out. The same function the
  // model runs in lib/model.ts, so the page and the board agree at the defaults.
  function econOf(row, capital, share) {
    var e = row.econ;
    var fees = e.fees_usd;
    var hold = e.hold_days;
    var tbillRate = DATA.model.tbill_rate;
    function netAt(c) {
      var slice = (c / (row.tvl_usd + c)) * share * row.implied_value_usd;
      return slice - fees - tbillRate * c * (hold / 365);
    }
    var slice = (capital / (row.tvl_usd + capital)) * share * row.implied_value_usd;
    var tbill = tbillRate * capital * (hold / 365);
    var net = slice - fees - tbill;
    var verdict = net > 0 ? 'FARM' : slice > fees ? 'THIN' : 'SKIP';
    var minutes = 15 + 10 * Math.ceil(hold / 7);
    var perHour = net / (minutes / 60);
    var minDeposit = null;
    if (netAt(100000) > 0) {
      var lo = 0, hi = 100000;
      for (var i = 0; i < 50; i++) { var mid = (lo + hi) / 2; if (netAt(mid) > 0) hi = mid; else lo = mid; }
      minDeposit = Math.ceil(hi);
    }
    return { capital: capital, share: share, slice: slice, fees: fees, tbill: tbill, net: net, verdict: verdict, perHour: perHour, minDeposit: minDeposit, chain: e.farm_chain, hold: hold };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  var CHAIN_ALIASES = { Binance: 'BSC', 'Binance Smart Chain': 'BSC', 'BNB Chain': 'BSC' };
  function feeFor(chain) {
    var fees = DATA.fees || {};
    if (fees[chain]) return fees[chain];
    if (CHAIN_ALIASES[chain] && fees[CHAIN_ALIASES[chain]]) return fees[CHAIN_ALIASES[chain]];
    return { gas_usd: 1, bridge_usd: 2.5 };
  }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function holdDaysFor(age) {
    var m = DATA.model;
    if (age === null || age === undefined) return m.hold_mid_days;
    if (age < 180) return m.hold_young_days;
    if (age < 540) return m.hold_mid_days;
    return m.hold_old_days;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the same wallet.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and keep the position open.';
    if (c.indexOf('restak') >= 0) return 'Restake $' + capital + " of the liquid staking token through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 against it and repay it once.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position in range.';
    if (c.indexOf('yield') >= 0 || c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s highest-TVL vault on " + chain + ' and let it compound.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('staking pool') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + ' and use one of its native apps for a week.';
    if (c.indexOf('payment') >= 0) return 'Send $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt in the farming wallet.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  // One table drives the mechanism-aware farm steps, in the same branch order as the
  // model: first matching category wins, the last row is the default. The strings are
  // identical to the model's, so the page and the board agree by construction.
  var MECH = [
    [['risk curator', 'curator', 'allocator'], 'Check the vault\'s allocation weekly; rebalance only if the curator moved funds.', 'the vault accrues a full distribution cycle', 'Curator risk: a bad allocation or a compromised curator key can lose the deposit.'],
    [['rwa'], 'Check the asset\'s yield and net asset value weekly; top up only if the yield fell.', 'at least one yield distribution lands', 'Issuer risk: the asset depends on the issuer\'s reserves and legal structure.'],
    [['basis trading'], 'Check the funding rate and hedge weekly; exit if funding flipped negative.', 'the basis trade runs through a full funding cycle', 'Funding-rate risk: flipped funding eats the yield, and the hedge can break.'],
    [['restak'], 'Claim restaking rewards weekly and restake them so the position compounds.', 'restaking rewards compound across epochs', 'Slashing risk: the receipt token can depeg and the validator can be slashed.'],
    [['lend', 'cdp', 'collateral'], 'Repay and re-borrow a small amount weekly, keeping the health factor high.', 'the borrow accrues interest across snapshots', 'Liquidation risk: if the collateral falls, the position can be liquidated.'],
    [['dex', 'leveraged farm'], 'Rebalance the range weekly if the price left it, and collect the fees earned.', 'it earns fees across more than one epoch', 'Impermanent loss: a big price move costs more than the fees earned.'],
    [['yield', 'aggregator'], 'Check the vault\'s APY weekly; switch vaults only if it collapsed.', 'compounding runs through several harvests', 'Strategy risk: the vault\'s strategy can underperform, or the protocol can be exploited.'],
    [['bridge'], 'Bridge a small amount back weekly to keep the route active on both sides.', 'the bridge counts activity in more than one window', 'Bridge risk: an exploit or a paused route can strand funds on the far chain.'],
    [['staking', 'staking pool'], 'Claim staking rewards weekly and restake them so the position compounds.', 'rewards compound across epochs', 'Slashing risk: the validator can be slashed and the receipt token can depeg.'],
    [['perpetual', 'derivative', 'options'], 'Close and reopen the hedge weekly to keep it delta-neutral.', 'it survives a full funding period', 'Liquidation and funding risk: leverage magnifies losses and funding bleeds margin.'],
    [['prediction'], 'Settle open markets weekly and open one new position.', 'the market resolves after you entered', 'A market can resolve against you \u2014 never size one beyond what you can lose.'],
    [['stable'], 'Check the peg and the latest reserve attestation weekly.', 'the stable asset holds its peg through a full cycle', 'Depeg risk: the stable asset can lose its peg if reserves or demand break.'],
    [['insurance'], 'Check the policy still covers the position weekly.', 'the cover stays active through the risk window', 'Cover risk: a claim can be denied if the event falls outside the policy\'s terms.'],
    [['chain'], 'Use one native app on {C} weekly so the chain counts the wallet as active.', 'the chain counts activity across epochs', 'Chain risk: a halted or exploited chain can strand funds.'],
    [['payment'], 'Send one more payment through the route weekly.', 'the payment history spans more than one snapshot', 'Counterparty risk: the payment rail depends on its operator staying solvent.'],
    [[], 'Make one qualifying action weekly, such as a deposit, a borrow, a swap or a vote.', 'the activity is counted in more than one snapshot', 'Smart-contract risk: the protocol can be exploited \u2014 never farm more than you can lose.']
  ];
  function mechFor(p, chain, hold) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < MECH.length; i++) {
      var row = MECH[i], ok = row[0].length === 0;
      for (var j = 0; j < row[0].length; j++) if (c.indexOf(row[0][j]) >= 0) { ok = true; break; }
      if (ok) return { weekly: row[1].split('{C}').join(chain), hold: 'Hold the position for at least ' + hold + ' days so ' + row[2] + '.', risk: row[3] };
    }
    return { weekly: '', hold: '', risk: '' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p, capital, share) {
    var econ = econOf(p, capital, share);
    var chain = econ.chain;
    var hold = econ.hold;
    var mech = mechFor(p, chain, hold);
    var gas = feeFor(chain).gas_usd;
    var gasText = gas < 1 ? '$' + gas.toFixed(2) : '$' + gas;
    var minDeposit = econ.minDeposit === null ? 'no deposit up to $100,000 nets out' : 'smallest deposit that nets out: ' + money(econ.minDeposit);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital.toLocaleString('en-US') + ' of capital and about ' + gasText + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: mech.weekly, cost: 'about ' + gasText + ' of gas a week', time: '10 minutes a week' },
      { text: mech.hold, cost: 'the $' + capital.toLocaleString('en-US') + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: mech.risk, cost: 'nothing to read, and it decides the size', time: '5 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Net at ' + money(capital) + ' and a ' + (share * 100) + '% airdrop share: slice ' + money(econ.slice) + ' minus fees ' + money(econ.fees) + ' minus T-bill ' + money(econ.tbill) + ' is ' + money(econ.net) + ', so this plan is ' + econ.verdict + '. ' + minDeposit + '. Recompute it live in the dashboard at other sizes and shares.', cost: 'the ' + money(capital) + ' stays in the position', time: 'decide before you deposit' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function watchlistSlugs() {
    var s = {};
    (DATA.watchlist || []).forEach(function (slug) { s[slug] = true; });
    return s;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    var watch = watchlistSlugs();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.watchOnly && !watch[r.slug]) return false;
      if (state.verdict !== 'all' && econOf(r, state.capital, state.share).verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'net') { av = econOf(a, state.capital, state.share).perHour; bv = econOf(b, state.capital, state.share).perHour; }
      else if (key === 'verdict') { var rank = { FARM: 0, THIN: 1, SKIP: 2 }; av = -rank[econOf(a, state.capital, state.share).verdict]; bv = -rank[econOf(b, state.capital, state.share).verdict]; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The board's filtered total: the count line under the controls states it, so a filtered
  // view always states what it is worth.
  function filteredTotal() {
    return rows().reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
  }

  // Export the board as it is filtered and sorted right now: rank, name, category, chains,
  // TVL, seven-day growth, age, implied value and its band, the flat-multiple price, and the
  // farm verdict at the capital and share the selectors show. The file is built in the page
  // from the same rows the table shows, so the download and the board agree.
  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var list = sortedRows(rows());
    var lines = ['rank,name,slug,category,chains,tvl_usd,change_7d_pct,age_days,implied_value_usd,band_low_usd,band_high_usd,flat_usd,verdict,net_usd,per_hour_usd,min_deposit_usd,farm_chain,hold_days'];
    list.forEach(function (r) {
      var e = econOf(r, state.capital, state.share);
      lines.push([
        r.rank, csvCell(r.name), csvCell(r.slug), csvCell(r.category || 'Other'),
        csvCell((r.chains || []).join(';')), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days,
        r.implied_value_usd, r.band_low_usd, r.band_high_usd, r.flat_usd,
        e.verdict, e.net.toFixed(2), e.perHour.toFixed(2), e.minDeposit === null ? '' : e.minDeposit,
        csvCell(e.chain), e.hold
      ].join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function farmNext() {
    var watch = watchlistSlugs();
    var list = DATA.rows.filter(function (r) { return watch[r.slug]; })
      .map(function (r) { return { r: r, e: econOf(r, state.capital, state.share) }; })
      .sort(function (a, b) { return b.e.perHour - a.e.perHour; })
      .slice(0, 3);
    if (list.length === 0) return '';
    return 'Farm next, by net per hands-on hour at ' + money(state.capital) + ' and a ' + (state.share * 100) + '% share: ' +
      list.map(function (x) { return x.r.name + ' ' + fmtSigned(x.e.perHour) + '/h'; }).join(', ') + '.';
  }

  function lede() {
    var top = DATA.rows[0];
    var bt = DATA.backtest;
    var v = DATA.verdicts;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' }),
        el('p', { class: 'sub', text: top ? 'Top of the board: ' + top.name + ' at ' + fmtUsd(top.implied_value_usd) + ' implied, ' + fmtUsd(top.tvl_usd) + ' of TVL. A flat multiple would price it at ' + fmtUsd(top.flat_usd) + '; the curve prices big protocols cheaper per dollar of TVL.' : '' }),
        el('p', { class: 'sub', text: 'Tested blind: leave-one-out median miss x' + bt.loo_curve.median_miss.toFixed(2) + ' against x' + bt.loo_flat.median_miss.toFixed(2) + ' for one flat multiple, ' + bt.loo_curve.within3_pct + '% of real caps within 3x against ' + bt.loo_flat.within3_pct + '%. ' + farmNext() })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Farm verdicts at $1K, 10% share' }), el('b', { text: v.FARM + ' farm · ' + v.THIN + ' thin · ' + v.SKIP + ' skip' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; render(); });
    var capitalSelect = el('select', { id: 'capital', 'aria-label': 'Farm capital' },
      [1000, 10000, 100000].map(function (c) { return el('option', { value: String(c), text: money(c), selected: c === state.capital ? 'selected' : null }); })
    );
    capitalSelect.addEventListener('change', function () { state.capital = parseInt(capitalSelect.value, 10); render(); });
    var shareSelect = el('select', { id: 'share', 'aria-label': 'Airdrop share' },
      [0.05, 0.1, 0.2].map(function (s) { return el('option', { value: String(s), text: (s * 100) + '% share', selected: s === state.share ? 'selected' : null }); })
    );
    shareSelect.addEventListener('change', function () { state.share = parseFloat(shareSelect.value); render(); });
    var verdictSelect = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['FARM', 'THIN', 'SKIP'].map(function (s) { return el('option', { value: s, text: s + ' only', selected: s === state.verdict ? 'selected' : null }); })
    );
    verdictSelect.addEventListener('change', function () { state.verdict = verdictSelect.value; render(); });
    var watchBtn = el('button', { type: 'button', 'aria-pressed': state.watchOnly ? 'true' : 'false', text: state.watchOnly ? 'Watchlist only' : 'Watchlist + early', onclick: function () { state.watchOnly = !state.watchOnly; render(); } });
    var tabs = el('div', { class: 'tabs' },
      [['pre-token', 'Pre-token'], ['live', 'Live token'], ['method', 'Method'], ['note', 'Research note'], ['set-aside', 'Set aside']].map(function (t) {
        return el('button', { type: 'button', 'aria-pressed': state.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { state.tab = t[0]; render(); } });
      })
    );
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'capital', text: 'Farm capital' }), capitalSelect),
      el('div', { class: 'field' }, el('label', { for: 'share', text: 'Airdrop share' }), shareSelect),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), watchBtn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), tabs),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Export' }), el('button', { class: 'button', type: 'button', text: 'Download CSV', title: 'Download the board as it is filtered and sorted right now, at the capital and share shown', onclick: function () { downloadCsv(); } })),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows · ' + fmtUsd(filteredTotal()) + ' implied' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'method' ? 'The curve, the backtest and the limits' : state.tab === 'note' ? 'The board read back as research' : DATA.set_aside.length + ' protocols set aside, with the rule for each' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var e = econOf(r, state.capital, state.share);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e2) { if (e2.key === 'Enter' || e2.key === ' ') { e2.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.sibling ? ' · sibling, half value' : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('div', null,
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
            el('div', { class: 'band', text: 'range ' + fmtUsd(r.band_low_usd) + '–' + fmtUsd(r.band_high_usd) })
          )
        )),
        el('td', null, el('span', { class: 'verdict ' + e.verdict.toLowerCase(), text: e.verdict })),
        el('td', { class: 'num ' + (e.perHour >= 0 ? 'pos' : 'neg'), text: fmtSigned(e.perHour) + '/h' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. The range under each value is the blind P10–P90 band. The verdict and $/h are net of fees and the T-bill at ' + money(state.capital) + ' and a ' + (state.share * 100) + '% share — change them above and every verdict recomputes. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Verdict'),
            sortHeader('net', 'Net $/h')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their FDV/TVL is what the curve is fitted on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // A log-log scatter as inline SVG: one axis per decade, points for the traded tokens,
  // the fitted curve as a line. No image, no network, drawn from data.js.
  function logChart(points, line, xLabel, yLabel, title) {
    var W = 560, H = 320, PL = 52, PR = 12, PT = 12, PB = 34;
    var xs = points.map(function (p) { return p[0]; });
    var ys = points.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs.concat([line[0][0], line[1][0]]));
    var x1 = Math.max.apply(null, xs.concat([line[0][0], line[1][0]]));
    var y0 = Math.min.apply(null, ys.concat([line[0][1], line[1][1]]));
    var y1 = Math.max.apply(null, ys.concat([line[0][1], line[1][1]]));
    var pad = 0.15;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    function X(v) { return PL + ((v - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    function tick(v) {
      if (v >= 9) return '$' + (v / 1e9).toFixed(0) + 'B';
      if (v >= 6) return '$' + (v / 1e6).toFixed(0) + 'M';
      if (v >= 3) return '$' + (v / 1e3).toFixed(0) + 'K';
      return '$' + v;
    }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + title + '" class="chart">';
    for (var gx = Math.ceil(x0); gx <= Math.floor(x1); gx++) {
      svg += '<line x1="' + X(gx).toFixed(1) + '" y1="' + PT + '" x2="' + X(gx).toFixed(1) + '" y2="' + (H - PB) + '" class="grid"/>';
      svg += '<text x="' + X(gx).toFixed(1) + '" y="' + (H - 12) + '" class="axis">' + tick(Math.pow(10, gx)) + '</text>';
    }
    for (var gy = Math.ceil(y0); gy <= Math.floor(y1); gy++) {
      svg += '<line x1="' + PL + '" y1="' + Y(gy).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(gy).toFixed(1) + '" class="grid"/>';
      svg += '<text x="' + (PL - 6) + '" y="' + (Y(gy) + 4).toFixed(1) + '" class="axis" text-anchor="end">' + tick(Math.pow(10, gy)) + '</text>';
    }
    points.forEach(function (p) {
      svg += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.5" class="dot' + (p[2] ? ' in' : '') + '"/>';
    });
    svg += '<line x1="' + X(line[0][0]).toFixed(1) + '" y1="' + Y(line[0][1]).toFixed(1) + '" x2="' + X(line[1][0]).toFixed(1) + '" y2="' + Y(line[1][1]).toFixed(1) + '" class="fit"/>';
    if (line[2]) {
      svg += '<line x1="' + X(line[2][0][0]).toFixed(1) + '" y1="' + Y(line[2][0][1]).toFixed(1) + '" x2="' + X(line[2][1][0]).toFixed(1) + '" y2="' + Y(line[2][1][1]).toFixed(1) + '" class="band-line"/>';
      svg += '<line x1="' + X(line[3][0][0]).toFixed(1) + '" y1="' + Y(line[3][0][1]).toFixed(1) + '" x2="' + X(line[3][1][0]).toFixed(1) + '" y2="' + Y(line[3][1][1]).toFixed(1) + '" class="band-line"/>';
    }
    svg += '<text x="' + PL + '" y="' + (H - 2) + '" class="axis">' + xLabel + '</text>';
    svg += '<text x="10" y="' + (PT + 8) + '" class="axis">' + yLabel + '</text>';
    svg += '</svg>';
    return svg;
  }

  function notePanel() {
    var paras = (DATA.research_note || []).map(function (t) { return el('p', { text: t }); });
    var outRows = (DATA.outliers || []).map(function (o) {
      return el('tr', null, el('td', null, el('b', { text: o.name })), el('td', null, el('span', { text: o.category })), el('td', { class: 'num', text: (o.residual >= 0 ? '+' : '') + o.residual.toFixed(2) }));
    });
    return el('section', { class: 'panel note' },
      el('h2', { text: 'Research note' }),
      el('p', { class: 'sub', text: 'The board read back in plain words. Every number here is computed from the fitted model and the ranked board \u2014 nothing is asserted from outside the snapshot.' }),
      paras,
      el('h3', { text: 'Set aside from the fit' }),
      el('p', { class: 'sub', text: 'These traded tokens sit more than ~30x off the first-pass curve, so the robust fit leaves them out. They are listed, not hidden.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Token' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Log residual' }))),
        el('tbody', null, outRows)
      ))
    );
  }

  function methodPanel() {
    var bt = DATA.backtest;
    var curve = DATA.curve;
    var m = DATA.model;
    var looPts = DATA.comps.map(function (p) {
      return [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd), false];
    });
    var xMin = 6, xMax = 11;
    var curveLine = [[xMin, curve.a + curve.b * (xMin - 8)], [xMax, curve.a + curve.b * (xMax - 8)]];
    // The leave-one-out scatter is the model's own blind predictions, carried in the
    // backtest, so the chart and the backtest table agree by construction.
    var looPreds = DATA.backtest.loo_points.map(function (pt) {
      var real = Math.log10(pt.real_usd);
      var pred = Math.log10(pt.pred_usd);
      return [real, pred, Math.abs(pred - real) <= Math.log10(3)];
    });
    var dMin = 5.5, dMax = 10.5;
    var diag = [[dMin, dMin], [dMax, dMax]];
    var bandHi = [[dMin, dMin + Math.log10(3)], [dMax, dMax + Math.log10(3)]];
    var bandLo = [[dMin, dMin - Math.log10(3)], [dMax, dMax - Math.log10(3)]];
    var famRows = DATA.family_table.map(function (f) {
      return el('tr', null, el('td', null, el('b', { text: f.category })), el('td', { class: 'num', text: fmtMult(f.factor) }), el('td', { class: 'num', text: String(f.comps) }));
    });
    var feeRows = Object.keys(DATA.fees || {}).sort().map(function (c) {
      var f = DATA.fees[c];
      return el('tr', null, el('td', null, el('b', { text: c })), el('td', { class: 'num', text: money(f.gas_usd) }), el('td', { class: 'num', text: money(f.bridge_usd) }));
    });
    feeRows.push(el('tr', null, el('td', null, el('b', { text: 'Any other chain' })), el('td', { class: 'num', text: money(1) }), el('td', { class: 'num', text: money(2.5) })));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Method and backtest' }),
      el('p', { class: 'sub', text: 'Every number below is computed from the same snapshot by the same program that wrote the board. Nothing here is asserted: the curve is fitted, the error is measured blind, and the flat multiple is shown next to it so the gain is visible.' }),
      el('h3', { text: 'The curve' }),
      el('div', { class: 'formula' }, 'log10(mcap) = ' + curve.a.toFixed(3) + ' + ' + curve.b.toFixed(3) + ' x log10(TVL / $100M), fit on ' + curve.n + ' traded tokens'),
      el('p', { class: 'sub', text: 'The slope is below 1, so big protocols trade at far lower FDV/TVL than small ones: a protocol with ten times the TVL is worth about ' + Math.pow(10, curve.b).toFixed(1) + 'x, not 10x. A flat multiple cannot see that, and a per-category median hides it behind one noisy ratio. Each category then gets a family factor — its shrunk mean log-residual off the curve, capped to 0.5x–2.5x — and the protocol\u2019s TVL is carried two weeks ahead at its 7-day rate before it is priced. Seasoning runs x0.70 at launch to x1.15 at 18 months and x0.95 at 5 years. A watchlist sibling of a traded token is halved.' }),
      el('div', { class: 'chart-wrap', html: logChart(looPts, curveLine, 'TVL', 'Market cap', 'Traded tokens against the fitted curve') }),
      el('p', { class: 'sub', text: 'Traded tokens against the fitted curve, log-log. The line is the curve; the dots are the ' + curve.n + ' traded tokens it was fitted on.' }),
      el('h3', { text: 'Robust fit' }),
      el('p', { class: 'sub', text: 'The curve is fit on ' + curve.n + ' of ' + (curve.n + (DATA.outliers || []).length) + ' traded tokens. The rest sit more than ~30x off the first-pass line \u2014 a versioned duplicate, a dead token, a cap that has nothing to do with TVL \u2014 so the fit sets them aside instead of letting them bend it. They are listed by name in the Research note tab.' }),
      el('h3', { text: 'Leave-one-out, tested blind' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Measure' }), el('th', { scope: 'col', text: 'Curve' }), el('th', { scope: 'col', text: 'Flat multiple' }))),
        el('tbody', null,
          el('tr', null, el('td', null, el('b', { text: 'Median miss' })), el('td', { class: 'num', text: 'x' + bt.loo_curve.median_miss.toFixed(2) }), el('td', { class: 'num', text: 'x' + bt.loo_flat.median_miss.toFixed(2) })),
          el('tr', null, el('td', null, el('b', { text: 'Within 3x of the real cap' })), el('td', { class: 'num', text: bt.loo_curve.within3_pct + '%' }), el('td', { class: 'num', text: bt.loo_flat.within3_pct + '%' })),
          el('tr', null, el('td', null, el('b', { text: 'Within 10x of the real cap' })), el('td', { class: 'num', text: bt.loo_curve.within10_pct + '%' }), el('td', { class: 'num', text: bt.loo_flat.within10_pct + '%' }))
        )
      )),
      el('p', { class: 'sub', text: 'Each traded token was refitted out and predicted blind: the curve and its family factors were refit without it, then it was priced with the same function that prices the board. The flat multiple is the global median FDV/TVL, ' + fmtMult(bt.flat_multiple) + ', refit the same way. The curve misses by less, and puts more real caps within 3x.' }),
      el('div', { class: 'chart-wrap', html: logChart(looPreds, [diag[0], diag[1], bandHi, bandLo], 'Real market cap', 'Predicted market cap', 'Blind predictions against real caps') }),
      el('p', { class: 'sub', text: 'Blind predictions against real caps, log-log. The diagonal is a perfect prediction; the two faint lines are 3x either way. Dots inside the band are within 3x.' }),
      el('h3', { text: 'Time split and band calibration' }),
      el('p', { class: 'sub', text: 'Fit on the ' + bt.time_split.fit_n + ' tokens listed before 2024, test on the ' + bt.time_split.test_n + ' newer ones: the curve misses by x' + bt.time_split.curve.median_miss.toFixed(2) + ' against x' + bt.time_split.flat.median_miss.toFixed(2) + ' for the flat multiple, with ' + bt.time_split.curve.within3_pct + '% within 3x against ' + bt.time_split.flat.within3_pct + '%. The blind 50% band holds ' + bt.band.inside50_pct + '% of real caps and the 80% band ' + bt.band.inside80_pct + '%, so the band is calibrated, not guessed. A row\u2019s band is its implied value times 10^' + bt.band.p10 + ' to 10^' + bt.band.p90 + ' — an order of magnitude, not a price.' }),
      el('h3', { text: 'Factor check' }),
      el('p', { class: 'sub', text: 'Blind residuals against 7-day growth: r = ' + bt.factor_check.r_growth + '. Against log-age: r = ' + bt.factor_check.r_age + '. Both sit inside the ±' + bt.factor_check.noise_band + ' noise band, so the snapshot cannot confirm either factor — the curve does not lean on growth or age beyond what the fit already carries.' }),
      el('h3', { text: 'Family factors' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Factor' }), el('th', { scope: 'col', text: 'Live comps' }))),
        el('tbody', null, famRows)
      )),
      el('p', { class: 'sub', text: 'A category\u2019s factor is its shrunk mean log-residual off the curve. Categories with no live comps take a factor of 1.' }),
      el('h3', { text: 'Farm fees' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Chain' }), el('th', { scope: 'col', text: 'Gas' }), el('th', { scope: 'col', text: 'Bridge' }))),
        el('tbody', null, feeRows)
      )),
      el('p', { class: 'sub', text: 'One stated table. A plan farms on the cheapest of the protocol\u2019s first three chains; the fee is its gas plus its bridge, once. The T-bill is ' + (m.tbill_rate * 100) + '% a year on the capital over the hold — ' + m.hold_young_days + ' days for a protocol under 6 months old, ' + m.hold_mid_days + ' days to 18 months, ' + m.hold_old_days + ' days after that.' }),
      el('h3', { text: 'Limits' }),
      el('p', { class: 'sub', text: 'One day of data: the snapshot is ' + DATA.as_of + ', and a protocol can launch, die or pivot after it. The curve is a cross-sectional fit, not a causal claim — big protocols trade cheaper per dollar of TVL, but the fit cannot say why. The band is wide because the market disagrees with itself by an order of magnitude inside a category. Treat every implied value as a ranking input, not a price, and every farm verdict as a net at the capital and share shown, not a guarantee.' }),
      el('h3', { text: 'Where the implied value sits' }),
      el('p', { class: 'sub', text: 'The board is top-heavy by construction: a few very large TVL protocols carry most of the implied value, while the long tail is where the early radar earns its keep. The top 3 rows hold ' + DATA.concentration_top3_pct + '% of the board\u2019s ' + fmtUsd(DATA.total_implied_usd) + ' total implied value, and the five categories below hold the most of it.' }),
      el('div', { class: 'facts' }, (DATA.category_rows || []).slice(0, 5).map(function (c) {
        return el('div', { class: 'fact' }, el('span', { text: c.category + ' · ' + c.rows + ' rows' }), el('b', { text: fmtUsd(c.total_implied_usd) }));
      }))
    );
  }

  function setAsidePanel() {
    var total = DATA.board_size + DATA.live_size + DATA.set_aside.length;
    var tbody = el('tbody');
    DATA.set_aside.forEach(function (s) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: s.name })),
        el('td', null, el('span', { class: 'sub', text: s.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(s.tvl_usd) }),
        el('td', null, el('span', { class: 'sub', text: s.reason }))
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Set aside' }),
      el('p', { class: 'sub', text: 'The snapshot holds ' + total + ' protocols: ' + DATA.board_size + ' on the board, ' + DATA.live_size + ' live-token protocols shown on the Live token tab, and ' + DATA.set_aside.length + ' pre-token protocols set aside below. Every one of them is listed with the rule that set it aside — nothing is dropped silently.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is not ranked' }))),
        tbody
      ))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function nearestPeers(row) {
    var target = Math.log10(Math.max(1, row.tvl_usd));
    return (DATA.comps || []).slice().sort(function (a, b) {
      return Math.abs(Math.log10(Math.max(1, a.tvl_usd)) - target) - Math.abs(Math.log10(Math.max(1, b.tvl_usd)) - target);
    }).slice(0, 6);
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var econ = econOf(row, state.capital, state.share);
    var steps = farmSteps(row, state.capital, state.share);
    var check = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'TVL carried two weeks at 7d growth' }), el('b', { class: 'num', text: fmtUsd(row.tvl_carried_usd) })),
        el('div', null, el('span', { text: 'Curve: log10(mcap) = ' + row.curve_a.toFixed(3) + ' + ' + row.curve_b.toFixed(3) + ' x log10(TVL/$100M)' }), el('b', { class: 'num', text: fmtUsd(Math.pow(10, row.curve_a + row.curve_b * Math.log10(Math.max(1, row.tvl_carried_usd) / 1e8))) })),
        el('div', null, el('span', { text: 'Family factor (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.family_factor) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Seasoning multiplier' }), el('b', { class: 'num', text: String(row.seasoning_multiplier) })),
        el('div', null, el('span', { text: 'Sibling factor' }), el('b', { class: 'num', text: row.sibling ? '0.5x (sibling of a traded token)' : '1x' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Blind P10–P90 band' }), el('b', { class: 'num', text: fmtUsd(row.band_low_usd) + ' – ' + fmtUsd(row.band_high_usd) })),
        el('div', null, el('span', { text: 'A flat multiple would price it at' }), el('b', { class: 'num', text: fmtUsd(row.flat_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(check) + (check === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. It says what the token would be worth if the protocol\u2019s record stayed as it is; it does not predict whether or when a token is issued.' })
    ));
    var peers = nearestPeers(row);
    var peerRows = peers.map(function (p) {
      return el('tr', null,
        el('td', null, el('b', { text: p.name })),
        el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(p.mcap_usd / p.tvl_usd) })
      );
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Nearest traded peers by TVL' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'FDV/TVL' }))),
        el('tbody', null, peerRows)
      )),
      el('p', { class: 'sub', text: 'The six traded tokens closest in TVL. Their market caps are facts; the curve is fitted through all ' + DATA.curve.n + ' of them.' })
    ));
    var sensHead = el('tr', null, el('th', { scope: 'col', text: 'Share \\ capital' }), [1000, 10000, 100000].map(function (c) { return el('th', { scope: 'col', class: 'num', text: money(c) }); }));
    var sensBody = [0.05, 0.1, 0.2].map(function (s) {
      var cells = [1000, 10000, 100000].map(function (c) {
        var e2 = econOf(row, c, s);
        return el('td', { class: 'num ' + (e2.net >= 0 ? 'pos' : 'neg'), text: fmtSigned(e2.net) + ' · ' + e2.verdict });
      });
      return el('tr', null, el('td', null, el('b', { text: (s * 100) + '%' })), cells);
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Net at other sizes and shares' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, sensHead),
        el('tbody', null, sensBody)
      )),
      el('p', { class: 'sub', text: 'Net of fees and the T-bill at each capital and airdrop share. At ' + money(state.capital) + ' and a ' + (state.share * 100) + '% share this plan nets ' + fmtSigned(econ.net) + ' (' + econ.verdict + '), ' + money(econ.perHour) + ' per hands-on hour on ' + econ.chain + '. The smallest deposit that nets out is ' + (econ.minDeposit === null ? 'none up to $100,000' : money(econ.minDeposit)) + '.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    // Take the seven steps with you: the button copies the plan as plain text, with the
    // protocol's name and rank on the first line, so it pastes cleanly into a farm log.
    var copyBtn = el('button', { class: 'button', type: 'button', text: 'Copy farm plan', onclick: function () {
      var text = row.name + ' farm plan (rank ' + row.rank + ' of ' + DATA.board_size + '):\n' + steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { copyBtn.textContent = 'Copied to clipboard'; }, function () { copyBtn.textContent = 'Copy failed, select the steps instead'; });
      } else {
        copyBtn.textContent = 'Copy is not supported in this browser';
      }
    } });
    dialog.appendChild(el('section', { class: 'detail-section' }, copyBtn));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'method') shell.appendChild(methodPanel());
    else if (state.tab === 'note') shell.appendChild(notePanel());
    else shell.appendChild(setAsidePanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
    // Press / anywhere to jump to the search box, the way a command palette opens; never
    // while the user is already typing in a field.
    if (e.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'TEXTAREA') {
      var q = document.getElementById('q');
      if (q) { e.preventDefault(); q.focus(); }
    }
  });
})();
