/* BORZO — Финансы (прототип, демо localStorage).
   Операции: in / out / transfer / close(закрытие аванса).
   Счета: проекты (BORZO,IT,Перила) + zpRuslan + zpUlyana.
   Зарплата/аванс = out c salary:{emp,type} (списывает деньги с проекта). Аванс горит, закрывается (close) — переформулировка, не движение денег.
   Личный расход Руслана = out из zpRuslan; пополнить зарплату = transfer проект→zpRuslan.
   Ульяна: расход/зарплата из BORZO; личное из zpUlyana; семейное = out из BORZO family=true (трата зарплаты Руслана). */
(function(){
  var $=function(id){return document.getElementById(id);};
  var KEY='borzo_fin_v2';
  var PROJECTS=['BORZO','IT'];
  // Дефолтные категории (стартовый набор). Дальше живут в DB.cats — их можно добавлять/удалять.
  var CATS={
    in:['Оплата заказа','Аванс клиента','Услуги'],
    work:['Сырьё','Аренда','Реклама','Оборудование','Логистика','Токены/ИИ'],
    pers_ruslan:['Обед','Бензин','Одежда','Развлечения','Падл'],
    pers_ulyana:['Ногти','Волосы','Вещи','Еда'],
    family:['Еда','Комуслуги','Школа','Кружки','Аптека']
  };
  // Каталог изделий. Столы-трансформеры: модель × размер (цена) × цвет. Прочее — название+цена вручную.
  var TABLE={
    models:['LUX','Геометрия'],
    sizes:['3,0 м','3,5 м','4,0 м'],
    colors:['Чёрный-золото','Белый-золото','Крем-золото','Чёрно-серебро','Белый-серебро','Белый-чёрный','Серый-чёрный'],
    price:{ 'LUX':{'3,0 м':310000,'3,5 м':335000,'4,0 м':360000}, 'Геометрия':{'3,0 м':335000,'3,5 м':360000,'4,0 м':385000} }
  };
  var CATEGORIES=['Столы-трансформеры','Тумбочки','Консоли','Банкетки','Другое'];
  var PAYS=['Kaspi','Перечисление','Наличка'];
  function load(){ try{var d=JSON.parse(localStorage.getItem(KEY)); if(d&&d.ops){ if(!d.deleted)d.deleted={}; return d; }}catch(e){} return {ops:[],employees:['Руслан','Ульяна','Азамат','Данияр'],deleted:{}}; }
  // облако: залогинен (есть токен) → сервер источник правды; нет токена → демо на localStorage как раньше
  var CLOUD = !!(window.API && window.API.token && window.API.finPut);
  var pushT=null, pushing=false, pendAgain=false;
  var uFeed='fin';   // лента Ульяны в BORZO: 'fin' финансы (ручные) | 'snab' снабжение (закупки/выдачи)
  var synced=false;      // до завершения первого finGet НИЧЕГО не отправляем на сервер (защита от затирания истории пустой базой)
  var curRev=0;          // версия, на которой построена локальная база (для сравнения версий на сервере)
  var conflictTries=0;   // ограничитель повторов при конфликте
  // слияние при конфликте: объединяем операции по id, уважая удаления («надгробия» deleted) и локальные правки (по метке времени _t).
  // Раньше серверная база слепо перекрывала местные удаления/правки — одобренное удаление и правки откатывались при параллельной работе.
  function mergeDB(server, local){
    var out = {}; for(var k in server){ if(Object.prototype.hasOwnProperty.call(server,k)) out[k]=server[k]; }
    var sOps = Array.isArray(server.ops)?server.ops:[];
    var lOps = Array.isArray(local.ops)?local.ops:[];
    var del = {}; var sd=server.deleted||{}, ld=local.deleted||{};   // объединяем надгробия обеих сторон
    for(var dk in sd) del[dk]=sd[dk]; for(var dk2 in ld) del[dk2]=ld[dk2];
    var sMap={}, lMap={}, ids={};
    sOps.forEach(function(o){ if(o&&o.id!=null){ sMap[o.id]=o; ids[o.id]=1; } });
    lOps.forEach(function(o){ if(o&&o.id!=null){ lMap[o.id]=o; ids[o.id]=1; } });
    var merged=[];
    Object.keys(ids).forEach(function(id){
      if(del[id]) return;                                  // удалено (одобрено удаление) — не воскрешаем
      var s=sMap[id], l=lMap[id];
      if(s&&l) merged.push(((l._t||0)>(s._t||0))?l:s);      // обе стороны знают операцию — берём свежее изменённую
      else merged.push(s||l);                              // известна одной стороне — берём её
    });
    out.ops = merged.sort(function(a,b){ return (b&&b.ts||0)-(a&&a.ts||0); });
    out.deleted = del;
    var se=Array.isArray(server.employees)?server.employees:[], le=Array.isArray(local.employees)?local.employees:[];
    out.employees = se.concat(le.filter(function(x){ return se.indexOf(x)<0; }));
    return out;
  }
  function touch(o){ if(o) o._t=Date.now(); return o; }   // пометка «локально изменено сейчас» — чтобы merge не откатил правку
  function doPush(){ if(!CLOUD||!synced)return; if(pushing){pendAgain=true;return;} pushing=true;
    window.API.finPut(DB,curRev).then(function(res){ pushing=false; conflictTries=0; if(res&&res.rev!=null)curRev=res.rev; if(pendAgain){pendAgain=false;doPush();}})
      .catch(function(e){ pushing=false;
        // конфликт версий/защита от затирания → взять серверную правду, влить свои новые операции, повторить
        var isConf = e && (e.status===409 || (e.body&&e.body.conflict) || /сокращени|409|устарел|параллельн/i.test(e.message||''));
        if(isConf && conflictTries<5){ conflictTries++;
          var sd = e.body && e.body.data;
          var apply = function(server,rev){ if(!server||!Array.isArray(server.ops))return; DB=mergeDB(server,DB); curRev=rev||curRev; localStorage.setItem(KEY,JSON.stringify(DB)); if(typeof render==='function')render(); doPush(); };
          if(sd){ apply(sd, e.body.rev); }
          else { window.API.finGet().then(function(r){ apply(r&&r.data, r&&r.rev); }).catch(function(){}); }
        }
      }); }
  function cloudPush(){ if(!CLOUD)return; clearTimeout(pushT); pushT=setTimeout(doPush,800); }
  function save(){ localStorage.setItem(KEY,JSON.stringify(DB)); cloudPush(); }
  if(/[?&]reset=1/.test(location.search)){ try{localStorage.removeItem(KEY);}catch(e){} try{history.replaceState({},'',location.pathname);}catch(e){} }
  var DB=load();
  if(!DB.employees) DB.employees=['Руслан','Ульяна','Азамат','Данияр'];
  if(!DB.cats) DB.cats={};
  if(!DB.empMeta) DB.empMeta={};
  if(!DB.seeded){ if(DB.employees.indexOf('Елена')<0)DB.employees.push('Елена'); DB.seeded=true; save(); }
  // список категорий контекста (in/work/pers_ruslan/pers_ulyana/family). Инициализируется из дефолтов, дальше редактируется.
  function ctxCats(ctx){ if(!DB.cats[ctx]) DB.cats[ctx]=(CATS[ctx]||[]).slice(); return DB.cats[ctx]; }
  // способы оплаты — редактируемый список с сохранением
  function paysList(){ if(!DB.pays) DB.pays=['Kaspi город','Наличка город','InDriver межгород','Перечисление']; return DB.pays; }
  // каталог изделий — категории и по каждой модель/размер/цвет/цены, всё редактируется и сохраняется
  function flattenPrice(pm){ var o={}; for(var m in pm){ for(var s in pm[m]){ o[m+'|'+s]=pm[m][s]; } } return o; }
  function catalog(){ if(!DB.catalog){ DB.catalog={categories:CATEGORIES.filter(function(c){return c!=='Другое';}),byCat:{}};
      DB.catalog.byCat['Столы-трансформеры']={models:TABLE.models.slice(),sizes:TABLE.sizes.slice(),colors:TABLE.colors.slice(),price:flattenPrice(TABLE.price)};
      DB.catalog.categories.forEach(function(c){ if(!DB.catalog.byCat[c])DB.catalog.byCat[c]={models:[],sizes:[],colors:[],price:{}}; }); save(); }
    return DB.catalog; }
  function catCfg(cat){ var c=catalog(); if(!c.byCat[cat])c.byCat[cat]={models:[],sizes:[],colors:[],price:{}}; return c.byCat[cat]; }
  // редактируемые чипсы (значения в массиве arr; «+» добавляет и сохраняет)
  function editChipsHtml(id,list,lbl){ return '<div class="chips" id="'+id+'">'+list.map(function(v,i){return '<button data-v="'+esc(v)+'"'+(i===0?' class="on"':'')+'>'+esc(v)+'</button>';}).join('')+'<button class="chip-add" data-add="1" title="Добавить '+lbl+'">+</button></div>'; }
  // долгое нажатие (моб.) / правый клик (десктоп)
  function attachLongPress(el,cb){ var t=null; var guard=function(){ if(window.__lpG&&Date.now()-window.__lpG<600)return; window.__lpG=Date.now(); cb(); };
    el.addEventListener('touchstart',function(){ t=setTimeout(function(){t=null;guard();},480); },{passive:true});
    var cancel=function(){ if(t){clearTimeout(t);t=null;} }; el.addEventListener('touchend',cancel); el.addEventListener('touchmove',cancel);
    el.addEventListener('contextmenu',function(e){ e.preventDefault(); guard(); }); }
  function askMenu(title,inner,onPick){ var w=document.createElement('div'); w.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:65;display:flex;align-items:flex-end;justify-content:center';
    w.innerHTML='<div style="background:var(--card);border-radius:20px 20px 0 0;padding:16px;max-width:520px;width:100%"><h3 style="margin:0 0 10px;font-size:16px">'+title+'</h3>'+inner+'<button class="btn btn-ghost" id="mn-cancel" style="margin-top:10px">Отмена</button></div>';
    document.body.appendChild(w); function done(){ if(w.parentNode)document.body.removeChild(w); }
    Array.prototype.forEach.call(w.querySelectorAll('[data-a]'),function(el){ el.onclick=function(){ done(); onPick(el.getAttribute('data-a')); }; });
    w.querySelector('#mn-cancel').onclick=done; }
  function wireEditChips(id,arr,lbl,onchange){ var box=$(id); var on0=box.querySelector('.on'); var val=on0?on0.getAttribute('data-v'):(arr[0]||'');
    function draw(){ box.innerHTML=arr.map(function(v){return '<button data-v="'+esc(v)+'"'+(v===val?' class="on"':'')+'>'+esc(v)+'</button>';}).join('')+'<button class="chip-add" data-add="1" title="Добавить '+lbl+'">+</button>'; bind(); }
    function pick(b){ Array.prototype.forEach.call(box.querySelectorAll('button'),function(x){x.className=x.getAttribute('data-add')?'chip-add':'';}); b.className='on'; val=b.getAttribute('data-v'); if(onchange)onchange(val); }
    function menu(v){ var inner='<div class="card" style="padding:2px 14px">'+
        '<div class="op" data-a="up" style="cursor:pointer"><div style="flex:1">⬆ В начало</div></div>'+
        '<div class="op" data-a="left" style="cursor:pointer"><div style="flex:1">◀ Левее</div></div>'+
        '<div class="op" data-a="right" style="cursor:pointer"><div style="flex:1">▶ Правее</div></div>'+
        '<div class="op" data-a="del" style="cursor:pointer;color:var(--red)"><div style="flex:1">🗑 Удалить «'+esc(v)+'»</div></div></div>';
      askMenu('«'+v+'» — переместить / удалить',inner,function(a){ var idx=arr.indexOf(v); if(idx<0)return;
        if(a==='del'){ if(!confirm('Удалить «'+v+'»?'))return; arr.splice(idx,1); if(val===v)val=arr[0]||''; }
        else if(a==='up'){ arr.splice(idx,1); arr.unshift(v); }
        else if(a==='left'&&idx>0){ arr.splice(idx,1); arr.splice(idx-1,0,v); }
        else if(a==='right'&&idx<arr.length-1){ arr.splice(idx,1); arr.splice(idx+1,0,v); }
        save(); draw(); if(onchange)onchange(val); }); }
    function bind(){ Array.prototype.forEach.call(box.querySelectorAll('button'),function(b){
      if(b.getAttribute('data-add')){ b.onclick=function(){ var v=(prompt('Добавить '+lbl+':')||'').trim(); if(!v)return; if(arr.indexOf(v)<0){arr.push(v);save();} val=v; draw(); if(onchange)onchange(val); }; return; }
      b.onclick=function(){pick(b);}; attachLongPress(b,function(){ menu(b.getAttribute('data-v')); }); }); }
    bind();
    return function(){return val;}; }
  // сотрудник → проект ('' = во всех проектах). Разные проекты — разные сотрудники.
  function empProj(e){ return (DB.empMeta[e]||{}).proj||''; }
  function empsForProject(p){ return DB.employees.filter(function(e){ var mp=empProj(e); return !mp||mp===p; }); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function money(n){ n=Math.round(+n||0); return n.toLocaleString('ru-RU')+' ₸'; }
  function uid(){ return 'o'+Date.now()+Math.floor(Math.random()*10000); }
  function pad(x){return x<10?'0'+x:''+x;}
  // время операций всегда по Астане (Asia/Almaty), независимо от часового пояса устройства
  function almP(ts){ var p={}; try{ new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(ts)).forEach(function(x){p[x.type]=x.value;}); if(p.hour==='24')p.hour='00'; }catch(e){ var d=new Date(ts); p={day:pad(d.getDate()),month:pad(d.getMonth()+1),year:''+d.getFullYear(),hour:pad(d.getHours()),minute:pad(d.getMinutes())}; } return p; }
  function fdate(ts){ var p=almP(ts); return p.day+'.'+p.month+' '+p.hour+':'+p.minute; }
  function fdate2(ts){ var p=almP(ts); return p.day+'.'+p.month+'.'+p.year+' '+p.hour+':'+p.minute; }
  var MON=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  // диапазон месяца по смещению (0=текущий, -1=прошлый)
  function monthRange(off){ var d=new Date(); var s=new Date(d.getFullYear(),d.getMonth()+off,1); var e=new Date(d.getFullYear(),d.getMonth()+off+1,1); return {s:s.getTime(),e:e.getTime(),name:MON[s.getMonth()]+' '+s.getFullYear()}; }
  function inRange(o,r){ return o.ts>=r.s && o.ts<r.e; }
  // для зарплат/закрытий: считаем по выбранному месяцу o.per (за какой месяц начислено), иначе по дате операции
  function inRangeS(o,r){ var t=o.per||o.ts; return t>=r.s && t<r.e; }
  var curR=monthRange(0);
  var potSnab=0;  // подотчёт снабженца (из кассы снабжения), для разбивки котла BORZO
  function loadPot(){ if(!(window.API&&window.API.token&&window.API.kassa))return; window.API.kassa().then(function(d){ potSnab=d.balance||0; render(); }).catch(function(){}); }

  function balance(acc){
    var b=0; DB.ops.forEach(function(o){
      if(o.kind==='in'&&o.acc===acc) b+=o.amount;
      else if((o.kind==='out'||o.kind==='return')&&o.acc===acc) b-=o.amount;
      else if(o.kind==='transfer'){ if(o.from===acc)b-=o.amount; if(o.to===acc)b+=o.amount; }
    }); return b;
  }
  function sumW(fn){ var s=0; DB.ops.forEach(function(o){ if(fn(o))s+=o.amount; }); return s; }
  function addOp(o){ o.id=o.id||uid(); o.ts=o.ts||Date.now(); DB.ops.unshift(o); save(); return o; }
  function opsSorted(){ return DB.ops.slice().sort(function(a,b){return b.ts-a.ts;}); }

  // ---------- подтверждение операции («накладная» перед проведением) ----------
  function prow(l,v){ return '<div class="anrow" style="border:none;padding:1px 0;font-size:12px;color:var(--mut)"><span>'+l+'</span><span>'+v+'</span></div>'; }
  function opKindLabel(o){
    if(o.salary) return (o.salary.type==='advance'?'Аванс':'Зарплата')+' · '+o.salary.emp;
    if(o.kind==='in') return o.sale?'Продажа':(o.category||'Приход');
    if(o.kind==='transfer') return 'Перевод'+(o.note?' '+o.note:'');
    if(o.kind==='credit') return 'Кредит (остаток) · '+((o.credit&&o.credit.name)||'');
    if(o.kind==='close') return 'Закрытие аванса · '+o.emp;
    if(o.kind==='return') return 'Возврат';
    return o.category||'Расход';
  }
  function opPreviewHtml(o){
    var sign=(o.kind==='in')?'+':((o.kind==='out'||o.kind==='return')?'−':'');
    var color=(o.kind==='in')?'var(--blue)':((o.kind==='out'||o.kind==='return')?'var(--red)':'var(--violet)');
    var h='<div class="card" style="padding:10px 14px;margin-bottom:8px"><div class="anrow" style="border:none;padding:2px 0"><span style="font-weight:700">'+esc(opKindLabel(o))+'</span><b style="color:'+color+'">'+sign+money(o.amount)+'</b></div>';
    if(o.project) h+=prow('Проект',esc(o.project));
    if(o.per) h+=prow('За месяц',perName(o.per));
    if(o.sale&&o.sale.items){ h+=o.sale.items.map(function(i){return prow(esc(i.name)+' × '+i.qty,money(i.sum||i.price*i.qty));}).join(''); if(o.sale.pay)h+=prow('Оплата',esc(o.sale.pay)); }
    if(o.credit){ if(o.credit.principal)h+=prow('Тело (в кассу)',money(o.credit.principal)); if(o.credit.total)h+=prow('Вернуть всего',money(o.credit.total)); if(o.credit.monthly)h+=prow('Платёж/мес',money(o.credit.monthly)); if(o.credit.nextDate)h+=prow('Дата платежа',fdate2(o.credit.nextDate)); }
    if(o.note&&!o.sale&&o.kind!=='transfer') h+=prow('Примечание',esc(o.note));
    if(o.who) h+=prow('Провёл',o.who==='ulyana'?'Ульяна':'Руслан');
    return h+'</div>';
  }
  function askConfirm(title,inner,onOk){
    var w=document.createElement('div');
    w.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:flex;align-items:flex-end;justify-content:center';
    w.innerHTML='<div style="background:var(--card);border-radius:20px 20px 0 0;padding:18px 16px 26px;max-width:520px;width:100%;max-height:88vh;overflow:auto"><h3 style="margin:0 0 6px;font-size:17px">'+title+'</h3><div style="font-size:12px;color:var(--mut);margin-bottom:12px">Проверь перед проведением:</div>'+inner+'<button class="btn" id="cf-ok" style="background:var(--green);color:#04140b;margin-top:8px">✓ Подтвердить</button><button class="btn btn-ghost" id="cf-cancel" style="margin-top:8px">Отмена / изменить</button></div>';
    document.body.appendChild(w);
    w.querySelector('#cf-ok').onclick=function(){ document.body.removeChild(w); onOk(); };
    w.querySelector('#cf-cancel').onclick=function(){ document.body.removeChild(w); };
  }
  // собрать список op-ов, показать подтверждение, при ОК — провести и выполнить done (иначе close+render)
  function commit(list,done,title){ list=(list||[]).filter(Boolean); if(!list.length)return;
    askConfirm(title||'Проверьте операцию',list.map(opPreviewHtml).join(''),function(){ list.forEach(function(o){addOp(o);}); if(done)done(); else { close(); render(); } }); }

  // сотрудники с личным счётом в системе — зарплата им зачисляется в кошелёк (transfer), остальным = расход бизнеса налом (out)
  var EMP_ACCT={'Ульяна':'zpUlyana','Руслан':'zpRuslan'};
  // авансы (kind у зарплатной операции может быть out или transfer — считаем по o.salary, не по kind)
  function advBurning(emp){ return sumW(function(o){return o.salary&&o.salary.type==='advance'&&o.salary.emp===emp;}) - sumW(function(o){return o.kind==='close'&&o.emp===emp;}); }
  function salaryOf(emp,r){ return sumW(function(o){return o.salary&&o.salary.type==='salary'&&o.salary.emp===emp&&inRangeS(o,r);}) + sumW(function(o){return o.kind==='close'&&o.emp===emp&&inRangeS(o,r);}); }
  function advOf(emp,r){ return sumW(function(o){return o.salary&&o.salary.type==='advance'&&o.salary.emp===emp&&inRangeS(o,r);}); }
  function burningEmps(){ return empsWith(null).filter(function(e){return advBurning(e)>0;}); }
  // сотрудники: объединение ростера и всех, у кого есть начисления (чтобы история не терялась при удалении из списка)
  function empsWith(r){ var s={}; DB.employees.forEach(function(e){s[e]=1;}); DB.ops.forEach(function(o){ if(o.salary&&o.salary.emp&&(!r||inRangeS(o,r)))s[o.salary.emp]=1; if(o.kind==='close'&&o.emp&&(!r||inRangeS(o,r)))s[o.emp]=1; }); return Object.keys(s); }
  function empHasOps(emp){ for(var i=0;i<DB.ops.length;i++){var o=DB.ops[i]; if((o.salary&&o.salary.emp===emp)||(o.kind==='close'&&o.emp===emp))return true;} return false; }
  function renameEmp(oldN,newN){ var i=DB.employees.indexOf(oldN); if(i>=0)DB.employees[i]=newN; DB.ops.forEach(function(o){ if(o.salary&&o.salary.emp===oldN)o.salary.emp=newN; if(o.kind==='close'&&o.emp===oldN)o.emp=newN; }); save(); }
  function removeEmp(emp){ var i=DB.employees.indexOf(emp); if(i>=0)DB.employees.splice(i,1); save(); }
  // Единый хаб: начислить + список сотрудников + управление (одна кнопка «Зарплаты»)
  function formSalaryHub(cfg){
    var rows=DB.employees.length?DB.employees.map(function(e){ var sal=salaryOf(e,curR),burn=advBurning(e),mp=empProj(e);
      return '<div class="op" data-emp="'+esc(e)+'" style="cursor:pointer"><div class="ic ic-tr">👤</div><div style="flex:1"><div class="main-t">'+esc(e)+' <span class="pill" style="font-size:10px">'+(mp||'все')+'</span></div><div class="sub-t">за '+curR.name+': '+money(sal)+(burn>0?' · <span style="color:var(--red)">аванс '+money(burn)+'</span>':'')+'</div></div><div class="amt" style="color:var(--mut)">›</div></div>';
    }).join(''):'<div class="empty">Сотрудников пока нет.</div>';
    var nBurn=burningEmps().length;
    open('<h3>💰 Зарплаты</h3>'+
      '<button class="btn" id="sal-add" style="background:var(--green);color:#04140b;margin-bottom:10px">+ Начислить зарплату / аванс</button>'+
      '<button class="btn btn-ghost" id="adv-open" style="margin-bottom:14px'+(nBurn?';color:var(--red)':'')+'">🔴 Открытые авансы'+(nBurn?' ('+nBurn+')':' — нет')+'</button>'+
      '<div style="font-weight:700;font-size:13px;color:var(--mut);margin:2px 0 8px;text-transform:uppercase">Сотрудники</div>'+
      '<div class="card" style="padding:2px 14px">'+rows+'</div>'+
      '<button class="btn btn-ghost" id="emp-add" style="margin-top:12px">+ Добавить сотрудника</button>'+
      '<button class="btn btn-ghost" id="f-cancel" style="margin-top:8px">Закрыть</button>');
    $('f-cancel').onclick=close;
    $('sal-add').onclick=function(){ formSalary(cfg); };
    $('adv-open').onclick=function(){ formAdvances(cfg); };
    $('emp-add').onclick=function(){ var v=(prompt('Имя сотрудника:')||'').trim(); if(!v)return; if(DB.employees.indexOf(v)<0)DB.employees.push(v); if(!DB.empMeta[v])DB.empMeta[v]={proj:(cfg.fixedProj||'')}; save(); formSalaryHub(cfg); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-emp]'),function(b){b.onclick=function(){formEmployee(b.getAttribute('data-emp'),cfg);};});
  }
  function formAdvances(cfg){
    var list=burningEmps();
    var rows=list.length?list.map(function(e){return '<div class="op" data-adv="'+esc(e)+'" style="cursor:pointer"><div class="ic ic-out" style="color:var(--red)">🔴</div><div style="flex:1"><div class="main-t">'+esc(e)+'</div><div class="sub-t">горит аванс · нажми закрыть</div></div><div class="amt amt-out">'+money(advBurning(e))+'</div></div>';}).join(''):'<div class="empty">Открытых авансов нет.</div>';
    open('<h3>🔴 Открытые авансы</h3><div style="font-size:12px;color:var(--mut);margin-bottom:10px">Кому выдан аванс и он ещё не зачтён в зарплату. Нажми на сотрудника — закрыть (полностью или частично).</div><div class="card" style="padding:2px 14px">'+rows+'</div><button class="btn btn-ghost" id="f-cancel" style="margin-top:12px">Назад</button>');
    $('f-cancel').onclick=function(){formSalaryHub(cfg);};
    Array.prototype.forEach.call(document.querySelectorAll('[data-adv]'),function(b){b.onclick=function(){formCloseAdvance(b.getAttribute('data-adv'),function(){formAdvances(cfg);});};});
  }
  function formEmployee(emp,cfg){
    var burn=advBurning(emp), hist='';
    for(var k=0;k>-12;k--){ var r=monthRange(k),sal=salaryOf(emp,r),adv=advOf(emp,r); if(sal||adv){ hist+='<div class="anrow"><span>'+r.name+'</span><b>'+money(sal)+(adv?' <span class="muted">(аванс '+money(adv)+')</span>':'')+'</b></div>'; } }
    if(!hist)hist='<div class="empty">Начислений пока нет.</div>';
    var cur=empProj(emp)||'Все';
    open('<h3>👤 '+esc(emp)+'</h3>'+
      (burn>0?'<div class="card" style="padding:12px 14px;margin-bottom:12px;border-color:rgba(240,85,92,.4)"><div class="anrow" style="border:none;padding:0"><span class="advrow">🔴 Горит аванс</span><span class="advrow">'+money(burn)+'</span></div><button class="btn btn-ghost" id="emp-close" style="margin-top:10px">Закрыть аванс</button></div>':'')+
      '<div class="fld"><label>Проект / компания</label><div class="chips" id="emp-proj">'+['Все'].concat(PROJECTS).map(function(p){return '<button data-v="'+p+'"'+(p===cur?' class="on"':'')+'>'+p+'</button>';}).join('')+'</div></div>'+
      '<div style="font-weight:700;font-size:13px;color:var(--mut);margin:8px 0 8px;text-transform:uppercase">История зарплаты</div>'+hist+
      '<button class="btn btn-ghost" id="emp-rename" style="margin-top:14px">✏️ Переименовать</button>'+
      '<button class="btn btn-ghost" id="emp-del" style="margin-top:8px;color:var(--red)">🗑 Удалить</button>'+
      '<button class="btn btn-ghost" id="f-cancel" style="margin-top:8px">Назад</button>');
    $('f-cancel').onclick=function(){formSalaryHub(cfg);};
    if($('emp-close'))$('emp-close').onclick=function(){formCloseAdvance(emp,function(){formEmployee(emp,cfg);});};
    Array.prototype.forEach.call(document.querySelectorAll('#emp-proj button'),function(b){b.onclick=function(){ Array.prototype.forEach.call(document.querySelectorAll('#emp-proj button'),function(x){x.className='';}); b.className='on'; var v=b.getAttribute('data-v'); if(!DB.empMeta[emp])DB.empMeta[emp]={}; DB.empMeta[emp].proj=(v==='Все'?'':v); save(); };});
    $('emp-rename').onclick=function(){
      if(EMP_ACCT[emp]){ alert('«'+emp+'» — владелец личного кошелька, переименование разорвёт привязку зарплаты к кошельку. Имя защищено.'); return; }   // аудит #28
      var v=(prompt('Новое имя:',emp)||'').trim(); if(!v||v===emp)return; if(DB.empMeta[emp]){DB.empMeta[v]=DB.empMeta[emp];delete DB.empMeta[emp];} renameEmp(emp,v); render(); formEmployee(v,cfg); };
    $('emp-del').onclick=function(){ if(empHasOps(emp)){ if(!confirm('У «'+emp+'» есть история начислений. Убрать из активного списка? История в аналитике сохранится.'))return; } else if(!confirm('Удалить «'+emp+'»?'))return; removeEmp(emp); render(); formSalaryHub(cfg); };
  }

  // ---------- sheet ----------
  var sheetBg=$('sheet-bg'),sheet=$('sheet'),body=$('sheet-body');
  function open(html){ body.innerHTML=html; sheetBg.classList.add('on'); sheet.classList.add('on'); }
  function close(){ sheetBg.classList.remove('on'); sheet.classList.remove('on'); }
  sheetBg.onclick=close;

  function amtField(){ return '<div class="fld"><label>Сумма, ₸</label><input type="number" inputmode="numeric" id="f-amt" placeholder="0"></div>'; }
  // выбор «за какой месяц» (для зарплаты/закрытия аванса). value = смещение месяца (0=текущий).
  function monthSelect(id,def){ var opts=''; for(var k=0;k>-12;k--){var r=monthRange(k); opts+='<option value="'+k+'"'+(k===(def||0)?' selected':'')+'>'+r.name+'</option>';} return '<div class="fld"><label>За какой месяц</label><select id="'+id+'">'+opts+'</select></div>'; }
  function monthPer(id){ return monthRange(parseInt($(id).value)||0).s; }
  function getAmt(){ var a=parseInt($('f-amt').value)||0; if(a<=0){alert('Укажите сумму');return 0;} return a; }
  function acts(ok){ return '<button class="btn" id="f-ok" style="background:var(--green);color:#04140b">'+ok+'</button><button class="btn btn-ghost" id="f-cancel" style="margin-top:8px">Отмена</button>'; }
  function wireActs(fn){ $('f-cancel').onclick=close; $('f-ok').onclick=fn; }

  // квадраты проектов с балансом (выбор)
  function squares(id,projects){ return '<div class="fld"><label>Проект — с какого счёта</label><div class="sqs" id="'+id+'">'+
    projects.map(function(p,i){return '<div class="sq'+(i===0?' on':'')+'" data-v="'+p+'"><div class="n">'+p+'</div><div class="b">'+money(balance(p))+'</div></div>';}).join('')+'</div></div>'; }
  function wireSquares(id,onchange){ var box=$(id),val=projects0(box); Array.prototype.forEach.call(box.querySelectorAll('.sq'),function(s){ s.onclick=function(){ Array.prototype.forEach.call(box.querySelectorAll('.sq'),function(x){x.className='sq';}); s.className='sq on'; val=s.getAttribute('data-v'); if(onchange)onchange(val); }; }); return function(){return val;}; }
  function projects0(box){ var f=box.querySelector('.sq.on'); return f?f.getAttribute('data-v'):''; }

  // чипсы категорий (+своё)
  function chips(label,list,id){ return '<div class="fld"><label>'+label+'</label><div class="chips" id="'+id+'">'+
    list.map(function(c,i){return '<button data-v="'+c+'"'+(i===0?' class="on"':'')+'>'+c+'</button>';}).join('')+'<button data-add="1">+ своё</button></div></div>'; }
  function wireChips(id){ var box=$(id),val=(box.querySelector('.on')||{}).getAttribute?box.querySelector('.on').getAttribute('data-v'):'';
    Array.prototype.forEach.call(box.querySelectorAll('button'),function(b){ b.onclick=function(){ if(b.getAttribute('data-add')){var v=prompt('Новая категория:');if(!v)return;var nb=document.createElement('button');nb.setAttribute('data-v',v);nb.textContent=v;box.insertBefore(nb,b);nb.onclick=function(){pick(nb);};pick(nb);return;} pick(b); }; });
    function pick(b){ Array.prototype.forEach.call(box.querySelectorAll('button'),function(x){x.className='';}); b.className='on'; val=b.getAttribute('data-v'); }
    return function(){return val;}; }

  // ---- категории: аккуратный список + конструктор (добавить/удалить) + «Другое» (свободная строка) ----
  // ctx: in/work/pers_ruslan/pers_ulyana/family. sel — предвыбранная категория (для правки).
  function catField(label,ctx,id,sel){ var list=ctxCats(ctx);
    var selIdx = (sel!=null) ? list.indexOf(sel) : 0;
    var isOther = (sel!=null && sel!=='' && selIdx<0);
    var rows=list.map(function(c,i){ return '<div class="catrow'+(i===selIdx&&!isOther?' on':'')+'" data-i="'+i+'"><span class="cr-name">'+esc(c)+'</span><button type="button" class="cr-del" data-di="'+i+'" title="удалить">✕</button></div>'; }).join('');
    var other='<div class="catrow other'+(isOther?' on':'')+'" data-other="1"><span class="cr-name">Другое (впишу вручную)</span></div>';
    return '<div class="fld"><label>'+label+'</label><div class="catlist" id="'+id+'">'+rows+other+'</div>'+
      '<div class="other-wrap" id="'+id+'-ow" style="'+(isOther?'':'display:none;')+'margin-top:8px"><input id="'+id+'-ot" placeholder="напр. вернули долг, продал станок" value="'+(isOther?esc(sel):'')+'"></div>'+
      '<button type="button" class="catadd" id="'+id+'-add">+ категория</button></div>'; }
  function wireCatField(id,ctx){ var box=$(id), ow=$(id+'-ow'), add=$(id+'-add');
    function rowsHtml(){ var list=ctxCats(ctx); return list.map(function(c,i){ return '<div class="catrow" data-i="'+i+'"><span class="cr-name">'+esc(c)+'</span><button type="button" class="cr-del" data-di="'+i+'" title="удалить">✕</button></div>'; }).join('')+'<div class="catrow other" data-other="1"><span class="cr-name">Другое (впишу вручную)</span></div>'; }
    function selectRow(row){ Array.prototype.forEach.call(box.querySelectorAll('.catrow'),function(x){x.classList.remove('on');}); row.classList.add('on'); ow.style.display=row.getAttribute('data-other')?'':'none'; }
    function bind(){
      Array.prototype.forEach.call(box.querySelectorAll('.catrow'),function(row){ row.onclick=function(e){ if(e.target&&e.target.classList.contains('cr-del'))return; selectRow(row); }; });
      Array.prototype.forEach.call(box.querySelectorAll('.cr-del'),function(b){ b.onclick=function(e){ e.stopPropagation(); var list=ctxCats(ctx),i=+b.getAttribute('data-di'); if(!confirm('Удалить категорию «'+list[i]+'»?'))return; list.splice(i,1); save(); rerender(); }; });
    }
    function rerender(){ box.innerHTML=rowsHtml(); bind(); var f=box.querySelector('.catrow'); if(f)selectRow(f); }
    bind();
    add.onclick=function(){ var v=(prompt('Новая категория:')||'').trim(); if(!v)return; var list=ctxCats(ctx); if(list.indexOf(v)<0){list.push(v);save();} rerender(); var idx=ctxCats(ctx).indexOf(v); var tgt=box.querySelector('.catrow[data-i="'+idx+'"]'); if(tgt)selectRow(tgt); };
    return function(){ var sel=box.querySelector('.catrow.on'); var list=ctxCats(ctx); if(!sel)return list[0]||'Другое'; if(sel.getAttribute('data-other')){ return ($(id+'-ot').value||'').trim()||'Другое'; } return list[+sel.getAttribute('data-i')]||'Другое'; }; }

  // чипсы способа оплаты с сохранением нового способа в DB.pays
  function wirePayChips(id){ var box=$(id); var onb=box.querySelector('.on'); var val=onb?onb.getAttribute('data-v'):(paysList()[0]||'');
    function pick(b){ Array.prototype.forEach.call(box.querySelectorAll('button'),function(x){x.className='';}); b.className='on'; val=b.getAttribute('data-v'); }
    Array.prototype.forEach.call(box.querySelectorAll('button'),function(b){ b.onclick=function(){ if(b.getAttribute('data-add')){ var v=(prompt('Новый способ оплаты (напр. Каспи межгород):')||'').trim(); if(!v)return; if(paysList().indexOf(v)<0){DB.pays.push(v);save();} var nb=document.createElement('button'); nb.setAttribute('data-v',v); nb.textContent=v; box.insertBefore(nb,b); nb.onclick=function(){pick(nb);}; pick(nb); return; } pick(b); }; });
    return function(){return val;}; }

  // список сотрудников (select)
  function empSelect(id){ return '<div class="fld"><label>Сотрудник</label><select id="'+id+'">'+DB.employees.map(function(e){return '<option>'+e+'</option>';}).join('')+'<option value="__add">+ добавить сотрудника…</option></select></div>'; }
  function wireEmpSelect(id){ var s=$(id); s.onchange=function(){ if(s.value==='__add'){ var v=prompt('Имя сотрудника:'); if(v){ DB.employees.push(v); save(); var o=document.createElement('option'); o.textContent=v; s.insertBefore(o,s.lastChild); s.value=v; } else s.selectedIndex=0; } }; return function(){return s.value;}; }

  // ---------- формы ----------
  // приход Руслана: выбор проекта → BORZO=продажа, иначе категория
  // блок «другой приход» (не продажа): сумма + категория + подпись
  function otherIncomeHtml(){ return amtField()+catField('Категория','in','f-cat')+'<div class="fld"><label>Подпись (от кого / за что)</label><input id="f-note" placeholder="напр. Коля за офис, долг, за распил"></div>'; }
  function formIn(){
    open('<h3>+ Приход</h3>'+squares('f-proj',PROJECTS)+'<div id="f-dyn"></div>'+acts('Провести приход'));
    var pr=wireSquares('f-proj',renderDyn), getCat, mode='sale';
    function renderDyn(p){ var box=$('f-dyn');
      if(p==='BORZO'){
        box.innerHTML='<div class="fld"><label>Тип прихода</label><div class="chips" id="in-mode"><button data-v="sale" class="on">Продажа</button><button data-v="other">Другой приход</button></div></div><div id="in-sub"></div>';
        var mg=wireChips('in-mode');
        function sub(){ mode=mg(); var s=$('in-sub'); if(mode==='sale'){ mountSale(s); } else { s.innerHTML=otherIncomeHtml(); getCat=wireCatField('f-cat','in'); } }
        Array.prototype.forEach.call($('in-mode').querySelectorAll('button'),function(b){var o=b.onclick;b.onclick=function(){o&&o();sub();};});
        sub();
      } else { mode='other'; box.innerHTML=otherIncomeHtml(); getCat=wireCatField('f-cat','in'); }
    }
    renderDyn(pr());
    wireActs(function(){ if(pr()==='BORZO'&&mode==='sale'){ submitSale('ruslan'); return; }
      var a=parseInt($('f-amt').value)||0; if(a<=0){alert('Укажите сумму');return;}
      commit([{kind:'in',acc:pr(),project:pr(),amount:a,category:getCat(),who:'ruslan',note:($('f-note')?$('f-note').value:'')}]); });
  }
  // приход Ульяны: продажа или другой приход
  function formUIn(){
    open('<h3>+ Приход</h3><div class="fld"><label>Тип прихода</label><div class="chips" id="in-mode"><button data-v="sale" class="on">Продажа</button><button data-v="other">Другой приход</button></div></div><div id="in-sub"></div>'+acts('Провести приход'));
    var mode='sale',getCat,mg=wireChips('in-mode');
    function sub(){ mode=mg(); var s=$('in-sub'); if(mode==='sale'){ mountSale(s); } else { s.innerHTML=otherIncomeHtml(); getCat=wireCatField('f-cat','in'); } }
    Array.prototype.forEach.call($('in-mode').querySelectorAll('button'),function(b){var o=b.onclick;b.onclick=function(){o&&o();sub();};});
    sub();
    wireActs(function(){ if(mode==='sale'){ submitSale('ulyana'); return; }
      var a=parseInt($('f-amt').value)||0; if(a<=0){alert('Укажите сумму');return;}
      commit([{kind:'in',acc:'BORZO',project:'BORZO',amount:a,category:getCat(),who:'ulyana',note:($('f-note')?$('f-note').value:'')}]); });
  }
  // пополнить личный счёт извне (приход)
  function formPersIncome(cfg){
    open('<h3>+ Пополнить лично</h3><div style="font-size:12px;color:var(--mut);margin-bottom:10px">Приход на личный счёт (вернули долг, подарок, иной источник) — чтобы касса билась.</div>'+amtField()+'<div class="fld"><label>Подпись (источник)</label><input id="f-note" placeholder="напр. вернули долг"></div>'+acts('Записать'));
    wireActs(function(){var a=getAmt();if(!a)return;commit([{kind:'in',acc:cfg.acc,project:cfg.project,amount:a,category:'Пополнение',who:cfg.who,note:$('f-note').value}]);});
  }

  // ---- мультипозиционная продажа ----
  var saleItems=[];
  function mountSale(box){
    saleItems=[];
    box.innerHTML=
      '<div class="fld"><label>Категория изделия</label>'+editChipsHtml('s-cat',catalog().categories,'категория')+'</div>'+
      '<div id="s-cons"></div>'+
      '<button class="btn" id="s-add" style="background:var(--blue);color:#fff;margin-bottom:12px">➕ Добавить в чек</button>'+
      '<div id="s-list"></div>'+
      '<div class="fld"><label>Оплата / способ продажи</label><div class="chips" id="s-pay">'+paysList().map(function(x,i){return '<button data-v="'+esc(x)+'"'+(i===0?' class="on"':'')+'>'+esc(x)+'</button>';}).join('')+'<button class="chip-add" data-add="1" title="Добавить способ">+</button></div></div>'+
      '<div style="display:flex;gap:8px"><div class="fld" style="flex:1"><label>Комиссия Kaspi, ₸</label><input type="number" id="s-comm" placeholder="0" inputmode="numeric"></div><div class="fld" style="flex:1"><label>Доставка, ₸</label><input type="number" id="s-deliv" placeholder="0" inputmode="numeric"></div></div>'+
      '<div style="font-size:11px;color:var(--mut);margin:-4px 0 8px">Лягут отдельными строками: приход на полную сумму + расход комиссии + расход доставки.</div>'+
      '<div class="fld"><label>Клиент (имя) — для поиска, необязательно</label><input id="s-client" placeholder="напр. Айгуль"></div>'+
      '<div class="fld"><label>Описание заказа — необязательно</label><input id="s-desc" placeholder="напр. под заказ, самовывоз"></div>'+
      '<label style="display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="s-b2b" style="width:20px;height:20px"><span style="font-size:13px">B2B / опт (оптовая продажа)</span></label>';
    var catGet=wireEditChips('s-cat',catalog().categories,'категория',function(){cons();}); window._salePay=wireEditChips('s-pay',paysList(),'способ'); window._saleDirty=false;
    $('s-cons').addEventListener('input',function(){window._saleDirty=true;});
    $('s-cons').addEventListener('click',function(e){ if(e.target&&e.target.tagName==='BUTTON')window._saleDirty=true; });
    function cons(){ var cat=catGet(); var cfg=catCfg(cat); var b=$('s-cons');
      b.innerHTML='<div class="fld"><label>Модель</label>'+editChipsHtml('c-model',cfg.models,'модель')+'</div>'+
        '<div class="fld"><label>Размер</label>'+editChipsHtml('c-size',cfg.sizes,'размер')+'</div>'+
        '<div class="fld"><label>Цвет</label>'+editChipsHtml('c-color',cfg.colors,'цвет')+'</div>'+
        '<div class="fld"><label>Уточнение к названию (необязательно)</label><input id="c-extra" placeholder="напр. 60см, с ящиком"></div>'+
        '<div style="display:flex;gap:8px"><div class="fld" style="flex:1"><label>Кол-во</label><input type="number" id="c-qty" value="1" inputmode="numeric"></div><div class="fld" style="flex:2"><label>Цена/шт, ₸ (авто)</label><input type="number" id="c-price" inputmode="numeric"></div></div>';
      var mg=wireEditChips('c-model',cfg.models,'модель',function(){pr();}),sg=wireEditChips('c-size',cfg.sizes,'размер',function(){pr();}),cg=wireEditChips('c-color',cfg.colors,'цвет');
      function pkey(){ return (mg()||'')+'|'+(sg()||''); }
      function pr(){ var v=cfg.price[pkey()]; if(v!=null)$('c-price').value=v; }
      pr();
      b._get=function(){ var parts=[cat]; if(mg())parts.push(mg()); if(sg())parts.push(sg()); if(cg())parts.push(cg()); var ex=($('c-extra')&&$('c-extra').value||'').trim(); if(ex)parts.push(ex);
        var price=parseInt($('c-price').value)||0; if(price>0){ cfg.price[pkey()]=price; save(); }
        return {name:parts.join(' '), qty:parseInt($('c-qty').value,10), price:price}; };
    }
    cons();
    $('s-add').onclick=function(){ var it=$('s-cons')._get(); if(it.price<=0){alert('Укажите цену');return;} if(!(it.qty>0)){alert('Количество должно быть целым числом больше нуля');return;} it.sum=it.qty*it.price; saleItems.push(it); window._saleDirty=false; renderSaleList(); };
    renderSaleList();
  }
  function renderSaleList(){ var el=$('s-list'); if(!el)return; var tot=saleItems.reduce(function(s,i){return s+i.sum;},0);
    el.innerHTML=(saleItems.length?saleItems.map(function(i,idx){return '<div class="op" style="padding:8px 0"><div style="flex:1"><div class="main-t" style="font-size:13px">'+i.name+'</div><div class="sub-t">'+i.qty+' × '+money(i.price)+'</div></div><div class="amt amt-in">'+money(i.sum)+'</div><button data-del="'+idx+'" style="margin-left:8px;background:var(--card2);border:1px solid var(--line);color:var(--mut);border-radius:8px;padding:6px 9px;cursor:pointer">✕</button></div>';}).join('')+'<div class="anrow" style="border:none;margin-top:4px"><span><b>Итого чек</b></span><b>'+money(tot)+'</b></div>':'<div class="empty" style="padding:12px 0">Добавьте позиции в чек</div>');
    Array.prototype.forEach.call(el.querySelectorAll('[data-del]'),function(b){b.onclick=function(){saleItems.splice(+b.getAttribute('data-del'),1);renderSaleList();};});
  }
  function submitSale(who){
    if(window._saleDirty && $('s-cons') && $('s-cons')._get){ var cur=$('s-cons')._get(); if(cur && cur.price>0 && cur.qty>0){ cur.sum=cur.qty*cur.price; saleItems.push(cur); window._saleDirty=false; renderSaleList(); } }
    if(!saleItems.length){alert('Добавьте хотя бы одну позицию');return;}
    var tot=saleItems.reduce(function(s,i){return s+i.sum;},0);
    var comm=parseInt($('s-comm').value)||0, deliv=parseInt($('s-deliv').value)||0;
    var qty=saleItems.reduce(function(s,i){return s+i.qty;},0);
    var cli=($('s-client')?$('s-client').value:'').trim(), sdesc=($('s-desc')?$('s-desc').value:'').trim(), b2b=$('s-b2b')&&$('s-b2b').checked;
    var sale={kind:'in',acc:'BORZO',project:'BORZO',amount:tot,category:b2b?'Продажа B2B':'Продажа',who:who,b2b:b2b,sale:{items:saleItems.slice(),qty:qty,pay:window._salePay?window._salePay():'Kaspi',client:cli,desc:sdesc,b2b:b2b},id:uid()};
    if(cli||sdesc) sale.note=(cli?('Клиент: '+cli):'')+(cli&&sdesc?' · ':'')+(sdesc||'');
    var ops=[sale];
    if(comm>0) ops.push({kind:'out',acc:'BORZO',project:'BORZO',amount:comm,category:'Комиссия Kaspi',who:who,relSale:sale.id,relKind:'comm',note:'комиссия по продаже'});
    if(deliv>0) ops.push({kind:'out',acc:'BORZO',project:'BORZO',amount:deliv,category:'Доставка Kaspi',who:who,relSale:sale.id,relKind:'deliv',note:'доставка по продаже'});
    commit(ops,null,'Провести продажу?');
  }

  function formExpense(cfg){ // cfg{who,projects,fixedProj?}
    var projPart = cfg.fixedProj ? '' : squares('f-proj',cfg.projects);
    open('<h3>− Расход</h3>'+projPart+amtField()+catField('Категория','work','f-cat')+monthSelect('f-mon',0)+'<div id="exp-oblig" style="font-size:12px;margin:-4px 0 10px"></div><div class="fld"><label>Описание (необязательно)</label><input id="f-note" placeholder="напр. МДФ 16мм, поставщик…"></div>'+acts('Провести расход'));
    var pr=cfg.fixedProj?function(){return cfg.fixedProj;}:wireSquares('f-proj'),ct=wireCatField('f-cat','work');
    function oblig(){ var el=$('exp-oblig'); if(!el)return; var cat=ct(), m=monthPer('f-mon');
      var paid=sumW(function(o){return o.kind==='out'&&o.category===cat&&samePerMonth(o.per||o.ts,m);});
      if(cat==='Аренда'){ if(!DB.norms)DB.norms={}; var norm=DB.norms['Аренда']||0;
        el.innerHTML='<span style="color:var(--mut)">За '+perName(m)+': оплачено <b>'+money(paid)+'</b>'+(norm?(' из <b>'+money(norm)+'</b> · осталось <b style="color:var(--amber)">'+money(Math.max(0,norm-paid))+'</b>'):'')+'</span> <a id="ob-set" style="color:var(--blue);cursor:pointer">'+(norm?'изменить сумму аренды':'задать сумму аренды')+'</a>';
        if($('ob-set'))$('ob-set').onclick=function(){ var v=parseInt(prompt('Аренда в месяц, ₸:',norm||'')||'')||0; if(!DB.norms)DB.norms={}; DB.norms['Аренда']=v; save(); oblig(); }; }
      else if(/коммун|комус/i.test(cat)){ el.innerHTML='<span style="color:var(--mut)">За '+perName(m)+' по «'+esc(cat)+'» уже оплачено: <b>'+money(paid)+'</b>. Впиши сколько платишь сейчас.</span>'; }
      else el.innerHTML=''; }
    if($('f-mon'))$('f-mon').addEventListener('change',oblig);
    if($('f-cat'))$('f-cat').addEventListener('click',function(){ setTimeout(oblig,0); });
    oblig();
    wireActs(function(){var a=getAmt();if(!a)return;commit([{kind:'out',acc:pr(),project:pr(),amount:a,category:ct(),note:$('f-note').value,who:cfg.who,per:monthPer('f-mon')}]);}); }

  function formSalary(cfg){ // cfg{who,projects,fixedProj?}
    var projPart = cfg.fixedProj ? '' : squares('f-proj',cfg.projects);
    open('<h3>💰 Начислить</h3>'+projPart+'<div id="f-empwrap"></div>'+
      '<div class="fld"><label>Тип</label><div class="chips" id="f-type"><button data-v="salary" class="on">Зарплата</button><button data-v="advance">Аванс (наперёд)</button></div></div>'+
      '<div id="f-monwrap">'+monthSelect('f-mon',0)+'</div>'+
      amtField()+acts('Начислить'));
    var tp=wireChips('f-type'), getEmp=function(){return '';};
    var getProj=cfg.fixedProj?function(){return cfg.fixedProj;}:wireSquares('f-proj',function(){renderEmp();});
    var defName={ruslan:'Руслан',ulyana:'Ульяна'}[cfg.who];
    function renderEmp(){ var p=getProj(); var list=empsForProject(p);
      $('f-empwrap').innerHTML='<div class="fld"><label>Сотрудник · проект '+p+'</label><select id="f-emp">'+(list.length?'':'<option value="">— нет в этом проекте —</option>')+list.map(function(e){return '<option>'+esc(e)+'</option>';}).join('')+'<option value="__add">+ добавить сотрудника…</option></select></div>';
      var s=$('f-emp'); if(defName&&list.indexOf(defName)>=0)s.value=defName;
      s.onchange=function(){ if(s.value==='__add'){ var v=(prompt('Имя сотрудника:')||'').trim(); if(v){ if(DB.employees.indexOf(v)<0)DB.employees.push(v); if(!DB.empMeta[v])DB.empMeta[v]={proj:(cfg.fixedProj||getProj()||'')}; save(); renderEmp(); $('f-emp').value=v; } else s.selectedIndex=0; } };
      getEmp=function(){return s.value;}; }
    renderEmp();
    // у аванса месяц не спрашиваем — он «висит в воздухе», в зарплату месяца попадёт при закрытии
    Array.prototype.forEach.call(document.querySelectorAll('#f-type button'),function(b){var o=b.onclick;b.onclick=function(){o&&o();$('f-monwrap').style.display=(tp()==='advance')?'none':'';};});
    wireActs(function(){var a=getAmt();if(!a)return;var emp=getEmp();if(!emp||emp==='__add'){alert('Выберите сотрудника');return;}var t=tp();var acct=EMP_ACCT[emp];var cat=t==='advance'?'Аванс':'Зарплата';
      var op={amount:a,category:cat,who:cfg.who,salary:{emp:emp,type:t}}; if(t!=='advance')op.per=monthPer('f-mon');
      if(acct){ op.kind='transfer'; op.from=getProj(); op.to=acct; op.project=getProj(); } else { op.kind='out'; op.acc=getProj(); op.project=getProj(); }
      commit([op]);}); }

  function formTransfer(){ var accs=PROJECTS.concat(['Зарплата Руслана']);
    open('<h3>⇄ Перевод</h3>'+chips('Откуда',accs,'f-from')+chips('Куда',accs,'f-to')+amtField()+acts('Перевести'));
    var fr=wireChips('f-from'),to=wireChips('f-to');
    wireActs(function(){var a=getAmt();if(!a)return;if(fr()===to()){alert('Разные счета');return;}commit([{kind:'transfer',from:mapAcc(fr()),to:mapAcc(to()),amount:a,project:fr(),who:'ruslan',note:fr()+'→'+to()}]);}); }
  function mapAcc(n){ return n==='Зарплата Руслана'?'zpRuslan':(n==='Кошелёк Ульяны'?'zpUlyana':n); }

  function formTopZp(){ open('<h3>↓ Пополнить мою зарплату</h3><div style="font-size:12px;color:var(--mut);margin-bottom:10px">Перевод из проекта в вашу зарплату.</div>'+squares('f-proj',PROJECTS)+amtField()+acts('Пополнить'));
    var pr=wireSquares('f-proj'); wireActs(function(){var a=getAmt();if(!a)return;commit([{kind:'transfer',from:pr(),to:'zpRuslan',amount:a,project:pr(),who:'ruslan',note:'в зарплату'}]);}); }

  function formPersR(){ open('<h3>− Личный расход</h3><div style="font-size:12px;color:var(--mut);margin-bottom:10px">Списывается с вашей зарплаты.</div>'+amtField()+catField('На что','pers_ruslan','f-cat')+acts('Записать'));
    var ct=wireCatField('f-cat','pers_ruslan'); wireActs(function(){var a=getAmt();if(!a)return;commit([{kind:'out',acc:'zpRuslan',project:'Личное',amount:a,category:ct(),who:'ruslan'}]);}); }

  function formUPers(){ open('<h3>− Мой расход</h3><div style="font-size:12px;color:var(--mut);margin-bottom:10px">Из вашего кошелька.</div>'+amtField()+catField('На что','pers_ulyana','f-cat')+acts('Записать'));
    var ct=wireCatField('f-cat','pers_ulyana'); wireActs(function(){var a=getAmt();if(!a)return;commit([{kind:'out',acc:'zpUlyana',project:'Личное Ульяны',amount:a,category:ct(),who:'ulyana'}]);}); }
  function formUFamily(){ open('<h3>− Семейный расход</h3><div style="font-size:12px;color:var(--mut);margin-bottom:10px">Берётся из BORZO, идёт как зарплата Руслана.</div>'+amtField()+catField('На что','family','f-cat')+acts('Записать'));
    var ct=wireCatField('f-cat','family'); wireActs(function(){var a=getAmt();if(!a)return;commit([{kind:'out',acc:'BORZO',project:'Зарплата Руслана',amount:a,category:ct(),who:'ulyana',family:true}]);}); }
  function formUZarplataToSelf(){ /* Ульяна начисляет зарплату себе как перевод в её кошелёк — через зарплату сотруднику «Ульяна» */ }

  function formCloseAdvance(emp,back){ var burn=advBurning(emp);
    open('<h3>Закрыть аванс — '+esc(emp)+'</h3><div style="font-size:13px;color:var(--mut);margin-bottom:10px">Горит аванс: <b style="color:var(--red)">'+money(burn)+'</b>. Впишите, сколько зачесть в зарплату (можно частично). Эта сумма упадёт в зарплату выбранного месяца.</div>'+
      monthSelect('f-mon',0)+
      '<div class="fld"><label>Сумма к закрытию, ₸</label><input type="number" inputmode="numeric" id="f-amt" value="'+burn+'"></div>'+acts('Закрыть'));
    wireActs(function(){var a=parseInt($('f-amt').value)||0;if(a<=0){alert('Укажите сумму');return;}if(a>burn){alert('Больше горящего аванса нельзя');return;}commit([{kind:'close',emp:emp,amount:a,who:role(),per:monthPer('f-mon'),note:'закрытие аванса'}],function(){render();if(back)back();else close();});}); }

  // ---------- кредиты (остатки + платёж/мес + шкала + дата погашения) ----------
  function creditsList(){ return DB.ops.filter(function(o){return o.credit;}); }
  function creditPaid(id){ return sumW(function(o){return o.creditId===id && o.kind==='out';}); }
  function creditTotal(o){ return (o.credit && o.credit.total!=null) ? o.credit.total : o.amount; }   // total может быть 0 (закрыт досрочно без остатка) — раньше 0 ошибочно воспринимался как «нет значения» (аудит #24)
  function creditLeft(o){ return Math.max(0, creditTotal(o) - creditPaid(o.id)); }
  function daysTo(ts){ if(!ts)return null; return Math.ceil((ts-Date.now())/86400000); }
  function addMonthTs(ts){ var d=new Date(ts); d.setMonth(d.getMonth()+1); return d.getTime(); }
  function dstr(ts){ var d=new Date(ts||Date.now()); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function dparse(v){ if(!v)return 0; var p=v.split('-'); return new Date(+p[0],+p[1]-1,+p[2],12,0,0).getTime(); }
  function formCredits(cfg){
    var list=creditsList().slice().sort(function(a,b){ var la=creditLeft(a)<=0?1:0, lb=creditLeft(b)<=0?1:0; if(la!==lb)return la-lb; return (a.credit.nextDate||9e15)-(b.credit.nextDate||9e15); });
    var totalLeft=list.reduce(function(s,o){return s+creditLeft(o);},0);
    var rows = list.length? list.map(function(o){
      var total=creditTotal(o), paid=creditPaid(o.id), left=creditLeft(o), monthly=o.credit.monthly||0, pct=total?Math.min(100,Math.round(paid/total*100)):0, closed=left<=0;
      var over=(o.credit.principal&&total>o.credit.principal)?(total-o.credit.principal):0;
      var nd=o.credit.nextDate, dd=daysTo(nd);
      var dateLine= closed?'<span class="pill" style="background:rgba(40,192,122,.15);color:var(--green)">закрыт</span>':(nd?('<span style="color:'+((dd!=null&&dd<=3)?'var(--red)':'var(--mut)')+';font-size:12px">📅 '+fdate2(nd)+(dd!=null?(dd<0?(' · просрочен '+(-dd)+' дн'):(dd===0?' · сегодня':' · через '+dd+' дн')):'')+'</span>'):'<span style="color:var(--mut);font-size:12px">📅 дата не задана</span>');
      return '<div class="card" data-cr="'+o.id+'" style="margin-bottom:10px;padding:11px 14px;cursor:pointer">'+
        '<div class="anrow" style="border:none;padding:0 0 6px"><span style="font-weight:700">'+esc(o.credit.name)+'</span>'+dateLine+'</div>'+
        '<div style="height:8px;border-radius:4px;background:var(--bg);overflow:hidden;margin-bottom:6px"><div style="height:100%;width:'+pct+'%;background:'+(closed?'var(--green)':'var(--blue)')+'"></div></div>'+
        '<div class="anrow" style="border:none;padding:2px 0;font-size:13px"><span class="muted">Осталось выплатить</span><b'+(closed?'':' style="color:var(--red)"')+'>'+money(left)+'</b></div>'+
        '<div class="anrow" style="border:none;padding:2px 0;font-size:12px;color:var(--mut)"><span>погашено '+money(paid)+' из '+money(total)+' ('+pct+'%)</span>'+(monthly?'<span>платёж '+money(monthly)+'/мес</span>':'')+'</div>'+
        (over>0?'<div class="anrow" style="border:none;padding:2px 0;font-size:12px"><span class="muted">переплата (проценты)</span><span style="color:var(--amber)">'+money(over)+'</span></div>':'')+
        (closed?'':'<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-pay="'+o.id+'" style="background:var(--green);color:#04140b;flex:1.4;padding:11px">Погасить</button><button class="btn btn-ghost" data-early="'+o.id+'" style="flex:1;padding:11px;font-size:13px">🏁 Досрочно</button></div>')+
      '</div>';
    }).join('') : '<div class="empty">Кредитов пока нет.</div>';
    open('<h3>🏦 Кредиты</h3>'+(list.length?'<div class="hero" style="margin-bottom:12px"><div class="l">Всего осталось выплатить</div><div class="v">'+money(totalLeft)+'</div></div>':'<div style="font-size:12px;color:var(--mut);margin-bottom:10px">Заведи текущие кредиты с их ОСТАТКОМ долга. Дальше гасишь — видно шкалу и дату след. платежа.</div>')+rows+'<button class="btn" id="cr-take" style="background:var(--green);color:#04140b;margin-top:6px">+ Добавить кредит</button><button class="btn btn-ghost" id="f-cancel" style="margin-top:8px">Закрыть</button>');
    $('f-cancel').onclick=close;
    $('cr-take').onclick=function(){formTakeCredit(cfg);};
    Array.prototype.forEach.call(document.querySelectorAll('[data-pay]'),function(b){b.onclick=function(e){e.stopPropagation();formPayCredit(DB.ops.filter(function(x){return x.id===b.getAttribute('data-pay');})[0],cfg);};});
    Array.prototype.forEach.call(document.querySelectorAll('[data-early]'),function(b){b.onclick=function(e){e.stopPropagation();formEarlyPay(DB.ops.filter(function(x){return x.id===b.getAttribute('data-early');})[0],cfg);};});
    Array.prototype.forEach.call(document.querySelectorAll('[data-cr]'),function(b){b.onclick=function(){showOp(b.getAttribute('data-cr'));};});
  }
  function formTakeCredit(cfg){
    var projPart=cfg.fixedProj?'':squares('f-proj',cfg.projects);
    open('<h3>+ Добавить кредит</h3>'+
      '<div class="fld"><label>Название (банк / кому должен)</label><input id="cr-name" placeholder="напр. Kaspi Бизнес, Халык, Марат"></div>'+
      projPart+
      '<label style="display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:12px;margin-bottom:12px;cursor:pointer"><input type="checkbox" id="cr-open" checked style="width:20px;height:20px"><span style="font-size:13px">Существующий кредит — заношу остаток (деньги в кассу НЕ добавлять)</span></label>'+
      '<div id="cr-new" style="display:none">'+
        '<div class="fld"><label>Сумма кредита — упадёт в кассу, ₸</label><input type="number" inputmode="numeric" id="cr-principal" placeholder="напр. 500000"></div>'+
        '<div class="fld"><label>Срок, месяцев</label><input type="number" inputmode="numeric" id="cr-term" placeholder="напр. 12"></div>'+
      '</div>'+
      '<div id="cr-exist"><div class="fld"><label>Остаток к выплате сейчас (всего осталось платить), ₸</label><input type="number" inputmode="numeric" id="cr-remain" placeholder="0"></div></div>'+
      '<div class="fld"><label>Платёж в месяц, ₸</label><input type="number" inputmode="numeric" id="cr-monthly" placeholder="напр. 60000"></div>'+
      '<div class="fld"><label>Дата ближайшего погашения (1-й платёж обычно через месяц)</label><input type="date" id="cr-date" value="'+dstr(addMonthTs(Date.now()))+'"></div>'+
      '<div id="cr-calc" style="font-size:13px;margin-bottom:10px"></div>'+
      acts('Сохранить кредит'));
    var pr=cfg.fixedProj?function(){return cfg.fixedProj;}:wireSquares('f-proj');
    function recalc(){ var open=$('cr-open').checked; $('cr-new').style.display=open?'none':''; $('cr-exist').style.display=open?'':'none';
      var c=$('cr-calc');
      if(!open){ var pcp=parseInt($('cr-principal').value)||0, term=parseInt($('cr-term').value)||0, mon=parseInt($('cr-monthly').value)||0;
        if(mon&&term){ var tot=mon*term, ov=tot-pcp; c.innerHTML='Вернёшь всего: <b>'+money(tot)+'</b> за '+term+' мес · переплата <b style="color:var(--amber)">'+money(ov)+'</b>'; }
        else c.innerHTML='<span style="color:var(--mut)">Впиши срок и платёж — посчитаю переплату.</span>'; }
      else c.innerHTML=''; }
    $('cr-open').onchange=recalc; $('cr-principal').oninput=recalc; $('cr-term').oninput=recalc; $('cr-monthly').oninput=recalc;
    recalc();
    wireActs(function(){ var nm=($('cr-name').value||'').trim()||'Кредит', monthly=parseInt($('cr-monthly').value)||0, nd=dparse($('cr-date').value), opening=$('cr-open').checked;
      var op;
      if(opening){ var remain=parseInt($('cr-remain').value)||0; if(remain<=0){alert('Укажите остаток к выплате');return;}
        op={kind:'credit',acc:pr(),project:pr(),amount:remain,category:'Кредит',who:cfg.who,credit:{name:nm,total:remain,monthly:monthly,nextDate:nd,opening:true}}; }
      else { var pcp=parseInt($('cr-principal').value)||0, term=parseInt($('cr-term').value)||0; if(pcp<=0){alert('Укажите сумму кредита');return;}
        var total=(monthly&&term)?monthly*term:pcp;
        op={kind:'in',acc:pr(),project:pr(),amount:pcp,category:'Кредит',who:cfg.who,credit:{name:nm,principal:pcp,term:term,total:total,monthly:monthly,nextDate:nd,opening:false}}; }
      commit([op],function(){ close(); render(); formCredits(cfg); },'Сохранить кредит?'); });
  }
  function formPayCredit(o,cfg){ if(!o)return; var left=creditLeft(o),monthly=o.credit.monthly||0,def=Math.min(monthly||left,left);
    open('<h3>Погасить — '+esc(o.credit.name)+'</h3>'+
      '<div style="font-size:13px;color:var(--mut);margin-bottom:10px">Осталось <b style="color:var(--red)">'+money(left)+'</b>. Спишется с проекта '+esc(o.project)+'. Сумму можно поменять (больше/меньше).</div>'+
      '<div class="fld"><label>Сумма платежа, ₸</label><input type="number" inputmode="numeric" id="f-amt" value="'+(def||'')+'"></div>'+
      '<div class="fld"><label>Дата следующего погашения</label><input type="date" id="cr-date" value="'+dstr(o.credit.nextDate?addMonthTs(o.credit.nextDate):addMonthTs(Date.now()))+'"></div>'+
      acts('Погасить'));
    wireActs(function(){ var a=parseInt($('f-amt').value)||0; if(a<=0){alert('Укажите сумму');return;}
      commit([{kind:'out',acc:o.project,project:o.project,amount:a,category:'Погашение кредита',who:role(),creditId:o.id,note:'кредит: '+o.credit.name}],function(){
        o.credit.nextDate=dparse($('cr-date').value); if(creditLeft(o)<=0)o.credit.nextDate=0; save(); close(); render(); formCredits(cfg); },'Погасить кредит?'); }); }
  function formEarlyPay(o,cfg){ if(!o)return; var left=creditLeft(o);
    open('<h3>🏁 Досрочное погашение — '+esc(o.credit.name)+'</h3>'+
      '<div style="font-size:13px;color:var(--mut);margin-bottom:10px">По системе осталось <b>'+money(left)+'</b>, но банк пересчитывает проценты по-своему. Впиши <b>реальную</b> сумму для закрытия — она спишется с кассы, и кредит закроется.</div>'+
      '<div class="fld"><label>Сумма закрытия, ₸</label><input type="number" inputmode="numeric" id="f-amt" value="'+(left||'')+'"></div>'+acts('Закрыть кредит'));
    wireActs(function(){ var a=parseInt($('f-amt').value)||0; if(a<0){alert('Некорректно');return;}
      var fin=function(){ o.credit.total=creditPaid(o.id); o.credit.nextDate=0; save(); close(); render(); formCredits(cfg); };
      if(a>0) commit([{kind:'out',acc:o.project,project:o.project,amount:a,category:'Погашение кредита',who:role(),creditId:o.id,note:'досрочное закрытие: '+o.credit.name}],fin,'Закрыть кредит досрочно?');
      else fin(); }); }

  // ---------- аналитика (контекстная: набор вкладок под кабинет + период месяц/год/всё) ----------
  var anTabs=['proj'], anTab='proj', anScope='month', anOff=0, anProj=null, anSalOpen={}, anInner='in', anProjs=null, anInProd=false;
  var AN_TITLE={sales:'Продажи',proj:'Проекты',salary:'Зарплаты',wallet:'Личное',upers:'Мои траты',ufam:'Семейное'};
  // личные/семейные траты с зарплаты — это часть зарплаты, в разбивке расходов сворачиваем в «Зарплата» (детализация — в разделе 💰 Зарплаты)
  function catNorm(c){
    if(c==='Личное/семья'||c==='Личное'||c==='Семейное'||c==='Семья'||c==='ЗП Ульяна'||c==='ЗП прочее') return 'Зарплата';
    if(c==='Общие'||c==='Операционка цеха'||c==='Операционные'||c==='Операционка') return 'Операционка';   // общие расходы цеха — одной строкой
    return c||'—';
  }
  function catBars(ops){ var by={},tot=0; ops.forEach(function(o){var k=catNorm(o.category||o.project);by[k]=(by[k]||0)+o.amount;tot+=o.amount;});
    var ks=Object.keys(by).sort(function(a,b){return by[b]-by[a];}); var mx=ks.length?by[ks[0]]:1;
    return (ks.length?ks.map(function(k){return '<div class="anrow"><span>'+esc(k)+'</span><b>'+money(by[k])+'</b></div><div class="bar" style="width:'+Math.max(4,by[k]/mx*100)+'%"></div>';}).join(''):'<div class="empty">Нет операций</div>')+(tot?'<div class="anrow" style="border:none;margin-top:6px"><span><b>Итого</b></span><b>'+money(tot)+'</b></div>':''); }
  function sumOps(ops){ return ops.reduce(function(s,o){return s+o.amount;},0); }
  // расход проекта (для аналитики проектов): расходы + зарплаты сотрудникам, но НЕ переводы/личное/семейное/кредит-приход/погашение кредита
  // Кредит — это долг, а не операционный расход: приход (kind='credit'/'in') и погашение тела в прибыль/убыток не входят. Реальная цена кредита = только проценты.
  function isCreditFlow(o){ return o.category==='Погашение кредита' || o.category==='Кредит' || !!o.creditId; }
  function isProjExp(o){ return PROJECTS.indexOf(o.project)>=0 && !isCreditFlow(o) && (o.kind==='out' || (o.salary&&o.kind==='transfer')); }
  function rangeFor(scope,off){ var d=new Date();
    if(scope==='year'){ var y=d.getFullYear()+off; return {s:new Date(y,0,1).getTime(),e:new Date(y+1,0,1).getTime(),name:'Год '+y}; }
    if(scope==='all'){ return {s:0,e:8640000000000000,name:'Всё время'}; }
    return monthRange(off); }

  function openAnalytics(tabs,start,projs){ anTabs=(tabs&&tabs.length)?tabs:['proj']; anTab=start||anTabs[0]; anScope='month'; anOff=0; anProj=null; anSalOpen={}; anInner='in'; anProjs=projs||PROJECTS; anInProd=false; renderAn(); }
  function renderAn(){
    var r=rangeFor(anScope,anOff);
    var scopeBtns='<div class="antabs" style="margin-bottom:10px"><button data-sc="month"'+(anScope==='month'?' class="on"':'')+'>Месяц</button><button data-sc="year"'+(anScope==='year'?' class="on"':'')+'>Год</button><button data-sc="all"'+(anScope==='all'?' class="on"':'')+'>Всё время</button></div>';
    var nav=anScope==='all'?'<div class="mnav"><span class="m">'+r.name+'</span></div>':'<div class="mnav"><button id="an-prev">‹</button><span class="m">'+r.name+'</span><button id="an-next">›</button></div>';
    var tabsBar=anTabs.length>1?'<div class="antabs">'+anTabs.map(function(t){return '<button data-t="'+t+'"'+(t===anTab?' class="on"':'')+'>'+(AN_TITLE[t]||t)+'</button>';}).join('')+'</div>':'';
    open('<h3>📊 Аналитика</h3>'+scopeBtns+nav+tabsBar+'<div id="an-body"></div><button class="btn btn-ghost" id="f-cancel" style="margin-top:14px">Закрыть</button>');
    $('f-cancel').onclick=close;
    if($('an-prev'))$('an-prev').onclick=function(){anOff--;renderAn();};
    if($('an-next'))$('an-next').onclick=function(){if(anOff<0)anOff++;renderAn();};
    Array.prototype.forEach.call(document.querySelectorAll('[data-sc]'),function(b){b.onclick=function(){anScope=b.getAttribute('data-sc');anOff=0;renderAn();};});
    Array.prototype.forEach.call(document.querySelectorAll('.antabs [data-t]'),function(b){b.onclick=function(){anTab=b.getAttribute('data-t');renderAn();};});
    var bd=$('an-body');
    if(anTab==='byproject'){
      var plist=anProjs||PROJECTS;
      if(plist.indexOf(anProj)<0) anProj=plist[0];
      var chipsH=plist.length>1?('<div class="chips" style="margin-bottom:12px">'+plist.map(function(p){return '<button data-bp="'+p+'"'+(p===anProj?' class="on"':'')+'>'+p+'</button>';}).join('')+'</div>'):'';
      // доход = операционный приход БЕЗ кредитных поступлений (кредит — это долг, не доход, аудит #22), МИНУС возвраты покупателям (аудит #21)
      var grossIn=sumOps(DB.ops.filter(function(o){return o.kind==='in'&&!isCreditFlow(o)&&o.project===anProj&&inRangeS(o,r);}));
      var retSum=sumOps(DB.ops.filter(function(o){return o.kind==='return'&&o.project===anProj&&inRangeS(o,r);}));
      var sIn=grossIn-retSum;
      var sOut=sumOps(DB.ops.filter(function(o){return inRangeS(o,r)&&isProjExp(o)&&o.project===anProj;}));
      var sRes=sIn-sOut;
      var summaryH='<div class="split" style="margin-bottom:'+(retSum?'4px':'12px')+'"><div class="s"><div class="l">Доход</div><div class="v" style="color:var(--blue);font-size:14px">'+money(sIn)+'</div></div><div class="s"><div class="l">Расход</div><div class="v" style="color:var(--red);font-size:14px">'+money(sOut)+'</div></div><div class="s"><div class="l">Результат</div><div class="v" style="color:'+(sRes>=0?'var(--green)':'var(--red)')+';font-size:14px">'+(sRes>=0?'+':'')+money(sRes)+'</div></div></div>'+
        (retSum?'<div style="font-size:11px;color:var(--mut);margin-bottom:12px;text-align:center">доход уже за вычетом возвратов '+money(retSum)+'; кредитные поступления в доход не входят</div>':'');
      var innerH='<div class="antabs">'+[['in','Приход'],['out','Расход'],['sal','Зарплаты']].map(function(t){return '<button data-in="'+t[0]+'"'+(anInner===t[0]?' class="on"':'')+'>'+t[1]+'</button>';}).join('')+'</div>';
      var body='';
      if(anInner==='in'){
        var ins=DB.ops.filter(function(o){return o.kind==='in'&&!isCreditFlow(o)&&o.project===anProj&&inRangeS(o,r);});   // приход без кредитных поступлений (аудит #22)
        var prod={},pq=0;
        ins.forEach(function(o){ if(o.sale&&o.sale.items){ o.sale.items.forEach(function(i){ if(i.returned)return; if(!prod[i.name])prod[i.name]={q:0,s:0}; prod[i.name].q+=parseInt(i.qty)||1; prod[i.name].s+=i.sum||0; pq+=parseInt(i.qty)||1; }); } });
        var pk=Object.keys(prod).sort(function(a,b){return prod[b].s-prod[a].s;});
        body='<div class="hero" style="margin-bottom:12px"><div class="l">Приход · '+anProj+'</div><div class="v">'+money(sumOps(ins))+'</div>'+(pq?'<div class="sub">продано изделий: '+pq+' шт</div>':'')+'</div>'+
          '<div style="font-weight:700;margin-bottom:4px">По категориям прихода</div>'+catBars(ins)+
          (pk.length?'<button class="an-btn" id="in-prod-btn" style="margin-top:12px">📦 Детализация по изделиям'+(pq?' · '+pq+' шт':'')+(anInProd?' ▲':' ▼')+'</button><div id="in-prod" style="display:'+(anInProd?'':'none')+'">'+pk.map(function(k){return '<div class="anrow"><span>'+esc(k)+' <span class="muted">× '+prod[k].q+'</span></span><b>'+money(prod[k].s)+'</b></div>';}).join('')+'</div>':'');
      } else if(anInner==='out'){
        var outs=DB.ops.filter(function(o){return inRangeS(o,r)&&isProjExp(o)&&o.project===anProj;});
        body='<div class="hero" style="margin-bottom:12px"><div class="l">Расход · '+anProj+' (вкл. зарплаты)</div><div class="v">'+money(sumOps(outs))+'</div></div>'+catBars(outs);
      } else {
        var semp={},stot=0;
        DB.ops.forEach(function(o){ if(o.salary&&o.salary.type==='salary'&&o.project===anProj&&inRangeS(o,r)){ semp[o.salary.emp]=(semp[o.salary.emp]||0)+o.amount; stot+=o.amount; } });
        var sk=Object.keys(semp).sort(function(a,b){return semp[b]-semp[a];});
        body='<div class="hero" style="margin-bottom:12px"><div class="l">Зарплаты · '+anProj+'</div><div class="v">'+money(stot)+'</div></div>'+
          (sk.length?sk.map(function(e){return '<div class="anrow"><span>'+esc(e)+'</span><b>'+money(semp[e])+'</b></div>';}).join(''):'<div class="empty">Зарплат за период нет</div>')+
          '<div style="font-size:11px;color:var(--mut);margin-top:10px">Детально по авансам и месяцам — в разделе 💰 Зарплаты.</div>';
      }
      bd.innerHTML=chipsH+summaryH+innerH+body;
      Array.prototype.forEach.call(bd.querySelectorAll('[data-bp]'),function(b2){b2.onclick=function(){anProj=b2.getAttribute('data-bp');renderAn();};});
      Array.prototype.forEach.call(bd.querySelectorAll('[data-in]'),function(b2){b2.onclick=function(){anInner=b2.getAttribute('data-in');renderAn();};});
      if($('in-prod-btn'))$('in-prod-btn').onclick=function(){anInProd=!anInProd;renderAn();};
    } else if(anTab==='sales'){
      var sales=DB.ops.filter(function(o){return o.kind==='in'&&o.sale&&!o.returned&&inRangeS(o,r);});
      var rets=DB.ops.filter(function(o){return o.kind==='return'&&inRangeS(o,r);});
      var byProd={},qtyTot=0,sumTot=0;
      sales.forEach(function(o){ var items=o.sale.items||[{name:o.sale.product,qty:o.sale.qty||1,sum:o.amount}];
        items.forEach(function(i){ if(i.returned)return; var k=i.name; if(!byProd[k])byProd[k]={q:0,s:0}; var q=parseInt(i.qty)||1, sm=i.sum||o.amount; byProd[k].q+=q; byProd[k].s+=sm; qtyTot+=q; sumTot+=sm; }); });
      var retSum=rets.reduce(function(s,o){return s+o.amount;},0);
      var ks=Object.keys(byProd).sort(function(a,b){return byProd[b].s-byProd[a].s;});
      bd.innerHTML='<div class="hero" style="margin-bottom:12px"><div class="l">Продано за месяц (чистыми)</div><div class="v">'+qtyTot+' шт</div><div class="sub">на сумму <b style="color:var(--ink)">'+money(sumTot)+'</b>'+(rets.length?' · возвратов: '+rets.length+' на '+money(retSum):'')+'</div></div>'+
        '<div style="font-size:12px;color:var(--mut);margin-bottom:8px">По изделиям (возвраты уже вычтены):</div>'+
        (ks.length?ks.map(function(k){return '<div class="anrow"><span>'+k+' <span class="muted">× '+byProd[k].q+'</span></span><b>'+money(byProd[k].s)+'</b></div>';}).join(''):'<div class="empty">Продаж за месяц нет</div>');
    } else if(anTab==='proj'){
      // общая по проектам + провал
      var byProj={}; DB.ops.forEach(function(o){ if(inRangeS(o,r)&&isProjExp(o)) byProj[o.project]=(byProj[o.project]||0)+o.amount; });
      bd.innerHTML='<div style="font-size:12px;color:var(--mut);margin-bottom:8px">Расходы по проектам за период (вкл. зарплаты). Нажмите проект — детали.</div>'+
        PROJECTS.map(function(p){return '<div class="anrow'+(p===anProj?' on':'')+'" data-proj="'+p+'" style="cursor:pointer"><span>'+p+' ›</span><b>'+money(byProj[p]||0)+'</b></div>';}).join('')+'<div id="proj-detail" style="margin-top:10px"></div>';
      function projDetail(p){ anProj=p; Array.prototype.forEach.call(bd.querySelectorAll('[data-proj]'),function(x){x.className='anrow'+(x.getAttribute('data-proj')===p?' on':'');}); $('proj-detail').innerHTML='<div style="font-weight:700;margin:8px 0">'+p+' — по категориям</div>'+catBars(DB.ops.filter(function(o){return inRangeS(o,r)&&isProjExp(o)&&o.project===p;})); }
      Array.prototype.forEach.call(bd.querySelectorAll('[data-proj]'),function(el){el.onclick=function(){projDetail(el.getAttribute('data-proj'));};});
      if(anProj) projDetail(anProj);
    } else if(anTab==='salary'){
      var emps=empsWith(r);
      function monthsHtml(e){ var h=''; for(var k=0;k>-12;k--){ var rr=monthRange(k),s=salaryOf(e,rr),a=advOf(e,rr); if(s||a) h+='<div class="anrow" style="font-size:13px"><span>'+rr.name+'</span><b>'+money(s)+(a?' <span class="muted">(аванс '+money(a)+')</span>':'')+'</b></div>'; } return h||'<div class="empty" style="padding:8px 0">Начислений нет</div>'; }
      var rows=emps.map(function(e,i){ var sal=salaryOf(e,r),adv=advOf(e,r),burn=advBurning(e),op=anSalOpen[e];
        return '<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="anrow" data-x="'+i+'" style="border:none;padding:2px 0;cursor:pointer"><span style="font-weight:700">'+esc(e)+' ›</span><b>'+money(sal)+'</b></div>'+
          (adv?'<div class="anrow" style="border:none;padding:2px 0;font-size:13px"><span class="advrow">аванс за период</span><span class="advrow">'+money(adv)+'</span></div>':'')+
          (burn>0?'<div class="anrow" style="border:none;padding:2px 0;font-size:13px"><span class="advrow">🔴 горит аванс: '+money(burn)+'</span><span class="advrow" style="font-size:12px">закрыть — в разделе «Зарплаты»</span></div>':'')+
          '<div class="emp-months" id="em-'+i+'" style="'+(op?'':'display:none;')+'margin-top:4px;padding-left:6px;border-left:2px solid var(--line)">'+(op?monthsHtml(e):'')+'</div></div>';
      }).join('');
      bd.innerHTML='<div style="font-size:12px;color:var(--mut);margin-bottom:8px">Зарплата за период (вкл. закрытые авансы). Нажми на сотрудника — история по месяцам.</div>'+rows;
      Array.prototype.forEach.call(bd.querySelectorAll('[data-x]'),function(el){el.onclick=function(){ var i=+el.getAttribute('data-x'),e=emps[i],box=$('em-'+i);
        if(box.style.display==='none'){ box.innerHTML=monthsHtml(e); box.style.display=''; anSalOpen[e]=1; } else { box.style.display='none'; delete anSalOpen[e]; } };});
    } else if(anTab==='wallet'){ // Руслан личное: Я / Ульяна / Вместе
      var mine=DB.ops.filter(function(o){return o.kind==='out'&&o.acc==='zpRuslan'&&inRangeS(o,r);});
      var ulya=DB.ops.filter(function(o){return o.family&&inRangeS(o,r);});
      var sM=sumOps(mine),sU=sumOps(ulya);
      bd.innerHTML='<div class="split"><div class="s"><div class="l">Потратил я</div><div class="v">'+money(sM)+'</div></div><div class="s"><div class="l">Потратила Ульяна</div><div class="v">'+money(sU)+'</div></div></div>'+
        '<div class="hero" style="margin-bottom:12px"><div class="l">Вместе — семейный бюджет</div><div class="v">'+money(sM+sU)+'</div></div>'+
        '<div style="font-weight:700;margin-bottom:4px">Мои категории</div>'+catBars(mine)+
        '<div style="font-weight:700;margin:14px 0 4px">Категории Ульяны (с моего кошелька)</div>'+catBars(ulya);
    } else if(anTab==='upers'){ // Ульяна — её личные траты
      var um=DB.ops.filter(function(o){return o.kind==='out'&&o.acc==='zpUlyana'&&inRangeS(o,r);});
      bd.innerHTML='<div class="hero" style="margin-bottom:12px"><div class="l">Мои личные траты</div><div class="v">'+money(sumOps(um))+'</div></div>'+catBars(um);
    } else if(anTab==='ufam'){ // Ульяна — траты с кошелька Руслана (семейное)
      var uf=DB.ops.filter(function(o){return o.family&&inRangeS(o,r);});
      bd.innerHTML='<div class="hero" style="margin-bottom:12px"><div class="l">Потратила с кошелька Руслана</div><div class="v">'+money(sumOps(uf))+'</div></div>'+catBars(uf);
    }
  }

  // ---------- согласование правок ----------
  function perName(per){ if(!per)return '—'; var d=new Date(per); return MON[d.getMonth()]+' '+d.getFullYear(); }
  function samePerMonth(a,b){ if(!a||!b)return false; var da=new Date(a),db=new Date(b); return da.getFullYear()===db.getFullYear()&&da.getMonth()===db.getMonth(); }
  function perToOff(per){ if(!per)return 0; var n=new Date(),p=new Date(per); return (p.getFullYear()-n.getFullYear())*12+(p.getMonth()-n.getMonth()); }
  function fmtItems(items){ if(!items||!items.length)return '—'; return items.map(function(i){return i.name+' ×'+i.qty+' ('+money(i.sum||i.price*i.qty)+')';}).join(' · '); }
  function genericDiff(o,next){ var d=[];
    if('amount' in next && Math.round(+next.amount)!==Math.round(+o.amount)) d.push({label:'Сумма',from:money(o.amount),to:money(next.amount)});
    if('category' in next && next.category!==o.category) d.push({label:'Категория',from:o.category||'—',to:next.category});
    if('per' in next && (next.per||0)!==(o.per||0)) d.push({label:'Месяц',from:perName(o.per),to:perName(next.per)});
    // состав продажи: показываем позиции было→стало, чтобы Руслан видел, что именно меняет Ульяна
    if('sale' in next && next.sale){ var was=fmtItems(o.sale&&o.sale.items), now=fmtItems(next.sale.items); if(was!==now) d.push({label:'Состав',from:was,to:now}); }
    return d; }
  function deleteOp(id){
    var target=DB.ops.filter(function(x){return x.id===id;})[0];
    // удаляем ВОЗВРАТ → вернуть проданные позиции в «не возвращено» и восстановить комиссию/доставку (аудит #20)
    if(target && target.kind==='return' && target.relSale){
      var sale=DB.ops.filter(function(x){return x.id===target.relSale;})[0];
      if(sale && sale.sale){
        var its=sale.sale.items||[];
        if(Array.isArray(target.retIdx)) target.retIdx.forEach(function(i){ if(its[i])its[i].returned=false; });
        else its.forEach(function(it){ it.returned=false; });   // старые возвраты без индексов — снять со всех позиций
        sale.returned=false; touch(sale);
        if(target.retComm){ var cm=DB.ops.filter(function(x){return x.relSale===sale.id&&x.relKind==='comm';})[0]; if(cm){cm.amount+=target.retComm; touch(cm);} }
        if(target.retDeliv){ var dl=DB.ops.filter(function(x){return x.relSale===sale.id&&x.relKind==='deliv';})[0]; if(dl){dl.amount+=target.retDeliv; touch(dl);} }
      }
    }
    var ids={}; ids[id]=1; DB.ops.forEach(function(o){ if(o.relSale===id||o.creditId===id)ids[o.id]=1; });
    DB.deleted=DB.deleted||{}; for(var tk in ids) DB.deleted[tk]=Date.now();   // надгробия: удаление переживёт слияние
    // удаляем АВАНС → закрытия этого сотрудника могут повиснуть; срезаем лишние закрытия, чтобы не осталась ложная зарплата (аудит #29)
    if(target && target.salary && target.salary.type==='advance' && target.salary.emp){
      var emp=target.salary.emp, advSum=0, closes=[];
      DB.ops.forEach(function(o){ if(ids[o.id])return;
        if(o.salary&&o.salary.type==='advance'&&o.salary.emp===emp) advSum+=o.amount;
        else if(o.kind==='close'&&o.emp===emp) closes.push(o); });
      var excess=closes.reduce(function(s,o){return s+o.amount;},0)-advSum;   // закрыто больше, чем осталось авансов
      closes.sort(function(a,b){return (b.ts||0)-(a.ts||0);});               // срезаем с самых свежих
      for(var ci=0; ci<closes.length && excess>0; ci++){ var cl=closes[ci];
        if(cl.amount<=excess){ excess-=cl.amount; ids[cl.id]=1; }            // закрытие целиком лишнее — убрать
        else { cl.amount-=excess; excess=0; } }                             // частично — уменьшить
    }
    DB.ops=DB.ops.filter(function(o){return !ids[o.id];}); save();
  }
  function diffRows(d){ return '<div class="diff">'+d.map(function(c){return '<div class="diffrow"><div class="dl">'+esc(c.label)+'</div><div class="dv"><span class="from">'+esc(c.from)+'</span> <span class="arr">→</span> <span class="to">'+esc(c.to)+'</span></div></div>';}).join('')+'</div>'; }
  // кто может править напрямую: Руслан — свои; Ульяна — только личное (её кошелёк). Остальное Ульяны — через согласование Руслана.
  function canDirect(o){ if(role()==='ruslan') return true; return o.acc==='zpUlyana'; }
  function needsApproval(o){ return role()==='ulyana' && o.who==='ulyana' && o.acc!=='zpUlyana'; }
  function proposeChange(id,next){ var o=DB.ops.filter(function(x){return x.id===id;})[0]; if(!o)return; if(!genericDiff(o,next).length)return; o.pending={by:role(),next:next,t:Date.now()}; touch(o); save(); }
  function proposeDelete(id){ var o=DB.ops.filter(function(x){return x.id===id;})[0]; if(!o)return; o.pending={by:role(),del:true,t:Date.now()}; touch(o); save(); }
  function approveChange(id){ var o=DB.ops.filter(function(x){return x.id===id;})[0]; if(!o||!o.pending)return; if(o.pending.del){ deleteOp(id); return; } var d=genericDiff(o,o.pending.next); for(var k in o.pending.next)o[k]=o.pending.next[k]; o.log=(o.log||[]).concat([{t:Date.now(),by:o.pending.by,approver:role(),changes:d}]); o.pending=null; touch(o); save(); }
  function rejectChange(id){ var o=DB.ops.filter(function(x){return x.id===id;})[0]; if(!o||!o.pending)return; o.log=(o.log||[]).concat([{t:Date.now(),by:o.pending.by,approver:role(),rejected:true,changes:o.pending.del?[{label:'Удаление',from:'да',to:'отклонено'}]:genericDiff(o,o.pending.next)}]); o.pending=null; touch(o); save(); }

  function ctxOf(o){ if(o.salary||o.kind==='close'||o.kind==='transfer'||o.sale||o.credit||o.creditId)return null; if(o.acc==='zpRuslan')return 'pers_ruslan'; if(o.acc==='zpUlyana')return 'pers_ulyana'; if(o.family)return 'family'; if(o.kind==='in')return 'in'; return 'work'; }
  function showOp(id){
    var o=DB.ops.filter(function(x){return x.id===id;})[0]; if(!o)return;
    var t=o.salary?((o.salary.type==='advance'?'Аванс':'Зарплата')+' · '+esc(o.salary.emp)):(o.kind==='close'?('Закрыт аванс · '+esc(o.emp)):(o.kind==='transfer'?('Перевод '+esc(o.note||'')):esc(o.category||'—')));
    var h='<h3>'+t+'</h3><div class="bigsum" style="text-align:center;font-size:26px;font-weight:800;margin:4px 0">'+money(o.amount)+'</div>'+
      '<div style="text-align:center;color:var(--mut);font-size:13px;margin-bottom:14px">'+((o.salary||o.kind==='close')?('Выдано '+fdate2(o.ts)+(o.per?' · зачтено в '+perName(o.per):'')):fdate2(o.ts))+' · '+esc(o.project||'')+(o.who==='ulyana'?' · Ульяна':'')+(o.note&&o.kind!=='close'?' · '+esc(o.note):'')+'</div>';
    if(o.pending){
      var pinner=o.pending.del?'<div style="font-weight:700;margin-bottom:4px;color:var(--red)">🗑 Запрос на удаление · от Ульяны</div>':('<div style="font-weight:700;margin-bottom:8px">✏️ Запрос на изменение · от Ульяны</div>'+diffRows(genericDiff(o,o.pending.next)));
      h+='<div class="pend" style="background:rgba(240,166,33,.08);border:1px solid rgba(240,166,33,.4);border-radius:12px;padding:12px;margin-bottom:12px">'+pinner+'</div>';
      if(o.pending.by!==role()){ h+='<button class="btn" id="op-appr" style="background:var(--green);color:#04140b;margin-bottom:8px">✓ Одобрить'+(o.pending.del?' удаление':'')+'</button><button class="btn btn-ghost" id="op-rej" style="margin-bottom:8px">Отклонить</button>'; }
      else h+='<div style="text-align:center;color:var(--mut);font-size:13px;margin-bottom:10px">Ждёт одобрения Руслана</div>';
    } else if(canDirect(o)||needsApproval(o)){
      h+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ '+(needsApproval(o)?'Изменить (через согласование)':'Изменить')+'</button>';
      if(canDirect(o)) h+='<button class="btn btn-ghost" id="op-del" style="margin-bottom:8px;color:var(--red)">🗑 Удалить операцию</button>';
      else if(needsApproval(o)) h+='<button class="btn btn-ghost" id="op-delreq" style="margin-bottom:8px;color:var(--red)">🗑 Удалить (через согласование)</button>';
    }
    if(o.sale){ var items=o.sale.items||[{name:o.sale.product,qty:o.sale.qty,price:o.amount,sum:o.amount}];
      var anyLeft=items.some(function(i){return !i.returned;});
      h+='<div style="margin-bottom:10px"><div style="color:var(--mut);font-size:12px;text-align:center;margin-bottom:6px">Продано · '+(o.sale.pay||'')+(o.sale.client?' · клиент: '+esc(o.sale.client):'')+(o.sale.desc?' · '+esc(o.sale.desc):'')+'</div>'+
        items.map(function(i){return '<div class="anrow" style="font-size:13px'+(i.returned?';text-decoration:line-through;color:var(--mut)':'')+'"><span>'+i.name+' <span class="muted">× '+i.qty+'</span>'+(i.returned?' <span style="color:var(--red)">возврат</span>':'')+'</span><b>'+money(i.sum||i.price*i.qty)+'</b></div>';}).join('')+'</div>';
      if(o.returned||!anyLeft) h+='<div style="text-align:center;color:var(--red);font-weight:700;margin-bottom:10px">↩ Возврат оформлен полностью</div>';
      else h+='<button class="btn btn-ghost" id="op-return" style="margin-bottom:8px;color:var(--red)">↩ Оформить возврат'+(items.length>1?' позиции':'')+'</button>'; }
    if(o.log&&o.log.length){ h+='<div style="font-weight:700;font-size:13px;color:var(--mut);margin:8px 0;text-transform:uppercase">История</div>'+
      o.log.slice().reverse().map(function(e){return '<div style="border-left:2px solid var(--line);padding:2px 0 8px 10px;margin-bottom:6px"><div style="color:var(--mut);font-size:12px">'+(e.rejected?'✕ Отклонено':'✓ Одобрено')+' · '+fdate(e.t)+'</div>'+diffRows(e.changes||[])+'</div>';}).join(''); }
    h+='<button class="btn btn-ghost" id="op-close" style="margin-top:6px">Закрыть</button>';
    open(h);
    $('op-close').onclick=close;
    if($('op-appr'))$('op-appr').onclick=function(){approveChange(id);close();render();};
    if($('op-rej'))$('op-rej').onclick=function(){rejectChange(id);close();render();};
    if($('op-edit'))$('op-edit').onclick=function(){ if(o.sale) formEditSale(o); else formEdit(o); };
    if($('op-del'))$('op-del').onclick=function(){ if(confirm('Удалить эту операцию? Отменить нельзя. Балансы и зарплаты пересчитаются автоматически.')){ deleteOp(id); close(); render(); } };
    if($('op-delreq'))$('op-delreq').onclick=function(){ proposeDelete(id); close(); render(); alert('Запрос на удаление отправлен Руслану на согласование.'); };
    if($('op-return'))$('op-return').onclick=function(){ formReturn(o); };
  }
  function formReturn(o){
    var comm=DB.ops.filter(function(x){return x.relSale===o.id&&x.relKind==='comm';})[0];
    var deliv=DB.ops.filter(function(x){return x.relSale===o.id&&x.relKind==='deliv';})[0];
    var items=o.sale.items||[{name:o.sale.product||'товар',qty:o.sale.qty||1,price:o.amount,sum:o.amount}];
    var avail=[]; items.forEach(function(it,i){ if(!it.returned)avail.push(i); });
    var remVal=avail.reduce(function(s,i){return s+(items[i].sum||0);},0)||o.amount;
    var multi=items.length>1;
    var itemsHtml=items.map(function(it,i){ if(it.returned) return '<div style="padding:8px 0;color:var(--mut);font-size:13px;text-decoration:line-through">'+esc(it.name)+' — '+money(it.sum)+' <span style="color:var(--red)">возвращено</span></div>';
      return '<label style="display:flex;align-items:center;gap:10px;padding:9px 0;cursor:pointer;border-bottom:1px solid var(--line)"><input type="checkbox" class="ret-it" data-i="'+i+'" data-sum="'+(it.sum||0)+'"'+(!multi?' checked':'')+' style="width:20px;height:20px"><span style="flex:1;font-size:14px">'+esc(it.name)+' <span class="muted">× '+it.qty+'</span></span><b>'+money(it.sum)+'</b></label>'; }).join('');
    open('<h3>↩ Возврат</h3>'+
      (multi?'<div style="font-size:12px;color:var(--mut);margin-bottom:6px">Отметь, какие позиции возвращаются:</div>':'')+
      '<div style="margin-bottom:12px">'+itemsHtml+'</div>'+
      (comm?'<div class="fld"><label>Комиссия Kaspi к возврату (банк вернёт за возвращённое), ₸</label><input type="number" inputmode="numeric" id="f-comm" value="0"></div>':'')+
      (deliv?'<div class="fld"><label>Доставка к возврату, ₸ (обычно 0 — доставку не возвращают)</label><input type="number" inputmode="numeric" id="f-deliv" value="0"></div>':'')+
      '<div id="ret-info" style="font-size:13px;color:var(--mut);margin-bottom:10px"></div>'+acts('Оформить возврат'));
    function picked(){ var v=0,n=0; Array.prototype.forEach.call(document.querySelectorAll('.ret-it'),function(c){ if(c.checked){v+=parseInt(c.getAttribute('data-sum'))||0;n++;} }); return {v:v,n:n}; }
    function upd(){ var p=picked(); if(comm&&$('f-comm')) $('f-comm').value=remVal?Math.round(comm.amount*p.v/remVal):0;
      $('ret-info').innerHTML='Клиенту вернётся <b style="color:var(--red)">'+money(p.v)+'</b>'+(p.n?'':' — выбери позиции'); }
    Array.prototype.forEach.call(document.querySelectorAll('.ret-it'),function(c){c.onchange=upd;});
    upd();
    wireActs(function(){ var p=picked(); if(!p.v){alert('Выбери позиции для возврата');return;}
      var idx=[]; Array.prototype.forEach.call(document.querySelectorAll('.ret-it'),function(c){ if(c.checked)idx.push(+c.getAttribute('data-i')); });
      var names=idx.map(function(i){return items[i].name;}).join(', ');
      var cr=comm?(parseInt($('f-comm').value)||0):0, dr=deliv?(parseInt($('f-deliv').value)||0):0;
      commit([{kind:'return',acc:'BORZO',project:'BORZO',amount:p.v,relSale:o.id,who:role(),note:'возврат: '+names,retIdx:idx.slice(),retComm:cr,retDeliv:dr}],function(){
        idx.forEach(function(i){ items[i].returned=true; });
        if(items.every(function(it){return it.returned;})) o.returned=true;
        touch(o);
        if(comm&&cr>0){ comm.amount-=cr; touch(comm); if(comm.amount<=0)deleteOp(comm.id); }
        if(deliv&&dr>0){ deliv.amount-=dr; touch(deliv); if(deliv.amount<=0)deleteOp(deliv.id); }
        save(); close(); render(); },'Оформить возврат?'); }); }
  // пропорционально пересчитать позиции продажи при изменении её суммы (аудит #19: иначе sale.items рассинхронятся с amount и возврат посчитается неверно)
  function rescaleSaleItems(o,newAmt){
    if(!o.sale||!Array.isArray(o.sale.items)||!o.sale.items.length)return;
    var old=o.amount||o.sale.items.reduce(function(s,i){return s+(i.sum||0);},0); if(!old)return;
    var k=newAmt/old;
    o.sale.items.forEach(function(i){ if(i.sum!=null)i.sum=Math.round(i.sum*k); if(i.price!=null)i.price=Math.round(i.price*k); });
  }
  // правка ПРОДАЖИ: меняем сам состав (изделия/кол-во/цена), а не только сумму — через тот же каталожный конструктор
  function formEditSale(o){
    var hasRet=o.returned||(o.sale&&o.sale.items||[]).some(function(i){return i.returned;});
    if(hasRet){ alert('По этой продаже уже оформлен возврат. Сначала отмени возврат, потом меняй состав.'); return; }
    open('<h3>✏️ Изменить состав продажи</h3>'+
      (needsApproval(o)?'<div style="font-size:12px;color:var(--mut);margin-bottom:10px">Правка уйдёт Руслану на согласование.</div>':'')+
      '<div id="es-box"></div>'+acts('Сохранить'));
    mountSale($('es-box'));
    // подставить текущие позиции продажи, чтобы правились, а не заводились заново
    saleItems=(o.sale.items||[]).map(function(i){var q=parseInt(i.qty,10)||1;var p=i.price!=null?i.price:Math.round((i.sum||0)/q);return {name:i.name,qty:q,price:p,sum:i.sum!=null?i.sum:p*q};});
    renderSaleList();
    if($('s-client')&&o.sale.client)$('s-client').value=o.sale.client;
    if($('s-desc')&&o.sale.desc)$('s-desc').value=o.sale.desc;
    wireActs(function(){
      if(window._saleDirty&&$('s-cons')&&$('s-cons')._get){var cur=$('s-cons')._get();if(cur&&cur.price>0&&cur.qty>0){cur.sum=cur.qty*cur.price;saleItems.push(cur);window._saleDirty=false;renderSaleList();}}
      if(!saleItems.length){alert('Добавьте хотя бы одну позицию');return;}
      var tot=saleItems.reduce(function(s,i){return s+i.sum;},0);
      var qty=saleItems.reduce(function(s,i){return s+(parseInt(i.qty,10)||0);},0);
      var cli=($('s-client')&&$('s-client').value||'').trim(), sdesc=($('s-desc')&&$('s-desc').value||'').trim();
      var newSale=Object.assign({},o.sale,{items:saleItems.slice(),qty:qty,client:cli,desc:sdesc});
      var next={amount:tot,sale:newSale};
      if(cli||sdesc)next.note=(cli?('Клиент: '+cli):'')+(cli&&sdesc?' · ':'')+(sdesc||'');
      if(needsApproval(o)){ proposeChange(o.id,next); close(); render(); alert('Изменение отправлено Руслану на согласование.'); }
      else { for(var k in next)o[k]=next[k]; touch(o); save(); close(); render(); }
    },'Сохранить изменения продажи?');
  }
  function formEdit(o){
    var ctx=ctxOf(o);
    var showMonth=o.kind==='close'||(o.salary&&o.salary.type==='salary')||(o.kind==='out'&&!(o.salary&&o.salary.type==='advance'));
    open('<h3>✏️ Изменить</h3>'+(needsApproval(o)?'<div style="font-size:12px;color:var(--mut);margin-bottom:10px">Правка уйдёт Руслану на согласование.</div>':'')+
      '<div class="fld"><label>Сумма, ₸</label><input type="number" inputmode="numeric" id="f-amt" value="'+Math.round(o.amount)+'"></div>'+
      (ctx?catField('Категория',ctx,'f-cat',o.category):'')+
      (showMonth?monthSelect('f-mon',perToOff(o.per)):'')+acts('Сохранить'));
    var ct=ctx?wireCatField('f-cat',ctx):function(){return o.category;};
    wireActs(function(){ var a=parseInt($('f-amt').value)||0; if(a<=0){alert('Укажите сумму');return;} var next={amount:a}; if(ctx)next.category=ct(); if(showMonth)next.per=monthPer('f-mon');
      if(needsApproval(o)){ proposeChange(o.id,next); close(); render(); alert('Изменение отправлено Руслану на согласование.'); }
      else { if(o.sale && ('amount' in next)) rescaleSaleItems(o, next.amount); for(var k in next)o[k]=next[k]; touch(o); save(); close(); render(); } });
  }

  // ---------- операции (рендер строк) ----------
  function opRow(o){
    var isSal=!!o.salary;
    var saleName=o.sale?(o.sale.items?(o.sale.items[0].name+(o.sale.items.length>1?' +'+(o.sale.items.length-1):'')):o.sale.product):'';
    var sign,cls,ic,title;
    if(isSal){ title=(o.salary.type==='advance'?'Аванс':'Зарплата')+' · '+o.salary.emp;
      if(o.kind==='transfer'){ sign=''; cls='amt-tr'; ic='<div class="ic ic-tr">💰</div>'; }
      else { sign='−'; cls='amt-out'; ic='<div class="ic ic-out">💰</div>'; }
    } else if(o.kind==='in'){ sign='+'; cls='amt-in'; ic='<div class="ic ic-in">⬇</div>'; title=o.sale?('Продажа · '+saleName):(o.category||'—');
    } else if(o.kind==='transfer'){ sign=''; cls='amt-tr'; ic='<div class="ic ic-tr">⇄</div>'; title='Перевод '+(o.note||'');
    } else if(o.kind==='close'){ sign=''; cls='amt-tr'; ic='<div class="ic ic-tr">✓</div>'; title='Закрыт аванс · '+o.emp;
    } else if(o.kind==='issue'){ sign='−'; cls='amt-tr'; ic='<div class="ic ic-tr">🛒</div>'; title='Выдано снабженцу';
    } else if(o.kind==='credit'){ sign=''; cls='amt-tr'; ic='<div class="ic ic-tr">🏦</div>'; title='Кредит · '+((o.credit&&o.credit.name)||'');
    } else { sign='−'; cls='amt-out'; ic='<div class="ic '+(o.family?'ic-fam':'ic-out')+'">'+(o.kind==='return'?'↩':'⬆')+'</div>'; title=(o.kind==='return'?'↩ Возврат':(o.category||'—')); }
    var pend=o.pending?' <span class="pill" style="background:rgba(240,166,33,.15);color:var(--amber)">на согласовании</span>':'';
    var ret=o.returned?' <span class="pill" style="background:rgba(240,85,92,.15);color:var(--red)">возвращено</span>':'';
    var permo=((o.salary||o.kind==='close')&&o.per)?(' · за '+perName(o.per)):'';
    var whoLbl=o.who?(' · '+(o.who==='ulyana'?'Ульяна':o.who==='snab'?'Снабженец':'Руслан')):'';
    var saleBit=o.sale?(' · '+o.sale.qty+' шт · '+(o.sale.pay||'')+(o.sale.client?' · '+o.sale.client:'')):'';
    var noteBit=(o.note&&!o.salary&&!o.sale&&(o.kind==='out'||o.kind==='return'||o.kind==='in'))?' · '+o.note:'';
    var sub=esc(fdate(o.ts)+' · '+(o.project||'')+permo+saleBit+whoLbl+noteBit)+pend+ret;   // текст экранируем, плашки (pend/ret) — готовый HTML
    var burning=o.salary&&o.salary.type==='advance'&&advBurning(o.salary.emp)>0;
    var amt=o.kind==='close'?'<span class="pill">−'+money(o.amount)+' аванс</span>':'<div class="amt '+cls+(burning?' adv':'')+'">'+sign+money(o.amount)+'</div>';
    return '<div class="op" data-op="'+o.id+'" style="cursor:pointer">'+ic+'<div style="flex:1"><div class="main-t"'+(burning?' style="color:var(--red)"':'')+'>'+esc(title)+'</div><div class="sub-t">'+sub+'</div></div>'+amt+'</div>';
  }
  function listInto(el,ops,empty){ el.innerHTML=ops.length?ops.map(opRow).join(''):'<div class="empty">'+empty+'</div>';
    Array.prototype.forEach.call(el.querySelectorAll('[data-op]'),function(x){x.onclick=function(){showOp(x.getAttribute('data-op'));};}); }
  function opSearchText(o){ return (fdate2(o.ts)+' '+(o.category||'')+' '+(o.note||'')+' '+((o.salary&&o.salary.emp)||'')+' '+(o.emp||'')+' '+o.amount+' '+(o.project||'')+' '+((o.sale&&o.sale.items)?o.sale.items.map(function(i){return i.name;}).join(' '):'')+' '+((o.sale&&o.sale.pay)||'')+' '+((o.sale&&o.sale.client)||'')).toLowerCase(); }
  function wireSearch(inputId,el,ops,empty){ var inp=$(inputId);
    function draw(){ var q=(inp?inp.value:'').trim().toLowerCase(); var f=q?ops.filter(function(o){return opSearchText(o).indexOf(q)>=0;}):ops; listInto(el,f,q?'Ничего не найдено':empty); }
    if(inp) inp.oninput=draw; draw(); }

  // лента BORZO у Ульяны: две вкладки — финансы (ручные) и снабжение (закупки+выдачи снабженцу)
  function drawUBorzo(){
    var box=$('uborzo-feed'); if(!box) return;
    // снабжение = закупы/выдачи через кассу снабжения + любые расходы сырья (это снабженческая зона, не финансовая)
    function isSnab(o){ return o.supplyExpense||o.supplyIssue||(o.kind==='out'&&o.category==='Сырьё'); }
    var fin=opsSorted().filter(function(o){return ((o.project==='BORZO')||(o.kind==='transfer'&&o.to==='BORZO'))&&!o.family&&!isSnab(o);});
    var snab=opsSorted().filter(isSnab);
    var ops=uFeed==='snab'?snab:fin;
    wireSearch('s-uborzo',$('u-borzo-list'),ops,uFeed==='snab'?'Закупок снабжения пока нет.':'Операций пока нет.');
    Array.prototype.forEach.call(box.querySelectorAll('[data-uf]'),function(b){
      var on=b.getAttribute('data-uf')===uFeed;
      b.style.background=on?'var(--blue)':'var(--card2)'; b.style.color=on?'#fff':'var(--mut)'; b.style.borderColor=on?'var(--blue)':'var(--line)';
      b.onclick=function(){ uFeed=b.getAttribute('data-uf'); drawUBorzo(); };
    });
  }
  // ---------- рендер панелей ----------
  function render(){
    // запросы Ульяны на согласование (видит Руслан)
    var reqs=DB.ops.filter(function(o){return o.pending&&o.pending.by==='ulyana';});
    var rb=$('r-reqs');
    if(rb){ rb.innerHTML=reqs.map(function(o){ var t=o.salary?('зарплате '+o.salary.emp):(o.family?'семейном расходе':'расходе BORZO');
      var act=o.pending.del?('🗑 удалить в '+t):('✏️ изменить в '+t);
      return '<div class="card" style="border-color:rgba(240,166,33,.5);background:rgba(240,166,33,.07);padding:12px;margin-bottom:10px"><div style="font-weight:700">Запрос Ульяны — '+act+'</div><button class="btn" data-req="'+o.id+'" style="background:var(--green);color:#04140b;margin-top:10px">Посмотреть и решить</button></div>';
    }).join('');
      Array.prototype.forEach.call(rb.querySelectorAll('[data-req]'),function(x){x.onclick=function(){showOp(x.getAttribute('data-req'));};}); }
    $('r-balances').innerHTML=PROJECTS.map(function(p){
      var sub=(p==='BORZO')?'<div style="font-size:10px;color:var(--mut);margin-top:4px">касса '+money(balance('BORZO')-potSnab)+' · снабжение '+money(potSnab)+'</div>':'';
      return '<div class="bal"><div class="l">'+p+'</div><div class="v">'+money(balance(p))+'</div>'+sub+'</div>';
    }).join('');
    wireSearch('s-work',$('r-work-list'),opsSorted().filter(function(o){return PROJECTS.indexOf(o.project)>=0&&!o.family&&!o.supplyExpense;}),'Операций пока нет.');

    var byMe=sumW(function(o){return o.kind==='out'&&o.acc==='zpRuslan'&&inRangeS(o,curR);});
    var byU=sumW(function(o){return o.family&&inRangeS(o,curR);});
    $('p-spent').textContent=money(byMe+byU); $('p-by-me').textContent=money(byMe); $('p-by-u').textContent=money(byU);
    $('p-balance').textContent=money(balance('zpRuslan'));
    wireSearch('s-pers',$('r-pers-list'),opsSorted().filter(function(o){return (o.kind==='out'&&o.acc==='zpRuslan')||(o.kind==='in'&&o.acc==='zpRuslan')||(o.kind==='transfer'&&o.to==='zpRuslan')||o.family;}),'Личных операций пока нет.');

    $('u-borzo-bal').innerHTML='<div class="bal"><div class="l">Касса BORZO</div><div class="v">'+money(balance('BORZO'))+'</div><div style="font-size:10px;color:var(--mut);margin-top:4px">касса '+money(balance('BORZO')-potSnab)+' · снабжение '+money(potSnab)+'</div></div>';
    drawUBorzo();

    $('uzp-balance').textContent=money(balance('zpUlyana'));
    $('uzp-spent').textContent=money(sumW(function(o){return o.kind==='out'&&o.acc==='zpUlyana'&&inRangeS(o,curR);}));
    wireSearch('s-uzp',$('u-zp-list'),opsSorted().filter(function(o){return (o.kind==='out'&&o.acc==='zpUlyana')||(o.kind==='in'&&o.acc==='zpUlyana')||(o.salary&&o.salary.emp==='Ульяна');}),'Пока пусто.');

    $('urus-spent').textContent=money(sumW(function(o){return o.family&&inRangeS(o,curR);}));
    wireSearch('s-urus',$('u-rus-list'),opsSorted().filter(function(o){return o.family;}),'Семейных трат пока нет.');
  }

  // ---------- навигация ----------
  function tab(on,off,bon,boff){ $(on).style.display='';off.forEach(function(p){$(p).style.display='none';});$(bon).className='on';boff.forEach(function(b){$(b).className='';}); }
  $('tab-work').onclick=function(){tab('pane-work',['pane-pers'],'tab-work',['tab-pers']);};
  $('tab-pers').onclick=function(){tab('pane-pers',['pane-work'],'tab-pers',['tab-work']);};
  $('tab-uborzo').onclick=function(){tab('pane-uborzo',['pane-uzp','pane-urus'],'tab-uborzo',['tab-uzp','tab-urus']);};
  $('tab-uzp').onclick=function(){tab('pane-uzp',['pane-uborzo','pane-urus'],'tab-uzp',['tab-uborzo','tab-urus']);};
  $('tab-urus').onclick=function(){tab('pane-urus',['pane-uborzo','pane-uzp'],'tab-urus',['tab-uborzo','tab-uzp']);};

  var _role='ruslan';
  function role(r){ if(r){_role=r;} return _role; }
  function setRole(r){ _role=r; var ru=r==='ruslan'; $('view-ruslan').style.display=ru?'':'none'; $('view-ulyana').style.display=ru?'none':''; $('role-ruslan').className=ru?'on':''; $('role-ulyana').className=ru?'':'on'; render(); }
  $('role-ruslan').onclick=function(){setRole('ruslan');};
  $('role-ulyana').onclick=function(){setRole('ulyana');};

  var ACT={
    'in':formIn,
    'out':function(){formExpense({who:'ruslan',projects:PROJECTS});},
    'transfer':formTransfer,
    'salary':function(){formSalaryHub({who:'ruslan',projects:PROJECTS});},
    'credits':function(){formCredits({who:'ruslan',projects:PROJECTS});},
    'topzp':formTopZp,
    'perslust':formPersR,
    'perincome':function(){formPersIncome({who:'ruslan',acc:'zpRuslan',project:'Личное'});},
    'uperincome':function(){formPersIncome({who:'ulyana',acc:'zpUlyana',project:'Личное Ульяны'});},
    'uin':formUIn,
    'uout':function(){formExpense({who:'ulyana',fixedProj:'BORZO'});},
    'usalary':function(){formSalaryHub({who:'ulyana',fixedProj:'BORZO'});},
    'ucredits':function(){formCredits({who:'ulyana',fixedProj:'BORZO'});},
    'uperslust':formUPers,
    'ufamily':formUFamily
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-act]'),function(b){b.onclick=function(){var f=ACT[b.getAttribute('data-act')];if(f)f();};});

  var AN={
    work:function(){openAnalytics(['byproject'],'byproject',PROJECTS);},
    pers:function(){openAnalytics(['wallet'],'wallet');},
    uborzo:function(){openAnalytics(['byproject'],'byproject',['BORZO']);},
    uzp:function(){openAnalytics(['upers'],'upers');},
    urus:function(){openAnalytics(['ufam'],'ufam');}
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-an]'),function(b){b.onclick=function(){var f=AN[b.getAttribute('data-an')];if(f)f();};});

  var impBtn=$('do-import');
  if(impBtn) impBtn.onclick=function(){ if(!confirm('Импорт истории BORZO заменит текущие данные в этом браузере. Продолжить?'))return;
    impBtn.textContent='Загружаю…';
    fetch('import.json?t='+Date.now()).then(function(r){return r.json();}).then(function(d){ localStorage.setItem(KEY,JSON.stringify(d));
      var fin=function(){ alert('Импортировано операций: '+((d.ops||[]).length)); location.reload(); };
      if(CLOUD){ DB=d; window.API.finPut(d).then(fin).catch(function(){ alert('Импорт в браузер прошёл, но не залился на сервер — проверь связь'); location.reload(); }); }
      else fin();
    }).catch(function(e){ alert('Ошибка импорта: '+e); impBtn.textContent='⤓ Импорт истории BORZO'; }); };

  var clrBtn=$('do-clear');
  if(clrBtn) clrBtn.onclick=function(){ if(!confirm('Стереть ВСЕ данные'+(CLOUD?' НА СЕРВЕРЕ (у всех)':' в этом браузере')+' и начать с чистого листа? Отменить нельзя.'))return;
    localStorage.removeItem(KEY);
    if(CLOUD){ window.API.finPut({ops:[],employees:['Руслан','Ульяна','Азамат','Данияр']}).then(function(){location.reload();}).catch(function(){location.reload();}); }
    else location.reload(); };

  // режим: залогинен → кабинет по роли + облачная синхронизация; иначе демо на localStorage
  if(CLOUD){
    var U=window.API.user||{}, owner=(U.role==='mgr');
    var dn=document.querySelector('.demo-note');
    var BTN='background:var(--card2);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:6px 11px;font-size:14px;cursor:pointer';
    if(dn){ dn.style.color='var(--ink)'; dn.innerHTML=
      '<div style="display:flex;align-items:center;gap:6px;padding:2px 0">'+
      '<span style="color:var(--mut);flex:1;text-align:left;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+((U.name||'—'))+'</span>'+
      (owner?'<button id="fin-pult" title="Домой" style="'+BTN+'">🏠</button>':'')+
      (owner?'<button id="fin-supply" title="Касса снабжения" style="'+BTN+'">🛒</button>':'')+
      (owner?'<button id="fin-eye" title="Подглядеть кабинет Ульяны" style="'+BTN+'">👁</button>':'')+
      '<button id="fin-gear" title="Настройки" style="'+BTN+'">⚙️</button>'+
      '</div>'; }
    var sup=document.getElementById('fin-supply'); if(sup)sup.onclick=function(){ location.href='kassa.html'; };
    var plt=document.getElementById('fin-pult'); if(plt)plt.onclick=function(){ location.href='home.html'; };
    var rsw=document.querySelector('.roleswitch'); if(rsw)rsw.classList.remove('show');   // сегментный переключатель убран — вместо него глазок
    if(!owner && impBtn&&impBtn.parentNode) impBtn.parentNode.style.display='none';
    var eye=document.getElementById('fin-eye');
    var peek=document.createElement('div');
    peek.style.cssText='display:none;background:rgba(240,166,33,.12);color:var(--amber,#f0a621);font-size:12px;text-align:center;padding:7px;border-radius:9px;margin:8px 14px 0';
    peek.textContent='👁 Кабинет Ульяны — это не твоя зона, ты подглядываешь. Действуй за неё только если реально нужно.';
    if(dn&&dn.parentNode) dn.parentNode.insertBefore(peek,dn.nextSibling);
    if(eye) eye.onclick=function(){
      var toUl = role()!=='ulyana';
      setRole(toUl?'ulyana':'ruslan');
      eye.textContent = toUl?'↩':'👁';
      eye.title = toUl?'Вернуться к себе':'Подглядеть кабинет Ульяны';
      eye.style.borderColor = toUl?'var(--amber,#f0a621)':'var(--line)';
      peek.style.display = toUl?'':'none';
    };
    var gear=document.getElementById('fin-gear');
    if(gear) gear.onclick=function(){
      open('<h3>⚙️ Настройки</h3>'+
        '<button class="btn btn-ghost" id="set-theme" style="margin-bottom:8px">🎨 Тема приложения</button>'+
        '<button class="btn btn-ghost" id="set-pass" style="margin-bottom:8px">🔑 Сменить пароль</button>'+
        '<button class="btn btn-ghost" id="set-logout" style="margin-bottom:8px;color:var(--red)">Выйти из аккаунта</button>'+
        '<button class="btn btn-ghost" id="set-close">Закрыть</button>');
      document.getElementById('set-close').onclick=close;
      document.getElementById('set-theme').onclick=function(){
        open(BorzoTheme.editorHtml()+'<button class="btn btn-ghost" id="th-close" style="margin-top:10px">Закрыть</button>');
        BorzoTheme.wireEditor(document.getElementById('sheet-body')||document.body);
        document.getElementById('th-close').onclick=close;
      };
      document.getElementById('set-logout').onclick=function(){ window.API.logout(); };
      document.getElementById('set-pass').onclick=function(){
        var oldp=prompt('Текущий пароль:'); if(oldp===null)return;
        var np=prompt('Новый пароль (минимум 5 символов):'); if(np===null)return;
        if((np||'').length<5){ alert('Новый пароль — минимум 5 символов'); return; }
        window.API.password({old_pass:oldp,new_pass:np}).then(function(){ alert('Пароль изменён'); close(); }).catch(function(e){ alert(e.message||'Ошибка'); });
      };
    };
    setRole(owner?'ruslan':'ulyana');
    loadPot();
    window.API.finGet().then(function(res){
      var sd=res&&res.data;
      var sc=(sd&&Array.isArray(sd.ops))?sd.ops.length:0;
      var lc=(DB&&Array.isArray(DB.ops))?DB.ops.length:0;
      curRev = (res&&res.rev!=null) ? res.rev : 0;
      synced = true;                                                              // загрузка завершена — теперь запись на сервер разрешена
      if(sc>0){ DB=sd; localStorage.setItem(KEY,JSON.stringify(DB)); render(); }  // сервер — источник правды (удаления/связка/правки с других устройств доходят)
      else if(lc>0){ doPush(); }                                                  // сервер пуст, локально есть — первичная миграция вверх
    }).catch(function(){ /* сеть недоступна: synced остаётся false — НЕ затираем сервер вслепую */ });
  } else {
    // без логина песочницы больше нет — только вход (реальные данные, демо отключено)
    location.replace('login.html?next=fin.html');
  }
})();
