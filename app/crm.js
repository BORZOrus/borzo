/* BORZO CRM — server-backed, vanilla JS. No local customer cache or demo data. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  var state={user:null,stages:[],managers:[],deals:[],clients:[],templates:[],tab:'deals',q:'',userId:null,agentGlobal:false,agentStages:{}};
  // эффективный статус агента для сделки: точечный override сделки → флаг стадии → глобальный
  // Главный тумблер = рубильник НАД всеми: выключен → агент молчит везде (состояния колонок/чатов сохраняются). Включён → работают колонки и точечные override.
  function effAgent(d){ if(state.agentGlobal!==true)return false; if(d.agent_override===true)return true; if(d.agent_override===false)return false; return state.agentStages[d.stage_code]===true; }
  // кто ведёт сделку: агент / менеджер (человек) / ещё не взято
  function leadBadge(d){
    if(effAgent(d)) return '<div class="deal-lead by-agent">🤖 Агент ведёт</div>';
    if(d.manager_id) return '<div class="deal-lead by-human">👤 '+esc(d.manager_name||'Менеджер')+'</div>';
    return '<div class="deal-lead">🆕 Не взято</div>';
  }
  // главный рубильник агента — компактная кнопка в общей полосе (тулбар), видна только на доске
  function updateMasterTop(){ var b=$('ag-master-top'); if(!b)return; var on=state.agentGlobal===true; b.hidden=(state.tab!=='deals'); b.textContent=on?'🤖 Агент ВКЛ':'🤖 Агент выкл'; b.title=on?'Агент включён (рубильник над всеми). Клик — выключить всех':'Агент выключен. Клик — включить (работают колонки/чаты, что были включены)'; b.classList.toggle('on',on); }
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
  var sheetBackPushed=false;
  function openSheet(title,html){
    if(sheet.hidden){ focusBefore=document.activeElement;
      // запоминаем «шаг» в истории, чтобы системная кнопка «назад» закрывала окно, а не уводила со страницы
      if(!sheetBackPushed){ try{ history.pushState({borzoSheet:true},''); sheetBackPushed=true; }catch(e){} }
    }
    sheetGeneration++; $('sheet-title').textContent=title; body.innerHTML=html;
    sheet.style.bottom='';   // сброс подъёма над клавиатурой от прошлого чата
    sheet.hidden=false;$('sheet-bg').hidden=false;$('app').inert=true;document.body.style.overflow='hidden';sheet.scrollTop=0;sheet.focus();
  }
  function closeSheet(fromPop){
    if(pendingMutation){ if(fromPop){ try{ history.pushState({borzoSheet:true},''); }catch(e){} } return; }
    if(uncertainMutation&&!confirm('Сервер мог сохранить действие. Лучше повторить отправку с тем же ключом. Всё равно закрыть?')){ if(fromPop){ try{ history.pushState({borzoSheet:true},''); }catch(e){} } return; }
    stopChat();uncertainMutation=false;sheetGeneration++;sheet.hidden=true;sheet.style.bottom='';$('sheet-bg').hidden=true;$('app').inert=false;document.body.style.overflow='';body.innerHTML='';
    if(focusBefore&&focusBefore.isConnected) focusBefore.focus();
    // закрыли кнопкой в интерфейсе (не системным back) → убираем наш «шаг» из истории, чтобы back потом не уводил со страницы
    if(!fromPop && sheetBackPushed){ try{ history.back(); }catch(e){} }
    sheetBackPushed=false;
  }
  // системная кнопка «назад» (Android) → закрыть открытое окно, а не уходить в прихожую
  window.addEventListener('popstate', function(){ if(!sheet.hidden){ sheetBackPushed=false; closeSheet(true); } });
  $('sheet-close').onclick=function(){ closeSheet(); };$('sheet-bg').onclick=function(){ closeSheet(); };
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
    var updEl=$('upd'); if(updEl)updEl.textContent='⟳…';
    try{
      var d=await api('GET','/deals');if(sequence!==refreshSequence)return;state.deals=d.deals;
      if(updEl)updEl.textContent=new Date().toLocaleTimeString('ru-RU',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit'});
      if(state.tab==='deals') renderDeals();
      else if(state.tab==='clients') await loadClients();
      else if(state.tab==='analytics') await renderAnalytics();
      else if(state.tab==='templates') await renderTemplates();
    }catch(e){ var st=$('status'); if(st){ st.hidden=false; st.textContent='Не удалось обновить: '+error(e); } }finally{loading=false;}
  }
  function matches(d){
    var text=[d.client_name,d.title,d.phone,d.source,d.manager_name].join(' ').toLowerCase();
    var digits=state.q.replace(/\D/g,'');
    return !state.q||text.indexOf(state.q)>=0||(digits.length>2&&String(d.phone||'').indexOf(digits)>=0);
  }
  var lastBoardQuery='';
  // «сколько прошло» человекочитаемо: мин/ч/дн
  function ago(ts){ if(!ts)return ''; var m=Math.floor((Date.now()-new Date(ts).getTime())/60000); if(m<1)return 'только что'; if(m<60)return m+' мин'; var h=Math.floor(m/60); if(h<24)return h+' ч'; return Math.floor(h/24)+' дн'; }
  // склонение: plural(1,['клиент','клиента','клиентов'])→'клиент'
  function plural(n,f){ var a=Math.abs(n)%100, n1=a%10; if(a>10&&a<20)return f[2]; if(n1>1&&n1<5)return f[1]; if(n1===1)return f[0]; return f[2]; }
  // ---- помесячные корзины ЗАКРЫТЫХ сделок (Продажа / Отказ·Игнор): тумблер месяцев в шапке колонки; аналитики тут нет (она в отдельном разделе) ----
  var MONTHS_RU=['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  function monthKey(ts){ try{ return new Date(new Date(ts).getTime()+5*3600000).toISOString().slice(0,7); }catch(e){ return ''; } } // YYYY-MM по Алматы
  function dealMonth(d){ return monthKey(d.closed_at||d.updated_at||d.created_at||Date.now()); }
  function monthLabel(key){ if(!key)return ''; var m=Number(key.slice(5,7)); return MONTHS_RU[m]+(key.slice(0,4)!==monthKey(Date.now()).slice(0,4)?' '+key.slice(0,4):''); }
  // подзаголовок колонки: количество словом (обращений/клиентов/продаж), сумма ₸ — только в «Продаже»
  // счётчик в шапке колонки = просто ЦИФРА рядом с названием (продажа — зелёная, отказ — красная, прочие — нейтральная), без слов и сумм (аналитика в отдельном разделе)
  function colCount(s,rows){
    var cls=s.is_won?'num-won':s.code==='junk'?'num-junk':s.is_lost?'num-lost':'num-def';
    return '<span class="col-num '+cls+'" title="'+esc(rows.length+' '+(s.is_won?plural(rows.length,['продажа','продажи','продаж']):s.code==='new'?plural(rows.length,['обращение','обращения','обращений']):plural(rows.length,['клиент','клиента','клиентов'])))+'">'+rows.length+'</span>';
  }
  // строка состояния лида на карточке: необработанный (в первом этапе) или ждёт нашего ответа
  function remDate(ts){ try{ return new Date(ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
  function waLine(d,s){
    // закрытая сделка (продажа/отказ), но клиент снова написал — ПИНГ, чтобы переписка не потерялась (решаем: ответить или вернуть в воронку)
    if((s.is_won||s.is_lost) && d.last_in_at && (!d.last_msg_at || new Date(d.last_in_at)>=new Date(d.last_msg_at))){
      return '<div class="deal-wa wait hot">💬 Клиент написал · '+esc(ago(d.last_in_at))+'</div>';
    }
    // на паузе: показываем напоминание, краснеет когда пора
    if(s.code==='paused'){
      if(d.remind_at){ var over=new Date(d.remind_at).getTime()<=Date.now(); return '<div class="deal-wa'+(over?' hot':' wait')+'">⏰ Напомнить · '+esc(remDate(d.remind_at))+(over?' — пора!':'')+'</div>'; }
      return '<div class="deal-wa">⏸ На паузе · напоминание не задано</div>';
    }
    // необработанный лид в первом этапе: краснеет, если висит дольше 15 мин
    if(s.code==='new'){ var mn=Math.floor((Date.now()-new Date(d.created_at).getTime())/60000); return '<div class="deal-wa unh'+(mn>15?' hot':'')+'">🔴 Необработан · '+esc(ago(d.created_at))+'</div>'; }
    // клиент написал, ждёт нашего ответа: краснеет, если ждёт дольше часа
    if(!s.is_won&&!s.is_lost&&d.last_in_at&&(!d.last_msg_at||new Date(d.last_in_at)>=new Date(d.last_msg_at))){
      var hr=(Date.now()-new Date(d.last_in_at).getTime())/3600000;
      return '<div class="deal-wa wait'+(hr>=1?' hot':'')+'">⏰ Мы не ответили · '+esc(ago(d.last_in_at))+'</div>';
    }
    // в работе и мы ответили последними: ВСЕГДА показываем, сколько клиент молчит (часы/дни), а не только после суток.
    // жёлтым после 3 часов, красным после суток — чтобы сразу видеть, кого пора дожать.
    if(!s.is_won&&!s.is_lost&&s.code!=='new'&&d.last_msg_at){
      var hrs=(Date.now()-new Date(d.last_msg_at).getTime())/3600000;
      return '<div class="deal-wa'+(hrs>=4?' hot':(hrs>=2?' wait':''))+'">⏳ Клиент молчит · '+esc(ago(d.last_msg_at))+'</div>';
    }
    // в работе, но переписки ещё не было
    if(!s.is_won&&!s.is_lost&&s.code!=='new'&&!d.last_in_at) return '<div class="deal-wa">💬 Переписки пока нет</div>';
    return '';
  }
  // десктоп: доску двигаем перетаскиванием пустого места (полоса прокрутки скрыта) + Shift+колесо вбок; на телефоне — свайп как раньше.
  // слушатели движения/отпускания — на документе ОДИН раз (без утечки при перерисовке доски), активная доска в _activeBoardDrag.
  var _activeBoardDrag=null;
  if(!window.__boardDragGlobal){ window.__boardDragGlobal=true;
    document.addEventListener('mousemove',function(e){ var s=_activeBoardDrag; if(!s||!s.down)return; var dx=e.pageX-s.sx; if(Math.abs(dx)>3)s.moved=true; s.board.scrollLeft=s.sl-dx; });
    document.addEventListener('mouseup',function(){ var s=_activeBoardDrag; if(!s||!s.down)return; s.down=false; s.board.classList.remove('grabbing'); });
  }
  function attachBoardDrag(board){
    if(!board||board._dragWired) return; board._dragWired=true;
    board.addEventListener('mousedown',function(e){ if(e.button!==0)return; if(e.target.closest('button,a,input,select,textarea,.deal'))return; _activeBoardDrag={board:board,down:true,moved:false,sx:e.pageX,sl:board.scrollLeft}; board.classList.add('grabbing'); });
    board.addEventListener('wheel',function(e){ if(e.shiftKey&&e.deltaY){ board.scrollLeft+=e.deltaY; e.preventDefault(); } },{passive:false});
  }
  function renderDeals(){
    document.body.classList.add('view-deals');   // на случай первичной отрисовки без tab()
    var oldBoard=$('main').querySelector('.board'),oldScroll=oldBoard?oldBoard.scrollLeft:0;
    // запоминаем, насколько прокручена каждая колонка — чтобы после обновления доска не прыгала вверх (где остановился — там и остался)
    var prevColScroll={}; $('main').querySelectorAll('.column[data-sid]').forEach(function(c){ prevColScroll[c.getAttribute('data-sid')]=c.scrollTop; });
    var deals=state.deals.filter(matches);
    updateMasterTop();
    // месяцы, по которым раскладываются закрытые сделки (где есть карточки) + текущий; по убыванию (свежий — первый)
    var cm={}; deals.forEach(function(d){ if(d.is_won||d.is_lost){ var k=dealMonth(d); if(k)cm[k]=true; } });
    cm[monthKey(Date.now())]=true;
    state.closedMonths=Object.keys(cm).sort().reverse();
    if(!state.closedMonth || state.closedMonths.indexOf(state.closedMonth)<0) state.closedMonth=state.closedMonths[0];
    var selIdx=state.closedMonths.indexOf(state.closedMonth);
    // есть ли «клиент написал после закрытия» в месяце, который сейчас НЕ показан → подсветим стрелку тумблера (перелистни — увидишь)
    var pingOlder=false, pingNewer=false;
    deals.forEach(function(d){ if((d.is_won||d.is_lost) && d.last_in_at && (!d.last_msg_at || new Date(d.last_in_at)>=new Date(d.last_msg_at))){ var mi=state.closedMonths.indexOf(dealMonth(d)); if(mi>selIdx)pingOlder=true; else if(mi>=0&&mi<selIdx)pingNewer=true; } });
    $('main').innerHTML='<div class="board" aria-label="Воронка сделок">'+state.stages.map(function(s){
      var rows=deals.filter(function(d){return d.stage_id===s.id;});
      // закрытые колонки показывают только выбранный месяц (тумблер в шапке переключает)
      if(s.is_won||s.is_lost){ rows=rows.filter(function(d){ return dealMonth(d)===state.closedMonth; }); }
      // клиенты, ждущие НАШЕГО ответа (написали последними), поднимаются наверх колонки; дольше ждущий — выше.
      // в закрытых (продажа/отказ) та же логика поднимает наверх тех, кто снова написал после закрытия.
      var waitR=function(d){ return d.last_in_at && (!d.last_msg_at || new Date(d.last_in_at)>=new Date(d.last_msg_at)); };
      rows=rows.slice().sort(function(a,b){ var wa=waitR(a)?0:1, wb=waitR(b)?0:1; if(wa!==wb)return wa-wb; if(wa===0)return new Date(a.last_in_at)-new Date(b.last_in_at); return 0; });
      // колонка «горит» только если главный включён И стадия включена
      var agOn=state.agentGlobal===true && state.agentStages[s.code]===true;
      // тумблер месяцев — только в закрытых колонках (Продажа / Отказ·Игнор)
      var mTog=(s.is_won||s.is_lost)?
        '<div class="col-month"><button class="cm-nav" data-cm="older"'+(selIdx>=state.closedMonths.length-1?' disabled':'')+' aria-label="Раньше">'+(pingOlder?'<span class="cm-ping"></span>':'')+'‹</button><span class="cm-lbl">'+esc(monthLabel(state.closedMonth))+'</span><button class="cm-nav" data-cm="newer"'+(selIdx<=0?' disabled':'')+' aria-label="Позже">›'+(pingNewer?'<span class="cm-ping"></span>':'')+'</button></div>':'';
      return '<section class="column '+(s.is_won?'won':s.code==='junk'?'junk':s.is_lost?'lost':'')+'" data-sid="'+s.id+'"><header class="col-head"><div class="col-top"><h2><span class="dot"></span>'+esc(s.name)+'</h2>'+colCount(s,rows)+'<button class="col-ag'+(agOn?' on':'')+'" data-agstage="'+esc(s.code)+'" title="Агент на этой стадии: '+(agOn?'вкл':'выкл')+'">🤖</button></div>'+mTog+'</header>'+rows.map(function(d){
        var days=d.stage_entered_at?Math.max(0,Math.floor((Date.now()-new Date(d.stage_entered_at).getTime())/86400000))+' дн. в этапе':'Срок неизвестен';
        var badge=Number(d.wa_unread)>0?' <span class="wa-badge">'+esc(d.wa_unread)+'</span>':'';
        var take='';   // кнопка «Взять в работу» убрана: стрелка ▶ двигает по воронке и сама переводит в работу (назначает менеджера)
        // одна кнопка-башка на карточке: зелёная = агент реально работает тут, серая = нет (учитывает главный рубильник)
        var work=effAgent(d);
        var agBtn='<button class="deal-ag'+(work?' on':'')+'" data-agdeal="'+esc(d.id)+'" title="Агент в этом чате: '+(work?'работает':'не работает')+' (клик меняет)">🤖</button>';
        var amt=Number(d.amount)||0;
        var amtHtml=amt>0?'<div class="amount">'+esc(money(amt))+'</div>':'';
        // «тема сделки» показываем, только если она осмысленная (не дублирует имя клиента)
        var dt=(d.title||'').trim();
        var dtHtml=(dt && dt.toLowerCase()!==String(d.client_name||'').trim().toLowerCase())?'<div class="deal-title">'+esc(dt)+'</div>':'';
        // закрытая сделка (продажа/отказ): вместо ◀этап▶ — одна кнопка «вернуть клиента в работу/продажу»
        var moveRow=(s.is_won||s.is_lost)
          ? '<div class="deal-move"><button class="reopen-btn" data-reopen="'+esc(d.id)+'">↩ Вернуть клиента</button></div>'
          : '<div class="deal-move"><button class="mv-btn" data-mv="'+esc(d.id)+'|-1" aria-label="Влево">◀</button><button class="stage-btn" data-move="'+esc(d.id)+'">этап</button><button class="mv-btn" data-mv="'+esc(d.id)+'|1" aria-label="Вправо">▶</button></div>';
        return '<article class="deal">'+agBtn+'<button class="deal-open" data-deal="'+esc(d.id)+'"><strong>'+esc(d.client_name)+badge+'</strong>'+dtHtml+amtHtml+waLine(d,s)+'<div class="deal-foot"><span>'+esc(d.source||'Без источника')+'</span><span>'+esc(days)+'</span></div>'+leadBadge(d)+'</button>'+take+moveRow+'</article>';
      }).join('')+(rows.length?'':'<div class="empty">'+(state.q?'Нет совпадений':'Пока нет сделок')+'</div>')+'</section>';
    }).join('')+'</div>';
    var board=$('main').querySelector('.board');
    if(state.q&&state.q!==lastBoardQuery){var first=board.querySelector('.deal');if(first)board.scrollLeft=first.parentElement.offsetLeft-16;}
    else board.scrollLeft=oldScroll;lastBoardQuery=state.q;
    // возвращаем вертикальную прокрутку каждой колонки на место (не прыгаем вверх при авто-обновлении/закрытии карточки)
    board.querySelectorAll('.column[data-sid]').forEach(function(c){ var v=prevColScroll[c.getAttribute('data-sid')]; if(v)c.scrollTop=v; });
    attachBoardDrag(board);
    bindDeals($('main'));
  }
  // (устар.) панель управления агентом целиком — заменена мини-тумблерами на колонках; оставлена на всякий
  function openAgentPanel(){
    function render(){
      var stages=state.stages.map(function(s){
        var v=state.agentStages[s.code]; // undefined=по глобалу, true=вкл, false=выкл
        function b(val,lbl){ var on=(val==='inherit'&&v===undefined)||(val==='on'&&v===true)||(val==='off'&&v===false); return '<button class="seg-b'+(on?' on':'')+'" data-stage="'+esc(s.code)+'" data-val="'+val+'">'+lbl+'</button>'; }
        return '<div class="ag-strow"><div class="ag-stname">'+esc(s.name)+'</div><div class="seg">'+b('inherit','Глобал')+b('on','Вкл')+b('off','Выкл')+'</div></div>';
      }).join('');
      body.innerHTML='<p class="hint">Порядок старшинства: <b>точечно в чате</b> → по стадии → глобально. В чате можно перекрыть для одного клиента.</p>'+
        '<h3>Глобально (все чаты)</h3><div class="seg"><button class="seg-b'+(state.agentGlobal?' on':'')+'" data-g="on">Вкл всем</button><button class="seg-b'+(!state.agentGlobal?' on':'')+'" data-g="off">Выкл всем</button></div>'+
        '<h3>По стадиям воронки</h3>'+stages+
        '<p class="hint">Пока WhatsApp не подключён, тумблеры настраиваются впрок — агент начнёт отвечать после переезда.</p>';
      body.querySelectorAll('[data-g]').forEach(function(bt){bt.onclick=async function(){ try{ var r=await api('POST','/agent-settings',{reqId:uid(),global:bt.dataset.g==='on'}); state.agentGlobal=r.agentGlobal; state.agentStages=r.agentStages||{}; render(); if(state.tab==='deals')renderDeals(); }catch(e){toast(error(e));} };});
      body.querySelectorAll('[data-stage]').forEach(function(bt){bt.onclick=async function(){ var val=bt.dataset.val; try{ var r=await api('POST','/agent-settings',{reqId:uid(),stageCode:bt.dataset.stage,value:val==='inherit'?'inherit':(val==='on')}); state.agentGlobal=r.agentGlobal; state.agentStages=r.agentStages||{}; render(); if(state.tab==='deals')renderDeals(); }catch(e){toast(error(e));} };});
    }
    openSheet('🤖 Управление агентом','<div class="empty">…</div>');
    render();
  }
  function bindDeals(root){
    root.querySelectorAll('[data-deal]').forEach(function(b){b.onclick=function(){showDeal(b.dataset.deal);};});
    // возврат закрытого клиента (кнопка «↩ Вернуть клиента» на закрытой карточке)
    root.querySelectorAll('[data-reopen]').forEach(function(b){b.onclick=function(e){ e.stopPropagation(); var d=state.deals.find(function(x){return String(x.id)===String(b.dataset.reopen);}); if(d)reopenDeal(d); };});
    // тумблер месяцев в закрытых колонках: older=раньше, newer=позже (месяцы отсортированы по убыванию)
    root.querySelectorAll('[data-cm]').forEach(function(b){b.onclick=function(e){
      e.stopPropagation();
      var i=state.closedMonths.indexOf(state.closedMonth);
      if(b.dataset.cm==='older'&&i<state.closedMonths.length-1)state.closedMonth=state.closedMonths[i+1];
      else if(b.dataset.cm==='newer'&&i>0)state.closedMonth=state.closedMonths[i-1];
      renderDeals();
    };});
    root.querySelectorAll('[data-move]').forEach(function(b){b.onclick=function(){showStage(b.dataset.move);};});
    // «взять в работу»: назначить лида на себя и перевести из «Новой заявки» в «В работе»
    root.querySelectorAll('[data-take]').forEach(function(b){b.onclick=async function(e){
      e.stopPropagation();
      var d=state.deals.find(function(x){return String(x.id)===b.dataset.take;});
      var working=state.stages.find(function(s){return s.code==='working';})||state.stages.find(function(s){return !s.is_won&&!s.is_lost&&s.code!=='new';});
      if(!d||!working)return;
      b.disabled=true;
      try{
        var r1=await api('PATCH','/deals/'+d.id,{baseRev:d.rev,manager_id:state.userId});
        await api('POST','/deals/'+d.id+'/stage',{reqId:uid(),baseRev:r1.deal.rev,stage_id:working.id});
        toast('Взято в работу'); await reload();
      }catch(err){ toast(error(err)); b.disabled=false; }
    };});
    // перемещение карточки по воронке влево/вправо на одну стадию
    root.querySelectorAll('[data-mv]').forEach(function(b){b.onclick=async function(e){
      e.stopPropagation();
      var p=b.dataset.mv.split('|'), id=p[0], dir=Number(p[1]);
      var d=state.deals.find(function(x){return String(x.id)===String(id);}); if(!d)return;
      var idx=-1; state.stages.forEach(function(s,i){if(s.id===d.stage_id)idx=i;});
      var target=state.stages[idx+dir]; if(!target)return;
      if(target.is_won){ showSale(d.id); return; }
      if(target.is_lost){ askLost(d); return; }
      if(target.code==='paused'){ askPause(d); return; }
      b.disabled=true;
      try{ await api('POST','/deals/'+d.id+'/stage',{reqId:uid(),baseRev:d.rev,stage_id:target.id}); toast('Этап: '+target.name); await reload(); }
      catch(err){ toast(error(err)); b.disabled=false; }
    };});
    // мини-тумблер агента на колонке (стадии)
    root.querySelectorAll('[data-agstage]').forEach(function(b){b.onclick=async function(e){
      e.stopPropagation();
      var code=b.dataset.agstage, val=!(state.agentStages[code]===true);
      try{ var r=await api('POST','/agent-settings',{reqId:uid(),stageCode:code,value:val}); state.agentGlobal=r.agentGlobal; state.agentStages=r.agentStages||{}; if(state.tab==='deals')renderDeals(); }
      catch(err){ toast(error(err)); }
    };});
    // точечный тумблер агента на карточке: по воронке → вкл → выкл → по воронке
    root.querySelectorAll('[data-agdeal]').forEach(function(b){b.onclick=async function(e){
      e.stopPropagation();
      var d=state.deals.find(function(x){return String(x.id)===String(b.dataset.agdeal);}); if(!d)return;
      var next=d.agent_override==null?'on':(d.agent_override===true?'off':'inherit');
      try{ var r=await api('POST','/deals/'+d.id+'/agent',{reqId:uid(),mode:next}); d.agent_override=(r&&'agent_override' in r)?r.agent_override:(next==='on'?true:next==='off'?false:null); if(state.tab==='deals')renderDeals(); }
      catch(err){ toast(error(err)); }
    };});
  }
  function clientForm(c){return field('Имя клиента','name',c.name,'text','required maxlength="200" autocomplete="name"')+field('Телефон','phone',c.phone,'tel','autocomplete="tel" placeholder="+7 700 000 00 00"')+field('Город','city',c.city,'text','maxlength="100"')+field('Адрес доставки','address',c.address,'text','maxlength="300"')+field('Instagram','instagram',c.instagram,'text','maxlength="200"')+source(c.source)+area('Заметка о клиенте','note',c.note);}
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
  var chatTimer=null, chatDealId=null, chatLastEventId=0, waConnected=false, waChecked=false;
  function stopChat(){ clearTimeout(chatTimer); chatTimer=null; chatDealId=null; var p=document.getElementById('scr-panel'); if(p)p.remove(); }
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
    var prev=String(inc?m:t).replace(/\s+/g,' ').slice(0,60);
    return '<div class="wa-row '+(inc?'in':'out')+'" data-rw="" data-rt="'+esc(prev)+'"><div class="wa-b">'+esc(inc?m:t)+
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
  // галочки статуса исходящего WhatsApp
  function tickOf(s){ if(s==='read')return '<span class="wa-tick read">✓✓</span>'; if(s==='delivered')return '<span class="wa-tick">✓✓</span>'; if(s==='failed')return '<span class="wa-tick err">⚠</span>'; return '<span class="wa-tick">✓</span>'; }
  // отрисовка скачанного вложения по mime
  // иконки плеера
  var AUD_PLAY='<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
  var AUD_PAUSE='<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  function fmtDur(s){ s=Math.max(0,Math.floor(s||0)); var m=Math.floor(s/60), ss=s%60; return m+':'+(ss<10?'0':'')+ss; }
  // «волна» из палочек как в WhatsApp: форма детерминирована по url (не прыгает при перерисовке)
  function waWaveBars(url){
    var seed=0, i; for(i=0;i<url.length;i++) seed=(seed*31+url.charCodeAt(i))>>>0;
    function rnd(){ seed=(seed*1103515245+12345)>>>0; return (seed>>>16)/65535; }
    var N=32, h='';
    for(i=0;i<N;i++){ h+='<i style="height:'+(22+Math.round(rnd()*78))+'%"></i>'; }
    return h;
  }
  // кэш распознанного/переведённого голоса по id сообщения (чтобы не пропадал при перерисовке)
  var waTrCache={};
  function trHtml(o){ return '<div class="wa-tr-ru">'+esc(o.ru||'')+'</div>'+((o.transcript&&o.transcript!==o.ru)?'<div class="wa-tr-or">'+esc(o.transcript)+'</div>':''); }
  // плеер голосового как в WhatsApp: один тап — играет; волна-палочки с перемоткой, время, скорость. Файл грузится сам (preload=metadata).
  // + маленькая кнопка «перевод» (распознать голос и перевести на русский), не увеличивает плашку, пока не нажали
  function waAudioPlayer(url,msgId){
    var player='<div class="wa-aud">'+
      '<button class="wa-aud-play" data-audplay type="button" aria-label="Слушать">'+AUD_PLAY+'</button>'+
      '<div class="wa-aud-wave" data-audbar data-n="32">'+waWaveBars(url)+'</div>'+
      '<span class="wa-aud-cur">0:00</span>'+
      '<button class="wa-aud-rate" data-audrate type="button">1×</button>'+
      '<audio preload="metadata" src="'+esc(url)+'"></audio>'+
    '</div>';
    if(!msgId) return player;
    var cached=waTrCache[msgId];
    return player+'<button class="wa-trbtn" data-trmsg="'+esc(msgId)+'" type="button" title="Распознать и перевести на русский">🌐 перевод</button>'+
      '<div class="wa-trtext" data-trtext="'+esc(msgId)+'"'+(cached?'':' hidden')+'>'+(cached?trHtml(cached):'')+'</div>';
  }
  function waMediaView(url,mime,msgId){
    mime=mime||'';
    if(/^image\//.test(mime)) return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer"><img class="wa-img" src="'+esc(url)+'" alt="фото"></a>';
    if(/^audio\//.test(mime)) return waAudioPlayer(url,msgId);
    if(/^video\//.test(mime)) return '<video class="wa-img" controls preload="none" src="'+esc(url)+'"></video>';
    return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">📄 Открыть вложение</a>';
  }
  // не-текстовое сообщение: если уже скачано — плеер, иначе ярлык + кнопка «Загрузить»
  function waMediaLabel(m){
    var lbl=({audio:'🎤 Голосовое',voice:'🎤 Голосовое',image:'🖼 Фото',video:'🎬 Видео',document:'📄 Документ',sticker:'🩷 Стикер'})[m.type]||('📎 '+esc(m.type||'файл'));
    if(m.media_url) return waMediaView(m.media_url,m.mime||({image:'image/',audio:'audio/',video:'video/'}[m.type]||''),m.id)+(m.caption?'<div>'+esc(m.caption)+'</div>':'');
    return lbl+(m.caption?': '+esc(m.caption):'')+(m.media_id?' <button class="wa-load" data-media="'+esc(m.id)+'">▶ Загрузить</button>':'');
  }
  // пузырь реального WhatsApp-сообщения
  function mediaWord(t){ return ({image:'🖼 Фото',audio:'🎤 Голосовое',voice:'🎤 Голосовое',video:'🎬 Видео',document:'📄 Документ',sticker:'🩷 Стикер'})[t]||'📎 Вложение'; }
  // текст сообщения → экранируем, затем делаем URL кликабельными ссылками
  function linkify(raw){
    return esc(raw||'').replace(/(https?:\/\/[^\s<]+)/g,function(u){
      var tail='', m=u.match(/[)\].,!?:;]+$/); if(m){ tail=m[0]; u=u.slice(0,-tail.length); }
      return '<a href="'+u+'" target="_blank" rel="noopener noreferrer" class="wa-link">'+u+'</a>'+tail;
    });
  }
  // входящие вложения (фото/голосовое клиента) скачиваем САМИ при открытии чата — без кнопки «Загрузить»
  var waMediaAuto={};
  function autoLoadMedia(){
    var log=document.getElementById('ch-log'); if(!log) return;
    Array.prototype.forEach.call(log.querySelectorAll('[data-media]'),function(b){
      var id=b.dataset.media; if(!id||waMediaAuto[id])return; waMediaAuto[id]=1;
      b.textContent='Загрузка…'; b.disabled=true;
      API.waMedia(id).then(function(r){ var wrap=b.closest('.wa-b'); if(!wrap)return; var meta=wrap.querySelector('.wa-meta'), rb=wrap.querySelector('.wa-reply'), q=wrap.querySelector('.wa-quote'); wrap.innerHTML=(rb?rb.outerHTML:'')+(q?q.outerHTML:'')+waMediaView(r.url,r.mime||'',id)+(meta?meta.outerHTML:''); var na=wrap.querySelector('.wa-aud audio'); if(na)initAudioEl(na); })
        .catch(function(){ waMediaAuto[id]=0; if(b.isConnected){ b.disabled=false; b.textContent='▶ Загрузить'; } });
    });
  }
  // показать ДЛИТЕЛЬНОСТЬ голосового до воспроизведения (у ogg/opus браузер часто отдаёт Infinity — форсируем вычисление сдвигом в конец)
  function initAudioEl(au){
    if(!au||au._durInit) return; au._durInit=true;
    var box=au.closest('.wa-aud'), cur=box&&box.querySelector('.wa-aud-cur');
    function showTotal(){ if(cur && au.paused && isFinite(au.duration) && au.duration>0) cur.textContent=fmtDur(au.duration); }
    au.addEventListener('loadedmetadata',function(){
      if(!isFinite(au.duration) || au.duration===Infinity){ try{ au.currentTime=1e101; }catch(e){}
        au.addEventListener('timeupdate',function h(){ au.removeEventListener('timeupdate',h); try{ au.currentTime=0; }catch(e){} showTotal(); });
      } else showTotal();
    });
    if(au.readyState>=1) showTotal();
  }
  function initAudioDurations(){ var log=document.getElementById('ch-log'); if(!log)return; Array.prototype.forEach.call(log.querySelectorAll('.wa-aud audio'),initAudioEl); }
  // перевод всего чата на русский по кнопке 🌐: кэш переводов по wamid, оригинал по повторному нажатию
  var chTr=false, chTrCache={}, chLastEvs=[], chLastMsgs=[];
  function chRenderLog(){
    var lg=document.getElementById('ch-log'); if(!lg) return;
    var atB=lg.scrollHeight-lg.scrollTop-lg.clientHeight<60;
    lg.innerHTML=renderTimeline(buildTimeline(chLastEvs,chLastMsgs));
    autoLoadMedia(); initAudioDurations();
    if(atB)lg.scrollTop=lg.scrollHeight;
  }
  async function chDoTranslate(){
    if(!chTr){ chRenderLog(); return; }
    var need=[], keys=[];
    (chLastMsgs||[]).forEach(function(m){ if(m && m.type==='text' && m.text && m.wamid && chTrCache[m.wamid]==null){ need.push(m.text); keys.push(m.wamid); } });
    if(need.length){
      try{ var r=await API.crm('POST','/translate',{texts:need,to:'ru'}); var tr=(r&&r.translations)||[];
        keys.forEach(function(k,i){ chTrCache[k]=(tr[i]!=null?tr[i]:''); }); }
      catch(e){ toast('Не удалось перевести'); }
    }
    chRenderLog();
  }
  function waBubble(m, byW){
    var inc=m.direction==='in';
    var trd=(chTr && m.type==='text' && m.wamid && chTrCache[m.wamid]!=null);
    var bodyHtml=m.type==='text'?linkify(trd?chTrCache[m.wamid]:(m.text||'')):waMediaLabel(m);
    // на какое сообщение ответили: берём текст цитаты; если его нет — находим исходное по wamid и показываем его текст/тип (фото/голосовое)
    var quote='';
    if(m.reply_to){
      var o=(byW&&byW[m.reply_to])||null;
      // подпись цитаты: текст / «🖼 Фото · подпись» / «🎤 Голосовое» и т.п.
      var label = m.reply_text ? esc(m.reply_text)
        : (o ? ((o.type&&o.type!=='text') ? esc(mediaWord(o.type))+(o.caption?' · '+esc(String(o.caption).slice(0,60)):'') : esc(String(o.text||'').replace(/\s+/g,' ').slice(0,80)))
             : 'сообщение');
      // миниатюра, если ответили на фото
      var thumb=(o && o.type==='image' && o.media_url) ? '<img class="wa-quote-thumb" src="'+esc(o.media_url)+'" alt="">' : '';
      // кликабельна (переход к исходному), если исходное есть в ленте
      var jump=o?(' wa-quote-link" data-jump="'+esc(m.reply_to)):'';
      quote='<div class="wa-quote'+jump+'">'+thumb+'<span class="wa-quote-tx">↩ '+label+'</span></div>';
    }
    var prev=String(m.text||m.caption||m.type||'').replace(/\s+/g,' ').slice(0,60);
    return '<div class="wa-row '+(inc?'in':'out')+'" data-wamid="'+esc(m.wamid||'')+'" data-rw="'+esc(m.wamid||'')+'" data-rt="'+esc(prev)+'"><div class="wa-b">'+quote+bodyHtml+
      '<span class="wa-meta">'+(trd?'🌐 ':'')+chTime(m.ts)+(inc?'':' '+tickOf(m.status))+'</span>'+(m.reaction?'<span class="wa-react-badge">'+esc(m.reaction)+'</span>':'')+'</div></div>';
  }
  // единая лента: заметки/статусы (crm_events) + реальные сообщения (wa_messages), по времени
  function buildTimeline(evs, msgs){
    var items=[];
    var byW={}; (msgs||[]).forEach(function(m){ if(m.wamid) byW[m.wamid]=m; });   // карта wamid→сообщение, чтобы раскрыть цитату ответа
    evs.forEach(function(e){ items.push({ ts:new Date(e.ts).getTime(), html:bubble(e) }); });
    (msgs||[]).forEach(function(m){ var t=Number(m.ts)||0; items.push({ ts:t, html:waBubble(Object.assign({},m,{ts:t}), byW) }); });
    items.sort(function(a,b){ return a.ts-b.ts; });
    return items;
  }
  function renderTimeline(items){
    var out='',lastDay='';
    items.forEach(function(it){
      var d=chDay(it.ts);
      if(d!==lastDay){ out+='<div class="wa-sys"><span class="wa-day">'+esc(chDayLabel(it.ts))+'</span></div>'; lastDay=d; }
      out+=it.html;
    });
    return out||'<div class="wa-sys"><span>Пока нет сообщений</span></div>';
  }
  // подпись изменения ленты, чтобы перерисовывать только при новых данных
  function chatSig(evs, msgs){ return (evs.length?evs[evs.length-1].id:0)+'|'+(msgs?msgs.length:0)+'|'+(msgs&&msgs.length?(msgs[msgs.length-1].status||''):''); }
  // ---------- скрипты продаж: панель-конструктор «Магистраль + Инструменты» (по кнопке 📋) ----------
  var scriptsCache=null, scriptsRev=0, scriptsLoading=null, scrTab='main', scrEdit=false, scrDealId=null, scrOpenBlock=null, scrLang='ru';
  // текст сообщения в текущем языке скрипта (kz → text_kz, с откатом на русский если перевода нет)
  function mViewText(m){ return (scrLang==='kz') ? ((m.text_kz&&String(m.text_kz).trim())?m.text_kz:(m.text||'')) : (m.text||''); }
  function mEditText(m){ return (scrLang==='kz') ? (m.text_kz||'') : (m.text||''); }        // для правки — именно поле языка (пусто, если не заполнено)
  function setMText(m,val){ if(scrLang==='kz') m.text_kz=val; else m.text=val; }
  // подпись вложения в текущем языке (kz → title_kz, откат на русскую)
  function aTitle(a){ return (scrLang==='kz') ? ((a.title_kz&&String(a.title_kz).trim())?a.title_kz:(a.title||'')) : (a.title||''); }
  function setATitle(a,val){ if(scrLang==='kz') a.title_kz=val; else a.title=val; }
  // аккордеон: открыт только ОДИН блок за раз; имя открытого — в scrOpenBlock, чтобы переживать перерисовку (правка/готово/сохранение)
  function scrOpenOne(name){
    var host=$('scr-body'); if(!host) return;
    host.querySelectorAll('.scr-b-body').forEach(function(b){ b.hidden=true; b.innerHTML=''; });
    host.querySelectorAll('.scr-b-head').forEach(function(h){ h.classList.remove('open'); });
    var body=host.querySelector('[data-body="'+cssq(name)+'"]');
    if(body){ body.innerHTML=scrBlockBody(name); body.hidden=false; scrOpenBlock=name;
      var row=body.closest('.scr-block'); var hd=row&&row.querySelector('.scr-b-head'); if(hd)hd.classList.add('open');
      // подтянуть открытый блок к верху, чтобы сразу видеть его начало
      if(row){ try{ var hr=host.getBoundingClientRect(), rr=row.getBoundingClientRect(); host.scrollTo({top: host.scrollTop + (rr.top - hr.top) - 4, behavior:'smooth'}); }catch(e){ row.scrollIntoView(); } }
    }
  }
  function scrCloseOne(name){
    var host=$('scr-body'); if(!host) return;
    var body=host.querySelector('[data-body="'+cssq(name)+'"]'); if(body){ body.hidden=true; body.innerHTML=''; }
    var row=body&&body.closest('.scr-block'); var hd=row&&row.querySelector('.scr-b-head'); if(hd)hd.classList.remove('open');
    if(scrOpenBlock===name) scrOpenBlock=null;
  }
  function loadScripts(force){
    if(scriptsCache&&!force) return Promise.resolve(scriptsCache);
    if(scriptsLoading) return scriptsLoading;
    scriptsLoading=api('GET','/scripts').then(function(r){ scriptsCache=(r.data&&typeof r.data==='object')?r.data:{blocks:{},mainOrder:[],sectionOrder:[],sections:{}}; if(!scriptsCache.blocks)scriptsCache.blocks={}; if(!scriptsCache.sections)scriptsCache.sections={}; scriptsRev=r.rev||0; scriptsLoading=null; return scriptsCache; }).catch(function(e){ scriptsLoading=null; throw e; });
    return scriptsLoading;
  }
  function cssq(s){ return String(s).replace(/["\\]/g,'\\$&'); }
  function scrClose(){ var p=$('scr-panel'); if(p)p.remove(); }
  // защита от дурака: если открыт редактор ТЕКСТА сообщения с несохранёнными правками — при ✕ спросить (всё остальное — фото/ссылки/ярлыки — сохраняется сразу)
  function scrChangedTextareas(){
    var host=$('scr-body'); if(!host) return [];
    var out=[];
    Array.prototype.forEach.call(host.querySelectorAll('.scr-ta'),function(ta){
      var wrap=ta.closest('[data-msgwrap]'); if(!wrap) return;
      var k=(wrap.getAttribute('data-msgwrap')||'').split('|'), block=k[0], mi=Number(k[1]);
      var msg=(scriptsCache&&scriptsCache.blocks[block]&&scriptsCache.blocks[block].messages[mi]); if(!msg) return;
      if(ta.value!==mEditText(msg)) out.push({ta:ta,block:block,mi:mi});
    });
    return out;
  }
  async function scrTryClose(){
    var ch=scrChangedTextareas();
    if(ch.length){
      if(confirm('Есть несохранённые изменения текста ('+ch.length+' шт.). Сохранить перед выходом?')){
        ch.forEach(function(c){ setMText(scriptsCache.blocks[c.block].messages[c.mi], c.ta.value); });
        if(scrLang==='ru') await autoTranslateKz(ch.map(function(c){ return scriptsCache.blocks[c.block].messages[c.mi]; }));   // правили русский → обновляем казахский
        if(!(await saveScripts())){ toast('Не удалось сохранить — проверьте связь'); return; }  // остаёмся, не теряем
        toast('Сохранено');
      }
    }
    scrClose();
  }
  // подсветить и прокрутить к только что добавленному вложению, чтобы было видно сразу
  function scrFlashAtt(block,mi){
    var body=$('scr-body'); if(!body) return;
    var wrap=body.querySelector('[data-msgwrap="'+cssq(block+'|'+mi)+'"]'); if(!wrap) return;
    var atts=wrap.querySelector('.scr-atts'), last=atts&&atts.lastElementChild;
    try{ (last||wrap).scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){ (last||wrap).scrollIntoView(); }
    if(last){ last.classList.add('scr-att-new'); setTimeout(function(){ last.classList.remove('scr-att-new'); },1600); }
  }
  function scrInsert(text){ var ta=$('ch-text'); if(ta){ ta.value=(ta.value?ta.value+'\n':'')+text; ta.focus(); try{ ta.dispatchEvent(new Event('input')); }catch(e){} } scrClose(); }
  // авто-перевод RU→KZ: правим русский текст скрипта → казахская версия (text_kz) сама обновляется.
  // батч одним запросом; бренды защищены на сервере (Kaspi не станет Caspian). Перевод не критичен: если упал — RU всё равно сохранится.
  async function autoTranslateKz(msgs){
    var list=(msgs||[]).filter(function(m){ return m && String(m.text||'').trim(); });
    if(!list.length) return;
    try{
      var r=await api('POST','/translate',{texts:list.map(function(m){return m.text;}),to:'kz'});
      var tr=(r&&r.translations)||[];
      list.forEach(function(m,i){ if(tr[i]!=null && String(tr[i]).trim()) m.text_kz=String(tr[i]); });
    }catch(e){ /* молча: KZ догонит при следующей правке, RU не теряем */ }
  }
  // сохранить всю базу скриптов (compare-and-swap); при конфликте перечитать
  async function saveScripts(){
    try{ var r=await api('PUT','/scripts',{reqId:uid(),data:scriptsCache,baseRev:scriptsRev}); scriptsRev=r.rev; return true; }
    catch(e){ if(e&&e.status===409){ toast('Скрипты изменили в другом месте — обновляю'); await loadScripts(true).catch(function(){}); scrRenderBody(); } else toast(error(e)); return false; }
  }
  // отправить текст клиенту по текущей сделке (реально через WhatsApp или заметкой до переезда)
  async function scrSend(text){
    if(!text||!scrDealId) return false;
    try{ if(waConnected){ await API.waSend({deal_id:scrDealId,text:text,reqId:uid()}); } else { await api('POST','/deals/'+scrDealId+'/events',{reqId:uid(),kind:'msg',text:text}); } return true; }
    catch(e){ if(e&&e.status===503){ try{ await api('POST','/deals/'+scrDealId+'/events',{reqId:uid(),kind:'msg',text:text}); return true; }catch(_){ toast(error(e)); return false; } } else { toast(error(e)); return false; } }
  }
  // отправка ФОТО из скрипта клиенту в WhatsApp (вложение уже загружено, a.value = ссылка /uploads)
  async function scrSendMedia(url, caption){
    if(!url||!scrDealId) return false;
    if(!waConnected){ toast('WhatsApp не подключён — фото пока не отправить'); return false; }
    try{ await API.waSend({deal_id:scrDealId, media:url, media_type:'image', caption:caption, reqId:uid()}); toast('Фото отправлено'); return true; }
    catch(e){ toast(error(e)); return false; }
  }
  // визуальный отклик кнопки отправки: вдавливание на время отправки → галочка ✓ при успехе
  function scrBtnSend(btn, promise){
    if(!btn){ return; }
    btn.classList.add('scr-sending'); btn.disabled=true;
    Promise.resolve(promise).then(function(ok){ btn.classList.remove('scr-sending'); btn.disabled=false;
      if(ok!==false){ btn.classList.add('scr-sent'); setTimeout(function(){ btn.classList.remove('scr-sent'); },2200); } });
  }
  // перерисовать тело раскрытого блока после изменения
  function scrReopen(block){ var body=$('scr-body')&&$('scr-body').querySelector('[data-body="'+cssq(block)+'"]'); if(body){ body.innerHTML=scrBlockBody(block); body.hidden=false; scrOpenBlock=block; var row=body.closest('.scr-block'); var hd=row&&row.querySelector('.scr-b-head'); if(hd)hd.classList.add('open'); } }
  // вложение: превью + подпись + отправка (фото — после переезда) + удаление в режиме правки
  function scrAttHtml(block,mi,ai){
    var a=(scriptsCache.blocks[block].messages[mi].attachments||[])[ai]||{};
    var capTxt=aTitle(a); var cap=capTxt?'<div class="scr-att-cap">'+esc(capTxt)+'</div>':'';
    var body=a.type==='image'?'<img class="scr-att-img" src="'+esc(a.value||'')+'">':'<div class="scr-att-link">🔗 '+esc(a.value||'')+'</div>';
    var send='<button class="scr-att-send" data-act="send-att" data-k="'+esc(block)+'|'+mi+'|'+ai+'">'+(a.type==='image'?'Отправить':'Ссылка')+'</button>';
    var del=scrEdit?'<button class="scr-mini danger" data-act="del-att" data-k="'+esc(block)+'|'+mi+'|'+ai+'" style="min-height:0;padding:5px 7px">🗑</button>':'';
    return '<div class="scr-att">'+body+cap+'<div class="scr-att-act">'+send+del+'</div></div>';
  }
  // карточка сообщения: ярлык, текст, вложения, кнопки, (в правке) редактирование
  function scrMsgHtml(block,mi){
    var m=scriptsCache.blocks[block].messages[mi]||{attachments:[]};
    var atts=(m.attachments||[]).map(function(_,ai){return scrAttHtml(block,mi,ai);}).join('');
    atts=atts?'<div class="scr-atts">'+atts+'</div>':'';
    var act='<div class="scr-msg-act"><button class="scr-ins" data-act="send-msg" data-k="'+esc(block)+'|'+mi+'">Отправить</button><button class="scr-edit" data-act="ins-msg" data-k="'+esc(block)+'|'+mi+'">Вставить</button></div>';
    if(scrEdit){
      // ярлык с маленьким карандашиком рядом (или «+ ярлык», если пусто)
      var lbl = m.label
        ? '<div class="scr-msg-lbl">'+esc(m.label)+' <button class="scr-mini scr-lbl-edit" data-act="edit-label" data-k="'+esc(block)+'|'+mi+'" title="Изменить ярлык">✎</button></div>'
        : '<div class="scr-msg-lbl"><button class="scr-mini" data-act="edit-label" data-k="'+esc(block)+'|'+mi+'">+ ярлык</button></div>';
      // текст сразу редактируемый + «Сохранить» под ним
      var textEdit = '<textarea class="scr-ta" data-ta="'+esc(block)+'|'+mi+'" placeholder="'+(scrLang==='kz'?'Қазақша мәтін':'Текст на русском')+'">'+esc(mEditText(m))+'</textarea>'+
        '<div class="scr-msg-act"><button class="scr-save" data-act="save-text" data-k="'+esc(block)+'|'+mi+'">💾 Сохранить</button></div>';
      // снизу только + фото, + ссылка и удаление сообщения
      var editRow='<div class="scr-edit-row">'+
        '<button class="scr-mini" data-act="add-img" data-k="'+esc(block)+'|'+mi+'">+ фото</button>'+
        '<button class="scr-mini" data-act="add-link" data-k="'+esc(block)+'|'+mi+'">+ ссылка</button>'+
        '<button class="scr-mini danger" data-act="del-msg" data-k="'+esc(block)+'|'+mi+'">🗑 сообщение</button></div>';
      return '<div class="scr-msg" data-msgwrap="'+esc(block)+'|'+mi+'">'+lbl+textEdit+atts+editRow+'</div>';
    }
    return '<div class="scr-msg" data-msgwrap="'+esc(block)+'|'+mi+'">'+
      (m.label?'<div class="scr-msg-lbl">'+esc(m.label)+'</div>':'')+
      '<div class="scr-msg-text">'+esc(mViewText(m))+'</div>'+atts+act+'</div>';
  }
  // тело блока: пояснение/подсказка + сообщения (+ в правке добавление сообщения)
  function scrBlockBody(block){
    var b=scriptsCache.blocks[block]||{messages:[]};
    function meta(field,icon,cls){
      if(b[field]) return '<div class="'+cls+'">'+icon+' '+esc(b[field])+(scrEdit?' <button class="scr-mini" data-act="edit-'+field+'" data-k="'+esc(block)+'">✎</button>':'')+'</div>';
      return scrEdit?'<div class="'+cls+' add"><button class="scr-mini" data-act="edit-'+field+'" data-k="'+esc(block)+'">+ '+(field==='note'?'пояснение':'подсказка')+'</button></div>':'';
    }
    var msgs=(b.messages||[]).map(function(_,mi){return scrMsgHtml(block,mi);}).join('')||'<div class="muted" style="padding:6px">Нет сообщений</div>';
    var add=scrEdit?'<button class="scr-add" data-act="add-msg" data-k="'+esc(block)+'">+ сообщение</button>':'';
    return meta('note','📌','scr-note')+meta('hint','💡','scr-hint')+msgs+add;
  }
  // один блок в списке (шапка + место под тело); в правке инструментов — стрелки и удаление
  function scrBlockRow(name,sec,idx,total){
    var ctl='';
    if(scrEdit&&sec) ctl='<div class="scr-blk-ctl">'+
      '<button class="scr-mini" data-act="mv-up" data-sec="'+esc(sec)+'" data-idx="'+idx+'"'+(idx===0?' disabled':'')+'>↑</button>'+
      '<button class="scr-mini" data-act="mv-dn" data-sec="'+esc(sec)+'" data-idx="'+idx+'"'+(idx===total-1?' disabled':'')+'>↓</button>'+
      '<button class="scr-mini danger" data-act="del-block" data-sec="'+esc(sec)+'" data-blk="'+esc(name)+'">🗑</button></div>';
    return '<div class="scr-block"><div class="scr-b-row"><button class="scr-b-head" data-toggle="'+esc(name)+'">'+esc(name)+'<span class="scr-caret">▸</span></button>'+ctl+'</div><div class="scr-b-body" data-body="'+esc(name)+'" hidden></div></div>';
  }
  function scrRenderBody(){
    var d=scriptsCache, out='';
    if(scrTab==='main'){
      out=(d.mainOrder||[]).map(function(name){ return scrBlockRow(name,null,0,0); }).join('');
    } else {
      out=(d.sectionOrder||[]).map(function(sec){
        var blocks=(d.sections&&d.sections[sec])||[];
        var add=scrEdit?'<button class="scr-add" data-act="add-block" data-sec="'+esc(sec)+'">+ вопрос</button>':'';
        return '<div class="scr-sec"><div class="scr-sec-t">'+esc(sec)+'</div>'+blocks.map(function(name,i){return scrBlockRow(name,sec,i,blocks.length);}).join('')+add+'</div>';
      }).join('');
    }
    var host=$('scr-body'); if(host)host.innerHTML=out||'<div class="empty">Скрипты не загружены</div>';
    // снова раскрыть блок, который был открыт (чтобы правка/готово/сохранение не сворачивали и не «выкидывали»)
    if(scrOpenBlock && host && host.querySelector('[data-body="'+cssq(scrOpenBlock)+'"]')) scrOpenOne(scrOpenBlock);
  }
  // добавить фото-вложение: выбор файла → загрузка на сервер → подпись
  function scrAddImg(block,mi){
    var inp=document.createElement('input'); inp.type='file'; inp.accept='image/jpeg,image/png,image/webp';
    inp.onchange=async function(){ var f=inp.files[0]; if(!f)return; if(f.size>5*1024*1024){toast('Фото — до 5 МБ');return;}
      toast('Загрузка фото…');
      try{ var d=await fileData(f); var r=await api('POST','/upload',{reqId:uid(),data:d}); var title=(prompt('Подпись к фото (можно пусто):','')||'').trim();
        var _ia={type:'image',value:r.url}; setATitle(_ia,title); scriptsCache.blocks[block].messages[mi].attachments.push(_ia);
        if(await saveScripts()){ scrReopen(block); scrFlashAtt(block,mi); toast('Фото добавлено ✓'); } }
      catch(e){ toast(error(e)); } };
    inp.click();
  }
  function scrAddLink(block,mi){
    var url=(prompt('Ссылка (URL):','')||'').trim(); if(!url)return;
    var title=(prompt('Подпись к ссылке (можно пусто):','')||'').trim();
    var _la={type:'link',value:url}; setATitle(_la,title); scriptsCache.blocks[block].messages[mi].attachments.push(_la);
    saveScripts().then(function(ok){ if(ok){ scrReopen(block); scrFlashAtt(block,mi); toast('Ссылка добавлена ✓'); } });
  }
  // инлайн-правка текста сообщения (многострочно)
  function scrInlineText(block,mi){
    var wrap=$('scr-body').querySelector('[data-msgwrap="'+cssq(block+'|'+mi)+'"]'); if(!wrap)return;
    var cur=(scriptsCache.blocks[block].messages[mi]||{}).text||'';
    wrap.innerHTML='<textarea class="scr-ta">'+esc(cur)+'</textarea><div class="scr-msg-act"><button class="scr-save" data-act="save-text" data-k="'+esc(block)+'|'+mi+'">Сохранить</button><button class="scr-cancel" data-act="cancel-edit" data-k="'+esc(block)+'|'+mi+'">Отмена</button></div>';
    var ta=wrap.querySelector('.scr-ta'); ta.focus();
  }
  async function openScripts(dealId){
    scrClose(); scrDealId=dealId||null; scrOpenBlock=null;
    var wrap=document.createElement('div'); wrap.className='scr-panel'; wrap.id='scr-panel';
    wrap.innerHTML='<div class="scr-head"><b>Скрипты продаж</b><div class="scr-head-r"><div class="scr-langsw" id="scr-lang"><button data-lang="ru"'+(scrLang==='ru'?' class="on"':'')+'>RU</button><button data-lang="kz"'+(scrLang==='kz'?' class="on"':'')+'>KZ</button></div><button class="scr-mode" id="scr-mode">'+(scrEdit?'✓ Готово':'✎ Правка')+'</button><button class="scr-x" id="scr-close">✕</button></div></div>'+
      '<div class="scr-tabs"><button data-scrtab="main"'+(scrTab==='main'?' class="on"':'')+'>Магистраль</button><button data-scrtab="tools"'+(scrTab==='tools'?' class="on"':'')+'>Инструменты</button></div>'+
      '<div class="scr-body" id="scr-body"><div class="empty">Загрузка…</div></div>';
    sheet.appendChild(wrap);
    $('scr-close').onclick=scrTryClose;
    wrap.querySelectorAll('[data-lang]').forEach(function(b){ b.onclick=function(){ scrLang=b.dataset.lang; wrap.querySelectorAll('[data-lang]').forEach(function(x){x.classList.toggle('on',x===b);}); scrRenderBody(); }; });
    $('scr-mode').onclick=function(){ scrEdit=!scrEdit; this.textContent=scrEdit?'✓ Готово':'✎ Правка'; this.classList.toggle('on',scrEdit); scrRenderBody(); };
    if(scrEdit)$('scr-mode').classList.add('on');
    wrap.querySelectorAll('[data-scrtab]').forEach(function(b){b.onclick=function(){ scrTab=b.dataset.scrtab; wrap.querySelectorAll('[data-scrtab]').forEach(function(x){x.classList.toggle('on',x===b);}); scrRenderBody(); };});
    $('scr-body').addEventListener('click',scrOnClick);
    try{ await loadScripts(true); scrRenderBody(); }   // всегда свежие: правки одного видят все (скрипт общий)
    catch(e){ var hb=$('scr-body'); if(hb)hb.innerHTML='<p class="error">'+esc(error(e))+'</p>'; }
  }
  // единый обработчик действий панели
  async function scrOnClick(e){
    var tg=e.target.closest('[data-toggle]');
    if(tg){ var nm0=tg.dataset.toggle; var body=$('scr-body').querySelector('[data-body="'+cssq(nm0)+'"]'); if(!body)return;
      if(!body.hidden){ scrCloseOne(nm0); } else { scrOpenOne(nm0); }   // аккордеон: открыт только один блок
      return; }
    var btn=e.target.closest('[data-act]'); if(!btn)return;
    var act=btn.dataset.act, k=(btn.dataset.k||'').split('|'), block=k[0], mi=Number(k[1]), ai=Number(k[2]);
    var msg=(block&&scriptsCache.blocks[block]&&scriptsCache.blocks[block].messages)?scriptsCache.blocks[block].messages[mi]:null;
    if(act==='ins-msg'){ if(msg)scrInsert(mViewText(msg)); }
    else if(act==='send-msg'){ if(msg)scrBtnSend(btn, scrSend(mViewText(msg))); }
    else if(act==='send-att'){ var a=msg.attachments[ai]; var at=aTitle(a); scrBtnSend(btn, a.type==='link' ? scrSend((at?at+'\n':'')+a.value) : scrSendMedia(a.value, at)); }
    else if(act==='del-att'){ if(!confirm('Убрать вложение?'))return; msg.attachments.splice(ai,1); if(await saveScripts())scrReopen(block); }
    else if(act==='edit-msg'){ scrInlineText(block,mi); }
    else if(act==='save-text'){ var wrp=$('scr-body').querySelector('[data-msgwrap="'+cssq(block+'|'+mi)+'"]'); var ta=wrp&&wrp.querySelector('.scr-ta'); if(!ta)return; var nv=ta.value; var prev=mEditText(msg), prevKz=msg.text_kz; setMText(msg,nv); btn.disabled=true;
      if(scrLang==='ru'){ btn.textContent='⏳ Перевод…'; await autoTranslateKz([msg]); }   // правка на русском → казахский сам обновляется
      if(await saveScripts()){ toast(scrLang==='ru'?'Сохранено · казахский обновлён':'Сохранено'); btn.disabled=false; } else { setMText(msg,prev); msg.text_kz=prevKz; btn.disabled=false; btn.textContent='💾 Сохранить'; } }
    else if(act==='cancel-edit'){ scrReopen(block); }
    else if(act==='edit-label'){ var nl=prompt('Ярлык сообщения:',msg.label||''); if(nl!==null){ var p=msg.label; msg.label=nl.trim(); if(await saveScripts())scrReopen(block); else msg.label=p; } }
    else if(act==='del-msg'){ if(!confirm('Удалить это сообщение?'))return; scriptsCache.blocks[block].messages.splice(mi,1); if(await saveScripts())scrReopen(block); }
    else if(act==='add-msg'){ scriptsCache.blocks[block].messages.push({label:'Новое сообщение',text:'',attachments:[]}); if(await saveScripts())scrReopen(block); }
    else if(act==='edit-note'||act==='edit-hint'){ var field=act==='edit-note'?'note':'hint'; var nv2=prompt(field==='note'?'Пояснение (для менеджера):':'Подсказка (действие):',scriptsCache.blocks[block][field]||''); if(nv2!==null){ var pp=scriptsCache.blocks[block][field]; scriptsCache.blocks[block][field]=nv2.trim(); if(await saveScripts())scrReopen(block); else scriptsCache.blocks[block][field]=pp; } }
    else if(act==='add-img'){ scrAddImg(block,mi); }
    else if(act==='add-link'){ scrAddLink(block,mi); }
    else if(act==='mv-up'||act==='mv-dn'){ var sec=btn.dataset.sec, idx=Number(btn.dataset.idx), arr=scriptsCache.sections[sec], j=act==='mv-up'?idx-1:idx+1; if(j<0||j>=arr.length)return; var t=arr[idx]; arr[idx]=arr[j]; arr[j]=t; if(await saveScripts())scrRenderBody(); }
    else if(act==='del-block'){ var s2=btn.dataset.sec, nm=btn.dataset.blk; if(!confirm('Удалить вопрос «'+nm+'»?'))return; scriptsCache.sections[s2]=scriptsCache.sections[s2].filter(function(x){return x!==nm;}); delete scriptsCache.blocks[nm]; if(await saveScripts())scrRenderBody(); }
    else if(act==='add-block'){ var sec3=btn.dataset.sec; var nm3=(prompt('Название вопроса/ситуации:','')||'').trim(); if(!nm3)return; if(scriptsCache.blocks[nm3]){toast('Такой блок уже есть');return;} scriptsCache.blocks[nm3]={kind:'side',note:'',hint:'',messages:[{label:'Ответ',text:'',attachments:[]}]}; scriptsCache.sections[sec3]=(scriptsCache.sections[sec3]||[]).concat([nm3]); if(await saveScripts())scrRenderBody(); }
  }
  async function showDeal(id){
    stopChat();
    openSheet('Чат','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{
      var all=await Promise.all([api('GET','/deals/'+id),api('GET','/deals/'+id+'/events'),api('GET','/templates'),
        API.waMessages(id).catch(function(){return {messages:[]};}),
        waChecked?Promise.resolve(null):API.waStatus().catch(function(){return {connected:false};})]);
      if(gen!==sheetGeneration)return;
      var d=all[0].deal, evs=all[1].events.slice().reverse();
      state.templates=all[2].templates;
      var msgs=all[3].messages||[];
      if(all[4]){ waConnected=!!all[4].connected; waChecked=true; }
      chatDealId=d.id; chatLastEventId=evs.length?evs[evs.length-1].id:0;
      var chatLastSig=chatSig(evs, msgs);
      // открыли чат → сбрасываем непрочитанные (сервер + локально, чтобы бейдж на доске исчез)
      if(Number(d.wa_unread)>0){ API.waRead(id).catch(function(){}); var bd=state.deals.find(function(x){return x.id===d.id;}); if(bd)bd.wa_unread=0; }
      $('sheet-title').textContent='';
      var p=d.phone&&/^\+[1-9]\d{7,14}$/.test(d.phone)?d.phone:null;
      var initial=(d.client_name||'?').trim().charAt(0).toUpperCase();
      body.innerHTML=
        '<div class="wa-head">'+
          '<button class="wa-back" id="ch-back" aria-label="Назад" title="Назад">‹</button>'+
          '<span class="wa-ava">'+esc(initial)+'</span>'+
          '<span class="wa-who"><b>'+esc(d.client_name)+'</b><small>'+esc(d.stage_name)+(effAgent(d)?' · 🤖 агент':'')+'</small></span>'+
          '<button class="wa-ic" id="ch-tr" title="Перевести чат на русский"><svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg></button>'+
          '<button class="wa-ic ch-agent'+(effAgent(d)?' on':'')+'" id="ch-agent" title="Агент: '+(effAgent(d)?'работает — нажми, чтобы выключить и вести самому':'выключен — нажми, чтобы включить')+'">🤖</button>'+
          (p?'<a class="wa-ic" href="tel:'+esc(p)+'" title="Позвонить">📞</a>':'')+
          '<button class="wa-ic" id="wa-menu-btn" title="Меню">⋮</button>'+
        '</div>'+
        '<div class="wa-menu" id="wa-menu" hidden>'+
          (p?'<a href="https://wa.me/'+esc(p.slice(1))+'" target="_blank" rel="noopener noreferrer">🟢 Открыть в WhatsApp</a>':'')+
          '<button id="wm-info">ℹ️ Детали сделки</button>'+
          '<button id="wm-client">👤 Клиент</button>'+
        '</div>'+
        '<div class="wa-stages" id="wa-stages"><button class="st-note" id="ch-note" title="Заметка для себя (клиент не видит)">📝</button>'+state.stages.map(function(s){
          var cur=s.id===d.stage_id;
          return '<button class="st-chip'+(cur?' on':'')+(s.is_won?' won':'')+(s.is_lost?' lost':'')+'" data-st="'+s.id+'">'+(s.is_won?'✅ ':'')+esc(s.name)+'</button>';
        }).join('')+'</div>'+
        (function(){ chTr=false; chTrCache={}; chLastEvs=evs; chLastMsgs=msgs; return ''; })()+
        '<div class="wa-log" id="ch-log">'+renderTimeline(buildTimeline(evs,msgs))+'</div>'+
        (waConnected?'':'<div class="wa-note">WhatsApp подключим при переезде — пока сообщения сохраняются как заметки в ленте</div>')+
        '<div class="ch-tpl" id="ch-tpl" hidden></div>'+
        '<div class="ch-reply" id="ch-reply" hidden></div>'+
        '<div class="wa-input">'+
          '<div class="wa-field">'+
            '<textarea id="ch-text" rows="1" placeholder="Сообщение"></textarea>'+
            '<button class="wa-in-ic" id="ch-tplbtn" title="Скрипты продаж">📋</button>'+
            '<button class="wa-in-ic wa-tokz" id="ch-tokz" title="Перевести мой текст на казахский">Қ</button>'+
            '<button class="wa-in-ic" id="ch-attach" title="Прикрепить">📎</button>'+
            '<input id="ch-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><input id="ch-file-hd" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>'+
          '</div>'+
          '<button class="wa-send" id="ch-send" hidden>➤</button>'+
          '<button class="wa-mic" id="ch-mic" title="Голосовое (запись)"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3"/></svg></button>'+
          // панель записи голосового: живая реакция на голос (столбики) + секунды + отправить/отменить
          '<div class="wa-recbar" id="ch-recbar" hidden>'+
            '<button class="wa-rec-x" id="ch-rec-cancel" title="Отменить запись">✕</button>'+
            '<span class="wa-rec-dot"></span>'+
            '<div class="wa-rec-wave" id="ch-rec-wave"></div>'+
            '<span class="wa-rec-time" id="ch-rec-time">0:00</span>'+
            '<button class="wa-rec-send" id="ch-rec-send" title="Отправить голосовое"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M3.4 20.4l17.4-7.5c.9-.4.9-1.6 0-2L3.4 3.6c-.7-.3-1.5.3-1.4 1.1L3.2 11l10 1-10 1-1.2 5.3c-.1.8.7 1.4 1.4 1.1z"/></svg></button>'+
          '</div>'+
        '</div>'+
        '<div class="ch-attach-menu" id="ch-attach-menu" hidden><button data-att="image">🖼 Фото в чат (с превью)</button><button data-att="doc">📄 Файлом в HD (без сжатия)</button></div>';
      var log=$('ch-log'); log.scrollTop=log.scrollHeight; autoLoadMedia(); initAudioDurations();
      var chReply=null;
      function renderReplyBar(){ var bar=$('ch-reply'); if(!bar)return; if(!chReply){bar.hidden=true;bar.innerHTML='';return;} bar.innerHTML='<div class="ch-reply-in"><span>↩ '+esc(chReply.text||'сообщение')+'</span><button id="ch-reply-x">✕</button></div>'; bar.hidden=false; $('ch-reply-x').onclick=function(){ chReply=null; renderReplyBar(); }; var ta=$('ch-text'); if(ta)ta.focus(); }
      // ленивая загрузка вложения + ответ на сообщение (reply)
      var lpFired=false;   // был долгий тап (включили ответ) — гасим следующий click, чтобы не сыграло аудио/переход
      log.addEventListener('click',async function(e){
        if(lpFired){ lpFired=false; e.stopPropagation(); e.preventDefault(); return; }
        // клик по цитате → переход к исходному сообщению в ленте + подсветка (как в WhatsApp)
        var jp=e.target.closest('[data-jump]');
        if(jp){ e.stopPropagation(); var w=jp.getAttribute('data-jump'); var tgt=log.querySelector('.wa-row[data-wamid="'+cssq(w)+'"]');
          if(tgt){ try{ tgt.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e2){ tgt.scrollIntoView(); } tgt.classList.add('wa-row-hl'); setTimeout(function(){ tgt.classList.remove('wa-row-hl'); },1600); } else toast('Исходное сообщение не в этой ленте'); return; }
        // перевод голосового: распознать (Deepgram) + перевести на русский, показать под плеером
        var trb=e.target.closest('[data-trmsg]');
        if(trb){ e.stopPropagation(); var mid=trb.getAttribute('data-trmsg'); var box=document.querySelector('[data-trtext="'+cssq(mid)+'"]');
          if(box && box.dataset.loaded){ box.hidden=!box.hidden; return; }
          if(trb.disabled) return; trb.disabled=true; var old=trb.textContent; trb.textContent='🌐 распознаю…';
          API.waTranscribe(mid).then(function(r){ trb.disabled=false; trb.textContent=old; waTrCache[mid]={ru:r.ru,transcript:r.transcript}; if(box){ box.innerHTML=trHtml(waTrCache[mid]); box.dataset.loaded='1'; box.hidden=false; } })
            .catch(function(er){ trb.disabled=false; trb.textContent=old; toast(error(er)); });
          return;
        }
        // плеер голосового: play/pause
        var pl=e.target.closest('[data-audplay]');
        if(pl){ e.stopPropagation(); var box=pl.closest('.wa-aud'), au=box.querySelector('audio');
          if(au.paused){
            log.querySelectorAll('.wa-aud audio').forEach(function(a){ if(a!==au)a.pause(); });   // играет одно, как в WhatsApp
            if(!au._wired){ au._wired=true; var wave=box.querySelector('.wa-aud-wave'), bars=wave?wave.children:[], cur=box.querySelector('.wa-aud-cur');
              var paint=function(p){ var n=bars.length, lim=Math.round(p*n); for(var i=0;i<n;i++){ var on=i<lim; if(bars[i].classList.contains('on')!==on) bars[i].classList.toggle('on',on); } };
              au.addEventListener('timeupdate',function(){ var dd=au.duration||0; paint(dd?au.currentTime/dd:0); cur.textContent=fmtDur(au.currentTime); });
              au.addEventListener('ended',function(){ pl.innerHTML=AUD_PLAY; paint(0); au.currentTime=0; cur.textContent=fmtDur(au.duration||0); });
              au.addEventListener('play',function(){ pl.innerHTML=AUD_PAUSE; });
              au.addEventListener('pause',function(){ pl.innerHTML=AUD_PLAY; });
            }
            au.play().catch(function(){ toast('Не удалось воспроизвести'); });
          } else au.pause();
          return;
        }
        var rt=e.target.closest('[data-audrate]');
        if(rt){ e.stopPropagation(); var a2=rt.closest('.wa-aud').querySelector('audio'); var seq=[1,1.5,2]; var ni=(seq.indexOf(a2.playbackRate)+1)%seq.length; a2.playbackRate=seq[ni]; rt.textContent=seq[ni]+'×'; return; }
        var br=e.target.closest('[data-audbar]');
        if(br){ e.stopPropagation(); var a3=br.closest('.wa-aud').querySelector('audio'); var rc=br.getBoundingClientRect(); var p=Math.min(1,Math.max(0,(e.clientX-rc.left)/rc.width)); if(a3.duration)a3.currentTime=p*a3.duration; return; }
        var b=e.target.closest('[data-media]'); if(!b)return;
        b.disabled=true; b.textContent='Загрузка…';
        try{ var r=await API.waMedia(b.dataset.media); var wrap=b.closest('.wa-b'); if(wrap){ var meta=wrap.querySelector('.wa-meta'), rb=wrap.querySelector('.wa-reply'), q=wrap.querySelector('.wa-quote'); wrap.innerHTML=(rb?rb.outerHTML:'')+(q?q.outerHTML:'')+waMediaView(r.url,r.mime||'',b.dataset.media)+(meta?meta.outerHTML:''); var na2=wrap.querySelector('.wa-aud audio'); if(na2)initAudioEl(na2); } }
        catch(err){ b.disabled=false; b.textContent='▶ Загрузить'; toast(error(err)); }
      });
      // жесты как в WhatsApp: СВАЙП ВПРАВО по сообщению = ответить; ДОЛГОЕ нажатие = реакции (эмодзи)
      var REACTS=['👍','❤️','😂','😮','😢','🙏'];
      function closeReacts(){ var p=document.getElementById('ch-reactbar'); if(p)p.remove(); }
      function openReacts(row){
        closeReacts();
        var wamid=row.getAttribute('data-wamid')||''; if(!wamid){ toast('На это сообщение нельзя поставить реакцию'); return; }
        if(!waConnected){ toast('WhatsApp не подключён — реакции недоступны'); return; }
        var cur=(chLastMsgs||[]).filter(function(m){return m&&m.wamid===wamid;})[0];
        var bar=document.createElement('div'); bar.id='ch-reactbar'; bar.className='wa-reactbar';
        bar.innerHTML=REACTS.map(function(em){ return '<button data-em="'+em+'"'+((cur&&cur.reaction===em)?' class="on"':'')+'>'+em+'</button>'; }).join('')+((cur&&cur.reaction)?'<button data-em="" class="rm">✕</button>':'');
        document.body.appendChild(bar);
        var rc=row.getBoundingClientRect(), bw=bar.offsetWidth;
        var top=rc.top-50; if(top<64)top=rc.bottom+6;
        var left=rc.left+(row.classList.contains('out')?rc.width-bw:0); left=Math.max(6,Math.min(window.innerWidth-bw-6,left));
        bar.style.top=top+'px'; bar.style.left=left+'px';
        bar.querySelectorAll('[data-em]').forEach(function(b){ b.onclick=async function(e){ e.stopPropagation(); var em=b.getAttribute('data-em'); closeReacts();
          try{ await API.waReact(d.id,wamid,em); if(cur)cur.reaction=em; chRenderLog(); toast(em?('Реакция '+em):'Реакция снята'); }
          catch(er){ toast(error(er)); }
        }; });
      }
      if(!window.__reactWired){ window.__reactWired=true;
        document.addEventListener('click',function(e){ var p=document.getElementById('ch-reactbar'); if(p&&!e.target.closest('#ch-reactbar')) p.remove(); });
        window.addEventListener('scroll',function(){ closeReacts(); },true);
      }
      var g=null, lpTimer=null;
      function lpCancel(){ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; } }
      function snapBack(){ if(g&&g.bubble){ g.bubble.style.transition='transform .18s'; g.bubble.style.transform=''; } if(g&&g.ic){ g.ic.style.opacity='0'; } }
      function doReply(row){ var w=row.getAttribute('data-rw')||'', txt=row.getAttribute('data-rt')||''; if(!w&&!txt)return; lpFired=true; chReply={wamid:w,text:txt}; renderReplyBar(); try{if(navigator.vibrate)navigator.vibrate(12);}catch(e){} }
      function gBegin(x,y,row){
        lpCancel(); if(g)snapBack();
        var bubble=row.querySelector('.wa-b'); if(!bubble){ g=null; return; }
        var ic=row.querySelector('.wa-swipe-ic'); if(!ic){ ic=document.createElement('span'); ic.className='wa-swipe-ic'; ic.textContent='↩'; row.insertBefore(ic,row.firstChild); }
        g={x:x,y:y,row:row,bubble:bubble,ic:ic,t:0,mode:null};
        lpTimer=setTimeout(function(){ lpTimer=null; if(g&&g.mode===null){ var r=g.row; g.mode='done'; snapBack(); g=null; lpFired=true; try{if(navigator.vibrate)navigator.vibrate(15);}catch(e){} openReacts(r); } },450);
      }
      function gMove(x,y,ev){
        if(!g||g.mode==='done')return;
        var dx=x-g.x, dy=y-g.y;
        if(g.mode===null && (Math.abs(dx)>8||Math.abs(dy)>8)){ if(dx>0&&Math.abs(dx)>Math.abs(dy)){ g.mode='swipe'; lpCancel(); g.bubble.style.transition='none'; } else { g.mode='scroll'; lpCancel(); } }
        if(g.mode==='swipe'){ var t=Math.max(0,Math.min(90,dx)); g.t=t; g.bubble.style.transform='translateX('+t+'px)'; if(g.ic)g.ic.style.opacity=String(Math.min(1,t/60)); if(ev&&ev.cancelable)ev.preventDefault(); }
      }
      function gEnd(){ if(!g)return; if(g.mode==='swipe'){ var fire=g.t>=55, row=g.row; snapBack(); g=null; if(fire)doReply(row); return; } if(g.mode==='done'){ g=null; return; } lpCancel(); snapBack(); g=null; }
      log.addEventListener('touchstart',function(e){ if(e.touches.length>1)return; var row=e.target.closest('.wa-row'); if(!row)return; var t=e.touches[0]; gBegin(t.clientX,t.clientY,row); },{passive:true});
      log.addEventListener('touchmove',function(e){ if(!g)return; var t=e.touches[0]; gMove(t.clientX,t.clientY,e); },{passive:false});
      log.addEventListener('touchend',gEnd); log.addEventListener('touchcancel',function(){ lpCancel(); snapBack(); g=null; });
      log.addEventListener('mousedown',function(e){ if(e.button!==0)return; var row=e.target.closest('.wa-row'); if(!row)return; gBegin(e.clientX,e.clientY,row); });
      log.addEventListener('mousemove',function(e){ if(!g)return; gMove(e.clientX,e.clientY,e); });
      log.addEventListener('mouseup',gEnd); log.addEventListener('mouseleave',function(){ if(g&&g.mode!=='done'){ lpCancel(); snapBack(); g=null; } });
      var menu=$('wa-menu');
      if($('ch-back')) $('ch-back').onclick=function(){ closeSheet(); };
      if($('ch-tr')) $('ch-tr').onclick=function(){ chTr=!chTr; this.classList.toggle('on',chTr); if(chTr){ toast('Перевожу чат на русский…'); chDoTranslate(); } else chRenderLog(); };
      $('wa-menu-btn').onclick=function(e){ e.stopPropagation(); menu.hidden=!menu.hidden; };
      // закрытие меню кликом вне его (чтобы не перекрывало ⋮ и не приходилось выходить из чата). Один слушатель на жизнь приложения — ищет актуальное меню.
      if(!window.__waMenuClose){ window.__waMenuClose=true;
        document.addEventListener('click',function(ev){ var m=document.getElementById('wa-menu'); if(!m||m.hidden)return; if(ev.target.closest('#wa-menu')||ev.target.closest('#wa-menu-btn'))return; m.hidden=true; }); }
      // полоска воронки: текущий этап подсвечен, тап по другому — переход; «Продажа» открывает оформление
      var stagesBar=$('wa-stages'), curChip=stagesBar.querySelector('.st-chip.on');
      if(curChip)curChip.scrollIntoView({inline:'nearest',block:'nearest'});   // не центрируем, чтобы 📝 слева не обрезался
      stagesBar.querySelectorAll('[data-st]').forEach(function(b){b.onclick=async function(){
        var s=state.stages.find(function(x){return x.id===Number(b.dataset.st);});
        if(!s||s.id===d.stage_id)return;
        if(s.is_won){stopChat();showSale(d.id);return;}
        if(s.is_lost){stopChat();askLost(d);return;}
        if(s.code==='paused'){stopChat();askPause(d);return;}   // пауза всегда спрашивает: когда напомнить
        // остальные этапы — переносим сразу, без подтверждения (ошибся — перетащишь обратно)
        try{await api('POST','/deals/'+d.id+'/stage',{reqId:uid(),baseRev:d.rev,stage_id:s.id});toast('Этап: '+s.name);showDeal(d.id);reload();}
        catch(e){toast(error(e));}
      };});
      var sending=false;
      async function send(){
        if(sending) return;                         // защита от дубля: пока идёт отправка, второй Enter/клик игнорируем
        var t=$('ch-text').value.trim(); if(!t)return;
        sending=true; $('ch-send').disabled=true;
        var quotedNote=function(){ return chReply?('↪ '+(chReply.text||'')+'\n'+t):t; };
        try{
          // подключён WhatsApp → шлём реально через 360dialog (с цитатой, если reply); иначе внутренняя заметка
          if(waConnected){ await API.waSend(Object.assign({deal_id:d.id, text:t, reqId:uid()}, chReply?{reply_to:chReply.wamid, reply_text:chReply.text}:{})); }
          else { await api('POST','/deals/'+d.id+'/events',{reqId:uid(),kind:'msg',text:quotedNote()}); }
          $('ch-text').value=''; chReply=null; renderReplyBar(); chToggle(); await poll();
        }
        catch(e){
          // канал ещё не подключён на сервере — не теряем текст, кладём заметкой
          if(e&&e.status===503){ try{ await api('POST','/deals/'+d.id+'/events',{reqId:uid(),kind:'msg',text:quotedNote()}); $('ch-text').value=''; chReply=null; renderReplyBar(); chToggle(); waConnected=false; await poll(); }catch(e2){ toast(error(e2)); } }
          else toast(error(e));
        }
        sending=false; $('ch-send').disabled=false; $('ch-text').focus();
      }
      $('ch-send').onclick=send;
      // «Қаз»: Ульяна пишет по-русски → перевод её текста на казахский прямо в поле, дальше жмёт ➤
      var toKzBtn=$('ch-tokz');
      if(toKzBtn) toKzBtn.onclick=async function(){
        var ta=$('ch-text'); var t=ta.value.trim(); if(!t){ toast('Напиши текст по-русски — переведу на казахский'); return; }
        if(toKzBtn.disabled) return; toKzBtn.disabled=true; var old=toKzBtn.textContent; toKzBtn.textContent='…';
        try{ var r=await API.crm('POST','/translate',{texts:[t],to:'kz'}); var kz=(r&&r.translations&&r.translations[0])||'';
          if(kz && kz!==t){ ta.value=kz; chToggle(); toKzBtn.textContent='✓'; toKzBtn.classList.add('done'); setTimeout(function(){ toKzBtn.textContent=old; toKzBtn.classList.remove('done'); },1200); }
          else { toKzBtn.textContent=old; toast('Не удалось перевести'); }
        }catch(e){ toKzBtn.textContent=old; toast(error(e)); }
        toKzBtn.disabled=false; ta.focus();
      };
      // телефон (сенсорный экран): Enter = новая строка, отправка кнопкой ➤ (как в WhatsApp). ПК: Enter = отправить, Shift+Enter = новая строка
      var isTouchKb = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      $('ch-text').addEventListener('keydown',function(e){ if(e.key!=='Enter')return; if(isTouchKb)return; if(!e.shiftKey){ e.preventDefault(); send(); } });
      // узкое поле как в WhatsApp: авто-рост + переключение микрофон↔отправка по наличию текста
      var chText=$('ch-text');
      // поле растёт по мере ввода до ~5 строк (150px), дальше — прокрутка внутри поля
      function chToggle(){ var has=chText.value.trim().length>0; $('ch-send').hidden=!has; $('ch-mic').hidden=has; chText.style.height='auto'; chText.style.height=Math.min(150,Math.max(38,chText.scrollHeight))+'px'; chText.style.overflowY=chText.scrollHeight>150?'auto':'hidden'; }
      chText.addEventListener('input',chToggle); chToggle();
      // клавиатура не должна закрывать поле ввода: поднимаем лист чата над клавиатурой (visualViewport), пока чат открыт
      if(window.visualViewport && !window.__chKbWired){ window.__chKbWired=true;
        var kbFix=function(){ var vv=window.visualViewport; if(!vv)return;
          if(!document.getElementById('ch-text')){ sheet.style.bottom=''; return; }   // чат закрыт — сброс
          var kb=Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
          sheet.style.bottom = kb>80 ? kb+'px' : '';
          if(kb>80){ var lg=document.getElementById('ch-log'); if(lg)lg.scrollTop=lg.scrollHeight; }
        };
        window.visualViewport.addEventListener('resize',kbFix);
        window.visualViewport.addEventListener('scroll',kbFix);
      }
      chText.addEventListener('focus',function(){ setTimeout(function(){ if(window.visualViewport){ var vv=window.visualViewport; var kb=Math.max(0, window.innerHeight - vv.height - vv.offsetTop); sheet.style.bottom = kb>80 ? kb+'px':''; } var lg=$('ch-log'); if(lg)lg.scrollTop=lg.scrollHeight; },300); });
      // запись голосового: тап по микрофону — старт (панель с живой реакцией на голос + секунды); ✕ отмена, ➤ отправить
      var mediaRec=null, chunks=[], recording=false, recStream=null, recAC=null, recRAF=null, recTimer=null, recT0=0, recCancelled=false;
      function fmtRec(s){ var m=Math.floor(s/60), ss=s%60; return m+':'+(ss<10?'0':'')+ss; }
      function stopRecViz(){ if(recRAF)cancelAnimationFrame(recRAF); recRAF=null; if(recTimer)clearInterval(recTimer); recTimer=null; try{ if(recAC)recAC.close(); }catch(e){} recAC=null; }
      function showRecbar(on){ var rb=$('ch-recbar'), fld=chText.parentNode; if(rb)rb.hidden=!on; if(fld)fld.style.display=on?'none':''; var mic=$('ch-mic'); if(mic)mic.hidden=on; if(on){ var sb=$('ch-send'); if(sb)sb.hidden=true; } else chToggle(); }
      $('ch-mic').onclick=async function(){
        if(recording) return;
        if(!navigator.mediaDevices||!window.MediaRecorder){ toast('Запись не поддерживается этим браузером'); return; }
        if(!waConnected){ toast('WhatsApp подключится в день переезда — голосовое пока не уходит'); return; }
        try{
          recStream=await navigator.mediaDevices.getUserMedia({audio:true});
          recCancelled=false;
          // iOS Safari умеет писать только mp4/aac (не webm) — подбираем поддерживаемый формат, иначе запись пустая
          var isIOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
          var mt=''; var cands=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/aac'];
          if(window.MediaRecorder&&MediaRecorder.isTypeSupported){ for(var ci=0;ci<cands.length;ci++){ if(MediaRecorder.isTypeSupported(cands[ci])){ mt=cands[ci]; break; } } }
          mediaRec = mt ? new MediaRecorder(recStream,{mimeType:mt}) : new MediaRecorder(recStream); chunks=[];
          mediaRec.ondataavailable=function(ev){ if(ev.data&&ev.data.size)chunks.push(ev.data); };
          mediaRec.onstop=async function(){
            try{ recStream.getTracks().forEach(function(t){t.stop();}); }catch(e){}
            recording=false; stopRecViz(); showRecbar(false); $('ch-mic').classList.remove('rec');
            if(recCancelled){ chunks=[]; return; }
            var blob=new Blob(chunks,{type:(mediaRec&&mediaRec.mimeType)||'audio/webm'});
            if(!blob.size){ toast('Запись не получилась — попробуй ещё раз'); return; }
            try{ var data=await fileData(blob); await API.waSendVoice({deal_id:d.id, audio:data, reqId:uid()}); await poll(); }
            catch(e){ if(e&&e.status===503) toast('WhatsApp ещё не подключён'); else toast(error(e)); }
          };
          mediaRec.start(300); recording=true; $('ch-mic').classList.add('rec'); showRecbar(true);   // таймслайс 300мс: данные копятся по ходу, не только в конце (надёжнее на iOS)
          // секунды
          recT0=Date.now(); var tEl=$('ch-rec-time'); if(tEl)tEl.textContent='0:00';
          recTimer=setInterval(function(){ if(tEl)tEl.textContent=fmtRec(Math.floor((Date.now()-recT0)/1000)); },250);
          // живая реакция на голос: частотный анализ → высота столбиков
          var wave=$('ch-rec-wave'); var N=24;
          if(wave){ if(!wave.children.length){ var h=''; for(var k=0;k<N;k++)h+='<i></i>'; wave.innerHTML=h; } N=wave.children.length; }
          if(isIOS){
            // на iOS НЕ подключаем AudioContext к потоку записи (иначе запись выходит пустой/тихой) — рисуем лёгкую «живую» волну без анализа звука
            var barsI=wave?wave.children:[], t0=Date.now();
            (function draw(){ recRAF=requestAnimationFrame(draw); var el=(Date.now()-t0)/130;
              for(var i=0;i<N;i++){ if(barsI[i]) barsI[i].style.height=Math.round(26+44*Math.abs(Math.sin(el+i*0.5)))+'%'; } })();
          } else try{
            recAC=new (window.AudioContext||window.webkitAudioContext)();
            var src=recAC.createMediaStreamSource(recStream), an=recAC.createAnalyser(); an.fftSize=64; src.connect(an);
            var bins=an.frequencyBinCount, data=new Uint8Array(bins), bars=wave?wave.children:[];
            (function draw(){ recRAF=requestAnimationFrame(draw); an.getByteFrequencyData(data);
              for(var i=0;i<N;i++){ var v=data[Math.floor(i/N*bins)]||0; if(bars[i])bars[i].style.height=Math.max(12,Math.round(v/255*100))+'%'; } })();
          }catch(e){}
        }catch(e){ toast('Нет доступа к микрофону'); }
      };
      if($('ch-rec-send')) $('ch-rec-send').onclick=function(){ if(recording){ try{ mediaRec.stop(); }catch(e){} } };
      if($('ch-rec-cancel')) $('ch-rec-cancel').onclick=function(){ if(recording){ recCancelled=true; try{ mediaRec.stop(); }catch(e){} } };
      // отправка фото/документа клиенту: mode 'image' = в чат с превью, 'document' = HD-файлом без сжатия; текст в поле = подпись
      async function sendAttach(f, mode){
        if(!f)return;
        if(f.size>16*1024*1024){ toast('Файл до 16 МБ'); return; }
        var mtype=(f.type==='application/pdf')?'document':mode;   // pdf всегда документом
        var cap=$('ch-text').value.trim();
        toast('Загрузка…');
        try{
          var data=await fileData(f);
          var up=await api('POST','/upload',{reqId:uid(),data:data});
          if(waConnected){
            await API.waSend({deal_id:d.id, media:up.url, media_type:mtype, caption:cap, reqId:uid()});
            $('ch-text').value=''; chToggle(); toast(mtype==='document'?'Отправлено в HD (файлом)':'Отправлено'); await poll();
          } else {
            await api('POST','/deals/'+d.id+'/events',{reqId:uid(),kind:'msg',text:(cap?cap+'\n':'')+'[вложение] '+up.url});
            $('ch-text').value=''; chToggle(); toast('Канал не подключён — сохранено заметкой'); await poll();
          }
        }catch(e){
          if(e&&e.status===503){ toast('WhatsApp ещё не подключён — появится в день переезда'); }
          else toast(error(e));
        }
      }
      var chFile=$('ch-file'), chFileHd=$('ch-file-hd');
      if(chFile) chFile.onchange=function(){ var f=chFile.files[0]; chFile.value=''; sendAttach(f,'image'); };
      if(chFileHd) chFileHd.onchange=function(){ var f=chFileHd.files[0]; chFileHd.value=''; sendAttach(f,'document'); };
      // одна кнопка «прикрепить» → меню из 2 вариантов (в чат / HD файлом)
      var attMenu=$('ch-attach-menu');
      if($('ch-attach')) $('ch-attach').onclick=function(e){ e.stopPropagation(); attMenu.hidden=!attMenu.hidden; };
      if(attMenu) attMenu.querySelectorAll('[data-att]').forEach(function(b){ b.onclick=function(){ attMenu.hidden=true; if(b.dataset.att==='image')chFile.click(); else chFileHd.click(); }; });
      document.addEventListener('click',function(){ if(attMenu&&!attMenu.hidden)attMenu.hidden=true; });
      // заметка для себя: клиент не видит, ложится в ленту
      if($('ch-note')) $('ch-note').onclick=async function(){
        var t=(prompt('Заметка по клиенту (только для нас, клиент не увидит):','')||'').trim(); if(!t)return;
        try{ await api('POST','/deals/'+d.id+'/events',{reqId:uid(),kind:'msg',text:'📝 Заметка: '+t}); toast('Заметка добавлена'); await poll(); }
        catch(e){ toast(error(e)); }
      };
      async function poll(){
        if(chatDealId!==d.id)return;
        clearTimeout(chatTimer);
        try{
          var r=await Promise.all([api('GET','/deals/'+d.id+'/events'), API.waMessages(d.id).catch(function(){return {messages:[]};})]);
          if(chatDealId!==d.id||gen!==sheetGeneration)return;
          var ev2=r[0].events.slice().reverse(), m2=r[1].messages||[];
          var s2=chatSig(ev2,m2);
          if(s2!==chatLastSig){
            chatLastSig=s2;
            var atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
            chLastEvs=ev2; chLastMsgs=m2;
            log.innerHTML=renderTimeline(buildTimeline(ev2,m2));
            autoLoadMedia(); initAudioDurations();
            if(atBottom)log.scrollTop=log.scrollHeight;
            if(chTr) chDoTranslate();   // новые сообщения тоже перевести, если включён перевод
            if(m2.length)API.waRead(d.id).catch(function(){});
          }
        }catch(e){}
        chatTimer=setTimeout(poll,7000);
      }
      chatTimer=setTimeout(poll,7000);
      // 📋 → панель-конструктор скриптов (магистраль + инструменты), с id сделки для отправки
      $('ch-tplbtn').onclick=function(){ openScripts(d.id); };
      // (убран конфликтующий обработчик ch-file→/files: он перебивал отправку фото в WhatsApp через sendAttach.
      //  теперь скрепка 📎 в чате шлёт фото/документ клиенту в WhatsApp, как и задумано)
      // кнопка агента прямо в шапке чата: вкл ⇄ выкл (выключил = ведёшь сам). Отдельного «вести самому» в меню больше нет.
      if($('ch-agent'))$('ch-agent').onclick=async function(){
        var next=effAgent(d)?'off':'on', btn=this;
        try{ var r=await api('POST','/deals/'+d.id+'/agent',{reqId:uid(),mode:next});
          d.agent_override=(r&&'agent_override' in r)?r.agent_override:(next==='on'?true:false);
          var on=effAgent(d); btn.classList.toggle('on',on); btn.title='Агент: '+(on?'работает — нажми, чтобы выключить и вести самому':'выключен — нажми, чтобы включить');
          var who=document.querySelector('.wa-who small'); if(who)who.textContent=d.stage_name+(on?' · 🤖 агент':'');
          toast(on?'Агент включён':'Агент выключен — ведёте сами');
          var bd=state.deals.find(function(x){return x.id===d.id;}); if(bd)bd.agent_override=d.agent_override; if(state.tab==='deals')renderDeals();
        }catch(e){ toast(error(e)); }
      };
      $('wm-info').onclick=function(){ stopChat(); showDealInfo(d.id); };
      $('wm-client').onclick=function(){ stopChat(); showClient(d.client_id); };
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
  // строка задачи с чекбоксом и удалением
  function taskRow(t){
    var due=t.due_at?' · до '+stamp(t.due_at):'';
    return '<div class="task-row'+(t.done?' done':'')+'"><label><input type="checkbox" data-task-done="'+esc(t.id)+'" data-on="'+(t.done?'1':'0')+'"'+(t.done?' checked':'')+'> <span>'+esc(t.title)+due+'</span></label><button class="ghost danger" data-task-del="'+esc(t.id)+'">✕</button></div>';
  }
  // ℹ️ детали сделки: сумма, поступления/остаток, доставка, состав, задачи, файлы
  async function showDealInfo(id){
    openSheet('Детали','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{
      var r=await api('GET','/deals/'+id);if(gen!==sheetGeneration)return;
      var d=r.deal, files=r.files, payments=r.payments||[], tasks=r.tasks||[], paid=r.paid||0, due=r.due||0;
      $('sheet-title').textContent=d.client_name;
      var deliveryBits=[d.city,d.address].filter(Boolean).join(', ');
      var deliveryWhen=[day(d.ship_date)!=='Не указана'?day(d.ship_date):'', d.ship_time].filter(Boolean).join(' · ');
      var openTasks=tasks.filter(function(t){return !t.done;}), doneTasks=tasks.filter(function(t){return t.done;});
      body.innerHTML='<button class="ghost" id="di-back" style="margin-bottom:8px">← в чат</button>'+
        '<span class="pill">'+esc(d.stage_name)+'</span><div class="amount">'+esc(money(d.amount))+'</div><p class="pre">'+esc(d.title)+'</p>'+
        '<p class="hint">'+esc(d.manager_name||'—')+' · '+esc(d.source||'Без источника')+(d.note?' · '+esc(d.note):'')+'</p>'+
        (d.ad_headline?'<p class="hint">🎯 Реклама: '+esc(d.ad_headline)+(d.ad_source_url&&/^https?:\/\//.test(d.ad_source_url)?' · <a href="'+esc(d.ad_source_url)+'" target="_blank" rel="noopener noreferrer">объявление ↗</a>':'')+'</p>':'')+
        (d.lost_reason?'<p class="pre danger">Причина отказа: '+esc(d.lost_reason)+'</p>':'')+
        '<h3>💳 Поступления</h3>'+
        '<div class="metric"><span>Оплачено</span><b>'+esc(money(paid))+'</b></div>'+
        '<div class="metric"><span>Остаток</span><b class="'+(due>0?'danger':'')+'">'+esc(money(due))+'</b></div>'+
        payments.map(function(p){return '<div class="pay-row"><span>'+esc(money(p.amount))+' · '+esc(day(p.ts))+(p.note?' · '+esc(p.note):'')+'</span><button class="ghost danger" data-pay="'+esc(p.id)+'">✕</button></div>';}).join('')+
        '<form id="pay-form" class="sub-form">'+field('Добавить поступление, ₸','pay_amount','','number','min="1" max="1000000000000" step="0.01"')+field('Комментарий','pay_note','','text','maxlength="300"')+'<button class="ghost" type="submit">+ Добавить оплату</button><p class="error" data-error role="alert"></p></form>'+
        '<h3>🚚 Доставка</h3><p class="muted">'+(deliveryBits?esc(deliveryBits):'Адрес не указан — заполни в «Клиент и доставка»')+(deliveryWhen?' · '+esc(deliveryWhen):'')+'</p>'+
        (d.is_won&&!files.length?'<p class="hint">⚠ Документ оплаты (Kaspi) не прикреплён — добавьте в чате скрепкой.</p>':'')+
        '<h3>Состав</h3>'+(d.items.length?d.items.map(function(x){return '<div class="metric"><span>'+esc(x.name)+' × '+esc(x.qty)+'</span><b>'+esc(money(x.price*x.qty))+'</b></div>';}).join(''):'<p class="muted">Состав не заполнен</p>')+
        '<h3>✅ Задачи</h3>'+
        (openTasks.length?openTasks.map(taskRow).join(''):'<p class="muted">Текущих задач нет</p>')+
        (doneTasks.length?'<p class="muted" style="margin:8px 0 2px">Завершённые</p>'+doneTasks.map(taskRow).join(''):'')+
        '<form id="task-form" class="sub-form">'+field('Новая задача','task_title','','text','maxlength="300"')+field('Срок (необязательно)','task_due','','datetime-local')+'<button class="ghost" type="submit">+ Задача</button><p class="error" data-error role="alert"></p></form>'+
        '<h3>Файлы</h3><div class="files">'+files.map(function(f){
          var safe=/^\/uploads\/[\w-]+\.(jpg|png|webp|pdf)$/.test(f.url);if(!safe)return '';
          return '<a class="file" href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">'+(f.mime.indexOf('image/')===0?'<img loading="lazy" src="'+esc(f.url)+'" alt="'+esc(f.name)+'">':'PDF · ')+esc(f.name)+'</a>';
        }).join('')+(files.length?'':'<p class="muted">Файлов нет</p>')+'</div>'+
        '<div class="actions" style="margin-top:10px"><button class="ghost" id="di-edit">✏️ Изменить сделку</button><button class="ghost" id="di-client">Клиент и доставка</button></div>';
      $('di-back').onclick=function(){showDeal(d.id);};
      $('di-edit').onclick=function(){editDeal(d);};
      $('di-client').onclick=function(){showClient(d.client_id);};
      // добавить поступление
      $('pay-form').onsubmit=async function(e){e.preventDefault();var f=e.target,errb=f.querySelector('[data-error]');errb.textContent='';var amt=f.elements.namedItem('pay_amount').value;if(!(Number(amt)>0)){errb.textContent='Укажите сумму больше нуля';return;}var btn=f.querySelector('[type=submit]');btn.disabled=true;try{await api('POST','/deals/'+d.id+'/payments',{reqId:uid(),amount:amt,note:f.elements.namedItem('pay_note').value});toast('Поступление добавлено');await showDealInfo(d.id);}catch(err){errb.textContent=error(err);btn.disabled=false;}};
      // удалить поступление
      body.querySelectorAll('[data-pay]').forEach(function(b){b.onclick=async function(){if(!confirm('Удалить это поступление?'))return;try{await api('DELETE','/deals/'+d.id+'/payments/'+b.dataset.pay,{reqId:uid()});toast('Удалено');await showDealInfo(d.id);}catch(err){toast(error(err));}};});
      // создать задачу
      $('task-form').onsubmit=async function(e){e.preventDefault();var f=e.target,errb=f.querySelector('[data-error]');errb.textContent='';var title=f.elements.namedItem('task_title').value.trim();if(!title){errb.textContent='Впишите задачу';return;}var duev=f.elements.namedItem('task_due').value;var btn=f.querySelector('[type=submit]');btn.disabled=true;try{await api('POST','/deals/'+d.id+'/tasks',{reqId:uid(),title:title,due_at:duev?duev+':00+05:00':''});toast('Задача создана');await showDealInfo(d.id);}catch(err){errb.textContent=error(err);btn.disabled=false;}};
      // отметить/удалить задачу
      body.querySelectorAll('[data-task-done]').forEach(function(b){b.onclick=async function(){try{await api('POST','/tasks/'+b.dataset.taskDone+'/done',{reqId:uid(),done:b.dataset.on!=='1'});await showDealInfo(d.id);}catch(err){toast(error(err));}};});
      body.querySelectorAll('[data-task-del]').forEach(function(b){b.onclick=async function(){try{await api('DELETE','/tasks/'+b.dataset.taskDel,{reqId:uid()});await showDealInfo(d.id);}catch(err){toast(error(err));}};});
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
        '<label class="field">Способ оплаты<select name="pay_method"><option value="">— выбрать —</option><option>Kaspi магазин</option><option>Наличные</option><option>Kaspi перевод</option><option>Рассрочка Kaspi 24 мес</option><option>Счёт на оплату</option></select></label>'+
        area('Комментарий к заказу (для производства)','sale_comment',d.sale_comment||'')+
        '<p class="hint">📎 Документ оплаты (чек Kaspi) можно прикрепить скрепкой в чате — карточка напомнит, если его нет.</p>'+
        submit('✅ Оформить продажу')+'</form>';
      wireItems();var f=$('sale-form');
      f.elements.namedItem('ship_date').required=true;
      if(d.pay_method&&f.elements.namedItem('pay_method'))f.elements.namedItem('pay_method').value=d.pay_method;
      var manualAmount=Number(d.amount)>0;
      f.elements.namedItem('amount').oninput=function(){manualAmount=true;};
      function total(){if(!manualAmount)f.elements.namedItem('amount').value=String(Math.round(readItems().reduce(function(n,x){return n+Number(x.qty||0)*Number(x.price||0);},0)*100)/100);}
      $('items').addEventListener('input',total);$('items').addEventListener('click',total);total();
      mutation(f,'POST','/deals/'+d.id+'/stage',function(){
        var b={baseRev:d.rev,stage_id:won.id,amount:val(f,'amount'),items:readItems(),ship_date:val(f,'ship_date'),pay_method:val(f,'pay_method'),sale_comment:val(f,'sale_comment')};
        if(!b.items.length)throw new Error('Добавь хотя бы одну позицию — выбери модель из каталога выше');
        if(!(Number(b.amount)>0))throw new Error('Укажи сумму продажи больше нуля');
        return b;
      },async function(){toast('Продажа оформлена ✅');await showDeal(d.id);await reload();});
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
  // перевод в «Паузу» всегда через вопрос «когда напомнить» (ставит этап + напоминание одним шагом)
  function askPause(d){
    var paused=state.stages.find(function(s){return s.code==='paused';}); if(!paused){ toast('Нет этапа «Пауза»'); return; }
    var remVal=d.remind_at?new Date(new Date(d.remind_at).getTime()+5*3600000).toISOString().slice(0,16):'';
    openSheet('⏸ На паузу','<form id="pause-form"><p class="hint">Клиент просит вернуться позже. Укажи, когда напомнить ему написать — придёт напоминание.</p>'+field('Напомнить (дата и время)','remind_at',remVal,'datetime-local','required')+submit('Поставить напоминание')+'</form>');
    var f=$('pause-form');
    f.onsubmit=async function(e){ e.preventDefault(); var rv=val(f,'remind_at'); if(!rv){ toast('Укажи дату и время'); return; }
      var btn=f.querySelector('[type=submit]'); btn.disabled=true;
      try{
        await api('POST','/deals/'+d.id+'/stage',{reqId:uid(),baseRev:d.rev,stage_id:paused.id});
        await api('POST','/deals/'+d.id+'/remind',{reqId:uid(),remind_at:rv+':00+05:00'});
        toast('На паузе · напоминание '+rv.replace('T',' ')); closeSheet(); await reload();
      }catch(err){ toast(error(err)); btn.disabled=false; }
    };
  }
  // перевод в «Отказ» сразу открывает причину (без выпадающего списка этапов — этап уже выбран)
  function askLost(d){
    var lost=state.stages.find(function(s){return s.is_lost;}); if(!lost){ toast('Нет этапа отказа'); return; }
    openSheet('✖ Отказ','<form id="lost-form"><p class="hint">Почему клиент отказался — коротко, для аналитики (можно пропустить).</p>'+area('Причина отказа','lost_reason',d.lost_reason||'')+submit('Сохранить отказ')+'</form>');
    var f=$('lost-form');
    f.onsubmit=async function(e){ e.preventDefault();
      var btn=f.querySelector('[type=submit]'); btn.disabled=true;
      try{
        await api('POST','/deals/'+d.id+'/stage',{reqId:uid(),baseRev:d.rev,stage_id:lost.id,lost_reason:val(f,'lost_reason')});
        toast('Отказ сохранён'); closeSheet(); await reload();
      }catch(err){ toast(error(err)); btn.disabled=false; }
    };
  }
  // вернуть закрытого клиента (продажа/отказ) обратно: в воронку «В работе» ИЛИ сразу в продажу текущего месяца. Переписка остаётся.
  function reopenDeal(d){
    var working=state.stages.find(function(s){return s.code==='working';})||state.stages.find(function(s){return !s.is_won&&!s.is_lost&&s.code!=='new';});
    openSheet('↩ Вернуть клиента','<p class="hint">Клиент снова на связи. Куда вернуть <b>'+esc(d.client_name)+'</b>?</p>'+
      '<div class="reopen-opts"><button class="btn block" id="ro-funnel">↩ В воронку · «В работе»</button><button class="btn block ghost-g" id="ro-sale">✅ Сразу в продажу</button></div>'+
      '<p class="hint">Переписка никуда не денется. «В работе» — вернёт карточку в воронку; «В продажу» — оформишь сделку этим месяцем.</p>');
    $('ro-funnel').onclick=async function(){ if(!working){ toast('Нет этапа «В работе»'); return; } this.disabled=true;
      try{ await api('POST','/deals/'+d.id+'/stage',{reqId:uid(),baseRev:d.rev,stage_id:working.id}); toast('Клиент вернулся в воронку'); closeSheet(); await reload(); }
      catch(err){ toast(error(err)); this.disabled=false; } };
    $('ro-sale').onclick=function(){ closeSheet(); showSale(d.id); };
  }
  async function showStage(id,known){
    if(!known){openSheet('Сменить этап','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;try{known=(await api('GET','/deals/'+id)).deal;if(gen!==sheetGeneration)return;}catch(e){body.innerHTML='<p class="error">'+esc(error(e))+'</p>';return;}}
    var d=known;
    var remVal=d.remind_at?new Date(new Date(d.remind_at).getTime()+5*3600000).toISOString().slice(0,16):'';
    openSheet('Сменить этап','<form id="stage-form">'+select('Этап','stage_id',state.stages,d.stage_id)+'<div id="won-fields" hidden><p class="hint">Для завершения сделки нужны состав и плановая дата отгрузки.</p>'+field('Сумма сделки, ₸','amount',d.amount,'number','required min="0" max="1000000000000" step="0.01"')+itemsForm(d)+'</div><div id="lost-fields" hidden>'+area('Причина отказа','lost_reason',d.lost_reason)+'</div><div id="pause-fields" hidden><p class="hint">Клиент просит вернуться позже — поставь напоминание, когда написать.</p>'+field('Напомнить (дата и время)','remind_at',remVal,'datetime-local')+'</div>'+submit('Сохранить этап')+'</form>');
    wireItems();var f=$('stage-form'), manualAmount=Number(d.amount)>0;
    f.elements.namedItem('amount').oninput=function(){manualAmount=true;};
    function total(){if(!manualAmount)f.elements.namedItem('amount').value=String(Math.round(readItems().reduce(function(n,x){return n+Number(x.qty||0)*Number(x.price||0);},0)*100)/100);}
    $('items').addEventListener('input',total);$('items').addEventListener('click',total);total();
    function change(){var s=state.stages.find(function(x){return x.id===Number(val(f,'stage_id'));});$('won-fields').hidden=!s.is_won;$('lost-fields').hidden=!s.is_lost;$('pause-fields').hidden=s.code!=='paused';
      $('won-fields').querySelectorAll('input,button').forEach(function(x){x.disabled=!s.is_won;});f.elements.namedItem('ship_date').required=s.is_won;
      if(s.is_won&&!$('items').children.length)$('add-item').click();}
    f.elements.namedItem('stage_id').onchange=change;change();
    mutation(f,'POST','/deals/'+d.id+'/stage',function(){var stage=state.stages.find(function(x){return x.id===Number(val(f,'stage_id'));});var b={baseRev:d.rev,stage_id:stage.id,lost_reason:val(f,'lost_reason')};if(stage.is_won){b.amount=val(f,'amount');b.items=readItems();b.ship_date=val(f,'ship_date');if(!b.items.length)throw new Error('Добавьте хотя бы одну позицию');}return b;},async function(){var stage=state.stages.find(function(x){return x.id===Number(val(f,'stage_id'));});if(stage&&stage.code==='paused'){var rv=val(f,'remind_at');try{await api('POST','/deals/'+d.id+'/remind',{reqId:uid(),remind_at:rv?rv+':00+05:00':null});}catch(e){}}toast('Этап сохранён');await showDeal(d.id);await reload();});
  }
  function editDeal(d){
    var payHtml=d.is_won?'<label class="field">Способ оплаты<select name="pay_method"><option value="">— выбрать —</option>'+['Kaspi магазин','Наличные','Kaspi перевод','Рассрочка Kaspi 24 мес','Счёт на оплату'].map(function(o){return '<option'+(d.pay_method===o?' selected':'')+'>'+o+'</option>';}).join('')+'</select></label>'+area('Комментарий к заказу (для производства)','sale_comment',d.sale_comment||''):'';
    openSheet('Изменить сделку','<form id="deal-form">'+field('Название','title',d.title,'text','required maxlength="200"')+field('Сумма сделки, ₸','amount',d.amount,'number','required min="0" max="1000000000000" step="0.01"')+select('Менеджер','manager_id',state.managers,d.manager_id)+source(d.source)+area('Заметка о сделке','note',d.note)+itemsForm(d)+payHtml+((d.is_won||d.is_lost)?field('Дата закрытия','closed_date',d.closed_at?new Date(new Date(d.closed_at).getTime()+5*3600000).toISOString().slice(0,10):'','date'):'')+submit()+'</form>');wireItems();
    var f=$('deal-form');if(d.is_won)f.elements.namedItem('ship_date').required=true;
    mutation(f,'PATCH','/deals/'+d.id,function(){var b={baseRev:d.rev,title:val(f,'title'),amount:val(f,'amount'),manager_id:Number(val(f,'manager_id')),source:val(f,'source'),note:val(f,'note'),items:readItems(),ship_date:val(f,'ship_date')};if(f.elements.namedItem('pay_method')){b.pay_method=val(f,'pay_method');b.sale_comment=val(f,'sale_comment');}if(f.elements.namedItem('closed_date')&&val(f,'closed_date')){var original=d.closed_at?new Date(new Date(d.closed_at).getTime()+5*3600000).toISOString().slice(0,10):'';if(val(f,'closed_date')!==original)b.closed_at=val(f,'closed_date')+'T12:00:00+05:00';}return b;},async function(){toast('Сделка сохранена');await showDeal(d.id);await reload();});
  }
  var clientSeq=0;
  async function loadClients(){var seq=++clientSeq;try{var r=await api('GET','/clients?q='+encodeURIComponent(state.q));if(state.tab!=='clients'||seq!==clientSeq)return;state.clients=r.clients;$('main').innerHTML='<div class="content"><button class="btn" id="new-deal-c" style="margin:0 0 10px;padding:8px 13px;min-height:36px;font-size:14px">+ Новый клиент</button>'+(r.clients.length?r.clients.map(function(c){return '<button class="card client-row" data-client="'+esc(c.id)+'"><strong>'+esc(c.name)+'</strong><div class="muted">'+esc(c.phone||'Без телефона')+' · Сделок: '+esc(c.deals_count)+'</div></button>';}).join(''):'<div class="empty">'+(state.q?'Клиенты не найдены':'Клиенты появятся после создания первой заявки')+'</div>')+'</div>';$('new-deal-c').onclick=function(){quickDeal();};$('main').querySelectorAll('[data-client]').forEach(function(b){b.onclick=function(){showClient(b.dataset.client);};});}catch(e){if(state.tab==='clients')$('status').textContent=error(e);}}
  async function showClient(id){
    openSheet('Клиент','<div class="empty">Загрузка…</div>');var gen=sheetGeneration;
    try{var r=await api('GET','/clients/'+id);if(gen!==sheetGeneration)return;var c=r.client;$('sheet-title').textContent=c.name;
      var delivery=(c.city||c.address)?'<p class="muted">📍 '+esc([c.city,c.address].filter(Boolean).join(', '))+'</p>':'';
      body.innerHTML=contactLinks(c)+'<p class="muted">'+esc(c.source||'Без источника')+(c.instagram?' · Instagram: '+esc(c.instagram):'')+'</p>'+delivery+'<p class="pre">'+esc(c.note)+'</p><div class="actions"><button class="btn" id="client-new">+ Заявка</button><button class="ghost" id="client-edit">Изменить клиента</button></div><h3>История сделок</h3>'+r.deals.map(function(d){return '<button class="card client-row" data-deal="'+esc(d.id)+'"><strong>'+esc(d.title)+'</strong><div class="muted">'+esc(d.stage_name)+' · '+esc(money(d.amount))+' · '+esc(stamp(d.created_at))+'</div></button>';}).join('');bindDeals(body);
      $('client-new').onclick=function(){quickDeal(c);};$('client-edit').onclick=function(){openSheet('Изменить клиента','<form id="client-form">'+clientForm(c)+submit()+'</form>');var f=$('client-form');mutation(f,'PATCH','/clients/'+c.id,function(){return {baseRev:c.rev,name:val(f,'name'),phone:val(f,'phone'),city:val(f,'city'),address:val(f,'address'),instagram:val(f,'instagram'),source:val(f,'source'),note:val(f,'note')};},async function(){toast('Клиент сохранён');await showClient(c.id);await reload();});};
    }catch(e){if(gen===sheetGeneration)body.innerHTML='<p class="error">'+esc(error(e))+'</p>';}
  }
  var range=null,analyticsSeq=0;
  async function renderAnalytics(){
    var seq=++analyticsSeq;
    try{var a=await api('GET','/analytics'+(range?'?from='+range.from+'&to='+range.to:''));if(state.tab!=='analytics'||seq!==analyticsSeq)return;
      $('main').innerHTML='<div class="content"><form id="range-form"><div class="split">'+field('С','from',a.from,'date','required')+field('По','to',a.to,'date','required')+'</div><button class="ghost" type="submit">Показать период</button></form><p class="hint">Даты по времени Астаны, обе границы включены.</p>'+(a.missing&&(a.missing.undated_closed||a.missing.undated_leads)?'<p class="hint">Импорт без дат: заявок — '+esc(a.missing.undated_leads)+', закрытий — '+esc(a.missing.undated_closed)+'. Они не включены в соответствующие показатели за период.</p>':'')+'<div class="stats"><div class="card"><div class="muted">Новых заявок</div><div class="stat">'+esc(a.leads)+'</div></div><div class="card"><div class="muted">Конверсия</div><div class="stat">'+esc(a.conversion)+'%</div></div><div class="card"><div class="muted">Продаж за период</div><div class="stat">'+esc(a.sales_count)+'</div></div><div class="card"><div class="muted">Сумма продаж</div><div class="stat">'+esc(money(a.sales_amount))+'</div></div></div><p class="hint">Конверсия: выполненные из заявок, созданных за период ('+esc(a.won)+' / '+esc(a.leads)+'). Продажи: выполненные сделки по дате закрытия. Это сумма сделок, не движения денег в кассе.</p>'+(a.base?'<div class="card"><h2>База клиентов · за всё время</h2><div class="metric"><span>Покупателей всего</span><b>'+esc(a.base.buyers)+'</b></div><div class="metric"><span>Разовые / Повторные</span><b>'+esc(a.base.one_time)+' / '+esc(a.base.repeat_buyers)+'</b></div><div class="metric"><span>Средний чек продажи</span><b>'+esc(money(a.base.avg_check))+'</b></div></div>':'')+'<div class="card"><h2>Все сделки по этапам · сейчас</h2>'+a.stages.map(function(s){return '<div class="metric"><span>'+esc(s.name)+' · '+esc(s.count)+'</span><b>'+esc(money(s.amount))+'</b></div>';}).join('')+'</div><div class="card"><h2>Источники заявок за период</h2>'+(a.sources.length?a.sources.map(function(s){return '<div class="metric"><span>'+esc(s.source||'Без источника')+'</span><b>'+esc(s.count)+'</b></div>';}).join(''):'<p class="muted">Нет заявок за период</p>')+'</div></div>';
      $('range-form').onsubmit=function(e){e.preventDefault();var f=e.target;range={from:val(f,'from'),to:val(f,'to')};renderAnalytics();};
    }catch(e){if(state.tab==='analytics')$('status').textContent=error(e);}
  }
  async function copy(t){try{await navigator.clipboard.writeText(t.text);toast('Шаблон скопирован');}catch(e){openSheet('Скопируйте текст',area(t.title,'copy',t.text));var el=body.querySelector('textarea');el.readOnly=true;el.focus();el.select();}}
  function bindCopy(root){root.querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){var t=state.templates.find(function(x){return x.id===Number(b.dataset.copy);});if(t)copy(t);};});}
  // ---------- вкладка «Агент»: видимый шкаф знаний (инструкция + материалы + уроки) ----------
  var agentKb=null, agentRev=0, agentSecrets={};
  async function saveAgent(){ try{ var r=await api('PUT','/agent-kb',{reqId:uid(),data:agentKb,baseRev:agentRev}); agentRev=r.rev; return true; }catch(e){ if(e&&e.status===409){ toast('База агента изменилась — обновляю'); await renderAgent(); } else toast(error(e)); return false; } }
  function agAddMaterial(type){
    var title=(prompt('Подпись (что это):','')||'').trim(); if(!title)return;
    var when=(prompt('Когда использовать (в какой момент отправлять клиенту):','')||'').trim();
    if(type==='link'){ var url=(prompt('Ссылка (URL):','')||'').trim(); if(!url)return; agentKb.materials.push({type:'link',title:title,when:when,value:url}); saveAgent().then(function(ok){if(ok)drawAgent();}); return; }
    var inp=document.createElement('input'); inp.type='file'; inp.accept='image/jpeg,image/png,image/webp';
    inp.onchange=async function(){ var f=inp.files[0]; if(!f)return; if(f.size>5*1024*1024){toast('Фото до 5 МБ');return;} toast('Загрузка фото…');
      try{ var d=await fileData(f); var r=await api('POST','/upload',{reqId:uid(),data:d}); agentKb.materials.push({type:'image',title:title,when:when,value:r.url}); if(await saveAgent())drawAgent(); }catch(e){toast(error(e));} };
    inp.click();
  }
  function agPill(txt,cls){ return '<span class="ag-pill '+cls+'">'+esc(txt)+'</span>'; }
  // Провайдеры и их модели. type: subscription (по подписке) | tokens (по токенам/ключу).
  // status здесь всегда 'off' — реальный health-check подключим в заходе 4 (тогда зелёный = реально живой канал).
  var AG_PROVIDERS=[
    {id:'anthropic',name:'Anthropic',type:'subscription',models:[['opus','Opus 4.8'],['sonnet','Sonnet 5'],['haiku','Haiku 4.5'],['fable','Fable 5']]},
    {id:'openai',name:'OpenAI',type:'subscription',models:[['gpt-top','GPT (старшая)'],['gpt-fast','GPT (быстрая)']]},
    {id:'google',name:'Google · Gemini',type:'subscription',models:[['gem-pro','Gemini Pro'],['gem-flash','Gemini Flash']]},
    {id:'openrouter',name:'OpenRouter',type:'tokens',models:[['or-any','Любая модель (по ключу)']]}
  ];
  function agProv(id){ return AG_PROVIDERS.find(function(p){return p.id===id;})||AG_PROVIDERS[0]; }
  function drawElektro(){
    var conn=agentKb.conn||{}, depth=conn.depth||'med', prov=conn.provider||'anthropic';
    var models=agProv(prov).models;
    var depths=[['low','Низкая'],['med','Средняя'],['high','Высокая']];
    // строки статуса провайдеров — честный health (пока все off/серые; зелёный загорится при реальном подключении)
    var provRows=AG_PROVIDERS.map(function(p){
      return '<div class="ag-conn-row"><div class="ag-conn-l"><span class="ag-dot off"></span><b>'+esc(p.name)+'</b>'+
        '<div class="muted">'+(p.type==='tokens'?'по токенам/ключу (не подписка)':'по подписке')+' · '+p.models.length+' модел.</div></div>'+
        '<div class="ag-conn-r">'+agPill('не подключено · заход 4','dev')+'</div></div>';
    }).join('');
    return '<div class="card"><h2>🔌 Электроящик подключений</h2>'+
      '<p class="hint">Щиток агента: провайдеры, модель, глубина, голос. Зелёная метка = реально работает. Серая = ещё не подключено, включаем по заходам. Пустых обещаний нет.</p>'+
      '<h3 class="ag-sub">Провайдеры (статус подключения)</h3>'+
      '<p class="hint">Подписки: Anthropic / OpenAI / Google. OpenRouter — отдельно, на токенах. Точка загорится зелёным ТОЛЬКО когда канал реально живой (заход 4); отвалится подписка — погаснет. Сейчас честно: не подключено.</p>'+
      '<div class="ag-conn">'+provRows+'</div>'+
      '<h3 class="ag-sub">Мозг агента</h3>'+
      '<div class="ag-conn">'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Провайдер</b><div class="muted">чья подписка/ключ</div></div>'+
          '<div class="ag-conn-r"><select id="ag-provider">'+AG_PROVIDERS.map(function(p){return '<option value="'+p.id+'"'+(prov===p.id?' selected':'')+'>'+esc(p.name)+'</option>';}).join('')+'</select></div></div>'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Модель</b><div class="muted">доступные у выбранного провайдера</div></div>'+
          '<div class="ag-conn-r"><select id="ag-model">'+models.map(function(m){return '<option value="'+m[0]+'"'+(conn.model===m[0]?' selected':'')+'>'+esc(m[1])+'</option>';}).join('')+'</select>'+agPill('вызов не подключён · заход 4','dev')+'</div></div>'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Глубина мышления</b><div class="muted">уровень рассуждения ОДНОЙ модели (не разные модели)</div></div>'+
          '<div class="ag-conn-r"><div class="ag-depth" id="ag-depth">'+depths.map(function(d){return '<button class="'+(depth===d[0]?'on':'')+'" data-depth="'+d[0]+'">'+d[1]+'</button>';}).join('')+'</div>'+agPill('сохраняется · применится с мозгом','dev')+'</div></div>'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Автопереключение</b><div class="muted">подписка кончилась/сбой → резервный провайдер, клиент без ответа не остаётся</div></div>'+
          '<div class="ag-conn-r"><label class="ag-sw"><input type="checkbox" id="ag-failover"'+(conn.failover!==false?' checked':'')+'> включить</label>'+agPill('логика — заход 4','dev')+'</div></div>'+
      '</div>'+
      '<h3 class="ag-sub">Голос и канал</h3>'+
      '<div class="ag-conn">'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Deepgram</b><div class="muted">агент ПОНИМАЕТ голосовые клиента (расшифровка прямо в чат)</div></div>'+
          '<div class="ag-conn-r"><label class="ag-sw"><input type="checkbox" id="ag-deepgram"'+(conn.deepgram?' checked':'')+'> включить</label>'+agPill('ключ не подключён · докрутить','dev')+'</div></div>'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Озвучка ответов</b><div class="muted">агент отвечает голосом (клон голоса Ульяны)</div></div>'+
          '<div class="ag-conn-r"><select id="ag-voice">'+[['eleven','ElevenLabs (топ качество + клон)'],['cartesia','Cartesia (для живого разговора)'],['minimax','MiniMax (дёшево, многоязычный)']].map(function(v){return '<option value="'+v[0]+'"'+((conn.voice||'eleven')===v[0]?' selected':'')+'>'+esc(v[1])+'</option>';}).join('')+'</select>'+agPill('движок не подключён · заход 4','dev')+'</div></div>'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>WhatsApp-канал</b><div class="muted">приём и отправка (360dialog)</div></div>'+
          '<div class="ag-conn-r">'+agPill('подключено','live')+'</div></div>'+
      '</div>'+
      '<h3 class="ag-sub">Поведение</h3>'+
      '<div class="ag-conn">'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Эскалация Ульяне</b><div class="muted">не уверен → зовёт человека, сам молчит</div></div>'+
          '<div class="ag-conn-r"><label class="ag-sw"><input type="checkbox" id="ag-escal"'+(conn.escalate!==false?' checked':'')+'> включить</label>'+agPill('логика — заход 4','dev')+'</div></div>'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Режим обучения</b><div class="muted">читает чаты (даже выключенный), не отвечает</div></div>'+
          '<div class="ag-conn-r"><label class="ag-sw"><input type="checkbox" id="ag-learn"'+(conn.learn!==false?' checked':'')+'> включить</label>'+agPill('логика — заход 4','dev')+'</div></div>'+
        '<div class="ag-conn-row"><div class="ag-conn-l"><b>Автономность от ядра</b><div class="muted">работает сам, без ядра Норы</div></div>'+
          '<div class="ag-conn-r">'+agPill('заложено в архитектуру','live')+'</div></div>'+
      '</div>'+
      '<p class="hint">Вкл/выкл агента по чатам и воронкам — на доске «Сделки». Тут — его подключения. Выбор провайдера/модели/глубины сохраняется в базу агента и переедет на твоё ядро.</p>'+
      '</div>';
  }
  function bindElektro(){
    if($('ag-provider'))$('ag-provider').onchange=async function(){ agentKb.conn=agentKb.conn||{}; agentKb.conn.provider=this.value; agentKb.conn.model=agProv(this.value).models[0][0]; if(await saveAgent())drawAgent(); };
    if($('ag-model'))$('ag-model').onchange=async function(){ agentKb.conn=agentKb.conn||{}; agentKb.conn.model=this.value; if(await saveAgent())toast('Модель сохранена'); };
    $('main').querySelectorAll('#ag-depth [data-depth]').forEach(function(b){b.onclick=async function(){ agentKb.conn=agentKb.conn||{}; agentKb.conn.depth=b.dataset.depth; if(await saveAgent())drawAgent(); };});
    ['deepgram','escalate','learn','failover'].forEach(function(k){ var id='ag-'+(k==='escalate'?'escal':k); if($(id))$(id).onchange=async function(){ agentKb.conn=agentKb.conn||{}; agentKb.conn[k]=this.checked; await saveAgent(); }; });
    if($('ag-voice'))$('ag-voice').onchange=async function(){ agentKb.conn=agentKb.conn||{}; agentKb.conn.voice=this.value; if(await saveAgent())toast('Голосовой движок сохранён'); };
  }
  // Розетки: все подключения, что подведём к агенту. Ключи вставляются на СЕРВЕРЕ (.env) — не в браузере (безопасно). Тут — карта: что, зачем, где взять ключ.
  var AG_ROZETKI=[
    {n:'Anthropic',key:'ANTHROPIC_API_KEY',ru:'мозг агента (Claude: Opus / Sonnet / Haiku / Fable)',where:'console.anthropic.com → API Keys (ключи API) → Create Key (создать ключ)'},
    {n:'OpenAI',key:'OPENAI_API_KEY',ru:'резервный мозг (GPT) для автопереключения',where:'platform.openai.com → API keys (ключи) → Create new secret key (создать секретный ключ)'},
    {n:'Google · Gemini',key:'GOOGLE_API_KEY',ru:'резервный мозг (Gemini)',where:'aistudio.google.com → Get API key (получить ключ API)'},
    {n:'Google Переводчик (Cloud Translation)',key:'GOOGLE_TRANSLATE_API_KEY',ru:'перевод чата и скриптов рус⇄каз (качество Google, 500 000 символов/мес бесплатно)',where:'console.cloud.google.com → New project (новый проект) → включить Cloud Translation API (библиотека) → APIs & Services → Credentials (учётные данные) → Create credentials → API key (ключ)'},
    {n:'OpenRouter',key:'OPENROUTER_API_KEY',ru:'единый доступ к моделям по токенам (не подписка) — для тестов',where:'openrouter.ai → Keys (ключи) → Create Key'},
    {n:'Deepgram',key:'DEEPGRAM_API_KEY',ru:'агент ПОНИМАЕТ голосовые клиента (речь → текст)',where:'console.deepgram.com → API Keys (ключи) → Create a Key (создать ключ)'},
    {n:'ElevenLabs',key:'ELEVENLABS_API_KEY',ru:'голос агента: озвучка ответов + клон голоса Ульяны',where:'elevenlabs.io → Profile (профиль) → API Key (ключ API). Клон: Voice Lab → Add Voice → нужно ~30 мин записи голоса'},
    {n:'WhatsApp · 360dialog',key:'D360_API_KEY',ru:'канал переписки WhatsApp — приём и отправка сообщений клиентам (главный ключ переезда)',where:'hub.360dialog.com → твой канал BORZO → API Key (ключ API) → Generate / Copy (создать / скопировать)'}
  ];
  function drawRozetki(){
    var rows=AG_ROZETKI.map(function(r){
      var s = r.key ? agentSecrets[r.key] : null;
      var set = r.key ? (s&&s.set) : (r.st==='live');
      var dot, pill;
      if(!r.key){ dot=(r.st==='live'?'on':'off'); pill=agPill(r.stt||'—', r.st||'dev'); }
      else if(!set){ dot='off'; pill=agPill('ключ не задан','dev'); }
      else if(!s.checked){ dot='warn'; pill=agPill('сохранён · не проверен','dev'); }
      else if(s.ok){ dot='on'; pill=agPill('рабочий ✓','live'); }
      else { dot='bad'; pill=agPill('не отвечает / ключ неверный','bad'); }
      var keyField = r.key ? '<div class="rz-key"><input type="password" placeholder="'+(set?'ключ сохранён — вставь новый, чтобы заменить':'вставь ключ')+'" data-secret="'+esc(r.key)+'" autocomplete="off"><button class="ghost" data-secret-save="'+esc(r.key)+'">Сохранить</button>'+(set?'<button class="ghost" data-secret-check="'+esc(r.key)+'">Проверить</button><button class="ghost danger" data-secret-del="'+esc(r.key)+'">Убрать</button>':'')+'</div>' : '';
      return '<div class="rz-row"><div class="rz-head"><span class="ag-dot '+dot+'"></span><b>'+esc(r.n)+'</b>'+pill+'</div>'+
        '<div class="rz-what">'+esc(r.ru)+'</div>'+
        '<div class="rz-where"><b>Где взять ключ:</b> '+esc(r.where)+'</div>'+keyField+'</div>';
    }).join('');
    return '<div class="card"><h2>🔌 Розетки — ключи подключений</h2>'+
      '<p class="hint">Вставляешь ключ прямо здесь и жмёшь «Сохранить» → он <b>шифруется на сервере</b>, в браузер обратно НЕ отдаётся (видно только «ключ сохранён»). Загорается зелёным. Виден только тебе (руководителю).</p>'+
      '<div class="rz-list">'+rows+'</div>'+
      '<p class="hint">🔒 Безопасность: ключи хранятся в зашифрованном виде на твоём сервере, не в коде страницы и не у менеджеров. Полностью «неизвлекаемо» не бывает ни у кого (сервер расшифровывает ключ в момент вызова) — но от утечки через браузер, дамп базы и доступ менеджера защищено.</p>'+
      '</div>';
  }
  async function secretCheck(name){
    try{ var r=await api('POST','/secrets/check',{reqId:uid(),name:name}); agentSecrets[name]={set:true,checked:true,ok:r.ok}; toast(r.ok?('✓ '+name.replace('_API_KEY','')+': ключ рабочий'):('✗ '+r.detail)); }
    catch(e){ agentSecrets[name]={set:true,checked:true,ok:false}; toast(error(e)); }
    drawAgent();
  }
  function bindRozetki(){
    $('main').querySelectorAll('[data-secret-save]').forEach(function(b){b.onclick=async function(){
      var name=b.dataset.secretSave, inp=$('main').querySelector('[data-secret="'+name+'"]'), v=inp?inp.value.trim():'';
      if(!v){toast('Вставь ключ');return;}
      b.disabled=true;
      try{ await api('POST','/secrets',{reqId:uid(),name:name,value:v}); if(inp)inp.value=''; toast('Ключ сохранён — проверяю…'); agentSecrets[name]={set:true,checked:false,ok:false}; await secretCheck(name); }
      catch(e){ toast(error(e)); b.disabled=false; }
    };});
    $('main').querySelectorAll('[data-secret-check]').forEach(function(b){b.onclick=async function(){ b.disabled=true; b.textContent='Проверяю…'; await secretCheck(b.dataset.secretCheck); };});
    $('main').querySelectorAll('[data-secret-del]').forEach(function(b){b.onclick=async function(){
      if(!confirm('Убрать ключ?'))return; var name=b.dataset.secretDel;
      try{ await api('POST','/secrets',{reqId:uid(),name:name,value:''}); agentSecrets[name]={set:false}; toast('Ключ убран'); drawAgent(); }catch(e){toast(error(e));}
    };});
  }
  // ---------- заход 3: живой чат с агентом (Ульяна/Руслан дообучают; сжатие в навыки) ----------
  function drawChat(){
    var chat=(agentKb.chat||[]);
    var msgs=chat.map(function(m,i){
      var mine=m.role==='me';
      return '<div class="agc-msg '+(mine?'me':'bot')+'"><div class="agc-bub">'+esc(m.text||'')+'</div>'+
        '<div class="agc-meta">'+esc(m.author||(mine?'':'агент'))+(m.ts?' · '+day(m.ts):'')+
        (mine?' <button class="scr-mini" data-toskill="'+i+'" title="сохранить это как урок агенту">📎 в урок</button>':'')+'</div></div>';
    }).join('')||'<p class="muted">Пусто. Напиши агенту: поправь поведение, задай вопрос, дай указание. Пока мозг не подключён — сообщения копятся и станут уроками; живые ответы включим в заходе 4.</p>';
    return '<div class="card agc-card"><h2>💬 Чат с агентом</h2>'+
      '<p class="hint">Тут дообучаешь агента в разговоре (голосом — когда подключим Deepgram). Важное из чата → кнопкой «📎 в урок» складывается в шкаф знаний, чтобы контекст не пух бесконечным логом.</p>'+
      '<div class="agc-log" id="agc-log">'+msgs+'</div>'+
      '<form id="agc-form" class="agc-form"><textarea id="agc-text" placeholder="Сообщение агенту…" rows="2"></textarea>'+
        '<button type="button" class="ghost" id="agc-mic" title="надиктовать (появится с Deepgram)">🎤</button>'+
        '<button type="submit" class="btn">→</button></form>'+
      '<p class="hint">'+agPill('живые ответы агента — заход 4','dev')+' '+agPill('🎤 надиктовка — с Deepgram','dev')+' Сейчас чат реально сохраняет переписку и умеет вытаскивать уроки.</p>'+
      '</div>';
  }
  function bindChat(){
    var f=$('agc-form'); if(!f)return;
    f.onsubmit=async function(e){ e.preventDefault(); var t=$('agc-text').value.trim(); if(!t)return;
      agentKb.chat=agentKb.chat||[]; agentKb.chat.push({role:'me',text:t,author:state.user.name,ts:new Date().toISOString()});
      $('agc-text').value=''; if(await saveAgent())drawAgent(); };
    if($('agc-mic'))$('agc-mic').onclick=function(){ toast('Надиктовка включится с Deepgram (заход 4)'); };
    $('main').querySelectorAll('[data-toskill]').forEach(function(b){b.onclick=async function(){ var m=agentKb.chat[Number(b.dataset.toskill)]; if(!m)return; agentKb.lessons=agentKb.lessons||[]; agentKb.lessons.unshift({text:m.text,author:m.author,ts:new Date().toISOString()}); if(await saveAgent()){toast('Сохранено в уроки');drawAgent();} };});
  }
  function drawAgent(){
    var mats=agentKb.materials.map(function(m,i){
      var body=m.type==='image'?'<img class="scr-att-img" src="'+esc(m.value||'')+'">':'<div class="scr-att-link">🔗 '+esc(m.value||'')+'</div>';
      return '<div class="scr-att"><div class="scr-att-cap">'+esc(m.title||'')+'</div>'+body+(m.when?'<div class="ag-when">📌 когда: '+esc(m.when)+'</div>':'')+'<div class="scr-msg-act"><button class="scr-edit danger" data-matdel="'+i+'">🗑 убрать</button></div></div>';
    }).join('')||'<p class="muted">Пусто. Добавь фото/ссылку, которые агент шлёт клиентам, и укажи «когда использовать».</p>';
    var lessons=agentKb.lessons.map(function(l,i){
      return '<div class="ag-lesson"><div class="ag-lesson-t">'+esc(l.text||'')+'</div><div class="muted" style="font-size:13px">'+esc(l.author||'')+(l.ts?' · '+day(l.ts):'')+' <button class="scr-mini danger" data-lesdel="'+i+'" style="margin-left:6px">🗑</button></div></div>';
    }).join('')||'<p class="muted">Пока нет уроков. Тут Ульяна оставляет коррекции: «на возражение X отвечай так», «в такой момент — вот это фото».</p>';
    var isOwner=state.user&&state.user.login==='ruslan';
    $('main').innerHTML='<div class="content">'+
      drawChat()+
      '<div class="card"><h2>🧠 Инструкция агента</h2><p class="hint">«Мозг»: кто он, как говорит, факты о товаре, отработка возражений. Правь и сохраняй.</p>'+
        '<textarea id="ag-instr" style="min-height:220px">'+esc(agentKb.instruction||'')+'</textarea>'+
        '<div class="actions"><button class="btn" id="ag-save-instr">Сохранить инструкцию</button>'+(agentKb.instruction?'':(state.user.role==='mgr'?'<button class="ghost" id="ag-seed">Загрузить базовую</button>':''))+'</div></div>'+
      '<div class="card"><h2>🧰 Шкаф материалов</h2><p class="hint">Фото и ссылки, что агент шлёт клиентам. У каждого — подпись и «когда использовать».</p>'+
        '<div id="ag-mats">'+mats+'</div>'+
        '<div class="actions"><button class="ghost" id="ag-add-img">+ Фото</button><button class="ghost" id="ag-add-link">+ Ссылка</button></div></div>'+
      '<div class="card"><h2>🎓 Уроки и коррекции</h2><p class="hint">Ульяна пишет, что поправить. Всё видно и хранится структурно — контекст агента не переполняется, знания лежат здесь, а не в бесконечной переписке.</p>'+
        '<div id="ag-lessons">'+lessons+'</div>'+
        '<form id="ag-lesson-form" class="sub-form"><textarea id="ag-lesson-text" placeholder="Новый урок агенту…" style="min-height:70px"></textarea><button class="ghost" type="submit">+ Добавить урок</button></form></div>'+
      (isOwner ? (drawElektro()+drawRozetki()) : '<p class="hint">🔒 Пульт подключений (электроящик и ключи) виден только руководителю.</p>')+
      '</div>';
    $('ag-save-instr').onclick=async function(){ agentKb.instruction=$('ag-instr').value; this.disabled=true; if(await saveAgent())toast('Инструкция сохранена'); this.disabled=false; };
    if($('ag-seed'))$('ag-seed').onclick=async function(){ try{ await api('POST','/agent-kb/seed',{reqId:uid()}); toast('Базовая инструкция загружена'); await renderAgent(); }catch(e){toast(error(e));} };
    $('ag-add-img').onclick=function(){ agAddMaterial('image'); };
    $('ag-add-link').onclick=function(){ agAddMaterial('link'); };
    $('main').querySelectorAll('[data-matdel]').forEach(function(b){b.onclick=async function(){ if(!confirm('Убрать материал?'))return; agentKb.materials.splice(Number(b.dataset.matdel),1); if(await saveAgent())drawAgent(); };});
    $('main').querySelectorAll('[data-lesdel]').forEach(function(b){b.onclick=async function(){ agentKb.lessons.splice(Number(b.dataset.lesdel),1); if(await saveAgent())drawAgent(); };});
    $('ag-lesson-form').onsubmit=async function(e){ e.preventDefault(); var t=$('ag-lesson-text').value.trim(); if(!t)return; agentKb.lessons.unshift({text:t,author:state.user.name,ts:new Date().toISOString()}); if(await saveAgent())drawAgent(); };
    bindElektro();
    bindRozetki();
    bindChat();
  }
  async function renderAgent(){
    try{ var r=await api('GET','/agent-kb'); if(state.tab!=='agent')return; agentKb=(r.data&&typeof r.data==='object')?r.data:{instruction:'',materials:[],lessons:[]}; if(!agentKb.materials)agentKb.materials=[]; if(!agentKb.lessons)agentKb.lessons=[]; if(!agentKb.conn)agentKb.conn={}; if(!agentKb.chat)agentKb.chat=[]; agentRev=r.rev||0; }
    catch(e){ if(state.tab==='agent')$('main').innerHTML='<div class="content"><p class="error">'+esc(error(e))+'</p></div>'; return; }
    agentSecrets={};
    if(state.user&&state.user.login==='ruslan'){ try{ var sr=await api('GET','/secrets'); (sr.status||[]).forEach(function(s){ agentSecrets[s.name]=s; }); }catch(e){} }
    if(state.tab!=='agent')return;
    drawAgent();
  }
  // ---------- вкладка «Отгрузки»: проданные заказы по датам отгрузки (как доска Trello) ----------
  // одна позиция как мини-карточка товара: модель жирным + атрибуты (цвет/ножки/размер) отдельными ячейками
  function shipProd(it){
    var parts=String(it.name||'').split(' · ');
    var model=parts.shift()||'—';
    var chips=parts.map(function(p){return '<span class="ship-chip">'+esc(p)+'</span>';}).join('');
    return '<div class="ship-item"><div class="ship-item-h"><b>'+esc(model)+'</b>'+(Number(it.qty)>1?'<span class="ship-qty">×'+esc(it.qty)+'</span>':'')+'</div>'+(chips?'<div class="ship-chips">'+chips+'</div>':'')+'</div>';
  }
  function shipCard(s){
    var addr=[s.city,s.address].filter(Boolean).join(', ');
    var done=s.ship_status==='shipped';
    var prod=(s.items&&s.items.length)?s.items.map(shipProd).join(''):'<div class="ship-item muted">Состав не указан</div>';
    return '<article class="deal ship-card'+(done?' done':'')+(!s.is_won?' prep':'')+'">'+
      '<div class="ship-top"><strong>'+esc(s.client_name||'Клиент')+'</strong>'+(!s.is_won?'<span class="ship-tag">подготовка</span>':'')+'</div>'+
      '<div class="ship-prod">'+prod+'</div>'+
      (addr?'<div class="ship-addr">📍 '+esc(addr)+'</div>':'<div class="ship-addr muted">📍 адрес не указан</div>')+
      (s.pay_method?'<div class="ship-meta">💳 '+esc(s.pay_method)+'</div>':'')+
      (s.ship_time?'<div class="ship-meta">🕑 '+esc(s.ship_time)+'</div>':'')+
      (s.sale_comment?'<div class="ship-meta">📝 '+esc(s.sale_comment)+'</div>':'')+
      '<div class="ship-acts">'+
        '<label class="ship-chk"><input type="checkbox" data-ship-wo="'+esc(s.id)+'"'+(s.writeoff?' checked':'')+'> Списание</label>'+
        (done?'<button class="ghost" data-ship-undo="'+esc(s.id)+'">↩ вернуть</button>':'<button class="ghost" data-ship-done="'+esc(s.id)+'">✅ Отгружено</button>')+
        '<button class="ghost" data-ship-open="'+esc(s.id)+'">открыть</button>'+
      '</div></article>';
  }
  async function renderShipments(){
    try{ var r=await api('GET','/shipments'); if(state.tab!=='ship')return;
      var all=r.shipments;
      var prep=all.filter(function(s){return s.ship_status!=='shipped'&&!s.is_won;});      // подготовка (продажи ещё нет)
      var ready=all.filter(function(s){return s.ship_status!=='shipped'&&s.is_won;});       // проданные, ждут отгрузки
      var shipped=all.filter(function(s){return s.ship_status==='shipped';});
      var groups={},order=[];
      ready.forEach(function(s){ var k=s.ship_date||'📦 Без даты'; if(!groups[k]){groups[k]=[];order.push(k);} groups[k].push(s); });
      var cols='';
      cols+='<section class="column"><header class="col-head"><h2><span class="dot"></span>🔧 Подготовить к отгрузке</h2><div class="muted">'+prep.length+'</div></header>'+(prep.length?prep.map(shipCard).join(''):'<div class="empty">Пусто</div>')+'</section>';
      cols+=order.map(function(k){
        return '<section class="column"><header class="col-head"><h2><span class="dot"></span>'+esc(k)+'</h2><div class="muted">'+groups[k].length+' заказ(ов)</div></header>'+groups[k].map(shipCard).join('')+'</section>';
      }).join('');
      if(shipped.length) cols+='<section class="column won"><header class="col-head"><h2><span class="dot"></span>✅ Отгружено</h2><div class="muted">'+shipped.length+'</div></header>'+shipped.map(shipCard).join('')+'</section>';
      $('main').innerHTML='<div class="content" style="padding-top:8px"><button class="btn block" id="ship-add">➕ Добавить заказ на отгрузку</button></div><div class="board" aria-label="Отгрузки">'+cols+'</div>';
      $('ship-add').onclick=openShipForm;
      attachBoardDrag($('main').querySelector('.board'));
      bindShip($('main'));
    }catch(e){ if(state.tab==='ship')$('main').innerHTML='<div class="content"><p class="error">'+esc(error(e))+'</p></div>'; }
  }
  function openShipForm(){
    openSheet('Новый заказ на отгрузку','<form id="ship-form"><p class="hint">Клиент заводится в CRM (для точной аналитики). Если продажи ещё нет — заказ встанет в «Подготовить к отгрузке».</p>'+
      field('Имя клиента','name','','text','required maxlength="200"')+
      field('Телефон','phone','','tel','placeholder="+7 700 000 00 00"')+
      field('Город','city','','text','maxlength="100"')+
      field('Адрес доставки','address','','text','maxlength="300"')+
      itemsForm({items:[]})+
      area('Комментарий для производства','sale_comment','')+
      submit('Добавить в отгрузки')+'</form>');
    wireItems();
    var f=$('ship-form');
    mutation(f,'POST','/shipments',function(){ var its=readItems(); if(!its.length)throw new Error('Добавь хотя бы одну позицию из каталога'); return {reqId:uid(),name:val(f,'name'),phone:val(f,'phone'),city:val(f,'city'),address:val(f,'address'),ship_date:val(f,'ship_date'),sale_comment:val(f,'sale_comment'),items:its}; },async function(){ closeSheet(); toast('Заказ добавлен в отгрузки'); renderShipments(); });
  }
  function bindShip(root){
    root.querySelectorAll('[data-ship-wo]').forEach(function(b){b.onchange=async function(){ try{ await api('POST','/deals/'+b.dataset.shipWo+'/ship',{reqId:uid(),writeoff:b.checked}); }catch(e){ toast(error(e)); b.checked=!b.checked; } };});
    root.querySelectorAll('[data-ship-done]').forEach(function(b){b.onclick=async function(){ try{ await api('POST','/deals/'+b.dataset.shipDone+'/ship',{reqId:uid(),shipped:true}); toast('Отгружено ✅'); renderShipments(); }catch(e){ toast(error(e)); } };});
    root.querySelectorAll('[data-ship-undo]').forEach(function(b){b.onclick=async function(){ try{ await api('POST','/deals/'+b.dataset.shipUndo+'/ship',{reqId:uid(),shipped:false}); renderShipments(); }catch(e){ toast(error(e)); } };});
    root.querySelectorAll('[data-ship-open]').forEach(function(b){b.onclick=function(){ showDeal(b.dataset.shipOpen); };});
  }
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
    openSheet(m.name,'<div style="text-align:right;margin:-6px 0 4px"><button class="ghost" id="m-rename" style="padding:4px 10px;font-size:14px">✏️ название</button></div>'+
      '<div id="var-list">'+vs.map(function(v){
        var dims=[v.len,v.width,m.sizeNote].filter(Boolean).join(' · ');
        return '<div class="card cat-var" data-vid="'+v.id+'" style="display:flex;gap:12px;align-items:center">'+
          '<span class="drag-h" data-drag title="Зажми и перетащи">✥</span>'+
          (v.photo?'<img loading="lazy" src="'+esc(v.photo)+'" alt="" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex:0 0 64px">':'<span style="width:64px;height:64px;border-radius:10px;background:var(--card2,#20242c);display:flex;align-items:center;justify-content:center;flex:0 0 64px">📦</span>')+
          '<span style="flex:1;min-width:0">'+
            '<strong style="font-size:15.5px">'+esc(variantLabel(v,m))+'</strong>'+
            (dims?'<div class="muted" style="font-size:14px">'+esc(dims)+'</div>':'')+
            (v.code?'<div class="muted" style="font-size:13.5px">'+esc(v.code)+'</div>':'')+
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
      (vid?'<div style="text-align:center;margin-top:10px"><button class="ghost" id="ev-del" style="font-size:14px;color:var(--mut,#9aa0a8)">убрать вариант из каталога</button></div>':''));
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
  // визуальный пикер каталога: карточки моделей → варианты (фото + цвет корпуса/ножек/длина + цена) → позиция в состав
  function pickerHtml(){return '<button type="button" class="ghost block" id="cat-pick-btn">➕ Выбрать из каталога</button><div id="cat-pick-panel" class="cat-pick-panel" hidden></div>';}
  async function wirePicker(){
    var btn=$('cat-pick-btn'), panel=$('cat-pick-panel'); if(!btn)return;
    try{await loadCatalog();}catch(e){ btn.disabled=true; btn.textContent='Каталог недоступен'; return; }
    function rebindRemove(){ $('items').querySelectorAll('[data-remove]').forEach(function(x){x.onclick=function(){x.closest('.item').remove();$('items').dispatchEvent(new Event('input'));};}); }
    function showModels(){
      var ms=cat.models.filter(function(m){return !m.archived&&variantsOf(m).length;});
      panel.innerHTML = ms.length? ms.map(function(m){ var vs=variantsOf(m); var ph=vs.filter(function(v){return v.photo;})[0];
        return '<button type="button" class="cat-pick-m" data-pm="'+m.id+'">'+(ph?'<img src="'+esc(ph.photo)+'">':'<span class="cat-pick-noimg">🖼</span>')+'<span class="cat-pick-mt"><b>'+esc(m.name)+'</b><small>'+vs.length+' вариант(ов)</small></span></button>';
      }).join('') : '<div class="muted">Каталог пуст — сначала заполни его во вкладке «Каталог».</div>';
      panel.querySelectorAll('[data-pm]').forEach(function(b){b.onclick=function(){showVariants(Number(b.dataset.pm));};});
    }
    function showVariants(mid){
      var m=cat.models.find(function(x){return x.id===mid;}); var vs=variantsOf(m);
      panel.innerHTML='<button type="button" class="cat-pick-back" id="cat-pick-back">← к моделям</button>'+vs.map(function(v){
        return '<button type="button" class="cat-pick-v" data-pv="'+v.id+'">'+(v.photo?'<img src="'+esc(v.photo)+'">':'<span class="cat-pick-noimg">🖼</span>')+'<span class="cat-pick-vt"><b>'+esc(m.name)+'</b><small>'+esc(variantLabel(v,m))+'</small></span><em>'+(v.price!=null?esc(money(v.price)):'цены нет')+'</em></button>';
      }).join('');
      $('cat-pick-back').onclick=showModels;
      panel.querySelectorAll('[data-pv]').forEach(function(b){b.onclick=function(){
        var v=cat.variants.find(function(x){return x.id===Number(b.dataset.pv);});
        var name=m.name+(variantLabel(v,m)!=='базовый'?' · '+variantLabel(v,m):'');
        $('items').insertAdjacentHTML('beforeend',itemHtml({name:name,qty:1,price:v.price!=null?v.price:0,variant_id:v.id}));
        rebindRemove(); $('items').dispatchEvent(new Event('input'));
        panel.hidden=true; btn.textContent='➕ Добавить ещё из каталога'; toast('Добавлено: '+name);
      };});
    }
    btn.onclick=function(){ panel.hidden=!panel.hidden; if(!panel.hidden)showModels(); };
  }
  async function tab(name){
    state.tab=name;$('toolbar').hidden=!['deals','clients'].includes(name);updateMasterTop();
    document.body.classList.toggle('view-deals', name==='deals');   // на доске страница не скроллится в пустоту (колонки скроллятся сами)
    document.querySelectorAll('[data-tab]').forEach(function(b){b.classList.toggle('on',b.dataset.tab===name);if(b.dataset.tab===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    if(name==='deals')renderDeals();else if(name==='clients')await loadClients();else if(name==='analytics')await renderAnalytics();else if(name==='templates')await renderTemplates();else if(name==='agent')await renderAgent();else if(name==='ship')await renderShipments();else if(name==='catalog')await renderCatalog();else if(name==='import'&&state.user.role==='mgr')renderImport();
  }
  var searchTimer;
  $('search').oninput=function(){state.q=this.value.trim().toLowerCase();clearTimeout(searchTimer);if(state.tab==='deals')renderDeals();else searchTimer=setTimeout(loadClients,200);};
  $('ag-master-top').onclick=async function(){ try{ var r=await api('POST','/agent-settings',{reqId:uid(),global:!(state.agentGlobal===true)}); state.agentGlobal=r.agentGlobal===true; state.agentStages=r.agentStages||{}; updateMasterTop(); if(state.tab==='deals')renderDeals(); }catch(e){ toast(error(e)); } };
  $('refresh').onclick=reload;
  if($('push-btn'))$('push-btn').onclick=function(){ if(window.BorzoPush)BorzoPush.enable(); else toast('Модуль уведомлений не загружен'); };
  document.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){if(state.user)tab(b.dataset.tab);};});
  if(!API.token){location.replace('login.html?next=crm.html');return;}
  API.me().then(async function(r){
    if(!['mgr','fin'].includes(r.user.role)){location.replace('home.html');return;}
    state.user=r.user;var m=await api('GET','/meta');state.stages=m.stages;state.managers=m.managers;state.userId=m.user_id;state.agentGlobal=m.agentGlobal===true;state.agentStages=m.agentStages||{};
    $('who').textContent=r.user.name;$('import-tab').hidden=r.user.role!=='mgr';await reload();
  }).catch(function(e){$('main').innerHTML='<div class="content"><p class="error">'+esc(error(e))+'</p><button class="ghost" id="retry-start">Повторить</button></div>';$('retry-start').onclick=function(){location.reload();};});
  setInterval(function(){if(state.user&&sheet.hidden&&!document.hidden&&state.tab==='deals')reload();},20000);
  window.addEventListener('online',function(){if(state.user)reload();});
  // авто-обновление приложения: если выложена новая версия crm.js — страница сама перезагрузится (при открытии и раз в 90с), чтобы правки долетали без ручного сброса
  (function(){
    var sc=document.querySelector('script[src*="crm.js"]'); var mine=((sc&&sc.src||'').match(/[?&]v=([\w-]+)/)||[])[1]||'';
    function check(){ if(!mine)return; fetch('crm.html?_='+Date.now(),{cache:'no-store'}).then(function(r){return r.text();}).then(function(h){
      var m=h.match(/crm\.js\?v=([\w-]+)/); var srv=m&&m[1];
      if(srv&&srv!==mine){ var ae=document.activeElement; if(ae&&/^(INPUT|TEXTAREA)$/.test(ae.tagName))return; location.reload(); }
    }).catch(function(){}); }
    setInterval(check,90000);
    document.addEventListener('visibilitychange',function(){ if(!document.hidden)check(); });
    window.addEventListener('focus',check);
  })();
})();
