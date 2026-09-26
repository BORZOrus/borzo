/* WhatsApp через 360dialog (Cloud API). Заход 1: приём вебхуком + отправка + таблицы сообщений +
   логика «новый входящий незнакомый → клиент + сделка в стадии Новая заявка (необработанный)».
   Строится «вхолостую»: без ключа отправка отдаёт 503, приём работает всегда. Ключ воткнём в день переезда.
   Инъекция хелперов из server.js — как в crm.js (pool, auth, requireAny, withTx, savePhoto, sendPushToRole). */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PHONE_LOCK = 7383;          // тот же смысл, что PHONE в crm.js — сериализуем find-or-create клиента по телефону
const API_URL = (process.env.WA_API_URL || 'https://waba-v2.360dialog.io').replace(/\/+$/,'');
const API_KEY = process.env.D360_API_KEY || '';         // появится в день переезда (Change Partner → ключ канала)
const WEBHOOK_SECRET = process.env.WA_WEBHOOK_SECRET || '';   // секрет в пути вебхука (360dialog не подписывает как Meta)
const OUR_PHONE_ID = process.env.WA_PHONE_ID || '';     // phone_number_id нашего канала (912982958571543) — отсечь чужие каналы

async function initSchema(db) {
  await db.query(`
    -- сырой журнал вебхуков: пишем ДО разбора, чтобы ни одно входящее не потерялось (360dialog не ретраит после 200)
    CREATE TABLE IF NOT EXISTS wa_webhook_log (
      id SERIAL PRIMARY KEY, ts BIGINT NOT NULL, body JSONB NOT NULL, note TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS wa_messages (
      id SERIAL PRIMARY KEY,
      wamid TEXT UNIQUE,                 -- id сообщения WhatsApp: идемпотентность приёма
      deal_id INTEGER REFERENCES crm_deals(id),
      client_id INTEGER REFERENCES crm_clients(id),
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      wa_from TEXT, wa_to TEXT,
      type TEXT NOT NULL DEFAULT 'text',
      text TEXT NOT NULL DEFAULT '',
      media_id TEXT, media_url TEXT, mime TEXT, caption TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',   -- исходящие: sent/delivered/read/failed
      err TEXT NOT NULL DEFAULT '',
      author_id INTEGER, author_name TEXT NOT NULL DEFAULT '',
      req_id TEXT,
      ts BIGINT NOT NULL,
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS wa_messages_deal_idx ON wa_messages(deal_id, ts, id);
    CREATE INDEX IF NOT EXISTS wa_messages_client_idx ON wa_messages(client_id);
    CREATE UNIQUE INDEX IF NOT EXISTS wa_messages_req_uidx ON wa_messages(req_id) WHERE req_id IS NOT NULL;
    -- поля чат-инбокса на сделке
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS wa_unread INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS last_in_at TIMESTAMPTZ;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS last_msg_at TIMESTAMPTZ;
    -- имя из профиля WhatsApp (может отличаться от карточного)
    ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS wa_name TEXT NOT NULL DEFAULT '';
    -- ответ на сообщение (цитата): id исходного сообщения WhatsApp + короткий текст для превью
    ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS reply_to TEXT NOT NULL DEFAULT '';
    ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS reply_text TEXT NOT NULL DEFAULT '';
  `);
}

function err(code, message){ const e = new Error(message); e.httpCode = code; return e; }
// Meta даёт телефон цифрами без «+» (77072890306). Приводим к нашему формату +7… и валидируем под CHECK crm_clients.
function waPhone(from){
  const digits = String(from||'').replace(/\D/g,'');
  if(digits.length < 8 || digits.length > 15) return null;
  const p = '+'+digits;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}
// вытащить события из любого формата: вложенный Meta (entry[].changes[].value) или плоский {messages,statuses}
function extractEvents(body){
  const values = [];
  if(body && Array.isArray(body.entry)){
    body.entry.forEach(e => (e && Array.isArray(e.changes) ? e.changes : []).forEach(ch => { if(ch && ch.value) values.push(ch.value); }));
  } else if(body && (body.messages || body.statuses || body.contacts)){
    values.push(body);
  }
  const out = { messages:[], statuses:[], contacts:new Map(), phoneId:null };
  values.forEach(v => {
    if(v.metadata && v.metadata.phone_number_id) out.phoneId = String(v.metadata.phone_number_id);
    (v.contacts||[]).forEach(c => { if(c && c.wa_id) out.contacts.set(String(c.wa_id), (c.profile && c.profile.name) || ''); });
    (v.messages||[]).forEach(m => { if(m) out.messages.push(m); });
    (v.statuses||[]).forEach(s => { if(s) out.statuses.push(s); });
  });
  return out;
}
// текст/подпись и медиа-реквизиты из сообщения Meta (в Заходе 1 медиа не качаем — только сохраняем id, чтобы не потерять)
function messageContent(m){
  const t = m.type || 'text';
  if(t === 'text') return { type:'text', text:(m.text && m.text.body) || '', mediaId:null, mime:null, caption:'' };
  const obj = m[t] || {};                                  // image/audio/voice/video/document/sticker
  return { type:t, text:'', mediaId:obj.id || null, mime:obj.mime_type || null, caption:obj.caption || '' };
}

