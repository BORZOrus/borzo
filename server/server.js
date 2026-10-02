/* BORZO-пульт — бэкенд: касса, логины, роли. Node/Express + PostgreSQL. */
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const crm = require('./crm');
const wa = require('./wa');
if(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE){
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@borzopult.com', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET || JWT_SECRET.length<16){ console.error('FATAL: JWT_SECRET не задан или слишком короткий — старт запрещён'); process.exit(1); }
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/var/www/borzo/uploads';

const pool = new Pool(); // конфиг из env PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT

const app = express();
app.use(express.json({ limit: '15mb' })); // фото приходят base64

// ---------- схема ----------
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      login TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kassa_tx (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ts BIGINT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      source TEXT,
      status TEXT,
      category TEXT,
      items JSONB,
      invoice TEXT,
      receipt TEXT,
      pending JSONB,
      log JSONB NOT NULL DEFAULT '[]',
      created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS sklad_intake (
      id SERIAL PRIMARY KEY,
      ts BIGINT, date TEXT, name TEXT, qty TEXT, unit TEXT, price TEXT,
      sum NUMERIC, category TEXT, tx_id TEXT
    );
    CREATE TABLE IF NOT EXISTS fin_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{}',
      rev INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER,
      updated_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY,
      user_id INTEGER,
      role TEXT,
      sub JSONB NOT NULL
    );
    -- счета на закуп: снабженец/Руслан выставляет → Ульяна/Руслан жмёт «Оплатил» → закуп проводится напрямую (без гоняния денег снабженцу)
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      ts BIGINT NOT NULL,
      created_by INTEGER,
      created_role TEXT,
      to_whom TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      category TEXT,
      items JSONB,
      invoice TEXT,
      inv_no TEXT DEFAULT '',
      doc_date TEXT DEFAULT '',
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'wait',
      paid_by INTEGER,
      paid_ts BIGINT,
      kassa_tx_id TEXT
    );
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS sig TEXT;
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS dup BOOLEAN DEFAULT false;
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS inv_no TEXT DEFAULT '';
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS rec_no TEXT DEFAULT '';
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS doc_date TEXT DEFAULT '';
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS req_id TEXT;
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS review TEXT DEFAULT '';
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS review_note TEXT DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS kassa_tx_req_id_uidx ON kassa_tx(req_id) WHERE req_id IS NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_ver INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS bill_id TEXT;
  `);
  await crm.initSchema(pool);
  await wa.initSchema(pool);
}
// подпись накладной (для защиты от дублей): позиции+сумма+категория, устойчива к перезаливке того же
function sigOf(items, amount, category){
  const norm = (items||[]).map(i=>({n:String(i.name||'').trim().toLowerCase(), q:numf(i.qty), p:numf(i.price)}))
    .sort((a,b)=> a.n<b.n?-1:(a.n>b.n?1:0));
  const s = norm.map(i=>i.n+'|'+i.q+'|'+i.p).join(';')+'#'+money(amount)+'#'+(category||'');
  return crypto.createHash('md5').update(s).digest('hex');
}

// ---------- push-уведомления ----------
async function sendPushToRole(role, payload){
  if(!process.env.VAPID_PUBLIC) return;
  const r = await pool.query('SELECT endpoint, sub FROM push_subs WHERE role=$1',[role]);
  for(const row of r.rows){
    try { await webpush.sendNotification(row.sub, JSON.stringify(payload)); }
    catch(e){ if(e.statusCode===404||e.statusCode===410||e.statusCode===403){ await pool.query('DELETE FROM push_subs WHERE endpoint=$1',[row.endpoint]); } }
  }
}

// ---------- утилиты ----------
function money(n){ return Math.round(+n||0); }
// касса снабженца = выдано и принято − потрачено СНАБЖЕНЦЕМ. Закупы руководителя (его деньги/общая касса) подотчёт не уменьшают.
async function balance(db) {
  const q = db||pool;
  const r = await q.query(`
    SELECT COALESCE(SUM(CASE WHEN k.kind='issue' AND k.status='accepted' THEN k.amount
                             WHEN k.kind='expense' AND u.role='sup' THEN -k.amount ELSE 0 END),0) AS b
    FROM kassa_tx k LEFT JOIN users u ON u.id=k.created_by`);
  return money(r.rows[0].b);
}
function numf(v){ return parseFloat(String(v==null?'':v).replace(',','.'))||0; }  // 25,2 → 25.2
function rowSum(i){ return Math.round(numf(i.qty)*numf(i.price)); }  // сумма позиции — до целого тенге
function savePhoto(dataUrl){
  if(!dataUrl || typeof dataUrl!=='string' || dataUrl.indexOf('data:')!==0) return null;
  // фото (image/*) или документ (application/pdf) — например чек/накладная из Kaspi
  const m = dataUrl.match(/^data:(image\/\w+|application\/pdf);base64,(.+)$/);
  if(!m) return null;
  const ext = m[1]==='application/pdf' ? 'pdf' : m[1].split('/')[1].replace('jpeg','jpg');
  const name = crypto.randomUUID()+'.'+ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2],'base64'));
  return '/uploads/'+name;
}
// дифф было→стало (для журнала)
function itemStr(i){ const p=i.price?(' × '+money(i.price)+'₸'):''; return (i.name||'—')+': '+(i.qty||'?')+' '+(i.unit||'')+p+' ('+(i.cat||'')+')'; }
function genericDiff(tx, next){
  const d=[];
  if('amount' in next && money(next.amount)!==money(tx.amount)) d.push({label:'Сумма', from:money(tx.amount)+' ₸', to:money(next.amount)+' ₸'});
  if('source' in next && next.source!==tx.source) d.push({label:'Источник', from:tx.source, to:next.source});
  if('category' in next && next.category!==tx.category) d.push({label:'Осн. категория', from:tx.category, to:next.category});
  if('items' in next){
    const a=tx.items||[], b=next.items||[], n=Math.max(a.length,b.length);
    for(let k=0;k<n;k++){
      if(!a[k]) d.push({label:'Добавлена позиция', from:'—', to:itemStr(b[k])});
      else if(!b[k]) d.push({label:'Удалена позиция', from:itemStr(a[k]), to:'—'});
      else if(itemStr(a[k])!==itemStr(b[k])) d.push({label:'Позиция', from:itemStr(a[k]), to:itemStr(b[k])});
    }
  }
  return d;
}

// ---------- auth ----------
function sign(u){ return jwt.sign({ id:u.id, role:u.role, name:u.name, login:u.login, tv:u.token_ver||0 }, JWT_SECRET, { expiresIn:'30d' }); }
async function auth(req,res,next){
  const h = req.headers.authorization||'';
  const t = h.indexOf('Bearer ')===0 ? h.slice(7) : null;
  if(!t) return res.status(401).json({error:'нет токена'});
  let payload;
  try { payload = jwt.verify(t, JWT_SECRET); }
  catch(e){ return res.status(401).json({error:'токен недействителен'}); }
  try{
    // проверяем актуальность: аккаунт существует, версия сессии совпадает (смена пароля/роли отзывает старые токены)
    const r = await pool.query('SELECT id, role, name, login, token_ver FROM users WHERE id=$1',[payload.id]);
    const u = r.rows[0];
    if(!u) return res.status(401).json({error:'аккаунт не найден — войдите заново'});
    if((payload.tv||0) !== (u.token_ver||0)) return res.status(401).json({error:'сессия завершена — войдите заново'});
    req.user = { id:u.id, role:u.role, name:u.name, login:u.login };  // роль берём из БД, не из токена → смена роли действует сразу
    next();
  }catch(e){ console.error('auth error', e&&e.message); return res.status(500).json({error:'ошибка авторизации'}); }
}
function requireRole(role){ return (req,res,next)=> req.user.role===role ? next() : res.status(403).json({error:'нет прав'}); }
function requireAny(roles){ return (req,res,next)=> roles.indexOf(req.user.role)>=0 ? next() : res.status(403).json({error:'нет прав'}); }

// анти-брутфорс: не больше 8 неудачных попыток за 10 минут на связку логин+IP
const loginFails = new Map();
function loginKey(login,ip){ return String(login||'').toLowerCase().trim()+'|'+ip; }
function tooManyFails(key){ const e=loginFails.get(key); if(!e) return false; if(Date.now()-e.t>600000){ loginFails.delete(key); return false; } return e.n>=8; }
function noteFail(key){ const e=loginFails.get(key); if(!e||Date.now()-e.t>600000) loginFails.set(key,{n:1,t:Date.now()}); else { e.n++; e.t=Date.now(); } }
app.post('/api/auth/login', async (req,res)=>{
  const { login, password } = req.body||{};
  if(!login||!password) return res.status(400).json({error:'укажите логин и пароль'});
  const ip = (req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  const key = loginKey(login,ip);
  if(tooManyFails(key)) return res.status(429).json({error:'слишком много попыток, подождите 10 минут'});
  const r = await pool.query('SELECT * FROM users WHERE login=$1',[String(login).toLowerCase().trim()]);
  const u = r.rows[0];
  if(!u || !bcrypt.compareSync(String(password).trim(), u.pass_hash)){ noteFail(key); return res.status(401).json({error:'неверный логин или пароль'}); }
  loginFails.delete(key);
  res.json({ token: sign(u), user:{ name:u.name, role:u.role, login:u.login } });
});
app.get('/api/me', auth, (req,res)=> res.json({ user:{ id:req.user.id, name:req.user.name, role:req.user.role, login:req.user.login } }));

app.post('/api/auth/password', auth, async (req,res)=>{
  const { old_pass, new_pass } = req.body||{};
  const np = String(new_pass||'').trim();   // тримим так же, как при входе — иначе пароль с пробелами не введёшь
  if(!np || np.length<5) return res.status(400).json({error:'новый пароль — минимум 5 символов'});
  const r = await pool.query('SELECT * FROM users WHERE id=$1',[req.user.id]);
  const u = r.rows[0];
  if(!u || !bcrypt.compareSync(String(old_pass||'').trim(), u.pass_hash)) return res.status(401).json({error:'текущий пароль неверный'});
  // смена пароля отзывает все прежние токены (token_ver++), но текущему устройству выдаём свежий, чтобы не разлогинить
  const upd = await pool.query('UPDATE users SET pass_hash=$1, token_ver=token_ver+1 WHERE id=$2 RETURNING id,role,name,login,token_ver',[bcrypt.hashSync(np,10), u.id]);
  res.json({ ok:true, token: sign(upd.rows[0]) });
});

// ---------- транзакции: всё-или-ничего для денежных операций ----------
const KASSA_LOCK = 4242;  // advisory-замок: сериализует изменения кассы снабжения (проверка баланса ↔ запись)
async function withTx(fn){
  const c = await pool.connect();
  try{ await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch(e){ try{ await c.query('ROLLBACK'); }catch(_){ } throw e; }
  finally{ c.release(); }
}
function httpErr(code, msg){ const e=new Error(msg); e.httpCode=code; return e; }

// ---------- котёл (Финансы) ↔ снабжение: стык без задвоения ----------
// Общий помощник: дописать операцию в fin_state (котёл). db — клиент транзакции (или pool). Блокирует строку FOR UPDATE.
async function bookPot(op, db){
  const q = db||pool;
  const r = await q.query('SELECT data FROM fin_state WHERE id=1 FOR UPDATE');
  if(!r.rowCount){
    // финансовая база ещё не создана — создаём с этой проводкой, чтобы расход не потерялся (аудит #6)
    await q.query("INSERT INTO fin_state(id,data,rev,updated_at) VALUES(1,$1,1,$2) ON CONFLICT (id) DO NOTHING",[JSON.stringify({ops:[op],employees:['Руслан','Ульяна','Азамат','Данияр']}), Date.now()]);
    return true;
  }
  const data = r.rows[0].data || {};
  if(!Array.isArray(data.ops)) return false;
  // идемпотентность: не дублируем по supplyTxId+вид
  if(op.id && data.ops.some(x=>x && x.id===op.id)) return true;
  data.ops.unshift(op);
  await q.query('UPDATE fin_state SET data=$1, rev=rev+1, updated_at=$2 WHERE id=1', [JSON.stringify(data), Date.now()]);
  return true;
}
// первый день ТЕКУЩЕГО месяца по Астане (UTC+5): серверное UTC возле полуночи не должно уводить проводку в чужой месяц
function almatyMonthStart(ts){ const d=new Date((ts==null?Date.now():Number(ts))+5*3600000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), 1).getTime(); }
function monthPerNow(){ return almatyMonthStart(); }
// дата документа не может быть из будущего (сканер иногда распознаёт мусор с накладной)
function docDateClean(v){
  let s = String(v||'').trim().slice(0,10);
  if(s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  if(s){ const today=new Date(Date.now()+5*3600000).toISOString().slice(0,10); if(s>today) return null; }  // null = «в будущем», отклонить
  return s;
}
// снять операцию из котла по id (при удалении/правке закупа руководителя)
async function unbookPot(id, db){
  const q = db||pool;
  const r = await q.query('SELECT data FROM fin_state WHERE id=1 FOR UPDATE');
  if(!r.rowCount) return false;
  const data = r.rows[0].data || {};
  if(!Array.isArray(data.ops)) return false;
  const before = data.ops.length;
  data.ops = data.ops.filter(x=> !(x && x.id===id));
  if(data.ops.length===before) return false;
  await q.query('UPDATE fin_state SET data=$1, rev=rev+1, updated_at=$2 WHERE id=1', [JSON.stringify(data), Date.now()]);
  return true;
}
// снять ВСЕ расходные проводки закупа из котла по supplyTxId (закуп может быть разбит на Сырьё+Операционка — аудит #17)
async function unbookPotTx(kassaId, db){
  const q = db||pool;
  const r = await q.query('SELECT data FROM fin_state WHERE id=1 FOR UPDATE');
  if(!r.rowCount) return false;
  const data = r.rows[0].data || {};
  if(!Array.isArray(data.ops)) return false;
  const before = data.ops.length;
  data.ops = data.ops.filter(x=> !(x && x.supplyExpense===true && x.supplyTxId===kassaId));
  if(data.ops.length===before) return false;
  await q.query('UPDATE fin_state SET data=$1, rev=rev+1, updated_at=$2 WHERE id=1', [JSON.stringify(data), Date.now()]);
  return true;
}
// ЗАКУП → реальный расход из котла в АНАЛИТИКУ, НЕ в ленту (hideFeed). Если переданы позиции — сумма разбивается по их категориям Сырьё/Операционка (аудит #17).
async function bookSupplyExpense(amount, category, note, kassaId, who, db, per, items){
  const P = per||monthPerNow();
  let parts = null;
  if(Array.isArray(items) && items.length){
    const byCat = {};
    items.forEach(i=>{ const c=((i.cat||category)==='Сырьё')?'Сырьё':'Операционка'; byCat[c]=(byCat[c]||0)+(i.sum!=null?money(i.sum):rowSum(i)); });
    parts = Object.keys(byCat).filter(c=>byCat[c]!==0).map(c=>({cat:c, amt:byCat[c]}));
    // выровнять сумму частей к общей сумме закупа (округления/доставка вне позиций) — разницу на первую часть
    const partSum = parts.reduce((s,p)=>s+p.amt,0);
    if(parts.length && partSum!==money(amount)) parts[0].amt += money(amount)-partSum;
  }
  if(!parts || !parts.length) parts = [{cat:(category==='Сырьё')?'Сырьё':'Операционка', amt:money(amount)}];
  let ok = true;
  for(const p of parts){
    const idp = (parts.length>1) ? ('supx_'+kassaId+'_'+(p.cat==='Сырьё'?'s':'o')) : ('supx_'+kassaId);
    const r = await bookPot({ id:idp, ts:Date.now(), per:P, kind:'out', acc:'BORZO', project:'BORZO',
      amount: money(p.amt), category: p.cat, who: who||'snab', note: note||'закуп снабжения', supplyExpense:true, hideFeed:true, supplyTxId:kassaId }, db);
    ok = ok && r;
  }
  return ok;
}
// ЗАРПЛАТА через счёт: Ульяна выплатила сотруднику → операция ложится в котёл как обычная зарплата (salary:{emp,type}), списывается с её отдела (safeTracked, who=ulyana), падает в историю/журнал зарплат как будто её начислил Руслан.
async function bookSalary(amount, who, emp, salType, per, note, kassaId, db){
  const type = salType==='advance' ? 'advance' : 'salary';
  return bookPot({ id:'sal_'+kassaId, ts:Date.now(), per: per||monthPerNow(), kind:'out', acc:'BORZO', project:'BORZO',
    amount: money(amount), category: type==='advance'?'Аванс':'Зарплата', who: who||'ulyana',
    salary:{ emp:emp||'', type:type }, note: note||'', safeTracked:true }, db);
}
// ВЫДАЧА снабженцу → видимая строка в ленте Финансов (Руслан+Ульяна), НЕ расход (котёл не трогает, из аналитики исключена).
async function bookSupplyIssue(amount, kassaId, db){
  return bookPot({ id:'supi_'+kassaId, ts:Date.now(), per:monthPerNow(), kind:'issue', project:'BORZO',
    amount: money(amount), category:'Выдано снабженцу', who:'ruslan', supplyIssue:true, supplyTxId:kassaId }, db);
}

// ---------- касса ----------
app.get('/api/kassa', auth, async (req,res)=>{
  const tx = await pool.query('SELECT k.*, u.role AS by_role FROM kassa_tx k LEFT JOIN users u ON u.id=k.created_by ORDER BY k.ts DESC');
  res.json({ balance: await balance(), tx: tx.rows });
});

// выдача (только руководитель)
app.post('/api/kassa/issue', auth, requireRole('mgr'), async (req,res)=>{
  const amount = money(req.body.amount);
  if(amount<=0) return res.status(400).json({error:'укажите сумму'});
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO kassa_tx(id,kind,ts,amount,source,status,created_by) VALUES($1,'issue',$2,$3,$4,'wait',$5)`,
    [id, Date.now(), amount, req.body.source||'Наличные', req.user.id]);
  res.json({ ok:true, id });
});

