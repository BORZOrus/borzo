/* BORZO — Касса снабжения (прототип). Поток: выдача → подтверждение → трата с документом → списание → приход на склад.
   Данные в localStorage через DB. Роли переключаются кнопкой (демо); в проде — вход по логину, данные общие на сервере. */
(function(){
  var $=function(id){return document.getElementById(id);};
  function money(n){ return (Math.round(n)||0).toLocaleString('ru-RU')+' ₸'; }
  function short(n){ n=Math.round(n)||0; if(Math.abs(n)>=1e6) return (n/1e6).toFixed(1).replace('.',',')+'М'; if(Math.abs(n)>=1e3) return Math.round(n/1e3)+'к'; return ''+n; }
  function pad(x){ return x<10?'0'+x:''+x; }
  function stamp(d){ d=d||new Date(); return pad(d.getDate())+'.'+pad(d.getMonth()+1)+'.'+d.getFullYear()+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }

  // ---------- баланс / выборки ----------
  function txs(){ return DB.all('kassaTx').sort(function(a,b){return b.t-a.t;}); }
  function balance(){
    var b=0; DB.all('kassaTx').forEach(function(x){
      if(x.kind==='issue' && x.status==='accepted') b+=x.amount;
      if(x.kind==='expense') b-=x.amount;
    }); return b;
  }
  function sums(){
    var given=0,spent=0; DB.all('kassaTx').forEach(function(x){
      if(x.kind==='issue' && x.status==='accepted') given+=x.amount;
      if(x.kind==='expense') spent+=x.amount;
    }); return {given:given,spent:spent,left:given-spent};
  }

  // ---------- нижняя модалка ----------
  var sheetBg=$('sheet-bg'), sheet=$('sheet'), sheetBody=$('sheet-body');
  function openSheet(html){ sheetBody.innerHTML=html; sheetBg.classList.add('on'); sheet.classList.add('on'); }
  function closeSheet(){ sheetBg.classList.remove('on'); sheet.classList.remove('on'); }
  sheetBg.addEventListener('click',closeSheet);

  // ---------- сжатие фото → dataURL ----------
  function readPhoto(file, cb){
    var r=new FileReader();
    r.onload=function(e){
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

    // уведомления о выданных, но ещё не принятых суммах
    var pend=txs().filter(function(x){return x.kind==='issue' && x.status==='wait';});
    $('sup-notifs').innerHTML=pend.map(function(x){
      return '<div class="card notif"><div class="row"><div class="grow">'+
        '<div style="font-weight:700">💰 Вам выдано '+money(x.amount)+'</div>'+
        '<div class="muted fz12" style="margin-top:2px">Источник: '+x.source+' · '+stamp(new Date(x.t))+'</div></div></div>'+
        '<button class="btn btn-ok" style="margin-top:11px" data-accept="'+x.id+'">✓ Подтвердить получение</button></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-accept]'),function(b){
      b.onclick=function(){ DB.update('kassaTx',b.getAttribute('data-accept'),{status:'accepted',ta:Date.now()}); renderSup(); };
    });

    // история
    var hist=txs();
    $('sup-history').innerHTML = hist.length ? hist.map(opRow).join('') : '<div class="empty">Пока пусто. Как получите деньги и начнёте закуп — операции появятся здесь.</div>';
    bindOpRows($('sup-history'));
  }

  function opRow(x){
    if(x.kind==='issue'){
      var st = x.status==='accepted' ? '' : '<span class="pill pill-wait">ждёт подтверждения</span>';
      return '<div class="op"><div class="ic ic-in">⬇</div><div class="grow">'+
        '<div style="font-weight:600">Приход в кассу</div>'+
        '<div class="muted fz12">'+x.source+' · '+stamp(new Date(x.t))+' '+st+'</div></div>'+
        '<div class="amt amt-in">+'+money(x.amount)+'</div></div>';
    }
    var cat = x.category==='Сырьё' ? '<span class="pill pill-syr">Сырьё</span>' : '<span class="pill pill-gen">Общие</span>';
    var doc = (x.invoice||x.receipt) ? '<span class="pill pill-doc">📎 док</span>' : '<span class="pill pill-nodoc">нет док</span>';
    var title = (x.items&&x.items.length) ? x.items[0].name+(x.items.length>1?' +'+(x.items.length-1):'') : 'Расход';
    return '<div class="op" data-op="'+x.id+'"><div class="ic ic-out">🛒</div><div class="grow">'+
      '<div style="font-weight:600">'+title+'</div>'+
      '<div class="muted fz12" style="margin-top:2px">'+stamp(new Date(x.t))+' '+cat+' '+doc+'</div></div>'+
      '<div class="amt amt-out">−'+money(x.amount)+'</div></div>';
  }
  function bindOpRows(root){
    Array.prototype.forEach.call(root.querySelectorAll('[data-op]'),function(el){
      el.style.cursor='pointer';
      el.onclick=function(){ showOp(el.getAttribute('data-op')); };
    });
  }

  function showOp(id){
    var x=DB.find('kassaTx',id); if(!x) return;
    var items=(x.items||[]).map(function(i){
      var c=i.cat||x.category, pill=c==='Сырьё'?'<span class="pill pill-syr">Сырьё</span>':'<span class="pill pill-gen">Общие</span>';
      return '<tr><td>'+i.name+'</td><td style="text-align:right">'+i.qty+' '+i.unit+'</td><td style="text-align:right">'+pill+'</td></tr>';
    }).join('');
    var ph=function(src,lbl){ return src?'<div class="fld"><label>'+lbl+'</label><img src="'+src+'" style="width:100%;border-radius:10px"></div>':''; };
    openSheet('<h3>Детали накладной</h3>'+
      '<div class="bigsum" style="color:var(--k-red)">−'+money(x.amount)+'</div>'+
      '<div class="muted fz13" style="text-align:center;margin-bottom:14px">'+stamp(new Date(x.t))+' · осн. категория: '+x.category+'</div>'+
      (items?'<table class="sk" style="margin-bottom:14px"><thead><tr><th>Наименование</th><th style="text-align:right">Кол-во</th><th style="text-align:right">Тип</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
      ph(x.invoice,'Накладная')+ph(x.receipt,'Чек')+
      '<button class="btn btn-ghost" id="cl">Закрыть</button>');
    $('cl').onclick=closeSheet;
  }

  // ----- форма «Закупаюсь» -----
  var buf={invoice:null,receipt:null,items:[{name:'',qty:'',unit:'шт'}],category:'Сырьё'};
  function openBuy(){
    buf={invoice:null,receipt:null,items:[{name:'',qty:'',unit:'шт'}],category:'Сырьё'};
    openSheet(buyHtml()); wireBuy();
  }
  function buyHtml(){
    return '<h3>🛒 Закуп</h3>'+
      '<div class="muted fz12" style="margin-bottom:12px">Сфотографируйте накладную и/или чек. Без документа списание провести нельзя.</div>'+
      '<div class="row" style="gap:10px;margin-bottom:12px">'+
        '<label class="photo grow'+(buf.invoice?' has':'')+'" style="margin:0">'+(buf.invoice?'✓ Накладная<img src="'+buf.invoice+'">':'📄 Накладная')+'<input type="file" accept="image/*" capture="environment" id="ph-inv"></label>'+
        '<label class="photo grow'+(buf.receipt?' has':'')+'" style="margin:0">'+(buf.receipt?'✓ Чек<img src="'+buf.receipt+'">':'🧾 Чек')+'<input type="file" accept="image/*" id="ph-rec"></label>'+
      '</div>'+
      '<button class="scanbtn" id="scan">🔎 Сканировать накладную (распознать позиции)</button>'+
      '<div class="fld"><label>Что закуплено <span style="color:var(--k-mut)">· кнопка «шт» — единица, точка С/О — категория позиции</span></label><div id="items"></div>'+
        '<button class="btn-ghost" id="additem" style="border:1px dashed var(--k-line);border-radius:10px">+ Добавить позицию</button></div>'+
      '<div class="fld"><label>Направление расхода</label><div class="seg" id="cat">'+
        '<button data-c="Сырьё" class="on syr">Сырьё</button><button data-c="Общие">Общие</button></div></div>'+
      '<div class="fld"><label>Сумма расхода, ₸</label><input type="number" inputmode="numeric" id="amt" placeholder="0"></div>'+
      '<div class="muted fz12" style="text-align:center;margin-bottom:10px">В кассе сейчас: <b style="color:var(--k-ink)">'+money(balance())+'</b></div>'+
      '<button class="btn btn-buy" id="do-buy">Расход прошёл — списать</button>'+
      '<button class="btn btn-ghost" id="cancel" style="margin-top:8px">Отмена</button>';
  }
  var UNITS=['шт','л','лист','рул','кг','м','компл'];
  function catOf(it){ return it.cat||buf.category; }
  function renderItems(){
    $('items').innerHTML=buf.items.map(function(it,i){
      var c=catOf(it), syr=c==='Сырьё';
      return '<div class="item-line"><input class="nm" placeholder="наименование" value="'+(it.name||'')+'" data-i="'+i+'" data-f="name">'+
        '<input class="qt" inputmode="decimal" placeholder="кол-во" value="'+(it.qty||'')+'" data-i="'+i+'" data-f="qty">'+
        '<button class="un" data-un="'+i+'" title="ед. изм. — нажмите чтобы сменить">'+(it.unit||'шт')+'</button>'+
        '<button class="catdot '+(syr?'syr':'gen')+'" data-cat="'+i+'" title="категория этой позиции">'+(syr?'С':'О')+'</button>'+
        (buf.items.length>1?'<button class="del" data-del="'+i+'">✕</button>':'')+'</div>';
    }).join('');
    Array.prototype.forEach.call($('items').querySelectorAll('input'),function(inp){
      inp.oninput=function(){ buf.items[+inp.getAttribute('data-i')][inp.getAttribute('data-f')]=inp.value; };
    });
    Array.prototype.forEach.call($('items').querySelectorAll('[data-un]'),function(b){
      b.onclick=function(){ var i=+b.getAttribute('data-un'); var cur=buf.items[i].unit||'шт'; var n=(UNITS.indexOf(cur)+1)%UNITS.length; buf.items[i].unit=UNITS[n]; renderItems(); };
    });
    Array.prototype.forEach.call($('items').querySelectorAll('[data-cat]'),function(b){
      b.onclick=function(){ var i=+b.getAttribute('data-cat'); buf.items[i].cat=(catOf(buf.items[i])==='Сырьё')?'Общие':'Сырьё'; renderItems(); };
    });
    Array.prototype.forEach.call($('items').querySelectorAll('[data-del]'),function(b){
      b.onclick=function(){ buf.items.splice(+b.getAttribute('data-del'),1); renderItems(); };
    });
  }
  function wireBuy(){
    renderItems();
    $('ph-inv').onchange=function(e){ if(e.target.files[0]) readPhoto(e.target.files[0],function(d){ buf.invoice=d; refreshBuy(); }); };
    $('ph-rec').onchange=function(e){ if(e.target.files[0]) readPhoto(e.target.files[0],function(d){ buf.receipt=d; refreshBuy(); }); };
    $('additem').onclick=function(){ buf.items.push({name:'',qty:'',unit:'шт'}); renderItems(); };
    $('scan').onclick=function(){
      if(!buf.invoice){ alert('Сначала сфотографируйте накладную'); return; }
      // 🔴 ДЕМО: реальное распознавание (OCR) подключим на сервере — vision-модель разберёт позиции сама.
      buf.items=[{name:'Плёнка ПВХ матовая',qty:'3',unit:'рул'},{name:'Ручки мебельные',qty:'10',unit:'шт'},{name:'МДФ 16мм',qty:'5',unit:'лист'}];
      renderItems();
      alert('🔴 Демо-распознавание: позиции подставлены для примера. На сервере накладную будет читать ИИ и заполнять сам — вы только проверяете.');
    };
    Array.prototype.forEach.call($('cat').querySelectorAll('button'),function(b){
      b.onclick=function(){
        buf.category=b.getAttribute('data-c');
        Array.prototype.forEach.call($('cat').querySelectorAll('button'),function(x){ x.className=''; });
        b.className='on '+(buf.category==='Сырьё'?'syr':'gen');
        renderItems();
      };
    });
    $('cancel').onclick=closeSheet;
    $('do-buy').onclick=doBuy;
  }
  function refreshBuy(){ sheetBody.innerHTML=buyHtml(); wireBuy(); }

  function doBuy(){
    var amt=parseInt($('amt').value)||0;
    if(amt<=0){ alert('Укажите сумму расхода'); return; }
    if(!buf.invoice && !buf.receipt){ alert('Прикрепите накладную или чек — без документа списать нельзя'); return; }
    if(amt>balance()){ alert('В кассе только '+money(balance())+' — нельзя списать больше, чем есть'); return; }
    var items=buf.items.filter(function(i){return (i.name||'').trim();}).map(function(i){return {name:i.name.trim(),qty:i.qty||'',unit:i.unit||'шт',cat:i.cat||buf.category};});
    var now=Date.now();
    DB.add('kassaTx',{kind:'expense',t:now,amount:amt,category:buf.category,items:items,invoice:buf.invoice,receipt:buf.receipt});
    // приход на склад (позиции, каждая со своей категорией)
    items.forEach(function(i){
      DB.add('skladIntake',{t:now,date:stamp(new Date(now)),name:i.name,qty:i.qty,unit:i.unit,category:i.cat,from:'снабжение'});
    });
    closeSheet(); renderSup();
  }

  // ================= КАБИНЕТ УПРАВЛЕНЦА =================
  function renderMgr(){
    var s=sums();
    $('mgr-given').textContent=money(s.given); $('mgr-spent').textContent=money(s.spent); $('mgr-left').textContent=money(s.left);

    // вкладка 1 — выданные деньги (история всех выдач)
    var issues=txs().filter(function(x){return x.kind==='issue';});
    $('mgr-issues').innerHTML = issues.length ? issues.map(function(x){
      var st = x.status==='accepted' ? '<span class="pill pill-doc">получено</span>' : '<span class="pill pill-wait">ждёт подтверждения</span>';
      return '<div class="op"><div class="ic ic-in">⬇</div><div class="grow">'+
        '<div style="font-weight:600">'+x.source+'</div>'+
        '<div class="muted fz12" style="margin-top:2px">'+stamp(new Date(x.t))+' '+st+'</div></div>'+
        '<div class="amt amt-in">+'+money(x.amount)+'</div></div>';
    }).join('') : '<div class="empty">Выдач ещё не было. Нажмите «Выдать деньги снабженцу».</div>';

    // вкладка 2 — накладные (все закупки, клик = детали)
    var inv=txs().filter(function(x){return x.kind==='expense';});
    $('mgr-inv').innerHTML = inv.length ? inv.map(opRow).join('') : '<div class="empty">Накладных пока нет.</div>';
    bindOpRows($('mgr-inv'));
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
      DB.add('kassaTx',{kind:'issue',t:Date.now(),amount:a,source:$('g-src').value,status:'wait'});
      closeSheet(); renderMgr();
    };
  }

  // ================= роли / навигация =================
  function setRole(r){
    localStorage.setItem('kassa_role',r);
    var sup=r==='sup';
    $('view-sup').style.display=sup?'':'none';
    $('view-mgr').style.display=sup?'none':'';
    $('role-sup').className=sup?'on':'';
    $('role-mgr').className=sup?'':'on';
    if(sup) renderSup(); else renderMgr();
  }
  $('role-sup').onclick=function(){ setRole('sup'); };
  $('role-mgr').onclick=function(){ setRole('mgr'); };
  $('btn-buy').onclick=openBuy;
  $('btn-give').onclick=openGive;

  // вкладки управленца
  $('tab-issues').onclick=function(){ $('tab-issues').className='on'; $('tab-inv').className=''; $('mgr-issues').style.display=''; $('mgr-inv').style.display='none'; };
  $('tab-inv').onclick=function(){ $('tab-inv').className='on'; $('tab-issues').className=''; $('mgr-inv').style.display=''; $('mgr-issues').style.display='none'; };

  setRole(localStorage.getItem('kassa_role')||'sup');
})();
