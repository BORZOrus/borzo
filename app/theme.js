/* BORZO — темы приложения. Хранится в localStorage, применяется на всех страницах (fin/kassa/crm/home/quick).
   Управляет CSS-переменными обеих систем имён (--bg... и --k-bg...). Цвета выдержанные, «дорогие»: низкая насыщенность. */
window.BorzoTheme=(function(){
  var KEY='borzo_theme_v1';
  // пресеты: bgL/cardL — светлота фона и плашек (%), hue — оттенок акцента
  var PRESETS={
    'Уголь':  {bgL:7,  cardL:12, hue:217, hs:76, hl:59},   // родной тёмный, синий акцент
    'Графит': {bgL:10, cardL:15, hue:220, hs:12, hl:62},   // серый благородный
    'Хвоя':   {bgL:8,  cardL:13, hue:160, hs:22, hl:52},   // глубокий приглушённый зелёный
    'Слива':  {bgL:8,  cardL:13, hue:275, hs:20, hl:62},   // тёмный фиолетово-пастельный
    'Коньяк': {bgL:8,  cardL:13, hue:36,  hs:38, hl:56}    // тёплый золотисто-коричневый
  };
  function hsl(h,s,l){ return 'hsl('+h+','+s+'%,'+l+'%)'; }
  function apply(t){
    t=t||PRESETS['Уголь'];
    var r=document.documentElement.style;
    var bg=hsl(222,9,t.bgL), card=hsl(222,10,t.cardL), card2=hsl(222,11,t.cardL+5), line=hsl(222,10,t.cardL+9);
    var acc=hsl(t.hue, t.hs!=null?t.hs:28, t.hl!=null?t.hl:58);
    ['--bg','--page','--k-bg'].forEach(function(v){r.setProperty(v,bg);});
    ['--card','--k-card'].forEach(function(v){r.setProperty(v,card);});
    ['--card2','--k-card2'].forEach(function(v){r.setProperty(v,card2);});
    ['--line','--k-line'].forEach(function(v){r.setProperty(v,line);});
    ['--blue','--k-blue'].forEach(function(v){r.setProperty(v,acc);});
    var meta=document.querySelector('meta[name=theme-color]'); if(meta)meta.setAttribute('content',bg);
  }
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)); }catch(e){ return null; } }
  function save(t){ localStorage.setItem(KEY,JSON.stringify(t)); apply(t); }
  function current(){ return load()||Object.assign({},PRESETS['Уголь']); }
  // окно настройки: 5 пресетов + 3 бегунка (фон, плашки, акцент). openSheet/closeSheet передаёт страница.
  function editorHtml(){
    var t=current();
    return '<h3>🎨 Тема приложения</h3>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'+Object.keys(PRESETS).map(function(n){
        return '<button type="button" data-preset="'+n+'" style="flex:1;min-width:80px;padding:10px 6px;border:1px solid hsl('+PRESETS[n].hue+','+(PRESETS[n].hs||28)+'%,'+(PRESETS[n].hl||58)+'%);background:hsl(222,10%,'+PRESETS[n].cardL+'%);color:#eef0f3;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit">'+n+'</button>';
      }).join('')+'</div>'+
      '<label style="display:block;font-size:12px;margin-bottom:4px;opacity:.7">Фон приложения (темнее ↔ светлее)</label>'+
      '<input type="range" id="th-bg" min="4" max="16" step="1" value="'+t.bgL+'" style="width:100%;margin-bottom:12px">'+
      '<label style="display:block;font-size:12px;margin-bottom:4px;opacity:.7">Плашки и карточки</label>'+
      '<input type="range" id="th-card" min="8" max="22" step="1" value="'+t.cardL+'" style="width:100%;margin-bottom:12px">'+
      '<label style="display:block;font-size:12px;margin-bottom:4px;opacity:.7">Акцент (цвет кнопок и ссылок)</label>'+
      '<input type="range" id="th-hue" min="0" max="360" step="5" value="'+t.hue+'" style="width:100%;margin-bottom:6px;background:linear-gradient(90deg,hsl(0,28%,55%),hsl(60,28%,55%),hsl(120,28%,55%),hsl(180,28%,55%),hsl(240,28%,55%),hsl(300,28%,55%),hsl(360,28%,55%));height:10px;border-radius:6px;-webkit-appearance:none;appearance:none">'+
      '<div style="font-size:11px;opacity:.55;margin-bottom:8px">Изменения применяются сразу и сохраняются сами.</div>';
  }
  function wireEditor(root){
    var g=function(id){return root.querySelector('#'+id);};
    function fromSliders(){ var t=current(); t.bgL=+g('th-bg').value; t.cardL=+g('th-card').value; t.hue=+g('th-hue').value; t.hs=28; t.hl=58; save(t); }
    ['th-bg','th-card','th-hue'].forEach(function(id){ var el=g(id); if(el)el.oninput=fromSliders; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-preset]'),function(b){
      b.onclick=function(){ var t=Object.assign({},PRESETS[b.getAttribute('data-preset')]); save(t);
        if(g('th-bg'))g('th-bg').value=t.bgL; if(g('th-card'))g('th-card').value=t.cardL; if(g('th-hue'))g('th-hue').value=t.hue; };
    });
  }
  apply(load());
  return {apply:apply,editorHtml:editorHtml,wireEditor:wireEditor};
})();
