// ---------- Tabs ----------
function switchTab(tab) {
  try {
    setActive('viewAdd', tab === 'add');
    setActive('viewSearch', tab === 'search');
    setActive('viewSummary', tab === 'summary');
    setActive('viewReceivables', tab === 'receivables');
    setActive('tabAddBtn', tab === 'add');
    setActive('tabSearchBtn', tab === 'search');
    setActive('tabSummaryBtn', tab === 'summary');
    setActive('tabReceivablesBtn', tab === 'receivables');
    if (tab === 'summary') loadSummary();
    if (tab === 'receivables') loadReceivables();
    if (tab === 'add') loadRecent();
  } catch (err) {
    console.error('switchTab failed:', err);
    showToast('App files look out of date — see README troubleshooting');
  }
}
function setActive(id, isActive) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('active', isActive);
}

// ---------- Small DOM helpers (never throw if an element is missing) ----------
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}
function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) { console.warn('toast element missing:', msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2200);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function formatMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return String(v);
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function generateClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

// The backend stamps every response with a version number (BACKEND_VERSION in
// Code.gs). If it's missing entirely, the live Apps Script deployment is still
// running an older script that doesn't know this endpoint -- almost always
// because Code.gs was saved but never redeployed as a "New version". Checking
// this turns that into a clear message instead of a confusing crash.
const REQUIRED_BACKEND_VERSION = 9;
// Bump this alongside meaningful app.js changes. Shown in Settings so you can
// confirm which build is actually running on a device without DevTools.
const FRONTEND_VERSION = 17;
function checkBackendResponse(res, shapeCheckFn) {
  if (!res || typeof res.version === 'undefined') {
    throw new Error('Backend is out of date. In Apps Script: Deploy → Manage deployments → Edit → New version → Deploy.');
  }
  if (!res.success) {
    throw new Error(res.error || 'Backend error');
  }
  if (shapeCheckFn && !shapeCheckFn(res.data)) {
    throw new Error('Unexpected response shape — Code.gs may not match this version of the app.');
  }
  return res;
}

// ---------- In-app confirm modal (native confirm() is unreliable in standalone PWAs) ----------
let confirmResolve = null;
function showConfirm(message, title) {
  const titleEl = document.getElementById('confirmTitle');
  const msgEl = document.getElementById('confirmMessage');
  const modal = document.getElementById('confirmModal');
  if (!modal || !titleEl || !msgEl) {
    console.warn('Confirm modal missing from page, falling back to auto-cancel for safety');
    return Promise.resolve(false);
  }
  titleEl.textContent = title || 'Confirm';
  msgEl.textContent = message;
  modal.style.display = 'flex';
  return new Promise(function (resolve) { confirmResolve = resolve; });
}
function closeConfirm(result) {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.style.display = 'none';
  if (confirmResolve) { confirmResolve(!!result); confirmResolve = null; }
}

// ---------- Live date/time (device clock) ----------
function pad(n) { return n < 10 ? '0' + n : n; }
function updateClock() {
  const d = new Date();
  setVal('date', d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
  setVal('time', pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()));
}
updateClock();
setInterval(updateClock, 1000);

// ---------- Connection status ----------
function renderStatus() {
  const bar = document.getElementById('statusBar');
  if (!bar) return;
  if (navigator.onLine) {
    bar.textContent = 'Online — changes sync instantly (tap to refresh)';
    bar.classList.remove('offline');
  } else {
    bar.textContent = 'Offline — entries are saved on this device and will sync automatically';
    bar.classList.add('offline');
  }
}
window.addEventListener('online', function () { renderStatus(); syncQueue(); });
window.addEventListener('offline', renderStatus);
renderStatus();

function hasValidBackendConfig() {
  return typeof BACKEND_URL === 'string' && BACKEND_URL && BACKEND_URL.indexOf('PASTE_YOUR') === -1;
}

// ---------- Dropdown options (fetched from backend, cached for offline use) ----------
let options = { txnType: [], txnFromTo: [], category: [] };

function populateDropdowns() {
  fill('txnType', options.txnType);
  fill('txnFrom', options.txnFromTo);
  fill('txnTo', options.txnFromTo);
  fill('sTxnType', options.txnType, 'Any');
  fill('sAccount', options.txnFromTo, 'Any');
  populateSummaryPeriod();
  // Category fields are searchable comboboxes (see setupCombo below) -- they read
  // options.category live via a getter, so there's no separate "fill" step needed
  // here; new/changed categories just show up next time the list is opened.
}
function populateSummaryPeriod() {
  const el = document.getElementById('summaryPeriod');
  if (!el) return;
  const saved = localStorage.getItem('summaryPeriod') || '';
  fill('summaryPeriod', options.months, 'Current (auto)');
  el.value = saved; // fill() resets to the placeholder; restore whatever was last selected
}
function onSummaryPeriodChange() {
  const el = document.getElementById('summaryPeriod');
  if (!el) return;
  localStorage.setItem('summaryPeriod', el.value);
  loadSummary();
}
function fill(id, list, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<option value="">' + (placeholder || 'Select…') + '</option>';
  (list || []).forEach(function (v) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    el.appendChild(opt);
  });
}

/**
 * A type-to-search combobox: a plain text input backed by a filtered dropdown list.
 * getOptionsFn is called fresh every time the list opens/filters, so it always
 * reflects the current options.category array -- no separate "refill" step needed
 * when the dropdown data loads or changes. Typed text that doesn't exactly match a
 * known option is still allowed through (categories aren't strictly validated
 * server-side either), but gets a visual "unmatched" hint so a typo is noticeable
 * rather than silently mismapping the ledger.
 */
