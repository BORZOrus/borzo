/* Run against an ISOLATED PostgreSQL database: CRM_TEST_DATABASE_URL=... node --test server/tests/crm.integration.cjs
   Creates/drops only a random test schema. Does not use the production server's PG environment. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const express=require('express');
const bcrypt=require('bcryptjs');
const vm=require('node:vm');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const crm=require('../crm');
const fixture=require('./crm-fixture');
if(!process.env.CRM_TEST_DATABASE_URL)throw Error('Set CRM_TEST_DATABASE_URL to an isolated PostgreSQL database.');
const schema='crm_test_'+crypto.randomBytes(8).toString('hex');
const admin=new Pool({connectionString:process.env.CRM_TEST_DATABASE_URL});
let pool,server,base,uploadDir,beforeSnapshot,stages,tokens,users;
let assertions=0;
const reqId=()=>crypto.randomUUID();
async function request(role,method,url,body,expected=200){
  const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:'Bearer '+tokens[role]}:{})},body:body?JSON.stringify(body):undefined});
  const d=await r.json();assert.equal(r.status,expected,method+' '+url+': '+JSON.stringify(d));assertions++;return d;
}
const api=(role,method,url,body,expected)=>request(role,method,'/api/crm'+url,body,expected);
const send=(role,url,b={},expected)=>api(role,'POST',url,{...b,reqId:reqId()},expected);
async function snapshot(){
  const names=['kassa_tx','sklad_intake','fin_state','users'];const out={};
  for(const name of names)out[name]=(await pool.query('SELECT * FROM '+name+' ORDER BY id')).rows;
  out.apiKassa=await request('mgr','GET','/api/kassa');out.apiFin=await request('fin','GET','/api/fin');out.apiSklad=await request('mgr','GET','/api/sklad');
  return out;
}
before(async()=>{
  await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:process.env.CRM_TEST_DATABASE_URL,options:'-c search_path='+schema,max:12});
  uploadDir=fs.mkdtempSync(path.join(os.tmpdir(),'borzo-crm-test-'));
  // Load the real server without opening its production listener. Existing auth and routes are exercised unchanged.
  const code=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const start=code.lastIndexOf('initSchema().then(()=>{');assert.ok(start>0);
  const ctx={require:n=>n==='pg'?{Pool:function(){return pool;}}:n==='./crm'?crm:require(n),console,
    process:{env:{JWT_SECRET:crypto.randomBytes(32).toString('hex'),UPLOAD_DIR:uploadDir},on:()=>{}},Buffer,
    module:{exports:{}},__dirname:path.join(__dirname,'..'),setTimeout,clearTimeout};
  vm.runInNewContext(code.slice(0,start)+'\nmodule.exports={app,initSchema};',ctx,{filename:'server.js'});
  await ctx.module.exports.initSchema();await ctx.module.exports.initSchema(); // migrations are repeatable
  users={};
  for(const role of ['mgr','fin','sup']){
    const r=await pool.query('INSERT INTO users(login,pass_hash,role,name) VALUES($1,$2,$1,$3) RETURNING id',[role,bcrypt.hashSync('synthetic-test-password',4),'Тест '+role]);users[role]=r.rows[0].id;
  }
  await pool.query("INSERT INTO kassa_tx(id,kind,ts,amount,status,created_by) VALUES('test-issue','issue',1,100000,'accepted',$1),('test-expense','expense',2,10000,NULL,$2)",[users.mgr,users.sup]);
  await pool.query("INSERT INTO sklad_intake(ts,name,qty,unit,sum,category,tx_id) VALUES(2,'Тестовое сырьё','1','шт',10000,'Сырьё','test-expense')");
  await pool.query('INSERT INTO fin_state(id,data,rev,updated_by,updated_at) VALUES(1,$1,7,$2,3)',[JSON.stringify({ops:[{id:'synthetic',kind:'in',amount:90000}],employees:['Тест']}),users.fin]);
  ctx.module.exports.app.use(express.static(path.join(__dirname,'../../app')));
  ctx.module.exports.app.use('/uploads',express.static(uploadDir));
  server=ctx.module.exports.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
  tokens={};for(const role of ['mgr','fin','sup'])tokens[role]=(await request(null,'POST','/api/auth/login',{login:role,password:'synthetic-test-password'})).token;
  stages=(await api('mgr','GET','/meta')).stages;beforeSnapshot=await snapshot();
});
after(async()=>{
  if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();if(uploadDir)fs.rmSync(uploadDir,{recursive:true,force:true});
  console.log('HTTP assertions: '+assertions);
});

test('CRM MVP: actual routes, isolation, concurrency, import and acceptance invariants',async t=>{
  let dealA,dealB;
  await t.test('roles and missing/invalid request IDs',async()=>{
    await api(null,'GET','/deals',null,401);await api('sup','GET','/meta',null,403);
    await send('sup','/deals',{client:{name:'Тест',phone:'+77000000999'}},403);
    await send('fin','/import',{data:fixture()},403);await send('fin','/templates',{title:'Тест',text:'Тест'},403);
    await api('mgr','POST','/deals',{client:{name:'Тест',phone:'+77000000999'}},400);
    await api('mgr','GET','/deals/no-id',null,400);await api('mgr','GET','/deals/2147483647',null,404);
    await api('fin','GET','/templates');
  });
  await t.test('quick creation is atomic and retry-safe, including simultaneous duplicate requests',async()=>{
    const b={reqId:reqId(),client:{name:'<img src=x onerror="window.__xss=1">',phone:'8 (777) 999-88-77',source:'Тест'},amount:335000};
    const both=await Promise.all([api('mgr','POST','/deals',b),api('mgr','POST','/deals',b)]);assert.deepEqual(both[0],both[1]);dealA=both[0].deal;
    assert.equal(dealA.phone,'+77779998877');assert.equal(dealA.client_name,b.client.name);
    assert.equal((await api('fin','GET','/deals/'+dealA.id+'/events')).events.length,1);
    await api('mgr','POST','/deals',{...b,amount:1},409);
    const clientCount=Number((await pool.query('SELECT count(*) FROM crm_clients')).rows[0].count);
    await send('mgr','/deals',{client:{name:'Rollback',phone:'+77779998876'},amount:-1},400);
    assert.equal(Number((await pool.query('SELECT count(*) FROM crm_clients')).rows[0].count),clientCount);
    dealB=(await send('fin','/deals',{client:{name:'Тест Б',phone:'+77779998875'},amount:500})).deal;
  });
  await t.test('concurrent managers on different deals + stale edits to same deal',async()=>{
    const results=await Promise.all([send('mgr','/deals/'+dealA.id+'/stage',{baseRev:dealA.rev,stage_id:stages[1].id}),send('fin','/deals/'+dealB.id+'/stage',{baseRev:dealB.rev,stage_id:stages[2].id})]);
    dealA=results[0].deal;dealB=results[1].deal;assert.equal(dealA.stage_id,stages[1].id);assert.equal(dealB.stage_id,stages[2].id);
    // Two valid requests using the same version: one must win, one must conflict.
    const race=await Promise.all([stages[2],stages[3]].map(s=>fetch(base+'/api/crm/deals/'+dealA.id+'/stage',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.mgr},body:JSON.stringify({reqId:reqId(),baseRev:dealA.rev,stage_id:s.id})})));
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    dealA=(await api('mgr','GET','/deals/'+dealA.id)).deal;
    const entered=dealA.stage_entered_at;
    const patched=await api('fin','PATCH','/deals/'+dealA.id,{reqId:reqId(),baseRev:dealA.rev,note:'<script>window.__xss=2</script>'});dealA=patched.deal;
    assert.equal(dealA.stage_entered_at,entered);assert.equal(dealA.note,'<script>window.__xss=2</script>');
    await api('mgr','PATCH','/deals/'+dealA.id,{reqId:reqId(),baseRev:dealA.rev-1,title:'Lost update'},409);
  });
  await t.test('all stages record author/time; won requires valid composition/date and reopen clears close date',async()=>{
    for(const s of stages){
      const b={baseRev:dealB.rev,stage_id:s.id};
      if(s.is_won){
        await send('fin','/deals/'+dealB.id+'/stage',b,400);
        await send('fin','/deals/'+dealB.id+'/stage',{...b,items:[{name:'X',qty:0,price:5}],ship_date:'2026-09-22'},400);
        await send('fin','/deals/'+dealB.id+'/stage',{...b,items:[{name:'X',qty:1,price:5}],ship_date:'2026-02-30'},400);
        b.items=[{name:'Тестовый стол',qty:1,price:500}];b.ship_date='2026-09-22';
      }
      dealB=(await send('fin','/deals/'+dealB.id+'/stage',b)).deal;
      if(s.is_won)await api('fin','PATCH','/deals/'+dealB.id,{reqId:reqId(),baseRev:dealB.rev,items:[]},400);
    }
    const events=(await api('mgr','GET','/deals/'+dealB.id+'/events')).events;
    assert.equal(events.filter(e=>e.kind==='status').length,8);assert.ok(events.every(e=>e.author_id===users.fin&&e.author_name==='Тест fin'&&e.ts));
    dealB=(await send('fin','/deals/'+dealB.id+'/stage',{baseRev:dealB.rev,stage_id:stages[0].id})).deal;assert.equal(dealB.closed_at,null);
  });
  await t.test('client search/history/edit and replay-safe notes/templates/files',async()=>{
    const list=await api('mgr','GET','/clients?q='+encodeURIComponent('777 999-88-77'));assert.equal(list.clients.length,1);
    const c=(await api('fin','GET','/clients/'+dealA.client_id));assert.equal(c.deals.length,1);
    await api('fin','PATCH','/clients/'+c.client.id,{reqId:reqId(),baseRev:c.client.rev,instagram:'<b>text</b>'});
    const note={reqId:reqId(),kind:'msg',text:'<svg onload="window.__xss=3">'};
    const r=await api('fin','POST','/deals/'+dealA.id+'/events',note);assert.deepEqual(await api('fin','POST','/deals/'+dealA.id+'/events',note),r);
    await send('fin','/deals/'+dealA.id+'/events',{kind:'status',text:'Fake transition'},400);
    const template=(await send('mgr','/templates',{title:'<img src=x>',text:'Тест <b>ответа</b>'})).template;
    const del={reqId:reqId()};await api('mgr','DELETE','/templates/'+template.id,del);await api('mgr','DELETE','/templates/'+template.id,del);
    const file={reqId:reqId(),name:'<img>.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1j8AAAAASUVORK5CYII='};
    const saved=await api('fin','POST','/deals/'+dealA.id+'/files',file);assert.deepEqual(await api('fin','POST','/deals/'+dealA.id+'/files',file),saved);assert.equal(fs.readdirSync(uploadDir).length,1);
    await send('fin','/deals/'+dealA.id+'/files',{name:'bad.png',data:'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='},400);
    await send('fin','/deals/'+dealA.id+'/files',{name:'bad.svg',data:'data:image/svg+xml;base64,PHN2Zz4='},400);
    assert.equal(fs.readdirSync(uploadDir).length,1);
  });
  await t.test('423 deals / 34 products import twice without duplicates or overwrites; failure rolls back',async()=>{
    const data=fixture();const result=await send('mgr','/import',{data});assert.equal(result.counts.deals,423);assert.equal(result.counts.products,34);assert.equal(result.counts.clients,423);
    const before=(await pool.query('SELECT count(*)::int n FROM crm_events')).rows[0].n;
    const imported=(await pool.query("SELECT * FROM crm_deals WHERE ext_id='deal-0'")).rows[0];
    await api('fin','PATCH','/deals/'+imported.id,{reqId:reqId(),baseRev:imported.rev,title:'Manager edit'});
    const second=await send('mgr','/import',{data});assert.equal(second.counts.deals,0);assert.equal(second.counts.skipped_deals,423);assert.equal(second.counts.skipped_products,34);
    assert.equal((await pool.query("SELECT title FROM crm_deals WHERE id=$1",[imported.id])).rows[0].title,'Manager edit');
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm_events')).rows[0].n,before+1);
    const bad=fixture();bad.clients=[{id:'rollback-client',name:'No persistence'}];bad.deals=[{...bad.deals[0],id:'rollback-deal',clientId:'rollback-client'},{...bad.deals[1],id:'invalid-deal',statusId:'unknown'}];
    await send('mgr','/import',{data:bad},400);assert.equal((await pool.query("SELECT * FROM crm_deals WHERE ext_id='rollback-deal'")).rowCount,0);assert.equal((await pool.query("SELECT * FROM crm_clients WHERE ext_id='rollback-client'")).rowCount,0);
    const minimal={stages:[{id:'minimal-won',name:'Выполнено'}],deals:[{id:'minimal-deal',statusId:'minimal-won',clientId:'minimal-client',clientName:'Минимальная выгрузка',contacts:[]}]};
    const min=await send('mgr','/import',{data:minimal});assert.equal(min.counts.incomplete_won,1);assert.equal(min.counts.undated_closed,1);assert.equal(min.counts.undated_leads,1);
    const legacy=(await pool.query("SELECT * FROM crm_deals WHERE ext_id='minimal-deal'")).rows[0];assert.equal(legacy.created_at,null);assert.equal(legacy.closed_at,null);assert.equal(legacy.stage_entered_at,null);
    await send('fin','/deals/'+legacy.id+'/stage',{baseRev:legacy.rev,stage_id:legacy.stage_id},400);
    const filled=await api('fin','PATCH','/deals/'+legacy.id,{reqId:reqId(),baseRev:legacy.rev,items:[{name:'Уточнённый товар',qty:1,price:10}],ship_date:'2026-09-30',closed_at:'2026-09-10T12:00:00+05:00'});assert.equal(filled.deal.imported_incomplete,false);
  });
  await t.test('analytics equals independent manual calculation, including UTC+05 boundary',async()=>{
    const boundary=(await send('mgr','/deals',{client:{name:'Boundary',phone:'+77779998000'}})).deal;
    await pool.query("UPDATE crm_deals SET created_at='2026-08-31T19:00:00Z' WHERE id=$1",[boundary.id]);
    const a=await api('fin','GET','/analytics?from=2026-09-01&to=2026-09-30');
    const rows=(await pool.query('SELECT d.*,s.is_won FROM crm_deals d JOIN crm_stages s ON s.id=d.stage_id')).rows;
    const from=Date.parse('2026-09-01T00:00:00+05:00'),to=Date.parse('2026-10-01T00:00:00+05:00');
    const cohort=rows.filter(d=>+new Date(d.created_at)>=from&&+new Date(d.created_at)<to);
    const sales=rows.filter(d=>d.is_won&&+new Date(d.closed_at)>=from&&+new Date(d.closed_at)<to);
    assert.equal(a.leads,cohort.length);assert.equal(a.won,cohort.filter(d=>d.is_won).length);
    assert.equal(Number(a.sales_amount),sales.reduce((n,d)=>n+Number(d.amount),0));assert.equal(a.sales_count,sales.length);
    assert.equal(a.conversion,Math.round(a.won/a.leads*10000)/100);
    for(const stage of a.stages)assert.equal(stage.count,rows.filter(d=>d.stage_id===stage.id).length);
    for(const source of a.sources)assert.equal(source.count,cohort.filter(d=>d.source===source.source).length);
    await api('mgr','GET','/analytics?from=2026-02-30',null,400);await api('mgr','GET','/analytics?from=2026-10-01&to=2026-09-01',null,400);
  });
  await t.test('all legacy balances, counters, rows and user sessions remain identical',async()=>assert.deepEqual(await snapshot(),beforeSnapshot));
  if(process.env.CRM_BROWSER_TEST==='1')await t.test('mobile browser acceptance and lost response retry',async()=>require('./crm.browser.cjs')({base,pool,stages}));
  await t.test('existing token version revocation applies to CRM',async()=>{
    await pool.query('UPDATE users SET token_ver=token_ver+1 WHERE id=$1',[users.fin]);await api('fin','GET','/deals',null,401);
  });
});
