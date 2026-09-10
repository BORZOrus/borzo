/* BORZO — клиент API кассы. Токен в localStorage, все запросы с Bearer. */
window.API = (function(){
  var token = localStorage.getItem('borzo_token');
  function logout(){ localStorage.removeItem('borzo_token'); localStorage.removeItem('borzo_user'); location.replace('login.html'); }
  function req(method, path, body){
    return fetch('/api'+path, {
      method: method,
      headers: Object.assign({'Content-Type':'application/json'}, token?{'Authorization':'Bearer '+token}:{}),
      body: body?JSON.stringify(body):undefined
    }).then(function(r){
      if(r.status===401){ logout(); throw new Error('401'); }
      return r.json().then(function(d){ if(!r.ok) throw new Error(d.error||'Ошибка'); return d; });
    });
  }
  return {
    token: token,
    user: JSON.parse(localStorage.getItem('borzo_user')||'null'),
    me:          function(){ return req('GET','/me'); },
    kassa:       function(){ return req('GET','/kassa'); },
    sklad:       function(){ return req('GET','/sklad'); },
    issue:       function(b){ return req('POST','/kassa/issue', b); },
    accept:      function(id){ return req('POST','/kassa/accept/'+id); },
    expense:     function(b){ return req('POST','/kassa/expense', b); },
    issueEdit:   function(id,b){ return req('POST','/kassa/issue/'+id+'/edit', b); },
    issueCancel: function(id){ return req('POST','/kassa/issue/'+id+'/cancel'); },
    propose:     function(id,b){ return req('POST','/kassa/'+id+'/propose', b); },
    approve:     function(id){ return req('POST','/kassa/'+id+'/approve'); },
    reject:      function(id){ return req('POST','/kassa/'+id+'/reject'); },
    logout: logout
  };
})();
