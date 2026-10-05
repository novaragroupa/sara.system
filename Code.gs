/**
 * سارة — نظام إدارة محل أزياء المرأة المسلمة
 * الباك اند: Google Apps Script فوق Google Sheets
 *
 * طريقة التركيب (شيت جديد خاص بسارة):
 * 1) افتح Google Sheet جديد فاضي.
 * 2) Extensions > Apps Script، امسح أي كود والصق هذا الملف كامل.
 * 3) نفّذ (Run) الدالة setupSheets() مرة واحدة (هتطلب صلاحيات، وافق عليها).
 *    هتنشئ الشيتات + مستخدم مدير + أنواع جاهزة (طرح، حجاب، دبابيس طرح).
 * 4) Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5) انسخ الرابط وحطه في config.js (APPS_SCRIPT_URL).
 *
 * أول يوزر بعد setupSheets():  admin / admin123  (غيّره فورًا)
 */

// سيبها كده لو عملت السكريبت من جوه الشيت (Extensions > Apps Script).
// لو السكريبت مستقل، حط رقم الشيت (اللي في الرابط بين /d/ و /edit).
const SPREADSHEET_ID = 'PASTE_SPREADSHEET_ID_HERE';

function getSpreadsheet_() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('PASTE_') !== 0) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('محتاج تحط SPREADSHEET_ID في أول الكود، أو تفتح السكريبت من جوه الشيت نفسه');
}

const SHEETS = {
  USERS: 'Users',
  CATEGORIES: 'FashionCategories',
  ITEMS: 'FashionItems',
  SALES: 'FashionSales',
  FDOCS: 'FactoryDocs',
  FLINES: 'FactoryLines',
  FPAY: 'FactoryPayments'
};

const SCHEMAS = {
  Users: ['id', 'username', 'password', 'role', 'name', 'createdAt'],
  FashionCategories: ['id', 'name', 'createdAt'],
  FashionItems: ['id', 'code', 'categoryId', 'categoryName', 'name', 'color', 'size',
    'wholesalePrice', 'profitPrice', 'totalPrice', 'quantity', 'dateAdded'],
  FashionSales: ['id', 'code', 'itemId', 'itemName', 'categoryName', 'color', 'size', 'customerName',
    'customerPhone', 'quantity', 'wholesalePrice', 'profitPrice', 'unitPrice', 'totalPrice', 'notes', 'employee', 'date', 'orderId'],
  // kind: in = وارد مصنع (فاتورة)، out = صادر مصنع (مرتجع للمصنع)
  FactoryDocs: ['id', 'kind', 'docNo', 'factoryName', 'date', 'dueDate', 'reminderDays', 'total', 'paid',
    'remaining', 'notes', 'employee', 'createdAt'],
  FactoryLines: ['id', 'kind', 'docId', 'itemId', 'code', 'itemName', 'categoryName', 'color', 'size',
    'quantity', 'unitCost', 'lineTotal', 'isNew'],
  FactoryPayments: ['id', 'docId', 'docNo', 'factoryName', 'amount', 'date', 'notes', 'employee']
};

const DEFAULT_CATEGORIES = ['فستان', 'عباية', 'شيميز', 'جيبة', 'أطقم نقابة', 'نقاب', 'طرحة', 'مكملات حجاب'];

function setupSheets() {
  const ss = getSpreadsheet_();
  Object.keys(SCHEMAS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    ensureHeaders_(sh, SCHEMAS[name]);
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) ss.deleteSheet(def);

  const usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (usersSheet.getLastRow() < 2) {
    usersSheet.appendRow([Utilities.getUuid(), 'admin', 'admin123', 'مدير النظام', 'المدير العام', new Date()]);
  }
  // بيضيف الأنواع الجاهزة الناقصة بس (مش بيكرر ولا بيمسح حاجة)
  const catSheet = ss.getSheetByName(SHEETS.CATEGORIES);
  const existing = sheetToObjects_(catSheet).map(function (c) { return String(c.name); });
  DEFAULT_CATEGORIES.forEach(function (n) {
    if (existing.indexOf(n) === -1) {
      appendObject_(catSheet, SCHEMAS.FashionCategories, { id: Utilities.getUuid(), name: n, createdAt: nowStr_() });
    }
  });
}

/* ============ أدوات عامة ============ */

