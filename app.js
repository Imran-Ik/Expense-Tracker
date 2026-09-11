// ---------- Tabs ----------
function switchTab(tab) {
  document.getElementById('viewAdd').classList.toggle('active', tab === 'add');
  document.getElementById('viewSearch').classList.toggle('active', tab === 'search');
  document.getElementById('viewSummary').classList.toggle('active', tab === 'summary');
  document.getElementById('tabAddBtn').classList.toggle('active', tab === 'add');
  document.getElementById('tabSearchBtn').classList.toggle('active', tab === 'search');
  document.getElementById('tabSummaryBtn').classList.toggle('active', tab === 'summary');
  if (tab === 'summary') loadSummary();
  if (tab === 'add') loadRecent();
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

function formatMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return String(v);
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2200);
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

// Tap the status bar to manually retry loading dropdowns + summary + sync the queue
document.getElementById('statusBar').addEventListener('click', function () {
  showToast('Refreshing…');
  loadOptions();
  syncQueue();
  loadRecent();
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

// ---------- Offline queue (Add Transaction) ----------
function getQueue() { return JSON.parse(localStorage.getItem('pendingTxns') || '[]'); }
function setQueue(q) {
  localStorage.setItem('pendingTxns', JSON.stringify(q));
  updatePendingCount();
  loadRecent();
}
function updatePendingCount() {
  const n = getQueue().length;
  document.getElementById('pendingCount').textContent =
    n > 0 ? n + ' entr' + (n === 1 ? 'y' : 'ies') + ' waiting to sync' : '';
}
updatePendingCount();

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
        if (document.getElementById('viewSummary').classList.contains('active')) loadSummary();
      }
    })
    .catch(function (err) {
      syncing = false;
      console.error(err);
      showToast('Sync failed, will retry');
    });
}
setInterval(syncQueue, 15000);

// ---------- Recent entries + Undo ----------
function renderRecentRow(t, pending) {
  return '<div class="recent-row">' +
    '<div class="recent-main">' +
      '<span>' + formatMoney(Number(t.amount)) + '</span>' +
      '<span>' + escapeHtml(t.category || '') + '</span>' +
    '</div>' +
    '<div class="recent-sub">' + escapeHtml(t.date) + ' ' + escapeHtml(t.time) + ' · ' + escapeHtml(t.txnType || '') +
      (pending ? ' <span class="pending-tag">pending</span>' : '') +
    '</div>' +
    (t.remarks ? '<div class="recent-remarks">' + escapeHtml(t.remarks) + '</div>' : '') +
  '</div>';
}

function loadRecent() {
  const listEl = document.getElementById('recentList');
  if (!listEl) return;

  const pendingHtml = getQueue().slice().reverse().map(function (t) { return renderRecentRow(t, true); }).join('');

  if (!hasValidBackendConfig()) {
    listEl.innerHTML = pendingHtml || '<div class="empty-note">No recent entries yet.</div>';
    return;
  }

  if (!navigator.onLine) {
    const cached = JSON.parse(localStorage.getItem('recentSynced') || '[]');
    listEl.innerHTML = (pendingHtml + cached.map(function (t) { return renderRecentRow(t, false); }).join(''))
      || '<div class="empty-note">No recent entries yet.</div>';
    return;
  }

  fetch(BACKEND_URL + '?page=recent&limit=8&key=' + encodeURIComponent(API_KEY))
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.success) throw new Error(res.error || 'Failed to load recent entries');
      localStorage.setItem('recentSynced', JSON.stringify(res.data));
      listEl.innerHTML = (pendingHtml + res.data.map(function (t) { return renderRecentRow(t, false); }).join(''))
        || '<div class="empty-note">No recent entries yet.</div>';
    })
    .catch(function (err) {
      console.error('loadRecent failed:', err);
      const cached = JSON.parse(localStorage.getItem('recentSynced') || '[]');
      listEl.innerHTML = (pendingHtml + cached.map(function (t) { return renderRecentRow(t, false); }).join(''))
        || '<div class="empty-note">No recent entries yet.</div>';
    });
}
loadRecent();

function undoLastEntry() {
  const q = getQueue();

  // A not-yet-synced entry is always the most recent one in real time -- remove it locally, no backend call needed.
  if (q.length > 0) {
    if (!confirm('Remove the last entry you added (not yet synced)?')) return;
    q.pop();
    setQueue(q);
    showToast('Removed');
    return;
  }

  if (!navigator.onLine) { showToast('Undo needs an internet connection'); return; }
  if (!hasValidBackendConfig()) { showToast('config.js: BACKEND_URL is not set yet'); return; }

  fetch(BACKEND_URL + '?page=recent&limit=1&key=' + encodeURIComponent(API_KEY))
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.success) throw new Error(res.error || 'Could not load last entry');
      if (!res.data || res.data.length === 0) { showToast('Nothing to undo'); return; }
      const last = res.data[0];
      const summary = last.date + ' ' + last.time + '  ' + formatMoney(Number(last.amount)) + '  ' + (last.category || '');
      if (!confirm('Delete this entry?\n' + summary)) return;

      return fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key: API_KEY, action: 'undo', row: last.row, signature: last })
      })
        .then(function (r) { return r.json(); })
        .then(function (res2) {
          if (!res2.success) throw new Error(res2.error || 'Undo failed');
          showToast('Entry deleted');
          loadRecent();
          if (document.getElementById('viewSummary').classList.contains('active')) loadSummary();
        });
    })
    .catch(function (err) {
      console.error('undoLastEntry failed:', err);
      showToast('Undo failed: ' + err.message);
    });
}