function register(app, { pool, auth, requireAny, withTx, sendPushToRole, uploadDir }) {
  const UPLOAD_DIR = uploadDir || '/var/www/borzo/uploads';
  const pub = express.Router();     // публичный (без токена): 360dialog постит сюда
  const api = express.Router();     // авторизованный

  // ---- приём вебхука 360dialog ----
  // GET — верификация (Meta hub.challenge), на случай если канал попросит подтверждение
  pub.get('/webhook/:secret', (req, res) => {
    if(!WEBHOOK_SECRET || req.params.secret !== WEBHOOK_SECRET) return res.sendStatus(403);
    if(req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WEBHOOK_SECRET)
      return res.status(200).send(String(req.query['hub.challenge']||''));
    return res.sendStatus(200);
  });
  // POST — входящие сообщения и статусы. Всегда отвечаем 200 (360dialog не ретраит), но сначала пишем сырой лог.
  pub.post('/webhook/:secret', async (req, res) => {
    if(!WEBHOOK_SECRET || req.params.secret !== WEBHOOK_SECRET) return res.sendStatus(403);
    const body = req.body || {};
    try { await pool.query('INSERT INTO wa_webhook_log(ts, body) VALUES($1,$2)', [Date.now(), JSON.stringify(body)]); } catch(_) {}
    res.sendStatus(200);                                   // подтверждаем сразу, разбираем дальше в фоне этого же запроса
    try { await handleWebhook(body); }
    catch(e){ console.error('wa webhook error', e && e.message); }
  });

  async function handleWebhook(body){
    const ev = extractEvents(body);
    // отсечь чужой канал (если задан наш phone_number_id)
    if(OUR_PHONE_ID && ev.phoneId && ev.phoneId !== OUR_PHONE_ID){ console.warn('wa: чужой phone_id', ev.phoneId); return; }
    // статусы исходящих: sent/delivered/read/failed
    for(const s of ev.statuses){
      try {
        const errTxt = (s.errors && s.errors[0] && (s.errors[0].title || s.errors[0].message)) || '';
        await pool.query('UPDATE wa_messages SET status=$1, err=$2 WHERE wamid=$3 AND direction=$4',
          [String(s.status||''), String(errTxt).slice(0,300), String(s.id||''), 'out']);
      } catch(e){ console.error('wa status err', e && e.message); }
    }
    // входящие сообщения
    for(const m of ev.messages){
      try { await ingestInbound(m, ev.contacts.get(String(m.from)) || ''); }
      catch(e){ console.error('wa ingest err', e && e.message); }
    }
  }

  // один входящий → найти/создать клиента и открытую сделку, записать сообщение
  async function ingestInbound(m, profileName){
    const wamid = String(m.id||'');
    if(!wamid) return;
    const phone = waPhone(m.from);
    if(!phone){ console.warn('wa: не разобрал телефон', m.from); return; }
    const c = messageContent(m);
    const ts = Number(m.timestamp) ? Number(m.timestamp)*1000 : Date.now();

    await withTx(async (db) => {
      // идемпотентность: это сообщение уже обработано?
      const dup = await db.query('SELECT id FROM wa_messages WHERE wamid=$1', [wamid]);
      if(dup.rowCount) return;

      await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [PHONE_LOCK, phone]);
      let client = (await db.query('SELECT * FROM crm_clients WHERE phone=$1 ORDER BY id LIMIT 1', [phone])).rows[0];
      let clientCreated = false;
      if(!client){
        client = (await db.query(
          `INSERT INTO crm_clients(name, phone, source, wa_name) VALUES($1,$2,'whatsapp',$3) RETURNING *`,
          [profileName || phone, phone, profileName || ''])).rows[0];
        clientCreated = true;
      } else if(profileName && !client.wa_name){
        await db.query('UPDATE crm_clients SET wa_name=$1 WHERE id=$2', [profileName, client.id]);
      }

      // открытая сделка клиента (не выиграна и не проиграна) — самая свежая; иначе новая в стадии «Новая заявка»
      let deal = (await db.query(
        `SELECT d.* FROM crm_deals d JOIN crm_stages s ON s.id=d.stage_id
         WHERE d.client_id=$1 AND NOT s.is_won AND NOT s.is_lost ORDER BY d.updated_at DESC, d.id DESC LIMIT 1`,
        [client.id])).rows[0];
      if(!deal){
        const st = (await db.query("SELECT id FROM crm_stages WHERE code='new'")).rows[0];
        deal = (await db.query(
          `INSERT INTO crm_deals(client_id, title, stage_id, source) VALUES($1,$2,$3,'whatsapp') RETURNING *`,
          [client.id, profileName || client.name || phone, st.id])).rows[0];
        // необработанный лид: строка в ленту сделки (менеджер позже жмёт «взять в работу» — Заход 2)
        await db.query(
          `INSERT INTO crm_events(deal_id, kind, text, author_name, to_stage_id) VALUES($1,'status',$2,'WhatsApp',$3)`,
          [deal.id, (clientCreated?'Новый лид из WhatsApp':'Новая заявка из WhatsApp')+' — необработан', st.id]);
      }

      const inReplyTo = (m.context && m.context.id) ? String(m.context.id).slice(0,256) : '';
      await db.query(
        `INSERT INTO wa_messages(wamid, deal_id, client_id, direction, wa_from, wa_to, type, text, media_id, mime, caption, ts, raw, reply_to)
         VALUES($1,$2,$3,'in',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [wamid, deal.id, client.id, m.from, OUR_PHONE_ID || '', c.type, c.text, c.mediaId, c.mime, c.caption, ts, JSON.stringify(m), inReplyTo]);
      // сделка всплывает в списке, растёт счётчик непрочитанных
      await db.query('UPDATE crm_deals SET wa_unread=wa_unread+1, last_in_at=now(), last_msg_at=now(), updated_at=now() WHERE id=$1', [deal.id]);
    });

    // уведомить менеджеров (лёгкий пуш)
    const preview = c.type==='text' ? (c.text||'').slice(0,80) : ('['+c.type+']');
    const pushBody = (profileName?profileName+': ':'')+preview;
    if(sendPushToRole){ sendPushToRole('mgr', { title:'BORZO · WhatsApp', body:pushBody, url:'/crm.html' }).catch(()=>{});
                        sendPushToRole('fin', { title:'BORZO · WhatsApp', body:pushBody, url:'/crm.html' }).catch(()=>{}); }
  }

  // ---- авторизованные ручки для CRM ----
  api.use(auth, requireAny(['mgr','fin']));
  const route = fn => async (req,res)=>{ try{ await fn(req,res); }
    catch(e){ if(e.httpCode) return res.status(e.httpCode).json({error:e.message}); console.error('wa route', e&&e.message); if(!res.headersSent) res.status(500).json({error:'внутренняя ошибка сервера'}); } };

  // подключён ли WhatsApp (есть ли ключ) — фронт показывает статус
  api.get('/status', route(async (req,res)=>{
    res.json({ connected: !!API_KEY, phone_id: OUR_PHONE_ID || null });
  }));

  // скачать вложение (голосовое/фото/видео/документ) с 360dialog, сохранить в uploads, вернуть ссылку
  api.get('/media/:msgId', route(async (req,res)=>{
    const mid = Number(req.params.msgId);
    if(!Number.isSafeInteger(mid) || mid<1) throw err(400,'некорректное сообщение');
    const m = (await pool.query('SELECT * FROM wa_messages WHERE id=$1',[mid])).rows[0];
    if(!m) throw err(404,'сообщение не найдено');
    if(m.media_url) return res.json({ url:m.media_url, mime:m.mime||'' });     // уже скачано
    if(!m.media_id) throw err(400,'у сообщения нет вложения');
    if(!API_KEY) throw err(503,'WhatsApp ещё не подключён — вложения появятся после переезда');
    // 1) метаданные медиа (Meta/360dialog: GET /{media-id} → {url, mime_type})
    const meta = await fetch(API_URL+'/'+encodeURIComponent(m.media_id), { headers:{ 'D360-API-KEY':API_KEY } });
    const mj = await meta.json().catch(()=>({}));
    if(!meta.ok || !mj.url) throw err(502,'не удалось получить ссылку на вложение');
    // 2) сами байты (у 360dialog ссылка требует тот же ключ)
    const bin = await fetch(mj.url, { headers:{ 'D360-API-KEY':API_KEY } });
    if(!bin.ok) throw err(502,'не удалось скачать вложение');
    const buf = Buffer.from(await bin.arrayBuffer());
    if(!buf.length || buf.length > 25*1024*1024) throw err(413,'вложение слишком большое (до 25 МБ)');
    const mime = mj.mime_type || m.mime || 'application/octet-stream';
    const ext = (mime.split('/')[1]||'bin').split(';')[0].replace('jpeg','jpg');
    const name = crypto.randomUUID()+'.'+ext.replace(/[^a-z0-9]/gi,'').slice(0,8);
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    const url = '/uploads/'+name;
    await pool.query('UPDATE wa_messages SET media_url=$1, mime=$2 WHERE id=$3',[url, mime, mid]);
    res.json({ url:url, mime:mime });
  }));
  // лента чата по сделке
  api.get('/messages/:dealId', route(async (req,res)=>{
    const dealId = Number(req.params.dealId);
    if(!Number.isSafeInteger(dealId) || dealId<1) throw err(400,'некорректная сделка');
    const r = await pool.query('SELECT * FROM wa_messages WHERE deal_id=$1 ORDER BY ts, id', [dealId]);
    res.json({ messages: r.rows });
  }));

  // сбросить счётчик непрочитанных
  api.post('/read/:dealId', route(async (req,res)=>{
    const dealId = Number(req.params.dealId);
    if(!Number.isSafeInteger(dealId) || dealId<1) throw err(400,'некорректная сделка');
    await pool.query('UPDATE crm_deals SET wa_unread=0 WHERE id=$1', [dealId]);
    res.json({ ok:true });
  }));

  // отправить текст клиенту по сделке
  api.post('/send', route(async (req,res)=>{
    const dealId = Number(req.body.deal_id);
    if(!Number.isSafeInteger(dealId) || dealId<1) throw err(400,'некорректная сделка');
    const text = String(req.body.text==null?'':req.body.text).trim();
    if(!text) throw err(400,'пустое сообщение');
    if(text.length>4096) throw err(400,'сообщение длиннее 4096 символов');
    const reqId = (String(req.body.reqId||'').trim().slice(0,64)) || null;

    // идемпотентность по reqId
    if(reqId){ const ex = await pool.query('SELECT * FROM wa_messages WHERE req_id=$1',[reqId]); if(ex.rowCount) return res.json({ ok:true, message:ex.rows[0], idem:true }); }

    const d = await pool.query(
      `SELECT d.id, c.id AS client_id, c.phone FROM crm_deals d JOIN crm_clients c ON c.id=d.client_id WHERE d.id=$1`, [dealId]);
    if(!d.rowCount) throw err(404,'сделка не найдена');
    const { client_id, phone } = d.rows[0];
    if(!phone) throw err(400,'у клиента нет телефона');
    if(!API_KEY) throw err(503,'WhatsApp ещё не подключён — ключ появится в день переезда');

    const replyTo = String(req.body.reply_to||'').trim().slice(0,256);        // wamid исходного сообщения (цитата)
    const replyText = String(req.body.reply_text||'').trim().slice(0,200);    // короткий текст для превью цитаты
    const to = phone.replace(/\D/g,'');
    let wamid = null, sendErr = '';
    try {
      const payload = { messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text:{ body:text, preview_url:false } };
      if(replyTo) payload.context = { message_id: replyTo };                  // ответ с цитатой (как в WhatsApp)
      const resp = await fetch(API_URL+'/messages', {
        method:'POST',
        headers:{ 'D360-API-KEY':API_KEY, 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await resp.json().catch(()=>({}));
      if(!resp.ok){ sendErr = (j.error && (j.error.message||j.error.title)) || ('HTTP '+resp.status); throw err(502, 'WhatsApp не принял сообщение: '+sendErr); }
      wamid = (j.messages && j.messages[0] && j.messages[0].id) || null;
    } catch(e){ if(e.httpCode) throw e; throw err(502,'сеть/шлюз WhatsApp недоступен'); }

    const now = Date.now();
    let saved;
    try {
      saved = (await pool.query(
        `INSERT INTO wa_messages(wamid, deal_id, client_id, direction, wa_from, wa_to, type, text, status, author_id, author_name, req_id, ts, reply_to, reply_text)
         VALUES($1,$2,$3,'out',$4,$5,'text',$6,'sent',$7,$8,$9,$10,$11,$12) RETURNING *`,
        [wamid, dealId, client_id, OUR_PHONE_ID||'', to, text, req.user.id, req.user.name, reqId, now, replyTo, replyText])).rows[0];
    } catch(e){
      if(e.code==='23505' && reqId){ const ex=await pool.query('SELECT * FROM wa_messages WHERE req_id=$1',[reqId]); if(ex.rowCount) return res.json({ ok:true, message:ex.rows[0], idem:true }); }
      throw e;
    }
    await pool.query('UPDATE crm_deals SET last_msg_at=now(), updated_at=now() WHERE id=$1', [dealId]);
    res.json({ ok:true, message: saved });
  }));

  app.use('/api/wa', pub);
  app.use('/api/wa', api);
}

module.exports = { initSchema, register, extractEvents, waPhone, messageContent };
