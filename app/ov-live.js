/* BORZO пульт — живые данные в карточке Финансы (из /api/fin) + баланс кассы снабжения (/api/kassa). */
(function(){
  var tok=localStorage.getItem('borzo_token'); if(!tok) return;
  function api(p){ return fetch('/api'+p,{headers:{'Authorization':'Bearer '+tok}}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }); }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }
  function mln(n){ n=n||0; if(Math.abs(n)>=1e6) return (n/1e6).toFixed(1).replace('.',',')+' млн ₸'; return Math.round(n).toLocaleString('ru-RU')+' ₸'; }
  function signed(n){ n=Math.round(n||0); return (n<0?'−':'+')+mln(Math.abs(n)); }

  // карточка Финансы кликабельна → финмодуль
  var card=document.getElementById('ov-fin-card'); if(card) card.onclick=function(){ location.href='fin.html'; };

  // баланс кассы снабжения
  api('/kassa').then(function(d){ set('ov-fin-kassa', mln(d.balance||0)); }).catch(function(){ set('ov-fin-kassa','—'); });

  // финансы за текущий месяц: приход / расход / результат (бизнес-проекты, без кредитов и переводов между своими кошельками)
  api('/fin').then(function(res){
    var data=res&&res.data;
    if(!data||!Array.isArray(data.ops)||!data.ops.length){ set('ov-fin-in','нет данных'); set('ov-fin-out','—'); set('ov-fin-res','—'); set('ov-fin-upd','Данных пока нет — зайди в финмодуль и залей'); return; }
    var now=new Date(), s=new Date(now.getFullYear(),now.getMonth(),1).getTime(), e=new Date(now.getFullYear(),now.getMonth()+1,1).getTime();
    var PROJ=['BORZO','IT'];
    function isCredit(o){ return o.category==='Погашение кредита'||o.category==='Кредит'||!!o.creditId; }
    var vin=0,vout=0;
    data.ops.forEach(function(o){ var t=o.per||o.ts; if(t<s||t>=e) return;
      var proj=PROJ.indexOf(o.project)>=0;
      if(o.kind==='in' && proj && !isCredit(o)) vin+=o.amount;
      else if(o.kind==='return' && proj) vin-=o.amount;   // возврат покупателю уменьшает выручку (аудит #21)
      else if(proj && !isCredit(o) && (o.kind==='out' || (o.salary&&o.kind==='transfer'))) vout+=o.amount;
    });
    set('ov-fin-in', mln(vin));
    set('ov-fin-out', mln(vout));
    var r=document.getElementById('ov-fin-res'); if(r){ r.textContent=signed(vin-vout); r.style.color=(vin-vout)>=0?'#1fa971':'var(--red,#e5484d)'; }
    var mon=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][now.getMonth()];
    set('ov-fin-upd', 'Живые данные · '+mon+' '+now.getFullYear());
  }).catch(function(err){
    // 401 (протух токен) или нет сети — не ломаем пульт, просто помечаем
    set('ov-fin-in','—'); set('ov-fin-upd', String(err).indexOf('401')>=0?'Нужен вход в финмодуль':'Нет связи');
  });
})();