// ---------- Search & Filter ----------
function runSearch() {
  if (!navigator.onLine) { showToast('Search needs an internet connection'); return; }
  if (!hasValidBackendConfig()) { showToast('config.js: BACKEND_URL is not set yet'); return; }

  const params = new URLSearchParams({
    page: 'search',
    key: API_KEY,
    dateFrom: document.getElementById('sDateFrom').value,
    dateTo: document.getElementById('sDateTo').value,
    txnType: document.getElementById('sTxnType').value,
    category: document.getElementById('sCategory').value,
    account: document.getElementById('sAccount').value,
    minAmount: document.getElementById('sMinAmount').value,
    maxAmount: document.getElementById('sMaxAmount').value,
    keyword: document.getElementById('sKeyword').value
  });

  document.getElementById('searchSummary').style.display = 'none';
  document.getElementById('searchResults').innerHTML = '<div class="empty-note">Searching…</div>';

  fetch(BACKEND_URL + '?' + params.toString())
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.success) throw new Error(res.error || 'Search failed');
      renderSearchResults(res.data);
    })
    .catch(function (err) {
      console.error('runSearch failed:', err);
      showToast('Search failed: ' + err.message);
      document.getElementById('searchResults').innerHTML = '';
    });
}

function renderSearchResults(data) {
  const summaryEl = document.getElementById('searchSummary');
  summaryEl.style.display = 'block';
  summaryEl.innerHTML = '<div class="total-row"><span>' + data.count + ' result' + (data.count === 1 ? '' : 's') + '</span><span>' + formatMoney(data.total) + '</span></div>' +
    (data.truncated ? '<div class="empty-note">Showing the most recent ' + data.items.length + ' — narrow your filters to see the rest.</div>' : '');

  const listEl = document.getElementById('searchResults');
  listEl.innerHTML = data.items.length > 0
    ? data.items.map(function (t) { return renderRecentRow(t, false); }).join('')
    : '<div class="empty-note">No matching transactions.</div>';
}

// ---------- Settings modal ----------
function openSettings() { document.getElementById('settingsModal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }

function onLockToggle() {
  const enabled = document.getElementById('lockEnabledToggle').checked;
  document.getElementById('pinSetupBlock').style.display = enabled ? 'block' : 'none';
  if (!enabled) {
    localStorage.removeItem('lockEnabled');
    localStorage.removeItem('pinHash');
    localStorage.removeItem('pinSalt');
    localStorage.removeItem('biometricEnabled');
    localStorage.removeItem('bioCredentialId');
    document.getElementById('biometricToggle').checked = false;
    showToast('App lock disabled');
  }
}

async function savePin() {
  const p1 = document.getElementById('newPin').value;
  const p2 = document.getElementById('confirmPin').value;
  if (!/^\d{4,8}$/.test(p1)) { showToast('PIN must be 4–8 digits'); return; }
  if (p1 !== p2) { showToast('PINs do not match'); return; }

  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  const hash = await sha256Hex(salt + p1);
  localStorage.setItem('pinSalt', salt);
  localStorage.setItem('pinHash', hash);
  localStorage.setItem('lockEnabled', 'true');
  document.getElementById('newPin').value = '';
  document.getElementById('confirmPin').value = '';
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
  document.getElementById('lockOverlay').style.display = 'flex';
  document.getElementById('lockPinInput').value = '';
  document.getElementById('lockError').textContent = '';
  const bioEnabled = localStorage.getItem('biometricEnabled') === 'true';
  document.getElementById('biometricBtn').style.display = bioEnabled ? 'block' : 'none';
  if (bioEnabled) tryUnlockBiometric(true);
}
function hideLockOverlay() {
  document.getElementById('lockOverlay').style.display = 'none';
}

async function tryUnlockPin() {
  const pin = document.getElementById('lockPinInput').value;
  const storedHash = localStorage.getItem('pinHash');
  const salt = localStorage.getItem('pinSalt') || '';
  if (!storedHash) { hideLockOverlay(); return; }
  const hash = await sha256Hex(salt + pin);
  if (hash === storedHash) {
    hideLockOverlay();
  } else {
    document.getElementById('lockError').textContent = 'Incorrect PIN';
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
    if (!silent) document.getElementById('lockError').textContent = 'Biometric unlock failed — use PIN';
  }
}

function resetLockPrompt() {
  if (confirm('This clears your PIN and biometric setup on THIS DEVICE only. Your sheet data is unaffected. Continue?')) {
    localStorage.removeItem('lockEnabled');
    localStorage.removeItem('pinHash');
    localStorage.removeItem('pinSalt');
    localStorage.removeItem('biometricEnabled');
    localStorage.removeItem('bioCredentialId');
    hideLockOverlay();
    showToast('Lock reset');
  }
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden && isLockEnabled()) showLockOverlay();
});

async function initLock() {
  if (isLockEnabled()) showLockOverlay();

  document.getElementById('lockEnabledToggle').checked = isLockEnabled();
  document.getElementById('pinSetupBlock').style.display = isLockEnabled() ? 'block' : 'none';
  document.getElementById('biometricToggle').checked = localStorage.getItem('biometricEnabled') === 'true';

  const bioToggle = document.getElementById('biometricToggle');
  if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      bioToggle.disabled = !available;
    } catch (e) { bioToggle.disabled = true; }
  } else {
    bioToggle.disabled = true;
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
