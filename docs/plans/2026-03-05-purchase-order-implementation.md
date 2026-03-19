# Purchase Order Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add purchase order creation, printing, and Excel export to the existing mold/figure procurement system.

**Architecture:** Extend existing Express + JSON storage backend with purchase order CRUD APIs. Add a "purchase orders" tab to mold.html and figure.html with create/edit modals. Add a dedicated print page (po-print.html) that renders the PO in the exact format of the company's existing Excel template (BS069).

**Tech Stack:** Express 4.18, Bootstrap 5.3.2 CDN, Chart.js 4.x CDN, SheetJS 0.18.5 CDN, vanilla JS. All existing — no new dependencies.

**Working directory:** `C:\Users\Hufan\Desktop\模具 手办采购订单系统`

**Reference files:**
- `server.js` — existing Express server with JSON cache + atomic write pattern
- `public/mold.html` — existing mold order page (3 tabs to add)
- `public/figure.html` — existing figure order page (3 tabs to add)
- `data/data.json` — JSON storage file
- BS069 Excel template structure (see design doc)

---

### Task 1: Extend Data Storage and Add PO API Routes

**Files:**
- Modify: `data/data.json`
- Modify: `server.js`

**Step 1: Add purchase_orders array to data.json**

Add `"purchase_orders": []` and `"po_next_id": 1` to data.json. The file should become:

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
  "nextId": 1,
  "purchase_orders": [],
  "po_next_id": 1
}
```

**Step 2: Add PO API routes to server.js**

Insert BEFORE the `// ─── Start Server ───` section at the bottom of server.js. Add a full block of routes:

```js
// ═══════════════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════════════════════════════════

// Helper: generate PO number
function generatePoNumber(type) {
  const prefix = type === 'mold' ? 'B' : 'F';
  const d = new Date();
  const dateStr = d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  return prefix + dateStr;
}

// List
app.get('/api/purchase-orders', (req, res) => {
  const data = loadData();
  let pos = data.purchase_orders || [];
  const { type, group, year, status } = req.query;
  if (type) pos = pos.filter(p => p.type === type);
  if (group) pos = pos.filter(p => p.group === group);
  if (status) pos = pos.filter(p => p.status === status);
  if (year) pos = pos.filter(p => p.created_at && p.created_at.startsWith(year));
  pos.sort((a, b) => b.id - a.id);
  res.json(pos);
});

// Get single
app.get('/api/purchase-orders/:id', (req, res) => {
  const data = loadData();
  const po = (data.purchase_orders || []).find(p => p.id === Number(req.params.id));
  if (!po) return res.status(404).json({ error: '采购单不存在' });
  res.json(po);
});

// Create
app.post('/api/purchase-orders', (req, res) => {
  const data = loadData();
  if (!data.purchase_orders) data.purchase_orders = [];
  if (!data.po_next_id) data.po_next_id = 1;
  const user = decodeURIComponent(req.headers['x-user'] || '');
  const b = req.body;

  // Save images in items
  const items = (b.items || []).map((item, i) => {
    const processed = { ...item, seq: i + 1 };
    if (item.image_data) {
      processed.image = saveImage(item.image_data);
      delete processed.image_data;
    }
    return processed;
  });

  const po = {
    id: data.po_next_id++,
    po_number: b.po_number || generatePoNumber(b.type),
    type: b.type || 'mold',
    group: b.group || '',
    supplier_name: b.supplier_name || '',
    supplier_contact: b.supplier_contact || '',
    supplier_phone: b.supplier_phone || '',
    supplier_fax: b.supplier_fax || '',
    our_contact: b.our_contact || '',
    our_phone: b.our_phone || '0769-87362376',
    product_name: b.product_name || '',
    items: items,
    delivery_date_text: b.delivery_date_text || '',
    delivery_address: b.delivery_address || '东莞清溪上元管理区银坑路兴信厂',
    payment_terms: b.payment_terms || '开模付首期款50%，交模后付尾期50%',
    payment_type: b.payment_type || '',
    tax_rate: Number(b.tax_rate) || 13,
    settlement_days: Number(b.settlement_days) || 30,
    notes: b.notes || '',
    status: '草稿',
    created_by: user,
    created_at: new Date().toISOString()
  };
  data.purchase_orders.push(po);
  saveData(data);
  res.json(po);
});

// Update
app.put('/api/purchase-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = (data.purchase_orders || []).findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: '采购单不存在' });
  const po = data.purchase_orders[idx];
  const b = req.body;

  // Update scalar fields
  ['po_number', 'type', 'group', 'supplier_name', 'supplier_contact', 'supplier_phone',
   'supplier_fax', 'our_contact', 'our_phone', 'product_name', 'delivery_date_text',
   'delivery_address', 'payment_terms', 'payment_type', 'notes'].forEach(f => {
    if (b[f] !== undefined) po[f] = b[f];
  });
  if (b.tax_rate !== undefined) po.tax_rate = Number(b.tax_rate) || 13;
  if (b.settlement_days !== undefined) po.settlement_days = Number(b.settlement_days) || 30;

  // Update items if provided
  if (b.items) {
    po.items = b.items.map((item, i) => {
      const processed = { ...item, seq: i + 1 };
      if (item.image_data) {
        processed.image = saveImage(item.image_data);
        delete processed.image_data;
      }
      return processed;
    });
  }

  po.updated_at = new Date().toISOString();
  saveData(data);
  res.json(po);
});

// Delete
app.delete('/api/purchase-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = (data.purchase_orders || []).findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: '采购单不存在' });
  data.purchase_orders.splice(idx, 1);
  saveData(data);
  res.json({ success: true });
});

// Status transition
app.put('/api/purchase-orders/:id/status', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const po = (data.purchase_orders || []).find(p => p.id === id);
  if (!po) return res.status(404).json({ error: '采购单不存在' });
  const valid = { '草稿': ['已确认'], '已确认': ['草稿'] };
  const newStatus = req.body.status;
  if (!valid[po.status] || !valid[po.status].includes(newStatus)) {
    return res.status(400).json({ error: '无效的状态变更' });
  }
  po.status = newStatus;
  po.updated_at = new Date().toISOString();
  saveData(data);
  res.json(po);
});

// Generate next PO number suggestion
app.get('/api/purchase-orders/next-number', (req, res) => {
  const type = req.query.type || 'mold';
  res.json({ po_number: generatePoNumber(type) });
});
```

