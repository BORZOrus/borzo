#!/usr/bin/env node
// Одноразовый импорт тёплых лидов из старой CRM (Mindsales) в колонку «Со старой CRM».
// Идемпотентен: сделки по ext_id='oldcrm:<phone>', сообщения по wamid='oldcrm:<phone>:<n>' — повторный запуск ничего не задвоит.
// Данные: /opt/borzo/import-stary-crm/{phones98.json, active-deals.json, messages-by-phone.json}
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool();
const DIR = '/opt/borzo/import-stary-crm';

const phones = JSON.parse(fs.readFileSync(DIR + '/phones98.json', 'utf8'));
const deals = JSON.parse(fs.readFileSync(DIR + '/active-deals.json', 'utf8'));
const msgs = JSON.parse(fs.readFileSync(DIR + '/messages-by-phone.json', 'utf8'));

// excel-serial (локальное время Алматы, UTC+5) -> unix ms
function xlMs(v) { const n = Number(v); if (!n) return Date.now(); return Math.round((n - 25569) * 86400000) - 5 * 3600000; }
function mediaText(t) {
  const s = String(t || '').trim();
  if (/\.(jpe?g|png|webp)\s*$/i.test(s)) return '📷 [фото из старой CRM — файл не переносится]';
  if (/\.(mp3|ogg|opus|m4a)\s*$/i.test(s)) return '🎧 [был звонок/голосовое — аудио осталось в старой CRM]';
  if (/\.pdf\s*$/i.test(s)) return '📄 [документ из старой CRM]';
  return s;
}

(async () => {
  const st = await pool.query(`SELECT id FROM crm_stages WHERE code='oldcrm'`);
  if (!st.rowCount) { console.error('Этап oldcrm не найден — сначала деплой crm.js + рестарт'); process.exit(1); }
  const stageId = st.rows[0].id;
  let created = 0, skipped = 0, msgCount = 0;
  for (const rec of phones) {
    const ph = String(rec.phone);
    const full = '+7' + ph;
    const deal = deals[ph] || {};
    const chat = msgs[ph] || [];
    const name = (rec.name || deal['Имя'] || 'Клиент').slice(0, 120) || 'Клиент';
    const extId = 'oldcrm:' + ph;
    const client = await pool.query(
      `INSERT INTO crm_clients(ext_id, name, phone, source, note)
       VALUES($1,$2,$3,'Старая CRM','')
       ON CONFLICT (ext_id) DO UPDATE SET name=crm_clients.name RETURNING id`,
      [extId, name, full]);
    let clientId = client.rows[0] && client.rows[0].id;
    if (!clientId) { const r = await pool.query(`SELECT id FROM crm_clients WHERE ext_id=$1`, [extId]); clientId = r.rows[0].id; }

    const already = await pool.query(`SELECT id FROM crm_deals WHERE ext_id=$1`, [extId]);
    let dealId;
    if (already.rowCount) { dealId = already.rows[0].id; skipped++; }
    else {
      const hadAudio = chat.some(m => /\.(mp3|ogg|opus|m4a)\s*$/i.test(String(m.text || '')));
      const noteParts = [
        '♨️ Тёплый лид из старой CRM (балл ' + (rec.score || '?') + (rec.flags ? ' — ' + rec.flags : '') + ')',
        deal['Комментарий'] ? 'Комментарий из старой CRM: ' + deal['Комментарий'] : '',
        deal['Город:'] ? 'Город: ' + deal['Город:'] : '',
        rec.last_comm ? 'Последний контакт: ' + rec.last_comm : '',
        hadAudio ? '🎧 В истории были звонки/голосовые — аудио осталось в старой CRM' : '',
        '⚠️ Переписка перенесена по 23.08.2026, более поздние сообщения остались в Mindsales'
      ].filter(Boolean);
      const d = await pool.query(
        `INSERT INTO crm_deals(ext_id, client_id, title, stage_id, source, note)
         VALUES($1,$2,$3,$4,'Старая CRM',$5) RETURNING id`,
        [extId, clientId, name, stageId, noteParts.join('\n')]);
      dealId = d.rows[0].id;
      await pool.query(
        `INSERT INTO crm_events(deal_id, kind, text, author_name) VALUES($1,'note',$2,'Импорт')`,
        [dealId, 'Лид перенесён из старой CRM (Mindsales) со всей доступной историей переписки']);
      created++;
    }
    let lastIn = null, lastMsg = null;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i];
      const dir = m.dir === 'Входящее' ? 'in' : 'out';
      const ts = xlMs(m.date);
      const text = mediaText(m.text);
      if (!text) continue;
      await pool.query(
        `INSERT INTO wa_messages(wamid, deal_id, client_id, direction, wa_from, wa_to, type, text, status, author_name, ts)
         VALUES($1,$2,$3,$4,$5,$6,'text',$7,$8,$9,$10) ON CONFLICT (wamid) DO NOTHING`,
        ['oldcrm:' + ph + ':' + i, dealId, clientId, dir,
          dir === 'in' ? full : '+77072890306', dir === 'in' ? '+77072890306' : full,
          text, dir === 'out' ? 'read' : '', dir === 'out' ? 'Старая CRM' : '', ts]);
      msgCount++;
      if (dir === 'in') lastIn = ts;
      lastMsg = ts;
    }
    if (lastMsg) await pool.query(
      `UPDATE crm_deals SET last_msg_at=to_timestamp($1/1000.0), last_in_at=COALESCE(to_timestamp($2/1000.0), last_in_at) WHERE id=$3`,
      [lastMsg, lastIn, dealId]);
  }
  console.log('Готово. Новых сделок:', created, '| уже были (пропущено):', skipped, '| сообщений обработано:', msgCount);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
