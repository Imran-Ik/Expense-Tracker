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
    bar.textContent = 'Online — changes sync instantly';
    bar.classList.remove('offline');
  } else {
    bar.textContent = 'Offline — entries are saved on this device and will sync automatically';
    bar.classList.add('offline');
  }
}
window.addEventListener('online', function () { renderStatus(); syncQueue(); });
window.addEventListener('offline', renderStatus);
renderStatus();

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

  fetch(BACKEND_URL + '?page=options&key=' + encodeURIComponent(API_KEY))
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.success) throw new Error(res.error || 'Failed to load options');
      options = res.data;
      localStorage.setItem('ddOptions', JSON.stringify(options));
      populateDropdowns();
    })
    .catch(function () { loadCachedOptions(); });
}
function loadCachedOptions() {
  const cached = localStorage.getItem('ddOptions');
  if (cached) { options = JSON.parse(cached); populateDropdowns(); }
}
loadOptions();

// ---------- Offline queue ----------
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
      else showToast('All entries synced');
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
