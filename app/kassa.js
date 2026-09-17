/* BORZO — Касса снабжения (боевой фронтенд на серверном API).
   Данные с сервера (общая база), роль из логина. Поток: выдача → подтверждение → трата с документом → списание → приход на склад,
   плюс двустороннее согласование правок. */
(function(){
  var $=function(id){return document.getElementById(id);};
  function money(n){ return (Math.round(+n)||0).toLocaleString('ru-RU')+' ₸'; }
  function pad(x){ return x<10?'0'+x:''+x; }
  function stamp(ts){ var d=new Date(+ts); return pad(d.getDate())+'.'+pad(d.getMonth()+1)+'.'+d.getFullYear()+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function roleName(r){ return r==='mgr'?'управленец':'снабженец'; }
  function numf(v){ return parseFloat(String(v==null?'':v).replace(',','.'))||0; }  // 25,2 → 25.2
  function rowSum(i){ return Math.round(numf(i.qty)*numf(i.price)); }  // сумма позиции — до целого тенге (без тиынов)

  var STATE={ balance:0, tx:[], role:null, user:null };
  function txs(){ return STATE.tx; }
  function balance(){ return STATE.balance; }
  function sums(){
    // Потрачено/Остаток = подотчёт снабженца: закупы руководителя (by_role='mgr') сюда не входят
    var given=0,spent=0; STATE.tx.forEach(function(x){
      if(x.kind==='issue' && x.status==='accepted') given+=(+x.amount);
      if(x.kind==='expense' && x.by_role!=='mgr') spent+=(+x.amount);
    }); return {given:given,spent:spent,left:given-spent};
  }

  // ---------- дифф «было → стало» ----------
  function itemStr(i){ var p=i.price?(' × '+money(i.price)):''; return (i.name||'—')+': '+(i.qty||'?')+' '+(i.unit||'')+p+' ('+(i.cat||'')+')'; }
  function genericDiff(tx,next){
    var d=[];
    if('amount' in next && Math.round(+next.amount)!==Math.round(+tx.amount)) d.push({label:'Сумма', from:money(tx.amount), to:money(next.amount)});
    if('source' in next && next.source!==tx.source) d.push({label:'Источник', from:tx.source, to:next.source});
    if('category' in next && next.category!==tx.category) d.push({label:'Осн. категория', from:tx.category, to:next.category});
    if('items' in next){
      var a=tx.items||[], b=next.items||[], n=Math.max(a.length,b.length);
      for(var k=0;k<n;k++){
        if(!a[k]) d.push({label:'Добавлена позиция', from:'—', to:itemStr(b[k])});
        else if(!b[k]) d.push({label:'Удалена позиция', from:itemStr(a[k]), to:'—'});
        else if(itemStr(a[k])!==itemStr(b[k])) d.push({label:'Позиция', from:itemStr(a[k]), to:itemStr(b[k])});
      }
    }
    return d;
  }
  function diffRows(d){
    return '<div class="diff">'+d.map(function(c){
      return '<div class="diffrow"><div class="dl">'+c.label+'</div>'+
        '<div class="dv"><span class="from">'+c.from+'</span> <span class="arr">→</span> <span class="to">'+c.to+'</span></div></div>';
    }).join('')+'</div>';
  }

  // ---------- модалка ----------
  var sheetBg=$('sheet-bg'), sheet=$('sheet'), sheetBody=$('sheet-body'), sheetOpen=false;
  function openSheet(html){ sheetBody.innerHTML=html; sheetBg.classList.add('on'); sheet.classList.add('on'); sheetOpen=true; }
  function closeSheet(){ sheetBg.classList.remove('on'); sheet.classList.remove('on'); sheetOpen=false; }
  sheetBg.addEventListener('click',closeSheet);
  // клавиатура не должна перекрывать поле — подскроллить активное поле в видимую зону
  sheet.addEventListener('focusin',function(e){ var t=e.target; if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA')){ setTimeout(function(){ try{ t.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_){} },250); } });

  function fail(e){ alert((e&&e.message)||'Ошибка. Проверьте связь.'); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // ГГГГ-ММ-ДД → ДД.ММ.ГГГГ (для показа); некорректное — как есть
  function fmtDate(s){ var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||'')); return m?(m[3]+'.'+m[2]+'.'+m[1]):String(s||''); }
  function refresh(){ return API.kassa().then(function(d){ STATE.balance=d.balance; STATE.tx=d.tx; renderCurrent(); }).catch(function(e){ if((e&&e.message)!=='401') console.warn(e); }); }
  var viewRole=null;
  function renderCurrent(){ if(viewRole==='sup') renderSup(); else renderMgr(); }

  // ---------- фото → dataURL ----------
  function readPhoto(file, cb){
    var r=new FileReader();
    r.onload=function(e){
      if(file.type && file.type.indexOf('image/')!==0){ cb(e.target.result); return; } // PDF/файл — прикладываем как есть, без сжатия
      var img=new Image();
      img.onload=function(){
        var W=760, sc=Math.min(1,W/img.width), w=img.width*sc, h=img.height*sc;
        var c=document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        try{ cb(c.toDataURL('image/jpeg',0.7)); }catch(err){ cb(e.target.result); }
      };
      img.onerror=function(){ cb(e.target.result); };
      img.src=e.target.result;
    };
    r.readAsDataURL(file);
  }

  // ================= КАБИНЕТ СНАБЖЕНЦА =================
  function renderSup(){
    $('sup-balance').textContent=money(balance());
    var pend=txs().filter(function(x){return x.kind==='issue' && x.status==='wait';});
    var notifHtml=pend.map(function(x){
      return '<div class="card notif"><div class="row"><div class="grow">'+
        '<div style="font-weight:700">💰 Вам выдано '+money(x.amount)+'</div>'+
        '<div class="muted fz12" style="margin-top:2px">Источник: '+x.source+' · '+stamp(x.ts)+'</div></div></div>'+
        '<button class="btn btn-ok" style="margin-top:11px" data-accept="'+x.id+'">✓ Подтвердить получение</button></div>';
    }).join('') + reqPlates('mgr');
    $('sup-notifs').innerHTML=notifHtml;
    Array.prototype.forEach.call($('sup-notifs').querySelectorAll('[data-accept]'),function(b){
      b.onclick=function(){ API.accept(b.getAttribute('data-accept')).then(refresh).catch(fail); };
    });
    bindReqPlates($('sup-notifs'));

    var ins=txs().filter(function(x){return x.kind==='issue';});
    var outs=txs().filter(function(x){return x.kind==='expense';});
    $('sup-in').innerHTML = ins.length ? ins.map(opRow).join('') : '<div class="empty">Приходов пока нет. Когда управленец выдаст деньги — появятся здесь.</div>';
    $('sup-out').innerHTML = outs.length ? outs.map(opRow).join('') : '<div class="empty">Расходов пока нет. Нажмите «Закупаюсь».</div>';
    bindOpRows($('sup-in')); bindOpRows($('sup-out'));
    renderSupAnal(outs); if($('sup-sklad').style.display!=='none') renderSupSklad();
  }
  // мелкая аналитика снабжения: сумма закупок за месяц по направлениям
  function renderSupAnal(outs){
    var el=$('sup-anal'); if(!el) return;
    var d=new Date(), s=new Date(d.getFullYear(),d.getMonth(),1).getTime();
    var syr=0,gen=0,n=0; outs.forEach(function(x){ if((+x.ts)<s) return; n++; if(x.category==='Сырьё') syr+=(+x.amount); else gen+=(+x.amount); });
    var mon=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][d.getMonth()];
    el.innerHTML='<div class="kpi3" style="margin-bottom:12px">'+
      '<div class="k"><div class="l">Сырьё · '+mon+'</div><div class="v" style="color:#a78bfa">'+money(syr)+'</div></div>'+
      '<div class="k"><div class="l">Операционка · '+mon+'</div><div class="v" style="color:var(--k-amber)">'+money(gen)+'</div></div>'+
      '<div class="k"><div class="l">Закупок</div><div class="v">'+n+'</div></div></div>';
  }
  function renderSupSklad(){
    var box=$('sup-sklad'); if(!box) return;
    box.innerHTML='<div class="muted fz13" style="padding:6px 0">Загружаю склад…</div>';
    API.sklad().then(function(d){
      var it=d.items||[];
      box.innerHTML = it.length ?
        '<div class="h1">📦 Склад (накопительно)</div><table class="sk"><thead><tr><th>Позиция</th><th style="text-align:right">Всего</th><th style="text-align:right">Сумма</th></tr></thead><tbody>'+
        it.map(function(a){ var pill=a.cat==='Сырьё'?'<span class="pill pill-syr">Сырьё</span>':'<span class="pill pill-gen">Операционка</span>';
          return '<tr><td>'+a.name+' '+pill+'</td><td style="text-align:right;font-weight:600">'+(Math.round(a.qty*100)/100)+' '+a.unit+'</td><td style="text-align:right" class="muted">'+money(a.sum)+'</td></tr>';
        }).join('')+'</tbody></table>' :
        '<div class="empty">Склад пуст. Позиции появятся после закупок.</div>';
    }).catch(function(){ box.innerHTML='<div class="empty">Не удалось загрузить склад.</div>'; });
  }

  function opRow(x){
    if(x.kind==='issue'){
      var st = x.status==='accepted' ? '' : '<span class="pill pill-wait">ждёт подтверждения</span>';
      return '<div class="op" data-op="'+x.id+'"><div class="ic ic-in">⬇</div><div class="grow">'+
        '<div style="font-weight:600">Приход в кассу</div>'+
        '<div class="muted fz12">'+x.source+' · '+stamp(x.ts)+' '+st+'</div></div>'+
        '<div class="amt amt-in">+'+money(x.amount)+'</div></div>';
    }
    var cat = x.category==='Сырьё' ? '<span class="pill pill-syr">Сырьё</span>' : '<span class="pill pill-gen">Операционка</span>';
    var doc = (x.invoice||x.receipt) ? '<span class="pill pill-doc">📎 док</span>' : '<span class="pill pill-nodoc">нет док</span>';
    var pend = x.pending ? ' <span class="pill pill-wait">на согласовании</span>' : '';
    var mine = x.by_role==='mgr';   // закуп руководителя (не снабженца) — пометить
    var byPill = mine ? ' <span class="pill" style="background:rgba(59,130,246,.18);color:var(--k-blue)">закупал Руслан</span>' : '';
    var dupPill = x.dup ? ' <span class="pill" style="background:rgba(240,85,92,.18);color:var(--k-red)">⚠ возможный дубль</span>' : '';
    byPill += dupPill;
    var title = (x.items&&x.items.length) ? x.items[0].name+(x.items.length>1?' +'+(x.items.length-1):'') : 'Расход';
    return '<div class="op'+(mine?' op-mgr':'')+'" data-op="'+x.id+'"><div class="ic ic-out">🛒</div><div class="grow">'+
      '<div style="font-weight:600">'+title+byPill+'</div>'+
      '<div class="muted fz12" style="margin-top:2px">'+stamp(x.ts)+' '+cat+' '+doc+pend+'</div></div>'+
      '<div class="amt amt-out">−'+money(x.amount)+'</div></div>';
  }
  function bindOpRows(root){
    Array.prototype.forEach.call(root.querySelectorAll('[data-op]'),function(el){
      el.style.cursor='pointer';
      el.onclick=function(){ showOp(el.getAttribute('data-op')); };
    });
  }
  function reqPlates(byRole){
    var reqs=txs().filter(function(x){ return x.pending && x.pending.by===byRole; });
    return reqs.map(function(x){
      var what = x.kind==='expense' ? 'накладной' : 'выдаче';
      var head = x.pending.del ? '🗑 Запрос на удаление накладной' : ('✏️ Запрос на изменение в '+what);
      return '<div class="card notif" style="border-color:rgba(240,166,33,.5);background:rgba(240,166,33,.07)">'+
        '<div style="font-weight:700">'+head+'</div>'+
        '<div class="muted fz12" style="margin:3px 0 10px">от: '+roleName(byRole)+' · '+stamp(x.pending.t)+'</div>'+
        '<button class="btn btn-ok" data-req="'+x.id+'">Посмотреть и решить</button></div>';
    }).join('');
  }
  function bindReqPlates(root){
    Array.prototype.forEach.call(root.querySelectorAll('[data-req]'),function(b){
      b.onclick=function(){ showOp(b.getAttribute('data-req')); };
    });
  }

  function showOp(id){
    var x=txs().filter(function(t){return t.id===id;})[0]; if(!x) return;
    var R=viewRole||STATE.role, body='';   // действующая роль (в режиме «как снабженец» = sup)
    if(x.kind==='expense'){
      var items=(x.items||[]).map(function(i){
        var c=i.cat||x.category, pill=c==='Сырьё'?'<span class="pill pill-syr">Сырьё</span>':'<span class="pill pill-gen">Операционка</span>';
        var per=i.price?money(i.price):'—', sm=(i.sum||rowSum(i));
        return '<tr><td>'+i.name+' '+pill+'</td><td style="text-align:right" class="muted">'+i.qty+' '+i.unit+' × '+per+'</td><td style="text-align:right;font-weight:600;white-space:nowrap">'+money(sm)+'</td></tr>';
      }).join('');
      var ph=function(src,lbl){ if(!src) return ''; var pdf=/\.pdf$/i.test(src)||/^data:application\/pdf/.test(src); return '<div class="fld"><label>'+lbl+'</label>'+(pdf?'<a href="'+src+'" target="_blank" style="color:var(--k-blue);font-weight:600">📄 Открыть документ</a>':'<img src="'+src+'" style="width:100%;border-radius:10px">')+'</div>'; };
      body='<h3>Детали накладной</h3>'+
        '<div class="bigsum" style="color:var(--k-red)">−'+money(x.amount)+'</div>'+
        '<div class="muted fz13" style="text-align:center;margin-bottom:6px">'+stamp(x.ts)+' · осн. категория: '+x.category+'</div>'+
        ((x.inv_no||x.rec_no)?'<div class="muted fz12" style="text-align:center;margin-bottom:'+(x.doc_date?'2px':'12px')+'">'+(x.inv_no?'№ накладной: <b>'+esc(x.inv_no)+'</b>':'')+(x.inv_no&&x.rec_no?' · ':'')+(x.rec_no?'№ чека: <b>'+esc(x.rec_no)+'</b>':'')+'</div>':'')+
        (x.doc_date?'<div class="muted fz12" style="text-align:center;margin-bottom:12px">Дата документа: <b>'+esc(fmtDate(x.doc_date))+'</b></div>':'')+
        (x.dup?'<div style="text-align:center;color:var(--k-red);font-weight:700;margin-bottom:12px">⚠ Возможный дубль — такая накладная уже проводилась</div>':'')+
        (items?'<table class="sk" style="margin-bottom:14px"><thead><tr><th>Позиция</th><th style="text-align:right">Кол-во × цена</th><th style="text-align:right">Сумма</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
        ph(x.invoice,'Накладная')+ph(x.receipt,'Чек');
    } else {
      var st = x.status==='accepted' ? '<span class="pill pill-doc">получено</span>' : '<span class="pill pill-wait">ждёт подтверждения</span>';
      body='<h3>Выдача денег</h3>'+
        '<div class="bigsum" style="color:var(--k-blue)">+'+money(x.amount)+'</div>'+
        '<div class="muted fz13" style="text-align:center;margin-bottom:14px">'+x.source+' · '+stamp(x.ts)+' '+st+'</div>';
    }

    if(x.pending){
      var isDel=x.pending.del;
      var d=isDel?[]:genericDiff(x,x.pending.next);
      body+='<div class="pend"><div class="ph">'+(isDel?'🗑 Запрос на УДАЛЕНИЕ накладной':'✏️ Запрос на изменение')+' · от: '+roleName(x.pending.by)+'</div>'+
        (isDel?'<div class="fz13" style="margin:4px 0">Накладная на '+money(x.amount)+' будет удалена (уйдёт со склада и из расходов).</div>':diffRows(d))+
        (x.pending.note?'<div class="muted fz12" style="margin-top:6px">Комментарий: '+x.pending.note+'</div>':'')+'</div>';
      if(x.pending.by!==R){
        body+='<button class="btn btn-ok" id="op-appr" style="margin-bottom:8px">'+(isDel?'✓ Одобрить удаление':'✓ Одобрить изменение')+'</button>'+
              '<button class="btn btn-ghost" id="op-rej" style="margin-bottom:8px">Отклонить</button>';
      } else {
        body+='<div class="muted fz13" style="text-align:center;margin:4px 0 10px">📤 Отправлено на согласование '+roleName(x.pending.by==='sup'?'mgr':'sup')+'. Ждёт решения.</div>'+
              '<button class="btn btn-ghost" id="op-unprop" style="margin-bottom:8px;color:var(--k-red)">Отменить запрос</button>';
      }
    } else {
      if(x.kind==='expense'){
        if(R==='mgr' && x.by_role==='mgr'){   // свой закуп — правит и удаляет сам, без согласования
          body+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ Изменить</button>'+
                '<button class="btn btn-ghost" id="op-del" style="margin-bottom:8px;color:var(--k-red)">🗑 Удалить закуп</button>';
        } else {
          body+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ Изменить (через согласование)</button>'+
                '<button class="btn btn-ghost" id="op-del-req" style="margin-bottom:8px;color:var(--k-red)">🗑 Удалить (через согласование)</button>';
        }
      } else if(x.kind==='issue'){
        if(x.status==='wait' && R==='mgr'){
          body+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ Изменить</button>'+
                '<button class="btn btn-ghost" id="op-cancel" style="margin-bottom:8px;color:var(--k-red)">Отменить выдачу</button>';
        } else if(x.status==='accepted'){
          body+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ Скорректировать (через согласование)</button>';
        }
      }
    }

    if(x.log && x.log.length){
      body+='<div class="logh">История изменений</div>';
      body+=x.log.slice().reverse().map(function(e){
        var head=(e.rejected?'✕ Отклонено':'✓ Одобрено')+' · предложил '+roleName(e.by)+', '+(e.rejected?'отклонил':'одобрил')+' '+roleName(e.approver)+' · '+stamp(e.t);
        return '<div class="logi"><div class="muted fz12">'+head+'</div>'+diffRows(e.changes||[])+'</div>';
      }).join('');
    }

    body+='<button class="btn btn-ghost" id="cl">Закрыть</button>';
    openSheet(body);
    $('cl').onclick=closeSheet;
    if($('op-appr')) $('op-appr').onclick=function(){ API.approve(id).then(function(){ closeSheet(); return refresh(); }).catch(fail); };
    if($('op-rej')) $('op-rej').onclick=function(){ API.reject(id).then(function(){ closeSheet(); return refresh(); }).catch(fail); };
    if($('op-edit')) $('op-edit').onclick=function(){ if(x.kind==='expense') openEdit(id, (R==='mgr'&&x.by_role==='mgr')); else openEditIssue(id); };
    if($('op-del')) $('op-del').onclick=function(){ if(confirm('Удалить этот закуп? Он уйдёт из склада и из расходов котла.')) API.expenseDelete(id).then(function(){ closeSheet(); return refresh(); }).catch(fail); };
    if($('op-del-req')) $('op-del-req').onclick=function(){ if(confirm('Запросить удаление этой накладной? Уйдёт на согласование второй стороне.')) API.propose(id,{del:true,actAs:viewRole}).then(function(){ closeSheet(); return refresh(); }).then(function(){ alert('Запрос на удаление отправлен на согласование.'); }).catch(fail); };
    if($('op-unprop')) $('op-unprop').onclick=function(){ if(confirm('Отменить свой запрос на согласование?')) API.unpropose(id).then(function(){ closeSheet(); return refresh(); }).catch(fail); };
    if($('op-cancel')) $('op-cancel').onclick=function(){ if(confirm('Отменить эту выдачу?')) API.issueCancel(id).then(function(){ closeSheet(); return refresh(); }).catch(fail); };
  }

  // ----- форма «Закупаюсь» / редактирование -----
  var buf={invoice:null,receipt:null,items:[{name:'',qty:'',unit:'шт'}],category:'Сырьё',amount:''};
  var editingId=null;
  function openBuy(){
    editingId=null; editDirect=false;
    buf={invoice:null,receipt:null,items:[{name:'',qty:'',unit:'шт'}],category:'Сырьё',amount:'',invNo:'',recNo:'',docDate:''};
    openSheet(buyHtml()); wireBuy();
  }
  var editDirect=false;
  function openEdit(id,direct){
    var x=txs().filter(function(t){return t.id===id;})[0]; if(!x) return;
    editingId=id; editDirect=!!direct;
    buf={invoice:x.invoice||null,receipt:x.receipt||null,items:clone(x.items&&x.items.length?x.items:[{name:'',qty:'',unit:'шт'}]),category:x.category,amount:x.amount,invNo:x.inv_no||'',recNo:x.rec_no||'',docDate:x.doc_date||''};
    openSheet(buyHtml()); wireBuy();
  }
  function isPdf(d){ return typeof d==='string' && d.indexOf('data:application/pdf')===0; }
  // строка с номером документа (+ у чека кнопка автоопределения)
  function numRow(kind){
    var val = kind==='inv'?(buf.invNo||''):(buf.recNo||'');
    var ph = kind==='inv'?'№ накладной':'№ чека';
    var ai = kind==='rec' ? '<button type="button" data-scannum="rec" title="Определить № чека" style="flex:0 0 auto;padding:9px 11px;border:1px solid var(--k-line);background:var(--k-card2);color:var(--k-blue);border-radius:9px;cursor:pointer">🪄</button>' : '';
    return '<div style="display:flex;gap:6px;margin-top:6px">'+
      '<input data-num="'+kind+'" placeholder="'+ph+'" value="'+esc(val)+'" style="flex:1;min-width:0;padding:9px;background:var(--k-bg);border:1px solid var(--k-line);border-radius:9px;color:var(--k-ink);font-size:13px;font-family:inherit">'+ai+'</div>';
  }
  // слот документа: пусто → стандартный выбор (камера/галерея/файл, вкл. PDF); приложено → превью + крестик удалить
  function photoSlot(kind,label){
    var data = kind==='inv'?buf.invoice:buf.receipt;
    var base='width:100%;margin:0;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;min-height:70px';
    if(data){
      var prev = isPdf(data)?'<div style="margin-top:6px;font-size:12px">📄 документ</div>':'<img src="'+data+'" style="max-height:44px;margin-top:6px">';
      // на накладной (не PDF) слева — значок распознавания
      var ai = (kind==='inv'&&!isPdf(data)) ? '<button type="button" class="ph-ai" data-scan="1" title="Распознать позиции и №" style="position:absolute;top:3px;left:5px;background:var(--k-blue);color:#fff;border:none;border-radius:50%;width:23px;height:23px;font-size:12px;line-height:1;cursor:pointer">🪄</button>' : '';
      return '<div class="photo has" style="'+base+'">'+ai+'✓ '+label+prev+
        '<button type="button" class="ph-x" data-clr="'+kind+'" style="position:absolute;top:3px;right:5px;background:var(--k-red);color:#fff;border:none;border-radius:50%;width:23px;height:23px;font-size:15px;line-height:1;cursor:pointer">×</button></div>';
    }
    return '<label class="photo" style="'+base+'">'+label+'<input type="file" accept="image/*,application/pdf" id="ph-'+kind+'"></label>';
  }
  function buyHtml(){
    var ed=!!editingId, sy=buf.category==='Сырьё';
    return '<h3>'+(ed?'✏️ Изменить накладную':'🛒 Закуп')+'</h3>'+
      '<div class="muted fz12" style="margin-bottom:12px">'+(ed?(editDirect?'Твой закуп — правки применяются сразу, без согласования.':'Правки уйдут второй стороне на согласование — молча ничего не меняется.'):'Приложи накладную или чек (фото, скриншот или файл/PDF). На приложенной накладной слева значок 🪄 — нажми, чтобы распознать позиции и № накладной, или заполни вручную. Номера — под кнопками.'+(STATE.role==='mgr'?'Тебе документ — по желанию.':'Снабженцу документ обязателен.'))+'</div>'+
      '<div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start">'+
        '<div style="flex:1 1 0;min-width:0">'+photoSlot('inv','📎 Накладная')+numRow('inv')+'</div>'+
        '<div style="flex:1 1 0;min-width:0">'+photoSlot('rec','🧾 Чек')+numRow('rec')+'</div>'+
      '</div>'+
      '<div class="fld"><label>Дата документа <span style="color:var(--k-mut)">· распознаётся 🪄, можно поправить</span></label>'+
        '<input type="date" id="docdate" value="'+esc(buf.docDate||'')+'" style="width:100%;max-width:100%;min-width:0;box-sizing:border-box"></div>'+
      (buf.scanning?'<div class="scanning">🔎 Распознаю накладную…</div>':'')+
      '<div class="fld"><label>Что закуплено <span style="color:var(--k-mut)">· «шт» — единица, «цена/ед» — цена за штуку, точка С/О — категория</span></label><div id="items"></div>'+
        '<button class="btn-ghost" id="additem" style="border:1px dashed var(--k-line);border-radius:10px">+ Добавить позицию</button></div>'+
      '<div class="fld"><label>Направление расхода</label><div class="seg" id="cat">'+
        '<button data-c="Сырьё" class="'+(sy?'on syr':'')+'">Сырьё</button><button data-c="Операционка" class="'+(sy?'':'on gen')+'">Операционка</button></div></div>'+
      '<div class="fld"><label>Сумма расхода, ₸ <span style="color:var(--k-mut)">· считается из позиций</span></label><input type="number" inputmode="numeric" id="amt" placeholder="0" value="'+(buf.amount||'')+'"></div>'+
      (ed?'':(STATE.role==='mgr'
        ? '<div class="muted fz12" style="text-align:center;margin-bottom:10px">🛒 Прямой закуп — спишется <b style="color:var(--k-ink)">с котла (наша касса)</b>, не с кассы снабженца</div>'
        : '<div class="muted fz12" style="text-align:center;margin-bottom:10px">В кассе сейчас: <b style="color:var(--k-ink)">'+money(balance())+'</b></div>'))+
      '<button class="btn btn-buy" id="do-buy">'+(ed?(editDirect?'Сохранить':'Отправить на согласование'):'Далее — проверить →')+'</button>'+
      '<button class="btn btn-ghost" id="cancel" style="margin-top:8px">Отмена</button>';
  }
  var UNITS=['шт','м','л','кг'];
  function catOf(it){ return it.cat||buf.category; }
  function itemsTotal(){ return buf.items.reduce(function(a,it){return a+rowSum(it);},0); }
  function recalcTotal(){
    var t=Math.round(itemsTotal());
    if(t>0){ buf.amount=t; if($('amt')){ $('amt').value=t; $('amt').readOnly=true; $('amt').style.opacity=.75; } }
    else if($('amt')){ $('amt').readOnly=false; $('amt').style.opacity=1; }
  }
  function renderItems(){
    $('items').innerHTML=buf.items.map(function(it,i){
      var c=catOf(it), syr=c==='Сырьё';
      return '<div class="item-line">'+
        '<div class="ln1"><input class="nm" placeholder="наименование" value="'+(it.name||'')+'" data-i="'+i+'" data-f="name">'+
          (buf.items.length>1?'<button class="del" data-del="'+i+'">✕</button>':'')+'</div>'+
        '<div class="ln2">'+
          '<input class="qt" inputmode="decimal" placeholder="кол-во" value="'+(it.qty||'')+'" data-i="'+i+'" data-f="qty">'+
          '<button class="un" data-un="'+i+'" title="ед. изм.">'+(it.unit||'шт')+'</button>'+
          '<span class="mult">×</span>'+
          '<input class="pr" inputmode="decimal" placeholder="цена/ед" value="'+(it.price||'')+'" data-i="'+i+'" data-f="price">'+
          '<span class="eq">=</span>'+
          '<span class="rsum" data-sum="'+i+'">'+money(rowSum(it))+'</span>'+
          '<button class="catdot '+(syr?'syr':'gen')+'" data-cat="'+i+'" title="категория позиции">'+(syr?'С':'О')+'</button>'+
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call($('items').querySelectorAll('input'),function(inp){
      inp.oninput=function(){
        var i=+inp.getAttribute('data-i'), f=inp.getAttribute('data-f');
        buf.items[i][f]=inp.value;
        if(f==='qty'||f==='price'){ var s=$('items').querySelector('[data-sum="'+i+'"]'); if(s)s.textContent=money(rowSum(buf.items[i])); recalcTotal(); }
      };
    });
    Array.prototype.forEach.call($('items').querySelectorAll('[data-un]'),function(b){
      b.onclick=function(){ var i=+b.getAttribute('data-un'); var cur=buf.items[i].unit||'шт'; var n=(UNITS.indexOf(cur)+1)%UNITS.length; buf.items[i].unit=UNITS[n]; renderItems(); };
    });
    Array.prototype.forEach.call($('items').querySelectorAll('[data-cat]'),function(b){
      b.onclick=function(){ var i=+b.getAttribute('data-cat'); buf.items[i].cat=(catOf(buf.items[i])==='Сырьё')?'Операционка':'Сырьё'; renderItems(); };
    });
    Array.prototype.forEach.call($('items').querySelectorAll('[data-del]'),function(b){
      b.onclick=function(){ buf.items.splice(+b.getAttribute('data-del'),1); renderItems(); recalcTotal(); };
    });
    recalcTotal();
  }
  function autoScan(){
    buf.items=[{name:'МДФ 16мм',qty:'5',unit:'шт',price:'12000'},{name:'Ручки мебельные',qty:'10',unit:'шт',price:'850'},{name:'Грунт-эмаль',qty:'8',unit:'л',price:'2400'}];
  }
  function wireBuy(){
    renderItems();
    // «Накладная»/«Чек» — прикрепить фото ИЛИ файл (стандартный выбор: камера/галерея/файл, вкл. PDF)
    if($('ph-inv')) $('ph-inv').onchange=function(e){ if(e.target.files[0]) readPhoto(e.target.files[0],function(d){ buf.invoice=d; refreshBuy(); }); };
    if($('ph-rec')) $('ph-rec').onchange=function(e){ if(e.target.files[0]) readPhoto(e.target.files[0],function(d){ buf.receipt=d; refreshBuy(); }); };
    // 🪄 на накладной — распознать позиции + № накладной
    Array.prototype.forEach.call(sheetBody.querySelectorAll('[data-scan]'),function(b){ b.onclick=function(){
      if(!buf.invoice) return;
      buf.scanning=true; refreshBuy();
      API.scan(buf.invoice).then(function(res){
        buf.scanning=false;
        if(res.items && res.items.length) buf.items=res.items.map(function(i){return {name:i.name,qty:i.qty,unit:i.unit||'шт',price:i.price};});
        if(res.number) buf.invNo=res.number;
        if(res.date) buf.docDate=res.date;
        if(!(res.items&&res.items.length)&&!res.number) alert('Ничего не распозналось — впиши вручную.');
        refreshBuy();
      }).catch(function(){ buf.scanning=false; refreshBuy(); alert('Распознавание не сработало — впиши позиции вручную.'); });
    }; });
    // ввод номеров вручную
    Array.prototype.forEach.call(sheetBody.querySelectorAll('[data-num]'),function(inp){ inp.oninput=function(){ if(inp.getAttribute('data-num')==='inv')buf.invNo=inp.value; else buf.recNo=inp.value; }; });
    // дата документа вручную
    if($('docdate')) $('docdate').onchange=function(){ buf.docDate=$('docdate').value; };
    // 🪄 определить № чека
    Array.prototype.forEach.call(sheetBody.querySelectorAll('[data-scannum]'),function(b){ b.onclick=function(){
      if(!buf.receipt){ alert('Сначала приложи фото чека.'); return; }
      buf.scanning=true; refreshBuy();
      API.scan(buf.receipt).then(function(res){ buf.scanning=false; if(res.number)buf.recNo=res.number; if(res.date&&!buf.docDate)buf.docDate=res.date; if(!res.number)alert('Номер чека не распознан — впиши вручную.'); refreshBuy(); })
        .catch(function(){ buf.scanning=false; refreshBuy(); alert('Не удалось распознать — впиши вручную.'); });
    }; });
    // крестик — удалить приложенный документ и приложить заново
    Array.prototype.forEach.call(sheetBody.querySelectorAll('.ph-x'),function(b){ b.onclick=function(){ var k=b.getAttribute('data-clr'); if(k==='inv')buf.invoice=null; else buf.receipt=null; refreshBuy(); }; });
    $('additem').onclick=function(){ buf.items.push({name:'',qty:'',unit:'шт'}); renderItems(); };
    Array.prototype.forEach.call($('cat').querySelectorAll('button'),function(b){
      b.onclick=function(){
        buf.category=b.getAttribute('data-c');
        Array.prototype.forEach.call($('cat').querySelectorAll('button'),function(x){ x.className=''; });
        b.className='on '+(buf.category==='Сырьё'?'syr':'gen');
        renderItems();
      };
    });
    $('amt').oninput=function(){ buf.amount=$('amt').value; };
    $('cancel').onclick=closeSheet;
    $('do-buy').onclick=doBuy;
  }
  function refreshBuy(){ sheetBody.innerHTML=buyHtml(); wireBuy(); }

  function doBuy(){
    var amt=parseInt($('amt').value)||0;
    var isMgr=(viewRole!=='sup');   // правила по открытому кабинету: в режиме «как снабженец» — правила снабженца (лимит кассы, документ)
    if(amt<=0){ alert('Укажите сумму расхода'); return; }
    // документ обязателен только снабженцу; руководитель может без чека/накладной
    if(!isMgr && !buf.invoice && !buf.receipt){ alert('Прикрепите накладную или чек — без документа нельзя'); return; }
    var items=buf.items.filter(function(i){return (i.name||'').trim();}).map(function(i){return {name:i.name.trim(),qty:i.qty||'',unit:i.unit||'шт',price:i.price||'',sum:rowSum(i),cat:i.cat||buf.category};});
    if(editingId){
      if(editDirect){
        API.expenseEdit(editingId,{amount:amt,category:buf.category,items:items}).then(function(){
          editingId=null; editDirect=false; closeSheet(); return refresh();
        }).catch(fail);
      } else {
        API.propose(editingId,{next:{amount:amt,category:buf.category,items:items},actAs:viewRole}).then(function(){
          editingId=null; closeSheet(); return refresh();
        }).then(function(){ alert('Изменение отправлено на согласование второй стороне.'); }).catch(fail);
      }
      return;
    }
    if(!isMgr && amt>balance()){ alert('В кассе только '+money(balance())+' — нельзя списать больше'); return; }
    if(!items.length && !confirm('Ты не заполнил позиции (что закуплено). Тогда закуп НЕ попадёт на склад — спишется только суммой. Всё равно продолжить?')) return;
    if($('docdate')) buf.docDate=$('docdate').value;
    // контрольное окно — сводка перед списанием
    var doc = buf.invoice&&buf.receipt ? 'накладная + чек' : (buf.invoice?'накладная':(buf.receipt?'чек':'без документа'));
    var dateRow = buf.docDate ? '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="muted">Дата документа</span><b>'+esc(fmtDate(buf.docDate))+'</b></div>' : '';
    var lines = items.length ? items.map(function(i){ return '• '+esc(i.name)+' — '+(i.qty||'?')+' '+i.unit+(i.price?(' × '+money(i.price)):'')+' = '+money(i.sum); }).join('<br>') : '<span class="muted">позиции не заполнены</span>';
    openSheet('<h3>Проверьте списание</h3>'+
      '<div class="card" style="margin-bottom:14px">'+
        '<div class="row" style="justify-content:space-between"><span class="muted">Сумма</span><b style="font-size:18px;color:var(--k-red)">−'+money(amt)+'</b></div>'+
        '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="muted">Направление</span><b>'+buf.category+'</b></div>'+
        '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="muted">Документ</span><b>'+doc+'</b></div>'+
        dateRow+
        '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="muted">Откуда</span><b>'+(isMgr?'котёл (наша касса)':'касса снабженца')+'</b></div>'+
        '<div style="border-top:1px solid var(--k-line);margin-top:10px;padding-top:10px;font-size:13px">'+lines+'</div>'+
      '</div>'+
      '<button class="btn btn-buy" id="cf-yes">💸 Списать</button>'+
      '<button class="btn btn-ghost" id="cf-no" style="margin-top:8px">← Назад, поправить</button>');
    $('cf-no').onclick=function(){ openSheet(buyHtml()); wireBuy(); };   // buf сохранён — вернёт с данными
    $('cf-yes').onclick=function(){
      $('cf-yes').disabled=true;
      API.expense({amount:amt,category:buf.category,items:items,invoice:buf.invoice,receipt:buf.receipt,invNo:buf.invNo||'',recNo:buf.recNo||'',docDate:buf.docDate||'',asSup:(viewRole==='sup'&&STATE.role==='mgr')})
        .then(function(r){ closeSheet(); if(r&&r.dup) alert('⚠ ВНИМАНИЕ: такая же накладная уже проводилась ранее — возможный дубль. Помечено, руководитель увидит.'); return refresh(); })
        .catch(function(e){ $('cf-yes').disabled=false; fail(e); });
    };
  }

  function openEditIssue(id){
    var x=txs().filter(function(t){return t.id===id;})[0]; if(!x) return;
    var direct = (x.status==='wait' && STATE.role==='mgr');
    openSheet('<h3>'+(direct?'✏️ Изменить выдачу':'✏️ Скорректировать выдачу')+'</h3>'+
      (direct?'':'<div class="muted fz12" style="margin-bottom:12px">Правка уйдёт второй стороне на согласование — задним числом в одиночку изменить нельзя.</div>')+
      '<div class="fld"><label>Сумма, ₸</label><input type="number" inputmode="numeric" id="e-amt" value="'+Math.round(+x.amount)+'"></div>'+
      '<div class="fld"><label>Источник</label><select id="e-src">'+
        ['Наличные','Каспий','Карта','Ульяна'].map(function(s){return '<option'+(s===x.source?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>'+
      '<button class="btn btn-give" id="e-do">'+(direct?'Сохранить':'Отправить на согласование')+'</button>'+
      '<button class="btn btn-ghost" id="e-cancel" style="margin-top:8px">Отмена</button>');
    $('e-cancel').onclick=closeSheet;
    $('e-do').onclick=function(){
      var a=parseInt($('e-amt').value)||0; if(a<=0){ alert('Укажите сумму'); return; }
      var next={amount:a,source:$('e-src').value};
      if(direct){ API.issueEdit(id,next).then(function(){ closeSheet(); return refresh(); }).catch(fail); }
      else API.propose(id,{next:next}).then(function(){ closeSheet(); return refresh(); }).then(function(){ alert('Корректировка отправлена на согласование.'); }).catch(fail);
    };
  }

  // ================= КАБИНЕТ УПРАВЛЕНЦА =================
  var mgrMon=0;  // 0 = текущий месяц, -1 = прошлый и т.д.
  var MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  function monthLabel(off){ var d=new Date(), m=new Date(d.getFullYear(),d.getMonth()+off,1); return MONTHS[m.getMonth()]+' '+m.getFullYear(); }
  function sumsMonth(off){ var d=new Date(), s=new Date(d.getFullYear(),d.getMonth()+off,1).getTime(), e=new Date(d.getFullYear(),d.getMonth()+off+1,1).getTime(), given=0,spent=0;
    STATE.tx.forEach(function(x){ var t=+x.ts; if(t<s||t>=e)return; if(x.kind==='issue'&&x.status==='accepted')given+=(+x.amount); if(x.kind==='expense'&&x.by_role!=='mgr')spent+=(+x.amount); }); return {given:given,spent:spent}; }
  function renderMgr(){
    var sm=sumsMonth(mgrMon);
    $('mgr-given').textContent=money(sm.given); $('mgr-spent').textContent=money(sm.spent); $('mgr-left').textContent=money(balance());
    var nb='padding:4px 12px;border:1px solid var(--k-line);background:var(--k-card2);color:var(--k-ink);border-radius:8px;font-weight:700;cursor:pointer';
    $('mgr-mon').innerHTML='<button id="mgr-prev" style="'+nb+'">‹</button><span style="font-weight:700;font-size:13px;min-width:120px;text-align:center">'+monthLabel(mgrMon)+'</span><button id="mgr-next" style="'+nb+(mgrMon>=0?';opacity:.4':'')+'">›</button>';
    $('mgr-prev').onclick=function(){ mgrMon--; renderMgr(); };
    $('mgr-next').onclick=function(){ if(mgrMon<0){ mgrMon++; renderMgr(); } };
    $('mgr-notifs').innerHTML = reqPlates('sup');
    bindReqPlates($('mgr-notifs'));

    var issues=txs().filter(function(x){return x.kind==='issue';});
    $('mgr-issues').innerHTML = issues.length ? issues.map(function(x){
      var st = x.status==='accepted' ? '<span class="pill pill-doc">получено</span>' : '<span class="pill pill-wait">ждёт подтверждения</span>';
      var pend = x.pending ? ' <span class="pill pill-wait">на согласовании</span>' : '';
      return '<div class="op" data-op="'+x.id+'"><div class="ic ic-in">⬇</div><div class="grow">'+
        '<div style="font-weight:600">'+x.source+'</div>'+
        '<div class="muted fz12" style="margin-top:2px">'+stamp(x.ts)+' '+st+pend+'</div></div>'+
        '<div class="amt amt-in">+'+money(x.amount)+'</div></div>';
    }).join('') : '<div class="empty">Выдач ещё не было. Нажмите «Выдать деньги снабженцу».</div>';
    bindOpRows($('mgr-issues'));

    var inv=txs().filter(function(x){return x.kind==='expense';});
    $('mgr-inv').innerHTML = inv.length ? inv.map(opRow).join('') : '<div class="empty">Накладных пока нет.</div>';
    bindOpRows($('mgr-inv'));

    API.sklad().then(function(d){
      var it=d.items||[];
      $('mgr-sklad').innerHTML = it.length ?
        '<table class="sk"><thead><tr><th>Позиция</th><th style="text-align:right">Всего</th><th style="text-align:right">Сумма</th></tr></thead><tbody>'+
        it.map(function(a){ var pill=a.cat==='Сырьё'?'<span class="pill pill-syr">Сырьё</span>':'<span class="pill pill-gen">Операционка</span>';
          return '<tr><td>'+a.name+' '+pill+'</td><td style="text-align:right;font-weight:600">'+(Math.round(a.qty*100)/100)+' '+a.unit+'</td><td style="text-align:right" class="muted">'+money(a.sum)+'</td></tr>';
        }).join('')+'</tbody></table>' :
        '<div class="empty">Склад пуст. Позиции появятся после закупок снабженца.</div>';
    }).catch(function(){});
  }
  function openGive(){
    openSheet('<h3>💸 Выдать деньги снабженцу</h3>'+
      '<div class="fld"><label>Сумма, ₸</label><input type="number" inputmode="numeric" id="g-amt" placeholder="0"></div>'+
      '<div class="fld"><label>Источник</label><select id="g-src"><option>Наличные</option><option>Каспий</option><option>Карта</option><option>Ульяна</option></select></div>'+
      '<div class="muted fz12" style="margin-bottom:12px">Снабженцу придёт уведомление — он подтвердит получение, и сумма зачислится в его кассу.</div>'+
      '<button class="btn btn-give" id="g-do">Выдать</button>'+
      '<button class="btn btn-ghost" id="g-cancel" style="margin-top:8px">Отмена</button>');
    $('g-cancel').onclick=closeSheet;
    $('g-do').onclick=function(){
      var a=parseInt($('g-amt').value)||0; if(a<=0){ alert('Укажите сумму'); return; }
      API.issue({amount:a,source:$('g-src').value}).then(function(){ closeSheet(); return refresh(); }).catch(fail);
    };
  }

  // ================= вкладки =================
  $('btn-buy').onclick=openBuy;
  var bbm=$('btn-buy-mgr'); if(bbm) bbm.onclick=openBuy;
  $('btn-give').onclick=openGive;
  function supTab(which){
    var map={'in':'sup-in','out':'sup-out','sklad':'sup-sklad'};
    ['in','out','sklad'].forEach(function(k){ var v=$(map[k]); if(v)v.style.display=(k===which?'':'none'); });
    $('tab-in').className=(which==='in'?'on':''); $('tab-out').className=(which==='out'?'on':''); var ts=$('tab-sup-sklad'); if(ts)ts.className=(which==='sklad'?'on':'');
    if(which==='sklad') renderSupSklad();
  }
  $('tab-in').onclick=function(){ supTab('in'); };
  $('tab-out').onclick=function(){ supTab('out'); };
  var tss=$('tab-sup-sklad'); if(tss) tss.onclick=function(){ supTab('sklad'); };
  function mgrTab(active){
    var map={issues:'mgr-issues',inv:'mgr-inv',sklad:'mgr-sklad'};
    Object.keys(map).forEach(function(k){ $('tab-'+k).className=(k===active?'on':''); $(map[k]).style.display=(k===active?'':'none'); });
  }
  $('tab-issues').onclick=function(){ mgrTab('issues'); };
  $('tab-inv').onclick=function(){ mgrTab('inv'); };
  $('tab-sklad').onclick=function(){ mgrTab('sklad'); };
  // ================= вход по логину =================
  function applyRole(role){ STATE.role=role; viewRole=role; setView(); }
  // setView: какой кабинет показать (viewRole). STATE.role — настоящая роль (для прав), viewRole — что смотрим.
  function setView(){
    var sup=viewRole==='sup', mgr=STATE.role==='mgr';
    $('view-sup').style.display=sup?'':'none';
    $('view-mgr').style.display=sup?'none':'';
    $('u-role').textContent = sup?'Кабинет снабженца':'Кабинет управленца';
    $('ub-nav').style.display = mgr?'':'none';   // навигация и переключатель — только у управленца
    var vt=$('viewtoggle'); if(vt){ vt.textContent = sup?'↩ Вернуться к себе':'👁 Смотреть как снабженец'; vt.className = sup?'on':''; }
    $('preview-note').style.display = (mgr&&sup)?'':'none';
    renderCurrent();
  }
  var vtb=$('viewtoggle'); if(vtb) vtb.onclick=function(){ if(STATE.role!=='mgr')return; viewRole=(viewRole==='sup'?'mgr':'sup'); setView(); };
  // ---------- push-уведомления ----------
  function b64ToU8(b){ var pad='='.repeat((4-b.length%4)%4), s=(b+pad).replace(/-/g,'+').replace(/_/g,'/'); var raw=atob(s), a=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i); return a; }
  function enablePush(){
    if(!('serviceWorker' in navigator) || !('PushManager' in window)){ alert('Твой браузер не поддерживает push. На iPhone добавь приложение на домашний экран.'); return; }
    Notification.requestPermission().then(function(perm){
      if(perm!=='granted'){ alert('Уведомления не разрешены. Включи их в настройках браузера для этого сайта.'); return; }
      navigator.serviceWorker.register('/sw.js').then(function(reg){
        return API.pushKey().then(function(d){
          if(!d.key){ alert('Push на сервере не настроен.'); return; }
          return reg.pushManager.getSubscription().then(function(s){ return s || reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToU8(d.key) }); })
            .then(function(sub){ return API.pushSubscribe(sub.toJSON?sub.toJSON():sub); })
            .then(function(){ alert('Готово! Уведомления о согласованиях будут приходить сюда.'); });
        });
      }).catch(function(e){ alert('Не удалось включить уведомления: '+(e&&e.message||e)); });
    });
  }
  var nb=$('notifbtn'); if(nb) nb.onclick=enablePush;
  $('logout').onclick=function(){ API.logout(); };
  $('passbtn').onclick=function(){
    openSheet('<h3>🔑 Смена пароля</h3>'+
      '<div class="fld"><label>Текущий пароль</label><input type="password" id="p-old" autocomplete="current-password"></div>'+
      '<div class="fld"><label>Новый пароль (минимум 5 символов)</label><input type="password" id="p-new" autocomplete="new-password"></div>'+
      '<div class="fld"><label>Повторите новый пароль</label><input type="password" id="p-new2" autocomplete="new-password"></div>'+
      '<button class="btn btn-give" id="p-do">Сменить пароль</button>'+
      '<button class="btn btn-ghost" id="p-cancel" style="margin-top:8px">Отмена</button>');
    $('p-cancel').onclick=closeSheet;
    $('p-do').onclick=function(){
      var o=$('p-old').value, n=$('p-new').value, n2=$('p-new2').value;
      if(!n||n.length<5){ alert('Новый пароль — минимум 5 символов'); return; }
      if(n!==n2){ alert('Пароли не совпадают'); return; }
      API.password({old_pass:o,new_pass:n}).then(function(){ closeSheet(); alert('Пароль изменён'); }).catch(fail);
    };
  };
  if(!API.token){ location.replace('login.html'); return; }
  API.me().then(function(d){
    STATE.user=d.user;
    $('u-name').textContent=d.user.name;
    applyRole(d.user.role);
    return refresh();
  }).catch(function(e){ if((e&&e.message)==='401') return; console.warn(e); });
  // живое обновление (пока модалка закрыта) — выдачи/подтверждения/запросы прилетают сами
  setInterval(function(){ if(!sheetOpen && API.token) refresh(); }, 15000);
})();
