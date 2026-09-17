/* BORZO — service worker: приём push-уведомлений */
self.addEventListener('push', function(e){
  var d={};
  try{ d=e.data.json(); }catch(_){ d={ title:'BORZO', body:(e.data&&e.data.text())||'' }; }
  e.waitUntil(self.registration.showNotification(d.title||'BORZO', {
    body: d.body||'',
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    vibrate: [80,40,80],
    data: { url: d.url||'/kassa.html' }
  }));
});
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url=(e.notification.data && e.notification.data.url) || '/kassa.html';
  e.waitUntil(clients.matchAll({type:'window'}).then(function(list){
    for(var i=0;i<list.length;i++){ if('focus' in list[i]) return list[i].focus(); }
    if(clients.openWindow) return clients.openWindow(url);
  }));
});
