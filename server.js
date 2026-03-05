const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── JSON Storage (cache + atomic write) ────────────────────────────────
let _cache = null;

function loadData() {
  if (!_cache) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        mold_orders: [], figure_orders: [],
        mold_factories: [], figure_factories: [],
        customers: [], eng_users: [], nextId: 1
      }, null, 2));
    }
    _cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  return JSON.parse(JSON.stringify(_cache));
}

function saveData(data) {
  _cache = data;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ─── Image Helper ───────────────────────────────────────────────────────
function saveImage(imageData) {
  if (!imageData) return '';
  const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) return '';
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return 'uploads/' + filename;
}

// ─── Middleware ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware: write operations need X-User header (except /api/login)
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.path === '/login') return next();
  const user = decodeURIComponent(req.headers['x-user'] || '');
  if (!user) return res.status(401).json({ error: '未登录' });
  next();
});

// ─── Login ──────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { name, pin } = req.body;
  const data = loadData();
  const user = data.eng_users.find(u => u.name === name && u.pin === String(pin));
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  res.json({ success: true, name: user.name });
});

// ─── Base Data ──────────────────────────────────────────────────────────
app.get('/api/factories', (req, res) => {
  const data = loadData();
  res.json({ mold_factories: data.mold_factories || [], figure_factories: data.figure_factories || [] });
});

app.get('/api/customers', (req, res) => {
  const data = loadData();
  res.json(data.customers || []);
});

// ═══════════════════════════════════════════════════════════════════════
// MOLD ORDERS
// ═══════════════════════════════════════════════════════════════════════

// Stats (MUST be before /:id)
app.get('/api/mold-orders/stats', (req, res) => {
  const data = loadData();
  let orders = data.mold_orders || [];
  const { year, month, group, group_by } = req.query;
  if (group) orders = orders.filter(o => o.group === group);
  if (year) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year));
  if (year && month) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year + '-' + month.padStart(2, '0')));

  const key = group_by === 'customer' ? 'customer' : 'mold_factory';
  const grouped = {};
  orders.forEach(o => {
    const k = o[key] || '未知';
    if (!grouped[k]) grouped[k] = { name: k, count: 0, total_fee: 0 };
    grouped[k].count++;
    grouped[k].total_fee += (o.amount || 0);
  });

  const monthly = {};
  orders.forEach(o => {
    if (!o.order_date) return;
    const m = o.order_date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { month: m, count: 0, total_fee: 0 };
    monthly[m].count++;
    monthly[m].total_fee += (o.amount || 0);
  });

  res.json({
    summary: Object.values(grouped).sort((a, b) => b.total_fee - a.total_fee),
    monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    total_count: orders.length,
    total_fee: orders.reduce((s, o) => s + (o.amount || 0), 0)
  });
});

// List
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

// Get single
app.get('/api/mold-orders/:id', (req, res) => {
  const data = loadData();
  const order = data.mold_orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json(order);
});

// Create
app.post('/api/mold-orders', (req, res) => {
  const data = loadData();
  const user = decodeURIComponent(req.headers['x-user'] || '');
  const image = req.body.image_data ? saveImage(req.body.image_data) : '';
  const order = {
    id: data.nextId++,
    group: req.body.group || '',
    customer: req.body.customer || '',
    mold_name: req.body.mold_name || '',
    material: req.body.material || '',
    gate: req.body.gate || '',
    cav_up: req.body.cav_up || '',
    unit_price: Number(req.body.unit_price) || 0,
    amount: Number(req.body.amount) || 0,
    image: image,
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
  if (order.customer && !data.customers.includes(order.customer)) {
    data.customers.push(order.customer);
  }
  saveData(data);
  res.json(order);
});

// Update
app.put('/api/mold-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = data.mold_orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: '订单不存在' });
  const order = data.mold_orders[idx];
  ['group', 'customer', 'mold_name', 'material', 'gate', 'cav_up', 'mold_factory', 'order_date', 'mold_start_date', 'delivery_date', 'payment_type', 'notes'].forEach(f => {
    if (req.body[f] !== undefined) order[f] = req.body[f];
  });
  if (req.body.unit_price !== undefined) order.unit_price = Number(req.body.unit_price) || 0;
  if (req.body.amount !== undefined) order.amount = Number(req.body.amount) || 0;
  if (req.body.image_data) order.image = saveImage(req.body.image_data);
  order.updated_at = new Date().toISOString();
  if (order.customer && !data.customers.includes(order.customer)) {
    data.customers.push(order.customer);
  }
  saveData(data);
  res.json(order);
});

// Delete
app.delete('/api/mold-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = data.mold_orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: '订单不存在' });
  data.mold_orders.splice(idx, 1);
  saveData(data);
  res.json({ success: true });
});

// Status transition
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

// ═══════════════════════════════════════════════════════════════════════
// FIGURE ORDERS
// ═══════════════════════════════════════════════════════════════════════

