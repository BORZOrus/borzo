/* BORZO-пульт — бэкенд: касса, логины, роли. Node/Express + PostgreSQL. */
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
if(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE){
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@borzopult.com', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
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
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS sig TEXT;
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS dup BOOLEAN DEFAULT false;
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS inv_no TEXT DEFAULT '';
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS rec_no TEXT DEFAULT '';
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS doc_date TEXT DEFAULT '';
    ALTER TABLE kassa_tx ADD COLUMN IF NOT EXISTS req_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS kassa_tx_req_id_uidx ON kassa_tx(req_id) WHERE req_id IS NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_ver INTEGER NOT NULL DEFAULT 0;
  `);
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
    catch(e){ if(e.statusCode===404||e.statusCode===410){ await pool.query('DELETE FROM push_subs WHERE endpoint=$1',[row.endpoint]); } }
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

app.post('/api/auth/login', async (req,res)=>{
  const { login, password } = req.body||{};
  if(!login||!password) return res.status(400).json({error:'укажите логин и пароль'});
  const r = await pool.query('SELECT * FROM users WHERE login=$1',[String(login).toLowerCase().trim()]);
  const u = r.rows[0];
  if(!u || !bcrypt.compareSync(password, u.pass_hash)) return res.status(401).json({error:'неверный логин или пароль'});
  res.json({ token: sign(u), user:{ name:u.name, role:u.role, login:u.login } });
});
app.get('/api/me', auth, (req,res)=> res.json({ user:{ name:req.user.name, role:req.user.role, login:req.user.login } }));

app.post('/api/auth/password', auth, async (req,res)=>{
  const { old_pass, new_pass } = req.body||{};
  if(!new_pass || String(new_pass).length<5) return res.status(400).json({error:'новый пароль — минимум 5 символов'});
  const r = await pool.query('SELECT * FROM users WHERE id=$1',[req.user.id]);
  const u = r.rows[0];
  if(!u || !bcrypt.compareSync(old_pass||'', u.pass_hash)) return res.status(401).json({error:'текущий пароль неверный'});
  // смена пароля отзывает все прежние токены (token_ver++), но текущему устройству выдаём свежий, чтобы не разлогинить
  const upd = await pool.query('UPDATE users SET pass_hash=$1, token_ver=token_ver+1 WHERE id=$2 RETURNING id,role,name,login,token_ver',[bcrypt.hashSync(new_pass,10), u.id]);
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
function monthPerNow(){ const d=new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
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
// ЗАКУП (снабженец или руководитель) → реальный расход из котла, падает в АНАЛИТИКУ (Сырьё/Операционка), НЕ в ленту (hideFeed).
async function bookSupplyExpense(amount, category, note, kassaId, who, db, per){
  const cat = (category==='Сырьё') ? 'Сырьё' : 'Операционка';
  return bookPot({ id:'supx_'+kassaId, ts:Date.now(), per:per||monthPerNow(), kind:'out', acc:'BORZO', project:'BORZO',
    amount: money(amount), category: cat, who: who||'snab', note: note||'закуп снабжения', supplyExpense:true, hideFeed:true, supplyTxId:kassaId }, db);
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
  const r = await pool.query(`UPDATE kassa_tx SET status='accepted' WHERE id=$1 AND kind='issue' AND status='wait' RETURNING id, amount`,[req.params.id]);
  if(!r.rowCount) return res.status(400).json({error:'нечего подтверждать'});
  // подтверждённая выдача → видимая строка в ленте Финансов (не расход)
  await bookSupplyIssue(r.rows[0].amount, r.rows[0].id);
  res.json({ ok:true });
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
  let docDate = String(req.body.docDate||'').trim().slice(0,10);
  if(docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) docDate = '';
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
      // защита от дублей: тот же № накладной ИЛИ те же позиции+сумма+категория в ту же дату документа
      const dupR = await c.query("SELECT to_timestamp(ts/1000) t FROM kassa_tx WHERE kind='expense' AND ((COALESCE(inv_no,'')<>'' AND inv_no=$2) OR (sig=$1 AND ($3='' OR COALESCE(doc_date,'')=$3))) ORDER BY ts DESC LIMIT 1",[sig, invNo||' ', docDate]);
      const isDup = dupR.rowCount>0;
      await c.query(`INSERT INTO kassa_tx(id,kind,ts,amount,category,items,invoice,receipt,created_by,sig,dup,inv_no,rec_no,doc_date,req_id) VALUES($1,'expense',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, now, amount, req.body.category||'Сырьё', JSON.stringify(cleanItems), invoice, receipt, creator, sig, isDup, invNo, recNo, docDate, reqId]);
      for(const i of cleanItems){
        if((i.cat||'')!=='Сырьё') continue;   // на склад попадает ТОЛЬКО сырьё; операционка (ремонт, доставка, услуги) не складируется
        await c.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [now, new Date(now).toLocaleString('ru-RU'), i.name, i.qty, i.unit, i.price, i.sum, i.cat, id]);
      }
      const potBooked = await bookSupplyExpense(amount, req.body.category, noteTxt, id, who, c);
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
      await unbookPot('supx_'+tx.id, c);   // снять расход из котла — в той же транзакции
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
      let docDate = (req.body.docDate!=null) ? String(req.body.docDate).trim().slice(0,10) : (tx.doc_date||'');
      if(docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) docDate = '';
      await c.query('UPDATE kassa_tx SET amount=$1, category=$2, items=$3, inv_no=$4, rec_no=$5, doc_date=$6 WHERE id=$7',[amount, cat, JSON.stringify(cleanItems), invNo, recNo, docDate, tx.id]);
      await c.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
      for(const i of cleanItems){
        if((i.cat||'')!=='Сырьё') continue;   // склад — только сырьё; смена категории на операционку убирает позицию со склада
        await c.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [Number(tx.ts), new Date(Number(tx.ts)).toLocaleString('ru-RU'), i.name, i.qty, i.unit, i.price, i.sum, i.cat, tx.id]);
      }
      // перепровести в котле: снять старую, записать новую — СОХРАНЯЯ месяц исходной операции (аудит #18: правка не переносит расход в текущий месяц)
      await unbookPot('supx_'+tx.id, c);
      const origPer = new Date(new Date(Number(tx.ts)).getFullYear(), new Date(Number(tx.ts)).getMonth(), 1).getTime();
      const names = cleanItems.map(i=>i.name).filter(Boolean).slice(0,3).join(', ');
      await bookSupplyExpense(amount, cat, 'закуп Руслана'+(names?': '+names:''), tx.id, 'ruslan', c, origPer);
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
        if(tx.kind==='expense') await unbookPot('supx_'+tx.id, c);   // закуп — снять расход из котла
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
            [Number(tx.ts), new Date(Number(tx.ts)).toLocaleString('ru-RU'), i.name, i.qty, i.unit, i.price, i.sum!=null?i.sum:rowSum(i), (i.cat||effCat), tx.id]);
        }
      }
      // ПЕРЕПРОВЕСТИ КОТЁЛ при согласованной правке закупа (аудит #5): иначе supx_ остаётся на старой сумме/категории
      if(tx.kind==='expense' && (('amount' in next) || ('category' in next))){
        const newAmount = ('amount' in next) ? next.amount : money(tx.amount);
        const newCat = ('category' in next) ? next.category : tx.category;
        const origPer = new Date(new Date(Number(tx.ts)).getFullYear(), new Date(Number(tx.ts)).getMonth(), 1).getTime();
        const ur = await c.query('SELECT role FROM users WHERE id=$1',[tx.created_by]);
        const who = (ur.rows[0] && ur.rows[0].role==='sup') ? 'snab' : 'ruslan';
        await unbookPot('supx_'+tx.id, c);
        const nm = (next.items||tx.items||[]).map(i=>i&&i.name).filter(Boolean).slice(0,3).join(', ');
        await bookSupplyExpense(newAmount, newCat, 'закуп (правка согласована)'+(nm?': '+nm:''), tx.id, who, c, origPer);
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
  'Если позиций нет — items пустой массив.';
app.post('/api/scan', auth, async (req,res)=>{
  const image = req.body.image;
  if(!image || String(image).indexOf('data:')!==0) return res.status(400).json({error:'нет изображения'});
  const key = process.env.OPENROUTER_API_KEY;
  if(!key) return res.status(500).json({error:'сканер не настроен'});
  try{
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
    let txt = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    txt = String(txt).replace(/```json/gi,'').replace(/```/g,'').trim();
    let parsed = null;
    try { parsed = JSON.parse(txt); }
    catch(e){ const m = txt.match(/\{[\s\S]*\}/) || txt.match(/\[[\s\S]*\]/); if(m){ try{ parsed = JSON.parse(m[0]); }catch(e2){} } }
    let items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
    let number = (parsed && !Array.isArray(parsed) && parsed.number!=null) ? String(parsed.number).trim().slice(0,40) : '';
    let docDate = (parsed && !Array.isArray(parsed) && parsed.date!=null) ? String(parsed.date).trim().slice(0,10) : '';
    if(docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) docDate = '';
    items = items.filter(function(i){return i && (i.name||'').toString().trim();}).map(function(i){
      var unit = ['шт','м','л','кг'].indexOf(i.unit)>=0 ? i.unit : 'шт';
      return { name:String(i.name).slice(0,120), qty:String(i.qty==null?'':i.qty), unit:unit, price:String(i.price==null?'':i.price).replace(/[^\d.]/g,'') };
    });
    const usage = d.usage || {};
    console.log('[scan] items='+items.length+' num='+(number||'-')+' date='+(docDate||'-')+' tokens='+(usage.total_tokens||'?'));
    res.json({ items: items, number: number, date: docDate });
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

app.get('/api/health', (req,res)=> res.json({ ok:true }));

// глобальный обработчик ошибок Express (аудит #14): любая ошибка → 500, а не зависший запрос
app.use((err, req, res, next)=>{ console.error('unhandled route error', err&&err.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'}); });
// подстраховка: необработанный промис не должен ронять процесс (systemd перезапустит, но лучше логировать и жить)
process.on('unhandledRejection', (reason)=>{ console.error('unhandledRejection', reason && (reason.message||reason)); });

initSchema().then(()=>{
  if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive:true });
  app.listen(PORT, ()=> console.log('BORZO server on :'+PORT));
}).catch(e=>{ console.error('init error', e); process.exit(1); });
