/* SMM — живая логика: публикации, реклама, задачи (чек), планирование поста, кампании, табы */
(function(){
  function renderPosts(){
    var tb=document.getElementById('smm-posts'); if(!tb) return;
    tb.innerHTML=DB.all('smmPosts').map(function(p){
      return '<tr><td style="font-weight:600">'+p.title+'</td><td>'+p.channel+'</td><td class="muted">'+p.date+'</td>'+
        '<td style="text-align:right">'+p.reach+'</td><td style="text-align:right">'+p.er+'</td>'+
        '<td><span class="badge b-'+(p.statusType||'green')+'">'+p.status+'</span></td></tr>';
    }).join('');
  }

  function renderAds(){
    var tb=document.getElementById('smm-ads'); if(!tb) return;
    tb.innerHTML=DB.all('smmAds').map(function(a){
      return '<tr><td style="font-weight:600">'+a.name+'</td><td>'+a.channel+'</td>'+
        '<td style="text-align:right">'+a.spent+'</td><td style="text-align:right">'+a.result+'</td><td style="text-align:right">'+a.cpa+'</td></tr>';
    }).join('');
  }

  function renderTasks(){
    var box=document.getElementById('smm-tasks'); if(!box) return;
    box.innerHTML=DB.all('smmTasks').map(function(t){
      var chk=t.done? '<span data-task="'+t.id+'" style="cursor:pointer;width:17px;height:17px;flex:0 0 17px;border-radius:5px;background:var(--green);color:#fff;display:inline-grid;place-items:center;font-size:12px">✓</span>'
        : '<span class="box" data-task="'+t.id+'" style="cursor:pointer"></span>';
      var nm=t.done? '<span style="flex:1;font-weight:500;text-decoration:line-through;color:var(--ink3)">'+t.title+'</span>' : '<span style="flex:1;font-weight:500">'+t.title+'</span>';
      return '<div class="tk">'+chk+nm+'<span class="badge b-'+(t.tagType||'gray')+'">'+t.tag+'</span><span class="muted">'+t.due+'</span><span class="emp" style="width:26px;height:26px">'+t.who+'</span></div>';
    }).join('');
    box.querySelectorAll('[data-task]').forEach(function(c){
      c.addEventListener('click',function(){ var t=DB.find('smmTasks',c.getAttribute('data-task')); DB.update('smmTasks',t.id,{done:!t.done}); renderTasks(); });
    });
  }

  // Запланировать пост
  function schedulePost(){
    var ig=DB.find('integrations','instagram');
    UI.modal({title:'Запланировать пост', submit:'Запланировать',
      fields:[
        {k:'title',label:'Тема поста',placeholder:'напр. Новинка: LUX 2.5 м'},
        {k:'channel',label:'Канал (channel)',type:'select',value:'Instagram',options:['Instagram','TikTok','Telegram','VK','YouTube'].map(function(s){return {value:s,label:s};})},
        {k:'type',label:'Формат',type:'select',value:'Reels',options:['Reels','Фото','Карусель','Stories','Текст'].map(function(s){return {value:s,label:s};})},
        {k:'date',label:'Дата',value:'02.06.2025'}
      ],
      onSubmit:function(v){
        if(!v.title){ UI.toast('Введите тему','err'); return false; }
        DB.add('smmPosts',{title:v.title,channel:v.channel,date:v.date,reach:'—',er:'—',status:'Запланировано',statusType:'blue'});
        renderPosts();
        if(!ig || ig.status!=='on') UI.toast('Пост в плане. 🔴 Авто-публикация — после ключа Instagram/Meta в Настройках','');
        else UI.toast('Пост запланирован','ok');
      }});
  }

  function newAd(){
    UI.modal({title:'Создать рекламную кампанию', submit:'Создать',
      fields:[
        {k:'name',label:'Название',placeholder:'напр. Промо Reels июнь'},
        {k:'channel',label:'Канал',type:'select',value:'Instagram',options:['Instagram','TikTok','Telegram','VK','YouTube'].map(function(s){return {value:s,label:s};})},
        {k:'spent',label:'Бюджет, ₸',type:'number',value:'50000'}
      ],
      onSubmit:function(v){
        if(!v.name){ UI.toast('Введите название','err'); return false; }
        DB.add('smmAds',{name:v.name,channel:v.channel,spent:(parseInt(v.spent)||0).toLocaleString('ru-RU')+' ₸',result:'—',cpa:'—'});
        UI.toast('Кампания создана','ok'); renderAds();
      }});
  }

  document.getElementById('smm-schedule').addEventListener('click',schedulePost);
  document.getElementById('smm-add-ad').addEventListener('click',newAd);

  // Табы
  var tabs=document.getElementById('smm-tabs');
  tabs.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click',function(){
      tabs.querySelectorAll('a').forEach(function(x){ x.className=''; });
      a.className='on';
      if(a.textContent!=='Обзор') UI.toast('Вкладка «'+a.textContent+'» — на следующем заходе оживления','');
    });
  });

  renderPosts(); renderAds(); renderTasks();
})();
