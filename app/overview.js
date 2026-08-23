/* Обзор — живой дашборд-агрегат: собирает сводку из всех разделов (DB-коллекций) */
(function(){
  var COLOR={green:'var(--green)',blue:'var(--blue)',amber:'var(--amber)',red:'var(--red)',gray:'#9aa0a8'};
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }
  function mln(n){ return (n/1e6).toFixed(1).replace('.',',')+' млн ₸'; }

  // Продажи + заказы
  var orders=DB.all('orders'), deals=DB.all('deals');
  var inWork=orders.filter(function(o){return o.stage!=='ready';}).length;
  set('ov-orders', inWork);
  set('ov-prod', inWork);
  set('ov-leads', deals.filter(function(d){return d.stage==='new';}).length);
  set('ov-deals', deals.length);
  var dsum=deals.reduce(function(a,d){return a+(d.price||0);},0);
  set('ov-deals-sum', mln(dsum));

  // Склады
  var whs=DB.all('warehouses'), mats=DB.all('materials');
  var whBox=document.getElementById('ov-wh');
  if(whBox) whBox.innerHTML=whs.slice(0,4).map(function(w){
    return '<div class="wh-row"><div class="between"><span>'+w.name+'</span><span class="muted">'+w.value+'</span></div>'+
      '<div class="meter"><i style="width:'+w.fill+'%;background:'+(COLOR[w.fillColor]||'var(--blue)')+'"></i></div></div>';
  }).join('');
  var critMats=mats.filter(function(m){return m.statusType==='red'||m.statusType==='amber';});
  var redMats=mats.filter(function(m){return m.statusType==='red';});
  var whBadge=document.getElementById('ov-wh-badge');
  if(whBadge){ if(redMats.length){ whBadge.textContent='⚠ '+redMats.length+' ниже точки дозаказа'; whBadge.style.display=''; } else whBadge.style.display='none'; }

  // Снабжение
  var purchases=DB.all('purchases');
  var transit=purchases.filter(function(p){return ['В пути','На таможне','Отгружено'].indexOf(p.status)>=0;});
  set('ov-supply-cnt', transit.length);
  set('ov-supply-total', purchases.length);
  var supBox=document.getElementById('ov-supply-list');
  if(supBox) supBox.innerHTML=purchases.slice(0,3).map(function(p){
    return '<div class="li"><div style="flex:1"><div class="main-t">'+p.position+'</div><div class="sub-t">ETA '+p.eta+'</div></div>'+
      '<span class="badge b-'+(p.statusType||'gray')+'">'+p.status+'</span></div>';
  }).join('');

  // Отгрузки
  var ships=DB.all('shipments');
  var shipBox=document.getElementById('ov-ship-list');
  if(shipBox) shipBox.innerHTML=ships.slice(0,5).map(function(s){
    return '<div class="li"><span class="tm">'+s.time+'</span><div style="flex:1"><div class="main-t">Заказ №'+s.no+'</div>'+
      '<div class="sub-t">'+s.city+', '+s.client+'</div></div><span class="badge b-'+(s.statusType||'gray')+'">'+s.status+'</span></div>';
  }).join('');

  // Финансы — дебиторка
  var ar=DB.all('receivables').reduce(function(a,r){return a+(r.amount||0);},0);
  set('ov-fin-ar', mln(ar));

  // Команда
  var staff=DB.all('staff');
  var onShift=staff.filter(function(e){return e.status==='Активен';}).length;
  set('ov-team', onShift+' из '+staff.length);

  // СММ задачи
  var smmBox=document.getElementById('ov-smm-tasks');
  if(smmBox) smmBox.innerHTML=DB.all('smmTasks').slice(0,3).map(function(t){
    return '<div class="check"><span class="box"></span><span style="flex:1">'+t.title+'</span><span class="badge b-'+(t.tagType||'blue')+'">'+t.tag+'</span></div>';
  }).join('');

  // Внимание — узкие места из реальных сигналов
  var overdue=DB.all('receivables').filter(function(r){return r.overColor==='red';});
  var attBox=document.getElementById('ov-att-cards');
  var cards=[];
  redMats.slice(0,2).forEach(function(m){
    cards.push('<div class="att-card"><div class="h">⚠ '+m.name+' — '+m.badge+'</div><div class="muted">Остаток: '+m.stock+' '+m.unit+'</div><div class="muted">Мин. дозаказа: '+m.min+' '+m.unit+'</div></div>');
  });
  if(overdue.length){
    var top=overdue.slice().sort(function(a,b){return b.amount-a.amount;})[0];
    cards.push('<div class="att-card"><div class="h">⚠ Просрочка дебиторки</div><div class="muted">'+top.client+': '+mln(top.amount)+'</div><div class="muted">Просрочено '+top.overdue+', всего '+overdue.length+' долж.</div></div>');
  }
  if(attBox) attBox.innerHTML=cards.join('') || '<div class="muted">Критичных узких мест нет</div>';
  set('ov-att-count', critMats.length + overdue.length);
})();