function setupCombo(inputId, listId, getOptionsFn) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return { getValue: function () { return ''; }, setValue: function () {} };

  function renderList(filterText) {
    const opts = getOptionsFn() || [];
    const q = (filterText || '').trim().toLowerCase();
    const filtered = q ? opts.filter(function (o) { return o.toLowerCase().indexOf(q) !== -1; }) : opts;
    list.innerHTML = filtered.length
      ? filtered.map(function (o) { return '<div class="combo-item" data-val="' + escapeHtml(o) + '">' + escapeHtml(o) + '</div>'; }).join('')
      : '<div class="combo-empty">No matches</div>';
    list.style.display = 'block';
  }

  function updateValidityHint() {
    const opts = getOptionsFn() || [];
    const v = input.value.trim();
    input.classList.toggle('invalid', v !== '' && opts.indexOf(v) === -1);
  }

  input.addEventListener('focus', function () { renderList(input.value); });
  input.addEventListener('input', function () { renderList(input.value); updateValidityHint(); });
  input.addEventListener('blur', function () {
    // Delay so a tap on a list item (see pointerdown below) registers first.
    setTimeout(function () { list.style.display = 'none'; updateValidityHint(); }, 150);
  });
  list.addEventListener('pointerdown', function (e) {
    const item = e.target.closest('.combo-item');
    if (!item) return;
    input.value = item.getAttribute('data-val');
    list.style.display = 'none';
    updateValidityHint();
  });

  return {
    getValue: function () { return input.value.trim(); },
    setValue: function (v) { input.value = v || ''; updateValidityHint(); }
  };
}

const categoryCombo = setupCombo('categoryInput', 'categoryList', function () { return options.category; });
const searchCategoryCombo = setupCombo('sCategoryInput', 'sCategoryList', function () { return options.category; });

function loadOptions() {
  if (!navigator.onLine) { loadCachedOptions(); return; }
  if (!hasValidBackendConfig()) {
    showToast('config.js: BACKEND_URL is not set yet');
    loadCachedOptions();
    return;
  }

  fetch(BACKEND_URL + '?page=options&key=' + encodeURIComponent(API_KEY))
    .then(function (r) {
      if (!r.ok) throw new Error('Backend returned HTTP ' + r.status);
      return r.json();
    })
    .then(function (res) {
      checkBackendResponse(res, function (d) { return d && Array.isArray(d.txnType); });
      options = res.data;
      localStorage.setItem('ddOptions', JSON.stringify(options));
      populateDropdowns();
    })
    .catch(function (err) {
      console.error('loadOptions failed:', err);
      showToast('Dropdown load failed: ' + err.message);
      loadCachedOptions();
    });
}
function loadCachedOptions() {
  const cached = localStorage.getItem('ddOptions');
  if (cached) { options = JSON.parse(cached); populateDropdowns(); }
}
loadOptions();

const statusBarEl = document.getElementById('statusBar');
if (statusBarEl) {
  statusBarEl.addEventListener('click', function () {
    showToast('Refreshing…');
    loadOptions();
    syncQueue();
    loadRecent();
    if (document.getElementById('viewSummary') && document.getElementById('viewSummary').classList.contains('active')) loadSummary();
    if (document.getElementById('viewReceivables') && document.getElementById('viewReceivables').classList.contains('active')) loadReceivables();
  });
}

// ---------- Summary tab (balances + budget) ----------
function loadSummary() {
  if (!navigator.onLine) { renderSummaryFromCache(); return; }
  if (!hasValidBackendConfig()) {
    showToast('config.js: BACKEND_URL is not set yet');
    renderSummaryFromCache();
    return;
  }

  const period = localStorage.getItem('summaryPeriod') || '';
  const url = BACKEND_URL + '?page=summary&key=' + encodeURIComponent(API_KEY) +
    (period ? '&period=' + encodeURIComponent(period) : '');

  fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('Backend returned HTTP ' + r.status);
      return r.json();
    })
    .then(function (res) {
      checkBackendResponse(res, function (d) { return d && d.funds && d.budget; });
      localStorage.setItem('summaryData', JSON.stringify(res.data));
      renderSummary(res.data);
    })
    .catch(function (err) {
      console.error('loadSummary failed:', err);
      showToast('Summary load failed: ' + err.message);
      renderSummaryFromCache();
    });
}
function renderSummaryFromCache() {
  const cached = localStorage.getItem('summaryData');
  if (cached) renderSummary(JSON.parse(cached));
}
function renderSummary(data) {
  renderLiquidScorecard(data.funds);
  renderTakeoutIndex(data.funds);
  renderFunds(data.funds);
  renderIncome(data.income);
  renderBudget(data.budget);
}

function renderLiquidScorecard(funds) {
  const valueEl = document.getElementById('liquidValue');
  const subEl = document.getElementById('liquidSub');
  if (!valueEl) return;
  valueEl.textContent = (funds && typeof funds.totalLiquid === 'number') ? formatMoney(funds.totalLiquid) : '—';
  const parts = [];
  if (funds && funds.period) parts.push(funds.period);
  if (funds && funds.asOfDate) parts.push('as of ' + funds.asOfDate);
  if (subEl) subEl.textContent = parts.join(' · ');
}

