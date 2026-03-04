# 模具 手办采购订单系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a procurement order management system for mold tooling and figure/prototype orders, with statistics, charts, and Excel export.

**Architecture:** Node.js + Express backend with JSON file storage (same pattern as production-system). Three static HTML pages (login, mold orders, figure orders) using Bootstrap 5 + Chart.js + SheetJS. Auth via sessionStorage name + PIN with X-User header.

**Tech Stack:** Express 4.18, Bootstrap 5.3.2 CDN, Bootstrap Icons 1.11.3 CDN, Chart.js 4.x CDN, SheetJS 0.20.3 CDN, vanilla JS.

**Reference:** production-system at `C:\Users\Hufan\Desktop\production-system` — replicate its server.js patterns (cache + atomic write, nextId, X-User auth), HTML patterns (Bootstrap modals, table rendering, toast notifications), and shared utils.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `data/data.json`
- Create: `public/utils.js`
- Create: `public/style.css`

**Step 1: Create package.json**

```json
{
  "name": "procurement-order-system",
  "version": "1.0.0",
  "description": "模具 手办采购订单系统",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

**Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

**Step 3: Create initial data file `data/data.json`**

```json
{
  "mold_orders": [],
  "figure_orders": [],
  "mold_factories": ["力众", "中尚", "昌隆", "亿隆泰", "锐正", "范仕达", "龙之联", "亚细亚"],
  "figure_factories": ["力图", "海洋", "广祥", "伟盟"],
  "customers": [],
  "eng_users": [
    {"name": "管理员", "pin": "1234"}
  ],
  "nextId": 1
}
```

**Step 4: Create `public/utils.js`**

```js
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
```

**Step 5: Create `public/style.css`**

Copy the key styles from production-system's style.css, adapted for this project:
- Font family: `'Microsoft YaHei', '微软雅黑', sans-serif`
- Navbar styling (dark blue `#1a3a6c` background)
- Table styles (`.table-sm` tight padding, sticky headers)
- Modal form grid styles
- Status badge overrides
- Toast positioning (fixed bottom-right)
- Print styles (`@media print`)
- Filter bar styles

**Step 6: Commit**

```bash
git add package.json package-lock.json data/data.json public/utils.js public/style.css
git commit -m "feat: project scaffolding with dependencies and shared utils"
```

---

### Task 2: Server Core (Express + JSON Storage + Auth)

**Files:**
- Create: `server.js`

**Step 1: Write server.js with Express setup, JSON storage, and login API**

The server must include:

1. **Imports and constants:**
```js
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3001;  // different port from production-system
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
```

2. **JSON storage (cache + atomic write):** Same pattern as production-system — `_cache`, `loadData()` returns deep clone, `saveData()` writes tmp then renames.

3. **Middleware stack:**
```js
app.use(express.json({ limit: '10mb' }));
// no-cache HTML
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
```

4. **Auth middleware for /api:** GET requests pass through. Write operations require `X-User` header. Exception: `/api/login`.

5. **Login endpoint:**
```js
app.post('/api/login', (req, res) => {
  const { name, pin } = req.body;
  const data = loadData();
  const user = data.eng_users.find(u => u.name === name && u.pin === String(pin));
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  res.json({ success: true, name: user.name });
});
```

6. **Base data endpoints:**
```js
app.get('/api/factories', ...)   // returns { mold_factories, figure_factories }
app.get('/api/customers', ...)   // returns customers array
```

7. **Server listen on 0.0.0.0:**
```js
app.listen(PORT, '0.0.0.0', () => { /* log local IP */ });
```

**Step 2: Test server starts**

Run: `node server.js`
Expected: "Server running on http://0.0.0.0:3001" with local IP printed.

**Step 3: Commit**

```bash
git add server.js
git commit -m "feat: Express server with JSON storage, auth, and base data APIs"
```

---

### Task 3: Mold Order CRUD API

**Files:**
- Modify: `server.js`

**Step 1: Add mold order CRUD routes to server.js**

Add after base data endpoints:

