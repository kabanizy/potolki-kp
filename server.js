const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const db = new DatabaseSync(DB_PATH, { open: true });

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.get('/healthz', (_req, res) => res.status(200).type('text/plain').send('ok'));

function ensureDbOpen() {
  if (!db.isOpen) {
    db.open();
  }
  return db;
}

const LEGACY_LIGHTING_SECTIONS = new Set(['Монтаж освещения', 'Монтаж треков']);
const PRICE_GROUPS = new Set(['canvas', 'services', 'products']);
const AUTO_INSTALL_NAME = 'Установка полотна';

// ===================== ОБЩИЙ ВХОД ДЛЯ МЕНЕДЖЕРОВ =====================
// Один общий логин/пароль на всех менеджеров (не персональные аккаунты).
// Задаются через переменные окружения APP_USER / APP_PASS на сервере —
// значения ниже используются только если эти переменные не заданы.
// Страницы коммерческих предложений (/kp/:id) НЕ защищены — по ним должен
// открываться доступ без авторизации, чтобы клиент мог просто перейти по ссылке.
const APP_USER = process.env.APP_USER || 'manager';
const APP_PASS = process.env.APP_PASS || 'potolki2026';
const SESSION_COOKIE = 'sid';
// Действующие сессии храним в памяти процесса — этого достаточно для одного
// общего аккаунта на небольшую команду. При перезапуске сервера менеджерам
// нужно будет войти заново.
const sessions = new Set();

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}
function isLoggedIn(req) {
  const cookies = parseCookies(req);
  return !!(cookies[SESSION_COOKIE] && sessions.has(cookies[SESSION_COOKIE]));
}
function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${60 * 60 * 24 * 30}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}
function safeNextPath(v) {
  const s = String(v || '');
  return (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/login')) ? s : '/';
}
function loginPageHtml({ error, next } = {}) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход — Потолочная №1</title><style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#f3f6f9 0%,#edf1f5 100%);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1b2430}
.box{width:min(380px,calc(100vw - 32px));background:#fff;border:1px solid #dfe4ea;border-radius:18px;box-shadow:0 20px 48px rgba(25,59,104,.14);padding:30px 28px}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.brand-logo{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#cf1734,#a90f27);color:#fff;display:grid;place-items:center;font-weight:900;font-size:17px}
.brand div span{display:block;color:#244b7d;font-size:11px;letter-spacing:.09em;text-transform:uppercase}
.brand div strong{font-size:17px;color:#cf1734}
h1{font-size:19px;margin:0 0 18px;color:#193b68}
label{display:block;font-size:12.5px;font-weight:700;color:#4f5b67;margin-bottom:6px}
input{width:100%;padding:11px 13px;border:1px solid #ccd4dd;border-radius:8px;font-size:15px;margin-bottom:16px;outline:0}
input:focus{border-color:#244b7d;box-shadow:0 0 0 4px rgba(36,75,125,.16)}
button{width:100%;padding:12px;border:0;border-radius:8px;background:#244b7d;color:#fff;font-weight:800;font-size:15px;cursor:pointer}
button:hover{filter:brightness(1.06)}
.err{background:#fdf1f3;color:#a90f27;border:1px solid #f0c3cc;border-radius:8px;padding:10px 12px;font-size:13.5px;margin-bottom:16px}
</style></head><body><form class="box" method="post" action="/login">
<div class="brand"><div class="brand-logo">№1</div><div><span>Натяжные потолки</span><strong>Потолочная №1</strong></div></div>
<h1>Вход для менеджеров</h1>
${error ? `<div class="err">Неверный логин или пароль. Попробуйте ещё раз.</div>` : ''}
<input type="hidden" name="next" value="${(next || '/').replace(/"/g, '&quot;')}">
<label for="login">Логин</label>
<input id="login" name="login" autocomplete="username" autofocus>
<label for="password">Пароль</label>
<input id="password" name="password" type="password" autocomplete="current-password">
<button type="submit">Войти</button>
</form></body></html>`;
}
app.get('/login', (req, res) => {
  if (isLoggedIn(req)) return res.redirect(safeNextPath(req.query.next));
  res.send(loginPageHtml({ error: req.query.error === '1', next: req.query.next }));
});
app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const login = String(req.body?.login || '');
  const password = String(req.body?.password || '');
  const next = safeNextPath(req.body?.next);
  if (login === APP_USER && password === APP_PASS) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    setSessionCookie(req, res, token);
    return res.redirect(next);
  }
  res.redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
});
app.get('/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) sessions.delete(cookies[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.redirect('/login');
});
function requireSharedLogin(req, res, next) {
  if (req.path === '/kp' || req.path.startsWith('/kp/')) return next();
  if (req.path === '/login' || req.path === '/logout') return next();
  if (isLoggedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Требуется авторизация' });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function publicKpUrl(req, id) {
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/kp/${id}`;
}

const seed = [
  {name:'Полотно', calc_group:'ceiling', groups:true, items:[
    ['MSD Ideal','пог.м',610,'MSD Ideal',0,320],['MSD Ideal','пог.м',790,'MSD Ideal',1,500],['MSD Ideal','пог.м',1050,'MSD Ideal',2,580],
    ['HALEAD Standart','пог.м',610,'HALEAD Standart',0,320],['HALEAD Standart','пог.м',790,'HALEAD Standart',1,500],
    ['DEKEN','пог.м',680,'DEKEN',0,320],['DEKEN','пог.м',880,'DEKEN',1,500],['DEKEN','пог.м',950,'DEKEN',2,550],['DEKEN','пог.м',1120,'DEKEN',3,580],['DEKEN','пог.м',1240,'DEKEN',4,600],
    ['BAUF 205','пог.м',860,'BAUF 205',0,320],['BAUF 205','пог.м',1040,'BAUF 205',1,500],['BAUF 205','пог.м',1210,'BAUF 205',2,550],
    ['MSD Evolution','пог.м',800,'MSD Evolution',0,320],['MSD Evolution','пог.м',940,'MSD Evolution',1,500],['MSD Evolution','пог.м',1230,'MSD Evolution',2,580],
    ['BAUF 270','пог.м',1220,'BAUF 270',0,320],['BAUF 270','пог.м',1510,'BAUF 270',1,450],
    ['КМТ','пог.м',1440,'КМТ',0,335],
    ['TEQUTUM Euro','пог.м',1500,'TEQUTUM Euro',0,320],['TEQUTUM Euro','пог.м',1700,'TEQUTUM Euro',1,450],
    ['Blackout','пог.м',1470,'Blackout',0,320],
    ['Bauf FireProof (KM3)','пог.м',1080,'Bauf FireProof (KM3)',0,320],['Bauf FireProof (KM3)','пог.м',1260,'Bauf FireProof (KM3)',1,450],
    ['TEQUTUM KM2','пог.м',2070,'TEQUTUM KM2',0,320],['TEQUTUM KM2','пог.м',2370,'TEQUTUM KM2',1,500],
    ['TEQUTUM KM1','пог.м',2240,'TEQUTUM KM1',0,320],['TEQUTUM KM1','пог.м',2700,'TEQUTUM KM1',1,500]
  ]},
  {name:'Багет стандарт', calc_group:'ceiling', items:[['Багет ПВХ Эконом','пог.м',130],['Багет ПВХ ПРЕМ','пог.м',160],['Багет ПВХ ПРЕМ Черный','пог.м',165],['Багет AL','пог.м',300]]},
  {name:'Вставка', calc_group:'ceiling', items:[['Вставка TL белая','пог.м',120],['Вставка TL черная','пог.м',150],['Вставка готика','пог.м',140],['Вставка уголок','пог.м',150],['Вставка TL в цвет полотна','пог.м',200],['Вставка F белая','пог.м',150],['Вставка TL крашенная в цвет полотна','пог.м',350]]},
  {name:'Обработка угла', calc_group:'ceiling', items:[['Обработка угла','шт',150],['Обработка угла (теневой, парящий, контурный)','шт',500]]},
  {name:'Монтаж освещения', calc_group:'lighting', items:[['Монтаж закладной ПВХ под люстру','шт',450],['Монтаж закладной Фанера под люстру','шт',600],['Монтаж люстры (сборка люстры в стоимость не включена)','шт',400],['Монтаж светильников (закладная, термокольцо)','шт',350],['Монтаж светильников (провод ШВВП ТУ 2х0.75, закладная, термокольцо)','шт',670],['Монтаж светильников (провод ШВВП ГОСТ 2х0.75, закладная, термокольцо)','шт',750],['Монтаж светильников (кабель ВВГ 2х1.5, закладная, термокольцо)','шт',950]]},
  {name:'Монтаж треков', calc_group:'lighting', items:[['Монтаж накладной трека','пог.м',2000],['Монтаж встраиваемой трек системы','пог.м',3000],['Запилка угла трека','шт',1500]]},
  {name:'Монтаж по кафель/керамогранит', calc_group:'ceiling', items:[['Монтаж по кафелю','пог.м',200],['Монтаж по керамограниту (сверление)','пог.м',1000],['Монтаж по керамограниту (клей)','пог.м',700]]},
  {name:'LED LUMISTAR', calc_group:'products', groups:true, grouped:true, items:[
    ['LED Cob 24v LUX 2835 480 led/m 3000К','боб(5 метров)',2350,'LED',0],
    ['LED Cob 24v LUX 2835 480 led/m 4000К','боб(5 метров)',2350,'LED',0],
    ['LED LM 9.6w/m 90 led/m 930lm 3000К','боб(5 метров)',1980,'LED',0],
    ['LED LM 9.6w/m 90 led/m 930lm 4000К','боб(5 метров)',1980,'LED',0],
    ['LED LM 17w/m 168led/m 2350 lm 3000К','боб(5 метров)',3315,'LED',0],
    ['LED LM 17w/m 168led/m 2350 lm 4000К','боб(5 метров)',3315,'LED',0],
    ['Блок питания LUMISTAR SE-36-24','шт',900,'Блоки питания',1],
    ['Блок питания LUMISTAR SE-60 - 24','шт',1100,'Блоки питания',1],
    ['Блок питания LUMISTAR SE-100 - 24В','шт',1580,'Блоки питания',1],
    ['Блок питания LUMISTAR SE-150 - 24В','шт',2300,'Блоки питания',1],
    ['Блок питания LUMISTAR SE-200 - 24 В','шт',2450,'Блоки питания',1],
    ['Блок питания LUMISTAR SE-300 - 24В','шт',2700,'Блоки питания',1]
  ]},
  {name:'Встраиваемые светильники', calc_group:'products', items:[['EKS ZOOM White MR16','шт',280],['EKS ZOOM White GX53','шт',400],['EKS INFINITY','шт',700]]},
  {name:'Лампочки', calc_group:'products', items:[['Лампа GX53 12w 3000К','шт',150],['Лампа GX53 12w 4000К','шт',150],['Лампа GX53 12w 6000К','шт',150],['Лампа GU 10 3000k','шт',120],['Лампа GU 10 4000k','шт',120],['Лампа MR16 3000К','шт',130],['Лампа MR16 4000К','шт',130]]},
  {name:'Накладные светильники', calc_group:'products', items:[['накладной светильник 1','шт',99],['накладной светильник 2','шт',999],['накладной светильник 3','шт',9999]]}
];

db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS price_sections(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,sort_order INTEGER NOT NULL DEFAULT 0,calc_group TEXT NOT NULL DEFAULT 'ceiling');
CREATE TABLE IF NOT EXISTS price_items(id INTEGER PRIMARY KEY AUTOINCREMENT,section_id INTEGER NOT NULL,name TEXT NOT NULL,unit TEXT NOT NULL DEFAULT 'шт',price REAL,sort_order INTEGER NOT NULL DEFAULT 0,group_name TEXT,group_order INTEGER NOT NULL DEFAULT 0,UNIQUE(section_id,name),FOREIGN KEY(section_id) REFERENCES price_sections(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS calculations(id INTEGER PRIMARY KEY AUTOINCREMENT,client_name TEXT NOT NULL,phone TEXT,address TEXT,manager TEXT,notes TEXT,area REAL NOT NULL DEFAULT 0,room_perimeter REAL NOT NULL DEFAULT 0,calculation_type TEXT NOT NULL DEFAULT 'detailed',items_json TEXT NOT NULL,discount_json TEXT NOT NULL,subtotal REAL NOT NULL,discount_amount REAL NOT NULL,total REAL NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')),updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS idx_calc_search ON calculations(client_name,phone,address,manager);
CREATE INDEX IF NOT EXISTS idx_price_section ON price_items(section_id,group_order,sort_order);
CREATE TABLE IF NOT EXISTS quick_settings(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,calc_group TEXT NOT NULL DEFAULT 'services',sort_order INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1);
`);

for (const stmt of [
  "ALTER TABLE price_sections ADD COLUMN calc_group TEXT NOT NULL DEFAULT 'ceiling'",
  "ALTER TABLE price_items ADD COLUMN group_name TEXT",
  "ALTER TABLE price_items ADD COLUMN group_order INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE calculations ADD COLUMN area REAL NOT NULL DEFAULT 0",
  "ALTER TABLE calculations ADD COLUMN calculation_type TEXT NOT NULL DEFAULT 'detailed'",
  "ALTER TABLE calculations ADD COLUMN room_perimeter REAL NOT NULL DEFAULT 0"
]) {
  try { db.exec(stmt); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
}

function seedPrices(){
  ensureDbOpen();
  const c = Number(db.prepare('SELECT COUNT(*) c FROM price_sections').get().c);
  if (c) return;
  const insS = db.prepare('INSERT INTO price_sections(name,sort_order,calc_group) VALUES(?,?,?)');
  const insI = db.prepare('INSERT INTO price_items(section_id,name,unit,price,sort_order,group_name,group_order) VALUES(?,?,?,?,?,?,?)');
  seed.forEach((s,si)=>{
    const sid = Number(insS.run(s.name,si,s.calc_group).lastInsertRowid);
    s.items.forEach((it,i)=>{
      if (s.groups && !s.grouped) {
        insI.run(sid,`${it[0]} · ширина ${it[5]} мм`,it[1],it[2],i,it[3],it[4]);
      } else if (s.grouped) {
        insI.run(sid,it[0],it[1],it[2],i,it[3],it[4]);
      } else {
        insI.run(sid,it[0],it[1],it[2],i,null,0);
      }
    });
  });
}
seedPrices();

function seedMissingPrices(){
  ensureDbOpen();
  const existing = new Set(db.prepare('SELECT name FROM price_sections').all().map(r=>r.name));
  const insS = db.prepare('INSERT INTO price_sections(name,sort_order,calc_group) VALUES(?,?,?)');
  const insI = db.prepare('INSERT INTO price_items(section_id,name,unit,price,sort_order,group_name,group_order) VALUES(?,?,?,?,?,?,?)');
  for (let si=0; si<seed.length; si++) {
    const s=seed[si];
    if (existing.has(s.name)) continue;
    const sid=Number(insS.run(s.name,20+si,s.calc_group).lastInsertRowid);
    s.items.forEach((it,i)=>{
      if(s.groups && !s.grouped) insI.run(sid,`${it[0]} · ширина ${it[5]} мм`,it[1],it[2],i,it[3],it[4]);
      else if(s.grouped) insI.run(sid,it[0],it[1],it[2],i,it[3],it[4]);
      else insI.run(sid,it[0],it[1],it[2],i,null,0);
    });
  }
}
seedMissingPrices();

function seedQuickSettings(){
  ensureDbOpen();
  const count=Number(db.prepare('SELECT COUNT(*) c FROM quick_settings').get().c);
  if(count)return;
  const ins=db.prepare('INSERT INTO quick_settings(name,calc_group,sort_order,enabled) VALUES(?,?,?,1)');
  [
    ['Углы','services',0],
    ['Монтаж светильников','services',1],
    ['Люстры','services',2],
    ['Керамогранит','services',3],
    ['Карниз','services',4],
    ['Дополнительные работы','services',5]
  ].forEach(([name,group,order])=>ins.run(name,group,order));
}
seedQuickSettings();

function normalizeQuickSettingsOrder(){
  ensureDbOpen();
  const rows=db.prepare('SELECT id,name FROM quick_settings WHERE enabled=1 ORDER BY sort_order,id').all();
  const obsolete=/^(площадь|периметр) помещения(?:\s*,?\s*(?:м²|м2|м))?$/iu;
  const remove=db.prepare('DELETE FROM quick_settings WHERE id=?');
  const update=db.prepare('UPDATE quick_settings SET sort_order=? WHERE id=?');
  db.exec('BEGIN');
  try{
    const current=[];
    for(const row of rows){
      if(obsolete.test(String(row.name||'').trim()))remove.run(row.id);
      else current.push(row);
    }
    current.forEach((row,index)=>update.run(index,row.id));
    db.exec('COMMIT');
  }catch(error){
    db.exec('ROLLBACK');
    throw error;
  }
}
normalizeQuickSettingsOrder();

// Приводим старую двухчастную классификацию к структуре итогового КП:
// полотна / услуги и материалы / товары. Сохранённые расчёты остаются
// совместимыми — при их чтении также учитываются прежние значения групп.
db.exec(`
  UPDATE price_sections SET calc_group='canvas' WHERE name='Полотно';
  UPDATE price_sections SET calc_group='services' WHERE name<>'Полотно' AND calc_group IN ('ceiling','lighting');
`);

(function ensureAutomaticCanvasInstallation(){
  ensureDbOpen();
  let section=db.prepare(`SELECT id FROM price_sections WHERE name='Услуги и материалы'`).get();
  if(!section){
    const next=Number(db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM price_sections').get().n);
    section={id:Number(db.prepare('INSERT INTO price_sections(name,sort_order,calc_group) VALUES(?,?,?)').run('Услуги и материалы',next,'services').lastInsertRowid)};
  }else db.prepare(`UPDATE price_sections SET calc_group='services' WHERE id=?`).run(section.id);
  const existing=db.prepare('SELECT id FROM price_items WHERE name=? LIMIT 1').get(AUTO_INSTALL_NAME);
  if(!existing){
    db.prepare('INSERT INTO price_items(section_id,name,unit,price,sort_order,group_name,group_order) VALUES(?,?,?,?,?,?,?)').run(section.id,AUTO_INSTALL_NAME,'пог.м',500,0,null,0);
  }
})();

// Цена "Запилка угла трека" раньше не была указана в прайсе (price=NULL).
// Заполняем её только там, где менеджер ещё не ввёл цену вручную сам —
// уже сохранённые ручные значения не трогаем.
(function fillMissingTrackCornerPrice(){
  ensureDbOpen();
  try {
    db.prepare(`UPDATE price_items SET price=1500 WHERE name='Запилка угла трека' AND price IS NULL`).run();
  } catch (e) { /* колонка/таблица уже в порядке — ничего не делаем */ }
})();

app.use(requireSharedLogin);
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'public')));

function getPrices(){
  ensureDbOpen();
  const rows = db.prepare(`SELECT s.id section_id,s.name section_name,s.sort_order section_order,s.calc_group,i.id item_id,i.name item_name,i.unit,i.price,i.sort_order,i.group_name,i.group_order FROM price_sections s LEFT JOIN price_items i ON i.section_id=s.id ORDER BY s.sort_order,s.id,i.group_order,i.sort_order,i.id`).all();
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.section_id)) map.set(r.section_id,{id:r.section_id,name:r.section_name,sortOrder:r.section_order,calcGroup:r.calc_group,items:[]});
    if(r.item_id!==null) map.get(r.section_id).items.push({id:r.item_id,name:r.item_name,unit:r.unit,price:r.price,sortOrder:r.sort_order,group:r.group_name,groupOrder:r.group_order});
  }
  return [...map.values()];
}
app.get('/api/prices',(req,res)=>res.json(getPrices()));
function validPriceGroup(value){return PRICE_GROUPS.has(String(value||''))?String(value):'services'}
function parsedPrice(value){
  if(value===''||value===null||value===undefined)return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:NaN;
}
app.post('/api/price-sections',(req,res)=>{
  const name=String(req.body?.name||'').trim();
  if(!name)return res.status(400).json({error:'Укажите название категории'});
  const calcGroup=validPriceGroup(req.body?.calc_group);
  const sortOrder=Number.isFinite(Number(req.body?.sort_order))?Number(req.body.sort_order):Number(db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM price_sections').get().n);
  try{
    const x=db.prepare('INSERT INTO price_sections(name,sort_order,calc_group) VALUES(?,?,?)').run(name,sortOrder,calcGroup);
    res.status(201).json({id:Number(x.lastInsertRowid)});
  }catch(e){res.status(409).json({error:String(e.message).includes('UNIQUE')?'Категория с таким названием уже существует':'Не удалось добавить категорию'})}
});
app.put('/api/price-sections/:id',(req,res)=>{
  const id=Number(req.params.id),current=db.prepare('SELECT * FROM price_sections WHERE id=?').get(id);
  if(!current)return res.status(404).json({error:'Категория не найдена'});
  const system=current.name==='Полотно'||current.name==='Услуги и материалы';
  const name=system?current.name:String(req.body?.name||'').trim();
  if(!name)return res.status(400).json({error:'Укажите название категории'});
  const calcGroup=system?(current.name==='Полотно'?'canvas':'services'):validPriceGroup(req.body?.calc_group);
  const sortOrder=Number.isFinite(Number(req.body?.sort_order))?Number(req.body.sort_order):0;
  try{
    const x=db.prepare('UPDATE price_sections SET name=?,calc_group=?,sort_order=? WHERE id=?').run(name,calcGroup,sortOrder,id);
    res.json({ok:true});
  }catch(e){res.status(409).json({error:String(e.message).includes('UNIQUE')?'Категория с таким названием уже существует':'Не удалось сохранить категорию'})}
});
app.delete('/api/price-sections/:id',(req,res)=>{
  const id=Number(req.params.id);
  const section=db.prepare('SELECT name FROM price_sections WHERE id=?').get(id);
  if(!section)return res.status(404).json({error:'Категория не найдена'});
  if(section.name==='Полотно'||section.name==='Услуги и материалы')return res.status(400).json({error:'Системную категорию удалить нельзя'});
  const x=db.prepare('DELETE FROM price_sections WHERE id=?').run(id);
  res.json({ok:!!x.changes});
});
app.post('/api/prices',(req,res)=>{
  const b=req.body||{},name=String(b.name||'').trim(),unit=String(b.unit||'шт').trim()||'шт',sectionId=Number(b.section_id),price=parsedPrice(b.price);
  if(!name)return res.status(400).json({error:'Укажите название позиции'});
  if(!Number.isInteger(sectionId)||!db.prepare('SELECT id FROM price_sections WHERE id=?').get(sectionId))return res.status(400).json({error:'Выберите категорию'});
  if(Number.isNaN(price))return res.status(400).json({error:'Некорректная цена'});
  const sortOrder=Number.isFinite(Number(b.sort_order))?Number(b.sort_order):Number(db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM price_items WHERE section_id=?').get(sectionId).n);
  try{
    const x=db.prepare('INSERT INTO price_items(section_id,name,unit,price,sort_order,group_name,group_order) VALUES(?,?,?,?,?,?,?)').run(sectionId,name,unit,price,sortOrder,String(b.group_name||'').trim()||null,Number(b.group_order)||0);
    res.status(201).json({id:Number(x.lastInsertRowid)});
  }catch(e){res.status(409).json({error:String(e.message).includes('UNIQUE')?'Такая позиция уже есть в выбранной категории':'Не удалось добавить позицию'})}
});
app.put('/api/prices/:id',(req,res)=>{
  const id = Number(req.params.id), body = req.body || {};
  const current=db.prepare('SELECT * FROM price_items WHERE id=?').get(id);
  if(!current)return res.status(404).json({error:'Позиция не найдена'});
  const price = parsedPrice(body.price);
  if(Number.isNaN(price))return res.status(400).json({error:'Некорректная цена'});
  const unit = String(body.unit||'шт').trim()||'шт';
  const automatic=current.name===AUTO_INSTALL_NAME;
  const name=automatic?AUTO_INSTALL_NAME:String(body.name??current.name).trim();
  const sectionId=automatic?Number(current.section_id):Number(body.section_id??current.section_id);
  if(!name)return res.status(400).json({error:'Укажите название позиции'});
  if(!Number.isInteger(sectionId)||!db.prepare('SELECT id FROM price_sections WHERE id=?').get(sectionId))return res.status(400).json({error:'Выберите категорию'});
  try{
    db.prepare('UPDATE price_items SET section_id=?,name=?,unit=?,price=?,sort_order=?,group_name=?,group_order=? WHERE id=?').run(sectionId,name,unit,price,Number(body.sort_order??current.sort_order)||0,String(body.group_name??current.group_name??'').trim()||null,Number(body.group_order??current.group_order)||0,id);
    res.json({ok:true});
  }catch(e){res.status(409).json({error:String(e.message).includes('UNIQUE')?'Такая позиция уже есть в выбранной категории':'Не удалось сохранить позицию'})}
});
app.delete('/api/prices/:id',(req,res)=>{
  const id=Number(req.params.id),item=db.prepare('SELECT name FROM price_items WHERE id=?').get(id);
  if(!item)return res.status(404).json({error:'Позиция не найдена'});
  if(item.name===AUTO_INSTALL_NAME)return res.status(400).json({error:'Автоматическую установку полотна удалить нельзя'});
  db.prepare('DELETE FROM price_items WHERE id=?').run(id);
  res.json({ok:true});
});

app.get('/api/quick-settings',(req,res)=>{
  ensureDbOpen();
  res.json(db.prepare('SELECT id,name,calc_group,sort_order FROM quick_settings WHERE enabled=1 ORDER BY sort_order,id').all());
});
app.post('/api/quick-settings',(req,res)=>{
  ensureDbOpen();
  const name=String(req.body?.name||'').trim();
  const calcGroup=validPriceGroup(req.body?.calc_group);
  const sortOrder=Number.isFinite(Number(req.body?.sort_order))?Number(req.body.sort_order):Number(db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM quick_settings').get().n);
  if(!name)return res.status(400).json({error:'Укажите название строки'});
  const x=db.prepare('INSERT INTO quick_settings(name,calc_group,sort_order,enabled) VALUES(?,?,?,1)').run(name,calcGroup,sortOrder);
  normalizeQuickSettingsOrder();
  res.status(201).json({id:Number(x.lastInsertRowid)});
});
app.put('/api/quick-settings/:id',(req,res)=>{
  ensureDbOpen();
  const id=Number(req.params.id),cur=db.prepare('SELECT * FROM quick_settings WHERE id=?').get(id);
  if(!cur)return res.status(404).json({error:'Строка не найдена'});
  const name=String(req.body?.name??cur.name).trim();
  const calcGroup=validPriceGroup(req.body?.calc_group??cur.calc_group);
  const sortOrder=Number.isFinite(Number(req.body?.sort_order))?Number(req.body.sort_order):cur.sort_order;
  if(!name)return res.status(400).json({error:'Укажите название строки'});
  db.prepare('UPDATE quick_settings SET name=?,calc_group=?,sort_order=?,enabled=1 WHERE id=?').run(name,calcGroup,sortOrder,id);
  normalizeQuickSettingsOrder();
  res.json({ok:true});
});
app.delete('/api/quick-settings/:id',(req,res)=>{
  ensureDbOpen();
  const x=db.prepare('DELETE FROM quick_settings WHERE id=?').run(Number(req.params.id));
  if(!x.changes)return res.status(404).json({error:'Строка не найдена'});
  normalizeQuickSettingsOrder();
  res.json({ok:true});
});
function getCalc(id){
  ensureDbOpen();
  const r = db.prepare('SELECT * FROM calculations WHERE id=?').get(id);
  if(!r) return null;
  let discount = JSON.parse(r.discount_json || '{}');
  if (discount.services) {
    discount = {services:discount.services||{type:'none',value:0,reason:''},products:discount.products||{type:'none',value:0,reason:''},ceiling:discount.ceiling||{type:'none',value:0,reason:''},lighting:discount.lighting||{type:'none',value:0,reason:''}};
  } else if (!discount.ceiling && !discount.lighting && !discount.products) discount = {ceiling:discount,lighting:{type:'none',value:0,reason:''},products:{type:'none',value:0,reason:''}};
  else discount = {ceiling:discount.ceiling||{type:'none',value:0,reason:''},lighting:discount.lighting||{type:'none',value:0,reason:''},products:discount.products||{type:'none',value:0,reason:''}};
  return {...r,items:JSON.parse(r.items_json),discount};
}
app.get('/api/calculations',(req,res)=>{
  ensureDbOpen();
  const q=String(req.query.q||'').trim();
  const limit=Math.min(Math.max(Number(req.query.limit)||100,1),500);
  const like=`%${q}%`;
  const rows=q
    ? db.prepare(`SELECT id,client_name,phone,address,manager,area,room_perimeter,calculation_type,subtotal,discount_amount,total,created_at,updated_at FROM calculations WHERE client_name LIKE ? OR phone LIKE ? OR address LIKE ? OR manager LIKE ? OR CAST(id AS TEXT) LIKE ? ORDER BY id DESC LIMIT ?`).all(like,like,like,like,like,limit)
    : db.prepare(`SELECT id,client_name,phone,address,manager,area,room_perimeter,calculation_type,subtotal,discount_amount,total,created_at,updated_at FROM calculations ORDER BY id DESC LIMIT ?`).all(limit);
  res.json(rows);
});
app.get('/api/calculations/:id',(req,res)=>{
  ensureDbOpen();
  const r=getCalc(Number(req.params.id));
  if(!r) return res.status(404).json({error:'Расчёт не найден'});
  res.json({...r,url:publicKpUrl(req,r.id)});
});

function discountAmount(subtotal, d, area){
  const x=d && typeof d==='object' ? d : {type:'none',value:0};
  const v=Number(x.value)||0;
  let amount=0;
  if(x.type==='area80') amount=subtotal*.15;
  else if(x.type==='measurement'||x.type==='newcomer') amount=subtotal*.10;
  else if(x.type==='custom'||x.type==='percent') amount=subtotal*Math.max(0,Math.min(v,100))/100;
  else if(x.type==='fixed') amount=Math.max(0,Math.min(v,subtotal));
  return Math.max(0,Math.min(amount,subtotal));
}
function normalizeDiscount(d){
  const x=d&&typeof d==='object'?d:{};
  return {type:String(x.type||'none'),value:Number(x.value)||0,reason:String(x.reason||'').trim()};
}
function normalizedItemGroup(x){
  const group=String(x?.calc_group||'');
  if(group==='products')return 'products';
  if(group==='canvas'||String(x?.section||'').trim()==='Полотно')return 'canvas';
  if(group==='services'||group==='ceiling'||group==='lighting'||LEGACY_LIGHTING_SECTIONS.has(x?.section))return 'services';
  return 'services';
}
function normalize(b){
  const rawItems=Array.isArray(b.items)?b.items:[];
  const items=rawItems.filter(x=>Number(x.qty)>0&&Number(x.price)>=0).map(x=>({...x,qty:Number(x.qty),price:Number(x.price),calc_group:normalizedItemGroup(x),source:x.source==='quick'?'quick':'price'}));
  const area=Number(b.area)||0;
  const room_perimeter=Number(b.room_perimeter)||0;
  const canvasItems=items.filter(x=>x.calc_group==='canvas');
  const serviceItems=items.filter(x=>x.calc_group==='services');
  const productsItems=items.filter(x=>x.calc_group==='products');
  const canvasSubtotal=canvasItems.reduce((s,x)=>s+x.qty*x.price,0);
  const serviceSubtotal=serviceItems.reduce((s,x)=>s+x.qty*x.price,0);
  const productsSubtotal=productsItems.reduce((s,x)=>s+x.qty*x.price,0);
  const subtotal=canvasSubtotal+serviceSubtotal+productsSubtotal;
  let services,products,ceiling,lighting,servicesDiscount,productsDiscount;
  if (b.discount?.services) {
    services=normalizeDiscount(b.discount.services);
    products=normalizeDiscount(b.discount.products);
    servicesDiscount=discountAmount(canvasSubtotal+serviceSubtotal,services,area);
    productsDiscount=discountAmount(productsSubtotal,products,area);
    ceiling=normalizeDiscount({type:'none',value:0,reason:''});
    lighting=normalizeDiscount({type:'none',value:0,reason:''});
  } else {
    ceiling=normalizeDiscount(b.discount?.ceiling || b.discount);
    lighting=normalizeDiscount(b.discount?.lighting);
    products=normalizeDiscount(b.discount?.products);
    services=normalizeDiscount({type:'none',value:0,reason:''});
    servicesDiscount=discountAmount(canvasSubtotal,ceiling,area)+discountAmount(serviceSubtotal,lighting,area);
    productsDiscount=discountAmount(productsSubtotal,products,area);
  }
  const ceilingDiscount=servicesDiscount;
  const lightingDiscount=0;
  const discount=servicesDiscount+productsDiscount;
  return {
    client_name:String(b.client_name||'Без имени').trim()||'Без имени',phone:String(b.phone||'').trim(),address:String(b.address||'').trim(),manager:String(b.manager||'').trim(),notes:String(b.notes||'').trim(),area,room_perimeter,calculation_type:b.calculation_type==='quick'?'quick':'detailed',
    items,discount:{services,products,ceiling,lighting},subtotal,discount_amount:discount,total:subtotal-discount,
    canvasSubtotal,serviceSubtotal,productsSubtotal,servicesSubtotal:canvasSubtotal+serviceSubtotal,servicesDiscount,ceilingDiscount,lightingDiscount,productsDiscount,servicesTotal:(canvasSubtotal+serviceSubtotal)-servicesDiscount,canvasTotal:canvasSubtotal,serviceTotal:serviceSubtotal,productsTotal:productsSubtotal-productsDiscount
  };
}
app.post('/api/calculations',(req,res)=>{
  ensureDbOpen();
  const p=normalize(req.body||{});
  const x=db.prepare(`INSERT INTO calculations(client_name,phone,address,manager,notes,area,room_perimeter,calculation_type,items_json,discount_json,subtotal,discount_amount,total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.client_name,p.phone,p.address,p.manager,p.notes,p.area,p.room_perimeter,p.calculation_type,JSON.stringify(p.items),JSON.stringify(p.discount),p.subtotal,p.discount_amount,p.total);
  const id=Number(x.lastInsertRowid);
  res.status(201).json({id,url:publicKpUrl(req,id)});
});
app.put('/api/calculations/:id',(req,res)=>{
  ensureDbOpen();
  const id=Number(req.params.id),p=normalize(req.body||{});
  const x=db.prepare(`UPDATE calculations SET client_name=?,phone=?,address=?,manager=?,notes=?,area=?,room_perimeter=?,calculation_type=?,items_json=?,discount_json=?,subtotal=?,discount_amount=?,total=?,updated_at=datetime('now','localtime') WHERE id=?`).run(p.client_name,p.phone,p.address,p.manager,p.notes,p.area,p.room_perimeter,p.calculation_type,JSON.stringify(p.items),JSON.stringify(p.discount),p.subtotal,p.discount_amount,p.total,id);
  if(!x.changes) return res.status(404).json({error:'Расчёт не найден'});
  res.json({id,url:publicKpUrl(req,id)});
});
app.delete('/api/calculations/:id',(req,res)=>{
  ensureDbOpen();
  const x=db.prepare('DELETE FROM calculations WHERE id=?').run(Number(req.params.id));
  if(!x.changes)return res.status(404).json({error:'Расчёт не найден'});
  res.json({ok:true});
});

function formatDateTime(value){
  const str=String(value||'');
  const m=str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(m)return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}:${m[6]}`;
  const d=new Date(str);
  if(Number.isNaN(d.getTime()))return str;
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function discountLabel(d){
  const type=d?.type||'none', value=Number(d?.value)||0;
  if(type==='area80') return 'От 80 м² — 15%';
  if(type==='measurement') return 'Скидка в день замера — 10%';
  if(type==='newcomer') return 'Новосёлам и пенсионерам — 10%';
  if(type==='custom') return `Скидка — ${value}%`;
  if(type==='fixed') return `Скидка — ${value.toLocaleString('ru-RU')} ₽`;
  return 'Без скидки';
}
function cpHtml(c){
  const allItems=(c.items||[]).map(x=>({...x,calc_group:normalizedItemGroup(x)}));
  const canvas=allItems.filter(x=>x.calc_group==='canvas');
  const services=allItems.filter(x=>x.calc_group==='services');
  const products=allItems.filter(x=>x.calc_group==='products');
  const canvasSubtotal=canvas.reduce((s,x)=>s+(Number(x.qty)||0)*(Number(x.price)||0),0);
  const servicesSubtotal=services.reduce((s,x)=>s+(Number(x.qty)||0)*(Number(x.price)||0),0);
  const productsSubtotal=products.reduce((s,x)=>s+(Number(x.qty)||0)*(Number(x.price)||0),0);
  const combinedServicesSubtotal=canvasSubtotal+servicesSubtotal;
  const productsDiscount=discountAmount(productsSubtotal, normalizeDiscount(c.discount?.products), Number(c.area)||0);
  const servicesDiscountInfo=normalizeDiscount(c.discount?.services);
  const legacyCeilingInfo=normalizeDiscount(c.discount?.ceiling);
  const legacyLightingInfo=normalizeDiscount(c.discount?.lighting);
  const useLegacySplit = servicesDiscountInfo.type==='none' && (legacyCeilingInfo.type!=='none' || legacyLightingInfo.type!=='none');
  let servicesDiscount;
  if(useLegacySplit){
    const oldLighting=allItems.filter(x=>LEGACY_LIGHTING_SECTIONS.has(x.section)).reduce((s,x)=>s+(Number(x.qty)||0)*(Number(x.price)||0),0);
    const oldCeiling=Math.max(0,combinedServicesSubtotal-oldLighting);
    servicesDiscount=discountAmount(oldCeiling,legacyCeilingInfo,Number(c.area)||0)+discountAmount(oldLighting,legacyLightingInfo,Number(c.area)||0);
  }else servicesDiscount=discountAmount(combinedServicesSubtotal,servicesDiscountInfo,Number(c.area)||0);
  const canvasDiscount=combinedServicesSubtotal?servicesDiscount*(canvasSubtotal/combinedServicesSubtotal):0;
  const materialDiscount=servicesDiscount-canvasDiscount;
  const appliedServicesDiscount=useLegacySplit?(legacyCeilingInfo.type!=='none'?legacyCeilingInfo:legacyLightingInfo):servicesDiscountInfo;
  const rub=v=>`${Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`;
  const rows=(arr)=>arr.map((x,i)=>`<tr><td class="r">${i+1}.</td><td class="item-cell">${esc(x.name)}</td><td class="r qty-cell">${Number(x.qty)||0}</td><td class="unit-cell">${esc(x.unit)}</td><td class="r money-cell">${rub(x.price)}</td><td class="r money-cell strong">${rub((Number(x.qty)||0)*(Number(x.price)||0))}</td></tr>`).join('');
  const mini=(sub,disc,d)=>`<div class="mini"><div><span>Подытог</span><b>${rub(sub)}</b></div><div class="discount-line"><span>${esc(discountLabel(d))}</span><b>− ${rub(disc)}</b></div>${d?.reason?`<div class="comment-line"><span>Комментарий к скидке</span><span>${esc(d.reason)}</span></div>`:''}</div>`;
  const block=(title,arr,sub,disc,d,extra='')=>arr.length?`<section class="estimate-section">
    <div class="section-title"><span>${esc(title)}</span><b>${rub(sub-disc)}</b></div>
    ${extra}
    <div class="table-shell"><table><colgroup><col class="c-num"><col class="c-item"><col class="c-qty"><col class="c-unit"><col class="c-price"><col class="c-sum"></colgroup>
      <thead><tr><th>№</th><th>Наименование</th><th class="r">Кол.</th><th>Ед.</th><th class="r">Цена</th><th class="r">Итого</th></tr></thead>
      <tbody>${rows(arr)}</tbody>
    </table></div>
    ${mini(sub,disc,d)}
  </section>`:'';
  const canvasArea=c.calculation_type==='quick'?0:canvas.reduce((s,x)=>s+(Number(x.qty)||0),0);
  const areaLine=canvasArea?`<div class="area-line">Общая площадь полотен: <b>${Number(canvasArea).toLocaleString('ru-RU',{maximumFractionDigits:2})} м²</b></div>`:'';
  const servicesHtml=block('ПОЛОТНА',canvas,canvasSubtotal,canvasDiscount,appliedServicesDiscount,areaLine)
    +block('УСЛУГИ И МАТЕРИАЛЫ',services,servicesSubtotal,materialDiscount,appliedServicesDiscount)
    +block('ТОВАРЫ',products,productsSubtotal,productsDiscount,normalizeDiscount(c.discount?.products));
  const subtotal=combinedServicesSubtotal+productsSubtotal;
  const discount=servicesDiscount+productsDiscount;
  const total=subtotal-discount;
  const brandRed='#c8102e', brandBlue='#1f477d', ink='#172335';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Коммерческое предложение — ${esc(c.client_name)}</title><style>
*{box-sizing:border-box}
@page{size:A4;margin:8mm 7mm 9mm}
html{background:#edf1f5}
body{margin:0;background:#edf1f5;color:${ink};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:10px;line-height:1.3}
.page{position:relative;width:210mm;min-height:297mm;margin:24px auto 52px;background:#fff;border:1px solid #dce2e9;border-radius:2px;box-shadow:0 18px 48px rgba(31,55,83,.14);overflow:visible}
.a4-limit{position:absolute;z-index:5;top:calc(297mm - 1px);left:0;right:0;border-top:1px dashed rgba(200,16,46,.6);pointer-events:none}.a4-limit::after{content:'граница 1 листа A4';position:absolute;right:8mm;top:-8px;padding:1px 5px;background:#fff;color:${brandRed};font-size:8px;font-weight:700}
.hero{padding:8mm 8mm 10px;background:#fff;border-bottom:1px solid #d7dce2}
.brand-row{display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{font-size:15px;font-weight:850;color:${brandRed};letter-spacing:.01em}.brand-sub{margin-top:1px;font-size:9px;color:#687484}.badge{padding:4px 8px;border-radius:999px;background:#eef3f8;color:${brandBlue};font-size:9.5px;font-weight:750}.title{margin:8px 0 3px;font-size:22px;line-height:1.12;font-weight:850;letter-spacing:-.025em;color:${brandBlue}}.meta{font-size:9.5px;color:#687483}
.content{padding:0 8mm 8mm}.client{display:flex;align-items:flex-start;gap:0;padding:9px 0;margin-top:10px;background:#fff;border-top:1px solid #e1e6ed;border-bottom:1px solid #e1e6ed}.client div{flex:1 1 0;min-width:0;padding:0 10px;border-right:1px solid #e1e6ed;overflow-wrap:anywhere}.client div:first-child{padding-left:0}.client div:last-child{padding-right:0;border-right:0}.client div:nth-child(3){flex-grow:1.7}.client b{display:block;margin-bottom:3px;font-size:8px;line-height:1.2;text-transform:uppercase;letter-spacing:.07em;color:#737f8c}.client div:not(:has(b)){color:${ink};font-weight:550}
.estimate-section{margin-top:14px;break-inside:auto}.section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;padding:0 0 5px;margin-bottom:6px;border-bottom:2px solid ${brandBlue};font-size:13px;line-height:1.2;font-weight:850;color:${brandBlue}}.section-title b{font-size:13px;white-space:nowrap;color:${brandRed}}
.sub-block{margin-bottom:9px}.sub-block:last-of-type{margin-bottom:0}.sub-title{font-size:10px;font-weight:750;color:#566271;margin-bottom:4px}
.area-line{margin:-1px 0 6px;color:#566271;font-size:9.5px}.area-line b{color:${ink}}.table-shell{width:100%;overflow:hidden;border:1px solid #dfe5eb;border-radius:7px}table{width:100%;min-width:0;border-collapse:collapse;table-layout:fixed}th,td{padding:5px 6px;border-bottom:1px solid #e8ecf0;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:normal;font-size:9.5px;line-height:1.25}th{background:#f2f5f8;color:#566271;font-size:9px;font-weight:750;white-space:nowrap}tbody tr{break-inside:avoid}tbody tr:nth-child(even){background:#fbfcfd}tbody tr:last-child td{border-bottom:0}.r{text-align:right;white-space:nowrap}.strong{font-weight:750}.c-num{width:5%}.c-item{width:45%}.c-qty{width:8%}.c-unit{width:8%}.c-price{width:16%}.c-sum{width:18%}
.mini{width:320px;max-width:100%;margin:7px 0 0 auto;padding:7px 9px;border:1px solid #e1e6ed;border-radius:8px;background:#fafbfd}.mini>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:2px 0;color:#505c69;font-size:9.5px;align-items:start}.mini b{color:${ink}}.mini .discount-line{color:${brandRed}}.mini .discount-line b{color:${brandRed}}.mini .comment-line{border-top:1px dashed #dfe4e9;margin-top:3px;padding-top:5px}.mini .comment-line span:last-child{max-width:190px;text-align:right;overflow-wrap:anywhere}
.grand{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:10px;padding:9px 12px;border-radius:8px;background:${brandBlue};color:#fff;font-size:14px;line-height:1.2;font-weight:850;break-inside:avoid}.grand span:last-child{font-size:16px;white-space:nowrap}.note{margin-top:7px;padding:7px 10px;border-left:3px solid ${brandRed};border-radius:0 7px 7px 0;background:#fafbfd;color:#596573;font-size:9.5px;break-inside:avoid}
.print{position:fixed;top:18px;right:18px;z-index:20;border:1px solid ${brandRed};background:${brandRed};color:#fff;padding:11px 15px;border-radius:9px;cursor:pointer;font:700 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;box-shadow:0 8px 20px rgba(200,16,46,.18);transition:transform .15s,filter .15s}.print:hover{filter:brightness(.95);transform:translateY(-1px)}.print:focus-visible{outline:3px solid rgba(31,71,125,.25);outline-offset:2px}
@media screen and (max-width:760px){body{font-size:15px}.page{width:calc(100% - 20px);min-height:0;margin:12px auto 82px;border-radius:14px;overflow:hidden}.a4-limit{display:none}.hero{padding:22px 18px 20px;background:linear-gradient(135deg,#fff 0%,#f7f9fb 100%)}.content{padding:0 18px 28px}.brand-row{align-items:flex-start;flex-direction:column;gap:10px}.brand{font-size:19px}.brand-sub{font-size:12px}.badge{font-size:12px;padding:7px 11px}.title{font-size:28px;margin:18px 0 5px}.meta{font-size:13px}.client{align-items:stretch;flex-direction:column;gap:10px;padding:13px;margin-top:18px;background:#f5f7fa;border:1px solid #e1e6ed;border-radius:11px}.client div,.client div:first-child,.client div:last-child{padding:0;border:0}.client b{font-size:10px}.estimate-section{margin-top:28px}.section-title{align-items:flex-start;flex-direction:column;gap:5px;font-size:18px;margin-bottom:12px;padding-bottom:10px}.section-title b{font-size:16px}.sub-title{font-size:13px;margin-bottom:7px}.table-shell{overflow-x:auto;border-radius:10px}table{min-width:700px}th,td{padding:8px 7px;font-size:12px}.mini{width:100%;padding:10px 13px}.mini>div{font-size:13px;padding:4px 0}.grand{font-size:20px;padding:15px;margin-top:24px}.grand span:last-child{font-size:21px}.note{font-size:12.5px;padding:12px 14px}.print{top:auto;right:12px;bottom:12px;left:12px;width:calc(100% - 24px)}}
@media screen and (max-width:520px){.hero{padding:19px 14px}.content{padding:0 14px 23px}.title{font-size:25px}.section-title{font-size:17px}.mini>div{grid-template-columns:1fr;gap:3px}.mini .comment-line span:last-child{text-align:left;max-width:none}table{min-width:640px}}
@media print{
  html,body{background:#fff!important;margin:0!important}
  .page{width:100%;min-height:0;margin:0;background:#fff;border:0;border-radius:0;box-shadow:none;overflow:visible}
  .a4-limit,.print{display:none!important}
  .hero{padding:0 0 10px}
  .content{padding:0}
  .table-shell{overflow:visible!important}
  table{width:100%!important;min-width:0!important}
}
</style></head><body><button class="print" onclick="window.print()">Печать / PDF</button><main class="page"><div class="a4-limit" aria-hidden="true"></div><header class="hero"><div class="brand-row"><div><div class="brand">Потолочная №1</div><div class="brand-sub">Натяжные потолки и освещение</div></div><div class="badge">${c.calculation_type==='quick'?'Быстрый расчёт':'Коммерческое предложение'}</div></div><div class="title">Расчёт стоимости</div><div class="meta">№${c.id} · ${esc(formatDateTime(c.created_at))}</div></header><div class="content"><div class="client">${c.client_name?`<div><b>Клиент</b>${esc(c.client_name)}</div>`:''}${c.phone?`<div><b>Телефон</b>${esc(c.phone)}</div>`:''}${c.address?`<div><b>Адрес объекта</b>${esc(c.address)}</div>`:''}${c.manager?`<div><b>Менеджер</b>${esc(c.manager)}</div>`:''}${c.area?`<div><b>Площадь помещения</b>${esc(c.area)} м²</div>`:''}${c.room_perimeter?`<div><b>Периметр помещения</b>${esc(c.room_perimeter)} м</div>`:''}</div>${servicesHtml}<div class="grand"><span>ОБЩАЯ СТОИМОСТЬ</span><span>${rub(total)}</span></div>${c.notes?`<div class="note"><b>Комментарий:</b> ${esc(c.notes)}</div>`:''}</div></main></body></html>`;
}
app.get('/kp/:id',(req,res)=>{
  ensureDbOpen();const c=getCalc(Number(req.params.id));if(!c)return res.status(404).send('КП не найдено');res.setHeader('Cache-Control','no-store');res.send(cpHtml(c));});
app.use((req,res,next)=>{if(req.method!=='GET')return next();res.sendFile(path.join(__dirname,'public','index.html'));});
const server=app.listen(PORT,()=>console.log(`Calculator started on http://localhost:${PORT}`));
function shutdown(){
  try { if (db.isOpen) db.close(); } catch {}
  server.close(()=>process.exit(0));
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