function renderTakeoutIndex(funds) {
  const card = document.getElementById('takeoutScorecard');
  const labelEl = document.getElementById('takeoutLabel');
  const valueEl = document.getElementById('takeoutValue');
  const targetEl = document.getElementById('takeoutTarget');
  const addedEl = document.getElementById('takeoutAdded');
  if (!card || !valueEl) return;

  const idx = funds && funds.takeoutIndex;
  if (!idx || typeof idx.value !== 'number') {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  card.classList.remove('positive', 'negative', 'zero');
  if (idx.value > 0) card.classList.add('positive');
  else if (idx.value < 0) card.classList.add('negative');
  else card.classList.add('zero');

  if (labelEl && idx.label) labelEl.textContent = idx.label;
  valueEl.textContent = formatMoney(idx.value);
  if (targetEl) targetEl.textContent = typeof idx.target === 'number' ? formatMoney(idx.target) : '';
  if (addedEl) addedEl.textContent = typeof idx.addedThisMonth === 'number' ? 'Added this month: ' + formatMoney(idx.addedThisMonth) : '';
}

function renderFunds(funds) {
  const label = document.getElementById('fundsPeriodLabel');
  const grid = document.getElementById('fundsGrid');
  if (!grid) return;
  if (label) label.textContent = 'Account Balances' + (funds && funds.period ? ' — ' + funds.period : '');

  if (!funds || !funds.accounts || funds.accounts.length === 0) {
    grid.innerHTML = '<div class="empty-note">No FUNDS table found on the Summary sheet.</div>';
    return;
  }

  grid.innerHTML = funds.accounts.map(function (a) {
    let changeHtml = '';
    if (typeof a.openBal === 'number' && typeof a.closeBal === 'number') {
      const diff = a.closeBal - a.openBal;
      const cls = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
      const sign = diff > 0 ? '+' : '';
      changeHtml = '<div class="fund-change ' + cls + '">' + sign + formatMoney(diff) + ' this period</div>';
    } else if (typeof a.outflow === 'number') {
      // Investment-style rows show an icon instead of a numeric Open Balance, so there's
      // no close-minus-open to compute. Fall back to the Outflow Dur.Per (column D) value,
      // which on these rows is the amount added this period, not an actual outflow.
      const v = a.outflow;
      const cls = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
      const sign = v > 0 ? '+' : '';
      changeHtml = '<div class="fund-change ' + cls + '">' + sign + formatMoney(v) + ' this period</div>';
    }
    return '' +
      '<div class="fund-card">' +
        '<div class="fund-name">' + escapeHtml(a.name) + '</div>' +
        '<div class="fund-balance">' + formatMoney(a.closeBal) + '</div>' +
        changeHtml +
      '</div>';
  }).join('');
}

function renderIncome(income) {
  const label = document.getElementById('incomeMonthLabel');
  const card = document.getElementById('incomeCard');
  if (!card) return;
  if (label) label.textContent = 'Receipts' + (income && income.month ? ' — ' + income.month : '');

  if (!income || !income.items || income.items.length === 0) {
    card.innerHTML = '<div class="empty-note">No income block found for the current month.</div>';
    return;
  }

  let html = income.items.map(function (it) {
    return '<div class="income-row"><span>' + escapeHtml(it.source) + '</span><span class="receipt-amt">' + formatMoney(it.receipt) + '</span></div>';
  }).join('');
  html += '<div class="total-row" style="margin-top:10px;"><span>TOTAL RECEIPTS</span><span>' + formatMoney(income.total) + '</span></div>';

  card.innerHTML = html;
}

function renderBudget(budget) {
  const label = document.getElementById('budgetMonthLabel');
  const card = document.getElementById('budgetCard');
  if (!card) return;
  if (label) label.textContent = 'Budget vs Actual' + (budget && budget.month ? ' — ' + budget.month : '');

  if (!budget || !budget.categories || budget.categories.length === 0) {
    card.innerHTML = '<div class="empty-note">No budget block found for the current month.</div>';
    return;
  }

  // Only omit a category when BOTH budget and actual are zero/blank -- a category
  // with no budget allocated but real spending (e.g. an unplanned expense) still
  // needs to show up, just rendered differently (no % of budget to compute).
  const rowsHtml = budget.categories
    .filter(function (c) {
      const b = typeof c.budget === 'number' ? c.budget : 0;
      const a = typeof c.actual === 'number' ? c.actual : 0;
      return b !== 0 || a !== 0;
    })
    .map(function (c) {
      const b = typeof c.budget === 'number' ? c.budget : 0;
      const a = typeof c.actual === 'number' ? c.actual : 0;

      if (b <= 0) {
        // Spent with no budget allocated this month -- can't compute a % of budget,
        // so show it as a flagged "no budget" row instead of dividing by zero.
        return '' +
          '<div class="budget-row">' +
            '<div class="labels">' +
              '<span class="cat-name">' + escapeHtml(c.category) + '</span>' +
              '<span class="amounts">' + formatMoney(a) + ' <span class="pct-badge over">No budget</span></span>' +
            '</div>' +
            '<div class="bar-track"><div class="bar-fill over" style="width:100%"></div></div>' +
            '<div class="remaining-note">Spent with no budget allocated this month</div>' +
          '</div>';
      }

      const pct = (a / b) * 100;
      const barPct = Math.min(100, Math.max(0, pct));
      const cls = pct > 100 ? 'over' : (pct > 90 ? 'warn' : 'ok');
      const remaining = b - a;
      const remainingText = remaining >= 0
        ? formatMoney(remaining) + ' remaining'
        : formatMoney(Math.abs(remaining)) + ' over budget';
      return '' +
        '<div class="budget-row">' +
          '<div class="labels">' +
            '<span class="cat-name">' + escapeHtml(c.category) + '</span>' +
            '<span class="amounts">' + formatMoney(a) + ' / ' + formatMoney(b) +
              '<span class="pct-badge ' + cls + '">' + Math.round(pct) + '%</span>' +
            '</span>' +
          '</div>' +
          '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + barPct + '%"></div></div>' +
          '<div class="remaining-note">' + remainingText + '</div>' +
        '</div>';
    }).join('');

  // Total + variance goes BELOW the category list, not above it.
  let totalHtml = '';
  if (budget.total && typeof budget.total.budget === 'number' && typeof budget.total.actual === 'number') {
    const tb = budget.total.budget, ta = budget.total.actual;
    const varianceAmt = ta - tb;
    const variancePct = tb !== 0 ? (varianceAmt / tb) * 100 : 0;
    const varClass = varianceAmt > 0 ? 'over' : 'ok';
    totalHtml =
      '<div class="budget-total-block">' +
        '<div class="total-row"><span>TOTAL</span><span>' + formatMoney(ta) + ' / ' + formatMoney(tb) + '</span></div>' +
        '<div class="variance-row ' + varClass + '">' +
          '<span>Variance</span>' +
          '<span>' + (varianceAmt >= 0 ? '+' : '') + formatMoney(varianceAmt) +
            ' (' + (variancePct >= 0 ? '+' : '') + variancePct.toFixed(2) + '%)</span>' +
        '</div>' +
      '</div>';
  }

  card.innerHTML = (rowsHtml || '<div class="empty-note">No budgeted or actual spending this month.</div>') + totalHtml;
}

// ---------- Receivables tab ----------
// Data comes from the "Txn Working" sheet in ONE call: the DEBTORS table plus every debtor
// transaction. The debtor/month filter runs locally on that data, so it is instant and still
// works (on the last-synced data) when offline.
let receivablesData = null;

function loadReceivables() {
  if (!navigator.onLine) { renderReceivablesFromCache(); return; }
  if (!hasValidBackendConfig()) {
    showToast('config.js: BACKEND_URL is not set yet');
    renderReceivablesFromCache();
    return;
  }

  fetch(BACKEND_URL + '?page=receivables&key=' + encodeURIComponent(API_KEY))
    .then(function (r) {
      if (!r.ok) throw new Error('Backend returned HTTP ' + r.status);
      return r.json();
    })
    .then(function (res) {
      checkBackendResponse(res, function (d) { return d && d.table && Array.isArray(d.transactions); });
      localStorage.setItem('receivablesData', JSON.stringify(res.data));
      renderReceivables(res.data);
    })
    .catch(function (err) {
      console.error('loadReceivables failed:', err);
      showToast('Receivables: ' + err.message);
      renderReceivablesFromCache();
    });
}

function renderReceivablesFromCache() {
  const cached = localStorage.getItem('receivablesData');
  if (cached) {
    renderReceivables(JSON.parse(cached));
  } else {
    const card = document.getElementById('recvTableCard');
    if (card) card.innerHTML = '<div class="empty-note">No receivables data yet — connect to the internet and open this tab once.</div>';
  }
}

function renderReceivables(data) {
  receivablesData = data;
  renderRecvTable(data.table);
  populateRecvFilters(data);
  renderDebtorTxns();
}

// Plain number with Indian digit grouping (no currency symbol, to keep the table compact).
function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return String(v);
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
// Signed rupee amount for transaction rows, e.g. "-₹7,000" / "+₹3,000".
function fmtSignedMoney(v) {
  if (typeof v !== 'number') return formatMoney(v);
  return (v < 0 ? '-' : '+') + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// TOTAL-cell colouring: same flat "glowing" gradients as the Summary tab's scorecards --
// green for a positive (receivable) balance, red for negative. No magnitude scaling; this
// is meant to read at a glance the same way the scorecards do, not as a heatmap.
function recvTotalStyle(value) {
  if (typeof value !== 'number' || value === 0) return '';
  if (value < 0) return 'background:linear-gradient(135deg,#c5221f,#ea4335);color:#fff;box-shadow:0 2px 6px rgba(197,34,31,0.45);';
  return 'background:linear-gradient(135deg,#188038,#34a853);color:#fff;box-shadow:0 2px 6px rgba(24,128,56,0.45);';
}

function renderRecvTable(table) {
  const card = document.getElementById('recvTableCard');
  const title = document.getElementById('recvTitle');
  if (!card) return;
  if (title) title.textContent = (table && table.label ? table.label : 'Receivables') + ' (₹)';

  if (!table || !table.rows || table.rows.length === 0) {
    card.innerHTML = '<div class="empty-note">No DEBTORS table found on the Txn Working sheet.</div>';
    return;
  }

  const cols = (table.columns && table.columns.length === 4) ? table.columns : ['O/B', 'Given', 'Received', 'TOTAL'];
  const totalIdx = 3;

  // Rows whose TOTAL is zero (fully settled) are left out -- silently, no note; the
  // totals row above still accounts for them since it comes straight from the sheet.
  const visible = table.rows.filter(function (r) {
    const t = r.values[totalIdx];
    return !(t === null || (typeof t === 'number' && Math.abs(t) < 0.005));
  });

  if (visible.length === 0) {
    card.innerHTML = '<div class="empty-note">All debtor balances are settled.</div>';
    return;
  }

  let html = '<div class="table-wrap"><table class="recv-table"><thead><tr><th>Debtors</th>' +
    cols.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') +
    '</tr></thead><tbody>';

  visible.forEach(function (r) {
    html += '<tr><td class="name">' + escapeHtml(r.name) + '</td>';
    r.values.forEach(function (v, i) {
      if (i === totalIdx) {
        html += '<td class="total-cell" style="' + recvTotalStyle(v) + '">' + fmtNum(v) + '</td>';
      } else {
        html += '<td>' + fmtNum(v) + '</td>';
      }
    });
    html += '</tr>';
  });

  if (table.totals) {
    html += '<tr class="foot"><td class="name">' + escapeHtml(table.totals.label) + '</td>' +
      table.totals.values.map(function (v) { return '<td>' + fmtNum(v) + '</td>'; }).join('') + '</tr>';
  }
  html += '</tbody></table></div>';

  card.innerHTML = html;
}

function populateRecvFilters(data) {
  const dSel = document.getElementById('rDebtor');
  const mSel = document.getElementById('rMonth');
  if (!dSel || !mSel) return;
  const prevD = dSel.value, prevM = mSel.value;   // keep the current selection across refreshes
  fill('rDebtor', data.debtors, 'All debtors');
  fill('rMonth', data.months, 'All months');
  if ((data.debtors || []).indexOf(prevD) !== -1) dSel.value = prevD;
  if ((data.months || []).indexOf(prevM) !== -1) mSel.value = prevM;
}

// Opening Balance (O/B, the table's first value column) for the current debtor filter --
// a single debtor's O/B if one is selected, or the sum across every debtor for "All debtors".
// Reads from the full table (including zero-balance rows hidden from display), since a
// debtor's opening balance still contributes to the grand total even if it nets to zero.
function getOpeningBalanceSum_(debtorFilterLower) {
  const rows = (receivablesData && receivablesData.table && receivablesData.table.rows) || [];
  const obOf = function (r) { return typeof r.values[0] === 'number' ? r.values[0] : 0; };
  if (debtorFilterLower) {
    const match = rows.find(function (r) { return r.name.trim().toLowerCase() === debtorFilterLower; });
    return match ? obOf(match) : 0;
  }
  return rows.reduce(function (sum, r) { return sum + obOf(r); }, 0);
}

function renderDebtorTxns() {
  const listEl = document.getElementById('rResults');
  const sumEl = document.getElementById('rSummary');
  if (!listEl) return;
  if (!receivablesData) { listEl.innerHTML = '<div class="empty-note">Loading…</div>'; return; }

  const d = val('rDebtor').trim().toLowerCase();
  const m = val('rMonth');
  const items = (receivablesData.transactions || []).filter(function (t) {
    return (!d || String(t.person).trim().toLowerCase() === d) && (!m || t.month === m);
  });

  let given = 0, received = 0;
  items.forEach(function (t) {
    if (typeof t.net !== 'number') return;
    if (t.net < 0) given += t.net; else received += t.net;
  });

  // Opening Balance is a starting figure, not a transaction, so it isn't affected by the
  // Month filter -- but it IS what makes "Net" here match the debtor's own TOTAL column
  // in the table above when no month filter narrows things down. With "All debtors", every
  // debtor's opening balance is included, so the grand Net matches the sheet's totals row.
  const opening = getOpeningBalanceSum_(d);
  // Matches the sheet's own TOTAL formula: TOTAL = O/B - Given - Received.
  // Given is stored as a negative number (money handed out), so "- given" adds
  // its magnitude back; Received (positive, money collected) is subtracted.
  const net = opening - given - received;

  if (sumEl) {
    sumEl.innerHTML =
      '<div class="total-row" style="margin-bottom:0;"><span>' + items.length + ' transaction' + (items.length === 1 ? '' : 's') + '</span>' +
      '<span class="' + (net < 0 ? 'amt-neg' : (net > 0 ? 'amt-pos' : '')) + '">Net Receivable ' + fmtSignedMoney(net) + '</span></div>' +
      '<div class="recv-sub">Opening ' + fmtSignedMoney(opening) + ' · Given ' + fmtSignedMoney(given) + ' · Received ' + fmtSignedMoney(received) + '</div>';
  }

  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty-note">No transactions match this filter.</div>';
    return;
  }

  const LIMIT = 300;
  listEl.innerHTML = items.slice(0, LIMIT).map(renderDebtorTxnRow).join('') +
    (items.length > LIMIT ? '<div class="empty-note">Showing the latest ' + LIMIT + ' — narrow the filter to see the rest.</div>' : '');
}

function renderDebtorTxnRow(t) {
  const amt = (typeof t.net === 'number') ? t.net : (typeof t.amount === 'number' ? t.amount : null);
  const cls = (typeof amt === 'number') ? (amt < 0 ? 'amt-neg' : 'amt-pos') : '';
  const bits = [t.date + ' ' + t.time, t.txnType, t.category, t.month].filter(function (x) { return x; });
  return '<div class="recent-row">' +
    '<div class="recent-main">' +
      '<span>' + escapeHtml(t.person) + '</span>' +
      '<span class="' + cls + '">' + (typeof amt === 'number' ? fmtSignedMoney(amt) : '—') + '</span>' +
    '</div>' +
    '<div class="recent-sub">' + escapeHtml(bits.join(' · ')) + '</div>' +
    (t.remarks ? '<div class="recent-remarks">' + escapeHtml(t.remarks) + '</div>' : '') +
  '</div>';
}

// ---------- Offline queue (Add Transaction) ----------
function getQueue() { return JSON.parse(localStorage.getItem('pendingTxns') || '[]'); }
function setQueue(q) {
  localStorage.setItem('pendingTxns', JSON.stringify(q));
  updatePendingCount();
  loadRecent();
}
function updatePendingCount() {
  const el = document.getElementById('pendingCount');
  if (!el) return;
  const n = getQueue().length;
  el.textContent = n > 0 ? n + ' entr' + (n === 1 ? 'y' : 'ies') + ' waiting to sync' : '';
}
updatePendingCount();

function submitTxn() {
  const amount = val('amount');
  const txnType = val('txnType');
  if (!amount || !txnType) {
    showToast('Amount and Txn Type are required');
    return;
  }
  const txn = {
    clientId: generateClientId(),
    date: val('date'),
    time: val('time'),
    amount: amount,
    txnType: txnType,
    txnFrom: val('txnFrom'),
    txnTo: val('txnTo'),
    category: categoryCombo.getValue(),
    remarks: val('remarks')
  };
  const q = getQueue();
  q.push(txn);
  setQueue(q);
  clearForm();
  showToast('Saved. ' + (navigator.onLine ? 'Syncing…' : 'Will sync when online.'));
  if (navigator.onLine) syncQueue();
}

function clearForm() {
  setVal('amount', '');
  setVal('txnType', '');
  setVal('txnFrom', '');
  setVal('txnTo', '');
  categoryCombo.setValue('');
  setVal('remarks', '');
}

let syncing = false;
function syncQueue() {
  if (syncing || !navigator.onLine) return;
  const q = getQueue();
  if (q.length === 0) return;

  syncing = true;
  const next = q[0];
  next.key = API_KEY;

  // next.clientId (set when the entry was created) lets the backend recognise a retried
  // submission and avoid inserting a duplicate row if a previous attempt actually
  // succeeded but its response never reached this device (e.g. connection dropped).
  fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(next)
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      syncing = false;
      checkBackendResponse(res);
      const rest = getQueue();
      rest.shift();
      setQueue(rest);
      if (rest.length > 0) {
        syncQueue();
      } else {
        showToast('All entries synced');
        if (document.getElementById('viewSummary') && document.getElementById('viewSummary').classList.contains('active')) loadSummary();
      }
    })
    .catch(function (err) {
      syncing = false;
      console.error(err);
      showToast('Sync failed, will retry');
    });
}
setInterval(syncQueue, 15000);

