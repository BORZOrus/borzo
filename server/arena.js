/* BORZO — ТЕСТ-АРЕНА: песочница для обучения ИИ-продавца Линды.
   Полностью изолирована от боевой CRM: свои таблицы arena_*, в боевые таблицы crm и wa не пишет.
   Три роли: агент-КЛИЕНТ (генерит лиды и отвечает по персоне), ЛИНДА (продаёт по базе знаний
   из /opt/borzo/server/linda/*.md + живой каталог), АУДИТОР (разбирает диалог по методологии). */
const fs = require('fs');
const path = require('path');
const crmMod = require('./crm');

function err(code, msg) { const e = new Error(msg); e.status = code; return e; }

const STAGES = [
  { code: 'new', name: 'Новые заказы' },
  { code: 'working', name: 'В работе' },
  { code: 'selection', name: 'Подбор решения' },
  { code: 'paused', name: 'Пауза' },
  { code: 'won', name: 'Продажа' },
  { code: 'lost', name: 'Отказ/Игнор' },
  { code: 'junk', name: 'Нецелевой' }
];
const PERSONAS = {
  rational: 'РАЦИОНАЛЬНЫЙ: дотошно спрашивает про нагрузку, механизм, срок службы, обоснование цены. Эмоции не трогают, нужны факты. Купит, только если логика сойдётся.',
  emotional: 'ЭМОЦИОНАЛЬНЫЙ (дизайн-клиент): «очень красиво», просит фото, переживает впишется ли в интерьер, спрашивает цвета. Решение принимает сердцем, боится ошибиться визуально.',
  doubter: 'СОМНЕВАЮЩИЙСЯ: на всё отвечает «надо подумать», «посоветуюсь», тянет, сравнивает с конкурентами, боится переплатить. Дожмётся только спокойной ценностью и фиксацией срока.',
  ready: 'ГОТОВЫЙ К ПОКУПКЕ: «берём, как оформить, когда доставка?» — хочет быстро и без сложностей. Бесит, когда ему продолжают продавать.',
  junk: 'НЕЦЕЛЕВОЙ: хочет стол 120 см / вдвое дешевле / индивидуальный размер / «а сделаете под заказ?». К серийному формату не готов.',
  confused: 'БЕСТОЛКОВЫЙ: путается, переспрашивает одно и то же, не понимает как оформить Kaspi, присылает не те ответы, надо всё разжёвывать по шагам терпеливо.',
  haggler: 'ТОРГАШ: выпрашивает скидку больше 10%, давит «в другом месте дешевле», «наличкой сразу заберу если уступите». Уважает твёрдую спокойную позицию.',
  ghost: 'ПРОПАДАЮЩИЙ: проявляет интерес, потом исчезает на день-два, отвечает односложно с задержкой, «забыл ответить». Живой, но занятой.'
};
const NAMES = ['Айгуль', 'Динара', 'Кайрат', 'Жулдыз', 'Бакыт', 'Роза', 'Дания', 'Сания', 'Гульнара', 'Асель', 'Мадина', 'Ерлан', 'Данияр', 'Алия', 'Тогжан', 'Саят', 'Инесса', 'Балқия', 'Нурлан', 'Карина'];

let lindaKb = null;
function loadKb() {
  if (lindaKb) return lindaKb;
  const dir = path.join(__dirname, 'linda');
  let out = '';
  try {
    for (const f of ['01-linda-core.md', '02-linda-method.md', '03-linda-live-text.md', '04-real-dialogs.md'])
      out += fs.readFileSync(path.join(dir, f), 'utf8') + '\n\n';
  } catch (e) { out = 'База знаний не загружена: ' + e.message; }
  lindaKb = out;
  return out;
}

async function catalogText(pool) {
  const [m, v] = await Promise.all([
    pool.query('SELECT id,name FROM crm_cat_models WHERE NOT archived ORDER BY type,ord,name'),
    pool.query('SELECT model_id,corpus,legs,len,width,price,link FROM crm_cat_variants WHERE NOT archived ORDER BY model_id,ord')
  ]);
  const byModel = {};
  for (const r of v.rows) (byModel[r.model_id] = byModel[r.model_id] || []).push(r);
  return m.rows.map(mm => {
    const vs = (byModel[mm.id] || []).map(x =>
      '  - ' + [x.corpus, x.legs, x.len && 'длина ' + x.len, x.width && 'ширина ' + x.width].filter(Boolean).join(', ') +
      (x.price != null ? ' — ' + Math.round(x.price) + ' ₸' : ' — цена не задана') + (x.link ? ' | ссылка: ' + x.link : ''));
    return mm.name + '\n' + vs.join('\n');
  }).join('\n').slice(0, 12000);
}

