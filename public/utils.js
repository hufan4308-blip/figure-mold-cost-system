function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Auth Helpers (JWT) ─────────────────────────────────────────────────
function getToken() { return sessionStorage.getItem('token') || ''; }
function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() };
}
function authCheck() { return true; }
function logout() { window.location.href = 'index.html'; }
// Wrapper for fetch
function authFetch(url, opts) {
  opts = opts || {};
  if (!opts.headers) opts.headers = {};
  if (!opts.headers['Authorization']) opts.headers['Authorization'] = 'Bearer ' + getToken();
  return fetch(url, opts);
}

function fmtDate(s) {
  if (!s) return '';
  var d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function showToast(msg, type) {
  type = type || 'success';
  var el = document.getElementById('toast');
  var colors = { success: '#198754', danger: '#dc3545', warning: '#ffc107' };
  el.style.background = colors[type] || '#333';
  document.getElementById('toastMsg').textContent = msg;
  new bootstrap.Toast(el, { delay: 2500 }).show();
}

function statusBadgeClass(s) {
  if (s === '已完成') return 'bg-success';
  if (s === '已下单') return 'bg-primary';
  if (s === '已开模' || s === '制作中') return 'bg-info text-dark';
  if (s === '已交模') return 'bg-warning text-dark';
  return 'bg-secondary';
}
