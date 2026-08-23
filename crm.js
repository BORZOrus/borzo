/* CRM — живая логика: канбан, drag&drop, добавление/удаление, поиск, карточка сделки */
(function(){
  var SRC={Instagram:'#dd2a7b',WhatsApp:'#25d366',Kaspi:'#f14635','Сайт':'#2f66f6','Дилеры':'#8b5cf6'};
  var STAGE_BADGE={new:'b-blue',qual:'b-amber',measure:'b-violet',invoice:'b-gray',pay:'b-green'};
  var STAGE_COLOR={new:'var(--blue)',qual:'var(--amber)',measure:'var(--violet)',invoice:'var(--ink2)',pay:'var(--green)'};
  var q='', selected=null, dragId=null;

  function mln(n){ return (n/1e6).toFixed(1).replace('.',',')+' млн ₸'; }
  function match(d){ if(!q) return true; return (d.title+' '+d.spec+' '+(d.source||'')).toLowerCase().indexOf(q)>=0; }
  function srcDot(s){ return '<span class="d" style="width:8px;height:8px;border-radius:50%;background:'+(SRC[s]||'#9aa0a8')+'"></span>'; }

  function render(){
    var stages=DB.all('dealStages'), deals=DB.all('deals').filter(match);
    var kb=document.getElementById('kanban');
    kb.innerHTML = stages.map(function(st){
      var list=deals.filter(function(d){return d.stage===st.id;});
      var sum=list.reduce(function(a,d){return a+(d.price||0);},0);
      var cards=list.map(function(d){
        return '<div class="deal'+(d.id===selected?' sel':'')+'" draggable="true" data-id="'+d.id+'">'+
          '<div class="dt">'+d.title+'</div><div class="spec">'+d.spec+'</div><div class="price">'+(d.price||0).toLocaleString('ru-RU')+' ₸</div>'+
          (d.flag?'<span class="badge '+(d.flagType==='green'?'b-green':'b-amber')+'" style="margin-top:6px;display:inline-block">'+d.flag+'</span>':'')+
          '<div class="foot"><span class="src">'+srcDot(d.source)+(d.source||'')+'</span>'+(d.manager?'<span class="ava" style="margin-left:auto">'+d.manager+'</span>':'')+'</div></div>';
      }).join('') || '<div class="muted" style="padding:8px 2px;font-size:11px">— пусто —</div>';
      return '<div class="kcol" data-stage="'+st.id+'"><div class="kcol-h"><div><div class="t" style="color:'+STAGE_COLOR[st.id]+'">'+st.name+'</div>'+
        '<div class="c">'+list.length+' сделок · '+mln(sum)+'</div></div><span class="dots">⋮</span></div><div class="kbody">'+cards+'</div></div>';
    }).join('');

    var tb=document.getElementById('deallist');
    if(tb){ tb.innerHTML = deals.slice(0,8).map(function(d){
      var stName=(stages.filter(function(s){return s.id===d.stage;})[0]||{}).name||'';
      return '<tr data-id="'+d.id+'" style="cursor:pointer"><td style="font-weight:600">'+d.title+'</td><td><span class="badge '+(STAGE_BADGE[d.stage]||'b-gray')+'">'+stName+'</span></td>'+
        '<td>'+(d.manager||'—')+'</td><td>'+(d.source||'')+'</td><td style="font-weight:600">'+(d.price||0).toLocaleString('ru-RU')+' ₸</td>'+
        '<td class="muted">—</td><td class="muted">—</td></tr>';
    }).join(''); }

    var cnt=document.querySelector('.card .between .muted');
    wire();
  }

  function selectDeal(id){
    selected=id; var d=DB.find('deals',id); if(!d) return;
    var t=document.getElementById('dc-title'); if(t)t.textContent=d.title;
    var s=document.getElementById('dc-source'); if(s)s.textContent=d.source||'—';
    var p=document.getElementById('dc-product'); if(p)p.textContent='Стол-трансформер '+d.spec;
    render();
  }

  function wire(){
    document.querySelectorAll('.deal').forEach(function(c){
      c.addEventListener('click',function(){ selectDeal(c.getAttribute('data-id')); });
      c.addEventListener('dragstart',function(e){ dragId=c.getAttribute('data-id'); c.classList.add('drag'); });
      c.addEventListener('dragend',function(){ c.classList.remove('drag'); document.querySelectorAll('.kcol').forEach(function(k){k.classList.remove('dragover');}); });
    });
    document.querySelectorAll('.kcol').forEach(function(col){
      col.addEventListener('dragover',function(e){ e.preventDefault(); col.classList.add('dragover'); });
      col.addEventListener('dragleave',function(){ col.classList.remove('dragover'); });
      col.addEventListener('drop',function(e){ e.preventDefault(); col.classList.remove('dragover');
        if(dragId){ var st=col.getAttribute('data-stage'); DB.update('deals',dragId,{stage:st}); UI.toast('Сделка перемещена','ok'); dragId=null; render(); } });
    });
    document.querySelectorAll('#deallist tr').forEach(function(r){ r.addEventListener('click',function(){ selectDeal(r.getAttribute('data-id')); }); });
  }

  function addDeal(){
    var stages=DB.all('dealStages');
    UI.modal({title:'Новая сделка', submit:'Создать',
      fields:[
        {k:'title',label:'Клиент / название',placeholder:'напр. Айгуль, Алматы'},
        {k:'spec',label:'Изделие',value:'GEOMETRY 3,5 м'},
        {k:'price',label:'Сумма, ₸',type:'number',value:'300000'},
        {k:'stage',label:'Этап',type:'select',value:'new',options:stages.map(function(s){return {value:s.id,label:s.name};})},
        {k:'source',label:'Источник',type:'select',value:'Instagram',options:['Instagram','WhatsApp','Kaspi','Сайт','Дилеры'].map(function(s){return {value:s,label:s};})},
        {k:'manager',label:'Менеджер (буква)',value:'А'}
      ],
      onSubmit:function(v){
        if(!v.title){ UI.toast('Введите клиента','err'); return false; }
        DB.add('deals',{title:v.title,spec:v.spec,price:parseInt(v.price)||0,stage:v.stage,source:v.source,manager:v.manager});
        UI.toast('Сделка добавлена','ok'); render();
      }});
  }

  document.getElementById('crm-add').addEventListener('click',addDeal);
  var srch=document.getElementById('crm-search');
  srch.addEventListener('input',function(){ q=srch.value.trim().toLowerCase(); render(); });
  var del=document.getElementById('dc-del');
  if(del) del.addEventListener('click',function(){ if(!selected){UI.toast('Выберите сделку','err');return;} UI.confirm('Удалить эту сделку?',function(){ DB.remove('deals',selected); selected=null; UI.toast('Удалено','ok'); render(); }); });

  render();
})();
