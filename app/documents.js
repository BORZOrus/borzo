/* Документы — живая логика: список, поиск, фильтры, контроль, быстрые действия */
(function(){
  var MC={violet:'var(--violet)',amber:'var(--amber)',red:'var(--red)',green:'var(--green)',blue:'var(--blue)'};
  var q='', filter='all';
  var TOTAL=1248;

  function match(d){
    if(filter!=='all' && d.dir!==filter) return false;
    if(!q) return true;
    return (d.name+' '+d.type+' '+d.party).toLowerCase().indexOf(q)>=0;
  }

  function renderDocs(){
    var tb=document.getElementById('doclist'); if(!tb) return;
    var items=DB.all('documents').filter(match);
    tb.innerHTML=items.map(function(d){
      return '<tr data-id="'+d.id+'" style="cursor:pointer"><td><span class="row" style="gap:9px"><span class="fico" style="background:'+d.ficoColor+'">'+d.fico+'</span>'+d.name+'</span></td>'+
        '<td>'+d.type+'</td><td>'+d.party+'</td><td class="muted">'+d.date+'</td>'+
        '<td><span class="badge b-'+(d.statusType||'gray')+'">'+d.status+'</span></td><td style="text-align:right" class="muted">'+d.size+'</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">Ничего не найдено</td></tr>';
    tb.querySelectorAll('tr[data-id]').forEach(function(r){ r.addEventListener('click',function(){ var d=DB.find('documents',r.getAttribute('data-id')); UI.toast('Открыт документ: '+d.name,'ok'); }); });
    var c=document.getElementById('doc-count');
    var extra=TOTAL-DB.all('documents').length;
    if(c) c.textContent='Показано '+items.length+' из '+(items.length+ (filter==='all'&&!q?extra:0))+' документов';
  }

  function renderControl(){
    var box=document.getElementById('ctrllist'); if(!box) return;
    box.innerHTML=DB.all('docControl').map(function(d){
      return '<div class="ctl"><span class="fico" style="background:'+(MC[d.markColor]||'var(--violet)')+'">'+d.mark+'</span>'+
        '<div style="flex:1"><div class="main-t" style="font-weight:600">'+d.name+'</div><div class="sub-t">'+d.party+'</div></div>'+
        '<div style="text-align:right"><div style="color:'+(MC[d.noteColor]||'var(--red)')+';font-weight:600;font-size:11px">'+d.note+'</div><div class="muted">'+d.term+'</div></div></div>';
    }).join('');
  }

  // Фильтры
  var fb=document.getElementById('doc-filters');
  fb.querySelectorAll('[data-filter]').forEach(function(b){
    b.addEventListener('click',function(){
      filter=b.getAttribute('data-filter');
      fb.querySelectorAll('[data-filter]').forEach(function(x){ x.className='badge '+(x===b?'b-violet':'b-gray'); x.style.cursor='pointer'; });
      renderDocs();
    });
  });

  // Поиск
  var s=document.getElementById('doc-search');
  s.addEventListener('input',function(){ q=s.value.trim().toLowerCase(); renderDocs(); });

  // Создать документ
  document.getElementById('qa-create').addEventListener('click',function(){
    UI.modal({title:'Создать документ', submit:'Создать',
      fields:[
        {k:'name',label:'Название',placeholder:'напр. Договор поставки №127'},
        {k:'type',label:'Тип',type:'select',value:'Договор',options:['Договор','Счёт','КП','Акт','Спецификация','Гарантия','Инструкция','План'].map(function(x){return {value:x,label:x};})},
        {k:'party',label:'Контрагент',placeholder:'напр. ООО «Клиент»'},
        {k:'dir',label:'Направление',type:'select',value:'out',options:[{value:'in',label:'Входящий'},{value:'out',label:'Исходящий'},{value:'inner',label:'Внутренний'}]}
      ],
      onSubmit:function(v){
        if(!v.name){ UI.toast('Введите название','err'); return false; }
        var fmt={'Спецификация':['XLS','#1fa971'],'План':['XLS','#1fa971'],'КП':['DOC','#2f66f6'],'Гарантия':['DOC','#2f66f6']}[v.type]||['PDF','#e5484d'];
        DB.add('documents',{name:v.name+(v.name.indexOf('.')<0?'.pdf':''),fico:fmt[0],ficoColor:fmt[1],type:v.type,party:v.party||'—',date:'сегодня',status:'Черновик',statusType:'gray',size:'—',dir:v.dir});
        UI.toast('Документ создан','ok'); renderDocs();
      }});
  });

  // Загрузить документ 🔴 (файл после сервера)
  document.getElementById('qa-upload').addEventListener('click',function(){
    UI.modal({title:'Загрузить документ', submit:'Загрузить',
      fields:[{k:'file',label:'Файл (Choose file — выбрать файл)',type:'text',placeholder:'выбор файла — после запуска сервера'}],
      onSubmit:function(){ UI.toast('🔴 Загрузка файлов включится после запуска сервера','' ); return true; }});
  });

  document.getElementById('qa-folder').addEventListener('click',function(){
    UI.modal({title:'Создать папку', submit:'Создать', fields:[{k:'name',label:'Имя папки',placeholder:'напр. Договоры 2025'}],
      onSubmit:function(v){ if(!v.name){UI.toast('Введите имя','err');return false;} UI.toast('Папка «'+v.name+'» создана','ok'); }});
  });
  document.getElementById('qa-tpl').addEventListener('click',function(){
    UI.info({title:'Шаблоны документов (templates)', html:'Готовые шаблоны (templates — заготовки): Договор, Счёт (invoice — счёт на оплату), КП (commercial offer — коммерческое предложение), Акт, Гарантийный талон. Выбери шаблон → заполни поля → сохрани. Полноценный редактор подключим после сервера 🔴.'});
  });

  renderDocs(); renderControl();
})();