```js
// GET /api/mold-orders — list with optional filters
app.get('/api/mold-orders', (req, res) => {
  const data = loadData();
  let orders = data.mold_orders || [];
  const { group, factory, customer, status, year, month } = req.query;
  if (group) orders = orders.filter(o => o.group === group);
  if (factory) orders = orders.filter(o => o.mold_factory === factory);
  if (customer) orders = orders.filter(o => o.customer === customer);
  if (status) orders = orders.filter(o => o.status === status);
  if (year) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year));
  if (year && month) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year + '-' + month.padStart(2, '0')));
  orders.sort((a, b) => b.id - a.id);
  res.json(orders);
});

// POST /api/mold-orders — create
app.post('/api/mold-orders', (req, res) => {
  const data = loadData();
  const user = decodeURIComponent(req.headers['x-user'] || '');
  const order = {
    id: data.nextId++,
    group: req.body.group || '',
    customer: req.body.customer || '',
    product_name: req.body.product_name || '',
    mold_qty: Number(req.body.mold_qty) || 0,
    mold_fee: Number(req.body.mold_fee) || 0,
    mold_factory: req.body.mold_factory || '',
    order_date: req.body.order_date || '',
    mold_start_date: req.body.mold_start_date || '',
    delivery_date: req.body.delivery_date || '',
    status: '已下单',
    payment_type: req.body.payment_type || '',
    notes: req.body.notes || '',
    created_by: user,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  data.mold_orders.push(order);
  // auto-add new customer
  if (order.customer && !data.customers.includes(order.customer)) {
    data.customers.push(order.customer);
  }
  saveData(data);
  res.json(order);
});

// PUT /api/mold-orders/:id — update
app.put('/api/mold-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = data.mold_orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: '订单不存在' });
  const order = data.mold_orders[idx];
  // merge fields
  ['group','customer','product_name','mold_qty','mold_fee','mold_factory',
   'order_date','mold_start_date','delivery_date','payment_type','notes'].forEach(f => {
    if (req.body[f] !== undefined) order[f] = req.body[f];
  });
  if (req.body.mold_qty !== undefined) order.mold_qty = Number(req.body.mold_qty) || 0;
  if (req.body.mold_fee !== undefined) order.mold_fee = Number(req.body.mold_fee) || 0;
  order.updated_at = new Date().toISOString();
  if (order.customer && !data.customers.includes(order.customer)) {
    data.customers.push(order.customer);
  }
  saveData(data);
  res.json(order);
});

// DELETE /api/mold-orders/:id
app.delete('/api/mold-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = data.mold_orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: '订单不存在' });
  data.mold_orders.splice(idx, 1);
  saveData(data);
  res.json({ success: true });
});

// PUT /api/mold-orders/:id/status — update status
app.put('/api/mold-orders/:id/status', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const order = data.mold_orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const validTransitions = {
    '已下单': ['已开模'],
    '已开模': ['已交模'],
    '已交模': ['已完成']
  };
  const newStatus = req.body.status;
  if (!validTransitions[order.status] || !validTransitions[order.status].includes(newStatus)) {
    return res.status(400).json({ error: '无效的状态变更' });
  }
  order.status = newStatus;
  order.updated_at = new Date().toISOString();
  saveData(data);
  res.json(order);
});
```

**Step 2: Add mold stats endpoint**

```js
// GET /api/mold-orders/stats
app.get('/api/mold-orders/stats', (req, res) => {
  const data = loadData();
  let orders = data.mold_orders || [];
  const { year, month, group, group_by } = req.query;
  if (group) orders = orders.filter(o => o.group === group);
  if (year) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year));
  if (year && month) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year + '-' + month.padStart(2, '0')));

  // Group by factory or customer
  const key = group_by === 'customer' ? 'customer' : 'mold_factory';
  const grouped = {};
  orders.forEach(o => {
    const k = o[key] || '未知';
    if (!grouped[k]) grouped[k] = { name: k, count: 0, qty: 0, total_fee: 0 };
    grouped[k].count++;
    grouped[k].qty += (o.mold_qty || 0);
    grouped[k].total_fee += (o.mold_fee || 0);
  });

  // Monthly breakdown
  const monthly = {};
  orders.forEach(o => {
    if (!o.order_date) return;
    const m = o.order_date.substring(0, 7); // YYYY-MM
    if (!monthly[m]) monthly[m] = { month: m, count: 0, qty: 0, total_fee: 0 };
    monthly[m].count++;
    monthly[m].qty += (o.mold_qty || 0);
    monthly[m].total_fee += (o.mold_fee || 0);
  });

  res.json({
    summary: Object.values(grouped).sort((a, b) => b.total_fee - a.total_fee),
    monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    total_count: orders.length,
    total_qty: orders.reduce((s, o) => s + (o.mold_qty || 0), 0),
    total_fee: orders.reduce((s, o) => s + (o.mold_fee || 0), 0)
  });
});
```

