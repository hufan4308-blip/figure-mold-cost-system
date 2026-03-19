const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const XLSX = require('xlsx');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'rr-procurement-secret-change-in-production';
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = process.env.UPLOADS_PATH || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// File upload: only xlsx/xls, max 10MB
const upload = multer({
  dest: path.join(os.tmpdir(), 'po-uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('只允许上传 Excel 文件 (.xlsx, .xls)'));
  }
});

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
    try {
      _cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('[FATAL] data.json parse error:', e.message);
      throw new Error('数据文件损坏，请联系管理员');
    }
  }
  return JSON.parse(JSON.stringify(_cache));
}

function saveData(data) {
  _cache = data;
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('[FATAL] data.json write error:', e.message);
    throw new Error('数据保存失败');
  }
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
app.use(morgan('combined'));
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

// Health check (no auth needed)
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Login rate limiting: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登录尝试过多，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

// JWT helper
function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.substring(7), JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Auth middleware: all /api routes require JWT (except /api/login)
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = payload.name;
  next();
});

// ─── Login ──────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: '请输入用户名和密码' });
  const data = loadData();
  const user = data.eng_users.find(u => u.name === name);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  // Support both bcrypt hash and legacy plain PIN (auto-upgrade on match)
  let pinMatch = false;
  if (user.pin && user.pin.startsWith('$2')) {
    pinMatch = bcrypt.compareSync(String(pin), user.pin);
  } else {
    pinMatch = user.pin === String(pin);
    // Auto-upgrade plain PIN to bcrypt hash
    if (pinMatch) {
      user.pin = bcrypt.hashSync(String(pin), 10);
      saveData(data);
    }
  }
  if (!pinMatch) return res.status(401).json({ error: '用户名或密码错误' });

  const token = jwt.sign({ name: user.name }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, name: user.name, token: token });
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

  const key = group_by === 'customer' ? 'customer' : group_by === 'workshop' ? 'group' : 'mold_factory';
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
  const user = req.user || '';
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

  const key = group_by === 'customer' ? 'customer' : group_by === 'workshop' ? 'group' : 'figure_factory';
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
  const user = req.user || '';
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
  const user = req.user || '';
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

// Status transition — on confirm, auto-create summary order in main list
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

  // When confirming a PO, auto-add a summary record to the main order list
  if (newStatus === '已确认') {
    const user = req.user || '';
    const items = po.items || [];
    const totalAmount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const today = new Date().toISOString().substring(0, 10);

    if (po.type === 'mold') {
      // Mold PO → mold_orders (summary: product_name as mold_name, total amount)
      const order = {
        id: data.nextId++,
        group: po.group || '',
        customer: po.product_name || '',
        mold_name: items.map(it => it.part_name).filter(Boolean).join(', ') || po.product_name || '',
        material: '',
        gate: '',
        cav_up: '',
        unit_price: 0,
        amount: totalAmount,
        image: '',
        mold_factory: po.supplier_name || '',
        order_date: today,
        mold_start_date: '',
        delivery_date: '',
        status: '已下单',
        payment_type: po.payment_type || '',
        notes: '来自采购单 ' + po.po_number,
        created_by: user,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        from_po_id: po.id
      };
      data.mold_orders.push(order);
    } else {
      // Figure PO → figure_orders (summary: total qty, total fee)
      const order = {
        id: data.nextId++,
        group: po.group || '',
        customer: po.product_name || '',
        product_name: items.map(it => it.product_name).filter(Boolean).join(', ') || po.product_name || '',
        quantity: totalQty,
        figure_fee: totalAmount,
        figure_factory: po.supplier_name || '',
        order_date: today,
        status: '已下单',
        payment_type: po.payment_type || '',
        notes: '来自采购单 ' + po.po_number,
        created_by: user,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        from_po_id: po.id
      };
      data.figure_orders.push(order);
    }
  }

  saveData(data);
  res.json(po);
});