function getSheet_(name) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    if (!SCHEMAS[name]) throw new Error('الشيت غير موجود: ' + name);
    sh = ss.insertSheet(name); // شيت جديد (زي شيتات المصنع) بيتعمل تلقائي أول ما يتطلب
    ensureHeaders_(sh, SCHEMAS[name]);
  }
  return sh;
}

function sheetToObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) {
      const v = row[i];
      // التواريخ بترجع كنص ثابت عشان متتزحزحش يوم بسبب فرق التوقيت
      obj[h] = v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss') : v;
    });
    return obj;
  }).filter(function (o) { return o.id !== '' && o.id !== undefined && o.id !== null; });
}

function ensureHeaders_(sh, desired) {
  const lastCol = sh.getLastColumn();
  let current = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const blank = current.length === 0 || (current.length === 1 && current[0] === '');
  if (blank) {
    sh.getRange(1, 1, 1, desired.length).setValues([desired]);
    sh.setFrozenRows(1);
    return desired.slice();
  }
  const missing = desired.filter(function (h) { return current.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    current = current.concat(missing);
  }
  return current;
}

function appendObject_(sh, headers, obj) {
  const live = ensureHeaders_(sh, headers);
  sh.appendRow(live.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; }));
}

function findRowIndexById_(sh, id) {
  const values = sh.getDataRange().getValues();
  const idCol = values[0].indexOf('id');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) return r + 1;
  }
  return -1;
}