**Important:** The stats route (`/api/mold-orders/stats`) must be registered BEFORE the parameterized route (`/api/mold-orders/:id`) to avoid `stats` being matched as an `:id`. Or use a different URL pattern like `/api/mold-stats`.

**Step 3: Test with curl or browser**

Run: `node server.js` and test endpoints manually.

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: mold order CRUD and stats API"
```

---

### Task 4: Figure Order CRUD API

**Files:**
- Modify: `server.js`

**Step 1: Add figure order CRUD routes**

Same pattern as mold orders but with figure-specific fields:
- `GET /api/figure-orders` — list with filters (group, factory, customer, status, year, month)
- `POST /api/figure-orders` — create (fields: group, customer, product_name, quantity, figure_fee, figure_factory, order_date, payment_type, notes; status defaults to '已下单')
- `PUT /api/figure-orders/:id` — update
- `DELETE /api/figure-orders/:id` — delete
- `PUT /api/figure-orders/:id/status` — status transitions: 已下单→制作中→已完成
- `GET /api/figure-orders/stats` — stats grouped by factory or customer, with monthly breakdown

**Step 2: Test endpoints**

**Step 3: Commit**

```bash
git add server.js
git commit -m "feat: figure order CRUD and stats API"
```

---

### Task 5: Login Page (index.html)

**Files:**
- Create: `public/index.html`

**Step 1: Build login page**

Structure:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>模具 手办采购订单系统 - 登录</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="style.css" rel="stylesheet">
</head>
<body class="bg-light">
```

Center-aligned login card with:
- Company name header
- Name input (text)
- PIN input (password, 4-digit)
- Login button
- On success: `sessionStorage.setItem('user', name)` then redirect to `mold.html`
- On failure: show error message

Login fetch:
```js
fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, pin })
}).then(r => r.json()).then(data => {
  if (data.success) {
    sessionStorage.setItem('user', data.name);
    window.location.href = 'mold.html';
  } else {
    // show error
  }
});
```

On page load: if `sessionStorage.getItem('user')` exists, redirect to `mold.html`.

**Step 2: Test login flow in browser**

Run: `node server.js`, open `http://localhost:3001`
Expected: Login page shows, login with 管理员/1234 redirects to mold.html (404 for now is OK).

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: login page"
```

---

### Task 6: Mold Order Page — Order List Tab (mold.html)

**Files:**
- Create: `public/mold.html`

**Step 1: Build mold.html page shell**

Include:
- CDN links: Bootstrap CSS, Bootstrap Icons, Chart.js, SheetJS
- Navbar with: logo/title, nav links (模具订单 active, 手办订单 links to figure.html), user badge + logout button
- Auth check: if no `sessionStorage.getItem('user')`, redirect to `index.html`
- X-User header: `encodeURIComponent(sessionStorage.getItem('user'))` on all write requests
- Tab buttons: 订单列表 (active by default) | 统计报表
- Two content divs (show/hide based on active tab)
- Toast container (from utils.js pattern)

**Step 2: Build filter bar for Order List tab**

Filter bar with Bootstrap grid:
- 分组 dropdown: 全部 / 兴信A / 兴信B / 华登
- 模厂 dropdown: 全部 + loaded from `/api/factories`
- 客户 dropdown: 全部 + loaded from `/api/customers`
- 状态 dropdown: 全部 / 已下单 / 已开模 / 已交模 / 已完成
- 日期范围: from date + to date
- 搜索按钮 + 重置按钮
- 新建订单 button (primary, right-aligned)

**Step 3: Build order list table**

```js
function loadMoldOrders() {
  // build query string from filter values
  const params = new URLSearchParams();
  if (filterGroup) params.set('group', filterGroup);
  if (filterFactory) params.set('factory', filterFactory);
  // etc.
  fetch('/api/mold-orders?' + params.toString())
    .then(r => r.json())
    .then(orders => renderMoldTable(orders));
}