**IMPORTANT:** The `/api/purchase-orders/next-number` route must be placed BEFORE `/api/purchase-orders/:id` to avoid `next-number` matching as `:id`. Reorder the routes so `next-number` and the list route come first.

**Step 3: Test server starts**

Run: `node server.js`
Expected: Server starts without errors on port 3001.

**Step 4: Commit**

```bash
git add data/data.json server.js
git commit -m "feat: add purchase order CRUD API routes"
```

---

### Task 2: Add Purchase Order Tab to mold.html

**Files:**
- Modify: `public/mold.html`

**Step 1: Add third tab button**

In the `<ul class="nav nav-tabs mb-3">` section (around line 31-34), add a third tab:

```html
<li class="nav-item"><a class="nav-link" href="#" onclick="switchTab('po')">采购单</a></li>
```

**Step 2: Add PO tab content div**

After the closing `</div>` of `id="tabStats"` (around line 141), add the full PO tab HTML:

```html
  <!-- ═══ Tab 3: Purchase Orders ═══ -->
  <div id="tabPO" style="display:none">
    <div class="filter-bar row g-2 mb-3 align-items-end">
      <div class="col-auto">
        <label>状态</label>
        <select class="form-select form-select-sm" id="poFStatus"><option value="">全部</option><option>草稿</option><option>已确认</option></select>
      </div>
      <div class="col-auto">
        <label>年份</label>
        <select class="form-select form-select-sm" id="poFYear"><option value="">全部</option></select>
      </div>
      <div class="col-auto">
        <button class="btn btn-sm btn-primary" onclick="loadPOs()"><i class="bi bi-search"></i> 查询</button>
      </div>
      <div class="col-auto ms-auto">
        <button class="btn btn-sm btn-success" onclick="openNewPO()"><i class="bi bi-plus-lg"></i> 新建采购单</button>
      </div>
    </div>

    <div class="table-responsive">
      <table class="table table-sm table-bordered table-hover">
        <thead class="table-dark">
          <tr>
            <th>采购单编号</th><th>分组</th><th>供应商</th><th>产品名称</th>
            <th>明细数</th><th>合计金额</th><th>状态</th><th>创建时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody id="poBody"></tbody>
      </table>
    </div>
    <div id="poCount" class="text-muted small"></div>
  </div>
```

**Step 3: Add PO create/edit modal**

After the existing image zoom modal (around line 242), add:

```html
<!-- PO Create/Edit Modal -->
<div class="modal fade" id="poModal" tabindex="-1">
  <div class="modal-dialog modal-xl">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="poModalTitle">新建模具采购单</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="po-id">
        <!-- Header info -->
        <div class="row g-3 mb-3">
          <div class="col-md-3">
            <label class="form-label">采购单编号 *</label>
            <input type="text" class="form-control" id="po-po_number">
          </div>
          <div class="col-md-3">
            <label class="form-label">分组 *</label>
            <select class="form-select" id="po-group"><option value="">请选择</option><option>兴信A</option><option>兴信B</option><option>华登</option></select>
          </div>
          <div class="col-md-3">
            <label class="form-label">产品名称 *</label>
            <input type="text" class="form-control" id="po-product_name" placeholder="如 BS069">
          </div>
          <div class="col-md-3">
            <label class="form-label">费用承担 *</label>
            <select class="form-select" id="po-payment_type"><option value="">请选择</option><option>客付</option><option>自付</option></select>
          </div>
        </div>
        <div class="row g-3 mb-3">
          <div class="col-md-4">
            <label class="form-label">供应商（模厂） *</label>
            <select class="form-select" id="po-supplier_name"><option value="">请选择</option></select>
          </div>
          <div class="col-md-4">
            <label class="form-label">供应商联络人</label>
            <input type="text" class="form-control" id="po-supplier_contact">
          </div>
          <div class="col-md-4">
            <label class="form-label">供应商电话</label>
            <input type="text" class="form-control" id="po-supplier_phone">
          </div>
        </div>
        <div class="row g-3 mb-3">
          <div class="col-md-4">
            <label class="form-label">我方联络人</label>
            <input type="text" class="form-control" id="po-our_contact">
          </div>
          <div class="col-md-4">
            <label class="form-label">交货地址</label>
            <input type="text" class="form-control" id="po-delivery_address" value="东莞清溪上元管理区银坑路兴信厂">
          </div>
          <div class="col-md-4">
            <label class="form-label">付款方式</label>
            <input type="text" class="form-control" id="po-payment_terms" value="开模付首期款50%，交模后付尾期50%">
          </div>
        </div>

        <!-- Items table -->
        <hr>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>模具明细</strong>
          <button class="btn btn-sm btn-outline-primary" onclick="addPoItem()"><i class="bi bi-plus"></i> 添加行</button>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-bordered">
            <thead class="table-light">
              <tr>
                <th style="width:40px">序号</th>
                <th>零件名称</th>
                <th>材料</th>
                <th>GATE</th>
                <th>CAV/UP</th>
                <th style="width:100px">单价</th>
                <th style="width:120px">金额(RMB)</th>
                <th>备注</th>
                <th style="width:40px"></th>
              </tr>
            </thead>
            <tbody id="poItemsBody"></tbody>
            <tfoot>
              <tr class="table-secondary fw-bold">
                <td colspan="6" class="text-end">合计：</td>
                <td id="poTotalAmount">0</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
        <button class="btn btn-primary" onclick="savePO()">保存</button>
      </div>
    </div>
  </div>
</div>
```

**Step 4: Update switchTab function**

Replace the existing `switchTab` function with:

```js
function switchTab(tab) {
  document.querySelectorAll('.nav-tabs .nav-link').forEach(function(el, i) {
    el.classList.toggle('active', (tab === 'list' && i === 0) || (tab === 'stats' && i === 1) || (tab === 'po' && i === 2));
  });
  document.getElementById('tabList').style.display = tab === 'list' ? '' : 'none';
  document.getElementById('tabStats').style.display = tab === 'stats' ? '' : 'none';
  document.getElementById('tabPO').style.display = tab === 'po' ? '' : 'none';
  if (tab === 'stats') loadStats();
  if (tab === 'po') loadPOs();
}
```

**Step 5: Add PO year filter init**

In the `initPage()` function, add after the existing year loop:

```js
  // PO year filter
  var poYSel = document.getElementById('poFYear');
  for (var y = curYear; y >= 2024; y--) {
    var opt = document.createElement('option');
    opt.value = y; opt.textContent = y + '年';
    poYSel.appendChild(opt);
  }

  // PO supplier dropdown
  fetch('/api/factories').then(function(r) { return r.json(); }).then(function(d) {
    var poSup = document.getElementById('po-supplier_name');
    (d.mold_factories || []).forEach(function(f) {
      poSup.innerHTML += '<option>' + esc(f) + '</option>';
    });
  });
```

Note: The existing `initPage` already calls `/api/factories` for the filter and modal factory dropdowns. You can either merge this into the existing `.then()` callback, or make a second call. Merging is cleaner — add the `po-supplier_name` population inside the existing `.then()` block.

**Step 6: Add PO JavaScript functions**

Add the following at the bottom of the `<script>` section, before `setInterval(loadOrders, 30000);`:

