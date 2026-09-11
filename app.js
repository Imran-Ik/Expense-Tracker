// ---------- Tabs ----------
function switchTab(tab) {
  try {
    setActive('viewAdd', tab === 'add');
    setActive('viewSearch', tab === 'search');
    setActive('viewSummary', tab === 'summary');
    setActive('tabAddBtn', tab === 'add');
    setActive('tabSearchBtn', tab === 'search');
    setActive('tabSummaryBtn', tab === 'summary');
    if (tab === 'summary') loadSummary();
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
  fill('category', options.category);
  fill('sTxnType', options.txnType, 'Any');
  fill('sCategory', options.category, 'Any');
  fill('sAccount', options.txnFromTo, 'Any');
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

const statusBarEl = document.getElementById('statusBar');
if (statusBarEl) {
  statusBarEl.addEventListener('click', function () {
    showToast('Refreshing…');
    loadOptions();
    syncQueue();
    loadRecent();
    if (document.getElementById('viewSummary') && document.getElementById('viewSummary').classList.contains('active')) loadSummary();
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
function renderSummary(data) {
  renderFunds(data.funds);
  renderBudget(data.budget);
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
  if (!card) return;
  if (label) label.textContent = 'Budget vs Actual' + (budget && budget.month ? ' — ' + budget.month : '');

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
    category: val('category'),
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
  setVal('category', '');
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
      if (!res.success) throw new Error(res.error || 'Sync failed');
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
      if (!res.success) throw new Error(res.error || 'Failed to load recent entries');
      localStorage.setItem('recentSynced', JSON.stringify(res.data));
      listEl.innerHTML = (pendingHtml + renderSyncedList(res.data)) || '<div class="empty-note">No recent entries yet.</div>';
      updateBulkBar();
    })
    .catch(function (err) {
      console.error('loadRecent failed:', err);
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

        if (!res.success) throw new Error(res.error || 'Delete failed');
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
  if (!res.success) throw new Error(res.error || 'Could not load last entry');
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

  if (!res2.success) throw new Error(res2.error || 'Undo failed');
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
      category: val('sCategory'),
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
        if (!res.success) throw new Error(res.error || 'Search failed');
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
}
function closeSettings() {
  const m = document.getElementById('settingsModal');
  if (m) m.style.display = 'none';
}

function onLockToggle() {
  const enabled = document.getElementById('lockEnabledToggle').checked;
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
  const enable = document.getElementById('biometricToggle').checked;
  if (!enable) {
    localStorage.removeItem('biometricEnabled');
    localStorage.removeItem('bioCredentialId');
    return;
  }
  if (!localStorage.getItem('pinHash')) {
    showToast('Set a PIN first — biometric is a shortcut on top of it');
    document.getElementById('biometricToggle').checked = false;
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
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 30000
      }
    });
    localStorage.setItem('bioCredentialId', bufferToBase64(cred.rawId));
    localStorage.setItem('biometricEnabled', 'true');
    showToast('Biometric unlock enabled');
  } catch (err) {
    console.error('Biometric setup failed:', err);
    showToast('Could not enable biometric unlock on this device');
    document.getElementById('biometricToggle').checked = false;
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
function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function isLockEnabled() { return localStorage.getItem('lockEnabled') === 'true'; }

function showLockOverlay() {
  const overlay = document.getElementById('lockOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  setVal('lockPinInput', '');
  const err = document.getElementById('lockError');
  if (err) err.textContent = '';
  const bioEnabled = localStorage.getItem('biometricEnabled') === 'true';
  const bioBtn = document.getElementById('biometricBtn');
  if (bioBtn) bioBtn.style.display = bioEnabled ? 'block' : 'none';
  if (bioEnabled) tryUnlockBiometric(true);
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
    const credId = localStorage.getItem('bioCredentialId');
    if (!credId) { if (!silent) showToast('Biometric not set up'); return; }
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        allowCredentials: [{ id: base64ToBuffer(credId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 30000
      }
    });
    if (cred) hideLockOverlay();
  } catch (err) {
    console.error('Biometric unlock failed:', err);
    const errEl = document.getElementById('lockError');
    if (!silent && errEl) errEl.textContent = 'Biometric unlock failed — use PIN';
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
  if (bioToggle) bioToggle.checked = localStorage.getItem('biometricEnabled') === 'true';

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
