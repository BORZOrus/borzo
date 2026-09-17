/* BORZO-пульт — бэкенд: касса, логины, роли. Node/Express + PostgreSQL. */
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
  `);
}

// ---------- утилиты ----------
function money(n){ return Math.round(+n||0); }
// касса снабженца = выдано и принято − потрачено СНАБЖЕНЦЕМ. Закупы руководителя (его деньги/общая касса) подотчёт не уменьшают.
async function balance() {
  const r = await pool.query(`
    SELECT COALESCE(SUM(CASE WHEN k.kind='issue' AND k.status='accepted' THEN k.amount
                             WHEN k.kind='expense' AND u.role='sup' THEN -k.amount ELSE 0 END),0) AS b
    FROM kassa_tx k LEFT JOIN users u ON u.id=k.created_by`);
  return money(r.rows[0].b);
}
function numf(v){ return parseFloat(String(v==null?'':v).replace(',','.'))||0; }  // 25,2 → 25.2
function rowSum(i){ return numf(i.qty)*numf(i.price); }
function savePhoto(dataUrl){
  if(!dataUrl || typeof dataUrl!=='string' || dataUrl.indexOf('data:')!==0) return null;
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if(!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg','jpg');
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
function sign(u){ return jwt.sign({ id:u.id, role:u.role, name:u.name, login:u.login }, JWT_SECRET, { expiresIn:'30d' }); }
function auth(req,res,next){
  const h = req.headers.authorization||'';
  const t = h.indexOf('Bearer ')===0 ? h.slice(7) : null;
  if(!t) return res.status(401).json({error:'нет токена'});
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch(e){ return res.status(401).json({error:'токен недействителен'}); }
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
  await pool.query('UPDATE users SET pass_hash=$1 WHERE id=$2',[bcrypt.hashSync(new_pass,10), u.id]);
  res.json({ ok:true });
});

// ---------- котёл (Финансы) ↔ снабжение: стык без задвоения ----------
// Общий помощник: дописать операцию в fin_state (котёл). Возвращает false, если котла ещё нет (финданные не залиты).
async function bookPot(op){
  const r = await pool.query('SELECT data FROM fin_state WHERE id=1');
  if(!r.rowCount) return false;
  const data = r.rows[0].data || {};
  if(!Array.isArray(data.ops)) return false;
  // идемпотентность: не дублируем по supplyTxId+вид
  if(op.id && data.ops.some(x=>x && x.id===op.id)) return true;
  data.ops.unshift(op);
  await pool.query('UPDATE fin_state SET data=$1, rev=rev+1, updated_at=$2 WHERE id=1', [JSON.stringify(data), Date.now()]);
  return true;
}
function monthPerNow(){ const d=new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
// снять операцию из котла по id (при удалении/правке закупа руководителя)
async function unbookPot(id){
  const r = await pool.query('SELECT data FROM fin_state WHERE id=1');
  if(!r.rowCount) return false;
  const data = r.rows[0].data || {};
  if(!Array.isArray(data.ops)) return false;
  const before = data.ops.length;
  data.ops = data.ops.filter(x=> !(x && x.id===id));
  if(data.ops.length===before) return false;
  await pool.query('UPDATE fin_state SET data=$1, rev=rev+1, updated_at=$2 WHERE id=1', [JSON.stringify(data), Date.now()]);
  return true;
}
// ЗАКУП (снабженец или руководитель) → реальный расход из котла, падает в АНАЛИТИКУ (Сырьё/Общие), НЕ в ленту (hideFeed).
async function bookSupplyExpense(amount, category, note, kassaId, who){
  const cat = (category==='Сырьё') ? 'Сырьё' : 'Общие';
  return bookPot({ id:'supx_'+kassaId, ts:Date.now(), per:monthPerNow(), kind:'out', acc:'BORZO', project:'BORZO',
    amount: money(amount), category: cat, who: who||'snab', note: note||'закуп снабжения', supplyExpense:true, hideFeed:true, supplyTxId:kassaId });
}
// ВЫДАЧА снабженцу → видимая строка в ленте Финансов (Руслан+Ульяна), НЕ расход (котёл не трогает, из аналитики исключена).
async function bookSupplyIssue(amount, kassaId){
  return bookPot({ id:'supi_'+kassaId, ts:Date.now(), per:monthPerNow(), kind:'issue', project:'BORZO',
    amount: money(amount), category:'Выдано снабженцу', who:'ruslan', supplyIssue:true, supplyTxId:kassaId });
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
  if(amount<=0) return res.status(400).json({error:'укажите сумму'});
  // документ обязателен снабженцу; руководитель может закупаться без чека/накладной
  if(req.user.role==='sup' && !invoice && !receipt) return res.status(400).json({error:'нужен документ: накладная или чек'});
  // ограничение «не больше кассы» — только для снабженца (его подотчёт). Руководитель тратит свои/общие деньги.
  if(req.user.role==='sup' && amount > await balance()) return res.status(400).json({error:'нельзя списать больше, чем в кассе'});
  const id = crypto.randomUUID(), now = Date.now();
  const norm = v => String(v==null?'':v).replace(',','.');  // 25,2 → 25.2 для склада
  const cleanItems = items.filter(i=>(i.name||'').trim()).map(i=>({name:String(i.name).trim(),qty:norm(i.qty),unit:i.unit||'шт',price:norm(i.price),sum:rowSum(i),cat:i.cat||req.body.category}));
  await pool.query(`INSERT INTO kassa_tx(id,kind,ts,amount,category,items,invoice,receipt,created_by) VALUES($1,'expense',$2,$3,$4,$5,$6,$7,$8)`,
    [id, now, amount, req.body.category||'Сырьё', JSON.stringify(cleanItems), invoice, receipt, req.user.id]);
  for(const i of cleanItems){
    await pool.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [now, new Date(now).toLocaleString('ru-RU'), i.name, i.qty, i.unit, i.price, i.sum, i.cat, id]);
  }
  // любой закуп (снабженец или руководитель) → расход из котла в аналитику Финансов (не в ленту)
  const names = cleanItems.map(i=>i.name).filter(Boolean).slice(0,3).join(', ');
  const who = req.user.role==='mgr' ? 'ruslan' : 'snab';
  const noteTxt = (req.user.role==='mgr'?'закуп Руслана':'закуп снабженца')+(names?': '+names:'');
  const potBooked = await bookSupplyExpense(amount, req.body.category, noteTxt, id, who);
  res.json({ ok:true, id, potBooked });
});

// удаление СВОЕГО закупа руководителем — без согласования (только expense, созданный mgr)
app.post('/api/kassa/expense/:id/delete', auth, requireRole('mgr'), async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx || tx.kind!=='expense') return res.status(404).json({error:'не найдено'});
  if(tx.created_by !== req.user.id) return res.status(403).json({error:'можно удалять только свой закуп'});
  await pool.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
  await pool.query('DELETE FROM kassa_tx WHERE id=$1',[tx.id]);
  await unbookPot('supx_'+tx.id);   // снять расход из котла
  res.json({ ok:true });
});
// прямая правка СВОЕГО закупа руководителем — без согласования
app.post('/api/kassa/expense/:id/edit', auth, requireRole('mgr'), async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx || tx.kind!=='expense') return res.status(404).json({error:'не найдено'});
  if(tx.created_by !== req.user.id) return res.status(403).json({error:'можно править только свой закуп'});
  const amount = money(req.body.amount);
  if(amount<=0) return res.status(400).json({error:'укажите сумму'});
  const items = Array.isArray(req.body.items)? req.body.items : [];
  const norm = v => String(v==null?'':v).replace(',','.');
  const cat = req.body.category || tx.category;
  const cleanItems = items.filter(i=>(i.name||'').trim()).map(i=>({name:String(i.name).trim(),qty:norm(i.qty),unit:i.unit||'шт',price:norm(i.price),sum:rowSum(i),cat:i.cat||cat}));
  await pool.query('UPDATE kassa_tx SET amount=$1, category=$2, items=$3 WHERE id=$4',[amount, cat, JSON.stringify(cleanItems), tx.id]);
  await pool.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
  for(const i of cleanItems){
    await pool.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [Number(tx.ts), new Date(Number(tx.ts)).toLocaleString('ru-RU'), i.name, i.qty, i.unit, i.price, i.sum, i.cat, tx.id]);
  }
  // перепровести в котле: снять старую, записать новую
  await unbookPot('supx_'+tx.id);
  const names = cleanItems.map(i=>i.name).filter(Boolean).slice(0,3).join(', ');
  await bookSupplyExpense(amount, cat, 'закуп Руслана'+(names?': '+names:''), tx.id, 'ruslan');
  res.json({ ok:true });
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
app.post('/api/kassa/:id/propose', auth, async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx) return res.status(404).json({error:'не найдено'});
  const next = req.body.next||{};
  if(!genericDiff(tx,next).length) return res.status(400).json({error:'нет изменений'});
  const pending = { by:req.user.role, next, note:req.body.note||'', t:Date.now() };
  await pool.query('UPDATE kassa_tx SET pending=$1 WHERE id=$2',[JSON.stringify(pending), tx.id]);
  res.json({ ok:true });
});
// одобрить изменение (противоположная сторона)
app.post('/api/kassa/:id/approve', auth, async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx || !tx.pending) return res.status(400).json({error:'нечего одобрять'});
  if(tx.pending.by===req.user.role) return res.status(403).json({error:'изменение одобряет вторая сторона'});
  const next = tx.pending.next;
  const entry = { t:Date.now(), by:tx.pending.by, approver:req.user.role, changes:genericDiff(tx,next), note:tx.pending.note };
  const log = (tx.log||[]).concat([entry]);
  const fields=[], vals=[]; let n=1;
  ['amount','source','category','items'].forEach(k=>{ if(k in next){ fields.push(k+'=$'+n); vals.push(k==='items'?JSON.stringify(next[k]):next[k]); n++; } });
  fields.push('pending=NULL'); fields.push('log=$'+n); vals.push(JSON.stringify(log)); n++;
  vals.push(tx.id);
  await pool.query(`UPDATE kassa_tx SET ${fields.join(', ')} WHERE id=$${n}`, vals);
  // если у расхода изменились позиции — пересобрать приход на склад
  if(tx.kind==='expense' && ('items' in next)){
    await pool.query('DELETE FROM sklad_intake WHERE tx_id=$1',[tx.id]);
    const items = next.items||[];
    for(const i of items){
      await pool.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [Number(tx.ts), new Date(Number(tx.ts)).toLocaleString('ru-RU'), i.name, i.qty, i.unit, i.price, i.sum!=null?i.sum:rowSum(i), i.cat||next.category||tx.category, tx.id]);
    }
  }
  res.json({ ok:true });
});
// отклонить изменение
app.post('/api/kassa/:id/reject', auth, async (req,res)=>{
  const r = await pool.query('SELECT * FROM kassa_tx WHERE id=$1',[req.params.id]);
  const tx = r.rows[0];
  if(!tx || !tx.pending) return res.status(400).json({error:'нечего отклонять'});
  if(tx.pending.by===req.user.role) return res.status(403).json({error:'решает вторая сторона'});
  const entry = { t:Date.now(), by:tx.pending.by, approver:req.user.role, rejected:true, changes:genericDiff(tx,tx.pending.next), note:tx.pending.note };
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
  'Извлеки все позиции товаров. Верни СТРОГО валидный JSON-массив без пояснений и без markdown, каждый элемент: '+
  '{"name": "наименование", "qty": "количество числом", "unit": "одно из: шт, м, л, кг", "price": "цена за ЕДИНИЦУ числом без пробелов и валюты"}. '+
  'Если в накладной дана сумма по строке, а не цена за единицу — раздели сумму на количество. '+
  'Единицу измерения приведи к шт, м, л или кг (штуки/листы/рулоны/комплекты → шт; метры/погонные метры/метраж плёнки → м; литры → л; килограммы → кг). '+
  'Если ничего не распознал — верни [].';
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
    let items = [];
    try { items = JSON.parse(txt); }
    catch(e){ const m = txt.match(/\[[\s\S]*\]/); if(m){ try{ items = JSON.parse(m[0]); }catch(e2){} } }
    if(!Array.isArray(items)) items = [];
    items = items.filter(function(i){return i && (i.name||'').toString().trim();}).map(function(i){
      var unit = ['шт','м','л','кг'].indexOf(i.unit)>=0 ? i.unit : 'шт';
      return { name:String(i.name).slice(0,120), qty:String(i.qty==null?'':i.qty), unit:unit, price:String(i.price==null?'':i.price).replace(/[^\d.]/g,'') };
    });
    // лог расхода на ИИ (лёгкий счётчик)
    const usage = d.usage || {};
    console.log('[scan] items='+items.length+' tokens='+(usage.total_tokens||'?'));
    res.json({ items: items });
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
  // сохраняем ТЕКУЩИЕ серверные операции-связки (закупы/выдачи из кассы), игнорируя присланные клиентом — чтобы финмодуль их не затирал
  const cur = await pool.query('SELECT data FROM fin_state WHERE id=1');
  const serverSupply = (cur.rowCount && cur.rows[0].data && Array.isArray(cur.rows[0].data.ops)) ? cur.rows[0].data.ops.filter(isSupplyOp) : [];
  data.ops = data.ops.filter(o=>!isSupplyOp(o)).concat(serverSupply).sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
  const r = await pool.query(`
    INSERT INTO fin_state(id,data,rev,updated_by,updated_at) VALUES(1,$1,1,$2,$3)
    ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, rev=fin_state.rev+1, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at
    RETURNING rev`, [JSON.stringify(data), req.user.id, Date.now()]);
  res.json({ ok:true, rev:r.rows[0].rev });
});

app.get('/api/health', (req,res)=> res.json({ ok:true }));

initSchema().then(()=>{
  if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive:true });
  app.listen(PORT, ()=> console.log('BORZO server on :'+PORT));
}).catch(e=>{ console.error('init error', e); process.exit(1); });
