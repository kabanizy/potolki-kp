// New functionality is kept separate from the existing calculator and KP layout.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const PERMISSIONS={
  view_calculator:'Калькулятор',view_quick:'Быстрый расчёт',view_history:'История расчётов',view_others:'Чужие расчёты',view_catalog:'Страница «Прайс»',view_prices:'Цены',view_photos:'Фотографии позиций',
  create_calculations:'Создавать расчёты',create_quick:'Создавать быстрые расчёты',publish_kp:'Формировать КП',add_oneoff:'Добавлять разовые строки',
  edit_own:'Редактировать свои расчёты',edit_others:'Редактировать чужие расчёты',edit_quantity:'Изменять количество',edit_install_price:'Изменять цену установки полотна',edit_discount:'Изменять скидку',
  add_items:'Добавлять позиции',edit_items:'Редактировать позиции',edit_prices:'Изменять цены прайса',delete_items:'Удалять позиции',manage_photos:'Управлять фотографиями',
  manage_quick:'Изменять постоянные строки быстрого расчёта',manage_users:'Управлять пользователями',manage_invites:'Управлять кодами приглашений',manage_permissions:'Управлять правами пользователей'
};
const DEFAULTS=Object.fromEntries(Object.keys(PERMISSIONS).map(k=>[k,!['view_others','edit_others','add_items','edit_items','edit_prices','delete_items','manage_photos','manage_quick','manage_users','manage_invites','manage_permissions'].includes(k)]));
const INSTALLATION={'MSD Ideal':500,'HALEAD Standart':500,'DEKEN':500,'BAUF 205':500,'MSD Evolution':500,'BAUF 270':600,'КМТ':600,'TEQUTUM Euro':600,'Blackout':600,'Bauf FireProof (KM3)':500,'TEQUTUM KM2':600,'TEQUTUM KM1':600};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const passwordHash=p=>{const salt=crypto.randomBytes(24).toString('hex');return salt+':'+crypto.scryptSync(p,salt,64).toString('hex')};
function passwordMatches(p,stored){try{const [salt,key]=stored.split(':');const expected=Buffer.from(key,'hex');return crypto.timingSafeEqual(expected,crypto.scryptSync(p,salt,64))}catch{return false}}
function fail(message,status=400){const error=new Error(message);error.status=status;throw error}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
function setup({app,db,dbPath,getPrices,getCalc,normalize,cpHtml,publicKpUrl}){
  db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,login TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'manager',active INTEGER NOT NULL DEFAULT 1,permissions_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,used_at TEXT,used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,used_name TEXT);
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS installation_rates(model TEXT PRIMARY KEY,price REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS feature_migrations(name TEXT PRIMARY KEY);
  `);
  function column(table,name,type){if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)}
  column('calculations','owner_id','INTEGER REFERENCES users(id) ON DELETE SET NULL');
  column('calculations','published','INTEGER NOT NULL DEFAULT 1');
  column('calculations','public_token','TEXT');
  column('price_items','photo_id','TEXT REFERENCES photos(id)');
  column('quick_settings','price_item_id','INTEGER');
  column('quick_settings','section_id','INTEGER');
  column('quick_settings','price_source',"TEXT NOT NULL DEFAULT 'catalog'");
  column('quick_settings','custom_options_json',"TEXT NOT NULL DEFAULT '[]'");
  if(!db.prepare('SELECT 1 FROM feature_migrations WHERE name=?').get('accounts-v1'))transaction(db,()=>{
    const login=process.env.APP_USER||'manager', pass=process.env.APP_PASS||'potolki2026';
    const id=Number(db.prepare('INSERT INTO users(name,login,password_hash,role) VALUES(?,?,?,?)').run('Главный администратор',login,passwordHash(pass),'admin').lastInsertRowid);
    db.prepare('UPDATE calculations SET owner_id=? WHERE owner_id IS NULL').run(id);
    db.prepare('INSERT INTO feature_migrations VALUES(?)').run('accounts-v1');
  });
  const insertRate=db.prepare('INSERT OR IGNORE INTO installation_rates(model,price) VALUES(?,?)');
  for(const [model,price] of Object.entries(INSTALLATION))insertRate.run(model,price);
  const photoDir=process.env.PHOTO_DIR||path.join(path.dirname(dbPath),'photos');
  fs.mkdirSync(photoDir,{recursive:true});
  function can(user,key){return !!user&&(user.role==='admin'||user.permissions[key]===true)}
  function userView(row){if(!row)return null;const permissions={...DEFAULTS,...JSON.parse(row.permissions_json||'{}')};return {id:row.id,name:row.name,login:row.login,role:row.role,active:!!row.active,created_at:row.created_at,permissions:row.role==='admin'?Object.fromEntries(Object.keys(PERMISSIONS).map(k=>[k,true])):permissions}}
  function requirePermission(req,key){if(!can(req.user,key))fail('Нет права: '+PERMISSIONS[key],403)}
  function tokenFrom(req){const pair=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sid='));return pair?pair.slice(4):''}
  function authenticated(req){const token=tokenFrom(req);if(!/^[a-f0-9]{64}$/.test(token))return null;const row=db.prepare('SELECT u.* FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(hash(token),Date.now());return userView(row)}
  function cookie(req,res,token){res.setHeader('Set-Cookie',`sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${req.secure?'; Secure':''}`)}
  function issueSession(req,res,id){const token=crypto.randomBytes(32).toString('hex');db.prepare('DELETE FROM user_sessions WHERE expires_at<?').run(Date.now());db.prepare('INSERT INTO user_sessions VALUES(?,?,?)').run(hash(token),id,Date.now()+604800000);cookie(req,res,token)}
  function revoke(id){db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id)}
  function guard(fn){return (req,res,next)=>{try{return fn(req,res,next)}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Не удалось выполнить действие'})}}}
  const failures=new Map();
  function rateLimit(req){const key=req.ip,now=Date.now();let v=failures.get(key);if(!v||now-v.start>60000){v={start:now,count:0};failures.set(key,v)}if(++v.count>15)fail('Слишком много попыток. Подождите минуту.',429);if(failures.size>10000)for(const [k,x]of failures)if(now-x.start>60000)failures.delete(k)}
  function userInput(b,old){const login=String(b.login??old?.login??'').trim(),name=String(b.name??old?.name??'').trim(),password=String(b.password||'');if(!/^[a-zA-Z0-9_.@-]{3,80}$/.test(login))fail('Логин: 3–80 латинских букв, цифр или символов _.@-');if(!name||name.length>120)fail('Укажите имя до 120 символов');if((!old||password)&&(password.length<8||password.length>128))fail('Пароль должен содержать от 8 до 128 символов');return {login,name,password}}
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Запрос с другого сайта запрещён'});
      if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.get('host'))return res.status(403).json({error:'Неверный источник запроса'})}catch{return res.sendStatus(403)}}
    }
    req.user=authenticated(req);next();
  });
  app.use(express.json({limit:'2mb'}));
  app.use(express.urlencoded({extended:false,limit:'16kb'}));
  app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'public/login.html')));
  app.get('/register',(req,res)=>res.sendFile(path.join(__dirname,'public/register.html')));
  app.post('/login',guard((req,res)=>{
    rateLimit(req);const b=req.body||{},row=db.prepare('SELECT * FROM users WHERE login=?').get(String(b.login||'').trim());
    if(!row||!row.active||!passwordMatches(String(b.password||''),row.password_hash))fail('Неверный логин или пароль',401);
    issueSession(req,res,row.id);res.json({ok:true,user:userView(row)});
  }));
  app.post('/register',guard((req,res)=>{
    rateLimit(req);const b=req.body||{},u=userInput(b);let id;
    transaction(db,()=>{
      const invite=db.prepare('SELECT * FROM invitations WHERE code=? AND active=1 AND used_at IS NULL').get(String(b.code||'').trim());
      if(!invite)fail('Код недействителен или уже использован');
      if(db.prepare('SELECT id FROM users WHERE login=?').get(u.login))fail('Этот логин уже занят');
      id=Number(db.prepare('INSERT INTO users(name,login,password_hash) VALUES(?,?,?)').run(u.name,u.login,passwordHash(u.password)).lastInsertRowid);
      db.prepare('UPDATE invitations SET used_at=CURRENT_TIMESTAMP,used_by=?,used_name=? WHERE id=?').run(id,u.name,invite.id);
    });issueSession(req,res,id);res.status(201).json({ok:true});
  }));
  app.post('/logout',(req,res)=>{db.prepare('DELETE FROM user_sessions WHERE token_hash=?').run(hash(tokenFrom(req)));res.setHeader('Set-Cookie','sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');res.redirect('/login')});
  app.get('/logout',(req,res)=>res.send('<form method="post"><button>Выйти из аккаунта</button></form>'));
  app.use((req,res,next)=>{
    if(/^\/kp\//.test(req.path)||/^\/public-photo\//.test(req.path)||['/login','/register','/login.html','/register.html','/catalog.html','/api/public-prices','/account.css','/auth.js'].includes(req.path))return next();
    if(!req.user){if(req.path.startsWith('/api/'))return res.status(401).json({error:'Требуется вход в аккаунт'});return res.redirect('/login')}
    res.setHeader('Cache-Control','no-store');
    if(req.path.startsWith('/api/')&&!['GET','HEAD'].includes(req.method)&&req.get('X-Requested-With')!=='calculator')return res.status(403).json({error:'Необходим заголовок приложения'});
    next();
  });
  app.get('/api/me',(req,res)=>res.json({user:req.user,permissions:PERMISSIONS,defaults:DEFAULTS}));
  app.get('/api/users',guard((req,res)=>{if(!can(req.user,'manage_users')&&!can(req.user,'manage_permissions'))fail('Нет доступа к пользователям',403);res.json(db.prepare('SELECT * FROM users ORDER BY id').all().map(userView))}));
  app.post('/api/users',guard((req,res)=>{
    requirePermission(req,'manage_users');const b=req.body||{},u=userInput(b),role=b.role==='admin'?'admin':'manager';
    if(role==='admin'&&req.user.role!=='admin')fail('Назначить администратора может только главный администратор',403);
    if(role==='admin')fail('Сначала создайте пользователя как менеджера, затем передайте ему роль главного администратора');
    if(db.prepare('SELECT id FROM users WHERE login=?').get(u.login))fail('Этот логин уже занят');
    const id=Number(db.prepare('INSERT INTO users(name,login,password_hash,role,active) VALUES(?,?,?,?,?)').run(u.name,u.login,passwordHash(u.password),role,b.active===false?0:1).lastInsertRowid);
    res.status(201).json({id});
  }));
  function protectedUser(req){const row=db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));if(!row)fail('Пользователь не найден',404);if(row.role==='admin'&&req.user.role!=='admin')fail('Только главный администратор может управлять администраторами',403);return row}
  function keepAdmin(row,role,active){if(row.role==='admin'&&row.active&&(role!=='admin'||!active)&&db.prepare("SELECT count(*) n FROM users WHERE role='admin' AND active=1").get().n<=1)fail('Нельзя отключить последнего главного администратора')}
  app.put('/api/users/:id',guard((req,res)=>{
    requirePermission(req,'manage_users');const row=protectedUser(req),b=req.body||{},u=userInput(b,row),role=b.role??row.role,active=b.active===undefined?row.active:Number(!!b.active);
    if(!['admin','manager'].includes(role))fail('Неверная роль');if(role!==row.role&&req.user.role!=='admin')fail('Роли меняет главный администратор',403);
    if(row.id===req.user.id&&row.role==='admin'&&(role!=='admin'||!active))fail('Нельзя снять с себя роль или заблокировать свой аккаунт. Передайте роль главного администратора другому пользователю.');
    const transfer=role==='admin'&&row.role!=='admin';
    if(transfer&&!b.confirm_transfer)fail('Подтвердите передачу роли главного администратора');
    if(transfer&&!active)fail('Главный администратор должен быть активен');
    keepAdmin(row,role,active);
    if(db.prepare('SELECT id FROM users WHERE login=? AND id<>?').get(u.login,row.id))fail('Этот логин уже занят');
    transaction(db,()=>{if(transfer)db.prepare("UPDATE users SET role='manager' WHERE role='admin' AND id<>?").run(row.id);db.prepare('UPDATE users SET name=?,login=?,password_hash=?,role=?,active=? WHERE id=?').run(u.name,u.login,u.password?passwordHash(u.password):row.password_hash,role,active,row.id)});
    revoke(row.id);res.json({ok:true});
  }));
  app.put('/api/users/:id/permissions',guard((req,res)=>{
    requirePermission(req,'manage_permissions');const row=protectedUser(req);if(row.role==='admin')fail('Главный администратор всегда имеет полный доступ');
    const input=req.body?.permissions;if(!input||typeof input!=='object')fail('Укажите права');const perms={};
    for(const key of Object.keys(PERMISSIONS)){perms[key]=input[key]===true;if(perms[key]&&!can(req.user,key))fail('Нельзя выдать право, которого у вас нет',403)}
    db.prepare('UPDATE users SET permissions_json=? WHERE id=?').run(JSON.stringify(perms),row.id);revoke(row.id);res.json({ok:true});
  }));
  app.delete('/api/users/:id',guard((req,res)=>{requirePermission(req,'manage_users');const row=protectedUser(req);if(row.id===req.user.id)fail('Нельзя удалить свой аккаунт');keepAdmin(row,'manager',false);db.prepare('DELETE FROM users WHERE id=?').run(row.id);res.json({ok:true})}));
  app.get('/api/invitations',guard((req,res)=>{requirePermission(req,'manage_invites');res.json(db.prepare('SELECT * FROM invitations ORDER BY id DESC').all())}));
  app.post('/api/invitations',guard((req,res)=>{requirePermission(req,'manage_invites');const code=crypto.randomBytes(12).toString('hex').toUpperCase();db.prepare('INSERT INTO invitations(code) VALUES(?)').run(code);res.status(201).json({code})}));
  app.put('/api/invitations/:id',guard((req,res)=>{requirePermission(req,'manage_invites');const x=db.prepare('UPDATE invitations SET active=? WHERE id=?').run(req.body?.active?1:0,Number(req.params.id));if(!x.changes)fail('Код не найден',404);res.json({ok:true})}));
  app.delete('/api/invitations/:id',guard((req,res)=>{requirePermission(req,'manage_invites');db.prepare('DELETE FROM invitations WHERE id=?').run(Number(req.params.id));res.json({ok:true})}));
  function installation(item){if(!item)return null;const model=item.group||item.group_name||String(item.name).split(' · ')[0];return db.prepare('SELECT price FROM installation_rates WHERE model=? COLLATE NOCASE').get(model)?.price??null}
  function catalogue(req){const photo=can(req.user,'view_photos'),prices=can(req.user,'view_prices');return getPrices().map(s=>({...s,items:s.items.map(i=>{const extra=db.prepare('SELECT photo_id FROM price_items WHERE id=?').get(i.id);return {...i,price:prices?i.price:null,installation_price:prices?installation(i):null,photo_id:photo?extra?.photo_id:null}})}))}
  function publicCatalogue(){return getPrices().map(s=>({id:s.id,name:s.name,items:s.items.map(i=>{const extra=db.prepare('SELECT photo_id FROM price_items WHERE id=?').get(i.id);return {id:i.id,name:i.name,unit:i.unit,price:i.price,installation_price:installation(i),photo_id:extra?.photo_id||null}})}))}
  app.get('/api/public-prices',guard((req,res)=>{res.setHeader('Cache-Control','public, max-age=60, stale-while-revalidate=300');res.json(publicCatalogue())}));
  app.get('/api/prices',guard((req,res)=>{if(!['view_calculator','view_quick','view_catalog','manage_quick','add_items','edit_items','edit_prices','manage_photos'].some(k=>can(req.user,k)))fail('Нет доступа к прайсу',403);res.json(catalogue(req))}));
  app.put('/api/installation-rates',guard((req,res)=>{requirePermission(req,'edit_prices');const {model,price}=req.body||{};if(!db.prepare('SELECT 1 FROM installation_rates WHERE model=?').get(model)||!Number.isFinite(price)||price<0)fail('Некорректная стоимость установки');db.prepare('UPDATE installation_rates SET price=? WHERE model=?').run(price,model);res.json({ok:true})}));
  app.post('/api/prices/:id/photo',express.raw({type:['image/png','image/jpeg','image/webp'],limit:'5mb'}),guard((req,res)=>{
    requirePermission(req,'manage_photos');const id=Number(req.params.id);if(!db.prepare('SELECT 1 FROM price_items WHERE id=?').get(id))fail('Позиция не найдена',404);
    const b=req.body;if(!Buffer.isBuffer(b)||b.length<12)fail('Загрузите PNG, JPEG или WebP до 5 МБ');
    let mime,ext;if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime='image/png';ext='png'}else if(b[0]===255&&b[1]===216&&b[2]===255){mime='image/jpeg';ext='jpg'}else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){mime='image/webp';ext='webp'}else fail('Неподдерживаемый формат изображения');
    const photoId=crypto.randomBytes(24).toString('hex'),filename=photoId+'.'+ext;
    fs.writeFileSync(path.join(photoDir,filename),b,{flag:'wx'});
    transaction(db,()=>{db.prepare('INSERT INTO photos(id,filename,mime) VALUES(?,?,?)').run(photoId,filename,mime);db.prepare('UPDATE price_items SET photo_id=? WHERE id=?').run(photoId,id)});
    res.status(201).json({photo_id:photoId});
  }));
  app.delete('/api/prices/:id/photo',guard((req,res)=>{requirePermission(req,'manage_photos');db.prepare('UPDATE price_items SET photo_id=NULL WHERE id=?').run(Number(req.params.id));res.json({ok:true})}));
  function sendPhoto(res,id,isPublic=false){const p=db.prepare('SELECT * FROM photos WHERE id=?').get(id);if(!p)fail('Фото не найдено',404);res.type(p.mime);res.setHeader('Cache-Control',isPublic?'public, max-age=3600':'private, max-age=3600');res.sendFile(path.resolve(photoDir,p.filename))}
  app.get('/public-photo/:id',guard((req,res)=>sendPhoto(res,req.params.id,true)));
  app.get('/api/photos/:id',guard((req,res)=>{requirePermission(req,'view_photos');sendPhoto(res,req.params.id)}));
  function customOptions(value){try{const rows=JSON.parse(value||'[]');return Array.isArray(rows)?rows:[]}catch{return []}}
  function settings(){return db.prepare('SELECT * FROM quick_settings WHERE enabled=1 ORDER BY sort_order,id').all().map(row=>{const result={...row,custom_options:customOptions(row.custom_options_json)};delete result.custom_options_json;return result})}
  function renumber(){settings().forEach((r,i)=>db.prepare('UPDATE quick_settings SET sort_order=? WHERE id=?').run(i,r.id))}
  app.get('/api/quick-settings',guard((req,res)=>{if(!can(req.user,'view_quick')&&!can(req.user,'manage_quick'))fail('Нет доступа к быстрому расчёту',403);res.json(settings())}));
  function settingValues(b){const name=String(b.name||'').trim();if(!name||/^(площадь|периметр) помещения/i.test(name))fail('Укажите название строки работ');const item=b.price_item_id?Number(b.price_item_id):null,section=b.section_id?Number(b.section_id):null,source=b.price_source==='manual'?'manual':'catalog';if(item&&!db.prepare('SELECT 1 FROM price_items WHERE id=?').get(item))fail('Позиция не найдена');if(section&&!db.prepare('SELECT 1 FROM price_sections WHERE id=?').get(section))fail('Категория не найдена');if(item&&section&&!db.prepare('SELECT 1 FROM price_items WHERE id=? AND section_id=?').get(item,section))fail('Позиция не входит в выбранную категорию');const raw=Array.isArray(b.custom_options)?b.custom_options:customOptions(b.custom_options_json);if(raw.length>50)fail('В одной строке можно добавить не более 50 своих позиций');const used=new Set(),options=raw.map(x=>{const optionName=String(x?.name||'').trim(),unit=String(x?.unit||'шт').trim()||'шт',price=Number(x?.price),id=/^[a-zA-Z0-9_-]{1,80}$/.test(String(x?.id||''))?String(x.id):crypto.randomUUID();if(!optionName||optionName.length>160)fail('Укажите название своей позиции до 160 символов');if(unit.length>40)fail('Единица измерения слишком длинная');if(!Number.isFinite(price)||price<0||price>1e9)fail('Некорректная цена своей позиции');if(used.has(id))fail('Повторяющийся идентификатор своей позиции');used.add(id);return {id,name:optionName,unit,price}});return {name,item,section,source,options,group:['canvas','products'].includes(b.calc_group)?b.calc_group:'services'}}
  app.post('/api/quick-settings',guard((req,res)=>{requirePermission(req,'manage_quick');const v=settingValues(req.body||{});const id=transaction(db,()=>{const id=Number(db.prepare('INSERT INTO quick_settings(name,calc_group,sort_order,price_item_id,section_id,price_source,custom_options_json) VALUES(?,?,?,?,?,?,?)').run(v.name,v.group,settings().length,v.item,v.section,v.source,JSON.stringify(v.options)).lastInsertRowid);renumber();return id});res.status(201).json({id,rows:settings()})}));
  app.put('/api/quick-settings/:id',guard((req,res)=>{requirePermission(req,'manage_quick');const id=Number(req.params.id),old=db.prepare('SELECT * FROM quick_settings WHERE id=?').get(id);if(!old)fail('Строка не найдена',404);const v=settingValues({...old,...req.body});transaction(db,()=>{db.prepare('UPDATE quick_settings SET name=?,calc_group=?,price_item_id=?,section_id=?,price_source=?,custom_options_json=? WHERE id=?').run(v.name,v.group,v.item,v.section,v.source,JSON.stringify(v.options),id);const rows=settings(),from=rows.findIndex(r=>r.id===id),to=Math.max(0,Math.min(rows.length-1,Math.round(Number(req.body.sort_order??from))||0));rows.splice(to,0,rows.splice(from,1)[0]);rows.forEach((r,i)=>db.prepare('UPDATE quick_settings SET sort_order=? WHERE id=?').run(i,r.id))});res.json({rows:settings()})}));
  app.delete('/api/quick-settings/:id',guard((req,res)=>{requirePermission(req,'manage_quick');transaction(db,()=>{db.prepare('DELETE FROM quick_settings WHERE id=?').run(Number(req.params.id));renumber()});res.json({rows:settings()})}));
  // Attach the existing default rows to catalogue choices without changing catalogue prices.
  if(!db.prepare('SELECT 1 FROM feature_migrations WHERE name=?').get('quick-catalog-v1'))transaction(db,()=>{
    const defaults={'Углы':'Обработка угла','Монтаж светильников':'Монтаж освещения','Люстры':'Монтаж освещения','Керамогранит':'Монтаж по кафель/керамогранит','Кафель / керамогранит':'Монтаж по кафель/керамогранит'};
    for(const row of settings()){const section=db.prepare('SELECT id FROM price_sections WHERE name=?').get(defaults[row.name]||row.name);if(section)db.prepare('UPDATE quick_settings SET section_id=? WHERE id=?').run(section.id,row.id)}
    db.prepare('INSERT INTO feature_migrations VALUES(?)').run('quick-catalog-v1');
  });
  if(!db.prepare('SELECT 1 FROM feature_migrations WHERE name=?').get('quick-labels-v2'))transaction(db,()=>{db.prepare("UPDATE quick_settings SET name='Кафель / керамогранит' WHERE name='Керамогранит'").run();db.prepare('INSERT INTO feature_migrations VALUES(?)').run('quick-labels-v2')});
  function visible(req,c){return req.user?.role==='admin'||c.owner_id===req.user?.id||can(req.user,'view_others')}
  function owned(req,id,editing=false){const c=getCalc(Number(id));if(!c||!visible(req,c))fail('Расчёт не найден',404);if(editing)requirePermission(req,c.owner_id===req.user.id?'edit_own':'edit_others');return c}
  function calcUrl(req,c){return publicKpUrl(req,c.id)+(c.public_token?'?t='+c.public_token:'')}
  function publicAllowed(req,c){return !!c&&!!c.published&&(!c.public_token||(typeof req.query.t==='string'&&req.query.t===c.public_token))}
  function quoteLinks(req,c){
    const result={id:c.id,published:c.published};
    if(can(req.user,'view_prices'))result.preview_url=`/calculations/${c.id}/preview`;
    if(can(req.user,'publish_kp')){
      if(c.published)result.url=calcUrl(req,c);
      else result.can_publish=c.owner_id===req.user.id||can(req.user,'edit_others');
    }
    return result;
  }
  function responseCalc(req,c){const data={...c,items:c.items.map(x=>({...x})),discount:c.discount};delete data.items_json;delete data.discount_json;delete data.public_token;
    if(!can(req.user,'view_prices')){for(const key of ['subtotal','discount_amount','total'])delete data[key];data.items.forEach(x=>{delete x.price;delete x.installation_rate})}
    if(!can(req.user,'view_photos'))data.items.forEach(x=>{delete x.photo_id;delete x.include_photo});
    return {...data,...quoteLinks(req,c)};
  }
  function calculate(req,old=null){
    const b=req.body||{},quick=b.calculation_type==='quick';requirePermission(req,quick?'view_quick':'view_calculator');
    if(!old)requirePermission(req,quick?'create_quick':'create_calculations');
    if(!Array.isArray(b.items)||b.items.length>500)fail('В расчёте должно быть не более 500 позиций');
    const previous=old?.items||[];
    const items=b.items.filter(x=>Number(x.qty)>0).map(x=>{
      const prior=previous.find(p=>String(p.id)===String(x.id)&&p.price_item_id===x.price_item_id);
      const record=x.price_item_id?db.prepare('SELECT i.*,s.name section,s.calc_group FROM price_items i JOIN price_sections s ON s.id=i.section_id WHERE i.id=?').get(Number(x.price_item_id)):null;
      const standard=x.settingId?db.prepare('SELECT * FROM quick_settings WHERE id=? AND enabled=1').get(Number(x.settingId)):null;
      const option=standard&&x.quick_option_id?customOptions(standard.custom_options_json).find(o=>String(o.id)===String(x.quick_option_id)):null;
      if(x.quick_option_id&&!option&&!prior)fail('Своя позиция быстрого расчёта не найдена');
      if(!record&&!prior&&!standard)requirePermission(req,'add_oneoff');
      if(!record&&x.price_item_id&&!prior)fail('Позиция удалена из прайса; выберите другую');
      const qty=Number(x.qty),fallbackPrice=prior?.price??record?.price??option?.price??0,price=!can(req.user,'view_prices')||x.price===null||x.price===undefined?fallbackPrice:Number(x.price);
      if(!Number.isFinite(qty)||qty<0||qty>1e7||!Number.isFinite(price)||price<0||price>1e9)fail('Некорректные количество или цена');
      if(!can(req.user,'edit_quantity')&&qty!==(prior?.qty??1))fail('Нет права изменять количество',403);
      const auto=(prior?.name||record?.name||x.name)==='Установка полотна';
      const basePrice=prior?.price??record?.price;
      if(!auto&&record&&price!==basePrice&&!can(req.user,'edit_prices'))fail('Нет права изменять цену позиции',403);
      if(auto&&prior&&x.installation_manual&&price!==prior.price&&!can(req.user,'edit_install_price'))fail('Нет права изменять цену установки',403);
      let include=!!x.include_photo,photoId=null;
      if(!can(req.user,'view_photos')){if(include&&!prior?.include_photo)fail('Нет доступа к фотографиям',403);include=!!prior?.include_photo;photoId=prior?.photo_id||null}
      else if(include){const requested=String(x.photo_id||'');if(requested&&requested!==record?.photo_id&&requested!==prior?.photo_id)fail('Недопустимая версия фото');photoId=requested||prior?.photo_id||record?.photo_id;if(!photoId||!db.prepare('SELECT 1 FROM photos WHERE id=?').get(photoId))fail('У позиции нет фотографии')}
      if(quick&&!prior&&!standard&&!auto)requirePermission(req,'add_oneoff');
      if(!prior&&standard&&standard.price_item_id&&(!record||record.id!==standard.price_item_id))fail('Выберите закреплённую позицию из настроенной строки');
      if(!prior&&standard&&record&&standard.section_id&&record.section_id!==standard.section_id)fail('Позиция не входит в настроенную категорию');
      const genericName=option?.name||standard?.name||x.name||prior?.name||'Позиция',genericUnit=option?.unit||x.unit||prior?.unit||'шт';
      return {id:x.id||crypto.randomUUID(),price_item_id:record?.id??prior?.price_item_id??null,quick_option_id:option?.id??prior?.quick_option_id??null,name:prior?.name||record?.name||String(genericName).slice(0,300),unit:prior?.unit||record?.unit||String(genericUnit).slice(0,40),section:prior?.section||record?.section||String(x.section||'Услуги и материалы'),calc_group:prior?.calc_group||record?.calc_group||standard?.calc_group||x.calc_group,qty,price,source:quick?'quick':'price',settingId:standard?.id||prior?.settingId||null,include_photo:include,photo_id:include?photoId:null,installation_manual:!!x.installation_manual,installation_rate:prior?.installation_rate??installation(record)};
    });
    const canvases=items.filter(x=>x.calc_group==='canvas');
    if(canvases.length){
      if(canvases.some(x=>x.installation_rate==null))fail('Для выбранного полотна не настроена стоимость установки');
      const installationTotal=canvases.reduce((sum,x)=>sum+x.qty*x.installation_rate,0);
      const auto=items.filter(x=>x.name==='Установка полотна');if(auto.length>1)fail('В расчёте должна быть одна строка установки полотна');
      if(!auto.length){const base=db.prepare("SELECT i.*,s.name section FROM price_items i JOIN price_sections s ON s.id=i.section_id WHERE i.name='Установка полотна' LIMIT 1").get();items.push({id:crypto.randomUUID(),price_item_id:base.id,quick_option_id:null,name:base.name,unit:base.unit,section:base.section,calc_group:'services',qty:1,price:installationTotal,source:quick?'quick':'price',settingId:null,include_photo:false,photo_id:null,installation_manual:false,installation_rate:null})}
      else if(auto[0].installation_manual){if(!can(req.user,'edit_install_price')&&!previous.some(x=>x.name==='Установка полотна'&&x.installation_manual&&x.price===auto[0].price))fail('Нет права изменять цену установки',403)}
      else auto[0].price=installationTotal;
    }
    if(!items.length)fail('Добавьте хотя бы одну позицию');
    if(!can(req.user,'edit_discount')){
      const requested=normalize({...b,items}).discount,baseline=normalize({discount:old?.discount||{},items}).discount;
      if(JSON.stringify(requested)!==JSON.stringify(baseline))fail('Нет права изменять скидку',403);
    }
    return normalize({...b,items});
  }
  app.get('/api/calculations',guard((req,res)=>{
    requirePermission(req,'view_history');const q=String(req.query.q||'').trim(),rows=db.prepare('SELECT * FROM calculations ORDER BY id DESC').all().filter(c=>visible(req,c)).filter(c=>!q||[c.id,c.client_name,c.phone,c.address,c.manager].some(v=>String(v).toLocaleLowerCase().includes(q.toLocaleLowerCase()))).slice(0,500);
    res.json(rows.map(c=>{const r={...c};delete r.items_json;delete r.discount_json;delete r.public_token;if(!can(req.user,'view_prices')){delete r.total;delete r.subtotal;delete r.discount_amount}return r}));
  }));
  app.get('/api/calculations/:id',guard((req,res)=>{requirePermission(req,'view_history');res.json(responseCalc(req,owned(req,req.params.id)))}));
  function save(req,p,id=null,publish=false){
    const values=[p.client_name,p.phone,p.address,p.manager,p.notes,p.area,p.room_perimeter,p.calculation_type,JSON.stringify(p.items),JSON.stringify(p.discount),p.subtotal,p.discount_amount,p.total];
    if(id){
      return db.prepare(`UPDATE calculations SET client_name=?,phone=?,address=?,manager=?,notes=?,area=?,room_perimeter=?,
        calculation_type=?,items_json=?,discount_json=?,subtotal=?,discount_amount=?,total=?,
        published=CASE WHEN ? THEN 1 ELSE published END,updated_at=datetime('now','localtime')
        WHERE id=? RETURNING id,owner_id,published,public_token`).get(...values,Number(publish),id);
    }
    return db.prepare(`INSERT INTO calculations(client_name,phone,address,manager,notes,area,room_perimeter,calculation_type,
      items_json,discount_json,subtotal,discount_amount,total,owner_id,published,public_token)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id,owner_id,published,public_token`).get(...values,req.user.id,Number(publish),crypto.randomBytes(24).toString('hex'));
  }
  function saveCalculation(req,res,current=null){
    const publish=req.body?.publish===true;
    if(publish)requirePermission(req,'publish_kp');
    const saved=save(req,calculate(req,current),current?.id,publish);
    res.status(current?200:201).json(quoteLinks(req,saved));
  }
  app.post('/api/calculations',guard((req,res)=>saveCalculation(req,res)));
  app.put('/api/calculations/:id',guard((req,res)=>saveCalculation(req,res,owned(req,req.params.id,true))));
  app.post('/api/calculations/:id/duplicate',guard((req,res)=>{
    requirePermission(req,'view_history');
    const c=owned(req,req.params.id);
    requirePermission(req,c.calculation_type==='quick'?'create_quick':'create_calculations');
    let copy=c;
    if(req.body?.items!==undefined){
      requirePermission(req,'edit_own');
      if(req.body.calculation_type!==c.calculation_type)fail('Тип расчёта при дублировании должен совпадать');
      copy=calculate(req,c);
    }
    res.status(201).json({...quoteLinks(req,save(req,copy)),source_id:c.id});
  }));
  app.post('/api/calculations/:id/publish',guard((req,res)=>{requirePermission(req,'publish_kp');const c=owned(req,req.params.id);if(c.owner_id!==req.user.id)requirePermission(req,'edit_others');db.prepare('UPDATE calculations SET published=1 WHERE id=?').run(c.id);res.json(quoteLinks(req,{...c,published:1}))}));
  app.delete('/api/calculations/:id',guard((req,res)=>{const c=owned(req,req.params.id,true);db.prepare('DELETE FROM calculations WHERE id=?').run(c.id);res.json({ok:true})}));
  app.get('/calculations/:id/preview',guard((req,res)=>{
    const c=owned(req,req.params.id);
    requirePermission(req,'view_prices');
    const photoUrl=can(req.user,'view_photos')?id=>'/api/photos/'+encodeURIComponent(id):()=>null;
    res.send(cpHtml(c,{photoUrl}));
  }));
  app.get('/kp/:id/photo/:photo',guard((req,res)=>{const c=getCalc(Number(req.params.id));if(!publicAllowed(req,c))fail('КП не найдено',404);if(!c.items.some(x=>x.include_photo&&x.photo_id===req.params.photo))fail('Фото не включено в КП',404);sendPhoto(res,req.params.photo)}));
  app.get('/kp/:id',guard((req,res)=>{const c=getCalc(Number(req.params.id));if(!publicAllowed(req,c))return res.status(404).send('КП не найдено');res.setHeader('Cache-Control','no-store');res.send(cpHtml(c))}));
  // Central server-side guards also cover the original catalogue editing endpoints.
  app.use(guard((req,res,next)=>{
    let p;try{p=decodeURIComponent(req.path).replace(/\/+$/,'')||'/'}catch{fail('Некорректный адрес')};const m=req.method;
    if(p==='/prices.html'&&!['add_items','edit_items','edit_prices','delete_items','manage_photos'].some(k=>can(req.user,k)))fail('Нет доступа к управлению прайсом',403);
    if(p==='/quick-settings.html')requirePermission(req,'manage_quick');
    if(p==='/users.html'&&!can(req.user,'manage_users')&&!can(req.user,'manage_permissions'))fail('Нет доступа к пользователям',403);
    if(p==='/invitations.html')requirePermission(req,'manage_invites');
    if(['/', '/index.html'].includes(p)&&!['view_calculator','view_quick','view_history'].some(k=>can(req.user,k)))return res.redirect('/account.html');
    if(/^\/api\/(prices|price-sections)(\/[^/]+)?$/i.test(p)&&m!=='GET'){
      const pricesRoute=/^\/api\/prices/i.test(p);
      if(m==='PUT'&&pricesRoute){if(!can(req.user,'edit_items')&&!can(req.user,'edit_prices'))fail('Нет права редактировать прайс',403)}else requirePermission(req,m==='POST'?'add_items':m==='DELETE'?'delete_items':'edit_items');
      if(p.startsWith('/api/prices')&&['PUT','POST'].includes(m)){
        const old=m==='PUT'?db.prepare('SELECT * FROM price_items WHERE id=?').get(Number(p.split('/').pop())):null;
        if(old&&!can(req.user,'edit_items'))for(const key of ['name','unit','section_id','sort_order','group_name','group_order']){if(req.body[key]!==undefined&&String(req.body[key]??'')!==String(old[key]??''))fail('Нет права изменять данные позиции',403)}
        if(old&&(req.body.price===undefined||req.body.price===null)&&!can(req.user,'view_prices'))req.body.price=old.price;
        if(!can(req.user,'edit_prices')){if(m==='POST'&&req.body.price!=null&&req.body.price!=='')fail('Нет права задавать цену',403);if(old&&req.body.price!=null&&Number(req.body.price)!==old.price)fail('Нет права изменять цену',403);if(old)req.body.price=old.price}
      }
    }
    next();
  }));
  return {can,installation};
}
module.exports={setup,PERMISSIONS,DEFAULTS};
