/* Снабжение — живая логика: заявки, карточка закупки, этапы, поставщики, риски */
(function(){
  var BADGE={green:'b-green',blue:'b-blue',amber:'b-amber',red:'b-red',gray:'b-gray',violet:'b-violet'};
  var ICON={green:'var(--green)',blue:'var(--blue)',amber:'var(--amber)',red:'var(--red)'};
  var SOFT={green:'var(--green-soft)',blue:'var(--blue-soft)',amber:'var(--amber-soft)',red:'var(--red-soft)'};
  var sel='po2458';

  function renderRep(){
    var tb=document.getElementById('replist'); if(!tb) return;
    tb.innerHTML=DB.all('replenishment').map(function(r){
      return '<tr data-id="'+r.id+'" style="cursor:pointer"><td style="font-weight:600">'+r.name+'</td><td>'+r.stock+'</td>'+
        '<td class="muted">'+r.min+'</td><td>'+r.use+'</td><td style="font-weight:600">'+r.order+'</td>'+
        '<td><span class="badge '+(BADGE[r.priColor]||'b-gray')+'">'+r.priority+'</span></td><td>'+r.resp+'</td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function(row){ row.addEventListener('click',function(){ orderFromRep(row.getAttribute('data-id')); }); });
  }

  function renderSuppliers(){
    var tb=document.getElementById('suplist'); if(!tb) return;
    tb.innerHTML=DB.all('suppliers').map(function(s){
      return '<tr><td style="font-weight:600">'+s.name+'</td><td>'+s.category+'</td><td>'+s.reliab+'%</td>'+
        '<td>'+s.term+'</td><td><span class="badge '+(BADGE[s.statusType]||'b-green')+'">'+s.status+'</span></td></tr>';
    }).join('');
  }

  function renderRisk(){
    var tb=document.getElementById('risklist'); if(!tb) return;
    var mats=(DB.all('materials')||[]).filter(function(m){ return m.statusType==='red'||m.statusType==='amber'; });
    tb.innerHTML=mats.map(function(m){
      return '<tr><td style="font-weight:600">'+m.name+'</td><td style="text-align:right"><span class="badge '+(BADGE[m.badgeType]||'b-amber')+'">'+m.badge+'</span></td></tr>';
    }).join('') || '<tr><td colspan="2" class="muted">Рисков нет</td></tr>';
  }

  function renderCard(){
    var p=DB.find('purchases',sel); if(!p){ p=DB.all('purchases')[0]; if(!p) return; sel=p.id; }
    set('sc-supplier',p.supplier); set('sc-po',p.po); set('sc-cat',p.category); set('sc-pos',p.position);
    set('sc-qty',p.qty); set('sc-budget',p.budget); set('sc-eta',p.eta); set('sc-manager',p.manager);
    set('sc-terms',p.terms);
    var st=document.getElementById('sc-status'); if(st){ st.textContent=p.status; st.className='badge '+(BADGE[p.statusType]||'b-amber'); }
    var steps=document.getElementById('sc-steps'); if(steps){ steps.innerHTML=(p.steps||[]).map(function(s){
      var cls=s.state==='done'?'step done':(s.state==='act'?'step act':'step wait');
      var mark=s.state==='done'?'✓':(s.state==='act'?'●':'');
      return '<div class="'+cls+'"><span class="c">'+mark+'</span>'+s.label+'</div>';
    }).join(''); }
    var hist=document.getElementById('sc-history'); if(hist){ hist.innerHTML=(p.history||[]).map(function(h){
      return '<div class="it"><span class="ic" style="background:'+SOFT[h.icon]+';color:'+ICON[h.icon]+'">●</span><span class="tt">'+h.label+'</span><span class="dd">'+h.date+'</span></div>';
    }).join(''); }
    var bl=document.getElementById('sc-bud-lbl'); if(bl) bl.textContent=p.budgetPct+'%';
    var bb=document.getElementById('sc-bud-bar'); if(bb){ bb.style.width=p.budgetPct+'%'; bb.style.background=ICON[p.statusType]||'var(--amber)'; }
  }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }

  // Клик по заявке → предложить оформить закупку
  function orderFromRep(id){
    var r=DB.find('replenishment',id); if(!r) return;
    UI.modal({title:'Оформить закупку · '+r.name, submit:'Создать заказ',
      fields:[
        {k:'supplier',label:'Поставщик',type:'select',value:DB.all('suppliers')[0].id,options:DB.all('suppliers').map(function(s){return {value:s.id,label:s.name};})},
        {k:'qty',label:'Количество',value:r.order},
        {k:'budget',label:'Бюджет, ₸',type:'number',value:'300000'},
        {k:'eta',label:'Ожид. дата',value:'5 июня 2025'}
      ],
      onSubmit:function(v){
        var sup=DB.find('suppliers',v.supplier);
        var num=2461+DB.all('purchases').length;
        var p=DB.add('purchases',{supplier:sup.name,po:'PO-'+num,category:sup.category,position:r.name,qty:v.qty,budget:(parseInt(v.budget)||0).toLocaleString('ru-RU')+' ₸',eta:v.eta,status:'Согласование',statusType:'amber',manager:r.resp,terms:'Условия: уточняются',budgetPct:10,
          steps:[{label:'Согласовано',state:'act'},{label:'Оплачено',state:'wait'},{label:'Отгружено',state:'wait'},{label:'В пути',state:'wait'},{label:'На складе',state:'wait'}],
          history:[{icon:'green',label:'Заявка сформирована',date:'сегодня'}]});
        DB.remove('replenishment',id);
        sel=p.id; UI.toast('Закупка '+p.po+' создана','ok'); renderAll();
      }});
  }

  // Новая закупка
  document.getElementById('sup-add').addEventListener('click',function(){
    UI.modal({title:'Новая закупка', submit:'Создать',
      fields:[
        {k:'supplier',label:'Поставщик',type:'select',value:DB.all('suppliers')[0].id,options:DB.all('suppliers').map(function(s){return {value:s.id,label:s.name};})},
        {k:'position',label:'Позиция',placeholder:'напр. Замки трансформера'},
        {k:'qty',label:'Количество',value:'100 шт'},
        {k:'budget',label:'Бюджет, ₸',type:'number',value:'300000'},
        {k:'eta',label:'Ожид. дата',value:'5 июня 2025'}
      ],
      onSubmit:function(v){
        if(!v.position){ UI.toast('Укажите позицию','err'); return false; }
        var sup=DB.find('suppliers',v.supplier);
        var num=2461+DB.all('purchases').length;
        var p=DB.add('purchases',{supplier:sup.name,po:'PO-'+num,category:sup.category,position:v.position,qty:v.qty,budget:(parseInt(v.budget)||0).toLocaleString('ru-RU')+' ₸',eta:v.eta,status:'Согласование',statusType:'amber',manager:'Айдар',terms:'Условия: уточняются',budgetPct:10,
          steps:[{label:'Согласовано',state:'act'},{label:'Оплачено',state:'wait'},{label:'Отгружено',state:'wait'},{label:'В пути',state:'wait'},{label:'На складе',state:'wait'}],
          history:[{icon:'green',label:'Заказ создан',date:'сегодня'}]});
        sel=p.id; UI.toast('Закупка '+p.po+' создана','ok'); renderAll();
      }});
  });

  // Продвинуть этап
  document.getElementById('sc-advance').addEventListener('click',function(){
    var p=DB.find('purchases',sel); if(!p) return;
    var steps=p.steps.map(function(s){return {label:s.label,state:s.state};});
    var ai=-1; for(var i=0;i<steps.length;i++){ if(steps[i].state==='act'){ ai=i; break; } }
    if(ai<0){ for(var j=0;j<steps.length;j++){ if(steps[j].state==='wait'){ ai=j-1; break; } } }
    if(ai>=steps.length-1){ UI.toast('Заказ уже на складе','ok'); return; }
    steps[ai].state='done';
    var next=steps[ai+1]; next.state='act';
    var stMap={'На складе':'green','На таможне':'amber','Отгружено':'blue','В пути':'blue','Оплачено':'blue','Согласовано':'amber'};
    var hist=p.history.slice(); hist.push({icon:stMap[next.label]||'blue',label:next.label,date:'сегодня'});
    var last=next.label==='На складе';
    DB.update('purchases',sel,{steps:steps,status:next.label,statusType:last?'green':(stMap[next.label]||'blue'),history:hist,budgetPct:Math.min(100,p.budgetPct+15)});
    UI.toast('Этап продвинут → '+next.label,'ok'); renderCard();
  });

  document.getElementById('sc-open').addEventListener('click',function(){ var p=DB.find('purchases',sel); UI.toast('Открыт заказ '+(p?p.po:''),'ok'); });
  document.getElementById('sc-contact').addEventListener('click',function(){ var p=DB.find('purchases',sel); UI.toast('Запрос поставщику «'+(p?p.supplier:'')+'» отправлен','ok'); });

  function renderAll(){ renderRep(); renderSuppliers(); renderRisk(); renderCard(); }
  renderAll();
})();