function renderMoldTable(orders) {
  const html = orders.map(o => `
    <tr>
      <td>${o.id}</td>
      <td>${esc(o.group)}</td>
      <td>${esc(o.customer)}</td>
      <td>${esc(o.product_name)}</td>
      <td>${o.mold_qty}</td>
      <td>${o.mold_fee.toLocaleString()}</td>
      <td>${esc(o.mold_factory)}</td>
      <td>${fmtDate(o.order_date)}</td>
      <td>${fmtDate(o.mold_start_date)}</td>
      <td>${fmtDate(o.delivery_date)}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${esc(o.status)}</span></td>
      <td>${esc(o.payment_type)}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="editMold(${o.id})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteMold(${o.id})"><i class="bi bi-trash"></i></button>
        ${nextStatusBtn(o)}
      </td>
    </tr>`).join('');

  document.getElementById('moldTableBody').innerHTML = html;
}
```

Table columns: 序号 | 分组 | 客户 | 产品名称/编号 | 模具数量 | 模费(RMB) | 模厂 | 下单时间 | 开模时间 | 交模时间 | 状态 | 付款方式 | 操作

**Step 4: Build create/edit modal**

Bootstrap modal (`modal-lg`) with form:
```html
<div class="modal fade" id="moldModal">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="moldModalTitle">新建模具订单</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="mold-id">
        <div class="row g-3">
          <!-- 分组 select: 兴信A/兴信B/华登 -->
          <!-- 客户 input (text with datalist for autocomplete) -->
          <!-- 产品名称/编号 input -->
          <!-- 模具数量 input number -->
          <!-- 模费(RMB) input number -->
          <!-- 模厂 select (loaded from API) -->
          <!-- 下单时间 input date -->
          <!-- 开模时间 input date -->
          <!-- 生产交模时间 input date -->
          <!-- 付款方式 select: 客付/自付/现金 -->
          <!-- 备注 textarea -->
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
        <button class="btn btn-primary" onclick="saveMold()">保存</button>
      </div>
    </div>
  </div>
</div>
```

Form fields use `col-md-4` grid for 3 columns per row.

**Step 5: Implement CRUD functions**

```js
function openNewMold() {
  document.getElementById('mold-id').value = '';
  document.getElementById('moldModalTitle').textContent = '新建模具订单';
  // clear all fields
  new bootstrap.Modal(document.getElementById('moldModal')).show();
}

function editMold(id) {
  fetch('/api/mold-orders/' + id) // note: need to add GET /:id endpoint or find from loaded list
  // populate form fields
  document.getElementById('moldModalTitle').textContent = '编辑模具订单';
  new bootstrap.Modal(document.getElementById('moldModal')).show();
}

function saveMold() {
  const id = document.getElementById('mold-id').value;
  const body = { /* collect all field values */ };
  const url = id ? '/api/mold-orders/' + id : '/api/mold-orders';
  const method = id ? 'PUT' : 'POST';
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User': encodeURIComponent(currentUser) },
    body: JSON.stringify(body)
  }).then(r => {
    if (!r.ok) throw new Error('保存失败');
    return r.json();
  }).then(() => {
    bootstrap.Modal.getInstance(document.getElementById('moldModal')).hide();
    showToast('保存成功');
    loadMoldOrders();
  }).catch(e => showToast(e.message, 'danger'));
}

function deleteMold(id) {
  if (!confirm('确定删除此订单？')) return;
  fetch('/api/mold-orders/' + id, {
    method: 'DELETE',
    headers: { 'X-User': encodeURIComponent(currentUser) }
  }).then(r => {
    if (!r.ok) throw new Error('删除失败');
    showToast('已删除');
    loadMoldOrders();
  }).catch(e => showToast(e.message, 'danger'));
}

