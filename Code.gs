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
  SALES: 'FashionSales'
};

const SCHEMAS = {
  Users: ['id', 'username', 'password', 'role', 'name', 'createdAt'],
  FashionCategories: ['id', 'name', 'createdAt'],
  FashionItems: ['id', 'code', 'categoryId', 'categoryName', 'name', 'color', 'size',
    'wholesalePrice', 'profitPrice', 'totalPrice', 'quantity', 'dateAdded'],
  FashionSales: ['id', 'code', 'itemId', 'itemName', 'categoryName', 'color', 'size', 'customerName',
    'customerPhone', 'quantity', 'wholesalePrice', 'profitPrice', 'unitPrice', 'totalPrice', 'notes', 'employee', 'date']
};

const DEFAULT_CATEGORIES = ['طرح', 'حجاب', 'دبابيس طرح'];

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
  const catSheet = ss.getSheetByName(SHEETS.CATEGORIES);
  if (catSheet.getLastRow() < 2) {
    DEFAULT_CATEGORIES.forEach(function (n) {
      appendObject_(catSheet, SCHEMAS.FashionCategories, { id: Utilities.getUuid(), name: n, createdAt: nowStr_() });
    });
  }
}

/* ============ أدوات عامة ============ */

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('الشيت غير موجود: ' + name + ' — شغّل setupSheets() الأول');
  return sh;
}

function sheetToObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
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

function nowStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
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