function updateCellByHeader_(sh, rowNum, headers, header, value) {
  const live = ensureHeaders_(sh, headers);
  const col = live.indexOf(header) + 1;
  if (col > 0) sh.getRange(rowNum, col).setValue(value);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function tz_() { return Session.getScriptTimeZone() || 'Africa/Cairo'; }

function nowStr_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

/* ============ نقطة الدخول ============ */

function doGet() {
  return jsonOut_({ ok: true, message: 'Sara API شغال' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    let result;
    switch (body.action) {
      case 'login': result = login_(body); break;
      case 'addUser': result = addUser_(body); break;
      case 'listUsers': result = { items: sheetToObjects_(getSheet_(SHEETS.USERS)).map(stripPassword_) }; break;

      case 'addFashionCategory': result = addCategory_(body); break;
      case 'listFashionCategories': result = { items: sheetToObjects_(getSheet_(SHEETS.CATEGORIES)) }; break;

      case 'addFashionItem': result = addItem_(body); break;
      case 'updateFashionItem': result = updateItem_(body); break;
      case 'listFashionItems': result = { items: sheetToObjects_(getSheet_(SHEETS.ITEMS)) }; break;
      case 'sellFashionItem': result = sellItem_(body); break;
      case 'listFashionSales': result = { items: sheetToObjects_(getSheet_(SHEETS.SALES)) }; break;

      case 'sellCart': result = sellCart_(body); break;
      case 'deleteFashionCategory': result = deleteCategory_(body); break;

      case 'listFactoryDocs': result = { items: sheetToObjects_(getSheet_(SHEETS.FDOCS)) }; break;
      case 'listFactoryLines': result = { items: sheetToObjects_(getSheet_(SHEETS.FLINES)) }; break;
      case 'listFactoryPayments': result = { items: sheetToObjects_(getSheet_(SHEETS.FPAY)) }; break;
      case 'addFactoryInvoice': result = addFactoryInvoice_(body); break;
      case 'addFactoryReturn': result = addFactoryReturn_(body); break;
      case 'addFactoryPayment': result = addFactoryPayment_(body); break;

      case 'findProductByCode': result = findProductByCode_(body); break;
      case 'sellByCode': result = sellByCode_(body); break;

      case 'accountingSummary': result = accountingSummary_(); break;
      default: result = { error: 'إجراء غير معروف: ' + body.action };
    }
    if (result && result.error) return jsonOut_({ ok: false, error: result.error });
    return jsonOut_(Object.assign({ ok: true }, result));
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function stripPassword_(u) {
  const copy = Object.assign({}, u);
  delete copy.password;
  return copy;
}

/* ============ المستخدمين ============ */

function login_(body) {
  const found = sheetToObjects_(getSheet_(SHEETS.USERS)).find(function (u) {
    return String(u.username) === String(body.username) && String(u.password) === String(body.password);
  });
  if (!found) return { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  return { user: stripPassword_(found) };
}

function addUser_(body) {
  const sh = getSheet_(SHEETS.USERS);
  if (sheetToObjects_(sh).some(function (u) { return u.username === body.username; })) {
    return { error: 'اسم المستخدم موجود بالفعل' };
  }
  const obj = {
    id: Utilities.getUuid(), username: body.username, password: body.password,
    role: body.role, name: body.name, createdAt: nowStr_()
  };
  appendObject_(sh, SCHEMAS.Users, obj);
  return { user: stripPassword_(obj) };
}

/* ============ الأزياء: الأنواع ============ */

function addCategory_(body) {
  const name = String(body.name || '').trim();
  if (!name) return { error: 'اكتب اسم النوع' };
  const sh = getSheet_(SHEETS.CATEGORIES);
  if (sheetToObjects_(sh).some(function (c) { return String(c.name) === name; })) {
    return { error: 'النوع ده موجود بالفعل' };
  }
  const obj = { id: Utilities.getUuid(), name: name, createdAt: nowStr_() };
  appendObject_(sh, SCHEMAS.FashionCategories, obj);
  return { item: obj };
}

/* ============ الأزياء: الأصناف ============ */

function genCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function codeExists_(code) {
  return sheetToObjects_(getSheet_(SHEETS.ITEMS)).some(function (i) { return String(i.code) === String(code); });
}

function addItem_(body) {
  const sh = getSheet_(SHEETS.ITEMS);
  const wholesale = Number(body.wholesalePrice) || 0;
  const profit = Number(body.profitPrice) || 0;
  let code = (body.code || '').toString().trim();
  if (!code) { do { code = genCode_(); } while (codeExists_(code)); }
  else if (codeExists_(code)) { return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' }; }
  const obj = {
    id: Utilities.getUuid(), code: code,
    categoryId: body.categoryId, categoryName: body.categoryName,
    name: body.name, color: body.color || '', size: body.size || '',
    wholesalePrice: wholesale, profitPrice: profit, totalPrice: wholesale + profit,
    quantity: Number(body.quantity) || 0, dateAdded: nowStr_()
  };
  appendObject_(sh, SCHEMAS.FashionItems, obj);
  return { item: obj };
}

function updateItem_(body) {
  const sh = getSheet_(SHEETS.ITEMS);
  const rowNum = findRowIndexById_(sh, body.id);
  if (rowNum === -1) return { error: 'الصنف غير موجود' };
  const item = sheetToObjects_(sh).find(function (i) { return String(i.id) === String(body.id); });

  const newCode = (body.code || '').toString().trim();
  if (newCode && newCode !== String(item.code)) {
    if (codeExists_(newCode)) return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' };
    updateCellByHeader_(sh, rowNum, SCHEMAS.FashionItems, 'code', newCode);
  }
  const name = body.name ? body.name : item.name;
  const color = body.color !== undefined ? body.color : item.color;
  const size = body.size !== undefined ? body.size : item.size;
  const wholesale = body.wholesalePrice !== undefined ? Number(body.wholesalePrice) : Number(item.wholesalePrice);
  const profit = body.profitPrice !== undefined ? Number(body.profitPrice) : Number(item.profitPrice);
  const quantity = body.quantity !== undefined ? Number(body.quantity) : Number(item.quantity);

  const H = SCHEMAS.FashionItems;
  updateCellByHeader_(sh, rowNum, H, 'name', name);
  updateCellByHeader_(sh, rowNum, H, 'color', color);
  updateCellByHeader_(sh, rowNum, H, 'size', size);
  updateCellByHeader_(sh, rowNum, H, 'wholesalePrice', wholesale);
  updateCellByHeader_(sh, rowNum, H, 'profitPrice', profit);
  updateCellByHeader_(sh, rowNum, H, 'totalPrice', wholesale + profit);
  updateCellByHeader_(sh, rowNum, H, 'quantity', quantity);
  return { item: Object.assign({}, item, { name: name, color: color, size: size, wholesalePrice: wholesale,
    profitPrice: profit, totalPrice: wholesale + profit, quantity: quantity, code: newCode || item.code }) };
}

function sellItem_(body) {
  const sh = getSheet_(SHEETS.ITEMS);
  const rowNum = findRowIndexById_(sh, body.itemId);
  if (rowNum === -1) return { error: 'الصنف غير موجود' };
  const item = sheetToObjects_(sh).find(function (i) { return String(i.id) === String(body.itemId); });
  const qty = Number(item.quantity) || 0;
  const sellQty = Math.max(1, Number(body.quantity) || 1);
  if (sellQty > qty) return { error: 'الكمية المطلوبة (' + sellQty + ') أكبر من المتاح بالمخزون (' + qty + ')' };

  updateCellByHeader_(sh, rowNum, SCHEMAS.FashionItems, 'quantity', qty - sellQty);

  const sale = {
    id: Utilities.getUuid(), code: item.code || '', itemId: item.id, itemName: item.name,
    categoryName: item.categoryName, color: item.color || '', size: item.size || '',
    customerName: body.customerName || '', customerPhone: body.customerPhone || '',
    quantity: sellQty,
    wholesalePrice: Number(item.wholesalePrice) * sellQty,
    profitPrice: Number(item.profitPrice) * sellQty,
    unitPrice: item.totalPrice, totalPrice: Number(item.totalPrice) * sellQty,
    notes: body.notes || '', employee: body.employee || '', date: nowStr_()
  };
  appendObject_(getSheet_(SHEETS.SALES), SCHEMAS.FashionSales, sale);
  invalidateAccountingCache_();
  return { sale: sale, remainingQuantity: qty - sellQty };
}

/* ============ البحث بالكود / البيع بالباركود ============ */

function findProductByCode_(body) {
  const code = String(body.code || '').trim();
  if (!code) return { error: 'محتاج تدخل كود أو تمسح باركود المنتج' };
  const match = sheetToObjects_(getSheet_(SHEETS.ITEMS)).find(function (i) { return String(i.code) === code; });
  return match ? { found: true, item: match } : { found: false };
}

function sellByCode_(body) {
  const lookup = findProductByCode_({ code: body.code });
  if (lookup.error) return lookup;
  if (!lookup.found) return { error: 'مفيش منتج بالكود ده في النظام' };
  return sellItem_({
    itemId: lookup.item.id, customerName: body.customerName, customerPhone: body.customerPhone,
    employee: body.employee, quantity: body.quantity, notes: body.notes
  });
}

/* ============ الحسابات ============ */

function accountingSummary_() {
  const cache = CacheService.getScriptCache();
  const key = 'accountingSummary_sara_v1';
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const records = sheetToObjects_(getSheet_(SHEETS.SALES)).map(function (s) {
    return { date: String(s.date).substring(0, 10), wholesale: Number(s.wholesalePrice) || 0,
      profit: Number(s.profitPrice) || 0, total: Number(s.totalPrice) || 0, category: s.categoryName || 'أخرى' };
  });
  const result = { records: records };
  try { cache.put(key, JSON.stringify(result), 30); } catch (e) { /* كبير على الكاش، عادي */ }
  return result;
}

function invalidateAccountingCache_() {
  try { CacheService.getScriptCache().remove('accountingSummary_sara_v1'); } catch (e) { /* تجاهل */ }
}

/* ============ حذف نوع (لو فاضي) ============ */

function deleteCategory_(body) {
  if (sheetToObjects_(getSheet_(SHEETS.ITEMS)).some(function (i) { return String(i.categoryId) === String(body.id); })) {
    return { error: 'مينفعش تحذفي نوع فيه أصناف' };
  }
  const sh = getSheet_(SHEETS.CATEGORIES);
  const rowNum = findRowIndexById_(sh, body.id);
  if (rowNum === -1) return { error: 'النوع غير موجود' };
  sh.deleteRow(rowNum);
  return {};
}

/* ============ بيع أكتر من صنف في عملية واحدة (السلة) ============ */

function appendRows_(sh, headers, objs) {
  if (!objs.length) return;
  const live = ensureHeaders_(sh, headers);
  const rows = objs.map(function (o) { return live.map(function (h) { return o[h] !== undefined ? o[h] : ''; }); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, live.length).setValues(rows);
}

function sellCart_(body) {
  const lines = body.items || [];
  if (!lines.length) return { error: 'السلة فاضية' };
  const sh = getSheet_(SHEETS.ITEMS);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id'), qtyCol = headers.indexOf('quantity');
  const rowById = {};
  for (let r = 1; r < values.length; r++) rowById[String(values[r][idCol])] = r;

  const agg = {};
  lines.forEach(function (l) { agg[l.itemId] = (agg[l.itemId] || 0) + Math.max(1, Number(l.quantity) || 1); });

  const ids = Object.keys(agg);
  const items = {};
  for (let k = 0; k < ids.length; k++) {
    const r = rowById[ids[k]];
    if (r === undefined) return { error: 'صنف في السلة مش موجود' };
    const it = {};
    headers.forEach(function (h, i) { it[h] = values[r][i]; });
    if (agg[ids[k]] > (Number(it.quantity) || 0)) {
      return { error: '"' + it.name + '": الكمية المطلوبة (' + agg[ids[k]] + ') أكبر من المتاح (' + (Number(it.quantity) || 0) + ')' };
    }
    items[ids[k]] = it;
  }

  const orderId = Utilities.getUuid(), date = nowStr_(), sales = [];
  let total = 0;
  ids.forEach(function (id) {
    const it = items[id], q = agg[id];
    sh.getRange(rowById[id] + 1, qtyCol + 1).setValue((Number(it.quantity) || 0) - q);
    const sale = {
      id: Utilities.getUuid(), code: it.code || '', itemId: it.id, itemName: it.name,
      categoryName: it.categoryName, color: it.color || '', size: it.size || '',
      customerName: body.customerName || '', customerPhone: body.customerPhone || '', quantity: q,
      wholesalePrice: Number(it.wholesalePrice) * q, profitPrice: Number(it.profitPrice) * q,
      unitPrice: it.totalPrice, totalPrice: Number(it.totalPrice) * q,
      notes: body.notes || '', employee: body.employee || '', date: date, orderId: orderId
    };
    total += sale.totalPrice;
    sales.push(sale);
  });
  appendRows_(getSheet_(SHEETS.SALES), SCHEMAS.FashionSales, sales);
  invalidateAccountingCache_();
  return { sales: sales, total: total, orderId: orderId };
}

/* ============ وارد / صادر مصنع ============ */

function r2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function textDateCols_(sh) {
  // تواريخ الفواتير بتتحفظ كنص عشان الشيت ميحولهاش
  const live = ensureHeaders_(sh, SCHEMAS.FactoryDocs);
  ['date', 'dueDate'].forEach(function (h) {
    const c = live.indexOf(h) + 1;
    if (c > 0) sh.getRange(1, c, Math.max(sh.getMaxRows(), 2), 1).setNumberFormat('@');
  });
}

function nextDocNo_(docs, kind) {
  const n = docs.filter(function (d) { return d.kind === kind; }).length + 1;
  return (kind === 'in' ? 'IN-' : 'OUT-') + ('0000' + n).slice(-4);
}

function dateOnly_(v) {
  const s = String(v || '').substring(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function itemRowsMap_(sh) {
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');
  const map = {};
  for (let r = 1; r < values.length; r++) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = values[r][i]; });
    map[String(values[r][idCol])] = { row: r + 1, item: o };
  }
  return { map: map, qtyCol: headers.indexOf('quantity') + 1 };
}

// فاتورة وارد: الأصناف القديمة بتزيد كميتها، والجديدة بتتعمل كصنف جديد. بنتأكد من كل حاجة قبل أي كتابة.
function addFactoryInvoice_(body) {
  const factory = String(body.factoryName || '').trim();
  if (!factory) return { error: 'اكتب اسم المصنع' };
  const lines = body.items || [];
  if (!lines.length) return { error: 'ضيفي صنف واحد على الأقل في الفاتورة' };

  const itemsSh = getSheet_(SHEETS.ITEMS);
  const H = ensureHeaders_(itemsSh, SCHEMAS.FashionItems);
  const info = itemRowsMap_(itemsSh);
  const usedCodes = {};
  Object.keys(info.map).forEach(function (id) { usedCodes[String(info.map[id].item.code)] = 1; });

  const addQty = {}, newItems = [], lineObjs = [], docId = Utilities.getUuid();
  let computed = 0;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const qty = Number(l.quantity) || 0, cost = Number(l.unitCost) || 0;
    if (qty <= 0) return { error: 'الكمية لازم تكون أكبر من صفر' };
    const base = { id: Utilities.getUuid(), kind: 'in', docId: docId, quantity: qty, unitCost: cost, lineTotal: r2_(qty * cost) };
    if (l.itemId) {
      const ref = info.map[String(l.itemId)];
      if (!ref) return { error: 'فيه صنف قديم مش موجود في المخزون' };
      addQty[l.itemId] = (addQty[l.itemId] || 0) + qty;
      lineObjs.push(Object.assign(base, { itemId: ref.item.id, code: ref.item.code, itemName: ref.item.name,
        categoryName: ref.item.categoryName, color: ref.item.color || '', size: ref.item.size || '', isNew: 'لا' }));
    } else {
      const n = l.newItem || {};
      if (!String(n.name || '').trim()) return { error: 'اكتب اسم الصنف الجديد' };
      if (!n.categoryId) return { error: 'اختاري نوع الصنف الجديد' };
      let code = String(n.code || '').trim();
      if (!code) { do { code = genCode_(); } while (usedCodes[code]); }
      else if (usedCodes[code]) return { error: 'الكود ' + code + ' مستخدم بالفعل' };
      usedCodes[code] = 1;
      const profit = Number(n.profitPrice) || 0;
      const item = { id: Utilities.getUuid(), code: code, categoryId: n.categoryId, categoryName: n.categoryName,
        name: String(n.name).trim(), color: n.color || '', size: n.size || '', wholesalePrice: cost, profitPrice: profit,
        totalPrice: cost + profit, quantity: qty, dateAdded: nowStr_() };
      newItems.push(item);
      lineObjs.push(Object.assign(base, { itemId: item.id, code: code, itemName: item.name,
        categoryName: item.categoryName, color: item.color, size: item.size, isNew: 'نعم' }));
    }
    computed += qty * cost;
  }
  const total = (body.total !== undefined && body.total !== '' && Number(body.total) >= 0) ? r2_(body.total) : r2_(computed);
  const paid = r2_(body.paid);
  if (paid < 0 || paid > total) return { error: 'المدفوع لازم يكون بين صفر وإجمالي الفاتورة' };

  // ---- كتابة ----
  Object.keys(addQty).forEach(function (id) {
    const ref = info.map[id];
    itemsSh.getRange(ref.row, info.qtyCol).setValue((Number(ref.item.quantity) || 0) + addQty[id]);
  });
  appendRows_(itemsSh, SCHEMAS.FashionItems, newItems);

  const docsSh = getSheet_(SHEETS.FDOCS);
  textDateCols_(docsSh);
  const docs = sheetToObjects_(docsSh);
  const date = dateOnly_(body.date);
  const doc = { id: docId, kind: 'in', docNo: String(body.docNo || '').trim() || nextDocNo_(docs, 'in'), factoryName: factory,
    date: date, dueDate: body.dueDate ? dateOnly_(body.dueDate) : '',
    reminderDays: body.reminderDays === '' || body.reminderDays === undefined ? 3 : Number(body.reminderDays) || 0,
    total: total, paid: paid, remaining: r2_(total - paid), notes: body.notes || '', employee: body.employee || '', createdAt: nowStr_() };
  appendRows_(docsSh, SCHEMAS.FactoryDocs, [doc]);
  appendRows_(getSheet_(SHEETS.FLINES), SCHEMAS.FactoryLines, lineObjs);
  if (paid > 0) {
    appendRows_(getSheet_(SHEETS.FPAY), SCHEMAS.FactoryPayments, [{ id: Utilities.getUuid(), docId: docId, docNo: doc.docNo,
      factoryName: factory, amount: paid, date: date, notes: 'دفعة عند الاستلام', employee: body.employee || '' }]);
  }
  return { doc: doc, newItemsCount: newItems.length, updatedItemsCount: Object.keys(addQty).length };
}

// صادر مصنع: مرتجع بيطلع من المخزون للمصنع، وقيمته بتتخصم من المستحق للمصنع
function addFactoryReturn_(body) {
  const factory = String(body.factoryName || '').trim();
  if (!factory) return { error: 'اكتب اسم المصنع' };
  const lines = body.items || [];
  if (!lines.length) return { error: 'ضيفي صنف واحد على الأقل' };

  const itemsSh = getSheet_(SHEETS.ITEMS);
  const info = itemRowsMap_(itemsSh);
  const agg = {};
  lines.forEach(function (l) { agg[l.itemId] = (agg[l.itemId] || 0) + (Number(l.quantity) || 0); });
  const ids = Object.keys(agg);
  for (let k = 0; k < ids.length; k++) {
    const ref = info.map[ids[k]];
    if (!ref) return { error: 'فيه صنف مش موجود في المخزون' };
    if (agg[ids[k]] <= 0) return { error: 'الكمية لازم تكون أكبر من صفر' };
    if (agg[ids[k]] > (Number(ref.item.quantity) || 0)) {
      return { error: '"' + ref.item.name + '": الكمية (' + agg[ids[k]] + ') أكبر من المتاح (' + (Number(ref.item.quantity) || 0) + ')' };
    }
  }
  const docId = Utilities.getUuid();
  let total = 0;
  const lineObjs = lines.map(function (l) {
    const it = info.map[l.itemId].item, qty = Number(l.quantity) || 0, cost = Number(l.unitCost) || 0;
    total += qty * cost;
    return { id: Utilities.getUuid(), kind: 'out', docId: docId, itemId: it.id, code: it.code, itemName: it.name,
      categoryName: it.categoryName, color: it.color || '', size: it.size || '', quantity: qty, unitCost: cost,
      lineTotal: r2_(qty * cost), isNew: 'لا' };
  });
  ids.forEach(function (id) {
    const ref = info.map[id];
    itemsSh.getRange(ref.row, info.qtyCol).setValue((Number(ref.item.quantity) || 0) - agg[id]);
  });
  const docsSh = getSheet_(SHEETS.FDOCS);
  textDateCols_(docsSh);
  const docs = sheetToObjects_(docsSh);
  const doc = { id: docId, kind: 'out', docNo: String(body.docNo || '').trim() || nextDocNo_(docs, 'out'), factoryName: factory,
    date: dateOnly_(body.date), dueDate: '', reminderDays: '', total: r2_(total), paid: 0, remaining: 0,
    notes: body.notes || '', employee: body.employee || '', createdAt: nowStr_() };
  appendRows_(docsSh, SCHEMAS.FactoryDocs, [doc]);
  appendRows_(getSheet_(SHEETS.FLINES), SCHEMAS.FactoryLines, lineObjs);
  return { doc: doc };
}

// دفعة على فاتورة: بتنقص المتبقي. مثال: عليكي 40 ودفعتي 5 يبقى المتبقي 35
function addFactoryPayment_(body) {
  const sh = getSheet_(SHEETS.FDOCS);
  const rowNum = findRowIndexById_(sh, body.docId);
  if (rowNum === -1) return { error: 'الفاتورة غير موجودة' };
  const doc = sheetToObjects_(sh).find(function (d) { return String(d.id) === String(body.docId); });
  if (doc.kind !== 'in') return { error: 'الدفع بيتسجل على فواتير الوارد بس' };
  const amount = r2_(body.amount);
  if (amount <= 0) return { error: 'اكتبي مبلغ أكبر من صفر' };
  const remaining = r2_(doc.remaining);
  if (amount > remaining) return { error: 'المبلغ أكبر من المتبقي على الفاتورة (' + remaining + ')' };

  const paid = r2_(Number(doc.paid) + amount), left = r2_(Number(doc.total) - paid);
  updateCellByHeader_(sh, rowNum, SCHEMAS.FactoryDocs, 'paid', paid);
  updateCellByHeader_(sh, rowNum, SCHEMAS.FactoryDocs, 'remaining', left);
  const payment = { id: Utilities.getUuid(), docId: doc.id, docNo: doc.docNo, factoryName: doc.factoryName, amount: amount,
    date: dateOnly_(body.date), notes: body.notes || '', employee: body.employee || '' };
  const pSh = getSheet_(SHEETS.FPAY);
  const live = ensureHeaders_(pSh, SCHEMAS.FactoryPayments);
  const dc = live.indexOf('date') + 1;
  if (dc > 0) pSh.getRange(1, dc, Math.max(pSh.getMaxRows(), 2), 1).setNumberFormat('@');
  appendRows_(pSh, SCHEMAS.FactoryPayments, [payment]);
  return { payment: payment, paid: paid, remaining: left };
}