```js
// ─── Purchase Orders ────────────────────────────────────────────────
var allPOs = [];
var poItems = [];

function loadPOs() {
  var params = new URLSearchParams();
  params.set('type', 'mold');
  var s = document.getElementById('poFStatus').value; if (s) params.set('status', s);
  var y = document.getElementById('poFYear').value; if (y) params.set('year', y);

  fetch('/api/purchase-orders?' + params.toString())
    .then(function(r) { return r.json(); })
    .then(function(pos) {
      allPOs = pos;
      renderPOTable(pos);
    });
}

function renderPOTable(pos) {
  if (!pos.length) {
    document.getElementById('poBody').innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><i class="bi bi-inbox" style="font-size:2rem"></i><br>暂无采购单</td></tr>';
    document.getElementById('poCount').textContent = '';
    return;
  }
  var html = pos.map(function(p) {
    var totalAmt = (p.items || []).reduce(function(s, it) { return s + (Number(it.amount) || 0); }, 0);
    var statusCls = p.status === '已确认' ? 'bg-success' : 'bg-secondary';
    return '<tr>' +
      '<td>' + esc(p.po_number) + '</td>' +
      '<td>' + esc(p.group) + '</td>' +
      '<td>' + esc(p.supplier_name) + '</td>' +
      '<td>' + esc(p.product_name) + '</td>' +
      '<td>' + (p.items || []).length + '</td>' +
      '<td>' + totalAmt.toLocaleString() + '</td>' +
      '<td><span class="badge ' + statusCls + '">' + esc(p.status) + '</span></td>' +
      '<td>' + fmtDate(p.created_at) + '</td>' +
      '<td class="text-nowrap">' +
        '<a href="po-print.html?id=' + p.id + '" target="_blank" class="btn btn-sm btn-outline-info" title="打印预览"><i class="bi bi-printer"></i></a> ' +
        '<button class="btn btn-sm btn-outline-primary" onclick="editPO(' + p.id + ')"><i class="bi bi-pencil"></i></button> ' +
        '<button class="btn btn-sm btn-outline-danger" onclick="deletePO(' + p.id + ')"><i class="bi bi-trash"></i></button>' +
      '</td>' +
    '</tr>';
  }).join('');
  document.getElementById('poBody').innerHTML = html;
  document.getElementById('poCount').textContent = '共 ' + pos.length + ' 张采购单';
}

function openNewPO() {
  document.getElementById('po-id').value = '';
  document.getElementById('poModalTitle').textContent = '新建模具采购单';
  ['po_number','group','product_name','payment_type','supplier_name','supplier_contact','supplier_phone','our_contact'].forEach(function(f) {
    document.getElementById('po-' + f).value = '';
  });
  document.getElementById('po-delivery_address').value = '东莞清溪上元管理区银坑路兴信厂';
  document.getElementById('po-payment_terms').value = '开模付首期款50%，交模后付尾期50%';
  // Generate PO number
  fetch('/api/purchase-orders/next-number?type=mold')
    .then(function(r) { return r.json(); })
    .then(function(d) { document.getElementById('po-po_number').value = d.po_number; });
  // Set our_contact to current user
  document.getElementById('po-our_contact').value = currentUser;
  poItems = [{ part_name: '', material: '', gate: '', cav_up: '', unit_price: '', amount: '', notes: '' }];
  renderPoItems();
  new bootstrap.Modal(document.getElementById('poModal')).show();
}

function editPO(id) {
  var p = allPOs.find(function(x) { return x.id === id; });
  if (!p) return;
  document.getElementById('po-id').value = p.id;
  document.getElementById('poModalTitle').textContent = '编辑模具采购单';
  ['po_number','group','product_name','payment_type','supplier_name','supplier_contact','supplier_phone','our_contact','delivery_address','payment_terms'].forEach(function(f) {
    document.getElementById('po-' + f).value = p[f] || '';
  });
  poItems = (p.items || []).map(function(it) { return Object.assign({}, it); });
  if (!poItems.length) poItems = [{ part_name: '', material: '', gate: '', cav_up: '', unit_price: '', amount: '', notes: '' }];
  renderPoItems();
  new bootstrap.Modal(document.getElementById('poModal')).show();
}

function addPoItem() {
  poItems.push({ part_name: '', material: '', gate: '', cav_up: '', unit_price: '', amount: '', notes: '' });
  renderPoItems();
}

function removePoItem(idx) {
  syncPoItemsFromDOM();
  poItems.splice(idx, 1);
  if (poItems.length === 0) poItems.push({ part_name: '', material: '', gate: '', cav_up: '', unit_price: '', amount: '', notes: '' });
  renderPoItems();
}

function renderPoItems() {
  var html = poItems.map(function(it, i) {
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><input type="text" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="part_name" value="' + esc(it.part_name || '') + '"></td>' +
      '<td><input type="text" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="material" value="' + esc(it.material || '') + '"></td>' +
      '<td><input type="text" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="gate" value="' + esc(it.gate || '') + '"></td>' +
      '<td><input type="text" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="cav_up" value="' + esc(it.cav_up || '') + '"></td>' +
      '<td><input type="number" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="unit_price" value="' + (it.unit_price || '') + '" onchange="calcPoTotal()"></td>' +
      '<td><input type="number" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="amount" value="' + (it.amount || '') + '" onchange="calcPoTotal()"></td>' +
      '<td><input type="text" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="notes" value="' + esc(it.notes || '') + '"></td>' +
      '<td><button class="btn btn-sm btn-outline-danger" onclick="removePoItem(' + i + ')"><i class="bi bi-x"></i></button></td>' +
    '</tr>';
  }).join('');
  document.getElementById('poItemsBody').innerHTML = html;
  calcPoTotal();
}

function syncPoItemsFromDOM() {
  document.querySelectorAll('.po-item').forEach(function(el) {
    var idx = Number(el.dataset.idx);
    var field = el.dataset.field;
    if (poItems[idx]) poItems[idx][field] = el.value;
  });
}

function calcPoTotal() {
  var total = 0;
  document.querySelectorAll('.po-item[data-field="amount"]').forEach(function(el) {
    total += Number(el.value) || 0;
  });
  document.getElementById('poTotalAmount').textContent = total.toLocaleString();
}

function savePO() {
  syncPoItemsFromDOM();
  var id = document.getElementById('po-id').value;
  var body = {
    type: 'mold',
    po_number: document.getElementById('po-po_number').value,
    group: document.getElementById('po-group').value,
    product_name: document.getElementById('po-product_name').value,
    payment_type: document.getElementById('po-payment_type').value,
    supplier_name: document.getElementById('po-supplier_name').value,
    supplier_contact: document.getElementById('po-supplier_contact').value,
    supplier_phone: document.getElementById('po-supplier_phone').value,
    our_contact: document.getElementById('po-our_contact').value,
    delivery_address: document.getElementById('po-delivery_address').value,
    payment_terms: document.getElementById('po-payment_terms').value,
    items: poItems.filter(function(it) { return it.part_name; })
  };
  if (!body.po_number || !body.group || !body.supplier_name) {
    showToast('请填写采购单编号、分组和供应商', 'danger');
    return;
  }
  var url = id ? '/api/purchase-orders/' + id : '/api/purchase-orders';
  var method = id ? 'PUT' : 'POST';
  fetch(url, { method: method, headers: headers(), body: JSON.stringify(body) })
    .then(function(r) { if (!r.ok) throw new Error('保存失败'); return r.json(); })
    .then(function() {
      bootstrap.Modal.getInstance(document.getElementById('poModal')).hide();
      showToast('采购单已保存');
      loadPOs();
    })
    .catch(function(e) { showToast(e.message, 'danger'); });
}

function deletePO(id) {
  if (!confirm('确定删除此采购单？')) return;
  fetch('/api/purchase-orders/' + id, { method: 'DELETE', headers: headers() })
    .then(function(r) { if (!r.ok) throw new Error('删除失败'); return r.json(); })
    .then(function() { showToast('已删除'); loadPOs(); })
    .catch(function(e) { showToast(e.message, 'danger'); });
}
```

