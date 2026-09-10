// ---------- Tabs ----------
function switchTab(tab) {
  const isAdd = tab === 'add';
  document.getElementById('viewAdd').classList.toggle('active', isAdd);
  document.getElementById('viewSummary').classList.toggle('active', !isAdd);
  document.getElementById('tabAddBtn').classList.toggle('active', isAdd);
  document.getElementById('tabSummaryBtn').classList.toggle('active', !isAdd);
  if (!isAdd) loadSummary();
}

// ---------- Live date/time (device clock) ----------
function pad(n) { return n < 10 ? '0' + n : n; }
function updateClock() {
  const d = new Date();
  document.getElementById('date').value =
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  document.getElementById('time').value =
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
updateClock();
setInterval(updateClock, 1000);

// ---------- Connection status ----------
function renderStatus() {
  const bar = document.getElementById('statusBar');
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
  return BACKEND_URL && BACKEND_URL.indexOf('PASTE_YOUR') === -1;
}

// ---------- Dropdown options (fetched from backend, cached for offline use) ----------
let options = { txnType: [], txnFromTo: [], category: [] };

function populateDropdowns() {
  fill('txnType', options.txnType);
  fill('txnFrom', options.txnFromTo);
  fill('txnTo', options.txnFromTo);
  fill('category', options.category);
}
function fill(id, list) {
  const el = document.getElementById(id);
  el.innerHTML = '<option value="">Select…</option>';
  (list || []).forEach(function (v) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    el.appendChild(opt);
  });
}

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
      if (!res.success) throw new Error(res.error || 'Failed to load options');
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

// Tap the status bar to manually retry loading dropdowns + summary + sync the queue
document.getElementById('statusBar').addEventListener('click', function () {
  showToast('Refreshing…');
  loadOptions();
  syncQueue();
  if (document.getElementById('viewSummary').classList.contains('active')) loadSummary();
});

// ---------- Summary tab (balances + budget) ----------
function loadSummary() {
  if (!navigator.onLine) { renderSummaryFromCache(); return; }
  if (!hasValidBackendConfig()) {
    showToast('config.js: BACKEND_URL is not set yet');
    renderSummaryFromCache();
    return;
  }

  fetch(BACKEND_URL + '?page=summary&key=' + encodeURIComponent(API_KEY))
    .then(function (r) {
      if (!r.ok) throw new Error('Backend returned HTTP ' + r.status);
      return r.json();
    })
    .then(function (res) {
      if (!res.success) throw new Error(res.error || 'Failed to load summary');
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

function formatMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return String(v); // e.g. an icon cell
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function renderSummary(data) {
  renderFunds(data.funds);
  renderBudget(data.budget);
}

function renderFunds(funds) {
  const label = document.getElementById('fundsPeriodLabel');
  const grid = document.getElementById('fundsGrid');
  label.textContent = 'Account Balances' + (funds && funds.period ? ' — ' + funds.period : '');

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
    }
    return '' +
      '<div class="fund-card">' +
        '<div class="fund-name">' + escapeHtml(a.name) + '</div>' +
        '<div class="fund-balance">' + formatMoney(a.closeBal) + '</div>' +
        changeHtml +
      '</div>';
  }).join('');
}

function renderBudget(budget) {
  const label = document.getElementById('budgetMonthLabel');
  const card = document.getElementById('budgetCard');
  label.textContent = 'Budget vs Actual' + (budget && budget.month ? ' — ' + budget.month : '');

  if (!budget || !budget.categories || budget.categories.length === 0) {
    card.innerHTML = '<div class="empty-note">No budget block found for the current month.</div>';
    return;
  }

  let html = '';
  if (budget.total) {
    html += '<div class="total-row"><span>TOTAL</span><span>' +
      formatMoney(budget.total.actual) + ' / ' + formatMoney(budget.total.budget) +
      '</span></div>';
  }

  html += budget.categories
    .filter(function (c) { return typeof c.budget === 'number' && c.budget > 0; })
    .map(function (c) {
      const pct = typeof c.actual === 'number' ? (c.actual / c.budget) * 100 : 0;
      const barPct = Math.min(100, Math.max(0, pct));
      const cls = pct > 100 ? 'over' : (pct > 90 ? 'warn' : 'ok');
      return '' +
        '<div class="budget-row">' +
          '<div class="labels">' +
            '<span class="cat-name">' + escapeHtml(c.category) + '</span>' +
            '<span class="amounts">' + formatMoney(c.actual) + ' / ' + formatMoney(c.budget) + '</span>' +
          '</div>' +
          '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + barPct + '%"></div></div>' +
        '</div>';
    }).join('');

  card.innerHTML = html || '<div class="empty-note">No budgeted categories this month.</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------- Offline queue (Add Transaction) ----------
function getQueue() { return JSON.parse(localStorage.getItem('pendingTxns') || '[]'); }
function setQueue(q) {
  localStorage.setItem('pendingTxns', JSON.stringify(q));
  updatePendingCount();
}
function updatePendingCount() {
  const n = getQueue().length;
  document.getElementById('pendingCount').textContent =
    n > 0 ? n + ' entr' + (n === 1 ? 'y' : 'ies') + ' waiting to sync' : '';
}
updatePendingCount();

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2200);
}

function submitTxn() {
  const amount = document.getElementById('amount').value;
  const txnType = document.getElementById('txnType').value;
  if (!amount || !txnType) {
    showToast('Amount and Txn Type are required');
    return;
  }
  const txn = {
    date: document.getElementById('date').value,
    time: document.getElementById('time').value,
    amount: amount,
    txnType: txnType,
    txnFrom: document.getElementById('txnFrom').value,
    txnTo: document.getElementById('txnTo').value,
    category: document.getElementById('category').value,
    remarks: document.getElementById('remarks').value
  };
  const q = getQueue();
  q.push(txn);
  setQueue(q);
  clearForm();
  showToast('Saved. ' + (navigator.onLine ? 'Syncing…' : 'Will sync when online.'));
  if (navigator.onLine) syncQueue();
}

function clearForm() {
  document.getElementById('amount').value = '';
  document.getElementById('txnType').value = '';
  document.getElementById('txnFrom').value = '';
  document.getElementById('txnTo').value = '';
  document.getElementById('category').value = '';
  document.getElementById('remarks').value = '';
}

let syncing = false;
function syncQueue() {
  if (syncing || !navigator.onLine) return;
  const q = getQueue();
  if (q.length === 0) return;

  syncing = true;
  const next = q[0];
  next.key = API_KEY;

  fetch(BACKEND_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight request, which Apps Script can't handle
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(next)
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      syncing = false;
      if (!res.success) throw new Error(res.error || 'Sync failed');
      const rest = getQueue();
      rest.shift();
      setQueue(rest);
      if (rest.length > 0) syncQueue();
      else {
        showToast('All entries synced');
        if (document.getElementById('viewSummary').classList.contains('active')) loadSummary();
      }
    })
    .catch(function (err) {
      syncing = false;
      console.error(err);
      showToast('Sync failed, will retry');
    });
}
// Retry periodically in case an 'online' event was missed
setInterval(syncQueue, 15000);

// ---------- Service worker (reliable offline shell caching — real origin, not sandboxed) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.error('SW registration failed', err);
    });
  });
}
