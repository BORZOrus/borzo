/* Единая кнопка «Установить приложение» для каждой двери BORZO.
   Показывает внизу плашку, если дверь ещё НЕ установлена. Android — установка в один тап (beforeinstallprompt).
   iPhone — короткая инструкция (iOS не умеет ставить программно). Если дверь уже установлена (standalone) — молчит. */
(function(){
  // уже открыто как приложение (установлено) — ничего не предлагаем
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if(standalone) return;
  var ua = navigator.userAgent||'';
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isAndroid = /android/i.test(ua);
  // название двери берём из мета-тега страницы
  var titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  var appName = (titleMeta && titleMeta.content) || 'приложение';
  var deferred = null;

  window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); deferred = e; var b=document.getElementById('inst-go'); if(b) b.textContent='📲 Установить «'+appName+'»'; });
  window.addEventListener('appinstalled', function(){ remove(); });

  function remove(){ var el=document.getElementById('inst-bar'); if(el) el.remove(); }

  function iosSteps(){
    alert('Чтобы поставить иконку «'+appName+'» на экран:\n\n1. Открой эту страницу в Safari\n2. Нажми «Поделиться» (квадрат со стрелкой вверх)\n3. Выбери «На экран «Домой»»\n\nИконка появится отдельным приложением.');
  }
  function androidSteps(){
    alert('Чтобы поставить иконку «'+appName+'»:\n\nМеню Chrome (три точки ⋮) → «Установить приложение» / «Добавить на главный экран».\n\nЕсли пункта нет — открой адрес в обычной (или инкогнито) вкладке Chrome.');
  }

  function build(){
    if(document.getElementById('inst-bar')) return;
    var bar=document.createElement('div'); bar.id='inst-bar';
    bar.setAttribute('style','position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:8px;align-items:center;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#008069;color:#fff;box-shadow:0 -4px 18px rgba(0,0,0,.28);font-family:Inter,system-ui,sans-serif');
    bar.innerHTML='<button id="inst-go" style="flex:1;background:#fff;color:#00604e;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:700;min-height:46px">📲 Установить «'+appName+'» на телефон</button>'+
                  '<button id="inst-x" aria-label="Скрыть" style="flex:0 0 auto;background:rgba(255,255,255,.18);color:#fff;border:0;border-radius:10px;width:46px;height:46px;font-size:18px">✕</button>';
    document.body.appendChild(bar);
    document.getElementById('inst-x').onclick=remove;
    document.getElementById('inst-go').onclick=function(){
      if(deferred){ deferred.prompt(); deferred.userChoice.then(function(c){ if(c&&c.outcome==='accepted') remove(); deferred=null; }); }
      else if(isIOS){ iosSteps(); }
      else { androidSteps(); }
    };
  }
  // показываем плашку после загрузки (даём шанс beforeinstallprompt прийти)
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ setTimeout(build,600); });
  else setTimeout(build,600);
})();
