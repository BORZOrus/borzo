/* Отчёты — живая логика: список, выгрузка файла, шаблоны (создание), популярные */
(function(){
  var TONE={green:'var(--green)',violet:'var(--violet)',amber:'var(--amber)',blue:'var(--blue)',red:'var(--red)'};
  var SOFT={green:'var(--green-soft)',violet:'var(--violet-soft)',amber:'var(--amber-soft)',blue:'var(--blue-soft)',red:'var(--red-soft)'};

  function renderReports(){
    var tb=document.getElementById('replist'); if(!tb) return;
    tb.innerHTML=DB.all('reports').map(function(r){
      var fileCell = r.file ? '<div>'+r.file+'</div><div class="muted">'+r.size+'</div>' : '<span class="muted">—</span>';
      var dl = r.file ? '<span class="dl" data-dl="'+r.id+'">↓</span>' : '';
      return '<tr><td><span class="row" style="gap:9px"><span class="fico" style="background:'+r.iconColor+'">'+r.icon+'</span>'+r.name+'</span></td>'+
        '<td>'+r.type+'</td><td class="muted">'+r.period+'</td><td class="muted">'+r.created+'</td>'+
        '<td><span class="badge b-'+(r.statusType||'gray')+'">'+r.status+'</span></td><td>'+fileCell+'</td><td>'+dl+'</td></tr>';
    }).join('');
    tb.querySelectorAll('[data-dl]').forEach(function(b){
      b.addEventListener('click',function(){ var r=DB.find('reports',b.getAttribute('data-dl')); UI.toast('Выгружен файл: '+r.file+' (🔴 реальное скачивание — после сервера)',''); });
    });
  }

  function renderPopular(){
    var tb=document.getElementById('poplist'); if(!tb) return;
    tb.innerHTML=DB.all('popularReports').map(function(p){
      return '<tr><td style="font-weight:600">'+p.name+'</td><td style="text-align:right">'+p.runs+'</td><td style="text-align:right">'+p.downloads+'</td></tr>';
    }).join('');
  }

  function renderTemplates(){
    var box=document.getElementById('tpllist'); if(!box) return;
    box.innerHTML=DB.all('reportTemplates').map(function(t){
      return '<div class="tpl"><span class="fico" style="background:'+SOFT[t.tone]+';color:'+TONE[t.tone]+'">'+t.icon+'</span>'+
        '<div style="flex:1"><div style="font-weight:600">'+t.name+'</div><div class="muted">'+t.desc+'</div></div>'+
        '<span class="btn" data-tpl="'+t.id+'" style="padding:6px 12px;font-size:11.5px;cursor:pointer">Создать</span></div>';
    }).join('');
    box.querySelectorAll('[data-tpl]').forEach(function(b){
      b.addEventListener('click',function(){ createFromTemplate(b.getAttribute('data-tpl')); });
    });
  }

  function slug(s){
    var map={'Продажи':'sales','Финансы':'finance','Склад':'stock','Производство':'production','Снабжение':'procurement','Клиенты':'clients','Сервис':'service'};
    return (map[s]||'report');
  }

  function createFromTemplate(id){
    var t=DB.find('reportTemplates',id); if(!t) return;
    var icons={green:'#1fa971',violet:'#8b5cf6',amber:'#f0a621',blue:'#2f66f6',red:'#e5484d'};
    // 1) создаём отчёт «В процессе», ставим сверху
    var rep=DB.add('reports',{name:t.name,icon:t.icon,iconColor:icons[t.tone]||'#2f66f6',type:t.type,period:'Июнь 2025',created:'только что',status:'В процессе',statusType:'amber',file:'',size:''});
    // поднять наверх
    var arr=DB.raw('reports'); arr.pop(); arr.unshift(rep);
    UI.toast('Отчёт «'+t.name+'» формируется…','');
    renderReports();
    // 2) «готовим» — переводим в Готов с файлом (имитация фоновой генерации без таймеров)
    DB.update('reports',rep.id,{status:'Готов',statusType:'green',created:'сегодня',file:slug(t.type)+'_june_2025.xlsx',size:'—'});
    renderReports();
    UI.toast('Отчёт «'+t.name+'» готов','ok');
  }

  renderReports(); renderPopular(); renderTemplates();
})();
