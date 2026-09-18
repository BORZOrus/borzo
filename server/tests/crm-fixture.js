// Synthetic data only. Telephone range is reserved for these isolated tests, never contact it.
module.exports=function fixture(){
  const stages=['Новая заявка','В работе','Подбор решения','Договорились/Предоплата','Выполнено','Отказ'].map((name,i)=>({id:'status-'+i,name}));
  const products=Array.from({length:34},(_,i)=>({id:'product-'+i,name:'Тестовое изделие '+i,price:1000+i*10}));
  const clients=Array.from({length:423},(_,i)=>({id:'client-'+i,name:'Синтетический клиент '+i,contacts:[{type:'phone',value:'+7700'+String(i).padStart(7,'0')}],created_at:'2026-08-01T10:00:00+05:00'}));
  const deals=clients.map((c,i)=>({id:'deal-'+i,clientId:c.id,clientName:c.name,statusId:stages[i%6].id,
    title:'Тестовая заявка '+i,amount:10000+i,source:['Instagram','Сайт','Тест'][i%3],
    items:[{productId:products[i%34].id,qty:1,price:products[i%34].price}],ship_date:'2026-09-30',
    created_at:'2026-09-01T10:00:00+05:00',closed_at:i%6>=4?'2026-09-10T12:00:00+05:00':null}));
  return {stages,products,clients,deals};
};
