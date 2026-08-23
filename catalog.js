/* Каталог — живая логика: товары, поиск, карточка, добавление */
(function(){
  var BADGE={green:'b-green',violet:'b-violet',amber:'b-amber',red:'b-red',gray:'b-gray'};
  var q='', sel='p4';
  function money(n){ return (n||0).toLocaleString('ru-RU')+' ₸'; }
  function margin(p){ return p.price? Math.round((p.price-p.cost)/p.price*100)+'%' : '—'; }
  function match(p){ if(!q) return true; return (p.name+' '+p.sku+' '+p.category).toLowerCase().indexOf(q)>=0; }

  function render(){
    var items=DB.all('products').filter(match);
    var tb=document.getElementById('catalist');
    tb.innerHTML = items.map(function(p){
      return '<tr data-id="'+p.id+'" style="cursor:pointer'+(p.id===sel?';background:var(--blue-soft)':'')+'">'+
        '<td style="color:var(--blue);font-weight:600">▭ '+p.name+'</td><td>'+p.category+'</td><td>'+p.size+'</td>'+
        '<td class="muted">'+p.colors+'</td><td style="font-weight:600">'+money(p.price)+'</td><td>'+money(p.cost)+'</td><td>'+margin(p)+'</td>'+
        '<td><span class="badge '+(BADGE[p.statusType]||'b-green')+'">'+p.status+'</span></td><td class="muted">'+p.updated+'</td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function(r){ r.addEventListener('click',function(){ select(r.getAttribute('data-id')); }); });
    var c=document.querySelector('.between .muted'); if(c) c.textContent='Показано 1–'+items.length+' из '+DB.all('products').length+' товаров';
  }

  function select(id){
    sel=id; var p=DB.find('products',id); if(!p) return;
    set('pc-name',p.name); set('pc-sku',p.sku); set('pc-cat',p.category); set('pc-size',p.size);
    set('pc-price',money(p.price)); set('pc-cost',money(p.cost)); set('pc-margin',margin(p));
    var st=document.getElementById('pc-status'); if(st){ st.textContent=p.status; st.className='badge '+(BADGE[p.statusType]||'b-green'); }
    render();
  }
  function set(id,v){ var e=document.getElementById(id); if(e)e.textContent=v; }

  document.getElementById('cat-add').addEventListener('click',function(){
    UI.modal({title:'Новый товар', submit:'Создать',
      fields:[
        {k:'name',label:'Название модели',placeholder:'напр. GEOMETRY 4,5 м'},
        {k:'category',label:'Категория',type:'select',value:'Стол-трансформер',options:['Стол-трансформер','Консоль','Буфет','Тумба','Прочее'].map(function(s){return {value:s,label:s};})},
        {k:'size',label:'Размер',value:'350 см'},
        {k:'colors',label:'Цвета',value:'Белый, Кремовый мрамор'},
        {k:'price',label:'Цена, ₸',type:'number',value:'300000'},
        {k:'cost',label:'Себестоимость, ₸',type:'number',value:'180000'}
      ],
      onSubmit:function(v){
        if(!v.name){ UI.toast('Введите название','err'); return false; }
        var sku='BKZ-'+(v.name.replace(/[^A-ZА-Я0-9]/gi,'').slice(0,3).toUpperCase())+'-'+Math.floor(Math.random()*90+10);
        DB.add('products',{name:v.name,sku:sku,category:v.category,size:v.size,colors:v.colors,price:parseInt(v.price)||0,cost:parseInt(v.cost)||0,status:'Активен',statusType:'green',updated:'только что'});
        UI.toast('Товар добавлен','ok'); render();
      }});
  });

  var s=document.getElementById('cat-search');
  s.addEventListener('input',function(){ q=s.value.trim().toLowerCase(); render(); });
  render();
})();
