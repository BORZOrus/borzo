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

  // ---------- роль / клоны ----------
  function role(){ return localStorage.getItem('kassa_role')||'sup'; }
  function roleName(r){ return r==='mgr'?'управленец':'снабженец'; }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function rerender(){ if(role()==='sup') renderSup(); else renderMgr(); }

  // ---------- дифф «было → стало» ----------
  function itemStr(i){ var p=i.price?(' × '+money(i.price)):''; return (i.name||'—')+': '+(i.qty||'?')+' '+(i.unit||'')+p+' ('+(i.cat||'')+')'; }
  function genericDiff(tx,next){
    var d=[];
    if('amount' in next && (+next.amount)!==(+tx.amount)) d.push({label:'Сумма', from:money(tx.amount), to:money(next.amount)});
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

  // ---------- запрос на изменение (двустороннее согласование) ----------
  function proposeChange(id,next,note){
    var tx=DB.find('kassaTx',id); if(!tx) return;
    if(!genericDiff(tx,next).length){ alert('Вы ничего не изменили'); return false; }
    DB.update('kassaTx',id,{pending:{by:role(),next:next,note:note||'',t:Date.now()}});
    return true;
  }
  function approveChange(id){
    var tx=DB.find('kassaTx',id); if(!tx||!tx.pending) return;
    var d=genericDiff(tx,tx.pending.next);
    var entry={t:Date.now(),by:tx.pending.by,approver:role(),changes:d,note:tx.pending.note};
    DB.update('kassaTx',id, Object.assign({}, tx.pending.next, {pending:null, log:(tx.log||[]).concat([entry])}));
  }
  function rejectChange(id){
    var tx=DB.find('kassaTx',id); if(!tx||!tx.pending) return;
    var entry={t:Date.now(),by:tx.pending.by,approver:role(),rejected:true,changes:genericDiff(tx,tx.pending.next),note:tx.pending.note};
    DB.update('kassaTx',id,{pending:null, log:(tx.log||[]).concat([entry])});
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

    // уведомления: выданные, но не принятые суммы + запросы на согласование от управленца
    var pend=txs().filter(function(x){return x.kind==='issue' && x.status==='wait';});
    var notifHtml=pend.map(function(x){
      return '<div class="card notif"><div class="row"><div class="grow">'+
        '<div style="font-weight:700">💰 Вам выдано '+money(x.amount)+'</div>'+
        '<div class="muted fz12" style="margin-top:2px">Источник: '+x.source+' · '+stamp(new Date(x.t))+'</div></div></div>'+
        '<button class="btn btn-ok" style="margin-top:11px" data-accept="'+x.id+'">✓ Подтвердить получение</button></div>';
    }).join('') + reqPlates('mgr');
    $('sup-notifs').innerHTML=notifHtml;
    Array.prototype.forEach.call($('sup-notifs').querySelectorAll('[data-accept]'),function(b){
      b.onclick=function(){ DB.update('kassaTx',b.getAttribute('data-accept'),{status:'accepted',ta:Date.now()}); renderSup(); };
    });
    bindReqPlates($('sup-notifs'));

    // история — раздельно приход и расход
    var ins=txs().filter(function(x){return x.kind==='issue';});
    var outs=txs().filter(function(x){return x.kind==='expense';});
    $('sup-in').innerHTML = ins.length ? ins.map(opRow).join('') : '<div class="empty">Приходов пока нет. Когда управленец выдаст деньги — они появятся здесь.</div>';
    $('sup-out').innerHTML = outs.length ? outs.map(opRow).join('') : '<div class="empty">Расходов пока нет. Нажмите «Закупаюсь».</div>';
    bindOpRows($('sup-in')); bindOpRows($('sup-out'));
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
  // плашки входящих запросов на согласование (byRole = кто инициатор)
  function reqPlates(byRole){
    var reqs=txs().filter(function(x){ return x.pending && x.pending.by===byRole; });
    return reqs.map(function(x){
      var what = x.kind==='expense' ? 'накладной' : 'выдаче';
      return '<div class="card notif" style="border-color:rgba(240,166,33,.5);background:rgba(240,166,33,.07)">'+
        '<div style="font-weight:700">✏️ Запрос на изменение в '+what+'</div>'+
        '<div class="muted fz12" style="margin:3px 0 10px">от: '+roleName(byRole)+' · '+stamp(new Date(x.pending.t))+'</div>'+
        '<button class="btn btn-ok" data-req="'+x.id+'">Посмотреть и решить</button></div>';
    }).join('');
  }
  function bindReqPlates(root){
    Array.prototype.forEach.call(root.querySelectorAll('[data-req]'),function(b){
      b.onclick=function(){ showOp(b.getAttribute('data-req')); };
    });
  }

  function showOp(id){
    var x=DB.find('kassaTx',id); if(!x) return;
    var R=role(), body='';
    if(x.kind==='expense'){
      var items=(x.items||[]).map(function(i){
        var c=i.cat||x.category, pill=c==='Сырьё'?'<span class="pill pill-syr">Сырьё</span>':'<span class="pill pill-gen">Общие</span>';
        var per=i.price?money(i.price):'—', sm=(i.sum||rowSum(i));
        return '<tr><td>'+i.name+' '+pill+'</td><td style="text-align:right" class="muted">'+i.qty+' '+i.unit+' × '+per+'</td><td style="text-align:right;font-weight:600;white-space:nowrap">'+money(sm)+'</td></tr>';
      }).join('');
      var ph=function(src,lbl){ return src?'<div class="fld"><label>'+lbl+'</label><img src="'+src+'" style="width:100%;border-radius:10px"></div>':''; };
      body='<h3>Детали накладной</h3>'+
        '<div class="bigsum" style="color:var(--k-red)">−'+money(x.amount)+'</div>'+
        '<div class="muted fz13" style="text-align:center;margin-bottom:14px">'+stamp(new Date(x.t))+' · осн. категория: '+x.category+'</div>'+
        (items?'<table class="sk" style="margin-bottom:14px"><thead><tr><th>Позиция</th><th style="text-align:right">Кол-во × цена</th><th style="text-align:right">Сумма</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
        ph(x.invoice,'Накладная')+ph(x.receipt,'Чек');
    } else {
      var st = x.status==='accepted' ? '<span class="pill pill-doc">получено</span>' : '<span class="pill pill-wait">ждёт подтверждения</span>';
      body='<h3>Выдача денег</h3>'+
        '<div class="bigsum" style="color:var(--k-blue)">+'+money(x.amount)+'</div>'+
        '<div class="muted fz13" style="text-align:center;margin-bottom:14px">'+x.source+' · '+stamp(new Date(x.t))+' '+st+'</div>';
    }

    // блок согласования / кнопки правки
    if(x.pending){
      var d=genericDiff(x,x.pending.next);
      body+='<div class="pend"><div class="ph">✏️ Запрос на изменение · от: '+roleName(x.pending.by)+'</div>'+
        diffRows(d)+
        (x.pending.note?'<div class="muted fz12" style="margin-top:6px">Комментарий: '+x.pending.note+'</div>':'')+'</div>';
      if(x.pending.by!==R){
        body+='<button class="btn btn-ok" id="op-appr" style="margin-bottom:8px">✓ Одобрить изменение</button>'+
              '<button class="btn btn-ghost" id="op-rej" style="margin-bottom:8px">Отклонить</button>';
      } else {
        body+='<div class="muted fz13" style="text-align:center;margin-bottom:10px">Ждёт согласования второй стороны ('+roleName(x.pending.by==='sup'?'mgr':'sup')+')</div>';
      }
    } else {
      if(x.kind==='expense'){
        body+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ Изменить (через согласование)</button>';
      } else if(x.kind==='issue'){
        if(x.status==='wait' && R==='mgr'){
          body+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ Изменить</button>'+
                '<button class="btn btn-ghost" id="op-cancel" style="margin-bottom:8px;color:var(--k-red)">Отменить выдачу</button>';
        } else if(x.status==='accepted'){
          body+='<button class="btn btn-ghost" id="op-edit" style="margin-bottom:8px">✏️ Скорректировать (через согласование)</button>';
        }
      }
    }

    // журнал изменений
    if(x.log && x.log.length){
      body+='<div class="logh">История изменений</div>';
      body+=x.log.slice().reverse().map(function(e){
        var head=(e.rejected?'✕ Отклонено':'✓ Одобрено')+' · предложил '+roleName(e.by)+', '+(e.rejected?'отклонил':'одобрил')+' '+roleName(e.approver)+' · '+stamp(new Date(e.t));
        return '<div class="logi"><div class="muted fz12">'+head+'</div>'+diffRows(e.changes)+'</div>';
      }).join('');
    }

    body+='<button class="btn btn-ghost" id="cl">Закрыть</button>';
    openSheet(body);
    $('cl').onclick=closeSheet;
    if($('op-appr')) $('op-appr').onclick=function(){ approveChange(id); closeSheet(); rerender(); };
    if($('op-rej')) $('op-rej').onclick=function(){ rejectChange(id); closeSheet(); rerender(); };
    if($('op-edit')) $('op-edit').onclick=function(){ if(x.kind==='expense') openEdit(id); else openEditIssue(id); };
    if($('op-cancel')) $('op-cancel').onclick=function(){ if(confirm('Отменить эту выдачу?')){ DB.remove('kassaTx',id); closeSheet(); rerender(); } };
  }

  // ----- форма «Закупаюсь» / редактирование -----
  var buf={invoice:null,receipt:null,items:[{name:'',qty:'',unit:'шт'}],category:'Сырьё',amount:''};
  var editingId=null;
  function openBuy(){
    editingId=null;
    buf={invoice:null,receipt:null,items:[{name:'',qty:'',unit:'шт'}],category:'Сырьё',amount:''};
    openSheet(buyHtml()); wireBuy();
  }
  function openEdit(id){
    var x=DB.find('kassaTx',id); if(!x) return;
    editingId=id;
    buf={invoice:x.invoice||null,receipt:x.receipt||null,items:clone(x.items&&x.items.length?x.items:[{name:'',qty:'',unit:'шт'}]),category:x.category,amount:x.amount};
    openSheet(buyHtml()); wireBuy();
  }
  function buyHtml(){
    var ed=!!editingId, sy=buf.category==='Сырьё';
    return '<h3>'+(ed?'✏️ Изменить накладную':'🛒 Закуп')+'</h3>'+
      '<div class="muted fz12" style="margin-bottom:12px">'+(ed?'Правки уйдут второй стороне на согласование — молча ничего не меняется.':'Сфотографируйте накладную и/или чек. Без документа списание провести нельзя.')+'</div>'+
      '<div class="row" style="gap:10px;margin-bottom:12px">'+
        '<label class="photo grow'+(buf.invoice?' has':'')+'" style="margin:0">'+(buf.invoice?'✓ Накладная<img src="'+buf.invoice+'">':'📄 Накладная')+'<input type="file" accept="image/*" capture="environment" id="ph-inv"></label>'+
        '<label class="photo grow'+(buf.receipt?' has':'')+'" style="margin:0">'+(buf.receipt?'✓ Чек<img src="'+buf.receipt+'">':'🧾 Чек')+'<input type="file" accept="image/*" id="ph-rec"></label>'+
      '</div>'+
      (ed?'':'<button class="scanbtn" id="scan">🔎 Сканировать накладную (распознать позиции)</button>')+
      '<div class="fld"><label>Что закуплено <span style="color:var(--k-mut)">· «шт» — единица, «цена/ед» — цена за штуку, точка С/О — категория</span></label><div id="items"></div>'+
        '<button class="btn-ghost" id="additem" style="border:1px dashed var(--k-line);border-radius:10px">+ Добавить позицию</button></div>'+
      '<div class="fld"><label>Направление расхода</label><div class="seg" id="cat">'+
        '<button data-c="Сырьё" class="'+(sy?'on syr':'')+'">Сырьё</button><button data-c="Общие" class="'+(sy?'':'on gen')+'">Общие</button></div></div>'+
      '<div class="fld"><label>Сумма расхода, ₸ <span style="color:var(--k-mut)">· считается из позиций</span></label><input type="number" inputmode="numeric" id="amt" placeholder="0" value="'+(buf.amount||'')+'"></div>'+
      (ed?'':'<div class="muted fz12" style="text-align:center;margin-bottom:10px">В кассе сейчас: <b style="color:var(--k-ink)">'+money(balance())+'</b></div>')+
      '<button class="btn btn-buy" id="do-buy">'+(ed?'Отправить на согласование':'Расход прошёл — списать')+'</button>'+
      '<button class="btn btn-ghost" id="cancel" style="margin-top:8px">Отмена</button>';
  }
  var UNITS=['шт','л','кг'];
  function catOf(it){ return it.cat||buf.category; }
  function rowSum(it){ return (parseFloat(it.qty)||0)*(parseFloat(it.price)||0); }
  function itemsTotal(){ return buf.items.reduce(function(a,it){return a+rowSum(it);},0); }
  function recalcTotal(){
    var t=itemsTotal();
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
      b.onclick=function(){ var i=+b.getAttribute('data-cat'); buf.items[i].cat=(catOf(buf.items[i])==='Сырьё')?'Общие':'Сырьё'; renderItems(); };
    });
    Array.prototype.forEach.call($('items').querySelectorAll('[data-del]'),function(b){
      b.onclick=function(){ buf.items.splice(+b.getAttribute('data-del'),1); renderItems(); recalcTotal(); };
    });
    recalcTotal();
  }
  function wireBuy(){
    renderItems();
    $('ph-inv').onchange=function(e){ if(e.target.files[0]) readPhoto(e.target.files[0],function(d){ buf.invoice=d; refreshBuy(); }); };
    $('ph-rec').onchange=function(e){ if(e.target.files[0]) readPhoto(e.target.files[0],function(d){ buf.receipt=d; refreshBuy(); }); };
    $('additem').onclick=function(){ buf.items.push({name:'',qty:'',unit:'шт'}); renderItems(); };
    if($('scan')) $('scan').onclick=function(){
      if(!buf.invoice){ alert('Сначала сфотографируйте накладную'); return; }
      // 🔴 ДЕМО: реальное распознавание (OCR) подключим на сервере — vision-модель разберёт позиции сама.
      buf.items=[{name:'МДФ 16мм',qty:'5',unit:'шт',price:'12000'},{name:'Ручки мебельные',qty:'10',unit:'шт',price:'850'},{name:'Грунт-эмаль',qty:'8',unit:'л',price:'2400'}];
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
    $('amt').oninput=function(){ buf.amount=$('amt').value; };
    $('cancel').onclick=closeSheet;
    $('do-buy').onclick=doBuy;
  }
  function refreshBuy(){ sheetBody.innerHTML=buyHtml(); wireBuy(); }

  function doBuy(){
    var amt=parseInt($('amt').value)||0;
    if(amt<=0){ alert('Укажите сумму расхода'); return; }
    if(!buf.invoice && !buf.receipt){ alert('Прикрепите накладную или чек — без документа нельзя'); return; }
    var items=buf.items.filter(function(i){return (i.name||'').trim();}).map(function(i){return {name:i.name.trim(),qty:i.qty||'',unit:i.unit||'шт',price:i.price||'',sum:rowSum(i),cat:i.cat||buf.category};});
    // режим правки — отправляем на согласование, ничего не меняем сразу
    if(editingId){
      if(proposeChange(editingId,{amount:amt,category:buf.category,items:items})){
        var eid=editingId; editingId=null; closeSheet(); rerender();
        alert('Изменение отправлено на согласование второй стороне.');
      }
      return;
    }
    if(amt>balance()){ alert('В кассе только '+money(balance())+' — нельзя списать больше, чем есть'); return; }
    var now=Date.now();
    DB.add('kassaTx',{kind:'expense',t:now,amount:amt,category:buf.category,items:items,invoice:buf.invoice,receipt:buf.receipt});
    // приход на склад (позиции, каждая со своей категорией)
    items.forEach(function(i){
      DB.add('skladIntake',{t:now,date:stamp(new Date(now)),name:i.name,qty:i.qty,unit:i.unit,price:i.price,sum:i.sum,category:i.cat,from:'снабжение'});
    });
    closeSheet(); renderSup();
  }

  // ----- корректировка выдачи -----
  function openEditIssue(id){
    var x=DB.find('kassaTx',id); if(!x) return;
    var direct = (x.status==='wait' && role()==='mgr'); // до подтверждения — правим напрямую
    openSheet('<h3>'+(direct?'✏️ Изменить выдачу':'✏️ Скорректировать выдачу')+'</h3>'+
      (direct?'':'<div class="muted fz12" style="margin-bottom:12px">Правка уйдёт снабженцу на согласование — задним числом в одиночку изменить нельзя.</div>')+
      '<div class="fld"><label>Сумма, ₸</label><input type="number" inputmode="numeric" id="e-amt" value="'+x.amount+'"></div>'+
      '<div class="fld"><label>Источник</label><select id="e-src">'+
        ['Наличные','Каспий','Карта','Ульяна'].map(function(s){return '<option'+(s===x.source?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>'+
      '<button class="btn btn-give" id="e-do">'+(direct?'Сохранить':'Отправить на согласование')+'</button>'+
      '<button class="btn btn-ghost" id="e-cancel" style="margin-top:8px">Отмена</button>');
    $('e-cancel').onclick=closeSheet;
    $('e-do').onclick=function(){
      var a=parseInt($('e-amt').value)||0; if(a<=0){ alert('Укажите сумму'); return; }
      var next={amount:a,source:$('e-src').value};
      if(direct){ DB.update('kassaTx',id,next); closeSheet(); rerender(); }
      else if(proposeChange(id,next)){ closeSheet(); rerender(); alert('Корректировка отправлена снабженцу на согласование.'); }
    };
  }

  // ================= КАБИНЕТ УПРАВЛЕНЦА =================
  function renderMgr(){
    var s=sums();
    $('mgr-given').textContent=money(s.given); $('mgr-spent').textContent=money(s.spent); $('mgr-left').textContent=money(s.left);

    // запросы на согласование, ждущие управленца (инициатор — снабженец)
    $('mgr-notifs').innerHTML = reqPlates('sup');
    bindReqPlates($('mgr-notifs'));

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

  // вкладки снабженца (приход / расход)
  $('tab-in').onclick=function(){ $('tab-in').className='on'; $('tab-out').className=''; $('sup-in').style.display=''; $('sup-out').style.display='none'; };
  $('tab-out').onclick=function(){ $('tab-out').className='on'; $('tab-in').className=''; $('sup-out').style.display=''; $('sup-in').style.display='none'; };

  // вкладки управленца
  $('tab-issues').onclick=function(){ $('tab-issues').className='on'; $('tab-inv').className=''; $('mgr-issues').style.display=''; $('mgr-inv').style.display='none'; };
  $('tab-inv').onclick=function(){ $('tab-inv').className='on'; $('tab-issues').className=''; $('mgr-inv').style.display=''; $('mgr-issues').style.display='none'; };

  setRole(localStorage.getItem('kassa_role')||'sup');
})();