// Stats (MUST be before /:id)
app.get('/api/figure-orders/stats', (req, res) => {
  const data = loadData();
  let orders = data.figure_orders || [];
  const { year, month, group, group_by } = req.query;
  if (group) orders = orders.filter(o => o.group === group);
  if (year) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year));
  if (year && month) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year + '-' + month.padStart(2, '0')));

  const key = group_by === 'customer' ? 'customer' : 'figure_factory';
  const grouped = {};
  orders.forEach(o => {
    const k = o[key] || '未知';
    if (!grouped[k]) grouped[k] = { name: k, count: 0, qty: 0, total_fee: 0 };
    grouped[k].count++;
    grouped[k].qty += (o.quantity || 0);
    grouped[k].total_fee += (o.figure_fee || 0);
  });

  const monthly = {};
  orders.forEach(o => {
    if (!o.order_date) return;
    const m = o.order_date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { month: m, count: 0, qty: 0, total_fee: 0 };
    monthly[m].count++;
    monthly[m].qty += (o.quantity || 0);
    monthly[m].total_fee += (o.figure_fee || 0);
  });

  res.json({
    summary: Object.values(grouped).sort((a, b) => b.total_fee - a.total_fee),
    monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    total_count: orders.length,
    total_qty: orders.reduce((s, o) => s + (o.quantity || 0), 0),
    total_fee: orders.reduce((s, o) => s + (o.figure_fee || 0), 0)
  });
});

// List
app.get('/api/figure-orders', (req, res) => {
  const data = loadData();
  let orders = data.figure_orders || [];
  const { group, factory, customer, status, year, month } = req.query;
  if (group) orders = orders.filter(o => o.group === group);
  if (factory) orders = orders.filter(o => o.figure_factory === factory);
  if (customer) orders = orders.filter(o => o.customer === customer);
  if (status) orders = orders.filter(o => o.status === status);
  if (year) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year));
  if (year && month) orders = orders.filter(o => o.order_date && o.order_date.startsWith(year + '-' + month.padStart(2, '0')));
  orders.sort((a, b) => b.id - a.id);
  res.json(orders);
});

// Get single
app.get('/api/figure-orders/:id', (req, res) => {
  const data = loadData();
  const order = data.figure_orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json(order);
});

// Create
app.post('/api/figure-orders', (req, res) => {
  const data = loadData();
  const user = decodeURIComponent(req.headers['x-user'] || '');
  const order = {
    id: data.nextId++,
    group: req.body.group || '',
    customer: req.body.customer || '',
    product_name: req.body.product_name || '',
    quantity: Number(req.body.quantity) || 0,
    figure_fee: Number(req.body.figure_fee) || 0,
    figure_factory: req.body.figure_factory || '',
    order_date: req.body.order_date || '',
    status: '已下单',
    payment_type: req.body.payment_type || '',
    notes: req.body.notes || '',
    created_by: user,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  data.figure_orders.push(order);
  if (order.customer && !data.customers.includes(order.customer)) {
    data.customers.push(order.customer);
  }
  saveData(data);
  res.json(order);
});

// Update
app.put('/api/figure-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = data.figure_orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: '订单不存在' });
  const order = data.figure_orders[idx];
  ['group', 'customer', 'product_name', 'figure_factory', 'order_date', 'payment_type', 'notes'].forEach(f => {
    if (req.body[f] !== undefined) order[f] = req.body[f];
  });
  if (req.body.quantity !== undefined) order.quantity = Number(req.body.quantity) || 0;
  if (req.body.figure_fee !== undefined) order.figure_fee = Number(req.body.figure_fee) || 0;
  order.updated_at = new Date().toISOString();
  if (order.customer && !data.customers.includes(order.customer)) {
    data.customers.push(order.customer);
  }
  saveData(data);
  res.json(order);
});

// Delete
app.delete('/api/figure-orders/:id', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const idx = data.figure_orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: '订单不存在' });
  data.figure_orders.splice(idx, 1);
  saveData(data);
  res.json({ success: true });
});

// Status transition
app.put('/api/figure-orders/:id/status', (req, res) => {
  const data = loadData();
  const id = Number(req.params.id);
  const order = data.figure_orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const validTransitions = {
    '已下单': ['制作中'],
    '制作中': ['已完成']
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

// Generate next PO number (MUST be before /:id route)
app.get('/api/purchase-orders/next-number', (req, res) => {
  const type = req.query.type || 'mold';
  res.json({ po_number: generatePoNumber(type) });
});

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

// Get single (AFTER /next-number to avoid route conflict)
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

  ['po_number', 'type', 'group', 'supplier_name', 'supplier_contact', 'supplier_phone',
   'supplier_fax', 'our_contact', 'our_phone', 'product_name', 'delivery_date_text',
   'delivery_address', 'payment_terms', 'payment_type', 'notes'].forEach(f => {
    if (b[f] !== undefined) po[f] = b[f];
  });
  if (b.tax_rate !== undefined) po.tax_rate = Number(b.tax_rate) || 13;
  if (b.settlement_days !== undefined) po.settlement_days = Number(b.settlement_days) || 30;

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

// ─── Start Server ───────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
    }
  }
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://${localIP}:${PORT}`);
});