// подтвердить получение (снабженец)
app.post('/api/kassa/accept/:id', auth, requireRole('sup'), async (req,res)=>{
  try{
    // атомарно: пометка «принято» и строка в ленте Финансов в ОДНОЙ транзакции — иначе при сбое выдача принята, а в Финансах её нет (рассинхрон касса↔Финансы без самоизлечения)
    await withTx(async (c)=>{
      await c.query('SELECT pg_advisory_xact_lock($1)',[KASSA_LOCK]);
      const r = await c.query(`UPDATE kassa_tx SET status='accepted' WHERE id=$1 AND kind='issue' AND status='wait' RETURNING id, amount`,[req.params.id]);
      if(!r.rowCount) throw httpErr(400,'нечего подтверждать');
      // подтверждённая выдача → видимая строка в ленте Финансов (не расход)
      await bookSupplyIssue(r.rows[0].amount, r.rows[0].id, c);
    });
    res.json({ ok:true });
  }catch(e){
    if(e && e.httpCode) return res.status(e.httpCode).json({error:e.message});
    console.error('accept error', e&&e.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'});
  }
});

// расход (снабженец или руководитель — руководитель закупается сам)
app.post('/api/kassa/expense', auth, requireAny(['sup','mgr']), async (req,res)=>{
  const amount = money(req.body.amount);
  const items = Array.isArray(req.body.items)? req.body.items : [];
  const invoice = savePhoto(req.body.invoice);
  const receipt = savePhoto(req.body.receipt);
  // руководитель может действовать «как снабженец» (режим просмотра): закуп идёт из подотчёта снабженца, по его правилам
  const asSup = req.user.role==='mgr' && req.body.asSup===true;
  const actRole = asSup ? 'sup' : req.user.role;
  let creator = req.user.id;
  if(asSup){ const su = await pool.query("SELECT id FROM users WHERE role='sup' ORDER BY id LIMIT 1"); if(su.rowCount) creator = su.rows[0].id; }
  if(amount<=0) return res.status(400).json({error:'укажите сумму'});
  // документ обязателен снабженцу; руководитель (свой закуп) может без чека/накладной
  if(actRole==='sup' && !invoice && !receipt) return res.status(400).json({error:'нужен документ: накладная или чек'});
  const id = crypto.randomUUID(), now = Date.now();
  const reqId = (String(req.body.reqId||'').trim().slice(0,64)) || null;   // ключ идемпотентности: один клик = одна запись, даже если запрос ушёл дважды
  const norm = v => String(v==null?'':v).replace(',','.');  // 25,2 → 25.2 для склада
  const cleanItems = items.filter(i=>(i.name||'').trim()).map(i=>({name:String(i.name).trim(),qty:norm(i.qty),unit:i.unit||'шт',price:norm(i.price),sum:rowSum(i),cat:i.cat||req.body.category}));
  const invNo = String(req.body.invNo||'').trim().slice(0,40);
  const recNo = String(req.body.recNo||'').trim().slice(0,40);
  let docDate = docDateClean(req.body.docDate);
  if(docDate===null) return res.status(400).json({error:'дата документа из будущего — проверьте распознанную дату'});
  const sig = sigOf(cleanItems, amount, req.body.category);
  const who = actRole==='mgr' ? 'ruslan' : 'snab';
  const names = cleanItems.map(i=>i.name).filter(Boolean).slice(0,3).join(', ');
  const noteTxt = (actRole==='mgr'?'закуп Руслана':'закуп снабженца')+(names?': '+names:'');
  try{
    const out = await withTx(async (c)=>{
      await c.query('SELECT pg_advisory_xact_lock($1)',[KASSA_LOCK]);   // сериализуем: два одновременных закупа не пройдут проверку баланса «мимо друг друга»
      // идемпотентность: этот клик уже проведён? вернуть тот же результат, не списывать повторно
      if(reqId){ const ex = await c.query('SELECT id, dup FROM kassa_tx WHERE req_id=$1',[reqId]); if(ex.rowCount) return { id:ex.rows[0].id, dup:ex.rows[0].dup, potBooked:true, idem:true }; }
      // ограничение «не больше кассы» — для снабженца (его подотчёт), теперь под замком → без гонки перерасхода
      if(actRole==='sup'){ const bal = await balance(c); if(amount > bal) throw httpErr(400,'нельзя списать больше, чем в кассе снабженца (сейчас '+bal+')'); }
      // ЖЁСТКАЯ блокировка повторной накладной: один и тот же № накладной нельзя провести дважды — защита от двойного списания при повторном заходе (новый reqId обходил мягкий флаг)
      if(invNo){ const dupInv = await c.query("SELECT id FROM kassa_tx WHERE kind='expense' AND COALESCE(inv_no,'')<>'' AND inv_no=$1 LIMIT 1",[invNo]);
        if(dupInv.rowCount) throw httpErr(409,'Накладная № '+invNo+' уже проведена — повторное списание отклонено. Если это другая закупка, укажите другой номер.'); }
      // мягкий флаг: те же позиции+сумма+категория в ту же дату (возможен ЗАКОННЫЙ повтор — не блокируем, только помечаем)
      const dupR = await c.query("SELECT to_timestamp(ts/1000) t FROM kassa_tx WHERE kind='expense' AND sig=$1 AND ($2='' OR COALESCE(doc_date,'')=$2) ORDER BY ts DESC LIMIT 1",[sig, docDate]);
      const isDup = dupR.rowCount>0;
      await c.query(`INSERT INTO kassa_tx(id,kind,ts,amount,category,items,invoice,receipt,created_by,sig,dup,inv_no,rec_no,doc_date,req_id) VALUES($1,'expense',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, now, amount, req.body.category||'Сырьё', JSON.stringify(cleanItems), invoice, receipt, creator, sig, isDup, invNo, recNo, docDate, reqId]);
      for(const i of cleanItems){
        if((i.cat||'')!=='Сырьё') continue;   // на склад попадает ТОЛЬКО сырьё; операционка (ремонт, доставка, услуги) не складируется
        await c.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [now, new Date(now).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}), i.name, i.qty, i.unit, i.price, i.sum, i.cat, id]);
      }
      const potBooked = await bookSupplyExpense(amount, req.body.category, noteTxt, id, who, c, undefined, cleanItems);
      return { id, dup:isDup, dupDate: isDup ? dupR.rows[0].t : null, potBooked };
    });
    res.json({ ok:true, id:out.id, potBooked:out.potBooked, dup:out.dup, dupDate:out.dupDate||null, idem:out.idem||false });
  }catch(e){
    // гонка по одинаковому reqId (UNIQUE) — вернуть уже проведённую запись как успех
    if(e && e.code==='23505' && reqId){ const ex=await pool.query('SELECT id,dup FROM kassa_tx WHERE req_id=$1',[reqId]); if(ex.rowCount) return res.json({ ok:true, id:ex.rows[0].id, potBooked:true, dup:ex.rows[0].dup, idem:true }); }
    if(e && e.httpCode) return res.status(e.httpCode).json({error:e.message});
    console.error('expense error', e&&e.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'});
  }
});

// контроль качества: руководитель помечает закуп «проверено» или «не норма» (учит систему)
app.post('/api/kassa/expense/:id/review', auth, requireRole('mgr'), async (req,res)=>{
  const verdict = req.body.verdict==='bad' ? 'bad' : (req.body.verdict==='ok' ? 'ok' : '');
  const note = verdict==='bad' ? String(req.body.note||'').slice(0,600) : '';
  const r = await pool.query("UPDATE kassa_tx SET review=$1, review_note=$2 WHERE id=$3 AND kind='expense' RETURNING id, amount",[verdict, note, req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:'не найдено'});
  // «не норма» → снабженцу прилетает в систему (плашка + пуш): переделать через согласование
  if(verdict==='bad') sendPushToRole('sup', { title:'BORZO · закуп на исправление', body:'Руководитель вернул закуп на '+money(r.rows[0].amount)+' ₸ — переделай', url:'/kassa.html' }).catch(()=>{});
  res.json({ ok:true, verdict });
});
// удаление СВОЕГО закупа руководителем — без согласования (только expense, созданный mgr)
app.post('/api/kassa/expense/:id/delete', auth, requireRole('mgr'), async (req,res)=>{
  try{
    await withTx(async (c)=>{
      await c.query('SELECT pg_advisory_xact_lock($1)',[KASSA_LOCK]);
      const r = await c.query('SELECT * FROM kassa_tx WHERE id=$1 FOR UPDATE',[req.params.id]);
      const tx = r.rows[0];
      if(!tx || tx.kind!=='expense') throw httpErr(404,'не найдено');
      if(tx.created_by !== req.user.id) throw httpErr(403,'можно удалять только свой закуп');
      await c.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
      await c.query('DELETE FROM kassa_tx WHERE id=$1',[tx.id]);
      await unbookPotTx(tx.id, c);   // снять ВСЕ части расхода закупа из котла — в той же транзакции
    });
    res.json({ ok:true });
  }catch(e){ if(e&&e.httpCode) return res.status(e.httpCode).json({error:e.message}); console.error('route error', e&&e.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'}); }
});
// прямая правка СВОЕГО закупа руководителем — без согласования
app.post('/api/kassa/expense/:id/edit', auth, requireRole('mgr'), async (req,res)=>{
  const amount = money(req.body.amount);
  if(amount<=0) return res.status(400).json({error:'укажите сумму'});
  const items = Array.isArray(req.body.items)? req.body.items : [];
  const norm = v => String(v==null?'':v).replace(',','.');
  try{
    await withTx(async (c)=>{
      await c.query('SELECT pg_advisory_xact_lock($1)',[KASSA_LOCK]);
      const r = await c.query('SELECT * FROM kassa_tx WHERE id=$1 FOR UPDATE',[req.params.id]);
      const tx = r.rows[0];
      if(!tx || tx.kind!=='expense') throw httpErr(404,'не найдено');
      if(tx.created_by !== req.user.id) throw httpErr(403,'можно править только свой закуп');
      const cat = req.body.category || tx.category;
      const cleanItems = items.filter(i=>(i.name||'').trim()).map(i=>({name:String(i.name).trim(),qty:norm(i.qty),unit:i.unit||'шт',price:norm(i.price),sum:rowSum(i),cat:i.cat||cat}));
      // реквизиты документа сохраняем при правке (аудит #27): если поле прислано — обновляем, иначе оставляем прежнее
      const invNo = (req.body.invNo!=null) ? String(req.body.invNo).trim().slice(0,40) : (tx.inv_no||'');
      const recNo = (req.body.recNo!=null) ? String(req.body.recNo).trim().slice(0,40) : (tx.rec_no||'');
      let docDate = (req.body.docDate!=null) ? docDateClean(req.body.docDate) : (tx.doc_date||'');
      if(docDate===null) throw httpErr(400,'дата документа из будущего — проверьте её');
      await c.query('UPDATE kassa_tx SET amount=$1, category=$2, items=$3, inv_no=$4, rec_no=$5, doc_date=$6 WHERE id=$7',[amount, cat, JSON.stringify(cleanItems), invNo, recNo, docDate, tx.id]);
      await c.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
      for(const i of cleanItems){
        if((i.cat||'')!=='Сырьё') continue;   // склад — только сырьё; смена категории на операционку убирает позицию со склада
        await c.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [Number(tx.ts), new Date(Number(tx.ts)).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}), i.name, i.qty, i.unit, i.price, i.sum, i.cat, tx.id]);
      }
      // перепровести в котле: снять старую, записать новую — СОХРАНЯЯ месяц исходной операции (аудит #18: правка не переносит расход в текущий месяц)
      await unbookPotTx(tx.id, c);
      const origPer = almatyMonthStart(Number(tx.ts));
      const names = cleanItems.map(i=>i.name).filter(Boolean).slice(0,3).join(', ');
      await bookSupplyExpense(amount, cat, 'закуп Руслана'+(names?': '+names:''), tx.id, 'ruslan', c, origPer, cleanItems);
    });
    res.json({ ok:true });
  }catch(e){ if(e&&e.httpCode) return res.status(e.httpCode).json({error:e.message}); console.error('route error', e&&e.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'}); }
});

// правка выдачи ДО подтверждения (руководитель, напрямую)
app.post('/api/kassa/issue/:id/edit', auth, requireRole('mgr'), async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx || tx.kind!=='issue') return res.status(404).json({error:'не найдено'});
  if(tx.status!=='wait') return res.status(400).json({error:'уже подтверждено — только через согласование'});
  await pool.query('UPDATE kassa_tx SET amount=$1, source=$2 WHERE id=$3',[money(req.body.amount), req.body.source||tx.source, tx.id]);
  res.json({ ok:true });
});
// отмена невыданного (руководитель)
app.post('/api/kassa/issue/:id/cancel', auth, requireRole('mgr'), async (req,res)=>{
  const r = await pool.query(`DELETE FROM kassa_tx WHERE id=$1 AND kind='issue' AND status='wait' RETURNING id`,[req.params.id]);
  if(!r.rowCount) return res.status(400).json({error:'нельзя отменить'});
  res.json({ ok:true });
});

// предложить изменение (любая роль) → на согласование второй стороне
app.post('/api/kassa/:id/propose', auth, requireAny(['mgr','sup']), async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx) return res.status(404).json({error:'не найдено'});
  const del = req.body.del===true;
  const next = req.body.next||{};
  if(!del && !genericDiff(tx,next).length) return res.status(400).json({error:'нет изменений'});
  // руководитель в режиме «как снабженец» → запрос уходит от снабженца (actAs), одобряет вторая сторона
  const byRole = (req.user.role==='mgr' && req.body.actAs==='sup') ? 'sup' : req.user.role;
  const pending = { by:byRole, byId:req.user.id, next, del, note:req.body.note||'', t:Date.now() };
  await pool.query('UPDATE kassa_tx SET pending=$1 WHERE id=$2',[JSON.stringify(pending), tx.id]);
  // push второй стороне (кто должен согласовать)
  const approver = byRole==='sup' ? 'mgr' : 'sup';
  const who = byRole==='sup' ? 'Снабженец' : 'Руководитель';
  const act = del ? 'удаление накладной' : 'изменение';
  sendPushToRole(approver, { title:'BORZO · согласование', body:who+' просит '+act+' на '+money(tx.amount)+' ₸', url:'/kassa.html' }).catch(()=>{});
  res.json({ ok:true });
});
// отменить свой запрос (до решения второй стороны)
app.post('/api/kassa/:id/unpropose', auth, requireAny(['mgr','sup']), async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx || !tx.pending) return res.status(400).json({error:'нечего отменять'});
  if(!(req.user.role==='mgr' || tx.pending.by===req.user.role)) return res.status(403).json({error:'нет прав'});
  await pool.query('UPDATE kassa_tx SET pending=NULL WHERE id=$1',[tx.id]);
  res.json({ ok:true });
});
// одобрить изменение (противоположная сторона)
app.post('/api/kassa/:id/approve', auth, requireAny(['mgr','sup']), async (req,res)=>{
  const norm = v => String(v==null?'':v).replace(',','.');
  try{
    const result = await withTx(async (c)=>{
      await c.query('SELECT pg_advisory_xact_lock($1)',[KASSA_LOCK]);
      const r = await c.query('SELECT * FROM kassa_tx WHERE id=$1 FOR UPDATE',[req.params.id]);
      const tx = r.rows[0];
      if(!tx || !tx.pending) throw httpErr(400,'нечего одобрять');
      if(tx.pending.by===req.user.role) throw httpErr(403,'изменение одобряет вторая сторона');
      if(tx.pending.byId!=null && tx.pending.byId===req.user.id) throw httpErr(403,'нельзя одобрить собственный запрос');
      // удаление по согласованию
      if(tx.pending.del){
        await c.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
        await c.query('DELETE FROM kassa_tx WHERE id=$1',[tx.id]);
        if(tx.kind==='expense') await unbookPotTx(tx.id, c);   // закуп — снять все части расхода из котла
        if(tx.kind==='issue')   await unbookPot('supi_'+tx.id, c);   // выдача — снять строку выдачи из ленты
        return { deleted:true };
      }
      const next = tx.pending.next;
      // нормализация чисел (аудит #12,#16): суммы конечны и положительны, кол-во/цена без запятой
      if('amount' in next){ const a=money(next.amount); if(!(a>0)) throw httpErr(400,'сумма должна быть больше нуля'); next.amount=a; }
      if('items' in next && Array.isArray(next.items)){
        next.items = next.items.filter(i=>i&&(i.name||'').toString().trim()).map(i=>({name:String(i.name).trim(),qty:norm(i.qty),unit:i.unit||'шт',price:norm(i.price),sum:(i.sum!=null?money(i.sum):rowSum(i)),cat:i.cat||next.category||tx.category}));
      }
      const entry = { t:Date.now(), by:tx.pending.by, approver:req.user.role, changes:genericDiff(tx,next), note:tx.pending.note };
      const log = (tx.log||[]).concat([entry]);
      const fields=[], vals=[]; let n=1;
      ['amount','source','category','items'].forEach(k=>{ if(k in next){ fields.push(k+'=$'+n); vals.push(k==='items'?JSON.stringify(next[k]):next[k]); n++; } });
      fields.push('pending=NULL'); fields.push('log=$'+n); vals.push(JSON.stringify(log)); n++;
      // снабженец исправил и руководитель одобрил → замечание «не норма» снимается
      // снабженец исправил и руководитель одобрил → закуп сразу «проверен» (не сбрасываем в непроверено, иначе плашка контроля всплывёт заново)
      if(tx.kind==='expense' && tx.review==='bad'){ fields.push("review='ok'"); fields.push("review_note=''"); }
      vals.push(tx.id);
      await c.query(`UPDATE kassa_tx SET ${fields.join(', ')} WHERE id=$${n}`, vals);
      // пересобрать приход на склад при изменении позиций ИЛИ категории (смена на операционку убирает со склада)
      if(tx.kind==='expense' && (('items' in next) || ('category' in next))){
        const effCat = ('category' in next) ? next.category : tx.category;
        const rebuildItems = ('items' in next) ? (next.items||[]) : (tx.items||[]);
        await c.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
        for(const i of rebuildItems){
          if((i.cat||effCat)!=='Сырьё') continue;   // склад — только сырьё
          await c.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [Number(tx.ts), new Date(Number(tx.ts)).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}), i.name, i.qty, i.unit, i.price, i.sum!=null?i.sum:rowSum(i), (i.cat||effCat), tx.id]);
        }
      }
      // ПЕРЕПРОВЕСТИ КОТЁЛ при согласованной правке закупа (аудит #5): иначе supx_ остаётся на старой сумме/категории
      if(tx.kind==='expense' && (('amount' in next) || ('category' in next))){
        const newAmount = ('amount' in next) ? next.amount : money(tx.amount);
        const newCat = ('category' in next) ? next.category : tx.category;
        const origPer = almatyMonthStart(Number(tx.ts));
        const ur = await c.query('SELECT role FROM users WHERE id=$1',[tx.created_by]);
        const who = (ur.rows[0] && ur.rows[0].role==='sup') ? 'snab' : 'ruslan';
        await unbookPotTx(tx.id, c);
        const bItems = (next.items||tx.items||[]);
        const nm = bItems.map(i=>i&&i.name).filter(Boolean).slice(0,3).join(', ');
        await bookSupplyExpense(newAmount, newCat, 'закуп (правка согласована)'+(nm?': '+nm:''), tx.id, who, c, origPer, bItems);
      }
      // ПЕРЕПРОВЕСТИ выдачу при согласованной правке суммы (аудит #5): supi_ должна совпасть
      if(tx.kind==='issue' && tx.status==='accepted' && ('amount' in next)){
        await unbookPot('supi_'+tx.id, c);
        await bookSupplyIssue(next.amount, tx.id, c);
      }
      return { ok:true };
    });
    res.json(Object.assign({ ok:true }, result));
  }catch(e){ if(e&&e.httpCode) return res.status(e.httpCode).json({error:e.message}); console.error('route error', e&&e.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'}); }
});
// отклонить изменение
app.post('/api/kassa/:id/reject', auth, requireAny(['mgr','sup']), async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx || !tx.pending) return res.status(400).json({error:'нечего отклонять'});
  if(tx.pending.by===req.user.role) return res.status(403).json({error:'решает вторая сторона'});
  if(tx.pending.byId!=null && tx.pending.byId===req.user.id) return res.status(403).json({error:'нельзя решать собственный запрос'});
  const entry = { t:Date.now(), by:tx.pending.by, approver:req.user.role, rejected:true, changes:(tx.pending.del?[{label:'Удаление накладной', from:'удалить', to:'оставить'}]:genericDiff(tx,tx.pending.next)), note:tx.pending.note };
  await pool.query('UPDATE kassa_tx SET pending=NULL, log=$1 WHERE id=$2',[JSON.stringify((tx.log||[]).concat([entry])), tx.id]);
  res.json({ ok:true });
});

// ---------- счета на закуп (без гоняния денег снабженцу) ----------
// снабженец/Руслан выставляет счёт Ульяне или Руслану → получатель платит физически и жмёт «Оплатил» →
// закуп проводится напрямую: накладная в снабжение + приход на склад + расход с отдела оплатившего.
const BILL_LOCK = 0x0b12b111;
function billItems(raw, cat){
  const norm = v => String(v==null?'':v).replace(',','.');
  return (Array.isArray(raw)?raw:[]).filter(i=>i&&(i.name||'').trim())
    .map(i=>({name:String(i.name).trim(), qty:norm(i.qty), unit:i.unit||'шт', price:norm(i.price), sum:rowSum(i), cat:i.cat||cat}));
}
function billRoleForWhom(w){ return w==='ulyana' ? 'fin' : 'mgr'; }  // кому выставлен → какая роль оплачивает
// список счетов (видят Руслан, Ульяна, снабженец)
app.get('/api/bills', auth, requireAny(['mgr','fin','sup']), async (req,res)=>{
  const r = await pool.query(`SELECT b.*, u.name AS by_name, u.role AS by_role FROM bills b LEFT JOIN users u ON u.id=b.created_by ORDER BY b.ts DESC LIMIT 500`);
  res.json({ bills: r.rows });
});
// выставить счёт (снабженец или Руслан)
app.post('/api/bills', auth, requireAny(['mgr','sup']), async (req,res)=>{
  // ЗАРПЛАТНЫЙ СЧЁТ: Руслан поручает Ульяне выплатить сотруднику (деньги с её отдела, не гоняем через Руслана)
  if(req.body.kind==='salary'){
    if(req.user.role!=='mgr') return res.status(403).json({error:'зарплатный счёт выставляет только Руслан'});
    const emp = String(req.body.emp||'').trim().slice(0,80);
    if(!emp) return res.status(400).json({error:'выберите сотрудника'});
    const salType = req.body.salType==='advance' ? 'advance' : 'salary';
    const per = String(req.body.per||'').slice(0,20) || monthPerNow();
    const monthName = String(req.body.monthName||'').slice(0,40);
    const amount = money(req.body.amount);
    if(amount<=0) return res.status(400).json({error:'укажите сумму'});
    const note = String(req.body.note||'').slice(0,300);       // номер карты/телефон для перевода (копируется Ульяной)
    const payName = String(req.body.payName||'').trim().slice(0,80);   // имя владельца карты (Ульяна сверяет при переводе)
    const items = [{ name:(salType==='advance'?'Аванс':'Зарплата')+' · '+emp+(monthName?' · '+monthName:''), emp, salType, per, monthName, payName, qty:1, unit:'', price:amount, sum:amount, isSalary:true }];
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO bills(id,ts,created_by,created_role,to_whom,amount,category,items,invoice,inv_no,doc_date,note,status)
      VALUES($1,$2,$3,$4,'ulyana',$5,'Зарплата',$6,NULL,'','',$7,'wait')`,
      [id, Date.now(), req.user.id, req.user.role, amount, JSON.stringify(items), note]);
    sendPushToRole('fin', { title:'BORZO · зарплата на выплату', body:(salType==='advance'?'Аванс':'Зарплата')+' '+emp+' · '+money(amount).toLocaleString('ru-RU')+' ₸ — нажми «Выплатил», когда переведёшь', url:'/fin.html' }).catch(()=>{});
    return res.json({ ok:true, id });
  }
  const to = req.body.to==='ulyana' ? 'ulyana' : (req.body.to==='ruslan' ? 'ruslan' : null);
  if(!to) return res.status(400).json({error:'выберите, кому счёт: Ульяне или Руслану'});
  const category = req.body.category==='Сырьё' ? 'Сырьё' : 'Операционка';
  const items = billItems(req.body.items, category);
  let amount = money(req.body.amount);
  const itemsSum = items.reduce((s,i)=>s+(i.sum||0),0);
  if(amount<=0) amount = itemsSum;                       // сумма не задана — берём из позиций
  if(amount<=0) return res.status(400).json({error:'укажите сумму или позиции'});
  const invoice = savePhoto(req.body.invoice);          // накладная — по желанию (направляющие её не дают)
  const invNo = String(req.body.invNo||'').trim().slice(0,40);
  let docDate = docDateClean(req.body.docDate); if(docDate===null) docDate='';
  const note = String(req.body.note||'').slice(0,300);
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO bills(id,ts,created_by,created_role,to_whom,amount,category,items,invoice,inv_no,doc_date,note,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'wait')`,
    [id, Date.now(), req.user.id, req.user.role, to, amount, category, JSON.stringify(items), invoice, invNo, docDate, note]);
  // уведомить того, кому счёт: Ульяна(fin) / Руслан(mgr)
  const names = items.map(i=>i.name).filter(Boolean).slice(0,3).join(', ');
  sendPushToRole(billRoleForWhom(to), { title:'BORZO · счёт на оплату', body:'Счёт на '+money(amount).toLocaleString('ru-RU')+' ₸'+(names?' · '+names:'')+' — нажми «Оплатил», когда переведёшь', url:'/fin.html' }).catch(()=>{});
  res.json({ ok:true, id });
});
// «Оплатил» — получатель провёл оплату физически: закуп ложится напрямую, деньги с его отдела котла
app.post('/api/bills/:id/pay', auth, requireAny(['mgr','fin']), async (req,res)=>{
  try{
    const out = await withTx(async (c)=>{
      await c.query('SELECT pg_advisory_xact_lock($1)',[BILL_LOCK]);
      const r = await c.query('SELECT * FROM bills WHERE id=$1 FOR UPDATE',[req.params.id]);
      const b = r.rows[0];
      if(!b) throw httpErr(404,'счёт не найден');
      if(b.status!=='wait') throw httpErr(400,'счёт уже '+(b.status==='paid'?'оплачен':'отменён'));
      // платит только адресат: Ульяне → роль fin, Руслану → роль mgr
      if(billRoleForWhom(b.to_whom)!==req.user.role) throw httpErr(403,'этот счёт выставлен не тебе');
      // ЗАРПЛАТНЫЙ СЧЁТ: Ульяна выплатила сотруднику → зарплата в котёл (история + журнал зарплат), списание с её отдела. Склад/накладную/кассу снабжения НЕ трогаем.
      if(b.category==='Зарплата'){
        const it=(Array.isArray(b.items)&&b.items[0])||{};
        const kassaId=crypto.randomUUID(), now=Date.now();
        await bookSalary(money(b.amount), b.to_whom, it.emp||'', it.salType||'salary', it.per||monthPerNow(), (it.salType==='advance'?'Аванс':'Зарплата')+' выплачена Ульяной'+(b.note?' · '+b.note:''), kassaId, c);
        await c.query(`UPDATE bills SET status='paid', paid_by=$1, paid_ts=$2, kassa_tx_id=$3 WHERE id=$4`,[req.user.id, now, kassaId, b.id]);
        return { kassaId, createdBy:b.created_by, salary:true };
      }
      const who = b.to_whom;                       // расход спишется с отдела оплатившего
      const items = Array.isArray(b.items)? b.items : [];
      const cat = b.category||'Сырьё';
      const kassaId = crypto.randomUUID(), now = Date.now();
      const sig = sigOf(items, b.amount, cat);
      const names = items.map(i=>i&&i.name).filter(Boolean).slice(0,3).join(', ');
      // накладная в снабжение (created_by = оплативший → кассу снабженца НЕ трогает; помечаем bill_id и review=ok)
      await c.query(`INSERT INTO kassa_tx(id,kind,ts,amount,category,items,invoice,created_by,sig,inv_no,doc_date,req_id,review,bill_id)
        VALUES($1,'expense',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ok',$12)`,
        [kassaId, now, money(b.amount), cat, JSON.stringify(items), b.invoice||null, req.user.id, sig, b.inv_no||'', b.doc_date||'', 'bill_'+b.id, b.id]);
      // приход на склад — только сырьё
      for(const i of items){
        if((i.cat||cat)!=='Сырьё') continue;
        await c.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [now, new Date(now).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}), i.name, i.qty, i.unit, i.price, i.sum!=null?i.sum:rowSum(i), (i.cat||cat), kassaId]);
      }
      // расход из котла с отдела оплатившего (who=ulyana/ruslan) — как прямой закуп на его имя
      const noteTxt = 'по счёту'+(b.created_role==='sup'?' снабженца':' Руслана')+', оплатил '+(who==='ulyana'?'Ульяна':'Руслан')+(names?': '+names:'');
      await bookSupplyExpense(money(b.amount), cat, noteTxt, kassaId, who, c, monthPerNow(), items);
      await c.query(`UPDATE bills SET status='paid', paid_by=$1, paid_ts=$2, kassa_tx_id=$3 WHERE id=$4`,[req.user.id, now, kassaId, b.id]);
      return { kassaId, createdBy:b.created_by };
    });
    // уведомить того, кто выставил счёт
    if(out.createdBy!=null){ const cr=await pool.query('SELECT role FROM users WHERE id=$1',[out.createdBy]);
      if(cr.rows[0]){ const msg = out.salary
        ? { title:'BORZO · зарплата выплачена', body:'Ульяна выплатила зарплату — проведено в финансах', url:'/fin.html' }
        : { title:'BORZO · счёт оплачен', body:'Твой счёт оплачен — закуп попал в снабжение и на склад', url:'/kassa.html' };
        sendPushToRole(cr.rows[0].role, msg).catch(()=>{}); } }
    res.json({ ok:true, kassaId:out.kassaId });
  }catch(e){ if(e&&e.httpCode) return res.status(e.httpCode).json({error:e.message}); console.error('bill pay error', e&&e.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'}); }
});
// отменить счёт (кто выставил — снабженец/Руслан, либо адресат) — только пока не оплачен
app.post('/api/bills/:id/cancel', auth, requireAny(['mgr','fin','sup']), async (req,res)=>{
  const r = await pool.query('SELECT * FROM bills WHERE id=$1',[req.params.id]);
  const b = r.rows[0];
  if(!b) return res.status(404).json({error:'счёт не найден'});
  if(b.status!=='wait') return res.status(400).json({error:'счёт уже '+(b.status==='paid'?'оплачен — отменять нечего':'отменён')});
  const isCreator = b.created_by===req.user.id;
  const isAddressee = billRoleForWhom(b.to_whom)===req.user.role;
  if(!isCreator && !isAddressee && req.user.role!=='mgr') return res.status(403).json({error:'нет прав отменить этот счёт'});
  await pool.query("UPDATE bills SET status='cancelled' WHERE id=$1",[b.id]);
  res.json({ ok:true });
});

