/* Клиенты и сервис — живая логика */
(function(){
  var BADGE={green:'b-green',amber:'b-amber',violet:'b-violet',gray:'b-gray',red:'b-red',blue:'b-blue'};
  var PRI={amber:'var(--amber)',red:'var(--red)',gray:'var(--ink3)'};
  var q='', selClient='c1';

  function money(n){ return (n||0).toLocaleString('ru-RU')+' ₸'; }
  function match(c){ if(!q) return true; return (c.name+' '+c.city+' '+c.segment+' '+c.product).toLowerCase().indexOf(q)>=0; }

  function render(){
    var clients=DB.all('clients').filter(match);
    var tb=document.getElementById('clientlist');
    tb.innerHTML = clients.map(function(c){
      return '<tr data-id="'+c.id+'" style="cursor:pointer'+(c.id===selClient?';background:var(--blue-soft)':'')+'">'+
        '<td style="font-weight:600">'+c.name+'</td><td>'+c.city+'</td><td class="muted">'+c.last+'</td><td>'+c.product+'</td><td>'+c.segment+'</td>'+
        '<td><span class="badge '+(BADGE[c.statusType]||'b-gray')+'">'+c.status+'</span></td><td style="font-weight:600">'+money(c.ltv)+'</td><td class="muted">'+c.contact+'</td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function(r){ r.addEventListener('click',function(){ selectClient(r.getAttribute('data-id')); }); });

    var sr=document.getElementById('srlist');
    sr.innerHTML = DB.all('serviceRequests').map(function(s){
      return '<tr><td style="color:var(--blue);font-weight:600">'+s.no+'</td><td>'+s.client+'</td><td>'+s.type+'</td><td>'+s.product+'</td>'+
        '<td><span style="color:'+(PRI[s.priColor]||'var(--ink3)')+'">● '+s.priority+'</span></td><td>'+s.resp+'</td>'+
        '<td'+(s.status==='Требует выезда'?' style="color:var(--red);font-weight:600"':' class="muted"')+'>'+s.sla+'</td>'+
        '<td><span class="badge '+(BADGE[s.statusType]||'b-gray')+'">'+s.status+'</span></td></tr>';
    }).join('');

    var cnt=document.querySelector('.between .muted');
    var totalEl=document.querySelectorAll('.between .muted');
  }

  function selectClient(id){
    selClient=id; var c=DB.find('clients',id); if(!c) return;
    set('cc-name',c.name); set('cc-city',c.city); set('cc-seg',c.segment); set('cc-ltv',money(c.ltv));
    render();
  }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }

  document.getElementById('cl-add').addEventListener('click',function(){
    var clients=DB.all('clients');
    UI.modal({title:'Новое сервисное обращение', submit:'Создать',
      fields:[
        {k:'client',label:'Клиент',type:'select',value:clients[0].name,options:clients.map(function(c){return {value:c.name,label:c.name};})},
        {k:'type',label:'Тип обращения',placeholder:'напр. Регулировка механизма'},
        {k:'product',label:'Изделие',value:'GEOMETRY 3,5 м'},
        {k:'priority',label:'Приоритет',type:'select',value:'Средний',options:[{value:'Высокий',label:'Высокий'},{value:'Средний',label:'Средний'},{value:'Низкий',label:'Низкий'}]},
        {k:'resp',label:'Ответственный',value:'Нурбек'}
      ],
      onSubmit:function(v){
        if(!v.type){ UI.toast('Укажите тип','err'); return false; }
        var n=DB.all('serviceRequests').length+1042;
        var pc={'Высокий':'red','Средний':'amber','Низкий':'gray'}[v.priority];
        DB.add('serviceRequests',{no:'SR-'+n,client:v.client,type:v.type,product:v.product,priority:v.priority,priColor:pc,resp:v.resp,sla:'Сегодня',status:'В работе',statusType:'blue'});
        UI.toast('Обращение создано','ok'); render();
      }});
  });

  document.getElementById('cl-add-client').addEventListener('click',function(){
    UI.modal({title:'Новый клиент', submit:'Добавить',
      fields:[
        {k:'name',label:'Название / имя',placeholder:'напр. ТОО Уют'},
        {k:'city',label:'Город',value:'Алматы'},
        {k:'product',label:'Изделие',value:'GEOMETRY 3,5 м'},
        {k:'segment',label:'Сегмент',type:'select',value:'Розница',options:['Розница','B2B','Дилер','Дизайнер'].map(function(s){return {value:s,label:s};})},
        {k:'ltv',label:'LTV, ₸',type:'number',value:'300000'}
      ],
      onSubmit:function(v){
        if(!v.name){ UI.toast('Введите название','err'); return false; }
        DB.add('clients',{name:v.name,city:v.city,last:'сегодня',product:v.product,segment:v.segment,status:'Активный',statusType:'green',ltv:parseInt(v.ltv)||0,contact:'только что'});
        UI.toast('Клиент добавлен','ok'); render();
      }});
  });

  var s=document.getElementById('cl-search');
  s.addEventListener('input',function(){ q=s.value.trim().toLowerCase(); render(); });

  render();
})();
