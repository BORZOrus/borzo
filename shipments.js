/* Отгрузки — живая логика: расписание, карточка, этапы, маршруты, риски, Trello-ячейка */
(function(){
  var BADGE={green:'b-green',blue:'b-blue',amber:'b-amber',red:'b-red',gray:'b-gray',violet:'b-violet'};
  var COLOR={green:'var(--green)',blue:'var(--blue)',amber:'var(--amber)',red:'var(--red)',gray:'#9aa0a8'};
  var SOFT={green:'var(--green-soft)',blue:'var(--blue-soft)',amber:'var(--amber-soft)',red:'var(--red-soft)',gray:'var(--line2)'};
  var sel='sh3';

  function renderList(){
    var tb=document.getElementById('shiplist'); if(!tb) return;
    tb.innerHTML=DB.all('shipments').map(function(s){
      return '<tr data-id="'+s.id+'" style="cursor:pointer'+(s.id===sel?';background:var(--blue-soft)':'')+'">'+
        '<td class="muted">◷ '+s.time+'</td><td style="color:var(--blue);font-weight:600">Заказ #'+s.no+'</td>'+
        '<td>'+s.client+'</td><td>'+s.city+'</td><td><span class="badge '+(BADGE[s.statusType]||'b-gray')+'">'+s.status+'</span></td><td>'+s.resp+'</td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function(r){ r.addEventListener('click',function(){ select(r.getAttribute('data-id')); }); });
  }

  function renderRoutes(){
    var box=document.getElementById('routelist'); if(!box) return;
    box.innerHTML=DB.all('routes').map(function(r){
      return '<div class="wh-row"><div class="between"><span>'+r.city+'</span><b>'+r.load+'%</b></div>'+
        '<div class="meter"><i style="width:'+r.load+'%;background:'+COLOR[r.color]+'"></i></div></div>';
    }).join('');
  }

  function renderRisks(){
    var tb=document.getElementById('risklist'); if(!tb) return;
    tb.innerHTML=DB.all('shipRisks').map(function(r){
      return '<tr><td style="font-weight:600">'+r.name+'</td><td style="text-align:right"><span class="badge '+(BADGE[r.levelType]||'b-gray')+'">'+r.level+'</span></td></tr>';
    }).join('');
  }

  function renderCard(){
    var s=DB.find('shipments',sel); if(!s){ s=DB.all('shipments')[0]; if(!s) return; sel=s.id; }
    set('kc-no','#'+s.no); set('kc-client',s.client); set('kc-product',s.product); set('kc-color',s.color);
    set('kc-city',s.city); set('kc-date',s.date); set('kc-car',s.car); set('kc-driver',s.driver);
    var st=document.getElementById('kc-status'); if(st){ st.textContent=s.status; st.className='badge '+(BADGE[s.statusType]||'b-gray'); }
    var pr=document.getElementById('kc-priority'); if(pr){ pr.textContent=s.priority; pr.className='badge '+(BADGE[s.priType]||'b-gray'); }
    set('kc-ready-lbl',s.ready+'%');
    var bar=document.getElementById('kc-ready-bar'); if(bar){ bar.style.width=s.ready+'%'; bar.style.background=s.ready>=70?'var(--green)':(s.ready>=40?'var(--amber)':'#9aa0a8'); }
    var stg=document.getElementById('kc-stages'); if(stg){ stg.innerHTML=(s.stages||[]).map(function(x){
      var col=x.done?'green':(x.act?'amber':'gray'); var mark=x.done?'✓':(x.act?'◷':'○');
      return '<div class="it"><span class="ic" style="background:'+SOFT[col]+';color:'+COLOR[col]+'">'+mark+'</span><span class="tt">'+x.s+'</span></div>';
    }).join(''); }
    var docs=document.getElementById('kc-docs'); if(docs){ docs.innerHTML=Object.keys(s.docs||{}).map(function(k){
      var ok=s.docs[k];
      return '<div class="aa" style="padding:3px 0;font-size:11.5px"><span class="'+(ok?'ok':'muted')+'">'+(ok?'✓':'○')+'</span>'+k+'</div>';
    }).join(''); }
    renderList();
  }
  function select(id){ sel=id; renderCard(); }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }

  // Новая отгрузка
  document.getElementById('ship-add').addEventListener('click',function(){
    UI.modal({title:'Новая отгрузка', submit:'Создать',
      fields:[
        {k:'no',label:'Номер заказа',value:String(1259+DB.all('shipments').length-5)},
        {k:'client',label:'Клиент',placeholder:'напр. ИП Арман'},
        {k:'product',label:'Изделие',value:'GEOMETRY 3,5 м'},
        {k:'city',label:'Город',value:'Алматы'},
        {k:'time',label:'Время',value:'12:00'},
        {k:'date',label:'Дата отгрузки',value:'30 мая 2025'},
        {k:'resp',label:'Ответственный',value:'Ермек'}
      ],
      onSubmit:function(v){
        if(!v.client){ UI.toast('Укажите клиента','err'); return false; }
        var s=DB.add('shipments',{time:v.time,no:v.no,client:v.client,city:v.city,status:'Запланировано',statusType:'gray',resp:v.resp,product:v.product,color:'Белый',date:v.date,car:'—',driver:'—',priority:'Средний',priType:'amber',ready:10,
          stages:[{s:'Сборка завершена',done:false,act:true},{s:'Упаковано',done:false},{s:'Документы готовы',done:false},{s:'Погрузка',done:false}],docs:{'Накладная':false,'Счёт':false,'Маршрутный лист':false}});
        sel=s.id; UI.toast('Отгрузка #'+v.no+' создана','ok'); renderList(); renderCard();
      }});
  });

  // Следующий статус
  var FLOW=['Запланировано','Готовится','Готово к погрузке','В пути','Доставлено'];
  var STY={'Запланировано':'gray','Готовится':'amber','Готово к погрузке':'green','В пути':'blue','Доставлено':'green'};
  document.getElementById('kc-next').addEventListener('click',function(){
    var s=DB.find('shipments',sel); if(!s) return;
    var i=FLOW.indexOf(s.status); if(i<0)i=0;
    if(i>=FLOW.length-1){ UI.toast('Заказ уже доставлен','ok'); return; }
    var ns=FLOW[i+1];
    DB.update('shipments',sel,{status:ns,statusType:STY[ns],ready:Math.min(100,s.ready+18)});
    UI.toast('Статус → '+ns,'ok'); renderCard();
  });

  document.getElementById('kc-open').addEventListener('click',function(){ var s=DB.find('shipments',sel); UI.toast('Открыт заказ #'+(s?s.no:''),'ok'); });
  document.getElementById('kc-call').addEventListener('click',function(){ var s=DB.find('shipments',sel); UI.toast('Звонок клиенту «'+(s?s.client:'')+'»','ok'); });

  // Trello-ячейка 🔴 — синхронизация появится после ввода API-ключа в Настройках
  document.getElementById('ship-trello').addEventListener('click',function(){
    var tr=DB.find('integrations','trello');
    if(tr && tr.status==='on'){ UI.toast('Синхронизация с Trello запущена','ok'); }
    else { UI.confirm('Trello не подключён. Открыть Настройки → Интеграции, чтобы ввести API-ключ?',function(){ location.href='integrations.html'; }); }
  });

  renderList(); renderRoutes(); renderRisks(); renderCard();
})();
