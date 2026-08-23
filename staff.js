/* Сотрудники — живая логика: список, поиск, добавление, увольнение, вакансии, ДР, отпуска, табы */
(function(){
  var q='';
  function money(n){ return (n||0).toLocaleString('ru-RU')+' ₸'; }
  function ini(name){ var p=name.trim().split(/\s+/); return ((p[0]||' ')[0]+(p[1]||' ')[0]).toUpperCase(); }
  function match(e){ if(!q) return true; return (e.name+' '+e.role+' '+e.dept).toLowerCase().indexOf(q)>=0; }

  function renderStaff(){
    var tb=document.getElementById('st-list'); if(!tb) return;
    var items=DB.all('staff').filter(match);
    tb.innerHTML=items.map(function(e){
      return '<tr data-id="'+e.id+'"><td><span class="row" style="gap:9px"><span class="emp">'+e.ini+'</span>'+e.name+'</span></td>'+
        '<td>'+e.role+'</td><td>'+e.dept+'</td><td style="text-align:right;font-weight:600">'+money(e.salary)+'</td>'+
        '<td><span class="badge b-'+(e.statusType||'green')+'">'+e.status+'</span></td>'+
        '<td class="ch" data-menu="'+e.id+'" style="cursor:pointer">⋮</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">Не найдено</td></tr>';
    tb.querySelectorAll('[data-menu]').forEach(function(c){
      c.addEventListener('click',function(){ empMenu(c.getAttribute('data-menu')); });
    });
    var cnt=document.getElementById('st-count');
    if(cnt) cnt.textContent='Показать всех сотрудников ('+(DB.all('staff').length + 15)+') ↓';
  }

  function empMenu(id){
    var e=DB.find('staff',id); if(!e) return;
    UI.modal({title:e.name, submit:'Сохранить',
      fields:[
        {k:'role',label:'Должность',value:e.role},
        {k:'dept',label:'Подразделение',value:e.dept},
        {k:'salary',label:'Оклад, ₸',type:'number',value:String(e.salary)},
        {k:'status',label:'Статус',type:'select',value:e.status,options:['Активен','В отпуске','Больничный','Уволен'].map(function(s){return {value:s,label:s};})}
      ],
      onSubmit:function(v){
        var stMap={'Активен':'green','В отпуске':'blue','Больничный':'amber','Уволен':'gray'};
        DB.update('staff',id,{role:v.role,dept:v.dept,salary:parseInt(v.salary)||e.salary,status:v.status,statusType:stMap[v.status]||'green'});
        UI.toast('Данные сотрудника обновлены','ok'); renderStaff();
      }});
  }

  function renderVacancies(){
    var tb=document.getElementById('vac-list'); if(!tb) return;
    tb.innerHTML=DB.all('vacancies').map(function(v){
      return '<tr><td style="font-weight:600">'+v.role+'</td><td>'+v.dept+'</td><td style="text-align:right"><span class="badge b-'+(v.statusType||'amber')+'">'+v.status+'</span></td></tr>';
    }).join('') || '<tr><td colspan="3" class="muted">Открытых вакансий нет</td></tr>';
  }

  function renderBirthdays(){
    var box=document.getElementById('bd-list'); if(!box) return;
    box.innerHTML=DB.all('birthdays').map(function(b){
      return '<div class="bd"><span class="dt2">'+b.date+'</span><div style="flex:1"><div style="font-weight:600">'+b.name+'</div><div class="sub-t">'+b.role+'</div></div></div>';
    }).join('');
  }

  function renderVacations(){
    var box=document.getElementById('vac2-list'); if(!box) return;
    box.innerHTML=DB.all('vacations').map(function(v){
      return '<div class="bd"><span class="dt2" style="width:78px;flex:0 0 78px">'+v.period+'</span><div style="flex:1"><div style="font-weight:600">'+v.name+'</div></div><span class="muted">'+v.days+'</span></div>';
    }).join('');
  }

  // Добавить сотрудника
  document.getElementById('st-add').addEventListener('click',function(){
    UI.modal({title:'Добавить сотрудника', submit:'Добавить',
      fields:[
        {k:'name',label:'ФИО',placeholder:'напр. Ахметов Санжар'},
        {k:'role',label:'Должность',placeholder:'напр. Сборщик мебели'},
        {k:'dept',label:'Подразделение',type:'select',value:'Производство',options:['Отдел продаж','Производство','Склады','Снабжение','Бухгалтерия','Администрация'].map(function(s){return {value:s,label:s};})},
        {k:'salary',label:'Оклад, ₸',type:'number',value:'250000'}
      ],
      onSubmit:function(v){
        if(!v.name){ UI.toast('Введите ФИО','err'); return false; }
        DB.add('staff',{ini:ini(v.name),name:v.name,role:v.role||'—',dept:v.dept,salary:parseInt(v.salary)||0,status:'Активен',statusType:'green'});
        UI.toast('Сотрудник добавлен','ok'); renderStaff();
      }});
  });

  // Поиск
  var s=document.getElementById('st-search');
  s.addEventListener('input',function(){ q=s.value.trim().toLowerCase(); renderStaff(); });

  // Табы (пока активна только «Сотрудники», остальные — в разработке)
  var tabs=document.getElementById('st-tabs');
  tabs.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click',function(){
      tabs.querySelectorAll('a').forEach(function(x){ x.className=''; });
      a.className='on';
      if(a.textContent!=='Сотрудники') UI.toast('Вкладка «'+a.textContent+'» — на следующем заходе оживления','');
    });
  });

  renderStaff(); renderVacancies(); renderBirthdays(); renderVacations();
})();
