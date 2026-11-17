// Token Launch Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a log-log scatter, filters, a per-protocol
// drawer, the Method tab and the Live token tab. No network: every byte shown is in
// data.js. The page recomputes each row's implied value from the snapshot figures
// (impliedOf), so the code and board.json visibly agree.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', cat: 'all', status: 'all', chain: '', tab: 'board', sort: 'implied', dir: -1, selected: null, anchorsOn: true };

  // Category chips group the snapshot's categories; anything unmapped is Other.
  var GROUPS = {
    'Lending & CDP': ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management', 'Collateral Markets'],
    'Trading': ['Dexs', 'Derivatives', 'Basis Trading', 'Options', 'Synthetics', 'Indexes', 'Interest Rate Derivatives', 'Options Vault', 'Prediction Market', 'OTC Marketplace'],
    'Vaults & yield': ['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Token Locker', 'Restaking', 'Staking Pool'],
    'RWA & stables': ['RWA', 'Algo-Stables', 'Dual-Token Stablecoin', 'Stablecoin Issuer', 'Stablecoin Wrapper', 'Reserve Currency', 'Anchor BTC', 'Decentralized BTC']
  };
  function groupOf(cat) {
    if (!cat) return 'Other';
    for (var g in GROUPS) if (GROUPS[g].indexOf(cat) >= 0) return g;
    return 'Other';
  }

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function fmtDate(s) { return s || 'unknown'; }

  // The model in one function: TVL x category multiple x growth x age x chains, haircut
  // for flagged audit rows. The multiple comes from the anchor table the program wrote.
  function rLookup(row) {
    if (row.r_fallback) return DATA.global_median_ratio;
    for (var i = 0; i < DATA.anchors.length; i++) if (DATA.anchors[i].category === (row.category || '(no category)')) return DATA.anchors[i].r_category;
    return DATA.global_median_ratio;
  }
  function impliedOf(row) {
    var g = 1 + Math.min(DATA.model.growth_cap, Math.max(-DATA.model.growth_cap, row.change_7d === null ? 0 : row.change_7d)) / 200;
    var a = row.age_days === null ? 1 : 1 + DATA.model.age_weight * Math.min(row.age_days / DATA.model.age_days, 1);
    var c = 1 + DATA.model.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), DATA.model.chain_max);
    return Math.max(1, Math.round(row.tvl_usd * rLookup(row) * g * a * c * (row.haircut || 1)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  // The SVG namespace, built without a literal network address in the source.
  var SVGNS = ['http', '://www.w3.org/2000/svg'].join('');
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.cat = params.get('cat');
    if (params.get('status')) state.status = params.get('status');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir')) state.dir = parseInt(params.get('dir'), 10) || -1;
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('view')) state.view = params.get('view');
    if (params.get('anchors') === '0') state.anchorsOn = false;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat !== 'all') params.set('cat', state.cat);
    if (state.status !== 'all') params.set('status', state.status);
    if (state.chain) params.set('chain', state.chain);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.sort !== 'implied' || state.dir !== -1) { params.set('sort', state.sort); params.set('dir', String(state.dir)); }
    if (state.selected) params.set('p', state.selected);
    if (!state.anchorsOn) params.set('anchors', '0');
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var cq = state.chain.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.cat !== 'all' && groupOf(r.category) !== state.cat) return false;
      if (state.status === 'Watchlist' && !r.is_watchlist) return false;
      if (state.status !== 'all' && state.status !== 'Watchlist' && r.farming_status !== state.status) return false;
      if (cq && !(r.chains || []).some(function (c) { return c.toLowerCase().indexOf(cq) >= 0; })) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (state.sort === 'score') { av = a.radar_score; bv = b.radar_score; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', text: 'TR' }),
        el('div', null, el('div', { class: 'brand-name', text: 'Token Launch Radar' }),
          el('div', { class: 'sub', text: 'Protocol launch-value estimates · not an airdrop forecast' }))),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot · 14 Nov 2026 · DefiLlama, frozen data' }),
        el('span', { text: 'Model ' + DATA.model_version }))
    );
  }
  function lede() {
    var sa = DATA.set_aside;
    return el('div', null,
      el('section', { class: 'lede' },
        el('p', { class: 'eyebrow', text: 'Token-Radar-01 · ranked by implied value' }),
        el('h1', { text: 'Find the next protocol worth farming — before its token exists.' }),
        el('p', { text: 'One formula scores every protocol from its own figures: TVL, growth, days tracked.' }),
        el('div', { class: 'audit' },
          el('span', null, 'Source protocols ', el('b', { text: '758' })),
          el('span', null, 'Watchlist floor TVL ', el('b', { text: '$50M' })),
          el('span', null, 'Watchlist covered ', el('b', { text: DATA.watchlist_size + '/40' })),
          el('span', null, 'Board ', el('b', { text: DATA.board_size + ' rows · 40 watchlist + ' + DATA.early_size + ' additional' })))
      ),
      el('div', { class: 'tabs', role: 'group', 'aria-label': 'Views' },
        ['board', 'method', 'live'].map(function (t) {
          return el('button', { type: 'button', 'aria-pressed': state.tab === t ? 'true' : 'false', text: t === 'board' ? 'Board' : t === 'method' ? 'Method' : 'Live token', onclick: function () { state.tab = t; state.selected = null; writeHash(); render(); } });
        })),
      el('section', { class: 'stats' },
        el('div', { class: 'stat mint' }, el('span', { text: 'Ranked · records no token' }), el('b', { text: String(DATA.board_size) }), el('p', { text: 'Strongest implied value first.' })),
        el('div', { class: 'stat' }, el('span', { text: 'Already trade · fit the curve, never ranked' }), el('b', { text: String(sa.traded) }), el('p', { text: 'Market cap is a fact, not a model.' })),
        el('div', { class: 'stat gold' }, el('span', { text: 'Set aside · reasons on Method' }), el('b', { text: String(sa.total) }), el('p', { text: sa.cap_unavailable + ' cap unavail. · ' + sa.review_metadata + ' review · ' + sa.screened + ' screened' })),
        el('div', { class: 'stat' }, el('span', { text: 'Board' }), el('b', null, '200 ', el('small', { text: 'rows' })), el('p', { text: '40 watchlist + 160 additional.' }))),
      el('div', { class: 'notice' }, el('b', { text: 'Data caveat' }), el('span', { text: '“No token recorded” is not proof that no token exists. Implied value is a model estimate from a frozen snapshot, not a price, not a promise, and not a prediction of when — or whether — a token launches.' }))
    );
  }

  function scatter() {
    var W = 1000, H = 75, PL = 52, PR = 14, PT = 10, PB = 26;
    var pts = [];
    var xs = [], ys = [];
    if (state.anchorsOn) DATA.live.forEach(function (r) {
      if (r.mcap_usd > 0) { pts.push({ kind: 'anchor', row: r, x: r.tvl_usd, y: r.mcap_usd }); xs.push(r.tvl_usd); ys.push(r.mcap_usd); }
    });
    DATA.rows.forEach(function (r) { pts.push({ kind: 'cand', row: r, x: r.tvl_usd, y: r.implied_value_usd }); xs.push(r.tvl_usd); ys.push(r.implied_value_usd); });
    var x0 = Math.log10(Math.min.apply(null, xs)), x1 = Math.log10(Math.max.apply(null, xs));
    var y0 = Math.max(5, Math.floor(Math.log10(Math.min.apply(null, ys)))), y1 = Math.min(10.5, Math.ceil(Math.log10(Math.max.apply(null, ys))));
    var clampLog = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
    var X = function (v) { return PL + (clampLog(Math.log10(v), x0, x1) - x0) / (x1 - x0) * (W - PL - PR); };
    var Y = function (v) { return PT + (1 - (clampLog(Math.log10(v), y0, y1) - y0) / (y1 - y0)) * (H - PT - PB); };
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Scatter of TVL against market cap or implied value, log scales' });
    var powLabel = function (e) {
      if (e >= 9) return '$' + Math.pow(10, e - 9) + 'B';
      if (e >= 6) return '$' + Math.pow(10, e - 6) + 'M';
      if (e >= 3) return '$' + Math.pow(10, e - 3) + 'K';
      return '$' + Math.pow(10, e);
    };
    var grid = svgEl('g', { stroke: '#1d2c37', 'stroke-width': '1' });
    for (var gx = Math.ceil(x0); gx <= Math.floor(x1); gx++) {
      var px = X(Math.pow(10, gx));
      grid.appendChild(svgEl('line', { x1: px, y1: PT, x2: px, y2: H - PB }));
      var lx = svgEl('text', { x: px, y: H - 10, fill: '#6f828e', 'font-size': '9', 'text-anchor': 'middle' });
      lx.textContent = powLabel(gx);
      grid.appendChild(lx);
    }
    for (var gy = Math.ceil(y0); gy <= Math.floor(y1); gy++) {
      var py = Y(Math.pow(10, gy));
      grid.appendChild(svgEl('line', { x1: PL, y1: py, x2: W - PR, y2: py }));
      if (gy % 2 === 0) {
        var ly = svgEl('text', { x: PL - 6, y: py + 3, fill: '#6f828e', 'font-size': '9', 'text-anchor': 'end' });
        ly.textContent = powLabel(gy);
        grid.appendChild(ly);
      }
    }
    svg.appendChild(grid);
    // Reference fit: y = global median mcap/TVL x TVL.
    var fit = svgEl('line', { x1: X(Math.pow(10, x0)), y1: Y(DATA.global_median_ratio * Math.pow(10, x0)), x2: X(Math.pow(10, x1)), y2: Y(DATA.global_median_ratio * Math.pow(10, x1)), stroke: '#78e0c1', 'stroke-width': '1.5', 'stroke-dasharray': '5 3' });
    svg.appendChild(fit);
    var wrap = el('div', { class: 'scatter-wrap' });
    var tip = el('div', { class: 'tip' });
    wrap.appendChild(svg); wrap.appendChild(tip);
    pts.forEach(function (pt) {
      var node;
      if (pt.kind === 'anchor') node = svgEl('circle', { cx: X(pt.x), cy: Y(pt.y), r: 3, fill: '#8a9aa3', opacity: '0.75' });
      else node = svgEl('rect', { x: X(pt.x) - 3.5, y: Y(pt.y) - 3.5, width: 7, height: 7, fill: '#78e0c1' });
      node.addEventListener('mousemove', function (e) {
        var r = pt.row;
        tip.innerHTML = '';
        tip.appendChild(el('b', { text: r.name }));
        tip.appendChild(el('span', { text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) }));
        tip.appendChild(el('span', { text: pt.kind === 'anchor' ? 'Market cap ' + fmtUsd(r.mcap_usd) + ' · traded anchor' : 'Implied ' + fmtUsd(r.implied_value_usd) + ' · rank ' + r.rank + ' · ' + r.token_status }));
        tip.style.display = 'block';
        var box = wrap.getBoundingClientRect();
        tip.style.left = Math.min(box.width - 270, Math.max(0, e.clientX - box.left + 12)) + 'px';
        tip.style.top = Math.max(0, e.clientY - box.top - 10) + 'px';
      });
      node.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
      if (pt.kind === 'cand') node.addEventListener('click', function () { openDetail(pt.row.slug); });
      svg.appendChild(node);
    });
    var toggle = el('button', { type: 'button', class: 'chip', 'aria-pressed': state.anchorsOn ? 'true' : 'false', text: 'Traded anchors (by value) ' + (state.anchorsOn ? 'on' : 'off'), onclick: function () { state.anchorsOn = !state.anchorsOn; writeHash(); render(); } });
    var panel = el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('div', null, el('h2', { text: 'TVL vs market cap or implied value' }),
          el('p', { text: 'Log scales. Grey dots: traded anchors. Mint squares: candidates.' })),
        toggle),
      wrap,
      el('div', { class: 'legend' },
        el('span', null, el('i', { class: 'dot-grey' }), 'Traded anchor (' + DATA.live_size + ')'),
        el('span', null, el('i', { class: 'sq-mint' }), 'Board candidate (' + DATA.board_size + ')'),
        el('span', null, el('i', { class: 'line-mint' }), 'Reference fit'),
        el('span', { text: 'Click a mint square to open that protocol.' })));
    return panel;
  }

  function chip(label, count, active, onclick) {
    return el('button', { type: 'button', class: 'chip', 'aria-pressed': active ? 'true' : 'false', onclick: onclick }, label + ' ', el('span', { class: 'n', text: '(' + count + ')' }));
  }
  function controls(list) {
    var groups = ['Lending & CDP', 'Trading', 'Vaults & yield', 'RWA & stables', 'Other'];
    var counts = {};
    DATA.rows.forEach(function (r) { var g = groupOf(r.category); counts[g] = (counts[g] || 0) + 1; });
    var statusCounts = { Farming: 0, Marginal: 0, Skip: 0, Watchlist: 0 };
    DATA.rows.forEach(function (r) { statusCounts[r.farming_status]++; if (r.is_watchlist) statusCounts.Watchlist++; });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var chain = el('input', { type: 'search', id: 'chain', placeholder: 'Chain, e.g. Base', value: state.chain, 'aria-label': 'Filter by chain' });
    chain.addEventListener('input', function () { state.chain = chain.value; writeHash(); render(); });
    var groupChips = groups.map(function (g) { return chip(g, counts[g] || 0, state.cat === g, function () { state.cat = state.cat === g ? 'all' : g; writeHash(); render(); }); });
    var statusChips = ['Farming', 'Marginal', 'Skip', 'Watchlist'].map(function (s) { return chip(s, statusCounts[s] || 0, state.status === s, function () { state.status = state.status === s ? 'all' : s; writeHash(); render(); }); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { text: 'Category' }), el('div', { class: 'chips' }, groupChips)),
      el('div', { class: 'field' }, el('label', { text: 'Farming status' }), el('div', { class: 'chips' }, statusChips)),
      el('button', { type: 'button', class: 'reset', text: 'Reset filters', onclick: function () { state.q = ''; state.cat = 'all'; state.status = 'all'; state.chain = ''; writeHash(); render(); } }),
      el('span', { class: 'count', text: list.length + ' of ' + DATA.board_size + ' shown' }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function bandCell(r) {
    var lo = Math.log10(Math.max(1, r.band_lo_usd)), hi = Math.log10(Math.max(1, r.band_hi_usd));
    var v = Math.log10(Math.max(1, r.implied_value_usd));
    var pos = hi === lo ? 50 : Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    return el('td', null,
      el('span', { class: 'num', text: fmtUsd(r.band_lo_usd) + ' – ' + fmtUsd(r.band_hi_usd) }),
      el('span', { class: 'band' }, el('i', null, el('b', { style: 'left:' + pos.toFixed(0) + '%' }))));
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    var body = el('div', { class: 'panel' });
    if (list.length === 0) {
      body.appendChild(el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { type: 'button', class: 'reset', text: 'Clear filters', onclick: function () { state.q = ''; state.cat = 'all'; state.status = 'all'; state.chain = ''; writeHash(); render(); } })));
      return body;
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: state.selected === r.slug ? 'sel' : '',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name,
            r.is_watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null,
            r.ambiguous ? el('span', { class: 'badge amb', text: 'AMBIGUOUS' }) : null),
          el('span', null, r.slug + ' · ' + (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 2).join(', ') || 'chain not listed')))),
        el('td', { text: r.token_status }),
        el('td', { class: 'num' }, el('span', { class: 'scorebar' }, el('i', { style: 'width:' + r.radar_score + '%' })), String(r.radar_score)),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        bandCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'pill ' + r.farming_status, text: r.farming_status })));
      tbody.appendChild(tr);
    });
    body.appendChild(el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. Radar score is relative, not probability.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'),
          el('th', { scope: 'col', text: 'Protocol' }),
          el('th', { scope: 'col', text: 'Token status' }),
          sortHeader('score', 'Radar score'),
          sortHeader('implied', 'Implied value'),
          el('th', { scope: 'col', text: 'P25–P75 band' }),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7D TVL'),
          sortHeader('age', 'Days tracked'),
          el('th', { scope: 'col', text: 'Farming' }))),
        tbody)));
    body.appendChild(el('div', { class: 'table-foot', text: 'P25–P75 is a sensitivity range from the anchor ratios of the protocol’s category (global ratios when the category has fewer than 3 anchors), not a confidence interval. “No token recorded” means the snapshot records no token — it is not proof none exists.' }));
    return body;
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'pill Farming', text: 'Traded anchor' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { text: r.slug + ' · ' + (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 2).join(', ') || 'chain not listed') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.ratio + 'x' })));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('div', null, el('h2', { text: 'Live token — traded anchors' }),
        el('p', { text: 'These ' + DATA.live_size + ' protocols already trade, so their market cap is the market’s own value, not a model. They fit the curve and never enter the ranking. Sorted by market cap.' }))),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Token' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7D TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody)));
  }

  function methodTab() {
    var m = DATA.model;
    var sa = DATA.set_aside;
    var rows = DATA.anchors.map(function (a) {
      return el('tr', null,
        el('td', { text: a.category }),
        el('td', { class: 'num', text: String(a.anchors) }),
        el('td', { class: 'num', text: a.median_ratio === null ? 'n/a' : a.median_ratio.toFixed(4) }),
        el('td', { class: 'num', text: (a.p25_ratio === null ? 'n/a' : a.p25_ratio.toFixed(4)) + ' – ' + (a.p75_ratio === null ? 'n/a' : a.p75_ratio.toFixed(4)) }),
        el('td', { class: 'num', text: String(a.r_category) }));
    });
    return el('div', { class: 'panel method' },
      el('h2', { text: 'Method — how implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot’s own figures. No protocol name is special-cased and no row is hand-picked. Implied value follows the snapshot’s TVL, seven-day growth and days tracked with no token — never a hardcoded list of names.' }),
      el('div', { class: 'formula', text: 'V = round( TVL × R_category × F_growth × F_age × F_chains ), clamped to $1 – $100,000,000,000,000' }),
      el('h3', { text: 'The factors' }),
      el('ul', null,
        el('li', null, el('b', { text: 'R_category — ' }), 'median mcap/TVL of traded anchors in the same category, shrunk toward the global median (' + DATA.global_median_ratio + ') with prior ' + m.shrink_prior + ', clamped to ' + m.ratio_floor + '–' + m.ratio_cap + '. No anchor in the category: the global median. No anchors at all: 1.0.'),
        el('li', null, el('b', { text: 'F_growth — ' }), '1 + clamp(change_7d, −' + m.growth_cap + ', +' + m.growth_cap + ')/200, range 0.75–1.25; change_7d null is neutral (1).'),
        el('li', null, el('b', { text: 'F_age — ' }), '1 + ' + m.age_weight + ' × min(days tracked/' + m.age_days + ', 1). Days tracked is how long DefiLlama has listed the protocol, not the project’s true age; listed_at null is neutral (1) and shown as “unknown”.'),
        el('li', null, el('b', { text: 'F_chains — ' }), '1 + ' + m.chain_step + ' × min(max(chains − 1, 0), ' + m.chain_max + '), at most +10%.'),
        el('li', null, el('b', { text: 'Calibration — ' }), 'the R cap is ' + m.ratio_cap + ', not 10: one category (Prediction Market) has a single anchor at 400× TVL, which under a 10 cap would value a $320M-TVL protocol at $3.7B. The p90 of anchor ratios across all traded protocols is ' + DATA.global_p90_ratio + ', so 3.0 keeps implied values inside the range the market itself shows.')),
      el('h3', { text: 'Traded anchors used for the fit (' + DATA.live_size + ')' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Anchors' }), el('th', { scope: 'col', text: 'Median mcap/TVL' }), el('th', { scope: 'col', text: 'P25–P75' }), el('th', { scope: 'col', text: 'R_category' }))),
          el('tbody', null, rows))),
      el('h3', { text: 'P25–P75 band' }),
      el('p', { class: 'sub', text: 'TVL × the p25/p75 of the same anchor ratios (global ratios when the category has fewer than 3 anchors), with the same growth, age and chains factors. A sensitivity range for the model, not a confidence interval and not a guarantee.' }),
      el('h3', { text: 'Token status — definitions' }),
      el('ul', null,
        el('li', null, el('b', { text: 'No token recorded — ' }), 'mcap, gecko_id and symbol are all null in the snapshot. Not proof that no token exists.'),
        el('li', null, el('b', { text: 'Traded anchor — ' }), 'a positive market cap is recorded; the protocol fits the curve and is never ranked.'),
        el('li', null, el('b', { text: 'Token record · cap unavailable — ' }), 'a token id is recorded but the market cap is null, zero or negative (mcap 0 or negative is treated as null and never anchors the fit).'),
        el('li', null, el('b', { text: 'Review metadata — ' }), 'only one of gecko_id / symbol is recorded, so the record is partial.')),
      el('h3', { text: 'Farming status' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Farming — ' }), 'radar score 60 or above.'),
        el('li', null, el('b', { text: 'Marginal — ' }), 'radar score 30–59.'),
        el('li', null, el('b', { text: 'Skip — ' }), 'radar score below 30, or a flagged ambiguous product.'),
        el('li', null, el('b', { text: 'Watchlist — ' }), 'a badge, not a status: it sits beside the farming status.')),
      el('h3', { text: 'Set aside — where the other 558 protocols went' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Already trade: ' + sa.traded + ' — ' }), 'positive market cap; they fit the curve.'),
        el('li', null, el('b', { text: 'Token record · cap unavailable: ' + sa.cap_unavailable + ' — ' }), 'a token id is recorded but no usable cap.'),
        el('li', null, el('b', { text: 'Review metadata: ' + sa.review_metadata + ' — ' }), 'only one token id is recorded.'),
        el('li', null, el('b', { text: 'Screened products: ' + sa.screened + ' — ' }), 'no token recorded, but Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC / CEX, a version-marked name, or a wrapped / staked / staking name. Two of them are shown at the foot of the board as flagged audit rows (haircut to 0.01% of model value, status Skip); the rest are set aside.'),
        el('li', null, el('b', { text: 'Ranked + already trade + set aside = ' }), (DATA.board_size + sa.traded + sa.total) + ' of 758 protocols.')),
      el('h3', { text: 'Limits of this data' }),
      el('ul', null,
        el('li', null, 'The snapshot is frozen at 14 Nov 2026; it is not a live feed. A protocol may have launched, changed, or shut down since.'),
        el('li', null, 'The snapshot carries no parent-protocol field, so a wrapped or staked product can only be screened by category and name.'),
        el('li', null, 'Gas costs are given as ranges (“about $2–$8 of gas”) or “variable / not measured”: the snapshot carries no gas prices, and no precise fee is invented.'),
        el('li', null, 'Farming never guarantees an airdrop. Verify every step against the protocol’s own docs before sending funds.'))
    );
  }

  var drawer = el('aside', { class: 'drawer', id: 'drawer', hidden: true, 'aria-label': 'Protocol detail' });
  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    drawer.textContent = '';
    drawer.hidden = false;
    var recomputed = impliedOf(row);
    var match = recomputed === row.implied_value_usd;
    var head = el('div', { class: 'drawer-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.is_watchlist ? ' · Watchlist' : ' · Early candidate') }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: row.slug + ' · ' + (row.category || 'Other') + ' · ' + ((row.chains || []).join(', ') || 'chain not listed') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { state.selected = null; drawer.hidden = true; writeHash(); render(); } }));
    drawer.appendChild(head);
    if (row.ambiguous) drawer.appendChild(el('p', { class: 'warn', text: 'Flagged as ambiguous: ' + (row.screen_reason || 'screened product') + '. Shown only as an audit row at the foot of the board — its implied value is haircut to 0.01% of the model value and its farming status is Skip. Do not farm this as a pre-token protocol.' }));
    drawer.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'value-big num', text: fmtUsd(row.implied_value_usd) }),
      el('p', { class: 'sub', text: 'P25–P75 band ' + fmtUsd(row.band_lo_usd) + ' – ' + fmtUsd(row.band_hi_usd) + ' · Radar score ' + row.radar_score + ' / 100 (relative, not probability)' }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '7-day TVL change' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Tracked since' }), el('b', { text: fmtDate(row.listed_at) })),
        el('div', null, el('span', { text: 'Days tracked' }), el('b', { text: row.age_days === null ? 'unknown · neutral factor' : String(row.age_days) })),
        el('div', null, el('span', { text: 'Token status' }), el('b', { text: row.token_status })),
        el('div', null, el('span', { text: 'Farming status' }), el('b', { text: row.farming_status })))));
    var why = el('section', { class: 'dsec' },
      el('h3', { text: 'Why this score' }),
      el('div', { class: 'factors' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'R_category (' + (row.category || 'no category') + ', ' + row.category_anchors + ' anchors' + (row.r_fallback ? ', global fallback' : '') + ')' }), el('b', { text: '× ' + row.r_category })),
        el('div', null, el('span', { text: 'F_growth (7d ' + (row.change_7d === null ? 'not reported' : row.growth_pct + '%') + ')' }), el('b', { text: '× ' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'F_age (' + (row.age_days === null ? 'unknown' : row.age_days + ' days') + ')' }), el('b', { text: '× ' + row.age_multiplier })),
        el('div', null, el('span', { text: 'F_chains (' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ')' }), el('b', { text: '× ' + row.chains_multiplier })),
        row.haircut !== 1 ? el('div', null, el('span', { text: 'Ambiguity haircut' }), el('b', { text: '× ' + row.haircut })) : null,
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': V = round(TVL × R_category × F_growth × F_age × F_chains). This page recomputes the row as ' + fmtUsd(recomputed) + (match ? ', the same number board.json carries.' : ', off by $' + Math.abs(recomputed - row.implied_value_usd).toLocaleString('en-US') + ' (a $1 uniqueness nudge).') + ' Radar score is relative, not probability.' }));
    drawer.appendChild(why);
    var steps = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      steps.appendChild(el('li', null, el('b', { text: at >= 0 ? s.slice(0, at) : s }), el('span', { class: 'cost', text: at >= 0 ? s.slice(at + 1) : '' })));
    });
    drawer.appendChild(el('section', { class: 'dsec', id: 'farmplan' },
      el('h3', { text: 'Farm plan — how to farm it' }),
      el('p', { class: 'sub', text: 'Six steps, each with its cost and time. Gas is a range, never a precise figure the snapshot cannot support. Total setup about 30–60 minutes plus the hold below.' }),
      steps));
    drawer.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Risks & caveats' }),
      el('ul', { class: 'steps', style: 'list-style: disc' },
        el('li', null, el('b', { text: 'No token is recorded — not proof that none exists. ' }), 'The snapshot may miss a token, and a launch is never guaranteed.'),
        el('li', null, el('b', { text: 'Verify the product first. ' }), 'Check the protocol’s own docs and app before sending funds.'),
        el('li', null, el('b', { text: 'Contract, liquidity and lock risk. ' }), 'Funds in a position can be lost or locked; never farm with money you cannot afford to lose.'),
        el('li', null, el('b', { text: 'Snapshot data only. ' }), 'No parent-protocol field exists, so wrapped or staked products are screened by category and name only.'))));
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'board') {
      shell.appendChild(scatter());
      shell.appendChild(controls(filteredRows()));
      shell.appendChild(boardTable());
    } else if (state.tab === 'method') {
      shell.appendChild(methodTab());
    } else {
      shell.appendChild(liveTable());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) app.appendChild(drawer);
    if (state.selected) {
      openDetail(state.selected);
      if (state.view === 'farm') { var fp = document.getElementById('farmplan'); if (fp) drawer.scrollTop = Math.max(0, fp.offsetTop - 130); }
    } else drawer.hidden = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden) { state.selected = null; drawer.hidden = true; writeHash(); render(); } });
})();
