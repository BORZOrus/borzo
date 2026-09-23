/* BORZO — включение push-уведомлений. Общий модуль для всех кабинетов (касса/финансы/CRM). */
window.BorzoPush=(function(){
  function b64ToU8(b){ var pad='='.repeat((4-b.length%4)%4), s=(b+pad).replace(/-/g,'+').replace(/_/g,'/'); var raw=atob(s), a=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i); return a; }
  function enable(){
    if(!('serviceWorker' in navigator) || !('PushManager' in window)){ alert('Твой браузер не поддерживает уведомления. На iPhone: открой приложение через кнопку «Поделиться» → «На экран Домой», запусти уже с иконки — и тогда включай.'); return; }
    Notification.requestPermission().then(function(perm){
      if(perm!=='granted'){ alert('Уведомления не разрешены. Включи их в настройках браузера для этого сайта.'); return; }
      navigator.serviceWorker.register('/sw.js').then(function(reg){
        return API.pushKey().then(function(d){
          if(!d.key){ alert('Push на сервере не настроен.'); return; }
          return reg.pushManager.getSubscription().then(function(s){ return s || reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToU8(d.key) }); })
            .then(function(sub){ return API.pushSubscribe(sub.toJSON?sub.toJSON():sub); })
            .then(function(){ alert('Готово! Уведомления о согласованиях будут приходить сюда.'); });
        });
      }).catch(function(e){ alert('Не удалось включить уведомления: '+(e&&e.message||e)); });
    });
  }
  return { enable:enable };
})();