function advanceStatus(id, newStatus) {
  fetch('/api/mold-orders/' + id + '/status', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  }).then(r => {
    if (!r.ok) throw new Error('状态更新失败');
    showToast('状态已更新');
    loadMoldOrders();
  }).catch(e => showToast(e.message, 'danger'));
}
```

**Step 6: Add auto-refresh**

```js
setInterval(loadMoldOrders, 30000);
```

**Step 7: Test in browser**

Open `http://localhost:3001/mold.html`, test:
1. Login redirect works
2. Create new mold order
3. Edit existing order
4. Delete order
5. Status transitions
6. Filters work

**Step 8: Commit**

```bash
git add public/mold.html
git commit -m "feat: mold order page with CRUD and filtering"
```

---

### Task 7: Mold Order Page — Statistics Tab

**Files:**
- Modify: `public/mold.html`

**Step 1: Build statistics tab content**

Add inside the stats tab div:

- Filter bar: 年份 select (2024-2030), 月份 select (全部/1-12月), 分组 select (全部/兴信A/B/华登), 维度 radio (按厂分/按客分)
- 查询按钮
- Summary cards row: 总订单数, 总模具套数, 总金额(RMB)
- Table: 序号 | 名称(厂/客) | 订单数 | 模具套数 | 总金额(RMB) | 占比(%)
- 合计 row at bottom
- Chart container: one bar chart (monthly trend) + one pie chart (by factory/customer)
- 导出Excel button

**Step 2: Load stats and render**

```js
function loadMoldStats() {
  const params = new URLSearchParams();
  const year = document.getElementById('statYear').value;
  const month = document.getElementById('statMonth').value;
  const group = document.getElementById('statGroup').value;
  const groupBy = document.querySelector('input[name="statGroupBy"]:checked').value;
  if (year) params.set('year', year);
  if (month) params.set('month', month);
  if (group) params.set('group', group);
  params.set('group_by', groupBy);

  fetch('/api/mold-orders/stats?' + params.toString())
    .then(r => r.json())
    .then(stats => {
      renderStatsTable(stats);
      renderStatsCharts(stats);
    });
}
```

**Step 3: Render summary table**

```js
function renderStatsTable(stats) {
  // Update summary cards
  document.getElementById('statTotalCount').textContent = stats.total_count;
  document.getElementById('statTotalQty').textContent = stats.total_qty;
  document.getElementById('statTotalFee').textContent = stats.total_fee.toLocaleString();

  // Build table rows
  const total = stats.total_fee || 1;
  const rows = stats.summary.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(s.name)}</td>
      <td>${s.count}</td>
      <td>${s.qty}</td>
      <td>${s.total_fee.toLocaleString()}</td>
      <td>${(s.total_fee / total * 100).toFixed(1)}%</td>
    </tr>`).join('');

  document.getElementById('statsTableBody').innerHTML = rows +
    `<tr class="table-dark fw-bold">
      <td colspan="2">合计</td>
      <td>${stats.total_count}</td>
      <td>${stats.total_qty}</td>
      <td>${stats.total_fee.toLocaleString()}</td>
      <td>100%</td>
    </tr>`;
}
```

**Step 4: Render charts with Chart.js**

```js
let barChart = null, pieChart = null;

