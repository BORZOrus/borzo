/* Инициализация учёток BORZO. Пароли и логины берутся из env, пароли хешируются bcrypt. */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool();

async function upsert(login, pass, role, name){
  const hash = bcrypt.hashSync(pass, 10);
  await pool.query(`
    INSERT INTO users(login, pass_hash, role, name) VALUES($1,$2,$3,$4)
    ON CONFLICT (login) DO UPDATE SET pass_hash=EXCLUDED.pass_hash, role=EXCLUDED.role, name=EXCLUDED.name
  `, [login.toLowerCase(), hash, role, name]);
  console.log('user:', login, '('+role+')');
}

(async()=>{
  await upsert(process.env.MGR_LOGIN||'ruslan', process.env.MGR_PASS||'changeme', 'mgr', process.env.MGR_NAME||'Руслан (руководитель)');
  await upsert(process.env.SUP_LOGIN||'snab', process.env.SUP_PASS||'changeme', 'sup', process.env.SUP_NAME||'Снабженец');
  await pool.end();
  console.log('DONE');
})().catch(e=>{ console.error(e); process.exit(1); });