// ---------- Recent entries, Undo, and multi-select delete ----------
// recentSelMap maps a checkbox's selection id -> how to delete that entry:
//   pending entries: { type:'pending', clientId }  (removed locally, never touched the sheet)
//   synced entries:  { type:'synced', row, signature } (deleted via backend, re-verified first)
let recentSelMap = {};

function renderRecentRow(t, pending, selId) {
  const checkbox = selId
    ? '<input type="checkbox" class="recent-checkbox" data-sel="' + escapeHtml(selId) + '" onchange="onRecentCheckChange()">'
    : '';
  return '<div class="recent-row">' +
    '<label class="recent-select">' +
      checkbox +
      '<div class="recent-content">' +
        '<div class="recent-main">' +
          '<span>' + formatMoney(Number(t.amount)) + '</span>' +
          '<span>' + escapeHtml(t.category || '') + '</span>' +
        '</div>' +
        '<div class="recent-sub">' + escapeHtml(t.date) + ' ' + escapeHtml(t.time) + ' · ' + escapeHtml(t.txnType || '') +
          (pending ? ' <span class="pending-tag">pending</span>' : '') +
        '</div>' +
        (t.remarks ? '<div class="recent-remarks">' + escapeHtml(t.remarks) + '</div>' : '') +
      '</div>' +
    '</label>' +
  '</div>';
}