function renderStatsCharts(stats) {
  // Bar chart: monthly trend
  if (barChart) barChart.destroy();
  const barCtx = document.getElementById('barChart').getContext('2d');
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: stats.monthly.map(m => m.month),
      datasets: [{
        label: '模费(RMB)',
        data: stats.monthly.map(m => m.total_fee),
        backgroundColor: 'rgba(54, 162, 235, 0.7)'
      }]
    },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: '每月模费趋势' } }
    }
  });

  // Pie chart: by factory/customer
  if (pieChart) pieChart.destroy();
  const pieCtx = document.getElementById('pieChart').getContext('2d');
  const colors = ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40','#C9CBCF','#7BC8A4'];
  pieChart = new Chart(pieCtx, {
    type: 'pie',
    data: {
      labels: stats.summary.map(s => s.name),
      datasets: [{
        data: stats.summary.map(s => s.total_fee),
        backgroundColor: colors.slice(0, stats.summary.length)
      }]
    },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: '费用占比' } }
    }
  });
}
```

**Step 5: Excel export**

```js
function exportMoldStats() {
  const year = document.getElementById('statYear').value || '全部';
  const rows = [];
  // Add header row
  rows.push(['序号', '名称', '订单数', '模具套数', '总金额(RMB)', '占比']);
  // Add data from table
  document.querySelectorAll('#statsTableBody tr').forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    rows.push(cells);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '模具统计');
  XLSX.writeFile(wb, '模具统计_' + year + '.xlsx');
}
```

**Step 6: Test in browser**

Create a few test orders, switch to stats tab, verify:
1. Summary cards show correct totals
2. Table shows grouped data with percentages
3. Bar chart shows monthly trend
4. Pie chart shows proportions
5. Excel export downloads correctly

**Step 7: Commit**

```bash
git add public/mold.html
git commit -m "feat: mold statistics tab with charts and Excel export"
```

---

### Task 8: Figure Order Page (figure.html)

**Files:**
- Create: `public/figure.html`

**Step 1: Build figure.html**

Same structure as mold.html but with figure-specific fields:

**Order List tab differences:**
- Table columns: 序号 | 分组 | 客户 | 产品名称/编号 | 数量 | 手办费(RMB) | 手办厂 | 下采购单时间 | 状态 | 付款方式 | 操作
- Modal form fields: 分组, 客户, 产品名称/编号, 数量, 手办费(RMB), 手办厂 (select from figure_factories), 下采购单时间, 付款方式, 备注
- Status transitions: 已下单 → 制作中 → 已完成
- API endpoints: `/api/figure-orders`, `/api/figure-orders/:id`, `/api/figure-orders/:id/status`

**Statistics tab differences:**
- Stats endpoint: `/api/figure-orders/stats`
- Dimension: 按厂分(手办厂) / 按客分
- Table columns: 序号 | 名称 | 订单数 | 数量 | 总费用(RMB) | 占比
- Charts titled "手办费" instead of "模费"
- Excel export filename: 手办统计_YYYY.xlsx

**Nav link active state:** 手办订单 is active, 模具订单 links to mold.html.

**Step 2: Test in browser**

Full CRUD + stats + charts + export for figure orders.

**Step 3: Commit**

```bash
git add public/figure.html
git commit -m "feat: figure order page with CRUD, stats, charts, and Excel export"
```

---

### Task 9: Polish and Cross-Page Consistency

**Files:**
- Modify: `public/mold.html`
- Modify: `public/figure.html`
- Modify: `public/style.css`
- Modify: `server.js`

**Step 1: Add GET single order endpoint to server.js (if not yet added)**

Needed for edit pre-population. Add for both mold and figure:
```js
app.get('/api/mold-orders/:id', (req, res) => { ... });
app.get('/api/figure-orders/:id', (req, res) => { ... });
```

**Note:** These MUST be registered AFTER the `/stats` routes to avoid route conflicts.

**Step 2: Add customer datalist autocomplete**

On both mold.html and figure.html, load customers from `/api/customers` and populate a `<datalist>` for the customer input field.

**Step 3: Add responsive table wrapper**

Wrap tables in `<div class="table-responsive">` for small screens.

**Step 4: Add row count display**

Show "共 N 条记录" below each order list table.

**Step 5: Style consistency check**

Ensure both pages share the same navbar style, filter bar layout, table style, modal style, and toast positioning via `style.css`.

**Step 6: Test full flow end-to-end**

1. Login → redirect to mold.html
2. Create mold orders with different groups/factories/customers
3. Filter by various combinations
4. Edit and delete orders
5. Advance statuses through full lifecycle
6. Switch to stats tab → verify charts and table
7. Export Excel
8. Navigate to figure.html via navbar
9. Repeat all operations for figure orders
10. Logout → redirect to login page

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: polish UI, add customer autocomplete, responsive tables"
```

---

### Task 10: Final Review and Cleanup

**Files:**
- All files

**Step 1: Security review**

- Verify all user input is escaped with `esc()` before rendering as HTML
- Verify X-User header is checked on all write endpoints
- Verify no XSS vectors in table rendering
- Verify JSON parsing errors are handled gracefully

**Step 2: Test edge cases**

- Empty data (no orders)
- Very long product names
- Special characters in customer names (& < > ")
- Date edge cases (empty dates, invalid dates)
- Zero quantities/fees

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final review and cleanup"
```
