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
  `);
}

// ---------- утилиты ----------
function money(n){ return Math.round(+n||0); }
async function balance() {
  const r = await pool.query(`
    SELECT COALESCE(SUM(CASE WHEN kind='issue' AND status='accepted' THEN amount
                             WHEN kind='expense' THEN -amount ELSE 0 END),0) AS b FROM kassa_tx`);
  return money(r.rows[0].b);
}
function rowSum(i){ return (parseFloat(i.qty)||0)*(parseFloat(i.price)||0); }
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

// ---------- касса ----------
app.get('/api/kassa', auth, async (req,res)=>{
  const tx = await pool.query('SELECT * FROM kassa_tx ORDER BY ts DESC');
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
  const r = await pool.query(`UPDATE kassa_tx SET status='accepted' WHERE id=$1 AND kind='issue' AND status='wait' RETURNING id`,[req.params.id]);
  if(!r.rowCount) return res.status(400).json({error:'нечего подтверждать'});
  res.json({ ok:true });
});

// расход (снабженец)
app.post('/api/kassa/expense', auth, requireRole('sup'), async (req,res)=>{
  const amount = money(req.body.amount);
  const items = Array.isArray(req.body.items)? req.body.items : [];
  const invoice = savePhoto(req.body.invoice);
  const receipt = savePhoto(req.body.receipt);
  if(amount<=0) return res.status(400).json({error:'укажите сумму'});
  if(!invoice && !receipt) return res.status(400).json({error:'нужен документ: накладная или чек'});
  if(amount > await balance()) return res.status(400).json({error:'нельзя списать больше, чем в кассе'});
  const id = crypto.randomUUID(), now = Date.now();
  const cleanItems = items.filter(i=>(i.name||'').trim()).map(i=>({name:String(i.name).trim(),qty:i.qty||'',unit:i.unit||'шт',price:i.price||'',sum:rowSum(i),cat:i.cat||req.body.category}));
  await pool.query(`INSERT INTO kassa_tx(id,kind,ts,amount,category,items,invoice,receipt,created_by) VALUES($1,'expense',$2,$3,$4,$5,$6,$7,$8)`,
    [id, now, amount, req.body.category||'Сырьё', JSON.stringify(cleanItems), invoice, receipt, req.user.id]);
  for(const i of cleanItems){
    await pool.query(`INSERT INTO sklad_intake(ts,date,name,qty,unit,price,sum,category,tx_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [now, new Date(now).toLocaleString('ru-RU'), i.name, i.qty, i.unit, i.price, i.sum, i.cat, id]);
  }
  res.json({ ok:true, id });
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

app.get('/api/health', (req,res)=> res.json({ ok:true }));

initSchema().then(()=>{
  if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive:true });
  app.listen(PORT, ()=> console.log('BORZO server on :'+PORT));
}).catch(e=>{ console.error('init error', e); process.exit(1); });