function loadRecent() {
  const listEl = document.getElementById('recentList');
  if (!listEl) return;
  recentSelMap = {};

  const pendingQueue = getQueue();
  const pendingHtml = pendingQueue.slice().reverse().map(function (t) {
    const selId = 'p:' + t.clientId;
    recentSelMap[selId] = { type: 'pending', clientId: t.clientId };
    return renderRecentRow(t, true, selId);
  }).join('');

  function renderSyncedList(list) {
    return list.map(function (t) {
      const selId = 's:' + t.row;
      recentSelMap[selId] = { type: 'synced', row: t.row, signature: t };
      return renderRecentRow(t, false, selId);
    }).join('');
  }

  if (!hasValidBackendConfig()) {
    listEl.innerHTML = pendingHtml || '<div class="empty-note">No recent entries yet.</div>';
    updateBulkBar();
    return;
  }

  if (!navigator.onLine) {
    const cached = JSON.parse(localStorage.getItem('recentSynced') || '[]');
    listEl.innerHTML = (pendingHtml + renderSyncedList(cached)) || '<div class="empty-note">No recent entries yet.</div>';
    updateBulkBar();
    return;
  }

  fetch(BACKEND_URL + '?page=recent&limit=8&key=' + encodeURIComponent(API_KEY))
    .then(function (r) { return r.json(); })
    .then(function (res) {
      checkBackendResponse(res, function (d) { return Array.isArray(d); });
      localStorage.setItem('recentSynced', JSON.stringify(res.data));
      listEl.innerHTML = (pendingHtml + renderSyncedList(res.data)) || '<div class="empty-note">No recent entries yet.</div>';
      updateBulkBar();
    })
    .catch(function (err) {
      console.error('loadRecent failed:', err);
      showToast('Recent entries: ' + err.message);
      const cached = JSON.parse(localStorage.getItem('recentSynced') || '[]');
      listEl.innerHTML = (pendingHtml + renderSyncedList(cached)) || '<div class="empty-note">No recent entries yet.</div>';
      updateBulkBar();
    });
}
loadRecent();

