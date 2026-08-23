/* Финансы — живая логика: реестр платежей, дебиторка, cashflow-итоги, импорт Excel 🔴 */
(function(){
  var COL={green:'var(--green)',amber:'var(--amber)',red:'var(--red)'};
  function money(n){ return (Math.abs(n)||0).toLocaleString('ru-RU')+' ₸'; }

  function renderPayments(){
    var tb=document.getElementById('paylist'); if(!tb) return;
    tb.innerHTML=DB.all('payments').map(function(p){
      var amt=p.income? '<span style="color:var(--green);font-weight:600">'+money(p.amount)+'</span>' : '<span style="font-weight:600">−'+money(p.amount)+'</span>';
      return '<tr><td class="muted">'+p.date+'</td><td>'+p.type+'</td><td>'+p.party+'</td><td>'+p.purpose+'</td>'+
        '<td style="text-align:right">'+amt+'</td><td><span class="badge b-'+(p.statusType||'green')+'">'+p.status+'</span></td></tr>';
    }).join('');
    updateCashflow();
  }

  function renderReceivables(){
    var tb=document.getElementById('reclist'); if(!tb) return;
    tb.innerHTML=DB.all('receivables').map(function(r){
      return '<tr><td style="font-weight:600">'+r.client+'</td><td style="color:'+(COL[r.overColor]||'var(--ink)')+'">'+r.overdue+'</td>'+
        '<td style="text-align:right;font-weight:600">'+money(r.amount)+'</td><td style="text-align:right" class="muted">'+r.due+'</td></tr>';
    }).join('');
  }

  // Фон за месяц (движения вне видимого реестра) + суммы из реестра = итоги cashflow
  var OTHER_IN=17110000, OTHER_OUT=15670000;
  function updateCashflow(){
    var regIn=0, regOut=0;
    DB.all('payments').forEach(function(p){ if(p.income) regIn+=p.amount; else regOut+=Math.abs(p.amount); });
    var inc=OTHER_IN+regIn, out=OTHER_OUT+regOut, net=inc-out;
    set('cf-in', money(inc));
    set('cf-out', '−'+money(out));
    set('cf-net', (net<0?'−':'')+money(net));
  }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }

  // Добавить платёж
  document.getElementById('fin-add').addEventListener('click',function(){
    UI.modal({title:'Добавить платёж', submit:'Провести',
      fields:[
        {k:'date',label:'Дата',value:'01.06.2025'},
        {k:'type',label:'Тип',type:'select',value:'Поступление',options:[{value:'Поступление',label:'Поступление (приход)'},{value:'Выплата',label:'Выплата (расход)'}]},
        {k:'party',label:'Контрагент',placeholder:'напр. ООО «Клиент»'},
        {k:'purpose',label:'Назначение',placeholder:'напр. Оплата заказа №1260'},
        {k:'amount',label:'Сумма, ₸',type:'number',value:'500000'}
      ],
      onSubmit:function(v){
        var sum=parseInt(v.amount)||0; if(sum<=0){ UI.toast('Укажите сумму','err'); return false; }
        if(!v.party){ UI.toast('Укажите контрагента','err'); return false; }
        var income=v.type==='Поступление';
        DB.add('payments',{date:v.date,type:v.type,party:v.party,purpose:v.purpose||'—',amount:income?sum:-sum,income:income,status:'Проведён',statusType:'green'});
        UI.toast('Платёж проведён','ok'); renderPayments();
      }});
  });

  // 🔴 Импорт Excel — ячейка под загрузку файла (реально заработает после сервера)
  document.getElementById('fin-import').addEventListener('click',function(){
    UI.modal({title:'Импорт из Excel', submit:'Загрузить',
      fields:[
        {k:'file',label:'Файл Excel (.xlsx / .csv)',type:'text',placeholder:'выберите файл после запуска сервера'},
        {k:'sheet',label:'Что импортируем',type:'select',value:'payments',options:[{value:'payments',label:'Реестр платежей'},{value:'receivables',label:'Дебиторка'},{value:'budget',label:'Бюджет / план-факт'}]}
      ],
      onSubmit:function(v){
        UI.toast('🔴 Загрузка файлов включится после запуска сервера','');
        return true;
      }});
  });

  // «?» двуязычная инструкция по импорту Excel
  document.getElementById('fin-help').addEventListener('click',function(){
    UI.info({title:'Как загрузить финансы из Excel (how to import from Excel)', html:
      '<div style="margin-bottom:8px">Пошагово. Русский сверху, English ниже (step by step):</div>'+
      '<div style="margin-bottom:11px"><div style="font-weight:600"><span style="color:var(--blue)">1.</span> Подготовь файл Excel (таблица) с колонками: Дата, Тип, Контрагент, Сумма</div><div class="muted" style="font-size:12px">🇬🇧 Prepare an Excel (таблица) file with columns (колонки): Date, Type, Counterparty, Amount</div></div>'+
      '<div style="margin-bottom:11px"><div style="font-weight:600"><span style="color:var(--blue)">2.</span> Сохрани как .xlsx или .csv (форматы таблиц)</div><div class="muted" style="font-size:12px">🇬🇧 Save (сохранить) as .xlsx or .csv (spreadsheet formats — форматы таблиц)</div></div>'+
      '<div style="margin-bottom:11px"><div style="font-weight:600"><span style="color:var(--blue)">3.</span> Нажми «Импорт Excel» → выбери файл (Choose file) → выбери раздел</div><div class="muted" style="font-size:12px">🇬🇧 Click Import (импорт) → Choose file (выбрать файл) → pick the section (раздел)</div></div>'+
      '<div style="margin-bottom:11px"><div style="font-weight:600"><span style="color:var(--blue)">4.</span> Нажми «Загрузить» (Upload) — данные появятся в реестре</div><div class="muted" style="font-size:12px">🇬🇧 Click Upload (загрузить) — the data appears in the register (реестр)</div></div>'+
      '<div class="muted" style="font-size:12px;margin-top:6px">🔴 Реальная загрузка файлов включится после запуска сервера (real file upload works after the server is launched).</div>'});
  });

  renderPayments(); renderReceivables();
})();
