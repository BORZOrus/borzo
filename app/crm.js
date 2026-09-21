/* BORZO CRM — server-backed, vanilla JS. No local customer cache or demo data. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  var state={user:null,stages:[],managers:[],deals:[],clients:[],templates:[],tab:'deals',q:'',userId:null};
  var sheet=$('sheet'), body=$('sheet-body'), focusBefore=null, toastTimer=null, sheetGeneration=0, loading=false;
  var pendingMutation=false, uncertainMutation=false, refreshSequence=0;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(v){return Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₸';}
  function stamp(v){if(!v)return 'Дата неизвестна';return new Date(v).toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
  function day(v){return v?String(v).slice(0,10).split('-').reverse().join('.'): 'Не указана';}
  function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');}
  function api(method,url,b){return API.crm(method,url,b);}
  function toast(msg){$('toast').textContent=msg;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){$('toast').hidden=true;},3500);}
  function error(e){return e&&e.message==='401'?'Сессия завершена. Войдите заново.':e&&e.message||'Нет связи с сервером. Повторите попытку.';}
  function openSheet(title,html){
    if(sheet.hidden) focusBefore=document.activeElement;
    sheetGeneration++; $('sheet-title').textContent=title; body.innerHTML=html;
    sheet.hidden=false;$('sheet-bg').hidden=false;$('app').inert=true;document.body.style.overflow='hidden';sheet.scrollTop=0;sheet.focus();
  }
  function closeSheet(){
    if(pendingMutation) return;
    if(uncertainMutation&&!confirm('Сервер мог сохранить действие. Лучше повторить отправку с тем же ключом. Всё равно закрыть?')) return;
    uncertainMutation=false;sheetGeneration++;sheet.hidden=true;$('sheet-bg').hidden=true;$('app').inert=false;document.body.style.overflow='';body.innerHTML='';
    if(focusBefore&&focusBefore.isConnected) focusBefore.focus();
  }
  $('sheet-close').onclick=closeSheet;$('sheet-bg').onclick=closeSheet;
  sheet.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();closeSheet();}
    if(e.key==='Tab'){
      var nodes=Array.from(sheet.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')).filter(function(x){return x.getClientRects().length;});
      if(!nodes.length){e.preventDefault();sheet.focus();return;}
      var first=nodes[0],last=nodes[nodes.length-1];
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===sheet)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===sheet)){e.preventDefault();first.focus();}
    }
  });
  sheet.addEventListener('focusin',function(e){if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) setTimeout(function(){e.target.scrollIntoView({block:'nearest'});},250);});
  function field(label,name,value,type,extra){return '<label class="field">'+esc(label)+'<input name="'+esc(name)+'" type="'+(type||'text')+'" value="'+esc(value)+'" '+(extra||'')+'></label>';}
  function area(label,name,value){return '<label class="field">'+esc(label)+'<textarea name="'+esc(name)+'" maxlength="10000">'+esc(value)+'</textarea></label>';}
  function options(list,value){return list.map(function(x){return '<option value="'+esc(x.id)+'"'+(String(x.id)===String(value)?' selected':'')+'>'+esc(x.name)+'</option>';}).join('');}
  function select(label,name,list,value){return '<label class="field">'+esc(label)+'<select aria-label="'+esc(label)+'" name="'+esc(name)+'">'+options(list,value)+'</select></label>';}
  function source(value){return field('Источник','source',value,'text','list="sources" maxlength="100"')+'<datalist id="sources">'+['Instagram','WhatsApp','Kaspi','Сайт','Дилеры','Рекомендация','Другое'].map(function(s){return '<option value="'+esc(s)+'"></option>';}).join('')+'</datalist>';}
  function submit(label){return '<p class="error" data-error role="alert"></p><button class="btn block" type="submit">'+esc(label||'Сохранить')+'</button>';}
  function val(form,name){return form.elements.namedItem(name).value.trim();}
  function mutation(form,method,url,read,onSuccess){
    var pending=null,busy=false,disabledState=null;
    var button=form.querySelector('[type=submit]'), label=button.textContent;
    form.onsubmit=async function(e){
      e.preventDefault();if(busy||pendingMutation||(!pending&&!form.reportValidity()))return;
      busy=true;pendingMutation=true;button.disabled=true;button.textContent='Сохраняю…';
      var errBox=form.querySelector('[data-error]');errBox.textContent='';
      var appWasInert=$('app').inert;$('app').inert=true;sheet.inert=true;
      try{
        if(!pending) pending=Object.assign(await read(),{reqId:uid()});
        var result=await api(method,url,pending);pending=null;uncertainMutation=false;pendingMutation=false;
        sheet.inert=false;$('app').inert=appWasInert;
        await onSuccess(result);
      }catch(ex){
        if(!pending || (ex.status && ex.status<500)){
          pending=null;uncertainMutation=false;
          if(disabledState){disabledState.forEach(function(x){x.el.disabled=x.disabled;});disabledState=null;}
        }else {
          uncertainMutation=true;
          if(!disabledState)disabledState=Array.from(form.elements).filter(function(el){return el!==button;}).map(function(el){return {el:el,disabled:el.disabled};});
          disabledState.forEach(function(x){x.el.disabled=true;});
        }
        errBox.textContent=error(ex)+(uncertainMutation?' Повторная отправка безопасна: используем тот же ключ.':'');
      }finally{
        busy=false;pendingMutation=false;sheet.inert=false;$('app').inert=!sheet.hidden;
        button.disabled=false;button.textContent=pending?'Повторить сохранение':label;
      }
    };
  }
  async function reload(){
    if(loading) return;loading=true;var sequence=++refreshSequence;
    $('status').textContent='Обновляю…';
    try{
      var d=await api('GET','/deals');if(sequence!==refreshSequence)return;state.deals=d.deals;
      $('status').textContent='Обновлено '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
      if(state.tab==='deals') renderDeals();
      else if(state.tab==='clients') await loadClients();
      else if(state.tab==='analytics') await renderAnalytics();
      else if(state.tab==='templates') await renderTemplates();
    }catch(e){$('status').textContent='Не удалось обновить: '+error(e);}finally{loading=false;}
  }
  function matches(d){
    var text=[d.client_name,d.title,d.phone,d.source,d.manager_name].join(' ').toLowerCase();
    var digits=state.q.replace(/\D/g,'');
    return !state.q||text.indexOf(state.q)>=0||(digits.length>2&&String(d.phone||'').indexOf(digits)>=0);
  }
  var lastBoardQuery='';
  function renderDeals(){
    var oldBoard=$('main').querySelector('.board'),oldScroll=oldBoard?oldBoard.scrollLeft:0;
    var deals=state.deals.filter(matches);
    $('main').innerHTML='<div class="board" aria-label="Воронка сделок">'+state.stages.map(function(s){
      var rows=deals.filter(function(d){return d.stage_id===s.id;});
      return '<section class="column '+(s.is_won?'won':s.is_lost?'lost':'')+'"><header class="col-head"><h2><span class="dot"></span>'+esc(s.name)+'</h2><div class="muted">'+esc(rows.length)+' · '+esc(money(rows.reduce(function(n,d){return n+Number(d.amount);},0)))+'</div></header>'+rows.map(function(d){
        var days=d.stage_entered_at?Math.max(0,Math.floor((Date.now()-new Date(d.stage_entered_at).getTime())/86400000))+' дн. в этапе':'Срок неизвестен';
        return '<article class="deal"><button class="deal-open" data-deal="'+esc(d.id)+'"><strong>'+esc(d.client_name)+'</strong><div class="deal-title">'+esc(d.title)+'</div><div class="amount">'+esc(money(d.amount))+'</div><div class="deal-foot"><span>'+esc(d.source||'Без источника')+'</span><span>'+esc(days)+'</span></div><div class="hint">'+esc(d.manager_name||'Без менеджера')+'</div></button><button class="stage-btn" data-move="'+esc(d.id)+'">Сменить этап →</button></article>';
      }).join('')+(rows.length?'':'<div class="empty">'+(state.q?'Нет совпадений':'Пока нет сделок')+'</div>')+'</section>';
    }).join('')+'</div>';
    var board=$('main').querySelector('.board');
    if(state.q&&state.q!==lastBoardQuery){var first=board.querySelector('.deal');if(first)board.scrollLeft=first.parentElement.offsetLeft-16;}
    else board.scrollLeft=oldScroll;lastBoardQuery=state.q;
    bindDeals($('main'));
  }
  function bindDeals(root){
    root.querySelectorAll('[data-deal]').forEach(function(b){b.onclick=function(){showDeal(b.dataset.deal);};});
    root.querySelectorAll('[data-move]').forEach(function(b){b.onclick=function(){showStage(b.dataset.move);};});
  }
  function clientForm(c){return field('Имя клиента','name',c.name,'text','required maxlength="200" autocomplete="name"')+field('Телефон','phone',c.phone,'tel','autocomplete="tel" placeholder="+7 700 000 00 00"')+field('Instagram','instagram',c.instagram,'text','maxlength="200"')+source(c.source)+area('Заметка о клиенте','note',c.note);}
  function quickDeal(c){
    openSheet('Новая заявка','<form id="quick-form">'+(c?'<p class="pre">'+esc(c.name)+' · '+esc(c.phone||'Без телефона')+'</p>':field('Имя клиента','name','','text','required maxlength="200" autocomplete="name"')+field('Телефон','phone','','tel','required autocomplete="tel" placeholder="+7 700 000 00 00"'))+source(c?c.source:'')+'<p class="hint">Заявка появится в первом этапе. Сумму и состав можно заполнить позже.</p>'+submit('Создать заявку')+'</form>');
    var f=$('quick-form');
    mutation(f,'POST','/deals',function(){var src=val(f,'source');return c?{client_id:c.id,source:src}:{client:{name:val(f,'name'),phone:val(f,'phone'),source:src},source:src};},async function(r){closeSheet();toast('Заявка создана');await reload();showDeal(r.deal.id);});
    (f.elements.namedItem(c?'source':'name')).focus();
  }
  function contactLinks(d){
    var p=d.phone;
    if(!p||!/^\+[1-9]\d{7,14}$/.test(p))return '<p class="muted">Телефон не указан</p>';
    return '<div class="actions"><a class="ghost" href="tel:'+esc(p)+'">'+esc(p)+'</a><a class="ghost" href="https://wa.me/'+esc(p.slice(1))+'" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a></div>';
  }
  async function showDeal(id){
    openSheet('Сделка','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{
      var all=await Promise.all([api('GET','/deals/'+id),api('GET','/deals/'+id+'/events'),api('GET','/templates')]);
      if(gen!==sheetGeneration)return;
      var d=all[0].deal, files=all[0].files;state.templates=all[2].templates;
      $('sheet-title').textContent=d.client_name;
      body.innerHTML='<span class="pill">'+esc(d.stage_name)+'</span><div class="amount">'+esc(money(d.amount))+'</div><p class="pre">'+esc(d.title)+'</p>'+contactLinks(d)+
        '<div class="actions"><button class="btn" id="deal-stage">Сменить этап</button><button class="ghost" id="deal-edit">Изменить</button><button class="ghost" id="deal-client">Клиент</button></div>'+
        '<p class="hint">'+esc(d.manager_name||'—')+' · '+esc(d.source||'Без источника')+'</p>'+(d.note?'<p class="pre">'+esc(d.note)+'</p>':'')+
        (d.lost_reason?'<p class="pre danger">Причина отказа: '+esc(d.lost_reason)+'</p>':'')+
        (d.imported_incomplete?'<p class="hint">Импорт: дополните состав и дату отгрузки через «Изменить».</p>':'')+
        (d.is_won&&!files.length?'<p class="hint">⚠ Документ оплаты (Kaspi) не прикреплён — добавьте ниже в «Фото и файлы».</p>':'')+((d.is_won||d.is_lost)&&!d.closed_at?'<p class="hint">Дата закрытия неизвестна. Сделка не включена в сумму продаж за период. Уточните дату через «Изменить».</p>':'')+'<h3>Состав и отгрузка</h3><p class="muted">Дата: '+esc(day(d.ship_date))+'</p>'+(d.items.length?d.items.map(function(x){return '<div class="metric"><span>'+esc(x.name)+' × '+esc(x.qty)+'</span><b>'+esc(money(x.price*x.qty))+'</b></div>';}).join(''):'<p class="muted">Состав не заполнен</p>')+
        '<h3>Фото и файлы</h3><div class="files">'+files.map(function(f){
          var safe=/^\/uploads\/[\w-]+\.(jpg|png|webp|pdf)$/.test(f.url);if(!safe)return '';
          return '<a class="file" href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">'+(f.mime.indexOf('image/')===0?'<img loading="lazy" src="'+esc(f.url)+'" alt="'+esc(f.name)+'">':'PDF · ')+esc(f.name)+'</a>';
        }).join('')+'</div><form id="file-form"><label class="field">Прикрепить JPEG, PNG, WebP или PDF до 5 МБ<input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>'+submit('Прикрепить')+'</form>'+
        '<h3>Шаблоны ответов</h3>'+(state.templates.length?'<div class="actions">'+state.templates.map(function(t){return '<button class="ghost" data-copy="'+esc(t.id)+'">'+esc(t.title)+'</button>';}).join('')+'</div>':'<p class="muted">Руководитель может добавить шаблоны в разделе «Шаблоны».</p>')+
        '<h3>Лента сделки</h3><form id="event-form">'+select('Тип записи','kind',[{id:'note',name:'Заметка'},{id:'call',name:'Звонок'},{id:'msg',name:'Сообщение (запись вручную)'}],'note')+area('Текст','text','')+submit('Добавить запись')+'</form><div class="timeline">'+all[1].events.map(function(e){
          var kinds={note:'Заметка',call:'Звонок',msg:'Сообщение',status:'Этап'};
          return '<article class="event"><div class="muted">'+esc(kinds[e.kind]||e.kind)+' · '+esc(e.author_name)+' · '+esc(stamp(e.ts))+'</div><div class="pre">'+esc(e.text)+'</div></article>';
        }).join('')+'</div>';
      $('deal-stage').onclick=function(){showStage(d.id,d);};$('deal-edit').onclick=function(){editDeal(d);};$('deal-client').onclick=function(){showClient(d.client_id);};bindCopy(body);
      var f=$('event-form');f.elements.namedItem('text').required=true;
      mutation(f,'POST','/deals/'+d.id+'/events',function(){return {kind:val(f,'kind'),text:val(f,'text')};},async function(){toast('Запись добавлена');await showDeal(d.id);});
      var ff=$('file-form');
      mutation(ff,'POST','/deals/'+d.id+'/files',async function(){var file=ff.elements.namedItem('file').files[0];if(!file||file.size>5*1024*1024)throw new Error('Выберите файл размером до 5 МБ');return {name:file.name,data:await fileData(file)};},async function(){toast('Файл прикреплён');await showDeal(d.id);});
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
  function itemHtml(x){return '<div class="item" data-variant="'+esc(x.variant_id||'')+'">'+field('Изделие','item_name',x.name,'text','required maxlength="200"')+'<div class="item-grid">'+field('Количество','item_qty',x.qty==null?1:x.qty,'number','required min="0.01" step="0.01"')+field('Цена, ₸','item_price',x.price==null?0:x.price,'number','required min="0" max="1000000000000" step="0.01"')+'</div><button type="button" class="ghost danger" data-remove>Убрать позицию</button></div>';}
  function itemsForm(d){return '<h3>Состав</h3>'+pickerHtml()+'<div id="items">'+d.items.map(itemHtml).join('')+'</div><button type="button" class="ghost" id="add-item">+ Позиция вручную</button>'+field('Дата отгрузки','ship_date',d.ship_date,'date');}
  function wireItems(){function bind(){body.querySelectorAll('[data-remove]').forEach(function(b){b.onclick=function(){b.closest('.item').remove();};});}bind();$('add-item').onclick=function(){$('items').insertAdjacentHTML('beforeend',itemHtml({}));bind();};wirePicker();}
  function readItems(){return Array.from($('items').querySelectorAll('.item')).map(function(el){var it={name:el.querySelector('[name=item_name]').value.trim(),qty:el.querySelector('[name=item_qty]').value,price:el.querySelector('[name=item_price]').value};var v=el.getAttribute('data-variant');if(v)it.variant_id=Number(v);return it;});}
  async function showStage(id,known){
    if(!known){openSheet('Сменить этап','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;try{known=(await api('GET','/deals/'+id)).deal;if(gen!==sheetGeneration)return;}catch(e){body.innerHTML='<p class="error">'+esc(error(e))+'</p>';return;}}
    var d=known;
    openSheet('Сменить этап','<form id="stage-form">'+select('Этап','stage_id',state.stages,d.stage_id)+'<div id="won-fields" hidden><p class="hint">Для завершения сделки нужны состав и плановая дата отгрузки.</p>'+field('Сумма сделки, ₸','amount',d.amount,'number','required min="0" max="1000000000000" step="0.01"')+itemsForm(d)+'</div><div id="lost-fields" hidden>'+area('Причина отказа','lost_reason',d.lost_reason)+'</div>'+submit('Сохранить этап')+'</form>');
    wireItems();var f=$('stage-form'), manualAmount=Number(d.amount)>0;
    f.elements.namedItem('amount').oninput=function(){manualAmount=true;};
    function total(){if(!manualAmount)f.elements.namedItem('amount').value=String(Math.round(readItems().reduce(function(n,x){return n+Number(x.qty||0)*Number(x.price||0);},0)*100)/100);}
    $('items').addEventListener('input',total);$('items').addEventListener('click',total);total();
    function change(){var s=state.stages.find(function(x){return x.id===Number(val(f,'stage_id'));});$('won-fields').hidden=!s.is_won;$('lost-fields').hidden=!s.is_lost;
      $('won-fields').querySelectorAll('input,button').forEach(function(x){x.disabled=!s.is_won;});f.elements.namedItem('ship_date').required=s.is_won;
      if(s.is_won&&!$('items').children.length)$('add-item').click();}
    f.elements.namedItem('stage_id').onchange=change;change();
    mutation(f,'POST','/deals/'+d.id+'/stage',function(){var stage=state.stages.find(function(x){return x.id===Number(val(f,'stage_id'));});var b={baseRev:d.rev,stage_id:stage.id,lost_reason:val(f,'lost_reason')};if(stage.is_won){b.amount=val(f,'amount');b.items=readItems();b.ship_date=val(f,'ship_date');if(!b.items.length)throw new Error('Добавьте хотя бы одну позицию');}return b;},async function(){toast('Этап сохранён');await showDeal(d.id);await reload();});
  }
  function editDeal(d){
    openSheet('Изменить сделку','<form id="deal-form">'+field('Название','title',d.title,'text','required maxlength="200"')+field('Сумма сделки, ₸','amount',d.amount,'number','required min="0" max="1000000000000" step="0.01"')+select('Менеджер','manager_id',state.managers,d.manager_id)+source(d.source)+area('Заметка о сделке','note',d.note)+itemsForm(d)+((d.is_won||d.is_lost)?field('Дата закрытия','closed_date',d.closed_at?new Date(new Date(d.closed_at).getTime()+5*3600000).toISOString().slice(0,10):'','date'):'')+submit()+'</form>');wireItems();
    var f=$('deal-form');if(d.is_won)f.elements.namedItem('ship_date').required=true;
    mutation(f,'PATCH','/deals/'+d.id,function(){var b={baseRev:d.rev,title:val(f,'title'),amount:val(f,'amount'),manager_id:Number(val(f,'manager_id')),source:val(f,'source'),note:val(f,'note'),items:readItems(),ship_date:val(f,'ship_date')};if(f.elements.namedItem('closed_date')&&val(f,'closed_date')){var original=d.closed_at?new Date(new Date(d.closed_at).getTime()+5*3600000).toISOString().slice(0,10):'';if(val(f,'closed_date')!==original)b.closed_at=val(f,'closed_date')+'T12:00:00+05:00';}return b;},async function(){toast('Сделка сохранена');await showDeal(d.id);await reload();});
  }
  var clientSeq=0;
  async function loadClients(){var seq=++clientSeq;try{var r=await api('GET','/clients?q='+encodeURIComponent(state.q));if(state.tab!=='clients'||seq!==clientSeq)return;state.clients=r.clients;$('main').innerHTML='<div class="content">'+(r.clients.length?r.clients.map(function(c){return '<button class="card client-row" data-client="'+esc(c.id)+'"><strong>'+esc(c.name)+'</strong><div class="muted">'+esc(c.phone||'Без телефона')+' · Сделок: '+esc(c.deals_count)+'</div></button>';}).join(''):'<div class="empty">'+(state.q?'Клиенты не найдены':'Клиенты появятся после создания первой заявки')+'</div>')+'</div>';$('main').querySelectorAll('[data-client]').forEach(function(b){b.onclick=function(){showClient(b.dataset.client);};});}catch(e){if(state.tab==='clients')$('status').textContent=error(e);}}
  async function showClient(id){
    openSheet('Клиент','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{var r=await api('GET','/clients/'+id);if(gen!==sheetGeneration)return;var c=r.client;$('sheet-title').textContent=c.name;
      body.innerHTML=contactLinks(c)+'<p class="muted">'+esc(c.source||'Без источника')+(c.instagram?' · Instagram: '+esc(c.instagram):'')+'</p><p class="pre">'+esc(c.note)+'</p><div class="actions"><button class="btn" id="client-new">+ Заявка</button><button class="ghost" id="client-edit">Изменить клиента</button></div><h3>История сделок</h3>'+r.deals.map(function(d){return '<button class="card client-row" data-deal="'+esc(d.id)+'"><strong>'+esc(d.title)+'</strong><div class="muted">'+esc(d.stage_name)+' · '+esc(money(d.amount))+' · '+esc(stamp(d.created_at))+'</div></button>';}).join('');bindDeals(body);
      $('client-new').onclick=function(){quickDeal(c);};$('client-edit').onclick=function(){openSheet('Изменить клиента','<form id="client-form">'+clientForm(c)+submit()+'</form>');var f=$('client-form');mutation(f,'PATCH','/clients/'+c.id,function(){return {baseRev:c.rev,name:val(f,'name'),phone:val(f,'phone'),instagram:val(f,'instagram'),source:val(f,'source'),note:val(f,'note')};},async function(){toast('Клиент сохранён');await showClient(c.id);await reload();});};
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
  var range=null,analyticsSeq=0;
  async function renderAnalytics(){
    var seq=++analyticsSeq;
    try{var a=await api('GET','/analytics'+(range?'?from='+range.from+'&to='+range.to:''));if(state.tab!=='analytics'||seq!==analyticsSeq)return;
      $('main').innerHTML='<div class="content"><form id="range-form"><div class="split">'+field('С','from',a.from,'date','required')+field('По','to',a.to,'date','required')+'</div><button class="ghost" type="submit">Показать период</button></form><p class="hint">Даты по времени Астаны, обе границы включены.</p>'+(a.missing&&(a.missing.undated_closed||a.missing.undated_leads)?'<p class="hint">Импорт без дат: заявок — '+esc(a.missing.undated_leads)+', закрытий — '+esc(a.missing.undated_closed)+'. Они не включены в соответствующие показатели за период.</p>':'')+'<div class="stats"><div class="card"><div class="muted">Новых заявок</div><div class="stat">'+esc(a.leads)+'</div></div><div class="card"><div class="muted">Конверсия</div><div class="stat">'+esc(a.conversion)+'%</div></div><div class="card"><div class="muted">Продаж за период</div><div class="stat">'+esc(a.sales_count)+'</div></div><div class="card"><div class="muted">Сумма продаж</div><div class="stat">'+esc(money(a.sales_amount))+'</div></div></div><p class="hint">Конверсия: выполненные из заявок, созданных за период ('+esc(a.won)+' / '+esc(a.leads)+'). Продажи: выполненные сделки по дате закрытия. Это сумма сделок, не движения денег в кассе.</p><div class="card"><h2>Все сделки по этапам · сейчас</h2>'+a.stages.map(function(s){return '<div class="metric"><span>'+esc(s.name)+' · '+esc(s.count)+'</span><b>'+esc(money(s.amount))+'</b></div>';}).join('')+'</div><div class="card"><h2>Источники заявок за период</h2>'+(a.sources.length?a.sources.map(function(s){return '<div class="metric"><span>'+esc(s.source||'Без источника')+'</span><b>'+esc(s.count)+'</b></div>';}).join(''):'<p class="muted">Нет заявок за период</p>')+'</div></div>';
      $('range-form').onsubmit=function(e){e.preventDefault();var f=e.target;range={from:val(f,'from'),to:val(f,'to')};renderAnalytics();};
    }catch(e){if(state.tab==='analytics')$('status').textContent=error(e);}
  }
  async function copy(t){try{await navigator.clipboard.writeText(t.text);toast('Шаблон скопирован');}catch(e){openSheet('Скопируйте текст',area(t.title,'copy',t.text));var el=body.querySelector('textarea');el.readOnly=true;el.focus();el.select();}}
  function bindCopy(root){root.querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){var t=state.templates.find(function(x){return x.id===Number(b.dataset.copy);});if(t)copy(t);};});}
  async function renderTemplates(){
    try{var r=await api('GET','/templates');if(state.tab!=='templates')return;state.templates=r.templates;
      $('main').innerHTML='<div class="content">'+(state.user.role==='mgr'?'<button class="btn" id="template-new">+ Шаблон</button>':'')+'<p class="hint">Нажмите «Копировать» и вставьте ответ в переписку.</p>'+r.templates.map(function(t){return '<article class="card"><h2>'+esc(t.title)+'</h2><p class="pre">'+esc(t.text)+'</p><div class="actions"><button class="ghost" data-copy="'+esc(t.id)+'">Копировать</button>'+(state.user.role==='mgr'?'<button class="ghost danger" data-delete-template="'+esc(t.id)+'">Удалить</button>':'')+'</div></article>';}).join('')+(r.templates.length?'':'<div class="empty">Пока нет шаблонов</div>')+'</div>';bindCopy($('main'));
      if($('template-new'))$('template-new').onclick=function(){openSheet('Новый шаблон','<form id="template-form">'+field('Название','title','','text','required maxlength="200"')+area('Текст ответа','text','')+submit('Добавить')+'</form>');var f=$('template-form');f.elements.namedItem('text').required=true;mutation(f,'POST','/templates',function(){return {title:val(f,'title'),text:val(f,'text')};},async function(){closeSheet();toast('Шаблон добавлен');await renderTemplates();});};
      $('main').querySelectorAll('[data-delete-template]').forEach(function(b){b.onclick=function(){var t=state.templates.find(function(x){return x.id===Number(b.dataset.deleteTemplate);});openSheet('Удалить шаблон?','<form id="delete-template"><p class="pre">'+esc(t.title)+'</p>'+submit('Удалить')+'</form>');mutation($('delete-template'),'DELETE','/templates/'+t.id,function(){return {};},async function(){closeSheet();toast('Шаблон удалён');await renderTemplates();});};});
    }catch(e){$('status').textContent=error(e);}
  }
  function fileData(file){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(r.result);};r.onerror=function(){reject(new Error('Не удалось прочитать файл'));};r.readAsDataURL(file);});}
  function renderImport(){
    $('main').innerHTML='<div class="content"><div class="card"><h2>Перенос из MindSales</h2><p class="hint">JSON: deals, clients, stages, products. Выберите файл, сопоставьте этапы, затем запустите импорт. Повторный импорт пропускает существующие внешние ID и сохраняет последующие правки менеджеров.</p><label class="field">Файл JSON (до 10 МБ)<input id="import-file" type="file" accept=".json,application/json"></label><div id="import-preview"></div><p class="error" id="import-error" role="alert"></p></div></div>';
    $('import-file').onchange=async function(){
      var f=this.files[0];if(!f)return;var preview=$('import-preview');$('import-error').textContent='';preview.innerHTML='';
      try{if(f.size>10*1024*1024)throw new Error('Файл слишком большой');var data=JSON.parse(await f.text());if(!data||!Array.isArray(data.deals))throw new Error('В файле нужен массив deals');
        var stages=new Map();(data.stages||[]).forEach(function(s){stages.set(String(s.id),s.name||s.title||String(s.id));});data.deals.forEach(function(d){if(d.statusId==null)throw new Error('В каждой сделке нужен statusId');if(!stages.has(String(d.statusId)))stages.set(String(d.statusId),String(d.statusId));});
        preview.innerHTML='<p class="pre">Сделок: '+esc(data.deals.length)+' · Клиентов: '+esc((data.clients||[]).length)+' · Товаров: '+esc((data.products||[]).length)+'</p><p class="hint">Неизвестные даты останутся пустыми и не попадут в показатели за период. Выполненные сделки без состава/даты отгрузки будут отмечены для уточнения. При ошибке весь импорт откатывается.</p><form id="import-form">'+Array.from(stages).map(function(entry,i){var same=state.stages.find(function(s){return s.name.toLowerCase()===String(entry[1]).toLowerCase();});return '<label class="field">'+esc(entry[1])+'<select name="map'+i+'" data-ext="'+esc(entry[0])+'" required><option value="">Выберите этап CRM</option>'+options(state.stages,same?same.id:'')+'</select></label>';}).join('')+submit('Импортировать')+'</form>';
        var form=$('import-form');mutation(form,'POST','/import',function(){var map=Object.create(null);form.querySelectorAll('[data-ext]').forEach(function(s){map[s.dataset.ext]=Number(s.value);});return {data:data,stageMap:map};},async function(r){var c=r.counts;preview.innerHTML='<p class="pre">Импорт завершён.\nДобавлено сделок: '+esc(c.deals)+'\nКлиентов: '+esc(c.clients)+'\nТоваров: '+esc(c.products)+'\nПропущено существующих сделок: '+esc(c.skipped_deals)+'\nНужно уточнить состав/отгрузку: '+esc(c.incomplete_won)+'\nБез даты создания: '+esc(c.undated_leads)+'\nБез даты закрытия: '+esc(c.undated_closed)+'</p>';$('import-file').value='';await reload();});
      }catch(e){$('import-error').textContent=error(e);}
    };
  }
  // ---------- каталог товаров (конструктор) ----------
  var cat={models:[],options:[],variants:[],loaded:false};
  async function loadCatalog(force){if(cat.loaded&&!force)return cat;var r=await api('GET','/catalog');cat.models=r.models;cat.options=r.options;cat.variants=r.variants;cat.loaded=true;return cat;}
  function optValues(kind){return cat.options.filter(function(o){return o.kind===kind;}).map(function(o){return o.value;});}
  function softType(m){return !!m&&/^(Банкетка|Пуф)/i.test(m.type);}
  function variantLabel(v,m){return [v.corpus&&((softType(m)?'ткань ':'корпус ')+v.corpus),v.legs&&('ножки '+v.legs),v.len,v.width].filter(Boolean).join(' · ')||'базовый';}
  function variantsOf(m){return cat.variants.filter(function(v){return v.model_id===m.id&&!v.archived;});}
  async function renderCatalog(){
    try{await loadCatalog();}catch(e){$('main').innerHTML='<div class="content"><p class="error">'+esc(error(e))+'</p></div>';return;}
    if(state.tab!=='catalog')return;
    var live=cat.models.filter(function(m){return !m.archived;});
    var types={};live.forEach(function(m){(types[m.type]=types[m.type]||[]).push(m);});
    $('main').innerHTML='<div class="content">'+
      (cat.models.length?'':'<div class="card"><h2>Каталог пуст</h2><p class="hint">Загрузить каталог BORZO из Kaspi-файла (171 позиция, 46 моделей)?</p><button class="btn" id="cat-seed">Загрузить каталог</button><p class="error" id="seed-err"></p></div>')+
      Object.keys(types).sort().map(function(t){return '<h3 style="display:flex;align-items:center;justify-content:space-between">'+esc(t)+' · '+types[t].length+'<button class="ghost" data-addtype="'+esc(t)+'" style="font-size:16px;padding:2px 12px">+</button></h3><div class="cat-grid">'+types[t].map(function(m){
        var vs=variantsOf(m),priced=vs.filter(function(v){return v.price!=null;}).length;
        var ph=vs.filter(function(v){return v.photo;})[0];
        var nm=m.name.indexOf(t)===0?m.name.slice(t.length).trim():m.name;   // в карточке без повторения категории
        return '<button class="cat-card" data-model="'+esc(m.id)+'">'+(ph?'<img loading="lazy" src="'+esc(ph.photo)+'" alt="">':'<span class="cat-noimg">📦</span>')+'<strong>'+esc(nm)+'</strong><span class="muted">'+vs.length+' вар.'+(priced?' · цены':'')+'</span></button>';}).join('')+'</div>';}).join('')+
      '<div class="actions" style="margin-top:14px"><button class="ghost" id="cat-newtype">+ Категория</button></div></div>';
    if($('cat-seed'))$('cat-seed').onclick=async function(){var b=this;b.disabled=true;try{var r=await api('POST','/catalog/seed',{reqId:uid()});toast('Загружено моделей: '+r.counts.models+', вариантов: '+r.counts.variants);await loadCatalog(true);renderCatalog();}catch(e){$('seed-err').textContent=error(e);b.disabled=false;}};
    $('main').querySelectorAll('[data-model]').forEach(function(b){b.onclick=function(){showModel(Number(b.dataset.model));};});
    function newModelForm(type){
      var soft=/^(Банкетка|Пуф)/i.test(type||'');
      openSheet('Новая позиция'+(type?' · '+type:''),'<form id="model-form">'+
        (type?'':field('Тип (Стол-трансформер/Консоль/Тумба/Банкетка/Пуф/Столик)','type','','text','required maxlength="60"'))+
        field('Название модели (напр. LUX 3 м)','base','','text','required maxlength="100"')+
        '<h3>Первый вариант (можно дополнить позже)</h3>'+
        field(soft?'Ткань (подушка)':'Корпус','corpus','','text','maxlength="60"')+
        field('Ножки','legs','','text','maxlength="60"')+
        field('Длина (напр. 3 м)','len','','text','maxlength="30"')+
        field('Ширина (напр. 60 см)','width','','text','maxlength="30"')+
        field('Артикул','code','','text','maxlength="120"')+
        field('Цена, ₸','price','','number','min="0" step="1"')+
        '<label class="field">Фото (JPEG/PNG/WebP до 5 МБ)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>'+
        submit('Создать позицию')+'</form>');
      var f=$('model-form');
      f.onsubmit=async function(e){
        e.preventDefault(); if(!f.reportValidity())return;
        var btn=f.querySelector('[type=submit]'); btn.disabled=true; btn.textContent='Сохраняю…';
        var errBox=f.querySelector('[data-error]'); errBox.textContent='';
        try{
          var t=type||val(f,'type');
          var mr=await api('POST','/catalog/models',{reqId:uid(),type:t,base:val(f,'base')});
          var photo=null; var pf=f.elements.namedItem('photo').files[0];
          if(pf){ if(pf.size>5*1024*1024) throw new Error('Фото — до 5 МБ'); photo=await fileData(pf); }
          await api('POST','/catalog/variants',{reqId:uid(),model_id:mr.model.id,corpus:val(f,'corpus'),legs:val(f,'legs'),len:val(f,'len'),width:val(f,'width'),code:val(f,'code'),price:val(f,'price'),photo:photo});
          toast('Позиция создана'); await loadCatalog(true); renderCatalog(); showModel(mr.model.id);
        }catch(ex){ errBox.textContent=error(ex); btn.disabled=false; btn.textContent='Создать позицию'; }
      };
    }
    $('main').querySelectorAll('[data-addtype]').forEach(function(b){b.onclick=function(){newModelForm(b.dataset.addtype);};});
    if($('cat-newtype'))$('cat-newtype').onclick=function(){
      var t=(prompt('Название новой категории (напр. Смарт-тумба):')||'').trim();
      if(!t)return; newModelForm(t);   // категория появится вместе с первой карточкой
    };
  }
  function chipsEdit(name,kind,value){
    var vals=optValues(kind);
    return '<label class="field">'+esc(name)+'<select name="opt_'+kind+'"><option value="">—</option>'+vals.map(function(v){return '<option'+(v===value?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'<option value="__new">+ добавить…</option></select></label>';
  }
  async function showModel(mid){
    try{await loadCatalog();}catch(e){toast(error(e));return;}
    var m=cat.models.find(function(x){return x.id===mid;});if(!m)return;
    var vs=cat.variants.filter(function(v){return v.model_id===m.id;});
    openSheet(m.name,'<div class="actions"><button class="ghost" id="m-rename">✏️ Переименовать</button><button class="ghost danger" id="m-arch">'+(m.archived?'Вернуть из архива':'В архив')+'</button></div>'+
      '<h3>Варианты · '+vs.length+'</h3>'+vs.map(function(v){
        return '<div class="card cat-var">'+(v.photo?'<img class="cat-thumb big" loading="lazy" src="'+esc(v.photo)+'" alt="">':'')+'<div class="metric"><span>'+esc(variantLabel(v,m))+(v.archived?' · архив':'')+'</span><b>'+(v.price!=null?esc(money(v.price)):'<span class="muted">нет цены</span>')+'</b></div>'+(v.code?'<div class="muted">'+esc(v.code)+'</div>':'')+'<div class="actions"><button class="ghost" data-price="'+v.id+'">Цена</button><label class="ghost" style="cursor:pointer">📷<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-photo="'+v.id+'"></label>'+(v.photo?'<button class="ghost danger" data-unphoto="'+v.id+'">без фото</button>':'')+'<button class="ghost danger" data-varch="'+v.id+'">'+(v.archived?'Вернуть':'Архив')+'</button></div></div>';
      }).join('')+
      '<button class="ghost" id="var-toggle" style="margin-top:8px">+ Добавить вариант</button><form id="var-form" hidden>'+chipsEdit(softType(m)?'Ткань (подушка)':'Корпус','corpus','')+chipsEdit('Ножки','legs','')+chipsEdit('Длина','len','')+chipsEdit('Ширина','width','')+field('Цена, ₸ (можно позже)','price','','number','min="0" step="1"')+field('Код/артикул','code','','text','maxlength="120"')+submit('Добавить вариант')+'</form>');
    body.querySelectorAll('select[name^=opt_]').forEach(function(s){s.onchange=async function(){
      if(s.value!=='__new')return;
      var kind=s.name.slice(4), v=(prompt('Новое значение ('+kind+'):')||'').trim();
      if(!v){s.value='';return;}
      try{await api('POST','/catalog/options',{reqId:uid(),kind:kind,value:v});await loadCatalog(true);
        var opt=document.createElement('option');opt.textContent=v;s.insertBefore(opt,s.querySelector('option[value=__new]'));s.value=v;toast('Добавлено: '+v);}
      catch(e){toast(error(e));s.value='';}
    };});
    $('m-rename').onclick=async function(){var v=(prompt('Новое название:',m.name)||'').trim();if(!v||v===m.name)return;
      try{await api('PATCH','/catalog/models/'+m.id,{reqId:uid(),name:v});await loadCatalog(true);renderCatalog();showModel(m.id);}catch(e){toast(error(e));}};
    $('m-arch').onclick=async function(){try{await api('PATCH','/catalog/models/'+m.id,{reqId:uid(),archived:!m.archived});await loadCatalog(true);closeSheet();renderCatalog();}catch(e){toast(error(e));}};
    body.querySelectorAll('[data-price]').forEach(function(b){b.onclick=async function(){
      var v=cat.variants.find(function(x){return x.id===Number(b.dataset.price);});
      var p=prompt('Цена, ₸ (пусто — убрать):',v.price!=null?v.price:'');if(p===null)return;
      try{await api('PATCH','/catalog/variants/'+v.id,{reqId:uid(),price:p.trim()===''?null:p.trim()});await loadCatalog(true);showModel(m.id);toast('Цена сохранена');}catch(e){toast(error(e));}
    };});
    body.querySelectorAll('[data-photo]').forEach(function(inp){inp.onchange=async function(){
      var file=inp.files[0];if(!file)return;if(file.size>5*1024*1024){toast('Фото — до 5 МБ');return;}
      var data=await fileData(file);
      try{await api('PATCH','/catalog/variants/'+inp.dataset.photo,{reqId:uid(),photo:data});await loadCatalog(true);showModel(m.id);toast('Фото сохранено');}catch(e){toast(error(e));}
    };});
    body.querySelectorAll('[data-editcode]').forEach(function(b){b.onclick=async function(){
      var v=cat.variants.find(function(x){return x.id===Number(b.dataset.editcode);});
      var nc=prompt('Артикул:',v.code||''); if(nc===null)return;
      try{await api('PATCH','/catalog/variants/'+v.id,{reqId:uid(),code:nc.trim()});await loadCatalog(true);showModel(m.id);toast('Артикул сохранён');}catch(e){toast(error(e));}
    };});
    body.querySelectorAll('[data-unphoto]').forEach(function(b){b.onclick=async function(){
      try{await api('PATCH','/catalog/variants/'+b.dataset.unphoto,{reqId:uid(),photo:''});await loadCatalog(true);showModel(m.id);}catch(e){toast(error(e));}
    };});
    body.querySelectorAll('[data-varch]').forEach(function(b){b.onclick=async function(){
      var v=cat.variants.find(function(x){return x.id===Number(b.dataset.varch);});
      try{await api('PATCH','/catalog/variants/'+v.id,{reqId:uid(),archived:!v.archived});await loadCatalog(true);showModel(m.id);}catch(e){toast(error(e));}
    };});
    var f=$('var-form');
    $('var-toggle').onclick=function(){f.hidden=!f.hidden;this.textContent=f.hidden?'+ Добавить вариант':'− Свернуть';};
    mutation(f,'POST','/catalog/variants',function(){function ov(k){var s=f.elements.namedItem('opt_'+k);return s&&s.value!=='__new'?s.value:'';}
      return {model_id:m.id,corpus:ov('corpus'),legs:ov('legs'),len:ov('len'),width:ov('width'),price:val(f,'price'),code:val(f,'code')};},
      async function(){toast('Вариант добавлен');await loadCatalog(true);showModel(m.id);});
  }
  // пикер «из каталога» для состава сделки: модель → вариант → позиция с ценой и variant_id
  function pickerHtml(){return '<div class="card" id="cat-pick"><div class="muted">Добавить из каталога</div><select id="pick-model"><option value="">— модель —</option></select><select id="pick-variant" hidden></select><button type="button" class="ghost" id="pick-add" hidden>+ В состав</button></div>';}
  async function wirePicker(){
    try{await loadCatalog();}catch(e){var el=$('cat-pick');if(el)el.innerHTML='<div class="muted">Каталог недоступен</div>';return;}
    var pm=$('pick-model'),pv=$('pick-variant'),pa=$('pick-add');if(!pm)return;
    cat.models.filter(function(m){return !m.archived&&variantsOf(m).length;}).forEach(function(m){var o=document.createElement('option');o.value=m.id;o.textContent=m.name;pm.appendChild(o);});
    pv.onchange=function(){
      var old=$('pick-img');if(old)old.remove();
      var v=cat.variants.find(function(x){return x.id===Number(pv.value);});
      if(v&&v.photo){var im=document.createElement('img');im.id='pick-img';im.className='cat-thumb big';im.src=v.photo;pa.parentNode.insertBefore(im,pa);}
    };
    pm.onchange=function(){
      pv.innerHTML='';pv.hidden=pa.hidden=!pm.value;var old=$('pick-img');if(old)old.remove();if(!pm.value)return;
      var m=cat.models.find(function(x){return x.id===Number(pm.value);});
      variantsOf(m).forEach(function(v){var o=document.createElement('option');o.value=v.id;o.textContent=variantLabel(v,m)+(v.price!=null?' · '+money(v.price):' · цены нет');pv.appendChild(o);});pv.onchange();
    };
    pa.onclick=function(){
      var m=cat.models.find(function(x){return x.id===Number(pm.value);});
      var v=cat.variants.find(function(x){return x.id===Number(pv.value);});
      if(!m||!v)return;
      var name=m.name+(variantLabel(v,m)!=='базовый'?' · '+variantLabel(v,m):'');
      $('items').insertAdjacentHTML('beforeend',itemHtml({name:name,qty:1,price:v.price!=null?v.price:0,variant_id:v.id}));
      body.querySelectorAll('[data-remove]').forEach(function(b){b.onclick=function(){b.closest('.item').remove();};});
      $('items').dispatchEvent(new Event('input'));
    };
  }
  async function tab(name){
    state.tab=name;$('toolbar').hidden=!['deals','clients'].includes(name);
    document.querySelectorAll('[data-tab]').forEach(function(b){b.classList.toggle('on',b.dataset.tab===name);if(b.dataset.tab===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    if(name==='deals')renderDeals();else if(name==='clients')await loadClients();else if(name==='analytics')await renderAnalytics();else if(name==='templates')await renderTemplates();else if(name==='catalog')await renderCatalog();else if(name==='import'&&state.user.role==='mgr')renderImport();
  }
  var searchTimer;
  $('search').oninput=function(){state.q=this.value.trim().toLowerCase();clearTimeout(searchTimer);if(state.tab==='deals')renderDeals();else searchTimer=setTimeout(loadClients,200);};
  $('new-deal').onclick=function(){quickDeal();};$('refresh').onclick=reload;
  document.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){if(state.user)tab(b.dataset.tab);};});
  if(!API.token){location.replace('login.html?next=crm.html');return;}
  API.me().then(async function(r){
    if(!['mgr','fin'].includes(r.user.role)){location.replace('home.html');return;}
    state.user=r.user;var m=await api('GET','/meta');state.stages=m.stages;state.managers=m.managers;state.userId=m.user_id;
    $('who').textContent=r.user.name;$('new-deal').disabled=false;$('import-tab').hidden=r.user.role!=='mgr';await reload();
  }).catch(function(e){$('main').innerHTML='<div class="content"><p class="error">'+esc(error(e))+'</p><button class="ghost" id="retry-start">Повторить</button></div>';$('retry-start').onclick=function(){location.reload();};});
  setInterval(function(){if(state.user&&sheet.hidden&&!document.hidden&&state.tab==='deals')reload();},20000);
  window.addEventListener('online',function(){if(state.user)reload();});
})();