function onRecentCheckChange() { updateBulkBar(); }

function updateBulkBar() {
  const bar = document.getElementById('recentBulkBar');
  const countEl = document.getElementById('recentSelCount');
  if (!bar || !countEl) return;
  const checked = document.querySelectorAll('.recent-checkbox:checked');
  if (checked.length > 0) {
    bar.style.display = 'block';
    countEl.textContent = checked.length;
  } else {
    bar.style.display = 'none';
  }
}

async function deleteSelectedRecent() {
  try {
    const checked = Array.from(document.querySelectorAll('.recent-checkbox:checked'));
    if (checked.length === 0) return;

    const selIds = checked.map(function (el) { return el.getAttribute('data-sel'); });
    const ok = await showConfirm(
      'Delete ' + selIds.length + ' selected entr' + (selIds.length === 1 ? 'y' : 'ies') + '? This cannot be undone.',
      'Delete selected entries'
    );
    if (!ok) return;

    const pendingClientIds = [];
    const syncedRows = [];
    const signatures = {};

    selIds.forEach(function (id) {
      const info = recentSelMap[id];
      if (!info) return;
      if (info.type === 'pending') {
        pendingClientIds.push(info.clientId);
      } else {
        syncedRows.push(info.row);
        signatures[String(info.row)] = info.signature;
      }
    });

    if (pendingClientIds.length > 0) {
      let q = getQueue();
      q = q.filter(function (t) { return pendingClientIds.indexOf(t.clientId) === -1; });
      setQueue(q);
    }

    if (syncedRows.length > 0) {
      if (!navigator.onLine) {
        showToast('Connect to internet to delete synced entries');
      } else {
        const res = await fetch(BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: API_KEY, action: 'bulkDelete', rows: syncedRows, signatures: signatures })
        }).then(function (r) { return r.json(); });

        checkBackendResponse(res);
        if (!res.result || !Array.isArray(res.result.deleted) || !Array.isArray(res.result.skipped)) {
          throw new Error('Unexpected response shape from bulkDelete — Code.gs may not match this version of the app.');
        }
        const deletedCount = res.result.deleted.length;
        const skippedCount = res.result.skipped.length;
        showToast(skippedCount > 0
          ? ('Deleted ' + deletedCount + ', skipped ' + skippedCount + ' (changed since loaded)')
          : ('Deleted ' + deletedCount + ' entr' + (deletedCount === 1 ? 'y' : 'ies')));
      }
    } else if (pendingClientIds.length > 0) {
      showToast('Removed selected entries');
    }

    loadRecent();
    if (document.getElementById('viewSummary') && document.getElementById('viewSummary').classList.contains('active')) loadSummary();
  } catch (err) {
    console.error('deleteSelectedRecent failed:', err);
    showToast('Delete failed: ' + err.message);
  }
}