// убрать завершённый счёт из своего списка «Мои счета» (создатель прячет оплаченный/отменённый — только из виду, деньги/склад не трогаем)
app.post('/api/bills/:id/archive', auth, requireAny(['mgr','fin','sup']), async (req,res)=>{
  const r = await pool.query('SELECT * FROM bills WHERE id=$1',[req.params.id]);
  const b = r.rows[0];
  if(!b) return res.status(404).json({error:'счёт не найден'});
  if(b.created_by!==req.user.id && req.user.role!=='mgr') return res.status(403).json({error:'убрать можно только свой счёт'});
  if(b.status==='wait') return res.status(400).json({error:'счёт ещё не завершён — убрать нельзя'});
  await pool.query('UPDATE bills SET archived=true WHERE id=$1',[b.id]);
  res.json({ ok:true });
});

// мини-склад (агрегат)
app.get('/api/sklad', auth, async (req,res)=>{
  const r = await pool.query('SELECT * FROM sklad_intake ORDER BY ts DESC');
  const agg={}, order=[];
  for(const x of r.rows){
    const key=x.name+'|'+x.unit;
    if(!agg[key]){ agg[key]={name:x.name,unit:x.unit,qty:0,sum:0,cat:x.category}; order.push(key); }
    agg[key].qty += parseFloat(x.qty)||0;
    agg[key].sum += parseFloat(x.sum)||0;
  }
  res.json({ items: order.map(k=>agg[k]) });
});

