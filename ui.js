/* BORZO — общие UI-хелперы: тосты, модалки, формы */
(function(){
  function el(html){ var d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }

  var wrap;
  function toast(msg, type){
    if(!wrap){ wrap=el('<div class="toast-wrap"></div>'); document.body.appendChild(wrap); }
    var t=el('<div class="toast '+(type||'')+'">'+msg+'</div>');
    wrap.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(function(){ t.remove(); },300); }, 2200);
  }

  /* modal({title, fields:[{k,label,type,value,options}], submit:'Текст', onSubmit(values)}) */
  function modal(opts){
    var bg=el('<div class="modal-bg"></div>');
    var m=el('<div class="modal"></div>');
    var h='<h3>'+opts.title+'</h3>';
    (opts.fields||[]).forEach(function(f){
      h+='<div class="field"><label>'+f.label+'</label>';
      if(f.type==='select'){
        h+='<select data-k="'+f.k+'">'+(f.options||[]).map(function(o){return '<option value="'+o.value+'"'+(o.value===f.value?' selected':'')+'>'+o.label+'</option>';}).join('')+'</select>';
      } else {
        h+='<input data-k="'+f.k+'" type="'+(f.type||'text')+'" value="'+(f.value!=null?String(f.value).replace(/"/g,'&quot;'):'')+'" placeholder="'+(f.placeholder||'')+'">';
      }
      h+='</div>';
    });
    h+='<div class="modal-actions"><button class="btn" data-x>Отмена</button><button class="btn primary" data-ok>'+(opts.submit||'Сохранить')+'</button></div>';
    m.innerHTML=h; bg.appendChild(m); document.body.appendChild(bg);
    function close(){ bg.remove(); }
    bg.addEventListener('click',function(e){ if(e.target===bg) close(); });
    m.querySelector('[data-x]').addEventListener('click',close);
    m.querySelector('[data-ok]').addEventListener('click',function(){
      var vals={}; m.querySelectorAll('[data-k]').forEach(function(i){ vals[i.getAttribute('data-k')]=i.value.trim(); });
      if(opts.onSubmit && opts.onSubmit(vals)===false) return;
      close();
    });
    var first=m.querySelector('[data-k]'); if(first) first.focus();
    return {close:close};
  }

  function confirm(msg, onYes){
    var bg=el('<div class="modal-bg"></div>');
    bg.innerHTML='<div class="modal" style="max-width:380px"><h3 style="margin-bottom:10px">Подтверждение</h3><div style="color:var(--ink2);margin-bottom:6px">'+msg+'</div><div class="modal-actions"><button class="btn" data-x>Отмена</button><button class="btn primary" data-ok style="background:var(--red);border-color:var(--red)">Удалить</button></div></div>';
    document.body.appendChild(bg);
    function close(){ bg.remove(); }
    bg.addEventListener('click',function(e){ if(e.target===bg) close(); });
    bg.querySelector('[data-x]').addEventListener('click',close);
    bg.querySelector('[data-ok]').addEventListener('click',function(){ close(); onYes&&onYes(); });
  }

  /* info({title, html}) — простое окно с инструкцией (двуязычной), только кнопка «Понятно» */
  function info(opts){
    var bg=el('<div class="modal-bg"></div>');
    var m=el('<div class="modal" style="max-width:480px;max-height:82vh;overflow:auto"></div>');
    m.innerHTML='<h3 style="margin-bottom:10px">'+(opts.title||'Инструкция')+'</h3>'+
      '<div style="color:var(--ink2);font-size:13px;line-height:1.55">'+(opts.html||'')+'</div>'+
      '<div class="modal-actions" style="margin-top:14px"><button class="btn primary" data-ok>Понятно</button></div>';
    bg.appendChild(m); document.body.appendChild(bg);
    function close(){ bg.remove(); }
    bg.addEventListener('click',function(e){ if(e.target===bg) close(); });
    m.querySelector('[data-ok]').addEventListener('click',close);
    return {close:close};
  }

  window.UI = {toast:toast, modal:modal, confirm:confirm, info:info, money:function(n){ return (n||0).toLocaleString('ru-RU')+' ₸'; }};
})();
