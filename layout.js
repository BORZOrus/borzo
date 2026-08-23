/* BORZO shell: сайдбар + топбар. Каждая страница вызывает BORZO.mount(active,title,sub) */
(function(){
  var I = {
    overview:'<path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-5H4z"/>',
    crm:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.5a3 3 0 0 1 0 6M17 19a5 5 0 0 0-2.5-4.3"/>',
    clients:'<circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    catalog:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    production:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    warehouses:'<path d="M3 9l9-5 9 5v11H3z"/><path d="M3 9h18M9 20v-6h6v6"/>',
    supply:'<path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    shipments:'<rect x="3" y="6" width="13" height="11" rx="1.5"/><path d="M16 9h3l2 3v5h-5z"/><circle cx="8" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    finance:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="8" cy="14.5" r="1.3"/>',
    analytics:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    documents:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    reports:'<path d="M6 3h9l3 3v15H6z"/><path d="M9 17v-4M12 17v-6M15 17v-3"/>',
    staff:'<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 6M20.5 20a5 5 0 0 0-3-4.6"/>',
    marketing:'<path d="M3 11l14-6v14L3 13z"/><path d="M3 11v2M8 12.5V18a2 2 0 0 0 4 0"/>',
    smm:'<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L16 2H8l-.6 2.4a7 7 0 0 0-2 1.2L3 4.7 1 8.1l2 1.5A7 7 0 0 0 3 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L8 22h8l.6-2.4a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5A7 7 0 0 0 19 12z"/>'
  };
  var NAV = [
    {sec:'ПРОДАЖИ', items:[['overview','Обзор','index.html'],['crm','CRM','crm.html'],['clients','Клиенты и сервис','clients.html']]},
    {sec:'ПРОИЗВОДСТВО', items:[['catalog','Каталог','catalog.html'],['production','Производство','production.html'],['warehouses','Склады','warehouses.html'],['supply','Снабжение','supply.html'],['shipments','Отгрузки','shipments.html']]},
    {sec:'ДЕНЬГИ', items:[['finance','Финансы','finance.html'],['analytics','Аналитика','analytics.html'],['documents','Документы','documents.html'],['reports','Отчёты','reports.html']]},
    {sec:'КОМАНДА', items:[['staff','Сотрудники и зарплаты','staff.html']]},
    {sec:'РОСТ', items:[['marketing','Маркетинг','marketing.html'],['smm','СММ и контент','smm.html']]}
  ];
  var READY = {overview:1, crm:1, clients:1, catalog:1, production:1, supply:1, shipments:1, analytics:1, finance:1, documents:1, reports:1, settings:1, warehouses:1, staff:1, smm:1, marketing:1}; // экраны, которые уже собраны

  function icon(n){return '<svg viewBox="0 0 24 24">'+(I[n]||'')+'</svg>';}

  window.BORZO = {
    icon:icon,
    mount:function(active,title,sub){
      var s='<div class="brand"><span class="logo">U</span>BORZO</div>';
      NAV.forEach(function(g){
        s+='<div class="nav-sec">'+g.sec+'</div>';
        g.items.forEach(function(it){
          var k=it[0], cls='nav-item'+(k===active?' active':'')+(READY[k]?'':' soon');
          s+='<a class="'+cls+'" href="'+it[2]+'">'+icon(k)+'<span>'+it[1]+'</span></a>';
        });
      });
      s+='<div class="nav-spacer"></div>';
      s+='<a class="nav-item'+(active==='settings'?' active':'')+(READY.settings?'':' soon')+'" href="settings.html">'+icon('settings')+'<span>Настройки</span></a>';
      document.getElementById('sidebar').innerHTML=s;

      var t='<h1>'+title+'</h1>'+(sub?'<span class="sub">'+sub+'</span>':'');
      t+='<div class="search">'+
         '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;flex:0 0 16px"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>'+
         '<input placeholder="Поиск по системе"></div>';
      t+='<div class="tb-right"><span class="bell"><svg viewBox="0 0 24 24" style="width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:1.7"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="dot">7</span></span>'+
         '<span class="profile"><span class="avatar"></span><span><div class="nm">Алексей В.</div><div class="rl">Владелец</div></span></span></div>';
      document.getElementById('topbar').innerHTML=t;
      document.title='BORZO · '+title;
    }
  };
})();
