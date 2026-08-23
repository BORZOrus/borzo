/* Маркетинг — живая логика: каналы, кампании (создать/пауза), активности (чек/добавить), быстрые действия, табы */
(function(){
  function money(n){ return (n||0).toLocaleString('ru-RU'); }

  function renderChannels(){
    var tb=document.getElementById('mk-channels'); if(!tb) return;
    tb.innerHTML=DB.all('mktChannels').map(function(c){
      return '<tr><td style="font-weight:600">'+c.name+'</td><td style="text-align:right">'+c.leads+'</td>'+
        '<td style="text-align:right">'+c.cpl+'</td><td style="text-align:right">'+c.conv+'</td><td style="text-align:right">'+c.revenue+'</td></tr>';
    }).join('');
  }

  function renderCampaigns(){
    var tb=document.getElementById('mk-campaigns'); if(!tb) return;
    tb.innerHTML=DB.all('campaigns').map(function(c){
      return '<tr><td style="font-weight:600">'+c.name+'</td><td>'+c.channel+'</td>'+
        '<td style="text-align:right">'+money(c.budget)+'</td><td style="text-align:right">'+money(c.spent)+'</td>'+
        '<td style="text-align:right">'+c.leads+'</td><td style="text-align:right">'+money(c.cpl)+'</td>'+
        '<td><span class="badge b-'+(c.statusType||'green')+'" data-camp="'+c.id+'" style="cursor:pointer" title="Клик: пауза/запуск">'+c.status+'</span></td></tr>';
    }).join('');
    tb.querySelectorAll('[data-camp]').forEach(function(b){
      b.addEventListener('click',function(){
        var c=DB.find('campaigns',b.getAttribute('data-camp'));
        var pause=c.status==='Активна';
        DB.update('campaigns',c.id,{status:pause?'На паузе':'Активна',statusType:pause?'amber':'green'});
        UI.toast('Кампания «'+c.name+'» '+(pause?'на паузе':'запущена'),'ok'); renderCampaigns();
      });
    });
  }

  function renderActs(){
    var tb=document.getElementById('mk-acts'); if(!tb) return;
    tb.innerHTML=DB.all('mktActivities').map(function(a){
      var box=a.done? '<span style="display:inline-block;width:15px;height:15px;border-radius:4px;background:var(--green);color:#fff;text-align:center;line-height:15px;font-size:11px">✓</span>'
        : '<span style="display:inline-block;width:15px;height:15px;border:1.6px solid var(--line);border-radius:4px"></span>';
      var st=a.done? '<span class="badge b-green">Выполнено</span>' : '<span class="badge b-blue">Запланировано</span>';
      var nm=a.done? '<span style="font-weight:600;text-decoration:line-through;color:var(--ink3)">'+a.title+'</span>' : '<span style="font-weight:600">'+a.title+'</span>';
      return '<tr><td data-act="'+a.id+'" style="cursor:pointer">'+box+'</td><td>'+nm+'</td><td>'+a.kind+'</td>'+
        '<td class="muted">'+a.due+'</td><td>'+a.resp+'</td><td>'+st+'</td></tr>';
    }).join('');
    tb.querySelectorAll('[data-act]').forEach(function(c){
      c.addEventListener('click',function(){
        var a=DB.find('mktActivities',c.getAttribute('data-act'));
        DB.update('mktActivities',a.id,{done:!a.done}); renderActs();
      });
    });
  }

  function newCampaign(){
    UI.modal({title:'Создать кампанию', submit:'Запустить',
      fields:[
        {k:'name',label:'Название',placeholder:'напр. LUX 2.5 — распродажа'},
        {k:'channel',label:'Канал',type:'select',value:'Instagram',options:['Instagram','TikTok','Google Ads','Сайт (SEO)','Яндекс Директ','WhatsApp'].map(function(s){return {value:s,label:s};})},
        {k:'budget',label:'Бюджет, ₸',type:'number',value:'150000'}
      ],
      onSubmit:function(v){
        if(!v.name){ UI.toast('Введите название','err'); return false; }
        DB.add('campaigns',{name:v.name,channel:v.channel,budget:parseInt(v.budget)||0,spent:0,leads:0,cpl:0,status:'Активна',statusType:'green'});
        UI.toast('Кампания создана','ok'); renderCampaigns();
      }});
  }

  function newActivity(){
    UI.modal({title:'Добавить активность', submit:'Добавить',
      fields:[
        {k:'title',label:'Активность',placeholder:'напр. Рассылка по базе'},
        {k:'kind',label:'Тип',type:'select',value:'Контент',options:['Кампания','Контент','Аналитика','Email','Прочее'].map(function(s){return {value:s,label:s};})},
        {k:'due',label:'Срок',value:'10.06.2025'},
        {k:'resp',label:'Ответственный',value:'Арина И.'}
      ],
      onSubmit:function(v){
        if(!v.title){ UI.toast('Введите название','err'); return false; }
        DB.add('mktActivities',{title:v.title,kind:v.kind,due:v.due,resp:v.resp,done:false});
        UI.toast('Активность добавлена','ok'); renderActs();
      }});
  }

  document.getElementById('mk-add-camp').addEventListener('click',newCampaign);
  document.getElementById('mk-add-act').addEventListener('click',newActivity);
  document.getElementById('qa-camp').addEventListener('click',newCampaign);
  document.getElementById('qa-post').addEventListener('click',function(){ UI.toast('Планировщик публикаций — в разделе SMM','' ); });
  document.getElementById('qa-creative').addEventListener('click',function(){
    UI.info({title:'Создать рекламный креатив (ad creative — рекламная картинка)', html:'Генерация картинок и видео через fal.ai (сервис ИИ-графики). 🔴 Подключится после ввода ключа FAL и запуска сервера. Тогда: пишешь описание (prompt — запрос) → получаешь готовый креатив для Instagram/TikTok.'});
  });
  document.getElementById('qa-comp').addEventListener('click',function(){ UI.toast('Анализ конкурентов — оживим на след. заходе','' ); });
  document.getElementById('qa-kpi').addEventListener('click',function(){ UI.toast('Настройка целей/KPI — вкладка «Настройки»','' ); });

  // Табы
  var tabs=document.getElementById('mk-tabs');
  tabs.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click',function(){
      tabs.querySelectorAll('a').forEach(function(x){ x.className=''; });
      a.className='on';
      if(a.textContent!=='Обзор') UI.toast('Вкладка «'+a.textContent+'» — на следующем заходе оживления','');
    });
  });

  renderChannels(); renderCampaigns(); renderActs();
})();