**Step 7: Test in browser**

Run: `node server.js`, open `http://localhost:3001/mold.html`
1. Click "采购单" tab — should show empty state
2. Click "新建采购单" — modal opens with auto-generated PO number
3. Fill in fields, add item rows, save
4. Verify PO appears in list
5. Edit and delete work

**Step 8: Commit**

```bash
git add public/mold.html
git commit -m "feat: add purchase order tab to mold page"
```

---

### Task 3: Add Purchase Order Tab to figure.html

**Files:**
- Modify: `public/figure.html`

**Step 1: Same structure as mold.html but with figure-specific differences**

Apply the same changes as Task 2, with these differences:

1. **Tab name:** "采购单" (same)
2. **Modal title:** "新建手办采购单" instead of "新建模具采购单"
3. **Supplier dropdown id `po-supplier_name`:** Populate from `d.figure_factories` instead of `d.mold_factories`
4. **Items table columns:** 序号 / 产品名称 / 数量 / 单价 / 金额 / 备注 (no 材料/GATE/CAV·UP)
5. **Item fields:** `product_name`, `quantity`, `unit_price`, `amount`, `notes`
6. **API calls:** `type=figure` in query params and POST body
7. **PO number prefix:** `F` instead of `B`
8. **Payment terms default:** "月结30天" instead of "开模付首期款50%..."

The items table header in the modal should be:

```html
<tr>
  <th style="width:40px">序号</th>
  <th>产品名称</th>
  <th style="width:80px">数量</th>
  <th style="width:100px">单价</th>
  <th style="width:120px">金额(RMB)</th>
  <th>备注</th>
  <th style="width:40px"></th>
</tr>
```

The `renderPoItems` function should render figure item fields:

```js
function renderPoItems() {
  var html = poItems.map(function(it, i) {
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><input type="text" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="product_name" value="' + esc(it.product_name || '') + '"></td>' +
      '<td><input type="number" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="quantity" value="' + (it.quantity || '') + '"></td>' +
      '<td><input type="number" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="unit_price" value="' + (it.unit_price || '') + '" onchange="calcPoTotal()"></td>' +
      '<td><input type="number" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="amount" value="' + (it.amount || '') + '" onchange="calcPoTotal()"></td>' +
      '<td><input type="text" class="form-control form-control-sm po-item" data-idx="' + i + '" data-field="notes" value="' + esc(it.notes || '') + '"></td>' +
      '<td><button class="btn btn-sm btn-outline-danger" onclick="removePoItem(' + i + ')"><i class="bi bi-x"></i></button></td>' +
    '</tr>';
  }).join('');
  document.getElementById('poItemsBody').innerHTML = html;
  calcPoTotal();
}
```

Empty item template:

```js
{ product_name: '', quantity: '', unit_price: '', amount: '', notes: '' }
```

**Step 2: Test in browser**

Open `http://localhost:3001/figure.html`, test the same flow as Task 2.

**Step 3: Commit**

```bash
git add public/figure.html
git commit -m "feat: add purchase order tab to figure page"
```

---

### Task 4: Print Preview Page (po-print.html)

**Files:**
- Create: `public/po-print.html`

**Step 1: Create the print page**

This page loads a PO by `?id=xxx` URL param and renders it in the exact format of the BS069 Excel template. It must include:

1. **Company header:**
   - 东莞兴信塑胶制品有限公司
   - 广东省东莞市清溪镇上元银坑路
   - TEL: 0769-87362376 / FAX: 0769-87362377
   - 采购单 (centered, large)

2. **Info section (2-column):**
   - Left: 供应商 / 联络人 / 联系电话 / Fax
   - Right: 订单编号 / 联络人 / 联系电话 / Fax

3. **Product name row:** 产品名称：XXX