// боевые скрипты CRM (магистраль + инструменты): тот же источник, что видит Ульяна во вкладке скриптов
async function scriptsText(pool) {
  try {
    const r = await pool.query('SELECT data FROM crm_scripts WHERE id=1');
    if (!r.rowCount) return '';
    const data = r.rows[0].data || {};
    const blocks = data.blocks || data;
    let out = [];
    for (const key of Object.keys(blocks)) {
      const b = blocks[key];
      if (!b || !Array.isArray(b.messages)) continue;
      const msgs = b.messages.map(m => '  • ' + String(m.text || '').trim()).filter(s => s.length > 4);
      if (msgs.length) out.push('### ' + (b.title || key) + '\n' + msgs.join('\n'));
    }
    return out.join('\n\n').slice(0, 9000);
  } catch (_) { return ''; }
}
// вкладка «Агент» CRM: инструкция + уроки Ульяны/Руслана + материалы (фото/ссылки с пометкой «когда»)
async function agentKbText(pool) {
  try {
    const r = await pool.query('SELECT data FROM crm_agent WHERE id=1');
    if (!r.rowCount) return '';
    const kb = r.rows[0].data || {};
    let out = [];
    if (kb.instruction) out.push('### ИНСТРУКЦИЯ ОТ РУКОВОДСТВА (главнее остального)\n' + String(kb.instruction).slice(0, 6000));
    if (Array.isArray(kb.lessons) && kb.lessons.length)
      out.push('### УРОКИ (коррекции от Ульяны/Руслана, обязательны)\n' + kb.lessons.map(l => '  • ' + String(l.text || '').trim()).join('\n').slice(0, 4000));
    if (Array.isArray(kb.materials) && kb.materials.length)
      out.push('### МАТЕРИАЛЫ ДЛЯ ОТПРАВКИ КЛИЕНТАМ (фото/ссылки; используй по назначению «когда»)\n' + kb.materials.map(m => '  • [' + (m.type || '') + '] ' + (m.title || '') + (m.when ? ' | когда: ' + m.when : '') + ' | ' + String(m.value || '').slice(0, 200)).join('\n').slice(0, 3000));
    return out.join('\n\n');
  } catch (_) { return ''; }
}

// вселенский закон Руслана: длинные тире в сообщениях клиентам запрещены навсегда.
// Модели упорно их ставят, поэтому страховка кодом: " — " → " - ", остальные «—/–» → дефис.
function noDash(s) { return String(s || '').replace(/\s*[—–]\s*/g, ' - ').replace(/^\s*-\s*/gm, m => m); }