function undoLastEntry() {
  undoLastEntryAsync().catch(function (err) {
    console.error('undoLastEntry failed:', err);
    showToast('Undo failed: ' + err.message);
  });
}

async function undoLastEntryAsync() {
  const q = getQueue();

  // A not-yet-synced entry is always the most recent one in real time -- remove it locally, no backend call needed.
  if (q.length > 0) {
    const ok = await showConfirm('Remove the last entry you added (not yet synced)?', 'Undo last entry');
    if (!ok) return;
    q.pop();
    setQueue(q);
    showToast('Removed');
    return;
  }

  if (!navigator.onLine) { showToast('Undo needs an internet connection'); return; }
  if (!hasValidBackendConfig()) { showToast('config.js: BACKEND_URL is not set yet'); return; }

  const res = await fetch(BACKEND_URL + '?page=recent&limit=1&key=' + encodeURIComponent(API_KEY)).then(function (r) { return r.json(); });
  checkBackendResponse(res, function (d) { return Array.isArray(d); });
  if (!res.data || res.data.length === 0) { showToast('Nothing to undo'); return; }

  const last = res.data[0];
  const summary = last.date + ' ' + last.time + '  ' + formatMoney(Number(last.amount)) + '  ' + (last.category || '');
  const ok = await showConfirm(summary, 'Delete this entry?');
  if (!ok) return;

  const res2 = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key: API_KEY, action: 'undo', row: last.row, signature: last })
  }).then(function (r) { return r.json(); });

  checkBackendResponse(res2);
  showToast('Entry deleted');
  loadRecent();
  if (document.getElementById('viewSummary') && document.getElementById('viewSummary').classList.contains('active')) loadSummary();
}

// ---------- Search & Filter ----------
function runSearch() {
  try {
    if (!navigator.onLine) { showToast('Search needs an internet connection'); return; }
    if (!hasValidBackendConfig()) { showToast('config.js: BACKEND_URL is not set yet'); return; }

    const params = new URLSearchParams({
      page: 'search',
      key: API_KEY,
      dateFrom: val('sDateFrom'),
      dateTo: val('sDateTo'),
      txnType: val('sTxnType'),
      category: searchCategoryCombo.getValue(),
      account: val('sAccount'),
      minAmount: val('sMinAmount'),
      maxAmount: val('sMaxAmount'),
      keyword: val('sKeyword')
    });

    const summaryEl = document.getElementById('searchSummary');
    const resultsEl = document.getElementById('searchResults');
    if (summaryEl) summaryEl.style.display = 'none';
    if (resultsEl) resultsEl.innerHTML = '<div class="empty-note">Searching…</div>';

    fetch(BACKEND_URL + '?' + params.toString())
      .then(function (r) { return r.json(); })
      .then(function (res) {
        checkBackendResponse(res, function (d) { return d && Array.isArray(d.items); });
        renderSearchResults(res.data);
      })
      .catch(function (err) {
        console.error('runSearch failed:', err);
        showToast('Search failed: ' + err.message);
        if (resultsEl) resultsEl.innerHTML = '';
      });
  } catch (err) {
    console.error('runSearch setup failed:', err);
    showToast('Search form looks out of date — see README troubleshooting');
  }
}

function renderSearchResults(data) {
  const summaryEl = document.getElementById('searchSummary');
  const listEl = document.getElementById('searchResults');
  if (summaryEl) {
    summaryEl.style.display = 'block';
    summaryEl.innerHTML = '<div class="total-row"><span>' + data.count + ' result' + (data.count === 1 ? '' : 's') + '</span><span>' + formatMoney(data.total) + '</span></div>' +
      (data.truncated ? '<div class="empty-note">Showing the most recent ' + data.items.length + ' — narrow your filters to see the rest.</div>' : '');
  }
  if (listEl) {
    // Search results are read-only (no checkboxes) -- deletion/cleanup happens from the Recent Entries list.
    listEl.innerHTML = data.items.length > 0
      ? data.items.map(function (t) { return renderRecentRow(t, false, null); }).join('')
      : '<div class="empty-note">No matching transactions.</div>';
  }
}

// ---------- Settings modal ----------
function openSettings() {
  const m = document.getElementById('settingsModal');
  if (m) m.style.display = 'flex';
  const v = document.getElementById('versionLabel');
  if (v) v.textContent = 'App version ' + FRONTEND_VERSION + ' · needs backend v' + REQUIRED_BACKEND_VERSION + '+';
}
function closeSettings() {
  const m = document.getElementById('settingsModal');
  if (m) m.style.display = 'none';
}

function onLockToggle() {
  const toggle = document.getElementById('lockEnabledToggle');
  const enabled = toggle ? toggle.checked : false;
  const block = document.getElementById('pinSetupBlock');
  if (block) block.style.display = enabled ? 'block' : 'none';
  if (!enabled) {
    localStorage.removeItem('lockEnabled');
    localStorage.removeItem('pinHash');
    localStorage.removeItem('pinSalt');
    localStorage.removeItem('biometricEnabled');
    localStorage.removeItem('bioCredentialId');
    const bt = document.getElementById('biometricToggle');
    if (bt) bt.checked = false;
    showToast('App lock disabled');
  }
}

async function savePin() {
  const p1 = val('newPin');
  const p2 = val('confirmPin');
  if (!/^\d{4,8}$/.test(p1)) { showToast('PIN must be 4–8 digits'); return; }
  if (p1 !== p2) { showToast('PINs do not match'); return; }

  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  const hash = await sha256Hex(salt + p1);
  localStorage.setItem('pinSalt', salt);
  localStorage.setItem('pinHash', hash);
  localStorage.setItem('lockEnabled', 'true');
  setVal('newPin', '');
  setVal('confirmPin', '');
  showToast('PIN saved');
}

