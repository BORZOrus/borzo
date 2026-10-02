/* CRM MVP. Only crm_* tables; existing auth, transaction and upload helpers are injected. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const GATE = 7381, REQUEST = 7382, PHONE = 7383;

// ---- Сейф ключей агента: AES-256-GCM, ключ шифрования выводится из серверного секрета (в БД лежит только шифртекст) ----
const SECRET_NAMES = ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GOOGLE_API_KEY','GOOGLE_TRANSLATE_API_KEY','DEEPGRAM_API_KEY','ELEVENLABS_API_KEY','OPENROUTER_API_KEY','D360_API_KEY'];
const SECRETS_KEY = crypto.createHash('sha256').update(process.env.SECRETS_KEY || process.env.JWT_SECRET || 'borzo-secrets-fallback').digest();
function encSecret(plain){
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', SECRETS_KEY, iv);
  const enc = Buffer.concat([c.update(String(plain),'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decSecret(b64){
  const raw = Buffer.from(b64,'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', SECRETS_KEY, raw.subarray(0,12));
  d.setAuthTag(raw.subarray(12,28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
// внутреннее чтение ключа сервером в момент вызова (наружу НЕ отдаётся)
async function getSecret(pool, name){ try{ const r=await pool.query('SELECT val FROM crm_secrets WHERE name=$1',[name]); return r.rowCount ? decSecret(r.rows[0].val) : ''; }catch(e){ return ''; } }
// реальная проверка ключа: лёгкий запрос к провайдеру. Возвращает {ok, detail}
async function checkProvider(name, key){
  const opt = (h)=>({ headers:h, signal: AbortSignal.timeout(7000) });
  try{
    let r;
    if(name==='ANTHROPIC_API_KEY') r=await fetch('https://api.anthropic.com/v1/models', opt({'x-api-key':key,'anthropic-version':'2023-06-01'}));
    else if(name==='OPENAI_API_KEY') r=await fetch('https://api.openai.com/v1/models', opt({'Authorization':'Bearer '+key}));
    else if(name==='GOOGLE_API_KEY') r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?key='+encodeURIComponent(key), opt({}));
    else if(name==='GOOGLE_TRANSLATE_API_KEY'){
      // реальный тест-перевод: 200 = ключ рабочий; 400/403 = ключ неверный / Translate API не включён; 429 = лимит/нет средств
      r=await fetch('https://translation.googleapis.com/language/translate/v2?key='+encodeURIComponent(key), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:'тест',target:'en',format:'text'}),signal:AbortSignal.timeout(7000)});
      if(r.ok) return { ok:true, detail:'ключ рабочий' };
      const bad=(r.status===400||r.status===401||r.status===403);
      return { ok:false, detail: bad ? ('ключ неверный или не включён Cloud Translation API ('+r.status+')') : (r.status===429 ? 'превышен лимит / нет средств (429)' : ('провайдер ответил '+r.status)) };
    }
    else if(name==='OPENROUTER_API_KEY') r=await fetch('https://openrouter.ai/api/v1/key', opt({'Authorization':'Bearer '+key}));
    else if(name==='DEEPGRAM_API_KEY') r=await fetch('https://api.deepgram.com/v1/projects', opt({'Authorization':'Token '+key}));
    else if(name==='ELEVENLABS_API_KEY') r=await fetch('https://api.elevenlabs.io/v1/user', opt({'xi-api-key':key}));
    else if(name==='D360_API_KEY'){
      // 360dialog Cloud API: авторизованный GET конфига вебхука. 401/403 = ключ неверный; иначе ключ принят.
      const base=(process.env.WA_API_URL||'https://waba-v2.360dialog.io').replace(/\/+$/,'');
      r=await fetch(base+'/v1/configs/webhook', opt({'D360-API-KEY':key}));
      const bad = (r.status===401||r.status===403);
      return { ok: !bad, detail: bad ? ('ключ неверный/нет прав (360dialog ответил '+r.status+')') : (r.ok?'ключ рабочий':'ключ принят (360dialog ответил '+r.status+')') };
    }
    else return { ok:false, detail:'проверка не поддержана' };
    return { ok: r.ok, detail: r.ok ? 'ключ рабочий' : ('провайдер ответил '+r.status+(r.status===401||r.status===403?' — ключ неверный/нет прав':'')) };
  }catch(e){ return { ok:false, detail: (e.name==='TimeoutError'?'провайдер не ответил (таймаут)':'ошибка сети: '+(e.message||e)) }; }
}

async function initSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS crm_stages (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      ord INTEGER NOT NULL, is_won BOOLEAN NOT NULL DEFAULT false, is_lost BOOLEAN NOT NULL DEFAULT false,
      CHECK (NOT (is_won AND is_lost))
    );
    CREATE TABLE IF NOT EXISTS crm_clients (
      id SERIAL PRIMARY KEY, ext_id TEXT UNIQUE, name TEXT NOT NULL, phone TEXT,
      instagram TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      rev INTEGER NOT NULL DEFAULT 1, CHECK (phone IS NULL OR phone ~ '^\\+[1-9][0-9]{7,14}$')
    );
    CREATE INDEX IF NOT EXISTS crm_clients_phone_idx ON crm_clients(phone);
    CREATE TABLE IF NOT EXISTS crm_deals (
      id SERIAL PRIMARY KEY, ext_id TEXT UNIQUE, client_id INTEGER NOT NULL REFERENCES crm_clients(id),
      title TEXT NOT NULL, amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(amount >= 0),
      stage_id INTEGER NOT NULL REFERENCES crm_stages(id), manager_id INTEGER REFERENCES users(id),
      source TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      stage_entered_at TIMESTAMPTZ DEFAULT now(), closed_at TIMESTAMPTZ,
      lost_reason TEXT NOT NULL DEFAULT '', items JSONB NOT NULL DEFAULT '[]', ship_date DATE,
      imported_incomplete BOOLEAN NOT NULL DEFAULT false,
      rev INTEGER NOT NULL DEFAULT 1, CHECK(jsonb_typeof(items)='array')
    );
    CREATE INDEX IF NOT EXISTS crm_deals_stage_idx ON crm_deals(stage_id);
    CREATE INDEX IF NOT EXISTS crm_deals_client_idx ON crm_deals(client_id);
    CREATE INDEX IF NOT EXISTS crm_deals_closed_idx ON crm_deals(closed_at);
    CREATE TABLE IF NOT EXISTS crm_events (
      id SERIAL PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES crm_deals(id),
      ts TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL CHECK(kind IN ('note','status','call','msg')),
      text TEXT NOT NULL, author_id INTEGER REFERENCES users(id), author_name TEXT NOT NULL,
      from_stage_id INTEGER REFERENCES crm_stages(id), to_stage_id INTEGER REFERENCES crm_stages(id)
    );
    CREATE INDEX IF NOT EXISTS crm_events_deal_idx ON crm_events(deal_id,ts,id);
    CREATE TABLE IF NOT EXISTS crm_templates (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crm_files (
      id SERIAL PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES crm_deals(id),
      url TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
      author_id INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS crm_requests (
      user_id INTEGER NOT NULL REFERENCES users(id), req_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,req_id)
    );
    CREATE TABLE IF NOT EXISTS crm_import_stages (
      ext_id TEXT PRIMARY KEY, name TEXT NOT NULL, stage_id INTEGER NOT NULL REFERENCES crm_stages(id)
    );
    CREATE TABLE IF NOT EXISTS crm_products (
      id SERIAL PRIMARY KEY, ext_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      price NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK(price >= 0)
    );
    CREATE TABLE IF NOT EXISTS crm_cat_models (
      id SERIAL PRIMARY KEY, type TEXT NOT NULL, base TEXT NOT NULL, name TEXT NOT NULL UNIQUE,
      line TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL DEFAULT 0, archived BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS crm_cat_options (
      id SERIAL PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0,
      UNIQUE(kind,value)
    );
    CREATE TABLE IF NOT EXISTS crm_cat_variants (
      id SERIAL PRIMARY KEY, model_id INTEGER NOT NULL REFERENCES crm_cat_models(id),
      corpus TEXT NOT NULL DEFAULT '', legs TEXT NOT NULL DEFAULT '', len TEXT NOT NULL DEFAULT '', width TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '', ntin TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
      price NUMERIC(16,2) CHECK(price IS NULL OR price >= 0), archived BOOLEAN NOT NULL DEFAULT false,
      UNIQUE(model_id,corpus,legs,len,width)
    );
    CREATE INDEX IF NOT EXISTS crm_cat_variants_model_idx ON crm_cat_variants(model_id);
    ALTER TABLE crm_cat_variants ADD COLUMN IF NOT EXISTS photo TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_cat_variants ADD COLUMN IF NOT EXISTS ord INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS agent_on BOOLEAN NOT NULL DEFAULT true;
    -- профиль-доставка (по Mindsales): город и адрес клиента, время доставки на сделке (дата уже есть — ship_date)
    ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ship_time TEXT NOT NULL DEFAULT '';
    -- частичные оплаты по сделке (Поступления / Остаток). Это витрина продаж CRM, НЕ касса/котёл — деньги там не двигаются.
    CREATE TABLE IF NOT EXISTS crm_payments (
      id SERIAL PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES crm_deals(id),
      amount NUMERIC(16,2) NOT NULL CHECK(amount > 0), ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      note TEXT NOT NULL DEFAULT '', author_id INTEGER REFERENCES users(id), author_name TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS crm_payments_deal_idx ON crm_payments(deal_id, ts, id);
    -- задачи по сделке (Текущие / Завершённые)
    CREATE TABLE IF NOT EXISTS crm_tasks (
      id SERIAL PRIMARY KEY, deal_id INTEGER REFERENCES crm_deals(id),
      title TEXT NOT NULL, due_at TIMESTAMPTZ, done BOOLEAN NOT NULL DEFAULT false, done_at TIMESTAMPTZ,
      author_id INTEGER REFERENCES users(id), author_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS crm_tasks_deal_idx ON crm_tasks(deal_id);
    CREATE INDEX IF NOT EXISTS crm_tasks_open_idx ON crm_tasks(done, due_at);
    -- настройки агента: глобальный тумблер + по стадиям воронки (per-deal override — в crm_deals.agent_override)
    CREATE TABLE IF NOT EXISTS crm_settings (id INTEGER PRIMARY KEY DEFAULT 1, data JSONB NOT NULL DEFAULT '{}');
    INSERT INTO crm_settings(id,data) VALUES(1,'{"agentGlobal":false,"agentStages":{}}') ON CONFLICT(id) DO NOTHING;
    -- точечный перекрыватель агента на сделке: NULL=наследовать (воронка/глобал), true/false=жёстко тут
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS agent_override BOOLEAN;
    -- рекламный источник лида (click-to-WhatsApp): из какого объявления пришёл + ctwa_clid для Meta-атрибуции
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ad_headline TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ad_source_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ctwa_clid TEXT NOT NULL DEFAULT '';
    -- скрипты продаж (магистраль + инструменты): один blob той же формы, что сайт скриптов Руслана (blocks/mainOrder/sectionOrder/sections)
    CREATE TABLE IF NOT EXISTS crm_scripts (
      id INTEGER PRIMARY KEY DEFAULT 1, data JSONB NOT NULL DEFAULT '{}',
      rev INTEGER NOT NULL DEFAULT 0, updated_by INTEGER, updated_at BIGINT
    );
    -- база знаний агента (видимый «шкаф»): инструкция + материалы (фото/ссылки с «когда использовать») + уроки/коррекции.
    -- Это НЕ чат-лог: знания хранятся структурно, поэтому контекст не переполняется — при ответе агент берёт промпт+эту базу, а не историю обучения.
    CREATE TABLE IF NOT EXISTS crm_agent (
      id INTEGER PRIMARY KEY DEFAULT 1, data JSONB NOT NULL DEFAULT '{}',
      rev INTEGER NOT NULL DEFAULT 0, updated_by INTEGER, updated_at BIGINT
    );
    INSERT INTO crm_agent(id,data) VALUES(1,'{"instruction":"","materials":[],"lessons":[]}') ON CONFLICT(id) DO NOTHING;
    INSERT INTO crm_stages(code,name,ord,is_won,is_lost) VALUES
      ('new','Новая заявка',1,false,false), ('working','В работе',2,false,false),
      ('selection','Подбор решения',3,false,false), ('paused','Пауза',4,false,false),
      ('won','Продажа',5,true,false), ('lost','Отказ / Игнор',6,false,true),
      ('junk','Нецелевой',7,false,true)
    ON CONFLICT(code) DO NOTHING;
    -- миграция набора стадий к актуальному (идемпотентно): +Пауза, Выполнено→Продажа, убрать пустой agreed, порядок, поле напоминания
    INSERT INTO crm_stages(code,name,ord,is_won,is_lost) SELECT 'paused','Пауза',4,false,false WHERE NOT EXISTS(SELECT 1 FROM crm_stages WHERE code='paused');
    -- «Нецелевой»: отдельная корзина (не валим в Отказ). Закрывающий этап (is_lost) → помесячный бакет + при новом сообщении история переписки цепляется к сделке (как в WhatsApp)
    INSERT INTO crm_stages(code,name,ord,is_won,is_lost) SELECT 'junk','Нецелевой',7,false,true WHERE NOT EXISTS(SELECT 1 FROM crm_stages WHERE code='junk');
    UPDATE crm_stages SET name='Продажа' WHERE code='won' AND name='Выполнено';
    UPDATE crm_stages SET name='Отказ / Игнор' WHERE code='lost' AND name='Отказ';
    DELETE FROM crm_stages WHERE code='agreed' AND NOT EXISTS(SELECT 1 FROM crm_deals WHERE stage_id=(SELECT id FROM crm_stages WHERE code='agreed'));
    UPDATE crm_stages SET ord=CASE code WHEN 'new' THEN 1 WHEN 'working' THEN 2 WHEN 'selection' THEN 3 WHEN 'paused' THEN 4 WHEN 'won' THEN 5 WHEN 'lost' THEN 6 WHEN 'junk' THEN 7 ELSE ord END;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS remind_fired_at TIMESTAMPTZ;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS pay_method TEXT;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS sale_comment TEXT;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ship_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS writeoff BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ship_track BOOLEAN NOT NULL DEFAULT false;
    -- сейф ключей агента (электроящик): значения ШИФРУЮТСЯ, наружу (в браузер) не отдаются никогда, только статус «есть/нет»
    CREATE TABLE IF NOT EXISTS crm_secrets (
      name TEXT PRIMARY KEY, val TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL DEFAULT ''
    );
    ALTER TABLE crm_secrets ADD COLUMN IF NOT EXISTS ok BOOLEAN;
    ALTER TABLE crm_secrets ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
  `);
}
function err(code, message) { const e = new Error(message); e.httpCode = code; return e; }
function str(v, label, max=200, required=false) {
  if(v != null && typeof v !== 'string' && typeof v !== 'number') throw err(400, label+': нужен текст');
  const s = String(v == null ? '' : v).trim();
  if(s.length > max || (required && !s)) throw err(400, label+': '+(s.length>max?'слишком длинное значение':'заполните поле'));
  return s;
}
function id(v) { const n=Number(v); if(!Number.isSafeInteger(n)||n<1||n>2147483647) throw err(400,'Некорректный ID'); return n; }
function number(v, label, positive=false) {
  if(!['string','number'].includes(typeof v) || String(v).trim()==='') throw err(400,label+': укажите число');
  const s=String(v).trim().replace(',','.');
  const n=Number(s);
  if(!/^\d+(\.\d{1,2})?$/.test(s)||!Number.isFinite(n)||n>1e12||(positive?n<=0:n<0)) throw err(400,label+': некорректное число (до 2 знаков после запятой)');
  return n;
}
function phone(v, required=false) {
  const raw=str(v,'Телефон',50,required);
  if(!raw) return null;
  if(!/^[+\d\s().-]+$/.test(raw)) throw err(400,'Телефон: используйте международный формат +7…');
  let s=raw.replace(/[\s().-]/g,'');
  if(/^8\d{10}$/.test(s)) s='+7'+s.slice(1);
  else if(/^7\d{10}$/.test(s)) s='+'+s;
  else if(/^\d{10}$/.test(s)) s='+7'+s;
  if(!/^\+[1-9]\d{7,14}$/.test(s)||(s.startsWith('+7')&&s.length!==12)) throw err(400,'Телефон: используйте международный формат +7…');
  return s;
}
function date(v, label='Дата отгрузки') {
  if(v == null || v==='') return null;
  const s=str(v,label,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s) throw err(400,label+': нужна существующая дата ГГГГ-ММ-ДД');
  return s;
}
function timestamp(v, label) {
  if(v == null || v==='') return null;
  const t=new Date(v);
  if(!Number.isFinite(t.getTime())) throw err(400,label+': некорректная дата');
  return t.toISOString();
}
function items(v) {
  if(!Array.isArray(v)||v.length>200) throw err(400,'Состав: нужен массив, максимум 200 позиций');
  return v.map(x=>{
    if(!x||typeof x!=='object') throw err(400,'Некорректная позиция');
    const out={name:str(x.name,'Название позиции',200,true),qty:number(x.qty,'Количество',true),price:number(x.price,'Цена')};
    if(x.variant_id!=null && x.variant_id!=='') out.variant_id=id(x.variant_id);   // привязка к варианту каталога (снимок name/price остаётся в позиции)
    return out;
  });
}
function wonCheck(stage, deal) {
  if(stage.is_won && (!deal.items.length || !deal.ship_date)) throw err(400,'Для этапа «Продажа» заполните состав и дату отгрузки');
}
function canonical(x) {
  if(Array.isArray(x)) return x.map(canonical);
  if(x && typeof x==='object') return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
  return x;
}
const DEAL_SELECT = `SELECT d.*, d.ship_date::text AS ship_date, c.name AS client_name, c.phone, c.city, c.address,
  s.name AS stage_name, s.code AS stage_code, s.is_won, s.is_lost, u.name AS manager_name
  FROM crm_deals d JOIN crm_clients c ON c.id=d.client_id
  JOIN crm_stages s ON s.id=d.stage_id LEFT JOIN users u ON u.id=d.manager_id`;
async function stageBy(db,v) {
  const r=await db.query('SELECT * FROM crm_stages WHERE id=$1',[id(v)]);
  if(!r.rowCount) throw err(400,'Этап не найден'); return r.rows[0];
}
async function dealBy(db,v,lock=false) {
  const r=await db.query(lock ? 'SELECT *,ship_date::text AS ship_date FROM crm_deals WHERE id=$1 FOR UPDATE' : DEAL_SELECT+' WHERE d.id=$1',[id(v)]);
  if(!r.rowCount) throw err(404,'Сделка не найдена'); return r.rows[0];
}
function version(row,v) {
  if(!Number.isSafeInteger(v)||v!==row.rev) throw err(409,'Карточку уже изменили. Обновите её и повторите изменение.');
}
async function manager(db,v) {
  const r=await db.query("SELECT id FROM users WHERE id=$1 AND role IN ('mgr','fin')",[id(v)]);
  if(!r.rowCount) throw err(400,'Менеджер не найден'); return r.rows[0].id;
}
async function event(db,user,dealId,kind,text,from=null,to=null) {
  const r=await db.query(`INSERT INTO crm_events(deal_id,kind,text,author_id,author_name,from_stage_id,to_stage_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[dealId,kind,text,user.id,user.name,from,to]);
  return r.rows[0];
}
async function clientCreate(db,b,requirePhone=true) {
  const name=str(b.name,'Имя клиента',200,true), p=phone(b.phone,requirePhone);
  if(p) {
    await db.query('SELECT pg_advisory_xact_lock($1,hashtext($2))',[PHONE,p]);
    const existing=await db.query('SELECT * FROM crm_clients WHERE phone=$1 ORDER BY id LIMIT 1',[p]);
    if(existing.rowCount) return existing.rows[0];
  }
  const r=await db.query(`INSERT INTO crm_clients(name,phone,instagram,source,note,city,address) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name,p,str(b.instagram,'Instagram',200),str(b.source,'Источник',100),str(b.note,'Заметка',10000),str(b.city,'Город',100),str(b.address,'Адрес доставки',300)]);
  return r.rows[0];
}
function register(app, {pool,auth,requireAny,requireRole,withTx,savePhoto,uploadDir,sendPushToRole}) {
  const router=express.Router();
  router.use(auth,requireAny(['mgr','fin']));
  const route=fn=>async(req,res,next)=>{
    try { await fn(req,res); }
    catch(e) {
      if(e.httpCode) return res.status(e.httpCode).json({error:e.message});
      if(e.code==='23505') return res.status(409).json({error:'Такая запись уже существует'});
      next(e);
    }
  };
  const mutate=fn=>route(async(req,res)=>{
    const b=req.body||{}, reqId=str(b.reqId,'reqId',100,true);
    if(!/^[\w-]{8,100}$/.test(reqId)) throw err(400,'Некорректный reqId');
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(canonical({method:req.method,path:req.path,body:b}))).digest('hex');
    const saved=[];
    let out;
    try {
      out=await withTx(async db=>{
        // Import is exclusive; ordinary writes can proceed concurrently, independently of KASSA_LOCK.
        await db.query(req.path==='/import'?'SELECT pg_advisory_xact_lock($1,0)':'SELECT pg_advisory_xact_lock_shared($1,0)',[GATE]);
        await db.query('SELECT pg_advisory_xact_lock($1,hashtext($2))',[REQUEST,req.user.id+':'+reqId]);
        const old=await db.query('SELECT * FROM crm_requests WHERE user_id=$1 AND req_id=$2',[req.user.id,reqId]);
        if(old.rowCount) {
          if(old.rows[0].fingerprint!==fingerprint) throw err(409,'reqId уже использован для другого действия');
          return old.rows[0].response;
        }
        const result=await fn(req,db,saved);
        await db.query('INSERT INTO crm_requests(user_id,req_id,fingerprint,response) VALUES($1,$2,$3,$4)',[req.user.id,reqId,fingerprint,JSON.stringify(result)]);
        return result;
      });
    } catch(e) {
      // Filesystem writes cannot roll back with PostgreSQL; remove files from failed transactions.
      for(const url of saved) { try { fs.unlinkSync(path.join(uploadDir,path.basename(url))); } catch(_) {} }
      throw e;
    }
    res.json(out);
  });
  router.get('/meta',route(async(req,res)=>{
    const [s,u,set]=await Promise.all([pool.query('SELECT * FROM crm_stages ORDER BY ord,id'),pool.query("SELECT id,name,role FROM users WHERE role IN ('mgr','fin') ORDER BY id"),pool.query('SELECT data FROM crm_settings WHERE id=1')]);
    const cfg=(set.rowCount&&set.rows[0].data)||{};
    res.json({stages:s.rows,managers:u.rows,user_id:req.user.id,agentGlobal:cfg.agentGlobal===true,agentStages:cfg.agentStages||{}});
  }));
  // настройки агента: глобальный тумблер и по стадиям (код стадии → вкл/выкл)
  router.get('/agent-settings',route(async(req,res)=>{
    const r=await pool.query('SELECT data FROM crm_settings WHERE id=1'); const c=(r.rowCount&&r.rows[0].data)||{};
    res.json({agentGlobal:c.agentGlobal===true,agentStages:c.agentStages||{}});
  }));
  router.post('/agent-settings',mutate(async(req,db)=>{
    const r=await db.query('SELECT data FROM crm_settings WHERE id=1 FOR UPDATE'); const c=(r.rowCount&&r.rows[0].data)||{agentGlobal:false,agentStages:{}};
    if(!c.agentStages)c.agentStages={};
    if('global' in req.body) c.agentGlobal=req.body.global===true;
    if('stageCode' in req.body){
      const code=str(req.body.stageCode,'Стадия',60,true);
      if(req.body.value===null||req.body.value==='inherit') delete c.agentStages[code];
      else c.agentStages[code]=req.body.value===true;
    }
    await db.query('UPDATE crm_settings SET data=$1 WHERE id=1',[JSON.stringify(c)]);
    return {agentGlobal:c.agentGlobal===true,agentStages:c.agentStages};
  }));
  router.get('/clients',route(async(req,res)=>{
    const q=str(req.query.q,'Поиск',200), digits=q.replace(/\D/g,'');
    const r=await pool.query(`SELECT c.*, (SELECT count(*)::int FROM crm_deals d WHERE d.client_id=c.id) AS deals_count
      FROM crm_clients c WHERE $1='' OR strpos(lower(c.name),lower($1))>0 OR ($2<>'' AND strpos(c.phone,$2)>0)
      ORDER BY c.updated_at DESC,c.id DESC`,[q,digits]); res.json({clients:r.rows});
  }));
  router.get('/clients/:id',route(async(req,res)=>{
    const r=await pool.query('SELECT * FROM crm_clients WHERE id=$1',[id(req.params.id)]);
    if(!r.rowCount) throw err(404,'Клиент не найден');
    const d=await pool.query(DEAL_SELECT+' WHERE d.client_id=$1 ORDER BY d.created_at DESC NULLS LAST,d.id DESC',[id(req.params.id)]);
    res.json({client:r.rows[0],deals:d.rows});
  }));
  router.post('/clients',mutate(async(req,db)=>({client:await clientCreate(db,req.body)})));
  router.patch('/clients/:id',mutate(async(req,db)=>{
    const r=await db.query('SELECT * FROM crm_clients WHERE id=$1 FOR UPDATE',[id(req.params.id)]);
    if(!r.rowCount) throw err(404,'Клиент не найден');
    version(r.rows[0],req.body.baseRev);
    const c={...r.rows[0]}, b=req.body;
    for(const k of ['name','instagram','source','note','city','address']) if(k in b) c[k]=str(b[k],k,k==='note'?10000:k==='address'?300:k==='source'||k==='city'?100:200,k==='name');
    if('phone' in b) c.phone=phone(b.phone);
    const out=await db.query(`UPDATE crm_clients SET name=$1,phone=$2,instagram=$3,source=$4,note=$5,city=$6,address=$7,rev=rev+1,updated_at=now() WHERE id=$8 RETURNING *`,[c.name,c.phone,c.instagram,c.source,c.note,c.city,c.address,c.id]);
    return {client:out.rows[0]};
  }));
  router.get('/deals',route(async(req,res)=>{
    res.json({deals:(await pool.query(DEAL_SELECT+' ORDER BY d.updated_at DESC,d.id DESC')).rows});
  }));
  router.get('/deals/:id',route(async(req,res)=>{
    const d=await dealBy(pool,req.params.id);
    const [f,p,t]=await Promise.all([
      pool.query('SELECT * FROM crm_files WHERE deal_id=$1 ORDER BY id',[d.id]),
      pool.query('SELECT * FROM crm_payments WHERE deal_id=$1 ORDER BY ts,id',[d.id]),
      pool.query('SELECT * FROM crm_tasks WHERE deal_id=$1 ORDER BY done,due_at NULLS LAST,id',[d.id])]);
    const paid=p.rows.reduce((s,x)=>s+Number(x.amount),0);
    res.json({deal:d,files:f.rows,payments:p.rows,paid:paid,due:Math.max(0,Number(d.amount)-paid),tasks:t.rows});
  }));
  // добавить поступление (частичную оплату) по сделке
  router.post('/deals/:id/payments',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id);
    const amount=number(req.body.amount,'Сумма поступления',true);
    const r=await db.query('INSERT INTO crm_payments(deal_id,amount,note,author_id,author_name) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [d.id,amount,str(req.body.note,'Комментарий',300),req.user.id,req.user.name]);
    await event(db,req.user,d.id,'note','💳 Поступление: '+Math.round(amount).toLocaleString('ru-RU')+' ₸'+(req.body.note?' · '+str(req.body.note,'Комментарий',300):''));
    return {payment:r.rows[0]};
  }));
  // удалить поступление (исправление ошибки)
  router.delete('/deals/:id/payments/:pid',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id);
    const r=await db.query('DELETE FROM crm_payments WHERE id=$1 AND deal_id=$2 RETURNING amount',[id(req.params.pid),d.id]);
    if(!r.rowCount) throw err(404,'Поступление не найдено');
    await event(db,req.user,d.id,'note','↩️ Удалено поступление: '+Math.round(Number(r.rows[0].amount)).toLocaleString('ru-RU')+' ₸');
    return {ok:true};
  }));
  // задачи по сделке
  router.post('/deals/:id/tasks',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id);
    const title=str(req.body.title,'Задача',300,true);
    const due=timestamp(req.body.due_at,'Срок');
    const r=await db.query('INSERT INTO crm_tasks(deal_id,title,due_at,author_id,author_name) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [d.id,title,due,req.user.id,req.user.name]);
    return {task:r.rows[0]};
  }));
  router.post('/tasks/:id/done',mutate(async(req,db)=>{
    const done=req.body.done!==false;
    const r=await db.query('UPDATE crm_tasks SET done=$1,done_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$2 RETURNING *',[done,id(req.params.id)]);
    if(!r.rowCount) throw err(404,'Задача не найдена');
    return {task:r.rows[0]};
  }));
  router.delete('/tasks/:id',mutate(async(req,db)=>{
    await db.query('DELETE FROM crm_tasks WHERE id=$1',[id(req.params.id)]); return {ok:true};
  }));
  router.post('/deals',mutate(async(req,db)=>{
    const b=req.body;
    let c;
    if(b.client_id) { c=(await db.query('SELECT * FROM crm_clients WHERE id=$1',[id(b.client_id)])).rows[0]; if(!c) throw err(400,'Клиент не найден'); }
    else { if(!b.client) throw err(400,'Укажите клиента'); c=await clientCreate(db,b.client); }
    const s=b.stage_id?await stageBy(db,b.stage_id):(await db.query("SELECT * FROM crm_stages WHERE code='new'")).rows[0];
    const d={items:items(b.items||[]),ship_date:date(b.ship_date)}; wonCheck(s,d);
    const m=await manager(db,b.manager_id||req.user.id);
    const r=await db.query(`INSERT INTO crm_deals(client_id,title,amount,stage_id,manager_id,source,note,items,ship_date,closed_at,lost_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10 THEN now() ELSE NULL END,$11) RETURNING id`,
      [c.id,str(b.title||c.name,'Название',200,true),number(b.amount==null?0:b.amount,'Сумма'),s.id,m,
        str(b.source==null?c.source:b.source,'Источник',100),str(b.note,'Заметка',10000),JSON.stringify(d.items),d.ship_date,s.is_won||s.is_lost,str(b.lost_reason,'Причина отказа',1000)]);
    await event(db,req.user,r.rows[0].id,'status','Создана заявка → '+s.name,null,s.id);
    return {deal:await dealBy(db,r.rows[0].id)};
  }));
  router.patch('/deals/:id',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id,true), b=req.body; version(d,b.baseRev);
    if('stage_id' in b) throw err(400,'Меняйте этап через действие «Сменить этап»');
    for(const k of ['title','source','note','lost_reason','ship_time']) if(k in b) d[k]=str(b[k],k,k==='note'?10000:k==='lost_reason'?1000:k==='ship_time'?100:k==='source'?100:200,k==='title');
    if('amount' in b) d.amount=number(b.amount,'Сумма');
    if('items' in b) d.items=items(b.items);
    if('ship_date' in b) d.ship_date=date(b.ship_date);
    if('pay_method' in b) d.pay_method=str(b.pay_method,'Оплата',40);
    if('sale_comment' in b) d.sale_comment=str(b.sale_comment,'Комментарий',2000);
    if('manager_id' in b) d.manager_id=await manager(db,b.manager_id);
    const currentStage=await stageBy(db,d.stage_id); wonCheck(currentStage,d);
    if('closed_at' in b){
      if(!currentStage.is_won&&!currentStage.is_lost) throw err(400,'Дата закрытия доступна только закрытой сделке');
      d.closed_at=timestamp(b.closed_at,'Дата закрытия');
      if(!d.closed_at) throw err(400,'Укажите дату закрытия');
    }
    await db.query(`UPDATE crm_deals SET title=$1,amount=$2,manager_id=$3,source=$4,note=$5,items=$6,ship_date=$7,lost_reason=$8,closed_at=$9,ship_time=$10,pay_method=$12,sale_comment=$13,imported_incomplete=false,rev=rev+1,updated_at=now() WHERE id=$11`,
      [d.title,d.amount,d.manager_id,d.source,d.note,JSON.stringify(d.items),d.ship_date,d.lost_reason,d.closed_at,d.ship_time==null?'':d.ship_time,d.id,d.pay_method==null?'':d.pay_method,d.sale_comment==null?'':d.sale_comment]);
    await event(db,req.user,d.id,'note','Обновлены поля сделки');
    return {deal:await dealBy(db,d.id)};
  }));
  router.post('/deals/:id/stage',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id,true), b=req.body; version(d,b.baseRev);
    const previousItems=JSON.stringify(d.items), previousShip=d.ship_date, previousAmount=Number(d.amount);
    if('amount' in b) d.amount=number(b.amount,'Сумма');
    const s=await stageBy(db,b.stage_id), prev=await stageBy(db,d.stage_id);
    if('items' in b) d.items=items(b.items);
    if('ship_date' in b) d.ship_date=date(b.ship_date);
    if('pay_method' in b) d.pay_method=str(b.pay_method,'Оплата',40);
    if('sale_comment' in b) d.sale_comment=str(b.sale_comment,'Комментарий',2000);
    wonCheck(s,d);
    const reason=s.is_lost?str(b.lost_reason||d.lost_reason,'Причина отказа',1000):'';
    if(s.id===d.stage_id) {
      if(d.imported_incomplete||previousItems!==JSON.stringify(d.items)||previousShip!==d.ship_date||previousAmount!==Number(d.amount)) {
        await db.query('UPDATE crm_deals SET items=$1,ship_date=$2,amount=$3,imported_incomplete=false,rev=rev+1,updated_at=now() WHERE id=$4',[JSON.stringify(d.items),d.ship_date,d.amount,d.id]);
        await event(db,req.user,d.id,'note','Обновлены состав, сумма и дата отгрузки');
      }
      return {deal:await dealBy(db,d.id)};
    }
    await db.query(`UPDATE crm_deals SET stage_id=$1,items=$2,ship_date=$3,lost_reason=$4,
      closed_at=CASE WHEN $5 THEN now() ELSE NULL END,imported_incomplete=false,stage_entered_at=now(),updated_at=now(),rev=rev+1,amount=$6,pay_method=$8,sale_comment=$9 WHERE id=$7`,
      [s.id,JSON.stringify(d.items),d.ship_date,reason,s.is_won||s.is_lost,d.amount,d.id,d.pay_method==null?'':d.pay_method,d.sale_comment==null?'':d.sale_comment]);
    await event(db,req.user,d.id,'status',prev.name+' → '+s.name+(reason?' · '+reason:''),prev.id,s.id);
    // авто-взятие: при переходе в РАБОЧИЙ этап (не новый/не продажа/не отказ) без назначенного менеджера — помечаем «взято Ульяной»
    // (ответственная за клиентов; даже если двигал Руслан — клиент её. Ведёт ли АГЕНТ — определяется отдельно по воронке/override и показывается приоритетно).
    if(!s.is_won && !s.is_lost && s.code!=='new' && !d.manager_id){
      const uly=await db.query("SELECT id FROM users WHERE login='ulyana' OR role='fin' ORDER BY (login='ulyana') DESC LIMIT 1");
      if(uly.rowCount) await db.query('UPDATE crm_deals SET manager_id=$1 WHERE id=$2',[uly.rows[0].id,d.id]);
    }
    // новый заказ на отгрузку → пуш производству (пока роли mgr/fin, позже отдельная роль производства)
    if(s.is_won && sendPushToRole){
      const prod = (d.items && d.items.length) ? (d.items[0].name||'заказ') : 'заказ';
      const body = 'Новый заказ на отгрузку: '+prod+(d.ship_date?' · отгрузка '+d.ship_date:'');
      sendPushToRole('mgr',{title:'BORZO · Отгрузки',body:body,url:'/crm.html'}).catch(()=>{});
      sendPushToRole('fin',{title:'BORZO · Отгрузки',body:body,url:'/crm.html'}).catch(()=>{});
    }
    return {deal:await dealBy(db,d.id)};
  }));
  // точечный тумблер агента на сделке: mode on/off/inherit → agent_override true/false/NULL
  router.post('/deals/:id/agent',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id,true);
    const mode=['on','off','inherit'].includes(req.body.mode)?req.body.mode:(req.body.on===true?'on':'off');
    const ov=mode==='on'?true:(mode==='off'?false:null);
    await db.query('UPDATE crm_deals SET agent_override=$1,updated_at=now() WHERE id=$2',[ov,d.id]);
    await event(db,req.user,d.id,'note',mode==='on'?'🤖 Агент включён в этом чате':mode==='off'?'🤖 Агент выключен в этом чате':'🤖 Агент — по воронке (наследует)');
    return {ok:true,agent_override:ov};
  }));
  // напоминание по сделке (для «Паузы»): remind_at ISO или null (снять)
  router.post('/deals/:id/remind',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id,true);
    let ra=null;
    if(req.body.remind_at){ ra=new Date(req.body.remind_at); if(isNaN(ra.getTime())) throw err(400,'Неверная дата напоминания'); }
    await db.query('UPDATE crm_deals SET remind_at=$1,remind_fired_at=NULL,updated_at=now(),rev=rev+1 WHERE id=$2',[ra,d.id]);
    await event(db,req.user,d.id,'note',ra?('⏰ Напоминание на '+new Date(ra).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})):'⏰ Напоминание снято');
    return {deal:await dealBy(db,d.id)};
  }));
  // ---- Электроящик: сейф ключей. ТОЛЬКО руководитель. Значения наружу не отдаём — лишь «есть/нет» ----
  router.get('/secrets',route(async(req,res)=>{
    if(req.user.login!=='ruslan') throw err(403,'Доступ только у руководителя');
    const r=await pool.query('SELECT name,updated_at,ok,checked_at FROM crm_secrets');
    const by={}; r.rows.forEach(x=>by[x.name]=x);
    res.json({ status: SECRET_NAMES.map(function(n){ var x=by[n]||{}; return { name:n, set:!!by[n], updated_at:x.updated_at||null, ok:x.ok===true, checked:!!x.checked_at, checked_at:x.checked_at||null }; }) });
  }));
  router.post('/secrets/check',mutate(async(req,db)=>{
    if(req.user.login!=='ruslan') throw err(403,'Доступ только у руководителя');
    const name=String(req.body.name||''); if(SECRET_NAMES.indexOf(name)<0) throw err(400,'Неизвестный ключ');
    const key=await getSecret(pool,name); if(!key) throw err(400,'Ключ не задан');
    const chk=await checkProvider(name,key);
    await db.query('UPDATE crm_secrets SET ok=$1,checked_at=now() WHERE name=$2',[chk.ok,name]);
    return { name:name, ok:chk.ok, detail:chk.detail };
  }));
  router.post('/secrets',mutate(async(req,db)=>{
    if(req.user.login!=='ruslan') throw err(403,'Доступ только у руководителя');
    const name=String(req.body.name||''); if(SECRET_NAMES.indexOf(name)<0) throw err(400,'Неизвестный ключ');
    const value=String(req.body.value==null?'':req.body.value).trim();
    if(!value){ await db.query('DELETE FROM crm_secrets WHERE name=$1',[name]); return {ok:true,name:name,set:false}; }
    if(value.length>2000) throw err(400,'Слишком длинный ключ');
    await db.query('INSERT INTO crm_secrets(name,val,updated_by) VALUES($1,$2,$3) ON CONFLICT(name) DO UPDATE SET val=$2,updated_at=now(),updated_by=$3',[name,encSecret(value),req.user.login]);
    return {ok:true,name:name,set:true};
  }));
  // Отгрузки: проданные сделки (won) + поставленные на подготовку (ship_track) с данными для производства/доставки
  router.get('/shipments',route(async(req,res)=>{
    const r=await pool.query(`SELECT d.id, d.items, d.ship_date::text AS ship_date, d.ship_time, d.pay_method, d.sale_comment, d.writeoff, d.ship_status, d.ship_track, d.amount, d.closed_at,
        s.is_won, c.name AS client_name, c.phone, c.city, c.address
      FROM crm_deals d JOIN crm_clients c ON c.id=d.client_id JOIN crm_stages s ON s.id=d.stage_id
      WHERE s.is_won OR d.ship_track ORDER BY (d.ship_date IS NULL), d.ship_date, d.id`);
    res.json({shipments:r.rows});
  }));
  // добавить заказ на отгрузку напрямую (заводит/находит клиента в CRM — для точной аналитики, потом продажа)
  router.post('/shipments',mutate(async(req,db)=>{
    const b=req.body;
    const client=await clientCreate(db,{name:b.name,phone:b.phone,city:b.city,address:b.address,source:b.source||'Отгрузка'},false);
    if((b.city||b.address)&&client.id){ await db.query('UPDATE crm_clients SET city=COALESCE(NULLIF($1,\'\'),city),address=COALESCE(NULLIF($2,\'\'),address) WHERE id=$3',[str(b.city,'Город',100),str(b.address,'Адрес',300),client.id]); }
    const st=(await db.query("SELECT * FROM crm_stages WHERE code='selection'")).rows[0] || (await db.query("SELECT * FROM crm_stages WHERE code='new'")).rows[0];
    const its=items(b.items||[]);
    const title=its.length?its[0].name:'Заказ на отгрузку';
    const r=await db.query(`INSERT INTO crm_deals(client_id,title,amount,stage_id,manager_id,source,items,ship_date,ship_track,sale_comment)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING id`,
      [client.id,str(title,'Название',200),number(b.amount||0,'Сумма'),st.id,req.user.id,str(b.source||'Отгрузка','Источник',100),JSON.stringify(its),date(b.ship_date),str(b.sale_comment,'Комментарий',2000)]);
    await event(db,req.user,r.rows[0].id,'note','🚚 Заказ добавлен на подготовку к отгрузке');
    return {deal:await dealBy(db,r.rows[0].id)};
  }));
  router.post('/deals/:id/ship',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id,true);
    if('writeoff' in req.body) await db.query('UPDATE crm_deals SET writeoff=$1,updated_at=now() WHERE id=$2',[req.body.writeoff===true,d.id]);
    if('shipped' in req.body) await db.query('UPDATE crm_deals SET ship_status=$1,updated_at=now() WHERE id=$2',[req.body.shipped===true?'shipped':'',d.id]);
    if('ship_date' in req.body) await db.query('UPDATE crm_deals SET ship_date=$1,updated_at=now() WHERE id=$2',[date(req.body.ship_date),d.id]);
    return {ok:true};
  }));
  router.get('/deals/:id/events',route(async(req,res)=>{
    const d=await dealBy(pool,req.params.id);
    res.json({events:(await pool.query('SELECT * FROM crm_events WHERE deal_id=$1 ORDER BY ts DESC,id DESC',[d.id])).rows});
  }));
  router.post('/deals/:id/events',mutate(async(req,db)=>{
    const d=await dealBy(db,req.params.id), b=req.body;
    if(!['note','call','msg'].includes(b.kind)) throw err(400,'Выберите заметку, звонок или сообщение');
    return {event:await event(db,req.user,d.id,b.kind,str(b.text,'Текст',10000,true))};
  }));
  router.post('/deals/:id/files',mutate(async(req,db,saved)=>{
    const d=await dealBy(db,req.params.id), b=req.body;
    const name=str(b.name,'Имя файла',200,true);
    if(typeof b.data!=='string') throw err(400,'Выберите файл');
    const m=/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.data);
    if(!m) throw err(400,'Разрешены JPEG, PNG, WebP и PDF');
    const buf=Buffer.from(m[2],'base64');
    if(!buf.length||buf.length>5*1024*1024) throw err(400,'Размер файла — до 5 МБ');
    const valid = m[1]==='image/jpeg'?buf.subarray(0,3).equals(Buffer.from([255,216,255])):
      m[1]==='image/png'?buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
      m[1]==='image/webp'?buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP':buf.toString('ascii',0,5)==='%PDF-';
    if(!valid) throw err(400,'Содержимое файла не соответствует формату');
    const url=savePhoto(b.data); if(!url) throw err(400,'Не удалось сохранить файл'); saved.push(url);
    const f=await db.query('INSERT INTO crm_files(deal_id,url,name,mime,author_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[d.id,url,name,m[1],req.user.id]);
    await event(db,req.user,d.id,'note','Прикреплён файл: '+name);
    return {file:f.rows[0]};
  }));
  router.get('/templates',route(async(req,res)=>res.json({templates:(await pool.query('SELECT * FROM crm_templates ORDER BY id')).rows})));
  router.post('/templates',requireRole('mgr'),mutate(async(req,db)=>{
    const r=await db.query('INSERT INTO crm_templates(title,text) VALUES($1,$2) RETURNING *',[str(req.body.title,'Название',200,true),str(req.body.text,'Текст',10000,true)]);
    return {template:r.rows[0]};
  }));
  router.delete('/templates/:id',requireRole('mgr'),mutate(async(req,db)=>{
    await db.query('DELETE FROM crm_templates WHERE id=$1',[id(req.params.id)]); return {ok:true};
  }));
  router.get('/analytics',route(async(req,res)=>{
    // Calendar boundaries are Astana (UTC+05); `to` is inclusive. Cohort conversion is won / created.
    const local=new Date(Date.now()+5*3600000).toISOString().slice(0,10);
    const from=date(req.query.from||local.slice(0,7)+'-01','Начало периода'), to=date(req.query.to||local,'Конец периода');
    if(!from||!to||from>to) throw err(400,'Некорректный период');
    const result=await withTx(async db=>{
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const bounds=[from+'T00:00:00+05:00',to+'T00:00:00+05:00'];
      const stages=await db.query(`SELECT s.*,count(d.id)::int AS count,coalesce(sum(d.amount),0) AS amount
        FROM crm_stages s LEFT JOIN crm_deals d ON d.stage_id=s.id GROUP BY s.id ORDER BY s.ord,s.id`);
      const summary=await db.query(`SELECT count(*)::int AS leads,count(*) FILTER(WHERE s.is_won)::int AS won
        FROM crm_deals d JOIN crm_stages s ON s.id=d.stage_id WHERE d.created_at >= $1::timestamptz AND d.created_at < $2::timestamptz+interval '1 day'`,bounds);
      const sales=await db.query(`SELECT count(*)::int AS sales_count,coalesce(sum(d.amount),0) AS sales_amount
        FROM crm_deals d JOIN crm_stages s ON s.id=d.stage_id WHERE s.is_won AND d.closed_at >= $1::timestamptz AND d.closed_at < $2::timestamptz+interval '1 day'`,bounds);
      const sources=await db.query(`SELECT source,count(*)::int AS count FROM crm_deals WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz+interval '1 day' GROUP BY source ORDER BY count(*) DESC,source`,bounds);
      const missing=await db.query(`SELECT count(*) FILTER(WHERE created_at IS NULL)::int AS undated_leads,
        count(*) FILTER(WHERE (s.is_won OR s.is_lost) AND closed_at IS NULL)::int AS undated_closed,
        count(*) FILTER(WHERE imported_incomplete)::int AS incomplete_won
        FROM crm_deals d JOIN crm_stages s ON s.id=d.stage_id`);
      // метрики базы (за всё время): покупатели, разовые/повторные, средний чек по продажам
      const base=await db.query(`
        WITH wbc AS (
          SELECT d.client_id, count(*)::int AS won_cnt
          FROM crm_deals d JOIN crm_stages s ON s.id=d.stage_id WHERE s.is_won GROUP BY d.client_id
        )
        SELECT (SELECT count(*)::int FROM wbc) AS buyers,
               (SELECT count(*)::int FROM wbc WHERE won_cnt=1) AS one_time,
               (SELECT count(*)::int FROM wbc WHERE won_cnt>1) AS repeat_buyers,
               (SELECT coalesce(round(avg(d.amount)),0) FROM crm_deals d JOIN crm_stages s ON s.id=d.stage_id WHERE s.is_won AND d.amount>0)::int AS avg_check`);
      const c=summary.rows[0]; return {from,to,timezone:'Asia/Almaty',missing:missing.rows[0],stages:stages.rows,...c,...sales.rows[0],base:base.rows[0],conversion:c.leads?Math.round(c.won/c.leads*10000)/100:0,sources:sources.rows};
    }); res.json(result);
  }));
  // ---------- каталог товаров (конструктор: модели × опции × варианты) ----------
  router.get('/catalog',route(async(req,res)=>{
    const [m,o,v]=await Promise.all([
      pool.query('SELECT * FROM crm_cat_models ORDER BY archived,type,ord,name'),
      pool.query('SELECT * FROM crm_cat_options ORDER BY kind,ord,id'),
      pool.query('SELECT * FROM crm_cat_variants ORDER BY model_id,ord,id')]);
    res.json({models:m.rows,options:o.rows,variants:v.rows});
  }));
  router.post('/catalog/models',mutate(async(req,db)=>{
    const b=req.body, type=str(b.type,'Тип',60,true), base=str(b.base,'Серия/база',100,true);
    const name=str(b.name||type+' '+base,'Название модели',200,true);
    const r=await db.query('INSERT INTO crm_cat_models(type,base,name,line) VALUES($1,$2,$3,$4) RETURNING *',[type,base,name,str(b.line,'Линейка',60)]);
    return {model:r.rows[0]};
  }));
  router.patch('/catalog/models/:id',mutate(async(req,db)=>{
    const r=await db.query('SELECT * FROM crm_cat_models WHERE id=$1 FOR UPDATE',[id(req.params.id)]);
    if(!r.rowCount) throw err(404,'Модель не найдена');
    const m={...r.rows[0]}, b=req.body;
    if('name' in b) m.name=str(b.name,'Название',200,true);
    if('archived' in b) m.archived=b.archived===true;
    const out=await db.query('UPDATE crm_cat_models SET name=$1,archived=$2 WHERE id=$3 RETURNING *',[m.name,m.archived,m.id]);
    return {model:out.rows[0]};
  }));
  router.post('/catalog/options',mutate(async(req,db)=>{
    const kind=str(req.body.kind,'Вид опции',40,true), value=str(req.body.value,'Значение',100,true);
    const r=await db.query('INSERT INTO crm_cat_options(kind,value) VALUES($1,$2) ON CONFLICT(kind,value) DO UPDATE SET value=excluded.value RETURNING *',[kind,value]);
    return {option:r.rows[0]};
  }));
  router.post('/catalog/variants',mutate(async(req,db,saved)=>{
    const b=req.body;
    const m=(await db.query('SELECT * FROM crm_cat_models WHERE id=$1',[id(b.model_id)])).rows[0];
    if(!m) throw err(400,'Модель не найдена');
    let photo='';
    if(b.photo){
      if(typeof b.photo!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(b.photo)) throw err(400,'Фото: JPEG/PNG/WebP');
      if(b.photo.length>7*1024*1024) throw err(400,'Фото — до 5 МБ');
      const url=savePhoto(b.photo); if(!url) throw err(400,'Не удалось сохранить фото'); saved.push(url); photo=url;
    }
    const r=await db.query(`INSERT INTO crm_cat_variants(model_id,corpus,legs,len,width,code,ntin,link,price,photo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [m.id,str(b.corpus,'Корпус',60),str(b.legs,'Ножки',60),str(b.len,'Длина',30),str(b.width,'Ширина',30),str(b.code,'Код/артикул',120),str(b.ntin,'NTIN',40),str(b.link,'Ссылка',400),b.price==null||b.price===''?null:number(b.price,'Цена'),photo]);
    return {variant:r.rows[0]};
  }));
  router.patch('/catalog/variants/:id',mutate(async(req,db,saved)=>{
    const r=await db.query('SELECT * FROM crm_cat_variants WHERE id=$1 FOR UPDATE',[id(req.params.id)]);
    if(!r.rowCount) throw err(404,'Вариант не найден');
    const v={...r.rows[0]}, b=req.body;
    if('price' in b) v.price=(b.price==null||b.price==='')?null:number(b.price,'Цена');
    if('code' in b) v.code=str(b.code,'Код',120);
    if('ntin' in b) v.ntin=str(b.ntin,'NTIN',40);
    if('archived' in b) v.archived=b.archived===true;
    for(const k of ['corpus','legs','len','width']) if(k in b) v[k]=str(b[k],k,60);
    if('photo' in b){
      if(b.photo===''||b.photo==null) v.photo='';
      else{
        if(typeof b.photo!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(b.photo)) throw err(400,'Фото: JPEG/PNG/WebP');
        if(b.photo.length>7*1024*1024) throw err(400,'Фото — до 5 МБ');
        const url=savePhoto(b.photo); if(!url) throw err(400,'Не удалось сохранить фото'); saved.push(url); v.photo=url;
      }
    }
    const out=await db.query('UPDATE crm_cat_variants SET price=$1,code=$2,ntin=$3,archived=$4,photo=$5,corpus=$6,legs=$7,len=$8,width=$9 WHERE id=$10 RETURNING *',[v.price,v.code,v.ntin,v.archived,v.photo,v.corpus,v.legs,v.len,v.width,v.id]);
    return {variant:out.rows[0]};
  }));
  // сохранить порядок карточек/вариантов после перетаскивания (массив id в новом порядке)
  router.post('/catalog/reorder',mutate(async(req,db)=>{
    const kind=req.body.kind, ids=req.body.ids;
    if(!['models','variants'].includes(kind)) throw err(400,'kind: models или variants');
    if(!Array.isArray(ids)||!ids.length||ids.length>2000) throw err(400,'ids: массив id в новом порядке');
    const table=kind==='models'?'crm_cat_models':'crm_cat_variants';
    for(let i=0;i<ids.length;i++) await db.query('UPDATE '+table+' SET ord=$1 WHERE id=$2',[i+1,id(ids[i])]);
    return {ok:true,count:ids.length};
  }));
  // порядок КАТЕГОРИЙ (типов): массив имён в нужном порядке, хранится в crm_cat_options kind='typeord'
  router.post('/catalog/typeorder',mutate(async(req,db)=>{
    const types=req.body.types;
    if(!Array.isArray(types)||!types.length||types.length>100) throw err(400,'types: массив названий категорий');
    for(let i=0;i<types.length;i++){
      const t=str(types[i],'Категория',60,true);
      await db.query("INSERT INTO crm_cat_options(kind,value,ord) VALUES('typeord',$1,$2) ON CONFLICT(kind,value) DO UPDATE SET ord=excluded.ord",[t,i+1]);
    }
    return {ok:true};
  }));
  // разовая загрузка каталога из catalog.json (идемпотентно: модель по name, вариант по сочетанию)
  router.post('/catalog/seed',requireRole('mgr'),mutate(async(req,db)=>{
    let src;
    try { src=JSON.parse(fs.readFileSync(path.join(__dirname,'catalog.json'),'utf8')); }
    catch(e) { throw err(500,'catalog.json не найден на сервере'); }
    const counts={models:0,variants:0,skipped:0,options:0};
    const optSeen=new Set((await db.query('SELECT kind,value FROM crm_cat_options')).rows.map(o=>o.kind+'|'+o.value));
    async function opt(kind,value){ if(!value||optSeen.has(kind+'|'+value))return; optSeen.add(kind+'|'+value);
      await db.query('INSERT INTO crm_cat_options(kind,value) VALUES($1,$2) ON CONFLICT DO NOTHING',[kind,value]); counts.options++; }
    for(const it of src.items||[]){
      const type=(it.name||'').split(' ')[0]||'Прочее';
      const mname=(type+' '+(it.base||it.stem||'?')+(it.len?' '+it.len:'')+(it.width?' '+it.width:'')).trim();
      let m=(await db.query('SELECT * FROM crm_cat_models WHERE name=$1',[mname])).rows[0];
      if(!m){ m=(await db.query('INSERT INTO crm_cat_models(type,base,name,line) VALUES($1,$2,$3,$4) RETURNING *',[type,it.base||'?',mname,it.line||''])).rows[0]; counts.models++; }
      await opt('corpus',it.corpus); await opt('legs',it.legs); await opt('len',it.len); await opt('width',it.width);
      const ins=await db.query(`INSERT INTO crm_cat_variants(model_id,corpus,legs,len,width,code,ntin) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(model_id,corpus,legs,len,width) DO NOTHING RETURNING id`,
        [m.id,it.corpus||'',it.legs||'',it.len||'',it.width||'',it.code||'',it.ntin||'']);
      counts[ins.rowCount?'variants':'skipped']++;
    }
    return {ok:true,counts};
  }));
  router.post('/import',requireRole('mgr'),mutate(async(req,db)=>importMindSales(db,req.body,req.user)));
  // ---------- скрипты продаж (магистраль + инструменты) ----------
  router.get('/scripts',route(async(req,res)=>{
    const r=await pool.query('SELECT data,rev,updated_at FROM crm_scripts WHERE id=1');
    res.json(r.rowCount?{data:r.rows[0].data,rev:r.rows[0].rev,updated_at:Number(r.rows[0].updated_at)||0}:{data:null,rev:0});
  }));
  // перевод сообщений чата: при наличии кредита OpenRouter — ИИ (качество как Google), иначе бесплатный MyMemory. Переводим только НЕ-целевой язык.
  let _orCooldown=0;   // если OpenRouter без денег (402/403/429) — временно не дёргаем
  // бренды НЕ переводим: Google путает Kaspi → «Caspian/Каспий». Любое искажение возвращаем к фирменному написанию «Kaspi».
  const fixBrands=s=>String(s||'').replace(/Caspi[a-z]*/gi,'Kaspi').replace(/Каспи[а-яё]*/gi,'Kaspi');
  const trClean=s=>fixBrands(String(s||'').replace(/&quot;/g,'"').replace(/&#3[49];/g,"'").replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/^\s*&\s+/,'').trim());
  router.post('/translate',route(async(req,res)=>{
    const texts=Array.isArray(req.body.texts)?req.body.texts.slice(0,120).map(t=>String(t||'').slice(0,480)):[];
    const toKz=(req.body.to==='kz');
    const kzRe=/[әғқңөұүһі]/i;
    if(!texts.length) return res.json({translations:[]});
    // 1) Google Cloud Translation (лучшее качество, 500k симв/мес бесплатно) — если задан ключ
    const GKEY=(await getSecret(pool,'GOOGLE_TRANSLATE_API_KEY'))||process.env.GOOGLE_TRANSLATE_API_KEY;
    if(GKEY){
      try{
        const target=toKz?'kk':'ru';
        // экономим лимит: переводим только НЕ на целевом языке, остальные отдаём как есть
        const idx=[], q=[];
        texts.forEach((t,i)=>{ const isKz=kzRe.test(t); if(t.trim() && (toKz?!isKz:isKz)){ idx.push(i); q.push(t); } });
        if(!q.length) return res.json({translations:texts.map(t=>fixBrands(String(t)))});
        const r=await fetch('https://translation.googleapis.com/language/translate/v2?key='+encodeURIComponent(GKEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q,target,format:'text'})});
        if(r.ok){
          const j=await r.json(); const tr=(j.data&&j.data.translations)||[];
          if(tr.length===q.length){ const out=texts.slice(); idx.forEach((pos,k)=>{ out[pos]=trClean(tr[k].translatedText||texts[pos]); }); return res.json({translations:out.map(String)}); }
        }
      }catch(e){ /* упадём на следующий провайдер */ }
    }
    // 2) ИИ через OpenRouter (грамотно), если есть кредит
    const KEY=process.env.OPENROUTER_API_KEY;
    if(KEY && Date.now()>_orCooldown){
      try{
        const to=toKz?'казахский':'русский';
        const payload={model:process.env.TR_MODEL||'openai/gpt-4o-mini',temperature:0.1,messages:[
          {role:'system',content:'Ты профессиональный переводчик чата (мебель BORZO). Переводи каждый элемент на '+to+' язык грамотно и естественно, сохраняй эмодзи. Названия брендов НЕ переводи и НЕ транслитерируй — пиши как есть: Kaspi (НЕ «Caspian/Каспий»), BORZO, Halyk, Kaspi Red. Если элемент уже на '+to+' языке — верни без изменений. НЕ добавляй символов и пояснений. Ответ — СТРОГО JSON-массив строк той же длины и порядка.'},
          {role:'user',content:JSON.stringify(texts)}]};
        const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if([402,403,429].includes(r.status)){ _orCooldown=Date.now()+10*60*1000; }
        else if(r.ok){
          const j=await r.json(); let c=((j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'').replace(/```json/gi,'').replace(/```/g,'').trim();
          let arr=null; try{arr=JSON.parse(c);}catch(e){const i=c.indexOf('['),k=c.lastIndexOf(']'); if(i>=0&&k>i){ try{arr=JSON.parse(c.slice(i,k+1));}catch(_){} }}
          if(Array.isArray(arr)&&arr.length===texts.length) return res.json({translations:arr.map(t=>trClean(String(t)))});
        }
      }catch(e){ _orCooldown=Date.now()+10*60*1000; }
    }
    // 2) бесплатный MyMemory
    async function tr(q){
      if(!q||!q.trim()) return q;
      const isKz=kzRe.test(q); if(toKz?isKz:!isKz) return q;
      try{
        const url='https://api.mymemory.translated.net/get?langpair='+(toKz?'ru|kk':'kk|ru')+'&de=borzopult@gmail.com&q='+encodeURIComponent(q);
        const r=await fetch(url); if(!r.ok) return q;
        const j=await r.json(); const t=j.responseData&&j.responseData.translatedText;
        return (t && !/MYMEMORY WARNING|QUOTA|INVALID/i.test(t)) ? trClean(t) : q;
      }catch(e){ return q; }
    }
    const out=await Promise.all(texts.map(tr));
    res.json({translations: out.map(x=>fixBrands(String(x)))});
  }));
  router.put('/scripts',mutate(async(req,db)=>{
    const data=req.body.data;
    if(!data||typeof data!=='object'||Array.isArray(data)) throw err(400,'нужен объект скриптов');
    if(JSON.stringify(data).length>2000000) throw err(400,'слишком большой объём скриптов');
    const cur=await db.query('SELECT rev FROM crm_scripts WHERE id=1 FOR UPDATE');
    if(cur.rowCount){
      if(req.body.baseRev!=null && Number(req.body.baseRev)!==cur.rows[0].rev) throw err(409,'скрипты уже изменили — обновите панель и повторите');
      const r=await db.query('UPDATE crm_scripts SET data=$1,rev=rev+1,updated_by=$2,updated_at=$3 WHERE id=1 RETURNING rev',[JSON.stringify(data),req.user.id,Date.now()]);
      return {ok:true,rev:r.rows[0].rev};
    }
    const r=await db.query('INSERT INTO crm_scripts(id,data,rev,updated_by,updated_at) VALUES(1,$1,1,$2,$3) RETURNING rev',[JSON.stringify(data),req.user.id,Date.now()]);
    return {ok:true,rev:r.rows[0].rev};
  }));
  // загрузка фото для материалов скриптов → возвращает URL (храним в скрипте ссылку, не base64)
  router.post('/upload',mutate(async(req,db,saved)=>{
    const data=req.body.data;
    if(typeof data!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(data)) throw err(400,'нужно фото JPEG/PNG/WebP');
    if(data.length>8*1024*1024) throw err(400,'фото — до 5 МБ');
    const url=savePhoto(data); if(!url) throw err(400,'не удалось сохранить фото'); saved.push(url);
    return {url};
  }));
  // разовая загрузка скриптов из scripts_seed.json (идемпотентно: не перетирает уже отредактированные, если не force)
  router.post('/scripts/seed',requireRole('mgr'),mutate(async(req,db)=>{
    const ex=await db.query('SELECT rev FROM crm_scripts WHERE id=1 FOR UPDATE');
    if(ex.rowCount && ex.rows[0].rev>0 && !req.body.force) return {ok:true,skipped:true};
    let src; try{ src=JSON.parse(fs.readFileSync(path.join(__dirname,'scripts_seed.json'),'utf8')); }catch(e){ throw err(500,'scripts_seed.json не найден на сервере'); }
    await db.query(`INSERT INTO crm_scripts(id,data,rev,updated_by,updated_at) VALUES(1,$1,1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET data=$1,rev=crm_scripts.rev+1,updated_by=$2,updated_at=$3`,[JSON.stringify(src),req.user.id,Date.now()]);
    return {ok:true,seeded:true,blocks:Object.keys(src.blocks||{}).length};
  }));
  // ---------- база знаний агента (видимый шкаф: инструкция + материалы + уроки) ----------
  router.get('/agent-kb',route(async(req,res)=>{
    const r=await pool.query('SELECT data,rev,updated_at FROM crm_agent WHERE id=1');
    res.json(r.rowCount?{data:r.rows[0].data,rev:r.rows[0].rev,updated_at:Number(r.rows[0].updated_at)||0}:{data:{instruction:'',materials:[],lessons:[]},rev:0});
  }));
  router.put('/agent-kb',mutate(async(req,db)=>{
    const data=req.body.data;
    if(!data||typeof data!=='object'||Array.isArray(data)) throw err(400,'нужен объект базы знаний');
    if(!Array.isArray(data.materials)) data.materials=[];
    if(!Array.isArray(data.lessons)) data.lessons=[];
    data.instruction=str(data.instruction,'Инструкция',20000);
    if(JSON.stringify(data).length>4000000) throw err(400,'слишком большой объём базы знаний');
    const cur=await db.query('SELECT rev FROM crm_agent WHERE id=1 FOR UPDATE');
    if(cur.rowCount){
      if(req.body.baseRev!=null && Number(req.body.baseRev)!==cur.rows[0].rev) throw err(409,'базу агента уже изменили — обновите и повторите');
      const r=await db.query('UPDATE crm_agent SET data=$1,rev=rev+1,updated_by=$2,updated_at=$3 WHERE id=1 RETURNING rev',[JSON.stringify(data),req.user.id,Date.now()]);
      return {ok:true,rev:r.rows[0].rev};
    }
    const r=await db.query('INSERT INTO crm_agent(id,data,rev,updated_by,updated_at) VALUES(1,$1,1,$2,$3) RETURNING rev',[JSON.stringify(data),req.user.id,Date.now()]);
    return {ok:true,rev:r.rows[0].rev};
  }));
  // разовая загрузка базовой инструкции из agent_prompt_seed.md (если пусто)
  router.post('/agent-kb/seed',requireRole('mgr'),mutate(async(req,db)=>{
    const ex=await db.query('SELECT data FROM crm_agent WHERE id=1 FOR UPDATE');
    const cur=(ex.rowCount&&ex.rows[0].data)||{instruction:'',materials:[],lessons:[]};
    if(cur.instruction && cur.instruction.trim() && !req.body.force) return {ok:true,skipped:true};
    let txt=''; try{ txt=fs.readFileSync(path.join(__dirname,'agent_prompt_seed.md'),'utf8'); }catch(e){ throw err(500,'agent_prompt_seed.md не найден на сервере'); }
    cur.instruction=txt.slice(0,20000);
    if(!Array.isArray(cur.materials)) cur.materials=[];
    if(!Array.isArray(cur.lessons)) cur.lessons=[];
    await db.query('UPDATE crm_agent SET data=$1,rev=rev+1,updated_by=$2,updated_at=$3 WHERE id=1',[JSON.stringify(cur),req.user.id,Date.now()]);
    return {ok:true,seeded:true,len:cur.instruction.length};
  }));
  app.use('/api/crm',router);
}