4. **Items table:**
   - Mold type: 序号/零件名称/材料/GATE/CAV·UP/单价/金额(RMB)/图片/备注
   - Figure type: 序号/产品名称/数量/单价/金额(RMB)/备注
   - 合计 row at bottom

5. **Terms section (numbered):**
   1. yyyy年mm月dd日前交货...
   2. 单价已含 X% 增值税，月结 N 天
   3. 货物及部件质量符合国外现行最新标准

6. **Legal notices** (fixed text, same as BS069)

7. **Payment type checkboxes:** 客人付款 / 兴信自付

8. **Signature area:** 供应商确认 / 采购签核 / 主管 / 经理

9. **Action buttons (no-print):** 打印 / 导出Excel / 返回

Create the full file `public/po-print.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>采购单打印</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SimSun', '宋体', 'Microsoft YaHei', serif; font-size: 12px; color: #000; background: #f0f0f0; }
    .page { width: 210mm; min-height: 297mm; margin: 10px auto; background: #fff; padding: 15mm 18mm; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    .company-name { text-align: center; font-size: 18px; font-weight: bold; letter-spacing: 2px; }
    .company-addr { text-align: center; font-size: 11px; margin-top: 4px; }
    .company-tel { font-size: 11px; margin-top: 2px; }
    .po-title { text-align: center; font-size: 22px; font-weight: bold; margin: 12px 0; letter-spacing: 6px; border-bottom: 2px solid #000; padding-bottom: 8px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 10px 0; font-size: 12px; }
    .info-grid .row { display: flex; padding: 3px 0; }
    .info-grid .label { min-width: 70px; }
    .info-grid .value { flex: 1; border-bottom: 1px solid #999; padding-left: 4px; min-height: 18px; }
    .product-row { font-size: 13px; font-weight: bold; margin: 10px 0 6px; }
    table.items { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.items th, table.items td { border: 1px solid #000; padding: 4px 6px; text-align: center; }
    table.items th { background: #e8e8e8; font-weight: bold; }
    table.items td { vertical-align: top; }
    table.items td.left { text-align: left; }
    table.items .total-row td { font-weight: bold; }
    table.items img { max-height: 50px; max-width: 80px; }
    .terms { margin-top: 10px; font-size: 11px; line-height: 1.8; }
    .terms p { text-indent: 0; }
    .notices { margin-top: 8px; font-size: 10.5px; line-height: 1.7; }
    .payment-check { margin: 8px 0; font-size: 12px; }
    .payment-check .box { display: inline-block; width: 14px; height: 14px; border: 1px solid #000; text-align: center; line-height: 14px; font-size: 11px; margin: 0 2px; vertical-align: middle; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; margin-top: 20px; font-size: 12px; }
    .signatures .sig { padding: 4px 0; }
    .signatures .sig-line { border-bottom: 1px solid #999; height: 40px; }
    .date-line { margin-top: 8px; font-size: 11px; }
    .actions { text-align: center; margin: 20px auto; }
    .actions button { padding: 8px 24px; margin: 0 8px; font-size: 14px; cursor: pointer; border: 1px solid #999; border-radius: 4px; background: #fff; }
    .actions button.primary { background: #1a3a6c; color: #fff; border-color: #1a3a6c; }
    .actions button:hover { opacity: .85; }
    @media print {
      body { background: #fff; }
      .page { margin: 0; padding: 10mm 15mm; box-shadow: none; width: 100%; }
      .actions { display: none !important; }
    }
  </style>
</head>
<body>

<div class="actions" id="actions">
  <button class="primary" onclick="window.print()">打印</button>
  <button onclick="exportExcel()">导出 Excel</button>
  <button onclick="window.close()">关闭</button>
</div>

<div class="page" id="page">
  <div class="company-name">东莞兴信塑胶制品有限公司</div>
  <div class="company-addr">广东省东莞市清溪镇上元银坑路</div>
  <div class="company-tel" style="display:flex;justify-content:space-between;">
    <span>TEL：0769-87362376</span>
    <span>FAX：0769-87362377</span>
  </div>
  <div class="po-title">采 购 单</div>

  <div class="info-grid">
    <div>
      <div class="row"><span class="label">供应商：</span><span class="value" id="d-supplier"></span></div>
      <div class="row"><span class="label">联络人：</span><span class="value" id="d-sup-contact"></span></div>
      <div class="row"><span class="label">联系电话：</span><span class="value" id="d-sup-phone"></span></div>
      <div class="row"><span class="label">Fax：</span><span class="value" id="d-sup-fax"></span></div>
    </div>
    <div>
      <div class="row"><span class="label">订单编号：</span><span class="value" id="d-po-number"></span></div>
      <div class="row"><span class="label">联络人：</span><span class="value" id="d-our-contact"></span></div>
      <div class="row"><span class="label">联系电话：</span><span class="value" id="d-our-phone"></span></div>
      <div class="row"><span class="label">Fax：</span><span class="value" id="d-our-fax"></span></div>
    </div>
  </div>

  <div class="product-row">产品名称：<span id="d-product"></span></div>

  <table class="items" id="itemsTable">
    <thead id="itemsHead"></thead>
    <tbody id="itemsBody"></tbody>
  </table>

  <div class="terms" id="termsSection"></div>

  <div class="notices">
    <p>注意事项：1、收到本采购订单后，请24小时内予确认（签名、或及盖章），未签回，拒找数。</p>
    <p>2、供应商按时交货，延期交货应承担违约责任，且采购方有权取消部分或全部订单；</p>
    <p>3.货物及部件质量符合欧洲、美国、中国的玩具标准、安全标准，符合欧盟ROHS标准及其最新指令</p>
    <p>4.货物之详细规格应与样品、或图纸相符；</p>
    <p>5.采购方收货仅为形式、数量收货，供应商保证货物质量、规格符合上述约定，同意随时抽检或全检，如有不符，同意补货或退货，如生产或市场销售中造成采购方损失，承担采购方损失；</p>
    <p>6、每月对账单于次月 5 号前送达，核对无误后请及时开票请款；如发生争议，同意由采购方法院管辖；</p>
    <p>7.其他事项：<span id="d-notes"></span></p>
    <p>8.付款方式：<span id="d-payment-terms"></span></p>
  </div>

  <div class="payment-check">
    费用承担：客人付款<span class="box" id="ck-client"></span>&nbsp;&nbsp;兴信自付<span class="box" id="ck-self"></span>
  </div>

  <div class="signatures">
    <div class="sig">供应商确认：<div class="sig-line"></div></div>
    <div class="sig">采购签核：<div class="sig-line"></div></div>
    <div class="sig">主管：<div class="sig-line"></div></div>
    <div class="sig">经理：<div class="sig-line"></div></div>
  </div>
  <div class="date-line" style="display:flex;gap:40px;">
    <span>时间：&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;&nbsp;&nbsp;月&nbsp;&nbsp;&nbsp;&nbsp;日</span>
    <span>时间：&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;&nbsp;&nbsp;月&nbsp;&nbsp;&nbsp;&nbsp;日</span>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script>
var poData = null;

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function loadPO() {
  var params = new URLSearchParams(window.location.search);
  var id = params.get('id');
  if (!id) { document.getElementById('page').innerHTML = '<p style="text-align:center;padding:40px">缺少采购单ID参数</p>'; return; }

  fetch('/api/purchase-orders/' + id)
    .then(function(r) { if (!r.ok) throw new Error('加载失败'); return r.json(); })
    .then(function(po) {
      poData = po;
      renderPO(po);
    })
    .catch(function(e) { document.getElementById('page').innerHTML = '<p style="text-align:center;padding:40px">' + e.message + '</p>'; });
}

function renderPO(po) {
  document.getElementById('d-supplier').textContent = po.supplier_name || '';
  document.getElementById('d-sup-contact').textContent = po.supplier_contact || '';
  document.getElementById('d-sup-phone').textContent = po.supplier_phone || '';
  document.getElementById('d-sup-fax').textContent = po.supplier_fax || '';
  document.getElementById('d-po-number').textContent = po.po_number || '';
  document.getElementById('d-our-contact').textContent = po.our_contact || '';
  document.getElementById('d-our-phone').textContent = po.our_phone || '0769-87362376';
  document.getElementById('d-our-fax').textContent = '';
  document.getElementById('d-product').textContent = po.product_name || '';
  document.getElementById('d-notes').textContent = po.notes || '';
  document.getElementById('d-payment-terms').textContent = po.payment_terms || '';

  // Payment type checkboxes
  document.getElementById('ck-client').textContent = po.payment_type === '客付' ? 'V' : '';
  document.getElementById('ck-self').textContent = po.payment_type === '自付' ? 'V' : '';

  // Items table
  var items = po.items || [];
  var isMold = po.type === 'mold';
  var headHtml, bodyHtml;

  if (isMold) {
    headHtml = '<tr><th>序号</th><th>零件名称</th><th>材料</th><th>GATE</th><th>CAV/UP</th><th>单价</th><th>金额（RMB）</th><th>图片</th><th>备 注</th></tr>';
    var total = 0;
    bodyHtml = items.map(function(it, i) {
      total += Number(it.amount) || 0;
      var imgHtml = it.image ? '<img src="' + esc(it.image) + '">' : '';
      return '<tr><td>' + (i + 1) + '</td><td class="left">' + esc(it.part_name) + '</td><td>' + esc(it.material) + '</td><td>' + esc(it.gate) + '</td><td>' + esc(it.cav_up) + '</td><td>' + (it.unit_price ? Number(it.unit_price).toLocaleString() : '') + '</td><td>' + (it.amount ? Number(it.amount).toLocaleString() : '') + '</td><td>' + imgHtml + '</td><td class="left">' + esc(it.notes) + '</td></tr>';
    }).join('');
    bodyHtml += '<tr class="total-row"><td colspan="5"></td><td>合计：</td><td>' + total.toLocaleString() + '</td><td colspan="2"></td></tr>';
  } else {
    headHtml = '<tr><th>序号</th><th>产品名称</th><th>数量</th><th>单价</th><th>金额（RMB）</th><th>备 注</th></tr>';
    var total = 0;
    bodyHtml = items.map(function(it, i) {
      total += Number(it.amount) || 0;
      return '<tr><td>' + (i + 1) + '</td><td class="left">' + esc(it.product_name) + '</td><td>' + (it.quantity || '') + '</td><td>' + (it.unit_price ? Number(it.unit_price).toLocaleString() : '') + '</td><td>' + (it.amount ? Number(it.amount).toLocaleString() : '') + '</td><td class="left">' + esc(it.notes) + '</td></tr>';
    }).join('');
    bodyHtml += '<tr class="total-row"><td colspan="3"></td><td>合计：</td><td>' + total.toLocaleString() + '</td><td></td></tr>';
  }

  document.getElementById('itemsHead').innerHTML = headHtml;
  document.getElementById('itemsBody').innerHTML = bodyHtml;

  // Terms
  var created = new Date(po.created_at);
  var deliveryText = po.delivery_date_text || (created.getFullYear() + '年' + (created.getMonth() + 2) + '月' + created.getDate() + '日');
  var termsHtml =
    '<p>1.&nbsp;&nbsp;&nbsp;' + deliveryText + '前交货送 ' + esc(po.delivery_address || '东莞清溪上元管理区银坑路兴信厂') + ' 处，收货人：' + esc(po.our_contact) + '</p>' +
    '<p>2.单价已含 ' + (po.tax_rate || 13) + ' %增值税，月结 ' + (po.settlement_days || 30) + ' 天；</p>' +
    '<p>3、货物及部件质量符合国外现行最新标准</p>';
  document.getElementById('termsSection').innerHTML = termsHtml;

  document.title = '采购单 - ' + (po.po_number || '');
}

function exportExcel() {
  if (!poData) return;
  var po = poData;
  var items = po.items || [];
  var isMold = po.type === 'mold';
  var rows = [];

  rows.push(['东莞兴信塑胶制品有限公司']);
  rows.push([]);
  rows.push(['广东省东莞市清溪镇上元银坑路']);
  rows.push([]);
  rows.push(['TEL:0769-87362376', '', '', '', 'FAX:0769-87362377']);
  rows.push(['', '', '', '采购单']);
  rows.push([]);
  rows.push([]);
  rows.push(['供应商：', po.supplier_name, '', '', '', '', '订单编号：', '', po.po_number]);
  rows.push(['联络人：', po.supplier_contact, '', '', '', '', '联络人：', '', po.our_contact]);
  rows.push(['联系电话：', po.supplier_phone, '', '', '', '', '联系电话：', '', po.our_phone || '0769-87362376']);
  rows.push([]);
  rows.push(['产品名称：' + (po.product_name || '')]);
  rows.push([]);

  if (isMold) {
    rows.push(['序号', '零件名称', '材料', 'GATE', 'CAV/UP', '单价', '金额（RMB）', '', '备注']);
    var total = 0;
    items.forEach(function(it, i) {
      total += Number(it.amount) || 0;
      rows.push([i + 1, it.part_name || '', it.material || '', it.gate || '', it.cav_up || '', it.unit_price || '', it.amount || '', '', it.notes || '']);
    });
    rows.push(['', '', '', '', '', '合计：', total]);
  } else {
    rows.push(['序号', '产品名称', '数量', '单价', '金额（RMB）', '备注']);
    var total = 0;
    items.forEach(function(it, i) {
      total += Number(it.amount) || 0;
      rows.push([i + 1, it.product_name || '', it.quantity || '', it.unit_price || '', it.amount || '', it.notes || '']);
    });
    rows.push(['', '', '', '合计：', total]);
  }

  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '采购单');
  XLSX.writeFile(wb, '采购单_' + (po.po_number || 'export') + '.xlsx');
}

loadPO();
</script>
</body>
</html>
```