async function onBiometricToggle() {
  const toggle = document.getElementById('biometricToggle');
  const enable = toggle ? toggle.checked : false;
  if (!enable) {
    localStorage.removeItem('biometricEnabled');
    localStorage.removeItem('bioCredentialId');
    return;
  }
  if (!localStorage.getItem('pinHash')) {
    showToast('Set a PIN first — biometric is a shortcut on top of it');
    if (toggle) toggle.checked = false;
    return;
  }
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: challenge,
        rp: { name: 'Expense Tracker' },
        user: { id: userId, name: 'device-user', displayName: 'Device User' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          // Discoverable/resident credential: the platform stores and can find this
          // credential on its own, without us needing to supply its exact ID later.
          // This is what fixed the recurring NotAllowedError -- the previous
          // non-resident approach required the ID we stored in localStorage to still
          // exactly match what the OS/browser had on file, which could silently drift
          // out of sync (e.g. after fingerprint re-enrollment). residentKey is the
          // modern spec property; requireResidentKey is kept alongside it for older
          // browser versions that only understand the boolean form.
          residentKey: 'required',
          requireResidentKey: true
        },
        timeout: 30000
      }
    });
    localStorage.setItem('bioCredentialId', bufferToBase64(cred.rawId));
    localStorage.setItem('biometricEnabled', 'true');
    showToast('Biometric unlock enabled');
  } catch (err) {
    console.error('Biometric setup failed:', err);
    showToast('Could not enable biometric: ' + (err.name || 'unknown error'));
    if (toggle) toggle.checked = false;
  }
}

// ---------- App Lock (PIN + optional biometric) ----------
// This is a DEVICE SCREEN LOCK for convenience/privacy only. It does not add
// security to the backend -- that's governed by the API key in config.js and
// who has access to your Apps Script deployment / Google account.

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}
function bufferToBase64(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
}
function isLockEnabled() { return localStorage.getItem('lockEnabled') === 'true'; }

function showLockOverlay() {
  const overlay = document.getElementById('lockOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  setVal('lockPinInput', '');
  const err = document.getElementById('lockError');
  if (err) err.textContent = '';

  // A device can end up with biometricEnabled='true' but no actual credential ID
  // stored (e.g. after a partial cache clear, or the phone's fingerprint/face
  // enrollment changing). In that state the button would appear but silently do
  // nothing when tapped. Detect and clean that up here so it falls back to PIN
  // only instead of presenting a broken button.
  const bioEnabled = localStorage.getItem('biometricEnabled') === 'true';
  const credId = localStorage.getItem('bioCredentialId');
  if (bioEnabled && !credId) {
    localStorage.removeItem('biometricEnabled');
  }
  const bioReady = bioEnabled && !!credId;

  const bioBtn = document.getElementById('biometricBtn');
  if (bioBtn) bioBtn.style.display = bioReady ? 'block' : 'none';
  if (bioReady) tryUnlockBiometric(true);
}
function hideLockOverlay() {
  const overlay = document.getElementById('lockOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function tryUnlockPin() {
  const pin = val('lockPinInput');
  const storedHash = localStorage.getItem('pinHash');
  const salt = localStorage.getItem('pinSalt') || '';
  if (!storedHash) { hideLockOverlay(); return; }
  const hash = await sha256Hex(salt + pin);
  if (hash === storedHash) {
    hideLockOverlay();
  } else {
    const err = document.getElementById('lockError');
    if (err) err.textContent = 'Incorrect PIN';
  }
}

async function tryUnlockBiometric(silent) {
  try {
    // bioCredentialId now only gates whether the UI offers biometric at all -- it's
    // no longer sent to get() as an exact ID to match. Omitting allowCredentials
    // lets the platform discover the resident credential itself, which is more
    // robust than requiring our stored ID to still exactly match what the OS has.
    const credId = localStorage.getItem('bioCredentialId');
    if (!credId) { if (!silent) showToast('Biometric not set up'); return; }
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        userVerification: 'required',
        timeout: 30000
      }
    });
    if (cred) hideLockOverlay();
  } catch (err) {
    console.error('Biometric unlock failed:', err);
    const errEl = document.getElementById('lockError');
    // Showing the actual WebAuthn error name (e.g. NotAllowedError, InvalidStateError,
    // SecurityError) instead of a generic message -- this is the only way to tell
    // which specific failure mode is happening on a given device without DevTools.
    if (!silent && errEl) errEl.textContent = 'Biometric failed: ' + (err.name || 'unknown error') + ' — use PIN';
  }
}

function resetLockPrompt() {
  resetLockPromptAsync();
}
async function resetLockPromptAsync() {
  const ok = await showConfirm('This clears your PIN and biometric setup on THIS DEVICE only. Your sheet data is unaffected.', 'Reset lock?');
  if (!ok) return;
  localStorage.removeItem('lockEnabled');
  localStorage.removeItem('pinHash');
  localStorage.removeItem('pinSalt');
  localStorage.removeItem('biometricEnabled');
  localStorage.removeItem('bioCredentialId');
  hideLockOverlay();
  showToast('Lock reset');
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden && isLockEnabled()) showLockOverlay();
});

async function initLock() {
  if (isLockEnabled()) showLockOverlay();

  const lockToggle = document.getElementById('lockEnabledToggle');
  const pinBlock = document.getElementById('pinSetupBlock');
  const bioToggle = document.getElementById('biometricToggle');
  if (lockToggle) lockToggle.checked = isLockEnabled();
  if (pinBlock) pinBlock.style.display = isLockEnabled() ? 'block' : 'none';
  if (bioToggle) bioToggle.checked = localStorage.getItem('biometricEnabled') === 'true' && !!localStorage.getItem('bioCredentialId');

  if (bioToggle) {
    if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        bioToggle.disabled = !available;
      } catch (e) { bioToggle.disabled = true; }
    } else {
      bioToggle.disabled = true;
    }
  }
}
initLock();

// ---------- Service worker (reliable offline shell caching — real origin, not sandboxed) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.error('SW registration failed', err);
    });
  });
}