// ═══════════════════════════════════════════════════════════════════════
// IMPORT EXCEL PO
// ═══════════════════════════════════════════════════════════════════════

function getCellValue(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  return cell ? String(cell.v).trim() : '';
}

function parseExcelPO(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Detect type by header row — look for "模具名称" (mold) or "手办名称" (figure)
  let headerRow = -1;
  let poType = '';
  for (let r = 10; r <= Math.min(range.e.r, 20); r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 14); c++) {
      const v = getCellValue(ws, r, c);
      if (v.includes('模具名称')) { headerRow = r; poType = 'mold'; break; }
      if (v.includes('手办名称')) { headerRow = r; poType = 'figure'; break; }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) throw new Error('无法识别采购单类型，未找到"模具名称"或"手办名称"表头');

  // Parse header info (rows 8-12 area)
  // R8: 供应商 + 订单编号
  let supplier = '', poNumber = '', customer = '', productName = '';
  for (let r = 6; r <= 12; r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 14); c++) {
      const v = getCellValue(ws, r, c);
      if (v.startsWith('供应商') && (v.includes('：') || v.includes(':'))) {
        let sVal = v.replace(/^供应商[：:]/, '').trim();
        if (!sVal) {
          for (let cc = c + 1; cc <= Math.min(c + 3, range.e.c); cc++) {
            sVal = getCellValue(ws, r, cc);
            if (sVal) break;
          }
        }
        if (!supplier) supplier = sVal;
      }
      if (v.includes('订单编号：') || v.includes('订单编号:')) {
        // PO number could be in same cell, next cell, or a few cells over (merged cells)
        let numVal = v.replace(/.*订单编号[：:]/, '').trim();
        if (!numVal) {
          for (let cc = c + 1; cc <= Math.min(c + 3, range.e.c); cc++) {
            numVal = getCellValue(ws, r, cc);
            if (numVal) break;
          }
        }
        poNumber = numVal;
      }
      if (v.includes('联络人：') && !supplier) {
        // skip
      }
      // Product/customer line: "产品货号：PF001  客户：PROJECTNAME" or "货名：SP003" + next cell "客户： TIG"
      if (v.includes('产品货号') || v.includes('货名')) {
        const pMatch = v.match(/(?:产品货号|货名)[：:]\s*(\S+)/);
        if (pMatch) productName = pMatch[1];
        const cMatch = v.match(/客户[：:]\s*(\S+)/);
        if (cMatch) customer = cMatch[1];
        // Customer might be in another cell on same row
        if (!customer) {
          for (let cc = c + 1; cc <= Math.min(range.e.c, 14); cc++) {
            const cv = getCellValue(ws, r, cc);
            if (cv.includes('客户')) {
              const cm = cv.match(/客户[：:]\s*(\S+)/);
              if (cm) customer = cm[1];
              break;
            }
          }
        }
      }
      // Also check cells that start with "客户" directly
      if (v.match(/^客户[：:]/)) {
        const cm = v.match(/客户[：:]\s*(\S+)/);
        if (cm && !customer) customer = cm[1];
      }
    }
  }

  // Parse supplier contact (row after supplier)
  let supplierContact = '', supplierPhone = '';
  for (let r = 6; r <= 12; r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 14); c++) {
      const v = getCellValue(ws, r, c);
      if (v.startsWith('联络人') && (v.includes('：') || v.includes(':'))) {
        let cVal = v.replace(/^联络人[：:]/, '').trim();
        if (!cVal) {
          for (let cc = c + 1; cc <= Math.min(c + 3, range.e.c); cc++) {
            cVal = getCellValue(ws, r, cc);
            if (cVal) break;
          }
        }
        // Only take the first one (supplier side, left part of sheet)
        if (cVal && !supplierContact) supplierContact = cVal;
      }
      if (v.startsWith('联系电话') && (v.includes('：') || v.includes(':')) && !supplierPhone) {
        let pVal = v.replace(/^联系电话[：:]/, '').trim();
        if (!pVal) {
          for (let cc = c + 1; cc <= Math.min(c + 3, range.e.c); cc++) {
            pVal = getCellValue(ws, r, cc);
            if (pVal) break;
          }
        }
        supplierPhone = pVal;
      }
    }
  }

  // Parse delivery terms (rows after data)
  let deliveryText = '';
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const v = getCellValue(ws, r, range.s.c) || getCellValue(ws, r, range.s.c + 1);
    if (v.match(/^\d+[\.\s].*年.*月.*日.*交货/)) {
      deliveryText = v;
      break;
    }
  }

  // Parse items
  const items = [];
  // Find column mapping from header row
  const colMap = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = getCellValue(ws, headerRow, c);
    if (h.includes('序号')) colMap.seq = c;
    if (h.includes('模具名称') || h.includes('手办名称')) colMap.name = c;
    if (h.includes('入水方式') || h.includes('性质')) colMap.gate = c;
    if (h.includes('产品材料')) colMap.material = c;
    if (h.includes('模具材料')) colMap.mold_material = c;
    if (h.includes('穴数') || h.includes('套数')) colMap.cav_up = c;
    if (h === '数量') colMap.quantity = c;
    if (h === '单位') colMap.unit = c;
    if (h.includes('单价')) colMap.unit_price = c;
    if (h.includes('金额') || h.includes('金 额')) colMap.amount = c;
    if (h.includes('备') && h.includes('注')) colMap.notes = c;
    if (h.includes('图片')) colMap.image = c;
  }

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const seqVal = getCellValue(ws, r, colMap.seq || range.s.c);
    const nameVal = getCellValue(ws, r, colMap.name);
    const amountVal = getCellValue(ws, r, colMap.amount);

    // Stop at total row
    if (amountVal && getCellValue(ws, r, (colMap.amount || 7) - 1).includes('合计')) break;
    if (seqVal.includes('合计') || nameVal.includes('合计')) break;

    // Check if row has any meaningful data (amount, gate/nature, quantity)
    const gateVal = getCellValue(ws, r, colMap.gate);
    const qtyVal = getCellValue(ws, r, colMap.quantity);
    const hasData = seqVal || nameVal || (amountVal && Number(amountVal)) || gateVal || (qtyVal && Number(qtyVal));

    // Skip truly empty rows
    if (!hasData) continue;

    if (poType === 'mold') {
      items.push({
        part_name: nameVal,
        material: getCellValue(ws, r, colMap.material),
        gate: getCellValue(ws, r, colMap.gate),
        cav_up: getCellValue(ws, r, colMap.cav_up),
        unit_price: Number(getCellValue(ws, r, colMap.unit_price)) || 0,
        amount: Number(getCellValue(ws, r, colMap.amount)) || 0,
        notes: getCellValue(ws, r, colMap.notes)
      });
    } else {
      items.push({
        product_name: nameVal,
        nature: getCellValue(ws, r, colMap.gate),
        quantity: Number(getCellValue(ws, r, colMap.quantity)) || 0,
        unit: getCellValue(ws, r, colMap.unit),
        unit_price: Number(getCellValue(ws, r, colMap.unit_price)) || 0,
        amount: Number(getCellValue(ws, r, colMap.amount)) || 0,
        notes: getCellValue(ws, r, colMap.notes)
      });
    }
  }

  return {
    type: poType,
    po_number: poNumber,
    supplier_name: supplier,
    supplier_contact: supplierContact,
    supplier_phone: supplierPhone,
    product_name: productName,
    customer: customer,
    delivery_text: deliveryText,
    items: items
  };
}