// ---------- ДЕМО-режим: переключение ролей без пароля (для обкатки; в финале DEMO_MODE=0) ----------
app.get('/api/config', (req,res)=> res.json({ demo: process.env.DEMO_MODE==='1' }));
app.post('/api/demo/token', async (req,res)=>{
  if(process.env.DEMO_MODE!=='1') return res.status(404).json({error:'demo off'});
  const role = req.body.role==='mgr'?'mgr':'sup';
  const r = await pool.query('SELECT * FROM users WHERE role=$1 ORDER BY id LIMIT 1',[role]);
  const u = r.rows[0];
  if(!u) return res.status(400).json({error:'нет пользователя роли'});
  res.json({ token: sign(u), user:{ name:u.name, role:u.role, login:u.login } });
});

// ---------- реальный сканер накладной (vision через OpenRouter) ----------
const SCAN_PROMPT = 'Ты распознаёшь фото товарной накладной или чека (может быть на русском/казахском, печатной или от руки). '+
  'Верни СТРОГО валидный JSON-объект без пояснений и без markdown: '+
  '{"number":"номер документа (№ накладной или № чека/фискальный номер), строкой; если номера нет — пустая строка", '+
  '"date":"дата документа строго в формате ГГГГ-ММ-ДД; возьми дату, напечатанную на накладной/чеке; если даты нет — пустая строка", '+
  '"items":[{"name":"наименование","qty":"количество числом","unit":"одно из: шт, м, л, кг","price":"цена за ЕДИНИЦУ числом без пробелов и валюты"}]}. '+
  'Если в накладной дана сумма по строке, а не цена за единицу — раздели сумму на количество. '+
  'Единицу приведи к шт, м, л или кг (штуки/листы/рулоны/комплекты → шт; метры/погонные метры/метраж плёнки → м; литры → л; килограммы → кг). '+
  'Фискальный чек (Webkassa и т.п., узкая лента): позиции идут нумерованным списком (1., 2., 3.) и название может переноситься на несколько строк — собери его целиком; строки «Скидка», «НДС», «Стоимость», «Итого», «Сдача», «Наценка», «Мобильные» — это НЕ позиции, пропусти их. '+
  'Количество бывает дробным («1,500 м» значит 1.5 метра). Все числа возвращай с десятичной ТОЧКОЙ и без пробелов. '+
  'Если позиций нет — items пустой массив.';
