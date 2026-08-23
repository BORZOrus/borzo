/* Склады — живая логика: остатки по складам, карточка материала, критические, ячейки, приход/инвентаризация */
(function(){
  var BADGE={green:'b-green',blue:'b-blue',amber:'b-amber',red:'b-red',gray:'b-gray',violet:'b-violet'};
  var COLOR={green:'var(--green)',blue:'var(--blue)',amber:'var(--amber)',red:'var(--red)',gray:'#9aa0a8'};
  var q='', sel='mat1';
  function match(m){ if(!q) return true; return (m.name+' '+m.sku+' '+m.category).toLowerCase().indexOf(q)>=0; }

  function renderWarehouses(){
    var tb=document.getElementById('whlist'); if(!tb) return;
    tb.innerHTML=DB.all('warehouses').map(function(w){
      return '<tr><td style="font-weight:600">'+w.name+'</td><td>'+w.positions+' позиций</td>'+
        '<td><div class="row" style="gap:8px"><div class="meter" style="width:90px"><i style="width:'+w.fill+'%;background:'+COLOR[w.fillColor]+'"></i></div><b>'+w.fill+'%</b></div></td>'+
        '<td style="text-align:right">'+w.value+'</td><td><span class="badge '+(BADGE[w.statusType]||'b-green')+'">'+w.status+'</span></td></tr>';
    }).join('');
  }

  function renderCrit(){
    var tb=document.getElementById('critlist'); if(!tb) return;
    var crit=DB.all('materials').filter(function(m){ return m.statusType==='red'||m.statusType==='amber'; });
    tb.innerHTML=crit.map(function(m){
      return '<tr data-id="'+m.id+'" style="cursor:pointer'+(m.id===sel?';background:var(--blue-soft)':'')+'"><td style="font-weight:600">'+m.name+'</td>'+
        '<td>'+m.stock+' '+m.unit+'</td><td style="text-align:right"><span class="badge '+(BADGE[m.badgeType]||'b-amber')+'">'+m.badge+'</span></td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function(r){ r.addEventListener('click',function(){ select(r.getAttribute('data-id')); }); });
  }

  function renderCells(){
    var box=document.getElementById('celllist'); if(!box) return;
    box.innerHTML=DB.all('cells').map(function(c){
      return '<div class="wh-row"><div class="between"><span><b>'+c.code+'</b> '+c.kind+'</span><b>'+c.fill+'%</b></div>'+
        '<div class="meter"><i style="width:'+c.fill+'%;background:'+COLOR[c.color]+'"></i></div></div>';
    }).join('');
  }

  function select(id){
    var m=DB.find('materials',id); if(!m) return; sel=id;
    set('mc-name',m.name); set('mc-sku',m.sku); set('mc-cat',m.category); set('mc-unit',m.unit);
    set('mc-stock',m.stock+' '+m.unit); set('mc-min',m.min+' '+m.unit); set('mc-sup',m.supplier);
    set('mc-loc',m.location); set('mc-lastin',m.lastIn); set('mc-use',m.usePerMonth);
    var st=document.getElementById('mc-status'); if(st){ st.textContent=m.statusText; st.style.color=COLOR[m.statusType]||'var(--ink)'; st.style.fontWeight='600'; }
    var lbl=document.getElementById('mc-exh-lbl'); if(lbl){ lbl.textContent=m.exhausted+'% исчерпано'; lbl.style.color=COLOR[m.statusType]||'var(--ink)'; }
    var bar=document.getElementById('mc-exh-bar'); if(bar){ bar.style.width=m.exhausted+'%'; bar.style.background=COLOR[m.statusType]||'var(--blue)'; }
    var mv=document.getElementById('mc-move'); if(mv){ mv.innerHTML=(m.movement||[]).map(function(x){
      return '<div class="it"><span class="dd" style="width:44px">'+x.date+'</span><span class="tt"><span style="color:'+COLOR[x.typeColor]+'">● '+x.type+'</span></span><span class="dd">'+x.note+'</span></div>';
    }).join(''); }
    renderCrit();
  }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }

  function statusFor(stock,min){
    if(stock<min*0.75) return {statusText:'Ниже нормы',statusType:'red',badge:'Ниже нормы',badgeType:'red'};
    if(stock<min)      return {statusText:'Риск дефицита',statusType:'amber',badge:'Риск',badgeType:'amber'};
    return {statusText:'Норма',statusType:'green',badge:'Норма',badgeType:'green'};
  }

  // Приход на склад (можно на существующий материал или новый)
  document.getElementById('wh-add').addEventListener('click',function(){
    var mats=DB.all('materials');
    UI.modal({title:'Приход на склад', submit:'Оприходовать',
      fields:[
        {k:'mat',label:'Материал',type:'select',value:sel,options:mats.map(function(m){return {value:m.id,label:m.name};}).concat([{value:'__new',label:'+ Новый материал'}])},
        {k:'name',label:'Название (если новый)',placeholder:'напр. Уголок мебельный'},
        {k:'unit',label:'Ед. изм.',value:'шт'},
        {k:'qty',label:'Количество прихода',type:'number',value:'100'},
        {k:'supplier',label:'Поставщик / поставка',placeholder:'напр. Поставка №460'}
      ],
      onSubmit:function(v){
        var qty=parseInt(v.qty)||0; if(qty<=0){ UI.toast('Укажите количество','err'); return false; }
        var note=qty+' '+(v.unit||'шт')+' · '+(v.supplier||'Приход');
        if(v.mat==='__new'){
          if(!v.name){ UI.toast('Введите название материала','err'); return false; }
          var st=statusFor(qty,1);
          var m=DB.add('materials',{name:v.name,sku:'NEW-'+Math.floor(Math.random()*900+100),category:'Материалы',unit:v.unit||'шт',stock:qty,min:Math.round(qty*0.5),supplier:v.supplier||'—',location:'Основной склад',statusText:st.statusText,statusType:st.statusType,badge:st.badge,badgeType:st.badgeType,lastIn:'только что',usePerMonth:'—',exhausted:20,movement:[{date:'сегодня',type:'приход',typeColor:'green',note:note}]});
          sel=m.id;
        } else {
          var it=DB.find('materials',v.mat); if(!it) return;
          var mv=(it.movement||[]).slice(); mv.unshift({date:'сегодня',type:'приход',typeColor:'green',note:note});
          var ns=it.stock+qty; var st2=statusFor(ns,it.min);
          DB.update('materials',v.mat,{stock:ns,lastIn:'только что',movement:mv,statusText:st2.statusText,statusType:st2.statusType,badge:st2.badge,badgeType:st2.badgeType,exhausted:Math.max(0,Math.round((1-ns/(it.min||1))*100))});
          sel=v.mat;
        }
        UI.toast('Приход оприходован','ok'); renderAll(); select(sel);
      }});
  });

  // Инвентаризация — коррекция остатка
  document.getElementById('wh-inv').addEventListener('click',function(){
    var m=DB.find('materials',sel)||DB.all('materials')[0]; if(!m){ UI.toast('Нет материалов','err'); return; }
    UI.modal({title:'Инвентаризация · '+m.name, submit:'Записать факт',
      fields:[
        {k:'fact',label:'Фактический остаток, '+m.unit,type:'number',value:String(m.stock)}
      ],
      onSubmit:function(v){
        var f=parseInt(v.fact); if(isNaN(f)||f<0){ UI.toast('Некорректное число','err'); return false; }
        var diff=f-m.stock; var st=statusFor(f,m.min);
        var mv=(m.movement||[]).slice(); mv.unshift({date:'сегодня',type:'инвентаризация',typeColor:'blue',note:(diff>=0?'+':'')+diff+' '+m.unit+' · сверка'});
        DB.update('materials',m.id,{stock:f,movement:mv,statusText:st.statusText,statusType:st.statusType,badge:st.badge,badgeType:st.badgeType,exhausted:Math.max(0,Math.round((1-f/(m.min||1))*100))});
        UI.toast('Остаток скорректирован ('+(diff>=0?'+':'')+diff+')','ok'); renderAll(); select(m.id);
      }});
  });

  document.getElementById('mc-order').addEventListener('click',function(){
    var m=DB.find('materials',sel); UI.toast('Заявка на дозаказ «'+(m?m.name:'—')+'» отправлена в Снабжение','ok');
  });

  var s=document.getElementById('wh-search');
  s.addEventListener('input',function(){ q=s.value.trim().toLowerCase();
    // при поиске — выделить первое совпадение
    var f=DB.all('materials').filter(match)[0]; if(f) select(f.id); renderCrit();
  });

  function renderAll(){ renderWarehouses(); renderCrit(); renderCells(); }
  renderAll(); select(sel);
})();