// Import Excel → preview parsed data
app.post('/api/import-po/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const result = parseExcelPO(req.file.path);
    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.json(result);
  } catch (e) {
    try { if (req.file) fs.unlinkSync(req.file.path); } catch(ex) {}
    res.status(400).json({ error: e.message });
  }
});

// Helper: match full supplier name (e.g. "东莞市力众模具有限公司") to existing short factory name (e.g. "力众")
function matchFactory(fullName, factoryList) {
  if (!fullName) return '';
  if (factoryList.includes(fullName)) return fullName;
  for (const short of factoryList) {
    if (fullName.includes(short)) return short;
  }
  return fullName;
}

// Import Excel → create PO + auto-confirm → create order
app.post('/api/import-po/confirm', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const parsed = parseExcelPO(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const data = loadData();
    // Auto-match: "东莞市力众模具有限公司" → "力众"
    const factoryList = parsed.type === 'mold' ? (data.mold_factories || []) : (data.figure_factories || []);
    const matchedFactory = matchFactory(parsed.supplier_name, factoryList);
    if (!data.purchase_orders) data.purchase_orders = [];
    if (!data.po_next_id) data.po_next_id = 1;
    const user = req.user || '';
    const group = req.body.group || '';
    const paymentType = req.body.payment_type || '';
    const customerOverride = req.body.customer || '';  // user-selected customer from frontend
    const today = new Date().toISOString().substring(0, 10);

    // Create PO
    const po = {
      id: data.po_next_id++,
      po_number: parsed.po_number || generatePoNumber(parsed.type),
      type: parsed.type,
      group: group,
      supplier_name: parsed.supplier_name,
      supplier_contact: parsed.supplier_contact,
      supplier_phone: parsed.supplier_phone,
      supplier_fax: '',
      our_contact: user,
      our_phone: '0769-87362376',
      product_name: parsed.product_name,
      customer: customerOverride || parsed.customer,
      items: parsed.items,
      delivery_date_text: parsed.delivery_text,
      delivery_address: '东莞清溪上元管理区银坑路兴信厂',
      payment_terms: '',
      payment_type: paymentType,
      tax_rate: 13,
      settlement_days: 30,
      notes: '',
      status: '已确认',
      created_by: user,
      created_at: new Date().toISOString()
    };
    data.purchase_orders.push(po);

    // Auto-create order in main list
    const totalAmount = parsed.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

    if (parsed.type === 'mold') {
      const order = {
        id: data.nextId++,
        group: group,
        customer: customerOverride || parsed.customer || '',
        mold_name: parsed.product_name || '',
        material: '',
        gate: '',
        cav_up: '',
        unit_price: parsed.items.length,
        amount: totalAmount,
        image: '',
        mold_factory: matchedFactory || '',
        order_date: today,
        mold_start_date: '',
        delivery_date: '',
        status: '已下单',
        payment_type: paymentType,
        notes: '导入自采购单 ' + po.po_number,
        created_by: user,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        from_po_id: po.id
      };
      data.mold_orders.push(order);
    } else {
      const totalQty = parsed.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      const order = {
        id: data.nextId++,
        group: group,
        customer: customerOverride || parsed.customer || '',
        product_name: parsed.product_name || '',
        quantity: totalQty,
        figure_fee: totalAmount,
        figure_factory: matchedFactory || '',
        order_date: today,
        status: '已下单',
        payment_type: paymentType,
        notes: '导入自采购单 ' + po.po_number,
        created_by: user,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        from_po_id: po.id
      };
      data.figure_orders.push(order);
    }

    // Add customer if new
    const finalCustomer = customerOverride || parsed.customer;
    if (finalCustomer && !data.customers.includes(finalCustomer)) {
      data.customers.push(finalCustomer);
    }

    saveData(data);
    res.json({ success: true, po: po, parsed: parsed });
  } catch (e) {
    try { if (req.file) fs.unlinkSync(req.file.path); } catch(ex) {}
    res.status(400).json({ error: e.message });
  }
});

// ─── Global Error Handler ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', new Date().toISOString(), err.stack || err.message);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '文件大小不能超过10MB' });
    return res.status(400).json({ error: '文件上传错误: ' + err.message });
  }
  res.status(500).json({ error: '服务器内部错误' });
});

// Uncaught error handlers
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
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
