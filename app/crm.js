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
    stopChat();uncertainMutation=false;sheetGeneration++;sheet.hidden=true;$('sheet-bg').hidden=true;$('app').inert=false;document.body.style.overflow='';body.innerHTML='';
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
      $('status').textContent='Обновлено '+new Date().toLocaleTimeString('ru-RU',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit'});
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
  // ---------- карточка лида = ЧАТ, скин WhatsApp (тёмный, по скрину Руслана) ----------
  var chatTimer=null, chatDealId=null, chatLastEventId=0;
  function stopChat(){ clearTimeout(chatTimer); chatTimer=null; chatDealId=null; }
  function chDay(ts){ return new Date(new Date(ts).getTime()+5*3600000).toISOString().slice(0,10); }
  function chDayLabel(ts){
    var d=chDay(ts), today=chDay(Date.now()), yest=chDay(Date.now()-86400000);
    if(d===today)return 'Сегодня'; if(d===yest)return 'Вчера';
    return new Date(ts).toLocaleDateString('ru-RU',{timeZone:'Asia/Almaty',day:'numeric',month:'long'});
  }
  function chTime(ts){ return new Date(ts).toLocaleTimeString('ru-RU',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit'}); }
  function bubble(e){
    if(e.kind!=='msg') return '<div class="wa-sys"><span>'+(e.kind==='call'?'📞 ':'')+esc(e.text)+'</span></div>';
    var inc=/^📩/.test(e.text||'');
    var t=String(e.text||'').replace(/^📩\s*/,'');
    var m=inc&&t.indexOf(':')>0?t.slice(t.indexOf(':')+1).trim():t;
    return '<div class="wa-row '+(inc?'in':'out')+'"><div class="wa-b">'+esc(inc?m:t)+
      '<span class="wa-meta">'+chTime(e.ts)+(inc?'':' <span class="wa-tick">✓✓</span>')+'</span></div></div>';
  }
  function renderLog(evs){
    var out='',lastDay='';
    evs.forEach(function(e){
      var d=chDay(e.ts);
      if(d!==lastDay){ out+='<div class="wa-sys"><span class="wa-day">'+esc(chDayLabel(e.ts))+'</span></div>'; lastDay=d; }
      out+=bubble(e);
    });
    return out||'<div class="wa-sys"><span>Пока нет сообщений</span></div>';
  }
  async function showDeal(id){
    stopChat();
    openSheet('Чат','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{
      var all=await Promise.all([api('GET','/deals/'+id),api('GET','/deals/'+id+'/events'),api('GET','/templates')]);
      if(gen!==sheetGeneration)return;
      var d=all[0].deal, evs=all[1].events.slice().reverse();
      state.templates=all[2].templates;
      chatDealId=d.id; chatLastEventId=evs.length?evs[evs.length-1].id:0;
      var lastDayShown=evs.length?chDay(evs[evs.length-1].ts):'';
      $('sheet-title').textContent='';
      var p=d.phone&&/^\+[1-9]\d{7,14}$/.test(d.phone)?d.phone:null;
      var initial=(d.client_name||'?').trim().charAt(0).toUpperCase();
      body.innerHTML=
        '<div class="wa-head">'+
          '<span class="wa-ava">'+esc(initial)+'</span>'+
          '<span class="wa-who"><b>'+esc(d.client_name)+'</b><small>'+esc(d.stage_name)+(d.agent_on?' · 🤖 агент':'')+'</small></span>'+
          (p?'<a class="wa-ic" href="tel:'+esc(p)+'" title="Позвонить">📞</a>':'')+
          '<button class="wa-ic" id="wa-menu-btn" title="Меню">⋮</button>'+
        '</div>'+
        '<div class="wa-menu" id="wa-menu" hidden>'+
          '<button id="wm-sale">✅ Оформить продажу</button>'+
          (p?'<a href="https://wa.me/'+esc(p.slice(1))+'" target="_blank" rel="noopener noreferrer">🟢 Открыть в WhatsApp</a>':'')+
          '<button id="wm-agent">🤖 Агент: '+(d.agent_on?'вкл — выключить тут':'выкл — включить тут')+'</button>'+
          '<button id="wm-stage">📊 Сменить этап</button>'+
          '<button id="wm-info">ℹ️ Детали сделки</button>'+
          '<button id="wm-client">👤 Клиент</button>'+
        '</div>'+
        '<div class="wa-stages" id="wa-stages">'+state.stages.map(function(s){
          var cur=s.id===d.stage_id;
          return '<button class="st-chip'+(cur?' on':'')+(s.is_won?' won':'')+(s.is_lost?' lost':'')+'" data-st="'+s.id+'">'+(s.is_won?'✅ ':'')+esc(s.name)+'</button>';
        }).join('')+'</div>'+
        '<div class="wa-log" id="ch-log">'+renderLog(evs)+'</div>'+
        '<div class="ch-tpl" id="ch-tpl" hidden></div>'+
        '<div class="wa-input">'+
          '<div class="wa-field">'+
            '<button class="wa-in-ic" id="ch-tplbtn" title="Шаблоны">📋</button>'+
            '<textarea id="ch-text" rows="1" placeholder="Сообщение"></textarea>'+
            '<label class="wa-in-ic" style="cursor:pointer" title="Прикрепить">📎<input id="ch-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label>'+
          '</div>'+
          '<button class="wa-send" id="ch-send">➤</button>'+
        '</div>';
      var log=$('ch-log'); log.scrollTop=log.scrollHeight;
      var menu=$('wa-menu');
      $('wa-menu-btn').onclick=function(){menu.hidden=!menu.hidden;};
      // полоска воронки: текущий этап подсвечен, тап по другому — переход; «Продажа» открывает оформление
      var stagesBar=$('wa-stages'), curChip=stagesBar.querySelector('.st-chip.on');
      if(curChip)curChip.scrollIntoView({inline:'center',block:'nearest'});
      stagesBar.querySelectorAll('[data-st]').forEach(function(b){b.onclick=async function(){
        var s=state.stages.find(function(x){return x.id===Number(b.dataset.st);});
        if(!s||s.id===d.stage_id)return;
        if(s.is_won){stopChat();showSale(d.id);return;}
        if(s.is_lost){stopChat();showStage(d.id,d);return;}
        if(!confirm('Перевести сделку в «'+s.name+'»?'))return;
        try{await api('POST','/deals/'+d.id+'/stage',{reqId:uid(),baseRev:d.rev,stage_id:s.id});toast('Этап: '+s.name);showDeal(d.id);reload();}
        catch(e){toast(error(e));}
      };});
      async function send(){
        var t=$('ch-text').value.trim(); if(!t)return;
        $('ch-send').disabled=true;
        try{ await api('POST','/deals/'+d.id+'/events',{reqId:uid(),kind:'msg',text:t}); $('ch-text').value=''; await poll(); }
        catch(e){ toast(error(e)); }
        $('ch-send').disabled=false; $('ch-text').focus();
      }
      $('ch-send').onclick=send;
      $('ch-text').addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} });
      async function poll(){
        if(chatDealId!==d.id)return;
        clearTimeout(chatTimer);
        try{
          var r=await api('GET','/deals/'+d.id+'/events');
          if(chatDealId!==d.id||gen!==sheetGeneration)return;
          var list=r.events.slice().reverse().filter(function(e){return e.id>chatLastEventId;});
          if(list.length){
            chatLastEventId=list[list.length-1].id;
            list.forEach(function(e){
              var day=chDay(e.ts);
              if(day!==lastDayShown){ log.insertAdjacentHTML('beforeend','<div class="wa-sys"><span class="wa-day">'+esc(chDayLabel(e.ts))+'</span></div>'); lastDayShown=day; }
              log.insertAdjacentHTML('beforeend',bubble(e));
            });
            log.scrollTop=log.scrollHeight;
          }
        }catch(e){}
        chatTimer=setTimeout(poll,7000);
      }
      chatTimer=setTimeout(poll,7000);
      $('ch-tplbtn').onclick=function(){
        var box=$('ch-tpl');
        if(!box.hidden){box.hidden=true;return;}
        box.innerHTML=(state.templates.length?state.templates.map(function(t){return '<button class="ghost" data-tpl="'+t.id+'" style="text-align:left">'+esc(t.title)+'</button>';}).join(''):'<span class="muted" style="font-size:12px;padding:6px">Шаблонов нет — добавь во вкладке «Шаблоны»</span>');
        box.hidden=false;
        box.querySelectorAll('[data-tpl]').forEach(function(b){b.onclick=function(){
          var t=state.templates.find(function(x){return x.id===Number(b.dataset.tpl);});
          if(t){var ta=$('ch-text'); ta.value=(ta.value?ta.value+' ':'')+t.text; ta.focus();}
          box.hidden=true;
        };});
      };
      $('ch-file').onchange=async function(){
        var f=this.files[0]; if(!f)return;
        if(f.size>5*1024*1024){toast('Файл — до 5 МБ');return;}
        try{ await api('POST','/deals/'+d.id+'/files',{reqId:uid(),name:f.name,data:await fileData(f)}); toast('Файл прикреплён'); await poll(); }
        catch(e){ toast(error(e)); }
        this.value='';
      };
      $('wm-sale').onclick=function(){ stopChat(); showSale(d.id); };
      $('wm-agent').onclick=async function(){
        try{ await api('POST','/deals/'+d.id+'/agent',{reqId:uid(),on:!d.agent_on}); showDeal(d.id); }catch(e){toast(error(e));}
      };
      $('wm-stage').onclick=function(){ stopChat(); showStage(d.id,d); };
      $('wm-info').onclick=function(){ stopChat(); showDealInfo(d.id); };
      $('wm-client').onclick=function(){ stopChat(); showClient(d.client_id); };
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
  // ℹ️ детали сделки: сумма, состав, файлы, менеджер — всё, что убрано из чата
  async function showDealInfo(id){
    openSheet('Детали','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{
      var r=await api('GET','/deals/'+id);if(gen!==sheetGeneration)return;
      var d=r.deal, files=r.files;
      $('sheet-title').textContent=d.client_name;
      body.innerHTML='<button class="ghost" id="di-back" style="margin-bottom:8px">← в чат</button>'+
        '<span class="pill">'+esc(d.stage_name)+'</span><div class="amount">'+esc(money(d.amount))+'</div><p class="pre">'+esc(d.title)+'</p>'+
        '<p class="hint">'+esc(d.manager_name||'—')+' · '+esc(d.source||'Без источника')+(d.note?' · '+esc(d.note):'')+'</p>'+
        (d.lost_reason?'<p class="pre danger">Причина отказа: '+esc(d.lost_reason)+'</p>':'')+
        (d.is_won&&!files.length?'<p class="hint">⚠ Документ оплаты (Kaspi) не прикреплён — добавьте в чате скрепкой.</p>':'')+
        '<h3>Состав и отгрузка</h3><p class="muted">Дата: '+esc(day(d.ship_date))+'</p>'+(d.items.length?d.items.map(function(x){return '<div class="metric"><span>'+esc(x.name)+' × '+esc(x.qty)+'</span><b>'+esc(money(x.price*x.qty))+'</b></div>';}).join(''):'<p class="muted">Состав не заполнен</p>')+
        '<h3>Файлы</h3><div class="files">'+files.map(function(f){
          var safe=/^\/uploads\/[\w-]+\.(jpg|png|webp|pdf)$/.test(f.url);if(!safe)return '';
          return '<a class="file" href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">'+(f.mime.indexOf('image/')===0?'<img loading="lazy" src="'+esc(f.url)+'" alt="'+esc(f.name)+'">':'PDF · ')+esc(f.name)+'</a>';
        }).join('')+(files.length?'':'<p class="muted">Файлов нет</p>')+'</div>'+
        '<div class="actions" style="margin-top:10px"><button class="ghost" id="di-edit">✏️ Изменить сделку</button><button class="ghost" id="di-client">Клиент</button></div>';
      $('di-back').onclick=function(){showDeal(d.id);};
      $('di-edit').onclick=function(){editDeal(d);};
      $('di-client').onclick=function(){showClient(d.client_id);};
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
  function itemHtml(x){return '<div class="item" data-variant="'+esc(x.variant_id||'')+'">'+field('Изделие','item_name',x.name,'text','required maxlength="200"')+'<div class="item-grid">'+field('Количество','item_qty',x.qty==null?1:x.qty,'number','required min="0.01" step="0.01"')+field('Цена, ₸','item_price',x.price==null?0:x.price,'number','required min="0" max="1000000000000" step="0.01"')+'</div><button type="button" class="ghost danger" data-remove>Убрать позицию</button></div>';}
  function itemsForm(d){return '<h3>Состав</h3>'+pickerHtml()+'<div id="items">'+d.items.map(itemHtml).join('')+'</div><button type="button" class="ghost" id="add-item">+ Позиция вручную</button>'+field('Дата отгрузки','ship_date',d.ship_date,'date');}
  function wireItems(){function bind(){body.querySelectorAll('[data-remove]').forEach(function(b){b.onclick=function(){b.closest('.item').remove();};});}bind();$('add-item').onclick=function(){$('items').insertAdjacentHTML('beforeend',itemHtml({}));bind();};wirePicker();}
  function readItems(){return Array.from($('items').querySelectorAll('.item')).map(function(el){var it={name:el.querySelector('[name=item_name]').value.trim(),qty:el.querySelector('[name=item_qty]').value,price:el.querySelector('[name=item_price]').value};var v=el.getAttribute('data-variant');if(v)it.variant_id=Number(v);return it;});}
  // ✅ оформление продажи: клиент сказал «беру» → что продали, сумма, дата отгрузки → сделка в «Выполнено»
  async function showSale(id){
    openSheet('Оформление продажи','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{
      var d=(await api('GET','/deals/'+id)).deal;if(gen!==sheetGeneration)return;
      var won=state.stages.find(function(s){return s.is_won;});
      if(!won){body.innerHTML='<p class="error">В воронке нет этапа «Выполнено»</p>';return;}
      $('sheet-title').textContent='✅ Продажа · '+d.client_name;
      body.innerHTML='<form id="sale-form">'+
        '<p class="hint">Выбери из каталога, что именно продали, проверь сумму и поставь дату отгрузки. После сохранения сделка станет «'+esc(won.name)+'» — состав уйдёт в производство и отгрузку, оттуда спишется склад.</p>'+
        field('Сумма продажи, ₸','amount',d.amount,'number','required min="0" max="1000000000000" step="0.01"')+
        itemsForm(d)+
        '<p class="hint">📎 Документ оплаты (чек Kaspi) можно прикрепить скрепкой в чате — карточка напомнит, если его нет.</p>'+
        submit('✅ Оформить продажу')+'</form>';
      wireItems();var f=$('sale-form');
      f.elements.namedItem('ship_date').required=true;
      var manualAmount=Number(d.amount)>0;
      f.elements.namedItem('amount').oninput=function(){manualAmount=true;};
      function total(){if(!manualAmount)f.elements.namedItem('amount').value=String(Math.round(readItems().reduce(function(n,x){return n+Number(x.qty||0)*Number(x.price||0);},0)*100)/100);}
      $('items').addEventListener('input',total);$('items').addEventListener('click',total);total();
      mutation(f,'POST','/deals/'+d.id+'/stage',function(){
        var b={baseRev:d.rev,stage_id:won.id,amount:val(f,'amount'),items:readItems(),ship_date:val(f,'ship_date')};
        if(!b.items.length)throw new Error('Добавь хотя бы одну позицию — выбери модель из каталога выше');
        return b;
      },async function(){toast('Продажа оформлена ✅');await showDeal(d.id);await reload();});
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
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
    var torder={};cat.options.filter(function(o){return o.kind==='typeord';}).forEach(function(o){torder[o.value]=o.ord;});
    var tkeys=Object.keys(types).sort(function(a,b){ var oa=torder[a]||999,ob=torder[b]||999; return oa!==ob?oa-ob:a.localeCompare(b); });
    $('main').innerHTML='<div class="content">'+
      (cat.models.length?'':'<div class="card"><h2>Каталог пуст</h2><p class="hint">Загрузить каталог BORZO из Kaspi-файла (171 позиция, 46 моделей)?</p><button class="btn" id="cat-seed">Загрузить каталог</button><p class="error" id="seed-err"></p></div>')+
      tkeys.map(function(t,ti){return '<h3 style="display:flex;align-items:center;gap:6px">'+
        '<span style="flex:1">'+esc(t)+' · '+types[t].length+'</span>'+
        '<button class="ghost tarr" data-tup="'+esc(t)+'"'+(ti===0?' disabled':'')+'>↑</button>'+
        '<button class="ghost tarr" data-tdn="'+esc(t)+'"'+(ti===tkeys.length-1?' disabled':'')+'>↓</button>'+
        '<button class="ghost tarr" data-addtype="'+esc(t)+'">+</button></h3>'+
        '<div class="cat-list">'+types[t].map(function(m){
          var vs=variantsOf(m),priced=vs.filter(function(v){return v.price!=null;}).length;
          var nm=m.name.indexOf(t)===0?m.name.slice(t.length).trim():m.name;
          var strip=vs.filter(function(v){return v.photo;}).map(function(v){return '<img loading="lazy" src="'+esc(v.photo)+'" alt="">';}).join('')||'<span class="cat-noimg">📦</span>';
          return '<button class="cat-rowc" data-model="'+esc(m.id)+'">'+
            '<span class="cat-rowc-head"><strong>'+esc(nm)+'</strong><span class="muted">'+vs.length+' вар.'+(priced?' · цены':'')+'</span><span class="drag-h" data-drag title="Зажми и перетащи">✥</span></span>'+
            '<span class="cat-strip">'+strip+'</span></button>';
        }).join('')+'</div>';}).join('')+
      '<div class="actions" style="margin-top:14px"><button class="ghost" id="cat-newtype">+ Категория</button></div></div>';
    // стрелки категорий: меняем местами и сохраняем порядок
    function saveTypeOrder(arr){ api('POST','/catalog/typeorder',{reqId:uid(),types:arr}).then(function(){loadCatalog(true).then(renderCatalog);}).catch(function(e){toast(error(e));}); }
    $('main').querySelectorAll('[data-tup]').forEach(function(b){b.onclick=function(){var i=tkeys.indexOf(b.dataset.tup);if(i>0){var a=tkeys.slice();a[i-1]=tkeys[i];a[i]=tkeys[i-1];saveTypeOrder(a);}};});
    $('main').querySelectorAll('[data-tdn]').forEach(function(b){b.onclick=function(){var i=tkeys.indexOf(b.dataset.tdn);if(i>=0&&i<tkeys.length-1){var a=tkeys.slice();a[i+1]=tkeys[i];a[i]=tkeys[i+1];saveTypeOrder(a);}};});
    if($('cat-seed'))$('cat-seed').onclick=async function(){var b=this;b.disabled=true;try{var r=await api('POST','/catalog/seed',{reqId:uid()});toast('Загружено моделей: '+r.counts.models+', вариантов: '+r.counts.variants);await loadCatalog(true);renderCatalog();}catch(e){$('seed-err').textContent=error(e);b.disabled=false;}};
    $('main').querySelectorAll('[data-model]').forEach(function(b){b.onclick=function(){showModel(Number(b.dataset.model));};});
    $('main').querySelectorAll('.cat-list').forEach(function(g){enableDrag(g,'.cat-rowc','data-model','models');});
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
    var vs=cat.variants.filter(function(v){return v.model_id===m.id&&!v.archived;});
    var soft=softType(m);
    openSheet(m.name,'<div style="text-align:right;margin:-6px 0 4px"><button class="ghost" id="m-rename" style="padding:4px 10px;font-size:12px">✏️ название</button></div>'+
      '<div id="var-list">'+vs.map(function(v){
        var dims=[v.len,v.width,m.sizeNote].filter(Boolean).join(' · ');
        return '<div class="card cat-var" data-vid="'+v.id+'" style="display:flex;gap:12px;align-items:center">'+
          '<span class="drag-h" data-drag title="Зажми и перетащи">✥</span>'+
          (v.photo?'<img loading="lazy" src="'+esc(v.photo)+'" alt="" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex:0 0 64px">':'<span style="width:64px;height:64px;border-radius:10px;background:var(--card2,#20242c);display:flex;align-items:center;justify-content:center;flex:0 0 64px">📦</span>')+
          '<span style="flex:1;min-width:0">'+
            '<strong style="font-size:13.5px">'+esc(variantLabel(v,m))+'</strong>'+
            (dims?'<div class="muted" style="font-size:12px">'+esc(dims)+'</div>':'')+
            (v.code?'<div class="muted" style="font-size:11.5px">'+esc(v.code)+'</div>':'')+
            '<div style="font-weight:700;margin-top:2px">'+(v.price!=null?esc(money(v.price)):'<span class="muted" style="font-weight:400">цена не задана</span>')+'</div>'+
          '</span>'+
          '<button class="ghost" data-editvar="'+v.id+'" style="padding:8px 10px;flex:0 0 auto">✏️</button>'+
        '</div>';
      }).join('')+'</div>'+
      '<button class="ghost" id="var-add" style="margin-top:8px">+ Добавить вариант</button>');
    $('m-rename').onclick=async function(){var v=(prompt('Новое название:',m.name)||'').trim();if(!v||v===m.name)return;
      try{await api('PATCH','/catalog/models/'+m.id,{reqId:uid(),name:v});await loadCatalog(true);renderCatalog();showModel(m.id);}catch(e){toast(error(e));}};
    var vl=document.getElementById('var-list'); if(vl)enableDrag(vl,'.cat-var','data-vid','variants');
    body.querySelectorAll('[data-editvar]').forEach(function(b){b.onclick=function(){editVariant(m,Number(b.dataset.editvar));};});
    $('var-add').onclick=function(){editVariant(m,null);};
  }
  // редактор варианта: ВСЕ данные в одном месте (цвет/ткань, ножки, размеры, артикул, цена, фото)
  function optSelect(label,kind,value){
    var vals=optValues(kind); if(value&&vals.indexOf(value)<0)vals=vals.concat([value]);
    return '<label class="field">'+esc(label)+'<select name="opt_'+kind+'"><option value="">—</option>'+vals.map(function(v){return '<option'+(v===value?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'<option value="__new">+ добавить…</option></select></label>';
  }
  function editVariant(m,vid){
    var v=vid?cat.variants.find(function(x){return x.id===vid;}):{corpus:'',legs:'',len:'',width:'',code:'',price:null,photo:''};
    if(!v)return;
    var soft=softType(m);
    openSheet(vid?'✏️ '+m.name:'+ Вариант · '+m.name,'<form id="ev-form">'+
      (v.photo?'<img src="'+esc(v.photo)+'" alt="" style="width:96px;height:96px;border-radius:10px;object-fit:cover;margin-bottom:8px">':'')+
      '<label class="field">'+(v.photo?'Заменить фото':'Фото (JPEG/PNG/WebP до 5 МБ)')+'<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>'+
      optSelect(soft?'Ткань (подушка)':'Корпус','corpus',v.corpus)+
      optSelect('Ножки','legs',v.legs)+
      optSelect('Длина','len',v.len)+
      optSelect('Ширина','width',v.width)+
      field('Артикул','code',v.code||'','text','maxlength="120"')+
      field('Цена, ₸','price',v.price!=null?Math.round(v.price):'','number','min="0" step="1"')+
      submit(vid?'Сохранить':'Добавить вариант')+'</form>'+
      (vid?'<div style="text-align:center;margin-top:10px"><button class="ghost" id="ev-del" style="font-size:12px;color:var(--mut,#9aa0a8)">убрать вариант из каталога</button></div>':''));
    var f=$('ev-form');
    body.querySelectorAll('select[name^=opt_]').forEach(function(sel){sel.onchange=async function(){
      if(sel.value!=='__new')return;
      var kind=sel.name.slice(4), nv=(prompt('Новое значение:')||'').trim();
      if(!nv){sel.value='';return;}
      try{await api('POST','/catalog/options',{reqId:uid(),kind:kind,value:nv});await loadCatalog(true);
        var opt=document.createElement('option');opt.textContent=nv;sel.insertBefore(opt,sel.querySelector('option[value=__new]'));sel.value=nv;}
      catch(e){toast(error(e));sel.value='';}
    };});
    if($('ev-del'))$('ev-del').onclick=async function(){
      if(!confirm('Убрать этот вариант из каталога? В старых сделках он останется как был.'))return;
      try{await api('PATCH','/catalog/variants/'+vid,{reqId:uid(),archived:true});await loadCatalog(true);renderCatalog();showModel(m.id);}catch(e){toast(error(e));}
    };
    f.onsubmit=async function(e){
      e.preventDefault();
      var btn=f.querySelector('[type=submit]'); btn.disabled=true; btn.textContent='Сохраняю…';
      var errBox=f.querySelector('[data-error]'); errBox.textContent='';
      function ov(k){var sel=f.elements.namedItem('opt_'+k);return sel&&sel.value!=='__new'?sel.value:'';}
      try{
        var photo=null; var pf=f.elements.namedItem('photo').files[0];
        if(pf){ if(pf.size>5*1024*1024) throw new Error('Фото — до 5 МБ'); photo=await fileData(pf); }
        var payload={reqId:uid(),corpus:ov('corpus'),legs:ov('legs'),len:ov('len'),width:ov('width'),code:val(f,'code'),price:val(f,'price')};
        if(photo)payload.photo=photo;
        if(vid) await api('PATCH','/catalog/variants/'+vid,payload);
        else { payload.model_id=m.id; await api('POST','/catalog/variants',payload); }
        toast('Сохранено'); await loadCatalog(true); renderCatalog(); showModel(m.id);
      }catch(ex){ errBox.textContent=error(ex); btn.disabled=false; btn.textContent=vid?'Сохранить':'Добавить вариант'; }
    };
  }
  // перетаскивание: зажал лапку ✥ → двигаешь → порядок сохраняется на сервере
  function enableDrag(container,itemSel,idAttr,kind){
    var suppress=false;
    container.addEventListener('click',function(e){ if(suppress){e.stopPropagation();e.preventDefault();suppress=false;} },true);
    container.querySelectorAll('[data-drag]').forEach(function(h){
      h.style.touchAction='none';
      h.addEventListener('pointerdown',function(e){
        e.preventDefault();e.stopPropagation();
        var el=h.closest(itemSel); if(!el)return;
        var parent=el.parentNode, moved=false;
        el.classList.add('dragging');
        function move(ev){
          ev.preventDefault();
          var t=document.elementFromPoint(ev.clientX,ev.clientY);
          var over=t&&t.closest?t.closest(itemSel):null;
          if(over&&over!==el&&over.parentNode===parent){
            var r=over.getBoundingClientRect();
            var after=(ev.clientY>r.top+r.height/2)||(Math.abs(ev.clientY-(r.top+r.height/2))<r.height/2&&ev.clientX>r.left+r.width/2);
            parent.insertBefore(el, after?over.nextSibling:over);
            moved=true;
          }
        }
        function up(){
          document.removeEventListener('pointermove',move);
          document.removeEventListener('pointerup',up);
          el.classList.remove('dragging');
          if(moved){ suppress=true;
            var ids=Array.from(parent.querySelectorAll(itemSel)).map(function(x){return Number(x.getAttribute(idAttr));}).filter(Boolean);
            api('POST','/catalog/reorder',{reqId:uid(),kind:kind,ids:ids}).then(function(){loadCatalog(true);}).catch(function(e){toast(error(e));});
          }
        }
        document.addEventListener('pointermove',move);
        document.addEventListener('pointerup',up);
      });
    });
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