// троттлинг сканера: платный vision-API, не больше 30 распознаваний за 10 минут на пользователя
const scanHits = new Map();
app.post('/api/scan', auth, requireAny(['sup','mgr']), async (req,res)=>{
  const image = req.body.image;
  if(!image || !/^data:(image\/(jpeg|png|webp)|application\/pdf)/.test(String(image))) return res.status(400).json({error:'нужно фото (JPEG/PNG/WebP) или PDF'});
  if(String(image).length > 8*1024*1024) return res.status(413).json({error:'фото слишком большое — до 5 МБ'});
  const sk = req.user.id, se = scanHits.get(sk);
  if(se && Date.now()-se.t<600000 && se.n>=30) return res.status(429).json({error:'слишком много распознаваний, подождите'});
  if(!se || Date.now()-se.t>=600000) scanHits.set(sk,{n:1,t:Date.now()}); else se.n++;
  // разбор ответа модели в структуру {items, number, date} — общий для Google и OpenRouter
  function parseScan(txt){
    txt = String(txt||'').replace(/```json/gi,'').replace(/```/g,'').trim();
    let parsed=null;
    try{ parsed=JSON.parse(txt); }
    catch(e){ const m=txt.match(/\{[\s\S]*\}/)||txt.match(/\[[\s\S]*\]/); if(m){ try{ parsed=JSON.parse(m[0]); }catch(e2){} } }
    let items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
    let number = (parsed && !Array.isArray(parsed) && parsed.number!=null) ? String(parsed.number).trim().slice(0,40) : '';
    let docDate = (parsed && !Array.isArray(parsed) && parsed.date!=null) ? String(parsed.date).trim().slice(0,10) : '';
    docDate = docDateClean(docDate) || '';
    items = items.filter(function(i){return i && (i.name||'').toString().trim();}).map(function(i){
      var unit = ['шт','м','л','кг'].indexOf(i.unit)>=0 ? i.unit : 'шт';
      var qty = String(i.qty==null?'':i.qty).replace(/\s/g,'').replace(/,/g,'.').replace(/[^\d.]/g,'');
      var price = String(i.price==null?'':i.price).replace(/\s/g,'').replace(/,/g,'.').replace(/[^\d.]/g,'');
      return { name:String(i.name).slice(0,120), qty:qty, unit:unit, price:price };
    });
    return { items:items, number:number, date:docDate };
  }
  try{
    // 1) Google Gemini НАПРЯМУЮ: ОТДЕЛЬНЫЙ ключ распознавания GOOGLE_OCR_API_KEY (электроящик снабжения) — независим от CRM/перевода, не зависит от OpenRouter.
    const gkey = (await crm.getSecret(pool,'GOOGLE_OCR_API_KEY')) || process.env.GOOGLE_OCR_API_KEY;
    if(gkey){
      const mm = String(image).match(/^data:([^;]+);base64,(.+)$/);   // image/jpeg|png|webp ИЛИ application/pdf — Gemini читает и PDF
      const mime = mm?mm[1]:'image/jpeg', b64 = mm?mm[2]:'';
      // каскад моделей: сначала точнее, при 503/перегрузе — lite (стабильнее и дешевле). GEMINI_SCAN_MODEL из env, если задан, идёт первым.
      const models = [process.env.GEMINI_SCAN_MODEL, 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'].filter(Boolean);
      for(const model of models){
        try{
          const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+encodeURIComponent(gkey),{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ contents:[{ parts:[ {text:SCAN_PROMPT}, {inline_data:{mime_type:mime, data:b64}} ] }], generationConfig:{ temperature:0, response_mime_type:'application/json' } })
          });
          if(gr.ok){
            const gj = await gr.json();
            const gtxt = (((((gj.candidates||[])[0]||{}).content||{}).parts||[])[0]||{}).text || '';
            const out = parseScan(gtxt);
            console.log('[scan/google] '+model+' items='+out.items.length+' num='+(out.number||'-'));
            return res.json(out);
          }
          console.warn('[scan] google '+model+' http '+gr.status);
          if(gr.status!==503 && gr.status!==404 && gr.status!==429) break;   // не перегрузка/отсутствие модели — дальше по моделям смысла нет
        }catch(e){ console.warn('[scan] google '+model+' err '+e.message); }
      }
    }
    // 2) OpenRouter (запасной) — та же модель Gemini через него
    const key = process.env.OPENROUTER_API_KEY;
    if(!key) return res.status(500).json({error:'распознавание не настроено — добавь ключ Google (Gemini) в электроящик (розетка «Google · Gemini»)'});
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: process.env.SCAN_MODEL || 'google/gemini-2.0-flash-001',
        temperature: 0,
        messages: [{ role:'user', content:[
          { type:'text', text: SCAN_PROMPT },
          { type:'image_url', image_url:{ url: image } }
        ]}]
      })
    });
    const d = await r.json();
    if(!r.ok){ console.error('[scan] openrouter http '+r.status, (d&&d.error&&d.error.message)||''); return res.status(502).json({error: r.status===402||r.status===403 ? 'OpenRouter исчерпан — добавь ключ Google (Gemini) в электроящик' : 'не удалось распознать, введите вручную'}); }
    const out = parseScan((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '');
    console.log('[scan/openrouter] items='+out.items.length+' num='+(out.number||'-')+' tokens='+((d.usage||{}).total_tokens||'?'));
    res.json(out);
  }catch(e){ console.error('scan error', e.message); res.status(502).json({error:'не удалось распознать, введите вручную'}); }
});