// Import is insert-only by external id: reruns never overwrite managers' subsequent work.
async function importMindSales(db,b,user) {
  const data=b.data;
  if(!data || typeof data!=='object'||Array.isArray(data)) throw err(400,'Нужен объект data с clients, deals, stages, products');
  for(const key of ['clients','deals','stages','products']) if(data[key]!=null && (!Array.isArray(data[key])||data[key].length>10000)) throw err(400,key+': нужен массив, максимум 10000 записей');
  if(!Array.isArray(data.deals)) throw err(400,'Нужен массив deals');
  const counts={clients:0,deals:0,products:0,skipped_clients:0,skipped_deals:0,skipped_products:0,incomplete_won:0,undated_closed:0,undated_leads:0};
  const stages=(await db.query('SELECT * FROM crm_stages')).rows;
  const stageMap=new Map((await db.query('SELECT * FROM crm_import_stages')).rows.map(s=>[s.ext_id,s.stage_id]));
  const supplied=b.stageMap||{};
  if(typeof supplied!=='object'||Array.isArray(supplied)) throw err(400,'stageMap: нужен объект внешний ID → ID этапа CRM');
  for(const [ext,v] of Object.entries(supplied)) stageMap.set(str(ext,'ID этапа MindSales',200,true),(await stageBy(db,v)).id);
  const seenStages=new Set();
  for(const s of data.stages||[]) {
    if(!s||typeof s!=='object') throw err(400,'Некорректный этап MindSales');
    const ext=str(s.id,'ID этапа MindSales',200,true), name=str(s.name||s.title,'Название этапа',200,true);
    if(seenStages.has(ext)) throw err(400,'Повтор ID этапа в файле: '+ext); seenStages.add(ext);
    const matching=stages.find(x=>x.name.toLowerCase()===name.toLowerCase());
    const mapped=stageMap.get(ext)||(matching&&matching.id);
    if(!mapped) throw err(400,'Укажите соответствие этапа MindSales: '+name+' ('+ext+')');
    stageMap.set(ext,mapped);
    await db.query('INSERT INTO crm_import_stages(ext_id,name,stage_id) VALUES($1,$2,$3) ON CONFLICT(ext_id) DO UPDATE SET name=excluded.name,stage_id=excluded.stage_id',[ext,name,mapped]);
  }
  for(const [ext,mapped] of stageMap) {
    await db.query('INSERT INTO crm_import_stages(ext_id,name,stage_id) VALUES($1,$1,$2) ON CONFLICT(ext_id) DO UPDATE SET stage_id=excluded.stage_id',[ext,mapped]);
  }
  function external(v,label) { return str(v,label,200,true); }
  function contact(c) {
    if(c.phone) return c.phone;
    const cs=Array.isArray(c.contacts)?c.contacts:c.contacts&&typeof c.contacts==='object'?Object.entries(c.contacts).map(([type,value])=>({type,value})):[];
    const p=cs.find(x=>typeof x==='string' || (x && /phone|tel|mobile|whatsapp/i.test(x.type||x.kind||'')));
    return typeof p==='string'?p:p&&(p.value||p.phone)||null;
  }
  const clients=new Map();
  async function importClient(c,ext) {
    if(clients.has(ext)) return clients.get(ext);
    const old=await db.query('SELECT id FROM crm_clients WHERE ext_id=$1',[ext]);
    if(old.rowCount) { counts.skipped_clients++; clients.set(ext,old.rows[0].id); return old.rows[0].id; }
    const p=phone(contact(c)), name=str(c.name||c.clientName,'Имя импортируемого клиента',200,true);
    const r=await db.query(`INSERT INTO crm_clients(ext_id,name,phone,instagram,source,note,created_at) VALUES($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz,now())) RETURNING id`,
      [ext,name,p,str(c.instagram,'Instagram',200),str(c.source,'Источник',100),str(c.note,'Заметка',10000),timestamp(c.created_at||c.createdAt,'Дата клиента')]);
    counts.clients++; clients.set(ext,r.rows[0].id); return r.rows[0].id;
  }
  for(const c of data.clients||[]) {
    if(!c||typeof c!=='object') throw err(400,'Некорректный клиент');
    await importClient(c,external(c.id,'Внешний ID клиента'));
  }
  const products=new Map();
  for(const p of data.products||[]) {
    if(!p||typeof p!=='object') throw err(400,'Некорректный товар');
    const ext=external(p.id,'Внешний ID товара'), name=str(p.name||p.title,'Название товара',200,true), price=number(p.price==null?0:p.price,'Цена товара');
    const r=await db.query('INSERT INTO crm_products(ext_id,name,price) VALUES($1,$2,$3) ON CONFLICT(ext_id) DO NOTHING RETURNING id',[ext,name,price]);
    counts[r.rowCount?'products':'skipped_products']++;
    products.set(ext,{name,price});
  }
  for(const p of (await db.query('SELECT * FROM crm_products')).rows) if(!products.has(p.ext_id)) products.set(p.ext_id,p);
  for(let i=0;i<data.deals.length;i++) {
    try {
      const d=data.deals[i]; if(!d||typeof d!=='object') throw err(400,'Некорректная сделка');
      const ext=external(d.id,'Внешний ID сделки');
      if((await db.query('SELECT id FROM crm_deals WHERE ext_id=$1',[ext])).rowCount) { counts.skipped_deals++; continue; }
      const stageId=stageMap.get(external(d.statusId,'statusId')), s=stages.find(x=>x.id===stageId);
      if(!s) throw err(400,'Не сопоставлен statusId '+d.statusId);
      const clientExt=d.clientId!=null?external(d.clientId,'clientId'):'deal:'+ext;
      const clientId=await importClient({name:d.clientName,contacts:d.contacts,phone:d.phone,source:d.source},clientExt);
      const rawItems=d.items||[];
      if(!Array.isArray(rawItems)) throw err(400,'items должен быть массивом');
      const cleanItems=items(rawItems.map(x=>{
        if(!x||typeof x!=='object') throw err(400,'Некорректная позиция');
        const p=products.get(String(x.productId))||{};
        return {name:x.name||p.name,qty:x.qty==null?x.quantity:x.qty,price:x.price==null?p.price:x.price};
      }));
      const ship=date(d.ship_date||d.shipDate);
      // Preserve imported historical status even when a minimal export omits fulfillment.
      // Every interactive move to won still passes wonCheck; missing facts stay visibly unknown.
      const incomplete=s.is_won&&(!cleanItems.length||!ship);
      if(incomplete) counts.incomplete_won++;
      const created=timestamp(d.created_at||d.createdAt,'Дата создания'), closed=timestamp(d.closed_at||d.closedAt,'Дата закрытия');
      if((s.is_won||s.is_lost)&&!closed) counts.undated_closed++;
      if(!created) counts.undated_leads++;
      const entered=timestamp(d.stage_entered_at||d.stageEnteredAt,'Дата этапа')||closed||created;
      const amount=number(d.amount==null?Math.round(cleanItems.reduce((a,x)=>a+x.qty*x.price,0)*100)/100:d.amount,'Сумма');
      const r=await db.query(`INSERT INTO crm_deals(ext_id,client_id,title,amount,stage_id,manager_id,source,note,items,ship_date,lost_reason,created_at,stage_entered_at,closed_at,imported_incomplete)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [ext,clientId,str(d.title||d.clientName||'Импорт '+ext,'Название сделки',200,true),amount,s.id,user.id,str(d.source,'Источник',100),str(d.note,'Заметка',10000),JSON.stringify(cleanItems),ship,str(d.lost_reason,'Причина отказа',1000),created,entered,s.is_won||s.is_lost?closed:null,incomplete]);
      await event(db,user,r.rows[0].id,'status','Импорт MindSales → '+s.name+(incomplete?' · требуется уточнить состав / дату отгрузки':''),null,s.id); counts.deals++;
    } catch(e) { if(e.httpCode) throw err(e.httpCode,'Сделка #'+(i+1)+': '+e.message); throw e; }
  }
  return {ok:true,counts};
}
// перепроверка всех сохранённых ключей (для фонового планировщика): обновляет ok/checked_at
async function recheckSecrets(pool){
  try{
    const r=await pool.query('SELECT name FROM crm_secrets');
    for(const row of r.rows){
      if(SECRET_NAMES.indexOf(row.name)<0) continue;
      const key=await getSecret(pool,row.name); if(!key) continue;
      const chk=await checkProvider(row.name,key);
      await pool.query('UPDATE crm_secrets SET ok=$1,checked_at=now() WHERE name=$2',[chk.ok,row.name]);
    }
  }catch(e){ console.error('recheckSecrets', e && e.message); }
}
module.exports={initSchema,register,recheckSecrets,getSecret};
