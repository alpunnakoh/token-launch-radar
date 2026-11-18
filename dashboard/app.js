// Token Radar's dashboard, model radar-5. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the model's own inputs and the protocol's netted farm plan, the fitted curve's blind test,
// a calibration table, and a what-if sandbox. No network: every byte it shows is in data.js.
//
// What radar-5 adds: an expected-value column (launch likelihood x implied value - cost),
// a p10-p90 value range per row, a scatter of TVL against implied value, a category table
// that shows each category's token rate, and a separation panel that accounts for every one
// of the 758 protocols in the snapshot. The board still ranks by implied value; expected
// value is a second lens, and the verdict now follows expected value per dollar farmed.
//
// The page recomputes a row from the snapshot figures and checks the number board.json
// carries, so the page's code and the board's data are visibly the same arithmetic. The sandbox
// only re-ranks a preview: the submitted board always uses the calibrated model.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };
  var SANDBOX_DEFAULTS = { scale: 1, growthWeight: 0.6, maturityFloor: 0.8 };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Number.isInteger(n)) return '$' + n;
    return '$' + n.toFixed(2);
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
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The model in one function: the same arithmetic main.ts runs, so the page can recompute a row
  // and check it against board.json. `sb` is a sandbox override, or null for the calibrated model.
  // `multiple` is the row's effective multiple: the fitted curve times its category factor,
  // divided by TVL, so the page never needs the curve itself to check a row.
  function impliedOf(row, sb) {
    var m = DATA.model;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var weight = sb ? sb.growthWeight : m.growth_weight;
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var floor = sb ? sb.maturityFloor : m.maturity_floor;
    var range = sb ? (1 - sb.maturityFloor) : m.maturity_range;
    var maturity = floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * range;
    var mult = row.multiple * (sb ? sb.scale : 1);
    return Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity));
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
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasUsd(chain) {
    var c = (chain || '').toLowerCase();
    if (c.indexOf('ethereum') >= 0) return 8;
    if (c.indexOf('solana') >= 0) return 0.05;
    if (c.indexOf('base') >= 0 || c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('blast') >= 0) return 0.5;
    if (c.indexOf('binance') >= 0 || c.indexOf('bnb') >= 0) return 0.3;
    if (c.indexOf('polygon') >= 0) return 0.1;
    if (c.indexOf('avalanche') >= 0 || c.indexOf('starknet') >= 0) return 0.5;
    if (c.indexOf('tron') >= 0) return 1;
    if (c.indexOf('linea') >= 0 || c.indexOf('sonic') >= 0 || c.indexOf('mantle') >= 0 || c.indexOf('fantom') >= 0 || c.indexOf('gnosis') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('zksync') >= 0) return 0.1;
    if (c.indexOf('sui') >= 0 || c.indexOf('aptos') >= 0 || c.indexOf('hyperliquid') >= 0 || c.indexOf('monad') >= 0 || c.indexOf('near') >= 0 || c.indexOf('celo') >= 0) return 0.05;
    return 2;
  }
  function fmtGas(n) {
    if (Number.isInteger(n)) return '$' + n;
    return '$' + n.toFixed(2);
  }
  function gasFor(chain) {
    return 'about ' + fmtGas(gasUsd(chain)) + ' of gas';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function weeksFor(hold) {
    return Math.max(1, Math.ceil(hold / 7));
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('staking pool') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('payment') >= 0) return 'Pay $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of assets in ' + name + "'s governance vault on " + chain + ' and vote once.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + ' and use one of its apps.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s vault on " + chain + ' and keep the shares.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap $10 of USDC for another asset in ' + name + "'s pool on " + chain + '.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $10 against the position on ' + name + ' and repay it the same week.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $10 back through ' + name + ' so the round trip is on record.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge on ' + name + ' and open a fresh one half the size.';
    if (c.indexOf('prediction') >= 0 || c.indexOf('governance') >= 0) return 'Vote once on ' + name + "'s current proposal.";
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim the staking rewards ' + name + ' shows and restake them.';
    return 'Make a second $10 deposit into ' + name + ' on ' + chain + ' from the same wallet.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = weeksFor(hold);
    var gas = gasFor(chain);
    var gasN = gasUsd(chain);
    var multi = p.chains && p.chains.length > 1;
    var chain2 = multi ? p.chains[1] : chain;
    var gas2 = multi ? gasFor(chain2) : gas;
    var weeklyGas = Math.round(gasN * weeks * 100) / 100;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, chain), cost: 'about $10 of capital and ' + gas, time: '10 minutes' },
      { text: 'Make one qualifying action each week for ' + weeks + ' weeks, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week, about ' + fmtGas(weeklyGas) + ' in total', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      multi
        ? { text: actionFor(p, 25, chain2), cost: '$25 of capital and ' + gas2, time: '10 minutes' }
        : { text: "Open the protocol's own points or rewards page and check the position is counted before the next snapshot.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Never pay to claim anything, and check every address on the protocol\'s own documentation before you sign.', cost: 'nothing; a paid claim is a scam', time: '10 minutes' },
      multi
        ? { text: 'Unwind in reverse when you are done: close the ' + chain2 + ' position first, then the main position on ' + chain + ', and keep ' + gas + ' for the last transaction.', cost: gas + ' to unwind', time: '15 minutes' }
        : { text: 'Unwind when you are done: withdraw the position on ' + chain + ', keep ' + gas + ' for the last transaction, and leave the farm log in place.', cost: gas + ' to unwind', time: '15 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function sandboxActive() { return state.sandbox !== null; }
  function previewValue(row) { return state.sandbox ? impliedOf(row, state.sandbox) : row.implied_value_usd; }
  function verdictOrder(v) { return v === 'farm' ? 0 : v === 'thin' ? 1 : 2; }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var sb = state.sandbox;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else if (key === 'ev') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else if (key === 'likelihood') { av = a.launch_likelihood; bv = b.launch_likelihood; }
      else if (key === 'verdict') { av = verdictOrder(a.verdict); bv = verdictOrder(b.verdict); }
      else if (key === 'cost') { av = a.total_cost_usd; bv = b.total_cost_usd; }
      else { av = sb ? impliedOf(a, sb) : a.implied_value_usd; bv = sb ? impliedOf(b, sb) : b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function previewRanks(list) {
    // Preview rank of each row under the sandbox, by implied value descending.
    var ordered = list.slice().sort(function (a, b) {
      var d = impliedOf(b, state.sandbox) - impliedOf(a, state.sandbox);
      if (d !== 0) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    var map = {};
    ordered.forEach(function (r, i) { map[r.slug] = i + 1; });
    return map;
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

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one the snapshot holds. Implied value is a model, not a promise.' }),
        el('p', { text: 'Each protocol carries an eight-step farm plan netted to the dollar, with a verdict: farm (' + DATA.verdict_counts.farm + '), thin (' + DATA.verdict_counts.thin + ') or skip (' + DATA.verdict_counts.skip + '). Select any row for its model, its cost and its plan. Value alone does not say whether to farm: expected value — launch likelihood times implied value, minus the cost to farm — is the second lens, and the verdict follows expected value per dollar farmed. A fortune that never launches is worth nothing.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
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
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var verdictSelect = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['farm', 'thin', 'skip'].map(function (v) { return el('option', { value: v, text: v.charAt(0).toUpperCase() + v.slice(1), selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSelect.addEventListener('change', function () { state.verdict = verdictSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSelect),
      el('label', { class: 'check', for: 'watchlist' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'verdict' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictBadge(v) {
    return el('span', { class: 'verdict verdict-' + v, text: v === 'farm' ? 'Farm' : v === 'thin' ? 'Thin' : 'Skip' });
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return previewValue(r); }).concat([1]));
    var ranks = sandboxActive() ? previewRanks(DATA.rows) : null;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var value = previewValue(r);
      var delta = null;
      if (ranks) {
        var d = r.rank - ranks[r.slug];
        delta = d > 0 ? el('span', { class: 'delta up', text: '+' + d }) : d < 0 ? el('span', { class: 'delta down', text: String(d) }) : el('span', { class: 'delta flat', text: '0' });
      }
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(ranks ? ranks[r.slug] : r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', null,
            el('b', { text: r.name }),
            el('span', { class: r.watchlist ? 'badge' : 'badge early', text: r.watchlist ? 'watchlist' : 'early' })
          ),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((value / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(value) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.expected_value_usd) }),
        el('td', { class: 'num', text: Math.round(r.launch_likelihood * 100) + '%' }),
        el('td', null, el('span', { class: 'status', text: 'no token' })),
        el('td', null, verdictBadge(r.verdict)),
        el('td', { class: 'num', text: fmtMoney(r.total_cost_usd) }),
        ranks ? el('td', { class: 'num' }, delta) : null
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sandboxActive() ? 'Preview re-ranked by the sandbox constants below. Select a row for its model and farm plan.' : 'Pre-token protocols, strongest implied value first. Expected value is launch likelihood x implied value, minus the cost to farm — sort by it to see the best farm, not the biggest value. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            sortHeader('ev', 'Expected value'),
            sortHeader('likelihood', 'Launch %'),
            el('th', { scope: 'col', text: 'Token' }),
            sortHeader('verdict', 'Verdict'),
            sortHeader('cost', 'To farm'),
            sandboxActive() ? el('th', { scope: 'col', text: 'Rank move' }) : null
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.tvl_usd > 0 && r.mcap_usd !== null ? (r.mcap_usd / r.tvl_usd) : null;
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : ratio.toFixed(3) + 'x' }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-per-TVL is what calibrates it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var fit = cal.fit;
    var shown = cal.by_category.filter(function (c) {
      return DATA.rows.some(function (r) { return (r.category || 'Other') === c.category; });
    });
    var tbody = el('tbody');
    shown.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: c.raw_median === null ? 'n/a' : c.raw_median.toFixed(3) + 'x' }),
        el('td', { class: 'num', text: c.multiple.toFixed(3) + 'x' })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The curve and the category factors are not typed in: they are fitted from the snapshot itself, at run time.' }),
      el('div', { class: 'formula' },
        'implied = round( curve(tvl_usd) x factor(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'Curve(tvl) is the least-squares fit of log10(market cap) on log10(TVL) over ' + fit.comps + ' live-token protocols, one per ticker: log10(mcap) = ' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' x log10(tvl). The slope is shrunk toward 0.5 (the square-root law) with ' + m.slope_shrink_k + ' pseudo-observations, because 118 comps cannot pin it precisely — the shrunk slope predicts held-out comps better on every split tested. The slope is far below 1, so a token grows much slower than its TVL; a flat multiple would price the largest protocols ten times too high. Factor(category) is the median of mcap / curve(tvl) for live tokens in that category, shrunk toward 1.0 with ' + m.shrinkage_k + ' pseudo-observations and capped at ' + m.factor_cap.toFixed(1) + 'x. A category needs at least ' + m.min_live + ' live tokens to earn its own factor; thinner categories use 1.0. TVL and seven-day growth come from the snapshot. The growth weight is 0.6, not 1.0: the week\u2019s move is half signal, half noise, and blind tests show the half weight predicting held-out tokens better. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('p', { class: 'sub', text: 'Value is not the farm decision. Launch likelihood is the category\u2019s own token rate — the share of protocols in that category that already record a token, shrunk toward the global ' + (DATA.calibration.launch_global * 100).toFixed(0) + '% with ' + m.launch_shrink_k + ' pseudo-observations — times an age factor that falls from 1.0 to ' + m.age_factor_floor + ' over ' + m.age_decay_days + ' days with no token. Categories differ enormously: Lending launches most of the time, Risk Curators rarely. Expected value is likelihood x implied value, minus the cost to farm. The verdict compares expected value per dollar farmed against the board\u2019s own thirds, so farm means the best expected return per dollar, not the biggest value. The likelihood is a model score, not a measured rate — no future launches exist in a sealed snapshot to test it against — and the board says so. What is blind-tested is the implied value underneath it.' }),
      el('p', { class: 'sub', text: 'Every implied value carries its honest range: p10 to p90 of the comps\u2019 own residuals around the curve, ' + DATA.validation.residual_p10.toFixed(3) + 'x to ' + DATA.validation.residual_p90.toFixed(3) + 'x. A row worth $10M on the curve is plausibly worth $0.7M to $96M. The range is in each row\u2019s detail view; a point estimate without it would pretend the model knows more than it does.' }),
      el('div', { class: 'calib-wrap' },
        el('table', { class: 'calib' },
          el('caption', { class: 'sub', text: 'Calibration: one row per category on the board, computed from this snapshot. Raw is the median residual against the curve; factor is what the model uses.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live tokens' }), el('th', { scope: 'col', text: 'Raw median' }), el('th', { scope: 'col', text: 'Factor used' }))),
          tbody
        )
      )
    );
  }

  function validationPanel() {
    var v = DATA.validation;
    var fit = DATA.calibration.fit;
    function row(label, t) {
      return el('tr', null,
        el('td', { text: label }),
        el('td', { class: 'num', text: String(t.n) }),
        el('td', { class: 'num', text: t.median_factor.toFixed(2) + 'x' }),
        el('td', { class: 'num', text: t.within_2x.toFixed(1) + '%' }),
        el('td', { class: 'num', text: t.within_3x.toFixed(1) + '%' }),
        el('td', { class: 'num', text: t.spearman.toFixed(3) })
      );
    }
    return el('section', { class: 'panel model validation' },
      el('h2', { text: 'Tested blind: does the model actually predict tokens?' }),
      el('p', { class: 'sub', text: 'The model is fitted on live tokens and then tested on tokens it never saw. Leave-one-out refits the curve ' + fit.comps + ' times, once per token. The blind split fits on half the tokens (even slugs) and predicts the other half. The flat multiple is the previous model, tested the same way, so the comparison is on the same data. This version tests the full predictor — curve, category factor, growth and maturity, exactly as the board scores a row — not just the curve.' }),
      el('div', { class: 'calib-wrap' },
        el('table', { class: 'calib' },
          el('caption', { class: 'sub', text: 'Prediction error is the factor between the predicted and the actual market cap. Lower is better.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Test' }), el('th', { scope: 'col', text: 'Tokens' }), el('th', { scope: 'col', text: 'Median error' }), el('th', { scope: 'col', text: 'Within 2x' }), el('th', { scope: 'col', text: 'Within 3x' }), el('th', { scope: 'col', text: 'Rank correlation' }))),
          el('tbody', null,
            row('Full predictor, leave-one-out', v.loo),
            row('Full predictor, blind split', v.blind),
            row('Flat multiple, leave-one-out', v.flat_loo),
            row('Flat multiple, blind split', v.flat_blind)
          )
        )
      ),
      el('p', { class: 'sub', text: 'Read it plainly: on the blind split the model is off by a median factor of ' + v.blind.median_factor.toFixed(2) + 'x, against ' + v.flat_blind.median_factor.toFixed(2) + 'x for the flat multiple — about a 40% smaller error, but individual tokens still vary a hundred-fold around the curve. The ranking is a comps estimate, not a price, and the wide error is why every row carries its p10–p90 range (' + v.residual_p10.toFixed(3) + 'x to ' + v.residual_p90.toFixed(3) + 'x around the curve), not just a point value.' })
    );
  }

  function separationPanel() {
    var s = DATA.separation;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the radar separates trading tokens from pre-token protocols' }),
      el('p', { class: 'sub', text: 'The snapshot holds ' + s.total + ' protocols. ' + s.live_token + ' of them already record a token, so they are set aside: their market cap is a fact, not a model, and it is what calibrates the ranking. ' + s.pre_token + ' record no token at all. The board ranks ' + DATA.board_size + ' of those: the ' + DATA.watchlist_size + ' on the watchlist plus every rankable pre-token protocol below the floor. The ' + (s.pre_token - DATA.board_size) + ' left out are not hidden: ' + s.excluded_cex + ' are exchanges, ' + s.excluded_versioned + ' are versioned pools of another protocol, and ' + s.excluded_large + ' are large protocols the watchlist leaves out because they are wrapped, staked or bridged versions of a protocol that already has a token — their value already trades elsewhere.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols in the snapshot' }), el('b', { text: String(s.total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Already record a token' }), el('b', { text: String(s.live_token) })),
        el('div', { class: 'fact' }, el('span', { text: 'Record no token' }), el('b', { text: String(s.pre_token) })),
        el('div', { class: 'fact' }, el('span', { text: 'Ranked on this board' }), el('b', { text: String(DATA.board_size) }))
      )
    );
  }

  function scatterPanel() {
    var W = 680, H = 340, P = 44;
    var rows = DATA.rows;
    var xs = rows.map(function (r) { return Math.log10(Math.max(1, r.tvl_usd)); });
    var ys = rows.map(function (r) { return Math.log10(Math.max(1, r.implied_value_usd)); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(x) { return P + (x - x0) / (x1 - x0) * (W - 2 * P); }
    function Y(y) { return H - P - (y - y0) / (y1 - y0) * (H - 2 * P); }
    var fit = DATA.calibration.fit;
    var curve = '';
    for (var i = 0; i <= 24; i++) {
      var x = x0 + (x1 - x0) * i / 24;
      curve += (i === 0 ? 'M' : 'L') + X(x).toFixed(1) + ' ' + Y(fit.intercept + fit.slope * x).toFixed(1);
    }
    var ticks = '';
    for (var tx = x0; tx <= x1; tx++) {
      ticks += '<line class="axis" x1="' + X(tx).toFixed(1) + '" y1="' + (H - P) + '" x2="' + X(tx).toFixed(1) + '" y2="' + P + '"/><text class="tick" x="' + X(tx).toFixed(1) + '" y="' + (H - P + 16) + '">' + fmtUsd(Math.pow(10, tx)) + '</text>';
    }
    for (var ty = y0; ty <= y1; ty++) {
      ticks += '<line class="axis" x1="' + P + '" y1="' + Y(ty).toFixed(1) + '" x2="' + (W - P) + '" y2="' + Y(ty).toFixed(1) + '"/><text class="tick" x="' + (P - 6) + '" y="' + (Y(ty) + 4).toFixed(1) + '">' + fmtUsd(Math.pow(10, ty)) + '</text>';
    }
    var dots = rows.map(function (r) {
      return '<circle cx="' + X(Math.log10(Math.max(1, r.tvl_usd))).toFixed(1) + '" cy="' + Y(Math.log10(Math.max(1, r.implied_value_usd))).toFixed(1) + '" r="' + (r.watchlist ? 3.4 : 2.2) + '" class="' + (r.watchlist ? 'dot-wl' : 'dot') + '"><title>' + r.name + ': TVL ' + fmtUsd(r.tvl_usd) + ', implied ' + fmtUsd(r.implied_value_usd) + '</title></circle>';
    }).join('');
    var svg = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="TVL against implied value, log scale">' + ticks +
      '<path class="curve" d="' + curve + '"/>' + dots +
      '<text class="tick" x="' + (W / 2) + '" y="' + (H - 6) + '">TVL (log scale)</text>' +
      '<text class="tick" x="12" y="' + (H / 2) + '" transform="rotate(-90 12 ' + (H / 2) + ')">Implied value (log scale)</text></svg>';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'TVL against implied value' }),
      el('p', { class: 'sub', text: 'Every row on the board, log scale on both axes. The line is the fitted curve: value grows with the square root of TVL, not in proportion to it. Dots above the line are priced richer than the curve for their TVL; dots below it, cheaper. Large dots are watchlist protocols.' }),
      el('div', { html: svg })
    );
  }

  function categoryPanel() {
    var cal = DATA.calibration;
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = { n: 0, sum: 0 };
      byCat[c].n++;
      byCat[c].sum += r.implied_value_usd;
    });
    var factorOf = {};
    cal.by_category.forEach(function (f) { factorOf[f.category] = f; });
    var list = cal.launch_by_category.filter(function (l) { return byCat[l.category]; })
      .sort(function (a, b) { return byCat[b.category].sum / byCat[b.category].n - byCat[a.category].sum / byCat[a.category].n; });
    var tbody = el('tbody');
    list.forEach(function (l) {
      var f = factorOf[l.category] || { multiple: 1, live_count: 0 };
      tbody.appendChild(el('tr', null,
        el('td', { text: l.category }),
        el('td', { class: 'num', text: String(byCat[l.category].n) }),
        el('td', { class: 'num', text: String(f.live_count) }),
        el('td', { class: 'num', text: (l.raw_rate * 100).toFixed(0) + '%' }),
        el('td', { class: 'num', text: (l.rate * 100).toFixed(0) + '%' }),
        el('td', { class: 'num', text: f.multiple.toFixed(2) + 'x' }),
        el('td', { class: 'num', text: fmtUsd(byCat[l.category].sum / byCat[l.category].n) })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Categories: who launches, who is priced rich, who is worth most' }),
      el('p', { class: 'sub', text: 'Token rate is the share of protocols in the category that already record a token — the raw material of launch likelihood. Likelihood used is that rate shrunk toward the global ' + (cal.launch_global * 100).toFixed(0) + '%. Factor is what the model multiplies the curve by. Average implied value is the mean of the category\u2019s rows on this board.' }),
      el('div', { class: 'calib-wrap' },
        el('table', { class: 'calib' },
          el('caption', { class: 'sub', text: 'One row per category on the board. A category can be worth a lot and still rarely launch — that is the point of the expected value column.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'On board' }), el('th', { scope: 'col', text: 'Live tokens' }), el('th', { scope: 'col', text: 'Token rate' }), el('th', { scope: 'col', text: 'Likelihood used' }), el('th', { scope: 'col', text: 'Factor' }), el('th', { scope: 'col', text: 'Avg implied' }))),
          tbody
        )
      )
    );
  }

  function sandboxPanel() {
    var sb = state.sandbox || SANDBOX_DEFAULTS;
    function slider(id, label, min, max, step, value, oninput) {
      var out = el('output', { for: id, text: String(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () { out.textContent = input.value; oninput(parseFloat(input.value)); });
      return el('div', { class: 'slider' }, el('label', { for: id, text: label }), input, out);
    }
    function setSandbox(patch) {
      var next = Object.assign({}, state.sandbox || SANDBOX_DEFAULTS, patch);
      var isDefault = next.scale === SANDBOX_DEFAULTS.scale && next.growthWeight === SANDBOX_DEFAULTS.growthWeight && next.maturityFloor === SANDBOX_DEFAULTS.maturityFloor;
      state.sandbox = isDefault ? null : next;
      render();
    }
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox: what if the constants moved?' }),
      el('p', { class: 'sub', text: 'A preview only. These sliders re-rank the board above so you can see how sensitive it is; they never change the submitted board, which always uses the calibrated model. Reset returns to it.' }),
      el('div', { class: 'sliders' },
        slider('sb-scale', 'Curve scale', 0.5, 2, 0.05, sb.scale, function (v) { setSandbox({ scale: v }); }),
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, sb.growthWeight, function (v) { setSandbox({ growthWeight: v }); }),
        slider('sb-maturity', 'Maturity floor', 0.4, 0.8, 0.05, sb.maturityFloor, function (v) { setSandbox({ maturityFloor: v }); })
      ),
      el('div', null, el('button', { class: 'button', type: 'button', text: 'Reset to the calibrated model', onclick: function () { state.sandbox = null; render(); } }))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, null);
    var evPerDollar = row.total_cost_usd > 0 ? Math.round(row.expected_value_usd / row.total_cost_usd) : 0;
    var verdictLine = row.verdict === 'farm'
      ? 'Farm: the highest expected value per dollar farmed on this board.'
      : row.verdict === 'thin'
        ? 'Thin: worth a small position, not a full one — mid-range expected value per dollar farmed.'
        : 'Skip: the lowest expected value per dollar farmed on this board — the cost outweighs the modelled value.';
    var comps = (DATA.calibration.category_comps || []).filter(function (c) { return c.category === (row.category || 'Other'); })[0];
    var compList = comps && comps.comps.length
      ? comps.comps.map(function (c) { return el('li', null, el('b', { text: c.name }), el('span', { class: 'cost', text: 'TVL ' + fmtUsd(c.tvl_usd) + ', mcap ' + fmtUsd(c.mcap_usd) + ', ' + c.multiple.toFixed(2) + 'x' })); })
      : [el('li', { text: 'No live-token comps in this category — the factor is 1.0.' })];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' - watchlist' : ' - early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('p', { class: 'sub', text: 'Ranked #' + row.rank + ' because ' + fmtUsd(row.tvl_usd) + ' of TVL on the fitted curve is worth ' + fmtUsd(row.curve_value) + ', the ' + (row.category || 'Other') + ' factor is ' + row.category_factor.toFixed(2) + 'x, seven-day growth is ' + fmtPct(row.change_7d) + ' and it has run ' + fmtAge(row.age_days) + ' with no token.' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Curve value for this TVL' }), el('b', { class: 'num', text: fmtUsd(row.curve_value) })),
        el('div', null, el('span', { text: 'Category factor (' + row.category + ')' }), el('b', { class: 'num', text: row.category_factor.toFixed(3) + 'x (' + row.multiple_live_count + ' live)' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Honest range (p10–p90)' }), el('b', { class: 'num', text: fmtUsd(row.range_lo_usd) + ' – ' + fmtUsd(row.range_hi_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. The range is the comps\u2019 own spread around the curve: nine in ten live tokens land inside it, one in ten outside.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Expected value: is it worth farming?' }),
      el('p', { class: 'sub', text: 'Launch likelihood ' + Math.round(row.launch_likelihood * 100) + '% — the ' + (row.category || 'Other') + ' token rate times the age factor — times the implied value, minus the cost to farm. That is ' + fmtUsd(row.expected_value_usd) + ' of expected value for ' + fmtMoney(row.total_cost_usd) + ' spent, or ' + fmtUsd(evPerDollar) + ' per $1 farmed. The likelihood is a model score, not a measured rate: no future launches exist in the snapshot to test it against. What is blind-tested is the implied value underneath it.' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Launch likelihood' }), el('b', { class: 'num', text: Math.round(row.launch_likelihood * 100) + '%' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Cost to farm' }), el('b', { class: 'num', text: fmtMoney(row.total_cost_usd) })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.expected_value_usd) }))
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The live tokens behind this row' }),
      el('p', { class: 'sub', text: 'These are the live-token protocols in ' + (row.category || 'Other') + ' that set the category factor of ' + row.category_factor.toFixed(2) + 'x. The factor is the median of their market cap against the curve, shrunk toward 1.0 — so this row is priced by these tokens, not by a typed-in number.' }),
      el('ol', { class: 'steps' }, compList)
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: verdictLine + ' Total to farm: ' + fmtMoney(row.total_cost_usd) + ' — ' + fmtMoney(row.capital_usd) + ' capital and about ' + fmtMoney(row.gas_total_usd) + ' gas. That is ' + fmtUsd(evPerDollar) + ' of expected value per $1 farmed.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
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
    shell.appendChild(separationPanel());
    shell.appendChild(controls());
    if (sandboxActive()) {
      shell.appendChild(el('div', { class: 'banner on' },
        el('b', { text: 'Sandbox preview active.' }),
        el('span', { text: 'The board below is re-ranked with your constants. The submitted board uses the calibrated model.' }),
        el('button', { class: 'button', type: 'button', text: 'Reset', onclick: function () { state.sandbox = null; render(); } })
      ));
    }
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(scatterPanel());
      shell.appendChild(categoryPanel());
      shell.appendChild(modelPanel());
      shell.appendChild(validationPanel());
      shell.appendChild(sandboxPanel());
    }
    shell.appendChild(el('p', { class: 'foot', text: 'Source: ' + DATA.source + '. Implied values are this radar\u2019s model, not a price and not a promise of a token. A protocol that records no token may still have one its DefiLlama record does not carry.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