// ---------- финмодуль: общее состояние (продажи, кредиты, аналитика). Доступ: руководитель + финансист (Ульяна) ----------
app.get('/api/fin', auth, requireAny(['mgr','fin']), async (req,res)=>{
  const r = await pool.query('SELECT data, rev, updated_at FROM fin_state WHERE id=1');
  if(!r.rowCount) return res.json({ data:null, rev:0 });
  res.json({ data:r.rows[0].data, rev:r.rows[0].rev, updated_at:Number(r.rows[0].updated_at)||0 });
});
// операция-связка со снабжением (сервер-авторитетна: касса ими управляет, финмодуль их не перезаписывает)
function isSupplyOp(o){ return o && ((typeof o.id==='string' && (o.id.indexOf('supx_')===0 || o.id.indexOf('supi_')===0)) || o.supplyExpense===true || o.supplyIssue===true); }
app.put('/api/fin', auth, requireAny(['mgr','fin']), async (req,res)=>{
  const data = req.body && req.body.data;
  if(!data || typeof data!=='object' || !Array.isArray(data.ops)) return res.status(400).json({error:'некорректные данные'});
  // защита от битых данных (аудит #12): выкидываем null/не-объекты из ops, чтобы клиентские расчёты не падали
  data.ops = data.ops.filter(o=> o && typeof o==='object');
  const baseRev = (req.body.baseRev==null) ? null : Number(req.body.baseRev);
  const cur = await pool.query('SELECT data, rev FROM fin_state WHERE id=1');
  const curOps = (cur.rowCount && cur.rows[0].data && Array.isArray(cur.rows[0].data.ops)) ? cur.rows[0].data.ops : [];
  const curRev = cur.rowCount ? Number(cur.rows[0].rev)||0 : 0;
  // СРАВНЕНИЕ ВЕРСИЙ (compare-and-swap): клиент прислал baseRev — версию, на которой он строил правку.
  // Если на сервере уже более свежая версия — конфликт: не затираем, отдаём серверную правду, клиент сольёт и повторит.
  if(cur.rowCount && curRev>0 && baseRev!=null && baseRev!==curRev){
    return res.status(409).json({ conflict:true, error:'версия устарела — подтяните свежие данные', data:cur.rows[0].data, rev:curRev });
  }
  // ЗАЩИТА ОТ ЗАТИРАНИЯ: не даём резко обрушить базу (пустой/подозрительно маленький клиент не должен стереть историю)
  const incNonSupply = data.ops.filter(o=>!isSupplyOp(o)).length;
  const curNonSupply = curOps.filter(o=>!isSupplyOp(o)).length;
  if(curNonSupply >= 20 && incNonSupply < curNonSupply*0.5){
    return res.status(409).json({ conflict:true, error:'отклонено: подозрительное сокращение данных (защита от потери). На сервере '+curNonSupply+', прислано '+incNonSupply+'.', data:cur.rows[0].data, rev:curRev });
  }
  // сохраняем ТЕКУЩИЕ серверные операции-связки (закупы/выдачи из кассы), игнорируя присланные клиентом — чтобы финмодуль их не затирал
  const serverSupply = curOps.filter(isSupplyOp);
  data.ops = data.ops.filter(o=>!isSupplyOp(o)).concat(serverSupply).sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
  // атомарная запись: обновляем ТОЛЬКО если версия на сервере всё ещё curRev (никто не влез между SELECT и UPDATE)
  if(cur.rowCount){
    const r = await pool.query(
      'UPDATE fin_state SET data=$1, rev=rev+1, updated_by=$2, updated_at=$3 WHERE id=1 AND rev=$4 RETURNING rev',
      [JSON.stringify(data), req.user.id, Date.now(), curRev]);
    if(!r.rowCount){
      const fresh = await pool.query('SELECT data, rev FROM fin_state WHERE id=1');
      return res.status(409).json({ conflict:true, error:'параллельная запись — подтяните свежие данные', data:fresh.rows[0].data, rev:Number(fresh.rows[0].rev)||0 });
    }
    // финансовые согласования → push противоположной стороне (только НОВЫЙ pending, которого не было)
    try{
      const oldP={}; curOps.forEach(o=>{ if(o&&o.id!=null&&o.pending) oldP[o.id]=1; });
      data.ops.forEach(o=>{ if(o&&o.pending && !oldP[o.id]){
        const by=o.pending.by, toRole=(by==='ulyana')?'mgr':'fin', who=(by==='ulyana')?'Ульяна':'Руслан';
        const act=o.pending.del?'удалить операцию':'изменить операцию';
        const sum=Math.round(+o.amount||0).toLocaleString('ru-RU');
        sendPushToRole(toRole, { title:'BORZO · согласование', body:who+' просит '+act+' на '+sum+' ₸', url:'/fin.html' }).catch(()=>{});
      }});
    }catch(_){}
    return res.json({ ok:true, rev:Number(r.rows[0].rev) });
  } else {
    const r = await pool.query(
      'INSERT INTO fin_state(id,data,rev,updated_by,updated_at) VALUES(1,$1,1,$2,$3) ON CONFLICT (id) DO NOTHING RETURNING rev',
      [JSON.stringify(data), req.user.id, Date.now()]);
    if(!r.rowCount){ // кто-то успел создать первым — это конфликт
      const fresh = await pool.query('SELECT data, rev FROM fin_state WHERE id=1');
      return res.status(409).json({ conflict:true, error:'параллельная запись — подтяните свежие данные', data:fresh.rows[0].data, rev:Number(fresh.rows[0].rev)||0 });
    }
    return res.json({ ok:true, rev:Number(r.rows[0].rev) });
  }
});