**Step 2: Test in browser**

1. Create a PO from mold.html
2. Click the print icon in the PO list
3. Verify the print page renders correctly with company header, info grid, items table, terms, signatures
4. Click "打印" — browser print dialog opens
5. Click "导出 Excel" — downloads Excel file
6. Create a figure PO, verify it shows figure columns

**Step 3: Commit**

```bash
git add public/po-print.html
git commit -m "feat: purchase order print preview page with Excel export"
```

---

### Task 5: Polish and Test End-to-End

**Files:**
- Modify: `server.js` (route order fix if needed)
- Modify: `public/mold.html` (minor fixes)
- Modify: `public/figure.html` (minor fixes)

**Step 1: Verify route order in server.js**

Ensure `/api/purchase-orders/next-number` is registered BEFORE `/api/purchase-orders/:id`. If not, move it above.

**Step 2: Test full flow**

1. Login as 管理员/1234
2. Mold page: create mold orders, then create a PO referencing them
3. Print preview: verify format matches BS069 template
4. Export Excel: verify file contents
5. Figure page: same flow with figure PO
6. Edit PO: change items, save, verify print updates
7. Delete PO: confirm deletion works
8. Filter PO list by year and status

**Step 3: Verify security**

- All PO write operations require X-User header (already covered by existing auth middleware)
- All user input escaped with `esc()` in HTML rendering
- Image upload uses existing `saveImage()` function

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete purchase order feature with print and Excel export"
```
