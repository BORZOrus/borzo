const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async function browserAcceptance({base,pool,stages}){
  const {chromium}=require(process.env.CRM_PLAYWRIGHT_PATH||'playwright');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CRM_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ru-RU'});
  await context.route('https://fonts.googleapis.com/**',r=>r.abort());await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const shot=async name=>{if(process.env.CRM_SCREENSHOT_DIR){await page.evaluate(()=>{var el=document.getElementById('toast');if(el)el.hidden=true;});fs.mkdirSync(process.env.CRM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CRM_SCREENSHOT_DIR,'2026-09-18-'+name+'.png'),fullPage:true});}};
  async function login(role){await page.goto(base+'/login.html');await page.locator('#login').fill(role);await page.locator('#password').fill('synthetic-test-password');await page.locator('#go').click();await page.waitForURL('**/home.html');await page.getByRole('link',{name:/CRM/}).waitFor();}
  try{
    await login('mgr');assert.equal(await page.locator('#tiles a').count(),3);
    await page.getByRole('link',{name:/CRM/}).click();await page.locator('#new-deal:not([disabled])').waitFor();
    const start=Date.now();await page.locator('#new-deal').click();await page.getByLabel('Имя клиента',{exact:true}).fill('Мобильный тест');await page.getByLabel('Телефон',{exact:true}).fill('+77778880001');await page.getByLabel('Источник',{exact:true}).fill('Тест телефона');await page.getByRole('button',{name:'Создать заявку',exact:true}).click();await page.getByRole('heading',{name:'Мобильный тест',exact:true}).waitFor();
    const duration=Date.now()-start;assert.ok(duration<=15000,'Automated quick lead exceeded 15s');console.log('Mobile automated quick lead: '+duration+'ms');
    await page.getByRole('button',{name:'Сменить этап',exact:true}).click();await page.getByLabel('Этап',{exact:true}).selectOption({label:'Выполнено'});
    assert.equal(await page.locator('#won-fields').isVisible(),true);await page.getByRole('button',{name:'Сохранить этап',exact:true}).click();assert.equal(await page.locator('#stage-form').isVisible(),true);
    await page.getByLabel('Изделие',{exact:true}).fill('Синтетический стол');await page.getByLabel('Цена, ₸',{exact:true}).fill('335000');await page.getByLabel('Дата отгрузки',{exact:true}).fill('2026-09-30');await shot('crm-won-mobile');await page.getByRole('button',{name:'Сохранить этап',exact:true}).click();await page.locator('#deal-edit').waitFor();assert.equal(await page.locator('.pill').innerText(),'Выполнено');assert.ok((await page.locator('#sheet-body .amount').innerText()).includes('335')); 
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.locator('#search').fill('Мобильный тест');await shot('crm-board-mobile');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#search').fill('7779998877');await page.locator('[data-deal]').first().click();await page.locator('#event-form').waitFor();
    assert.ok((await page.locator('#sheet-body').innerText()).includes('<script>window.__xss=2</script>'));assert.equal(await page.evaluate(()=>window.__xss),undefined);
    await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    // Server commits, but browser loses the response: retry the exact same payload/reqId.
    let lost=false;const keys=[];
    await page.route('**/api/crm/deals',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      keys.push(route.request().postDataJSON().reqId);
      if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();
    });
    await page.locator('#new-deal').click();await page.getByLabel('Имя клиента',{exact:true}).fill('Потерянный ответ');await page.getByLabel('Телефон',{exact:true}).fill('+77778880002');await page.getByRole('button',{name:'Создать заявку',exact:true}).click();await page.getByRole('button',{name:'Повторить сохранение'}).click();await page.locator('#deal-edit').waitFor();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal((await pool.query("SELECT count(*)::int n FROM crm_deals d JOIN crm_clients c ON c.id=d.client_id WHERE c.phone='+77778880002'")).rows[0].n,1);
    await page.unroute('**/api/crm/deals');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
    await page.locator('[data-tab=analytics]').click();await page.locator('#range-form').waitFor();await shot('crm-analytics-mobile');
    await page.setViewportSize({width:1280,height:900});assert.equal(Math.round((await page.locator('.wrap').boundingBox()).width),520);
    await page.setViewportSize({width:320,height:720});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    // Fresh fin login must land in the foyer and retain access to existing Finance.
    await context.clearCookies();await page.evaluate(()=>localStorage.clear());await page.setViewportSize({width:390,height:844});await login('fin');
    assert.equal(await page.locator('#tiles a').count(),2);await shot('crm-fin-home');
    await page.getByRole('link',{name:/Финансы/}).click();await page.waitForURL('**/fin.html');assert.ok((await page.content()).includes('fin.js'));
    await page.goto(base+'/home.html');await page.getByRole('link',{name:/CRM/}).click();await page.locator('#new-deal:not([disabled])').waitFor();assert.equal(await page.locator('#import-tab').isVisible(),false);
    await page.locator('#new-deal').click();await page.getByLabel('Имя клиента',{exact:true}).fill('Заявка финансиста');await page.getByLabel('Телефон',{exact:true}).fill('+77778880003');await page.getByRole('button',{name:'Создать заявку',exact:true}).click();await page.locator('#deal-edit').waitFor();
    assert.equal(await page.evaluate(()=>window.__xss),undefined);assert.deepEqual(errors,[]);
  }finally{await context.close();await browser.close();}
};