app.get('/api/push/pubkey', (req,res)=> res.json({ key: process.env.VAPID_PUBLIC||'' }));
app.post('/api/push/subscribe', auth, async (req,res)=>{
  const sub = req.body && req.body.sub;
  if(!sub || !sub.endpoint) return res.status(400).json({error:'нет подписки'});
  await pool.query(`INSERT INTO push_subs(endpoint,user_id,role,sub) VALUES($1,$2,$3,$4)
    ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, role=EXCLUDED.role, sub=EXCLUDED.sub`,
    [sub.endpoint, req.user.id, req.user.role, JSON.stringify(sub)]);
  res.json({ ok:true });
});
// отписка (тумблер выключен)
app.post('/api/push/unsubscribe', auth, async (req,res)=>{
  const ep = req.body && req.body.endpoint;
  if(ep) await pool.query('DELETE FROM push_subs WHERE endpoint=$1 AND user_id=$2',[ep, req.user.id]);
  res.json({ ok:true });
});
// статус: сколько подписок у ЭТОГО пользователя на сервере (для «тумблер соответствует действительности»)
app.get('/api/push/status', auth, async (req,res)=>{
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM push_subs WHERE user_id=$1',[req.user.id]);
  res.json({ configured: !!process.env.VAPID_PUBLIC, count: (r.rows[0]&&r.rows[0].n)||0 });
});
// тест-пуш САМОМУ СЕБЕ (проверка, что реально доходит)
app.post('/api/push/test', auth, async (req,res)=>{
  if(!process.env.VAPID_PUBLIC) return res.status(503).json({error:'push на сервере не настроен'});
  const r = await pool.query('SELECT endpoint, sub FROM push_subs WHERE user_id=$1',[req.user.id]);
  if(!r.rowCount) return res.status(400).json({error:'нет активной подписки — включи тумблер'});
  let sent=0, dead=0;
  for(const row of r.rows){
    try { await webpush.sendNotification(row.sub, JSON.stringify({title:'BORZO · проверка', body:'Push работает ✓ Уведомления будут приходить сюда.', url:'/home.html'})); sent++; }
    catch(e){ if(e.statusCode===404||e.statusCode===410){ await pool.query('DELETE FROM push_subs WHERE endpoint=$1',[row.endpoint]); dead++; } }
  }
  res.json({ ok:sent>0, sent, dead });
});