function parseJson(s) {
  try { return JSON.parse(s); } catch (_) {}
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

async function initSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS arena_clients (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL,
      persona TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arena_deals (
      id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES arena_clients(id),
      stage_code TEXT NOT NULL DEFAULT 'new', title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      turns INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arena_msgs (
      id SERIAL PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES arena_deals(id),
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      text TEXT NOT NULL, ts BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS arena_msgs_deal_idx ON arena_msgs(deal_id, ts, id);
    CREATE TABLE IF NOT EXISTS arena_suggestions (
      id SERIAL PRIMARY KEY, deal_id INTEGER REFERENCES arena_deals(id),
      text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arena_reviews (
      id SERIAL PRIMARY KEY, deal_id INTEGER NOT NULL REFERENCES arena_deals(id),
      text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function register(app, { pool, auth, requireRole }) {
  const route = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || 'Ошибка арены' }); }
  };

  async function llm(messages, opts) {
    const key = (await crmMod.getSecret(pool, 'OPENROUTER_API_KEY')) || process.env.OPENROUTER_API_KEY;
    if (!key) throw err(500, 'Нет ключа OpenRouter для арены');
    const models = [process.env.ARENA_MODEL, 'anthropic/claude-haiku-4.5', 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini'].filter(Boolean);
    let last = '';
    for (const model of models) {
      // для моделей Anthropic включаем кэш промпта: большой системный блок (знания+скрипты+каталог)
      // при повторных ходах читается из кэша в ~10 раз дешевле
      let msgs = messages;
      if (/^anthropic\//.test(model)) msgs = messages.map(m => m.role === 'system'
        ? { role: 'system', content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] } : m);
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: msgs, temperature: (opts && opts.temp) != null ? opts.temp : 0.7, max_tokens: 700 }),
        signal: AbortSignal.timeout(60000)
      });
      if (r.ok) {
        const d = await r.json();
        const c = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if (c) return c;
        last = 'пустой ответ ' + model;
        continue;
      }
      last = model + ' → ' + r.status;
      if (![400, 404, 429, 502, 503].includes(r.status)) {
        if (r.status === 402) throw err(502, 'OpenRouter исчерпан (402) — пополни лимит');
        break;
      }
    }
    throw err(502, 'LLM недоступна: ' + last);
  }

  async function getDeal(id) {
    const d = await pool.query(`SELECT d.*, c.name AS client_name, c.phone, c.persona FROM arena_deals d JOIN arena_clients c ON c.id=d.client_id WHERE d.id=$1`, [id]);
    if (!d.rowCount) throw err(404, 'Сделка арены не найдена');
    return d.rows[0];
  }
  async function history(dealId, limit) {
    const m = await pool.query(`SELECT direction, text FROM arena_msgs WHERE deal_id=$1 ORDER BY ts DESC, id DESC LIMIT $2`, [dealId, limit || 40]);
    return m.rows.reverse();
  }
  function histText(rows, deal) {
    return rows.map(r => (r.direction === 'in' ? (deal.client_name || 'Клиент') : 'Линда') + ': ' + r.text).join('\n');
  }

  // список вживлённых скиллов Линды (файлы базы знаний): показывается во вкладке «Агент» CRM
  app.get('/api/arena/skills', auth, route(async (req, res) => {
    const dir = path.join(__dirname, 'linda');
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'source-methodology.txt').sort(); } catch (_) {}
    const skills = files.map(f => {
      const full = path.join(dir, f);
      const txt = fs.readFileSync(full, 'utf8');
      const title = (txt.split('\n').find(l => l.trim().startsWith('#')) || f).replace(/^#+\s*/, '').trim();
      const st = fs.statSync(full);
      return { file: f, title, chars: txt.length, updated: st.mtime };
    });
    res.json({ skills });
  }));

  // доска
  app.get('/api/arena/board', auth, route(async (req, res) => {
    const deals = await pool.query(`SELECT d.id, d.stage_code, d.title, d.turns, d.note, d.created_at, c.name AS client_name, c.persona,
      (SELECT text FROM arena_msgs m WHERE m.deal_id=d.id ORDER BY ts DESC, id DESC LIMIT 1) AS last_text,
      (SELECT direction FROM arena_msgs m WHERE m.deal_id=d.id ORDER BY ts DESC, id DESC LIMIT 1) AS last_dir
      FROM arena_deals d JOIN arena_clients c ON c.id=d.client_id ORDER BY d.id DESC`);
    const sug = await pool.query(`SELECT count(*)::int AS n FROM arena_suggestions WHERE status='new'`);
    res.json({ stages: STAGES, deals: deals.rows, newSuggestions: sug.rows[0].n });
  }));

  app.get('/api/arena/deal/:id', auth, route(async (req, res) => {
    const deal = await getDeal(Number(req.params.id));
    const msgs = await pool.query(`SELECT id, direction, text, ts FROM arena_msgs WHERE deal_id=$1 ORDER BY ts, id`, [deal.id]);
    const reviews = await pool.query(`SELECT text, created_at FROM arena_reviews WHERE deal_id=$1 ORDER BY id DESC LIMIT 3`, [deal.id]);
    res.json({ deal, msgs: msgs.rows, reviews: reviews.rows });
  }));

  // агент-КЛИЕНТ создаёт новый лид с первым сообщением
  app.post('/api/arena/new-client', auth, route(async (req, res) => {
    const keys = Object.keys(PERSONAS);
    const pk = PERSONAS[req.body && req.body.persona] ? req.body.persona : keys[Math.floor(Math.random() * keys.length)];
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const phone = '+7 7' + String(Math.floor(Math.random() * 90000000) + 10000000) + ' (арена)';
    const first = await llm([
      { role: 'system', content: 'Ты играешь роль клиента мебельной компании BORZO (столы-трансформеры, Казахстан). Твой типаж: ' + PERSONAS[pk] + '\nТебя зовут ' + name + '. Напиши ПЕРВОЕ сообщение в WhatsApp компании — так, как пишут реальные люди: коротко, иногда с опечатками, по-русски или изредка по-казахски. Только текст сообщения, без кавычек и пояснений.' }
    ], { temp: 0.9 });
    const c = await pool.query(`INSERT INTO arena_clients(name, phone, persona) VALUES($1,$2,$3) RETURNING id`, [name, phone, pk]);
    const d = await pool.query(`INSERT INTO arena_deals(client_id, title, stage_code) VALUES($1,$2,'new') RETURNING id`, [c.rows[0].id, name]);
    await pool.query(`INSERT INTO arena_msgs(deal_id, direction, text, ts) VALUES($1,'in',$2,$3)`, [d.rows[0].id, String(first).trim().slice(0, 1500), Date.now()]);
    res.json({ ok: true, dealId: d.rows[0].id, persona: pk });
  }));

  // ход ЛИНДЫ: ответ + решение по этапу + (редко) предложение правки скрипта
  app.post('/api/arena/deal/:id/linda', auth, route(async (req, res) => {
    const deal = await getDeal(Number(req.params.id));
    const h = await history(deal.id);
    const [cat, scr, akb] = await Promise.all([catalogText(pool), scriptsText(pool), agentKbText(pool)]);
    const sys = 'СИМУЛЯЦИЯ ДЛЯ ОБУЧЕНИЯ (клиент не настоящий, но ты об этом НЕ знаешь — работай как с живым).\n\n' + loadKb() +
      (akb ? '\n\n=== ВКЛАДКА «АГЕНТ» (живые указания руководства) ===\n' + akb : '') +
      (scr ? '\n\n=== БОЕВЫЕ СКРИПТЫ CRM (утверждённые формулировки, опирайся на них) ===\n' + scr : '') +
      '\n\n=== АКТУАЛЬНЫЙ КАТАЛОГ (единственный источник цен и ссылок) ===\n' + cat +
      '\n\n=== ТЕКУЩАЯ СДЕЛКА ===\nКлиент: ' + deal.client_name + '\nЭтап CRM: ' + deal.stage_code +
      '\n\nОтветь строго JSON-объектом:\n{"reply":"текст сообщения клиенту (можно 2-3 коротких сообщения через \\n\\n)","stage":"new|working|selection|paused|won|lost|junk или null если этап не меняется","note":"краткая пометка в карточку или null","suggestion":"если видишь слабое место скрипта/методологии — предложение правки, иначе null"}';
    const raw = await llm([
      { role: 'system', content: sys },
      { role: 'user', content: 'История диалога:\n' + histText(h, deal) + '\n\nТвой ход, Линда. JSON:' }
    ], { temp: 0.4 });
    const j = parseJson(raw) || { reply: String(raw).slice(0, 1200), stage: null };
    if (!j.reply) throw err(502, 'Линда не ответила');
    j.reply = noDash(j.reply);
    await pool.query(`INSERT INTO arena_msgs(deal_id, direction, text, ts) VALUES($1,'out',$2,$3)`, [deal.id, String(j.reply).trim().slice(0, 3000), Date.now()]);
    const valid = STAGES.map(s => s.code);
    let stage = deal.stage_code;
    if (j.stage && valid.includes(j.stage) && j.stage !== deal.stage_code) stage = j.stage;
    else if (deal.stage_code === 'new') stage = 'working';
    await pool.query(`UPDATE arena_deals SET stage_code=$1, turns=turns+1, note=CASE WHEN $2::text IS NOT NULL AND $2<>'' THEN left(note||CASE WHEN note='' THEN '' ELSE E'\n' END||$2, 2000) ELSE note END WHERE id=$3`,
      [stage, j.note ? String(j.note).slice(0, 300) : null, deal.id]);
    if (j.suggestion) await pool.query(`INSERT INTO arena_suggestions(deal_id, text) VALUES($1,$2)`, [deal.id, String(j.suggestion).slice(0, 1500)]);
    res.json({ ok: true, reply: j.reply, stage, suggestion: j.suggestion || null });
  }));

  // ход КЛИЕНТА: ответ по персоне (может промолчать/пропасть)
  app.post('/api/arena/deal/:id/client', auth, route(async (req, res) => {
    const deal = await getDeal(Number(req.params.id));
    const h = await history(deal.id);
    const raw = await llm([
      { role: 'system', content: 'Ты играешь клиента мебельной компании BORZO. Имя: ' + deal.client_name + '. Типаж: ' + PERSONAS[deal.persona] +
        '\nВеди себя как живой человек в WhatsApp: коротко, по-простому, иногда с опечатками, можешь задавать неудобные вопросы, можешь вредничать или тупить по своему типажу. Если по типажу уместно замолчать/пропасть — так и сделай.' +
        '\nОтветь строго JSON: {"action":"reply|silent","reply":"текст если action=reply, иначе null"}' },
      { role: 'user', content: 'Диалог:\n' + histText(h, deal) + '\n\nТвой ход (ты — ' + deal.client_name + '). JSON:' }
    ], { temp: 0.9 });
    const j = parseJson(raw) || { action: 'reply', reply: String(raw).slice(0, 800) };
    if (j.action === 'silent' || !j.reply) { res.json({ ok: true, silent: true }); return; }
    await pool.query(`INSERT INTO arena_msgs(deal_id, direction, text, ts) VALUES($1,'in',$2,$3)`, [deal.id, String(j.reply).trim().slice(0, 1500), Date.now()]);
    res.json({ ok: true, reply: j.reply });
  }));

  // АУДИТОР: разбор диалога по методологии
  app.post('/api/arena/deal/:id/review', auth, route(async (req, res) => {
    const deal = await getDeal(Number(req.params.id));
    const h = await history(deal.id, 80);
    const scr = await scriptsText(pool);
    const raw = await llm([
      { role: 'system', content: 'Ты — аудитор отдела продаж BORZO. Методология:\n' + loadKb().slice(0, 15000) +
        (scr ? '\n\nУтверждённые скрипты CRM (сверяй с ними):\n' + scr.slice(0, 6000) : '') +
        '\n\nРазбери диалог менеджера Линды с клиентом (типаж клиента: ' + PERSONAS[deal.persona] + ', текущий этап: ' + deal.stage_code + ').\nФормат ответа (обычный текст, коротко и по делу):\nОЦЕНКА: X/10\nЧТО ХОРОШО: 1-3 пункта\nОШИБКИ: конкретные места с цитатой\nКАК НАДО: правка формулировок\nВЕРДИКТ ПО ЭТАПУ: верно ли Линда определила этап' },
      { role: 'user', content: histText(h, deal) }
    ], { temp: 0.3 });
    await pool.query(`INSERT INTO arena_reviews(deal_id, text) VALUES($1,$2)`, [deal.id, String(raw).slice(0, 4000)]);
    res.json({ ok: true, review: raw });
  }));

  // ручное перемещение по этапам (для экспериментов)
  app.post('/api/arena/deal/:id/stage', auth, route(async (req, res) => {
    const code = String(req.body.code || '');
    if (!STAGES.some(s => s.code === code)) throw err(400, 'Неизвестный этап');
    await pool.query(`UPDATE arena_deals SET stage_code=$1 WHERE id=$2`, [code, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // предложения Линды по скрипту
  app.get('/api/arena/suggestions', auth, route(async (req, res) => {
    const r = await pool.query(`SELECT s.*, d.title AS deal_title FROM arena_suggestions s LEFT JOIN arena_deals d ON d.id=s.deal_id ORDER BY s.id DESC LIMIT 100`);
    res.json({ suggestions: r.rows });
  }));
  app.post('/api/arena/suggestions/:id', auth, route(async (req, res) => {
    const status = ['approved', 'rejected', 'new'].includes(req.body.status) ? req.body.status : 'new';
    await pool.query(`UPDATE arena_suggestions SET status=$1 WHERE id=$2`, [status, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // полный сброс песочницы (только mgr)
  app.post('/api/arena/reset', auth, requireRole('mgr'), route(async (req, res) => {
    await pool.query(`TRUNCATE arena_reviews, arena_suggestions, arena_msgs, arena_deals, arena_clients RESTART IDENTITY`);
    res.json({ ok: true });
  }));
}

module.exports = { initSchema, register };
