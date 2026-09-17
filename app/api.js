/* BORZO — клиент API кассы. Токен в localStorage, все запросы с Bearer. */
window.API = (function(){
  var token = localStorage.getItem('borzo_token');
  function clearAuth(){ localStorage.removeItem('borzo_token'); localStorage.removeItem('borzo_user'); }
  function logout(){ clearAuth(); location.replace('login.html'); }
  // токен протух → на вход, но с памятью, куда возвращаться
  function expired(){ clearAuth(); var here=location.pathname.replace(/^\//,'')||'index.html'; location.replace('login.html?next='+encodeURIComponent(here)); }
  function req(method, path, body){
    return fetch('/api'+path, {
      method: method,
      headers: Object.assign({'Content-Type':'application/json'}, token?{'Authorization':'Bearer '+token}:{}),
      body: body?JSON.stringify(body):undefined
    }).then(function(r){
      if(r.status===401){ expired(); throw new Error('401'); }
      return r.json().then(function(d){ if(!r.ok){ var er=new Error(d.error||'Ошибка'); er.status=r.status; er.body=d; throw er; } return d; });
    });
  }
  var self;
  self = {
    token: token,
    user: JSON.parse(localStorage.getItem('borzo_user')||'null'),
    setToken: function(t){ token=t; self.token=t; localStorage.setItem('borzo_token',t); },
    config:      function(){ return req('GET','/config'); },
    demoToken:   function(role){ return req('POST','/demo/token',{role:role}); },
    scan:        function(image){ return req('POST','/scan',{image:image}); },
    me:          function(){ return req('GET','/me'); },
    password:    function(b){ return req('POST','/auth/password', b); },
    kassa:       function(){ return req('GET','/kassa'); },
    sklad:       function(){ return req('GET','/sklad'); },
    issue:       function(b){ return req('POST','/kassa/issue', b); },
    accept:      function(id){ return req('POST','/kassa/accept/'+id); },
    expense:     function(b){ return req('POST','/kassa/expense', b); },
    issueEdit:   function(id,b){ return req('POST','/kassa/issue/'+id+'/edit', b); },
    expenseDelete: function(id){ return req('POST','/kassa/expense/'+id+'/delete'); },
    expenseEdit:   function(id,b){ return req('POST','/kassa/expense/'+id+'/edit', b); },
    issueCancel: function(id){ return req('POST','/kassa/issue/'+id+'/cancel'); },
    propose:     function(id,b){ return req('POST','/kassa/'+id+'/propose', b); },
    unpropose:   function(id){ return req('POST','/kassa/'+id+'/unpropose'); },
    pushKey:       function(){ return req('GET','/push/pubkey'); },
    pushSubscribe: function(sub){ return req('POST','/push/subscribe',{sub:sub}); },
    approve:     function(id){ return req('POST','/kassa/'+id+'/approve'); },
    reject:      function(id){ return req('POST','/kassa/'+id+'/reject'); },
    finGet:      function(){ return req('GET','/fin'); },
    finPut:      function(data,baseRev){ return req('PUT','/fin',{data:data,baseRev:baseRev}); },
    logout: logout
  };
  return self;
})();