// CRM uses the existing helpers without modifying other modules.
crm.register(app, {pool, auth, requireAny, requireRole, withTx, savePhoto, uploadDir:UPLOAD_DIR, sendPushToRole});
// WhatsApp (360dialog): вебхук приёма (публичный) + отправка/чат (авторизованные)
wa.register(app, {pool, auth, requireAny, withTx, savePhoto, sendPushToRole, uploadDir:UPLOAD_DIR});

app.get('/api/health', (req,res)=> res.json({ ok:true }));

// глобальный обработчик ошибок Express (аудит #14): любая ошибка → 500, а не зависший запрос
app.use((err, req, res, next)=>{ console.error('unhandled route error', err&&err.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'}); });
// подстраховка: необработанный промис не должен ронять процесс (systemd перезапустит, но лучше логировать и жить)
process.on('unhandledRejection', (reason)=>{ console.error('unhandledRejection', reason && (reason.message||reason)); });

// Автономный планировщик (без токенов/нейросети): раз в минуту шлёт пуш просроченных пауза-напоминаний
// и раз в час перепроверяет ключи электроящика. Чистые SQL + web-push.
let lastKeyRecheck = 0;
async function schedulerTick(){
  try{
    const due = await pool.query(
      `SELECT d.id, c.name AS client FROM crm_deals d JOIN crm_clients c ON c.id=d.client_id
       WHERE d.remind_at IS NOT NULL AND d.remind_at <= now() AND d.remind_fired_at IS NULL LIMIT 50`);
    for(const row of due.rows){
      await pool.query('UPDATE crm_deals SET remind_fired_at=now() WHERE id=$1', [row.id]);
      const payload = { title:'BORZO · Напоминание', body:'Пора вернуться к клиенту: '+(row.client||''), url:'/crm.html' };
      sendPushToRole('mgr', payload).catch(()=>{});
      sendPushToRole('fin', payload).catch(()=>{});
    }
  }catch(e){ console.error('scheduler reminders', e && e.message); }
  try{
    if(Date.now() - lastKeyRecheck > 3600000){ lastKeyRecheck = Date.now(); await crm.recheckSecrets(pool); }
  }catch(e){ console.error('scheduler keys', e && e.message); }
}

initSchema().then(()=>{
  if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive:true });
  app.listen(PORT, ()=> console.log('BORZO server on :'+PORT));
  setInterval(schedulerTick, 60000);
  setTimeout(schedulerTick, 5000);
}).catch(e=>{ console.error('init error', e); process.exit(1); });
