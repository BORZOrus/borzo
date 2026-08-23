/* Производство — живой канбан заказов по цехам */
(function(){
  var PRI={amber:'b-amber',green:'b-green',blue:'b-blue'};
  var sel='o1256', dragId=null;

  function render(){
    var stages=DB.all('prodStages'), orders=DB.all('orders');
    var kb=document.getElementById('kanban');
    kb.innerHTML = stages.map(function(st){
      var list=orders.filter(function(o){return o.stage===st.id;});
      var cards=list.map(function(o){
        return '<div class="deal'+(o.id===sel?' sel':'')+'" draggable="true" data-id="'+o.id+'">'+
          '<div class="sub-t" style="color:var(--ink3);font-size:11px;margin-bottom:2px">Заказ #'+o.no+'</div>'+
          '<div class="dt">'+o.model+'</div><div class="spec">'+o.city+'</div>'+
          '<div class="between"><span class="muted">'+o.due+'</span><span class="badge '+(PRI[o.priType]||'b-green')+'">'+o.priority+'</span></div></div>';
      }).join('') || '<div class="muted" style="padding:8px 2px;font-size:11px">— пусто —</div>';
      return '<div class="kcol" data-stage="'+st.id+'"><div class="kcol-h"><div><div class="t">'+st.name+'</div><div class="c">'+list.length+' заказа</div></div></div><div class="kbody">'+cards+'</div></div>';
    }).join('');
    wire();
  }

  function wire(){
    document.querySelectorAll('.deal').forEach(function(c){
      c.addEventListener('click',function(){ select(c.getAttribute('data-id')); });
      c.addEventListener('dragstart',function(){ dragId=c.getAttribute('data-id'); c.classList.add('drag'); });
      c.addEventListener('dragend',function(){ c.classList.remove('drag'); document.querySelectorAll('.kcol').forEach(function(k){k.classList.remove('dragover');}); });
    });
    document.querySelectorAll('.kcol').forEach(function(col){
      col.addEventListener('dragover',function(e){ e.preventDefault(); col.classList.add('dragover'); });
      col.addEventListener('dragleave',function(){ col.classList.remove('dragover'); });
      col.addEventListener('drop',function(e){ e.preventDefault(); col.classList.remove('dragover');
        if(dragId){ DB.update('orders',dragId,{stage:col.getAttribute('data-stage')}); UI.toast('Заказ перемещён по цехам','ok'); dragId=null; render(); } });
    });
  }

  function select(id){
    sel=id; var o=DB.find('orders',id); if(!o) return;
    var st=DB.all('prodStages').filter(function(s){return s.id===o.stage;})[0]||{};
    set('oc-no','#'+o.no); set('oc-model',o.model); set('oc-city',o.city); set('oc-due',o.due.replace('срок ',''));
    var se=document.getElementById('oc-stage'); if(se){ se.textContent='● '+(st.name||''); }
    var pe=document.getElementById('oc-pri'); if(pe){ pe.textContent=o.priority; pe.className='badge '+(PRI[o.priType]||'b-green'); }
    render();
  }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }

  document.getElementById('prod-add').addEventListener('click',function(){
    var stages=DB.all('prodStages');
    UI.modal({title:'Запустить заказ в производство', submit:'Запустить',
      fields:[
        {k:'no',label:'Номер заказа',value:String(1268+DB.all('orders').length-14)},
        {k:'model',label:'Изделие',value:'GEOMETRY 3,5 м'},
        {k:'city',label:'Город',value:'Алматы'},
        {k:'due',label:'Срок',value:'срок 5 июня'},
        {k:'priority',label:'Приоритет',type:'select',value:'Средний',options:[{value:'Высокий',label:'Высокий'},{value:'Средний',label:'Средний'},{value:'Низкий',label:'Низкий'}]},
        {k:'stage',label:'Цех (старт)',type:'select',value:'metal',options:stages.map(function(s){return {value:s.id,label:s.name};})}
      ],
      onSubmit:function(v){
        if(!v.no){ UI.toast('Укажите номер','err'); return false; }
        var pt={'Высокий':'amber','Средний':'green','Низкий':'blue'}[v.priority];
        DB.add('orders',{no:v.no,model:v.model,city:v.city,due:v.due,priority:v.priority,priType:pt,stage:v.stage});
        UI.toast('Заказ #'+v.no+' запущен','ok'); render();
      }});
  });

  render();
})();
