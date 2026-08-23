/* BORZO — локальный слой данных (localStorage). Позже бэкенд/API подменяется без переделки UI. */
(function(){
  var KEY = 'borzo_db_v1';

  var SEED = {
    // CRM
    dealStages: [
      {id:'new',    name:'Новые заявки',        color:'blue'},
      {id:'qual',   name:'Квалификация',        color:'amber'},
      {id:'measure',name:'Замер / консультация', color:'violet'},
      {id:'invoice',name:'Счёт / договор',       color:'gray'},
      {id:'pay',    name:'Оплата / запуск',      color:'green'}
    ],
    deals: [
      {id:'d1', title:'ЖК Capital Park — Айдос', spec:'LUX 3,0 м · Алматы', price:250000, stage:'new', source:'Instagram', manager:'У', flag:'без ответа 2 ч', flagType:'amber'},
      {id:'d2', title:'Мария, Астана', spec:'GEOMETRY 3,5 м', price:360000, stage:'new', source:'WhatsApp', manager:'А'},
      {id:'d3', title:'Бауыржан, Караганда', spec:'LUX 3,0 м', price:240000, stage:'new', source:'Сайт', manager:'Н'},
      {id:'d4', title:'ТОО Comfort House', spec:'GEOMETRY 3,5 м', price:360000, stage:'qual', source:'Instagram', manager:'А', flag:'нужен расчёт', flagType:'amber'},
      {id:'d5', title:'ИП Светлана', spec:'LUX 4,0 м', price:420000, stage:'qual', source:'Kaspi', manager:'У'},
      {id:'d6', title:'Design Studio Alma', spec:'GEOMETRY 3,0 м', price:310000, stage:'qual', source:'WhatsApp', manager:'А'},
      {id:'d7', title:'Жанара, Астана', spec:'GEOMETRY 3,5 м', price:380000, stage:'measure', source:'WhatsApp', manager:'У'},
      {id:'d8', title:'Кухни Home Space', spec:'LUX 4,0 м', price:460000, stage:'measure', source:'Instagram', manager:'А'},
      {id:'d9', title:'Арман, Алматы', spec:'GEOMETRY 3,0 м', price:320000, stage:'measure', source:'Сайт', manager:'А', flag:'без ответа 1 д', flagType:'amber'},
      {id:'d10', title:'VIP квартиры KZ', spec:'LUX 3,0 м', price:390000, stage:'invoice', source:'Kaspi', manager:'У'},
      {id:'d11', title:'Абзал, Алматы', spec:'GEOMETRY 3,5 м', price:370000, stage:'invoice', source:'WhatsApp', manager:'Н'},
      {id:'d12', title:'ТОО Green House', spec:'LUX 4,0 м', price:480000, stage:'invoice', source:'Дилеры', manager:'Н'},
      {id:'d13', title:'Айбек, Астана', spec:'LUX 3,0 м', price:270000, stage:'pay', source:'Kaspi', flag:'предоплата получена', flagType:'green'},
      {id:'d14', title:'Family House', spec:'GEOMETRY 3,5 м', price:350000, stage:'pay', source:'WhatsApp', flag:'предоплата получена', flagType:'green'},
      {id:'d15', title:'Арсен, Шымкент', spec:'LUX 3,0 м', price:250000, stage:'pay', source:'Instagram', manager:'Н', flag:'предоплата получена', flagType:'green'}
    ],
    managers: [
      {id:'m1', name:'Ульяна', active:21, resp:'4 мин', conv:'9,4%', sales:'6,8 млн', load:78},
      {id:'m2', name:'Арина', active:18, resp:'7 мин', conv:'7,1%', sales:'5,2 млн', load:65},
      {id:'m3', name:'Нурбек', active:9, resp:'11 мин', conv:'5,8%', sales:'2,4 млн', load:54},
      {id:'m4', name:'✦ Агент BORZO', active:'—', resp:'0 мин', conv:'—', sales:'3,1 млн', load:100}
    ],

    // Производство
    prodStages: [
      {id:'metal',    name:'Металлоцех'},
      {id:'vacuum',   name:'Вакуум / МДФ'},
      {id:'paint',    name:'Малярка'},
      {id:'assembly', name:'Сборка'},
      {id:'ready',    name:'Готово к отгрузке'}
    ],
    orders: [
      {id:'o1260', no:'1260', model:'GEOMETRY 3,0 м', city:'Астана', due:'срок 31 мая', priority:'Средний', priType:'green', stage:'metal'},
      {id:'o1261', no:'1261', model:'LUX 2,5 м', city:'Шымкент', due:'срок 1 июня', priority:'Низкий', priType:'blue', stage:'metal'},
      {id:'o1262', no:'1262', model:'GEOMETRY 3,5 м', city:'Атырау', due:'срок 2 июня', priority:'Высокий', priType:'amber', stage:'metal'},
      {id:'o1263', no:'1263', model:'LUX 4,0 м', city:'Алматы', due:'срок 2 июня', priority:'Средний', priType:'green', stage:'metal'},
      {id:'o1257', no:'1257', model:'LUX 4,0 м', city:'Караганда', due:'срок 30 мая', priority:'Высокий', priType:'amber', stage:'vacuum'},
      {id:'o1259', no:'1259', model:'GEOMETRY 3,2 м', city:'Павлодар', due:'срок 31 мая', priority:'Средний', priType:'green', stage:'vacuum'},
      {id:'o1264', no:'1264', model:'LUX 2,0 м', city:'Тараз', due:'срок 1 июня', priority:'Низкий', priType:'blue', stage:'vacuum'},
      {id:'o1256', no:'1256', model:'GEOMETRY 3,5 м', city:'Алматы', due:'срок 29 мая', priority:'Высокий', priType:'amber', stage:'paint'},
      {id:'o1265', no:'1265', model:'LUX 3,0 м', city:'Астана', due:'срок 30 мая', priority:'Средний', priType:'green', stage:'paint'},
      {id:'o1266', no:'1266', model:'GEOMETRY 2,8 м', city:'Усть-Каменогорск', due:'срок 31 мая', priority:'Низкий', priType:'blue', stage:'paint'},
      {id:'o1258', no:'1258', model:'GEOMETRY 3,5 м', city:'Астана', due:'срок 31 мая', priority:'Средний', priType:'green', stage:'assembly'},
      {id:'o1267', no:'1267', model:'LUX 2,5 м', city:'Алматы', due:'срок 1 июня', priority:'Высокий', priType:'amber', stage:'assembly'},
      {id:'o1255', no:'1255', model:'GEOMETRY 2,5', city:'Шымкент', due:'срок 28 мая', priority:'Средний', priType:'green', stage:'ready'},
      {id:'o1254', no:'1254', model:'LUX 3,5 м', city:'Караганда', due:'срок 29 мая', priority:'Средний', priType:'green', stage:'ready'}
    ],

    // Каталог
    products: [
      {id:'p1', name:'LUX 3,5 м', sku:'BKZ-LUX-35', category:'Стол-трансформер', size:'350 см', colors:'Белый, Кремовый мрамор', price:319000, cost:197000, status:'Активен', statusType:'green', updated:'сегодня'},
      {id:'p2', name:'LUX 2,5 м', sku:'BKZ-LUX-25', category:'Стол-трансформер', size:'250 см', colors:'Белый, Кремовый мрамор', price:236000, cost:144000, status:'Активен', statusType:'green', updated:'вчера'},
      {id:'p3', name:'LUX 4,0 м', sku:'BKZ-LUX-40', category:'Стол-трансформер', size:'400 см', colors:'Белый, Кремовый мрамор', price:344000, cost:209000, status:'Активен', statusType:'green', updated:'2 дня назад'},
      {id:'p4', name:'GEOMETRY 3,5 м', sku:'BKZ-GEO-35', category:'Стол-трансформер', size:'350 см', colors:'Белый, Кремовый мрамор', price:256000, cost:160000, status:'Хит', statusType:'violet', updated:'сегодня'},
      {id:'p5', name:'GEOMETRY 2,5 м', sku:'BKZ-GEO-25', category:'Стол-трансформер', size:'250 см', colors:'Белый, Кремовый мрамор', price:206000, cost:123000, status:'Активен', statusType:'green', updated:'вчера'},
      {id:'p6', name:'Каскад LUX', sku:'BKZ-KAS-01', category:'Консоль', size:'120×45 см', colors:'Белый, Кремовый', price:109000, cost:58000, status:'Активен', statusType:'green', updated:'3 дня назад'}
    ],

    // Клиенты и сервис
    clients: [
      {id:'c1', name:'ТОО Comfort House', city:'Алматы', last:'12 мая 2025', product:'GEOMETRY 3,5 м', segment:'B2B', status:'Активный', statusType:'green', ltv:720000, contact:'2 дня назад'},
      {id:'c2', name:'Жанара', city:'Астана', last:'3 мая 2025', product:'LUX 3,0 м', segment:'Розница', status:'Ожидает отзыв', statusType:'amber', ltv:380000, contact:'вчера'},
      {id:'c3', name:'ИП Светлана', city:'Караганда', last:'25 апреля 2025', product:'LUX 4,0 м', segment:'Дилер', status:'VIP', statusType:'violet', ltv:1240000, contact:'5 дней назад'},
      {id:'c4', name:'Family House', city:'Шымкент', last:'18 мая 2025', product:'GEOMETRY 3,5 м', segment:'Розница', status:'Доставка завершена', statusType:'gray', ltv:350000, contact:'сегодня'},
      {id:'c5', name:'Асем', city:'Алматы', last:'8 мая 2025', product:'GEOMETRY 3,0 м', segment:'Розница', status:'Ожидает отзыв', statusType:'amber', ltv:290000, contact:'3 дня назад'},
      {id:'c6', name:'Дизайн Люкс', city:'Астана', last:'28 апреля 2025', product:'Консоль LUX', segment:'Дизайнер', status:'Активный', statusType:'green', ltv:460000, contact:'неделю назад'},
      {id:'c7', name:'Mega Home', city:'Актобе', last:'5 мая 2025', product:'LUX 3,5 м', segment:'B2B', status:'Гарантийный кейс', statusType:'red', ltv:540000, contact:'2 дня назад'}
    ],
    serviceRequests: [
      {id:'sr1', no:'SR-1042', client:'Жанара', type:'Регулировка механизма', product:'LUX 3,0 м', priority:'Средний', priColor:'amber', resp:'Нурбек', sla:'Сегодня 18:00', status:'В работе', statusType:'blue'},
      {id:'sr2', no:'SR-1043', client:'Family House', type:'Царапина на столешнице', product:'GEOMETRY 3,5 м', priority:'Высокий', priColor:'red', resp:'Ермек', sla:'Просрочено', status:'Требует выезда', statusType:'amber'},
      {id:'sr3', no:'SR-1044', client:'ИП Светлана', type:'Замена замка', product:'LUX 4,0 м', priority:'Высокий', priColor:'red', resp:'Нурбек', sla:'Завтра', status:'Ожидает деталь', statusType:'amber'},
      {id:'sr4', no:'SR-1045', client:'Асем', type:'Запрос инструкции', product:'GEOMETRY 3,0 м', priority:'Низкий', priColor:'gray', resp:'✦ AI-агент', sla:'Сегодня', status:'Закрыто', statusType:'green'},
      {id:'sr5', no:'SR-1046', client:'Дизайн Люкс', type:'Консультация по уходу', product:'Консоль LUX', priority:'Низкий', priColor:'gray', resp:'✦ AI-агент', sla:'Сегодня', status:'Закрыто', statusType:'green'}
    ],

    // Склады
    warehouses: [
      {id:'w1', name:'Сборщик',       positions:46, fill:78, fillColor:'green', value:'3,2 млн ₸', status:'Норма',      statusType:'green'},
      {id:'w2', name:'Сварочный цех',  positions:38, fill:64, fillColor:'blue',  value:'2,7 млн ₸', status:'Норма',      statusType:'green'},
      {id:'w3', name:'Малярка',        positions:27, fill:52, fillColor:'amber', value:'1,9 млн ₸', status:'Риск',       statusType:'amber'},
      {id:'w4', name:'Основной склад',  positions:91, fill:83, fillColor:'green', value:'8,1 млн ₸', status:'Норма',      statusType:'green'},
      {id:'w5', name:'Упаковка',        positions:46, fill:88, fillColor:'red',   value:'2,7 млн ₸', status:'Перегрузка', statusType:'red'}
    ],
    materials: [
      {id:'mat1', name:'Замки трансформера', sku:'LOCK-TR-01', category:'Фурнитура', unit:'шт', stock:420, min:600, supplier:'China Locks Co.', location:'Основной склад / A-12', statusText:'Ниже точки дозаказа', statusType:'red', badge:'Ниже точки', badgeType:'red', lastIn:'21 мая 2025', usePerMonth:'180 шт', exhausted:70,
        movement:[
          {date:'22 мая', type:'расход',      typeColor:'red',   note:'40 шт · Производство'},
          {date:'21 мая', type:'приход',      typeColor:'green', note:'200 шт · Поставка №458'},
          {date:'19 мая', type:'перемещение', typeColor:'blue',  note:'60 шт · Сборщик'},
          {date:'18 мая', type:'расход',      typeColor:'red',   note:'25 шт · Производство'}
        ]},
      {id:'mat2', name:'Петли усиленные', sku:'HNG-02', category:'Фурнитура', unit:'шт', stock:56, min:120, supplier:'Metaldetal KZ', location:'Основной склад / A-14', statusText:'Риск дефицита', statusType:'amber', badge:'Риск', badgeType:'amber', lastIn:'18 мая 2025', usePerMonth:'90 шт', exhausted:54,
        movement:[{date:'20 мая', type:'расход', typeColor:'red', note:'30 шт · Сборка'},{date:'12 мая', type:'приход', typeColor:'green', note:'100 шт · Поставка №451'}]},
      {id:'mat3', name:'Порошковая краска, белая', sku:'PNT-WHT-01', category:'ЛКМ', unit:'кг', stock:18, min:40, supplier:'ChimPro', location:'Малярка / C-02', statusText:'Риск дефицита', statusType:'amber', badge:'Риск', badgeType:'amber', lastIn:'15 мая 2025', usePerMonth:'35 кг', exhausted:55,
        movement:[{date:'21 мая', type:'расход', typeColor:'red', note:'6 кг · Малярка'},{date:'15 мая', type:'приход', typeColor:'green', note:'50 кг · Поставка №454'}]},
      {id:'mat4', name:'Упаковочный уголок', sku:'PCK-COR-01', category:'Упаковка', unit:'шт', stock:110, min:300, supplier:'PackLine', location:'Упаковка / D-08', statusText:'Ниже нормы', statusType:'red', badge:'Ниже нормы', badgeType:'red', lastIn:'19 мая 2025', usePerMonth:'260 шт', exhausted:63,
        movement:[{date:'22 мая', type:'расход', typeColor:'red', note:'45 шт · Упаковка'},{date:'19 мая', type:'приход', typeColor:'green', note:'150 шт · Поставка №457'}]},
      {id:'mat5', name:'LED-подсветка', sku:'LED-01', category:'Электрика', unit:'компл', stock:14, min:30, supplier:'LightTech', location:'Основной склад / A-20', statusText:'Риск дефицита', statusType:'amber', badge:'Риск', badgeType:'amber', lastIn:'10 мая 2025', usePerMonth:'22 компл', exhausted:53,
        movement:[{date:'18 мая', type:'расход', typeColor:'red', note:'8 компл · Сборка'},{date:'10 мая', type:'приход', typeColor:'green', note:'30 компл · Поставка №449'}]},
      {id:'mat6', name:'Профильная труба 40×40', sku:'MET-PP-40', category:'Металл', unit:'м', stock:1240, min:400, supplier:'МеталлТорг', location:'Сварочный цех / B-04', statusText:'Норма', statusType:'green', badge:'Норма', badgeType:'green', lastIn:'20 мая 2025', usePerMonth:'620 м', exhausted:24,
        movement:[{date:'20 мая', type:'приход', typeColor:'green', note:'800 м · Поставка №459'},{date:'17 мая', type:'расход', typeColor:'red', note:'140 м · Металлоцех'}]},
      {id:'mat7', name:'МДФ плита 18 мм', sku:'MDF-18', category:'Материалы', unit:'лист', stock:320, min:100, supplier:'Kastamonu', location:'Основной склад / B-06', statusText:'Норма', statusType:'green', badge:'Норма', badgeType:'green', lastIn:'19 мая 2025', usePerMonth:'150 листов', exhausted:31,
        movement:[{date:'19 мая', type:'приход', typeColor:'green', note:'200 листов · Поставка №456'},{date:'16 мая', type:'расход', typeColor:'red', note:'48 листов · Вакуум/МДФ'}]}
    ],
    cells: [
      {id:'ce1', code:'A-12', kind:'Фурнитура', fill:76, color:'green'},
      {id:'ce2', code:'B-04', kind:'Металл',    fill:61, color:'blue'},
      {id:'ce3', code:'C-02', kind:'Краска',    fill:48, color:'amber'},
      {id:'ce4', code:'D-08', kind:'Упаковка',  fill:93, color:'red'},
      {id:'ce5', code:'E-01', kind:'Резерв',    fill:35, color:'gray'}
    ],

    // Снабжение
    suppliers: [
      {id:'s1', name:'China Locks Co.', category:'Фурнитура', reliab:92, term:'14 дн', status:'Активен', statusType:'green'},
      {id:'s2', name:'Steel KZ',        category:'Металл',    reliab:95, term:'7 дн',  status:'Активен', statusType:'green'},
      {id:'s3', name:'ColorMix',        category:'Краска',    reliab:81, term:'10 дн', status:'Риск',    statusType:'amber'},
      {id:'s4', name:'PackLine',        category:'Упаковка',  reliab:89, term:'6 дн',  status:'Активен', statusType:'green'}
    ],
    replenishment: [
      {id:'r1', name:'Замки трансформера',       stock:'420 шт',   min:'600 шт',    use:'180 шт',   order:'400 шт',   priority:'Высокий', priColor:'red',   resp:'Айдар'},
      {id:'r2', name:'Порошковая краска, белая', stock:'18 кг',    min:'40 кг',     use:'22 кг',    order:'30 кг',    priority:'Средний', priColor:'amber', resp:'Алина'},
      {id:'r3', name:'Металл листовой',          stock:'14 листов',min:'20 листов', use:'10 листов',order:'12 листов',priority:'Средний', priColor:'amber', resp:'Айдар'},
      {id:'r4', name:'Упаковочный уголок',       stock:'110 шт',   min:'250 шт',    use:'120 шт',   order:'300 шт',   priority:'Высокий', priColor:'red',   resp:'Нурбек'},
      {id:'r5', name:'LED-подсветка',            stock:'14 компл', min:'20 компл',  use:'8 компл',  order:'12 компл', priority:'Низкий',  priColor:'green', resp:'Алина'}
    ],
    purchases: [
      {id:'po2458', supplier:'China Locks Co.', po:'PO-2458', category:'Фурнитура', position:'Замки трансформера', qty:'400 шт', budget:'680 000 ₸', eta:'2 июня 2025', status:'На таможне', statusType:'amber', manager:'Айдар', terms:'Условия: 30% предоплата / 70% после отгрузки', budgetPct:68,
        steps:[{label:'Согласовано',state:'done'},{label:'Оплачено',state:'done'},{label:'Отгружено',state:'done'},{label:'На таможне',state:'act'},{label:'На складе',state:'wait'}],
        history:[
          {icon:'green',label:'Заказ создан',date:'21 мая'},
          {icon:'green',label:'Согласован с поставщиком',date:'22 мая'},
          {icon:'blue', label:'Предоплата отправлена',date:'23 мая'},
          {icon:'blue', label:'Отгружено',date:'26 мая'},
          {icon:'amber',label:'Прибыло на таможню',date:'28 мая'}
        ]},
      {id:'po2459', supplier:'Steel KZ', po:'PO-2459', category:'Металл', position:'Металл листовой', qty:'12 листов', budget:'420 000 ₸', eta:'30 мая 2025', status:'В пути', statusType:'blue', manager:'Айдар', terms:'Условия: 100% предоплата', budgetPct:40,
        steps:[{label:'Согласовано',state:'done'},{label:'Оплачено',state:'done'},{label:'Отгружено',state:'act'},{label:'В пути',state:'wait'},{label:'На складе',state:'wait'}],
        history:[{icon:'green',label:'Заказ создан',date:'24 мая'},{icon:'blue',label:'Оплачено',date:'25 мая'},{icon:'amber',label:'Готовится к отгрузке',date:'27 мая'}]},
      {id:'po2461', supplier:'ColorMix', po:'PO-2461', category:'Краска', position:'Порошковая краска, белая', qty:'30 кг', budget:'150 000 ₸', eta:'1 июня 2025', status:'Согласование', statusType:'amber', manager:'Алина', terms:'Условия: оплата по факту', budgetPct:15,
        steps:[{label:'Согласовано',state:'act'},{label:'Оплачено',state:'wait'},{label:'Отгружено',state:'wait'},{label:'В пути',state:'wait'},{label:'На складе',state:'wait'}],
        history:[{icon:'green',label:'Заявка сформирована',date:'26 мая'},{icon:'amber',label:'Ожидает счёт от поставщика',date:'27 мая'}]}
    ],

    // Отгрузки (позже — синхронизация с Trello по API-ключам)
    shipStages: ['Запланировано','Готовится','Готово к погрузке','В пути','Доставлено'],
    shipments: [
      {id:'sh1', time:'10:00', no:'1254', client:'ТОО Comfort House', city:'Алматы',   status:'В пути',            statusType:'blue',  resp:'Ермек',  product:'LUX 3,5 м',      color:'Белый / мрамор', date:'29 мая 2025', car:'Газель А-217', driver:'Ермек',  priority:'Высокий', priType:'red',   ready:90,
        stages:[{s:'Сборка завершена',done:true},{s:'Упаковано',done:true},{s:'Документы готовы',done:true},{s:'В пути',done:false,act:true}], docs:{'Накладная':true,'Счёт':true,'Маршрутный лист':true}},
      {id:'sh2', time:'12:30', no:'1255', client:'ИП Арман',         city:'Астана',   status:'Готовится',         statusType:'amber', resp:'Нурбек', product:'GEOMETRY 2,5',    color:'Белый / золото', date:'29 мая 2025', car:'—',            driver:'—',      priority:'Средний', priType:'amber', ready:45,
        stages:[{s:'Сборка завершена',done:true},{s:'Упаковано',done:false,act:true},{s:'Документы готовы',done:false},{s:'Погрузка',done:false}], docs:{'Накладная':true,'Счёт':false,'Маршрутный лист':false}},
      {id:'sh3', time:'14:00', no:'1256', client:'MebelPro',         city:'Шымкент',  status:'Готово к погрузке', statusType:'green', resp:'Айдар',  product:'GEOMETRY 3,5 м',  color:'Белый / золото', date:'29 мая 2025', car:'Газель А-217', driver:'Ермек',  priority:'Средний', priType:'amber', ready:74,
        stages:[{s:'Сборка завершена',done:true},{s:'Упаковано',done:true},{s:'Документы готовы',done:true},{s:'Ожидает погрузку',done:false,act:true}], docs:{'Накладная':true,'Счёт':true,'Маршрутный лист':true}},
      {id:'sh4', time:'16:30', no:'1257', client:'ИП Светлана',      city:'Караганда',status:'Запланировано',     statusType:'gray',  resp:'Ермек',  product:'LUX 4,0 м',       color:'Белый / мрамор', date:'30 мая 2025', car:'—',            driver:'—',      priority:'Средний', priType:'amber', ready:20,
        stages:[{s:'Сборка завершена',done:false,act:true},{s:'Упаковано',done:false},{s:'Документы готовы',done:false},{s:'Погрузка',done:false}], docs:{'Накладная':false,'Счёт':false,'Маршрутный лист':false}},
      {id:'sh5', time:'18:00', no:'1258', client:'LoftHouse',        city:'Актобе',   status:'Запланировано',     statusType:'gray',  resp:'Нурбек', product:'GEOMETRY 3,5 м',  color:'Белый / золото', date:'30 мая 2025', car:'—',            driver:'—',      priority:'Низкий',  priType:'green', ready:15,
        stages:[{s:'Сборка завершена',done:false,act:true},{s:'Упаковано',done:false},{s:'Документы готовы',done:false},{s:'Погрузка',done:false}], docs:{'Накладная':false,'Счёт':false,'Маршрутный лист':false}}
    ],
    routes: [
      {id:'rt1', city:'Алматы',    load:82, color:'blue'},
      {id:'rt2', city:'Астана',    load:68, color:'blue'},
      {id:'rt3', city:'Шымкент',   load:91, color:'blue'},
      {id:'rt4', city:'Караганда', load:57, color:'blue'}
    ],
    shipRisks: [
      {id:'rk1', name:'Документы',                  level:'Средний', levelType:'amber'},
      {id:'rk2', name:'Погрузка',                   level:'Высокий', levelType:'red'},
      {id:'rk3', name:'Пробки',                     level:'Средний', levelType:'amber'},
      {id:'rk4', name:'Клиент не подтвердил окно',  level:'Низкий',  levelType:'green'}
    ],

    // Финансы (позже — импорт Excel 🔴)
    payments: [
      {id:'pm1', date:'31.05.2025', type:'Поступление', party:'ООО «Арт Дизайн»',  purpose:'Оплата заказа №1247', amount:890000,   income:true,  status:'Проведён', statusType:'green'},
      {id:'pm2', date:'30.05.2025', type:'Выплата',     party:'Поставщик ЛДСП',      purpose:'Оплата материалов',   amount:-320000,  income:false, status:'Проведён', statusType:'green'},
      {id:'pm3', date:'30.05.2025', type:'Выплата',     party:'Заработная плата',    purpose:'Выплата зарплаты',    amount:-1150000, income:false, status:'Проведён', statusType:'green'},
      {id:'pm4', date:'29.05.2025', type:'Поступление', party:'ООО «Интерьер+»',     purpose:'Оплата заказа №1244', amount:560000,   income:true,  status:'Проведён', statusType:'green'},
      {id:'pm5', date:'28.05.2025', type:'Выплата',     party:'Аренда склада',       purpose:'Аренда за май',       amount:-180000,  income:false, status:'Проведён', statusType:'green'}
    ],
    receivables: [
      {id:'rc1', client:'ООО «Арт Дизайн»',  overdue:'0 дней',  overColor:'green', amount:890000,  due:'31.05.2025'},
      {id:'rc2', client:'ООО «Интерьер+»',   overdue:'5 дней',  overColor:'amber', amount:560000,  due:'25.05.2025'},
      {id:'rc3', client:'ИП Кузнецов',       overdue:'12 дней', overColor:'red',   amount:320000,  due:'18.05.2025'},
      {id:'rc4', client:'ООО «Строй Декор»', overdue:'18 дней', overColor:'red',   amount:750000,  due:'12.05.2025'},
      {id:'rc5', client:'ООО «Мебель Люкс»', overdue:'25 дней', overColor:'red',   amount:1250000, due:'05.05.2025'}
    ],

    // Документы
    documents: [
      {id:'doc1', name:'Договор поставки №125.pdf',        fico:'PDF', ficoColor:'#e5484d', type:'Договор',      party:'ООО «Арт Дизайн»',    date:'31.05.2025', status:'Подписан',  statusType:'green', size:'1.2 МБ', dir:'in'},
      {id:'doc2', name:'Спецификация стола LUX 3.5.xlsx',  fico:'XLS', ficoColor:'#1fa971', type:'Спецификация', party:'ООО «Интерьер+»',     date:'31.05.2025', status:'Утверждён', statusType:'green', size:'245 КБ', dir:'out'},
      {id:'doc3', name:'Коммерческое предложение.docx',    fico:'DOC', ficoColor:'#2f66f6', type:'КП',           party:'ИП Кузнецов',         date:'30.05.2025', status:'Отправлен', statusType:'blue',  size:'512 КБ', dir:'out'},
      {id:'doc4', name:'Счёт на оплату №458.pdf',          fico:'PDF', ficoColor:'#e5484d', type:'Счёт',         party:'ООО «Мебель Люкс»',   date:'30.05.2025', status:'Оплачен',   statusType:'green', size:'856 КБ', dir:'out'},
      {id:'doc5', name:'Транспортная накладная №789',      fico:'ТН',  ficoColor:'#8b5cf6', type:'ТН',           party:'ТК «Деловые Линии»',  date:'29.05.2025', status:'Доставлен', statusType:'green', size:'340 КБ', dir:'in'},
      {id:'doc6', name:'Акт выполненных работ.pdf',        fico:'PDF', ficoColor:'#e5484d', type:'Акт',          party:'ООО «Строй Декор»',   date:'29.05.2025', status:'На подписи',statusType:'amber', size:'1.1 МБ', dir:'out'},
      {id:'doc7', name:'Гарантийный талон.docx',           fico:'DOC', ficoColor:'#2f66f6', type:'Гарантия',     party:'ООО «Арт Дизайн»',    date:'28.05.2025', status:'Подписан',  statusType:'green', size:'220 КБ', dir:'out'},
      {id:'doc8', name:'План производства май.xlsx',       fico:'XLS', ficoColor:'#1fa971', type:'План',         party:'Внутренний',          date:'28.05.2025', status:'Утверждён', statusType:'green', size:'180 КБ', dir:'inner'},
      {id:'doc9', name:'Договор аренды склада.pdf',        fico:'PDF', ficoColor:'#e5484d', type:'Договор',      party:'ООО «СкладСервис»',   date:'27.05.2025', status:'Подписан',  statusType:'green', size:'980 КБ', dir:'in'},
      {id:'doc10',name:'Инструкция по сборке стола.pdf',   fico:'PDF', ficoColor:'#e5484d', type:'Инструкция',    party:'Внутренний',          date:'27.05.2025', status:'Актуален',  statusType:'blue',  size:'2.5 МБ', dir:'inner'}
    ],
    docControl: [
      {id:'dc1', mark:'✎', markColor:'violet', name:'Договор поставки №126',  party:'ООО «Интерьер+»',   note:'Требует подписи', noteColor:'red',   term:'2 дня'},
      {id:'dc2', mark:'◷', markColor:'amber',  name:'Счёт на оплату №462',    party:'ИП Кузнецов',       note:'Истекает срок',   noteColor:'amber', term:'3 дня'},
      {id:'dc3', mark:'!', markColor:'red',    name:'Акт выполненных работ',  party:'ООО «Строй Декор»', note:'Просрочен',       noteColor:'red',   term:'1 день'},
      {id:'dc4', mark:'✎', markColor:'violet', name:'Договор аренды склада',  party:'ООО «СкладСервис»', note:'Требует подписи', noteColor:'red',   term:'5 дней'}
    ],

    // Отчёты
    reports: [
      {id:'rep1', name:'Отчёт по продажам',        icon:'▤', iconColor:'#1fa971', type:'Продажи',      period:'Май 2025',   created:'31.05.2025 09:15', status:'Готов',      statusType:'green', file:'sales_may_2025.pdf',        size:'1.2 МБ'},
      {id:'rep2', name:'Финансовый отчёт',         icon:'₸', iconColor:'#8b5cf6', type:'Финансы',      period:'Май 2025',   created:'31.05.2025 08:30', status:'Готов',      statusType:'green', file:'finance_may_2025.xlsx',     size:'856 КБ'},
      {id:'rep3', name:'Остатки на складах',       icon:'▦', iconColor:'#f0a621', type:'Склад',        period:'31.05.2025', created:'31.05.2025 08:00', status:'Готов',      statusType:'green', file:'stock_2025-05-31.xlsx',     size:'645 КБ'},
      {id:'rep4', name:'Производственный отчёт',   icon:'▥', iconColor:'#2f66f6', type:'Производство',  period:'Май 2025',   created:'30.05.2025 18:45', status:'Готов',      statusType:'green', file:'production_may_2025.pdf',   size:'1.1 МБ'},
      {id:'rep5', name:'Отчёт по закупкам',        icon:'▤', iconColor:'#e5484d', type:'Снабжение',    period:'Май 2025',   created:'30.05.2025 17:20', status:'Готов',      statusType:'green', file:'procurement_may_2025.xlsx',size:'724 КБ'},
      {id:'rep6', name:'Анализ клиентов',          icon:'▤', iconColor:'#8b5cf6', type:'Клиенты',      period:'Май 2025',   created:'30.05.2025 16:10', status:'В процессе', statusType:'amber', file:'',                         size:''},
      {id:'rep7', name:'Отчёт по дебиторке',       icon:'▤', iconColor:'#2f66f6', type:'Финансы',      period:'31.05.2025', created:'30.05.2025 15:05', status:'Готов',      statusType:'green', file:'ar_may_2025.xlsx',          size:'532 КБ'},
      {id:'rep8', name:'Ошибки в заказах',         icon:'!', iconColor:'#e5484d', type:'Сервис',       period:'Май 2025',   created:'30.05.2025 14:30', status:'С ошибками', statusType:'red',   file:'errors_may_2025.xlsx',      size:'231 КБ'}
    ],
    reportTemplates: [
      {id:'rt1', name:'Отчёт по продажам',       desc:'Анализ продаж по товарам и менеджерам',        icon:'▤', tone:'green',  type:'Продажи'},
      {id:'rt2', name:'Финансовый отчёт',        desc:'Движение денежных средств и прибыль',          icon:'₸', tone:'violet', type:'Финансы'},
      {id:'rt3', name:'Отчёт по складам',        desc:'Остатки, движение и оценка запасов',           icon:'▦', tone:'amber',  type:'Склад'},
      {id:'rt4', name:'Производственный отчёт',  desc:'План/факт производства и загрузка мощностей',  icon:'▥', tone:'blue',   type:'Производство'},
      {id:'rt5', name:'Отчёт по закупкам',       desc:'Анализ закупок и поставщиков',                 icon:'▤', tone:'amber',  type:'Снабжение'}
    ],
    popularReports: [
      {id:'pr1', name:'Отчёт по продажам',  runs:28, downloads:28},
      {id:'pr2', name:'Остатки на складах', runs:24, downloads:24},
      {id:'pr3', name:'Финансовый отчёт',   runs:18, downloads:18},
      {id:'pr4', name:'Движение товаров',   runs:14, downloads:14},
      {id:'pr5', name:'Анализ клиентов',    runs:12, downloads:12}
    ],

    // Сотрудники
    staff: [
      {id:'e1', ini:'ИА', name:'Иванова Арина',      role:'Менеджер по продажам',  dept:'Отдел продаж',  salary:300000, status:'Активен',   statusType:'green'},
      {id:'e2', ini:'ПД', name:'Петров Дмитрий',     role:'Менеджер по продажам',  dept:'Отдел продаж',  salary:280000, status:'Активен',   statusType:'green'},
      {id:'e3', ini:'СЕ', name:'Смирнова Елена',     role:'Менеджер по продажам',  dept:'Отдел продаж',  salary:280000, status:'Активен',   statusType:'green'},
      {id:'e4', ini:'КМ', name:'Кузнецов Максим',    role:'Производитель работ',   dept:'Производство',  salary:350000, status:'Активен',   statusType:'green'},
      {id:'e5', ini:'АБ', name:'Байсалов Арман',     role:'Снабженец',             dept:'Снабжение',     salary:250000, status:'Активен',   statusType:'green'},
      {id:'e6', ini:'ВН', name:'Волков Николай',     role:'Кладовщик',             dept:'Склады',        salary:220000, status:'В отпуске', statusType:'blue'},
      {id:'e7', ini:'ДС', name:'Сергеев Денис',      role:'Сборщик мебели',        dept:'Производство',  salary:230000, status:'Активен',   statusType:'green'},
      {id:'e8', ini:'КМ', name:'Мухамедова Камила',  role:'Бухгалтер',             dept:'Бухгалтерия',   salary:280000, status:'Активен',   statusType:'green'}
    ],
    vacancies: [
      {id:'v1', role:'Менеджер по продажам', dept:'Отдел продаж', status:'Открыта', statusType:'amber'},
      {id:'v2', role:'Кладовщик',            dept:'Склады',       status:'Открыта', statusType:'amber'}
    ],
    birthdays: [
      {id:'b1', date:'12.05', name:'Иванова Арина',   role:'Менеджер по продажам'},
      {id:'b2', date:'18.05', name:'Кузнецов Максим',  role:'Производитель работ'},
      {id:'b3', date:'25.05', name:'Волков Николай',   role:'Кладовщик'}
    ],
    vacations: [
      {id:'vc1', period:'28.05 – 10.06', name:'Волков Николай',    days:'14 дней'},
      {id:'vc2', period:'05.06 – 18.06', name:'Сергеев Денис',     days:'14 дней'},
      {id:'vc3', period:'12.06 – 19.06', name:'Мухамедова Камила', days:'8 дней'}
    ],

    // Маркетинг
    mktChannels: [
      {id:'ch1', name:'Instagram',     leads:252, cpl:'1 620 ₸', conv:'4,4%', revenue:'9 850 000 ₸'},
      {id:'ch2', name:'TikTok',        leads:148, cpl:'1 890 ₸', conv:'5,1%', revenue:'6 210 000 ₸'},
      {id:'ch3', name:'Google Ads',    leads:86,  cpl:'2 310 ₸', conv:'4,7%', revenue:'3 980 000 ₸'},
      {id:'ch4', name:'Сайт (SEO)',    leads:61,  cpl:'1 280 ₸', conv:'5,6%', revenue:'2 950 000 ₸'},
      {id:'ch5', name:'Яндекс Директ', leads:37,  cpl:'2 520 ₸', conv:'4,2%', revenue:'1 690 000 ₸'},
      {id:'ch6', name:'WhatsApp',      leads:28,  cpl:'980 ₸',   conv:'6,3%', revenue:'1 160 000 ₸'}
    ],
    campaigns: [
      {id:'cmp1', name:'LUX 3.5 м — запуск',          channel:'Instagram',     budget:250000, spent:218450, leads:118, cpl:1851, status:'Активна',  statusType:'green'},
      {id:'cmp2', name:'GEOMETRY с подсветкой',       channel:'TikTok',        budget:200000, spent:176230, leads:92,  cpl:1915, status:'Активна',  statusType:'green'},
      {id:'cmp3', name:'Поиск — столы трансформеры',  channel:'Google Ads',    budget:180000, spent:158760, leads:63,  cpl:2521, status:'Активна',  statusType:'green'},
      {id:'cmp4', name:'Ретаргетинг — сайт',          channel:'Instagram',     budget:120000, spent:108340, leads:47,  cpl:2305, status:'Активна',  statusType:'green'},
      {id:'cmp5', name:'Бренд — BORZO Furniture',     channel:'Яндекс Директ', budget:100000, spent:92580,  leads:29,  cpl:3192, status:'На паузе', statusType:'amber'}
    ],
    mktActivities: [
      {id:'ma1', title:'Запуск рекламы модели GEOMETRY', kind:'Кампания',  due:'02.06.2025', resp:'Арина И.',  done:false},
      {id:'ma2', title:'Съёмка фото и видео контента',   kind:'Контент',   due:'03.06.2025', resp:'Максим К.', done:false},
      {id:'ma3', title:'Публикация кейса клиента',       kind:'Контент',   due:'05.06.2025', resp:'Елена С.',  done:false},
      {id:'ma4', title:'Анализ и оптимизация кампаний',  kind:'Аналитика', due:'06.06.2025', resp:'Дмитрий П.',done:false}
    ],

    // SMM
    smmPosts: [
      {id:'sp1', title:'Обеденный стол LUX 4 м',       channel:'Instagram', date:'31.05.2025', reach:'28 762', er:'11,8%', status:'Опубликовано', statusType:'green'},
      {id:'sp2', title:'Процесс покраски основания',   channel:'TikTok',    date:'30.05.2025', reach:'19 843', er:'10,2%', status:'Опубликовано', statusType:'green'},
      {id:'sp3', title:'Новая модель GEOMETRY',        channel:'Instagram', date:'29.05.2025', reach:'34 125', er:'13,6%', status:'Опубликовано', statusType:'green'},
      {id:'sp4', title:'Доставка в Астане',            channel:'Telegram',  date:'28.05.2025', reach:'12 534', er:'8,7%',  status:'Опубликовано', statusType:'green'},
      {id:'sp5', title:'Отзывы довольных клиентов',    channel:'Instagram', date:'27.05.2025', reach:'16 982', er:'12,1%', status:'Опубликовано', statusType:'green'}
    ],
    smmAds: [
      {id:'sa1', name:'Трафик на сайт',      channel:'Instagram', spent:'154 200 ₸', result:'1 285 кл.',    cpa:'120 ₸'},
      {id:'sa2', name:'Лиды на WhatsApp',    channel:'Instagram', spent:'133 800 ₸', result:'98 л.',        cpa:'1 365 ₸'},
      {id:'sa3', name:'Продвижение Reels',   channel:'TikTok',    spent:'88 750 ₸',  result:'224 356 охв.', cpa:'0,40 ₸'},
      {id:'sa4', name:'Ретаргетинг сайт',    channel:'Instagram', spent:'35 600 ₸',  result:'43 л.',        cpa:'828 ₸'}
    ],
    smmTasks: [
      {id:'st1', title:'Подготовить контент-план на июнь',           tag:'Контент', tagType:'violet', due:'01.06.2025', who:'А', done:false},
      {id:'st2', title:'Запустить рекламу новой модели GEOMETRY',    tag:'Реклама', tagType:'amber',  due:'02.06.2025', who:'Д', done:false},
      {id:'st3', title:'Снять видео-обзор производства',            tag:'Видео',   tagType:'blue',   due:'03.06.2025', who:'М', done:false},
      {id:'st4', title:'Подготовить сторис с отзывами',            tag:'Stories', tagType:'green',  due:'04.06.2025', who:'Е', done:false}
    ],

    // Интеграции — площадка под API-ключи (Руслан заполняет позже)
    integrations: [
      {id:'moysklad', name:'Мой Склад', desc:'Номенклатура, остатки, производство → перенос в BORZO', icon:'МС', color:'#1e88e5',
        fields:[{k:'token', label:'API-токен (API token)', type:'password'}], status:'off',
        guide:[
          {ru:'Войдите в кабинет МойСклад на online.moysklad.ru', en:'Log in to MoySklad at online.moysklad.ru'},
          {ru:'Откройте Настройки → Обмен данными → Доступ к API', en:'Open Settings (настройки) → Data exchange (обмен данными) → API access (доступ к API)'},
          {ru:'Создайте токен: нажмите «Новый токен»', en:'Create a token: click New token (новый токен)'},
          {ru:'Скопируйте токен и вставьте в поле выше', en:'Copy (скопировать) the token and paste (вставить) it in the field above'}
        ]},
      {id:'trello', name:'Trello', desc:'База отгрузок → перенос в раздел Отгрузки', icon:'Tr', color:'#0079bf',
        fields:[{k:'key', label:'API Key (ключ)', type:'password'},{k:'token', label:'Token (токен)', type:'password'}], status:'off',
        guide:[
          {ru:'Откройте trello.com/app-key и войдите в аккаунт', en:'Open (открыть) trello.com/app-key and log in (войти)'},
          {ru:'Скопируйте значение API Key (ключ) сверху страницы', en:'Copy the API Key (ключ доступа) at the top of the page'},
          {ru:'Рядом нажмите ссылку Token (токен) → на след. экране Allow (разрешить)', en:'Click the Token (токен) link → then Allow (разрешить) on the next screen'},
          {ru:'Вставьте API Key и Token в поля выше', en:'Paste (вставить) API Key and Token into the fields above'}
        ]},
      {id:'kaspi', name:'Kaspi', desc:'Заказы и рассрочка 0-0-12', icon:'Ka', color:'#f14635',
        fields:[{k:'token', label:'API-ключ (API key)', type:'password'}], status:'off',
        guide:[
          {ru:'Войдите в Kaspi Kabinet (кабинет продавца) на kaspi.kz', en:'Log in to Kaspi Kabinet (seller cabinet — кабинет продавца)'},
          {ru:'Откройте раздел Настройки → API', en:'Open Settings (настройки) → API'},
          {ru:'Сгенерируйте API-токен', en:'Generate (сгенерировать) an API token (токен)'},
          {ru:'Скопируйте и вставьте в поле выше', en:'Copy and paste (скопировать и вставить) it above'}
        ]},
      {id:'whatsapp', name:'WhatsApp Business', desc:'Переписка снабжения и продаж', icon:'Wa', color:'#25d366',
        fields:[{k:'phone_id', label:'Phone Number ID (ID номера)', type:'text'},{k:'token', label:'Access Token (токен доступа)', type:'password'}], status:'off',
        guide:[
          {ru:'Откройте developers.facebook.com и войдите', en:'Open Meta for Developers (developers.facebook.com) and log in'},
          {ru:'Создайте приложение типа Business (для бизнеса)', en:'Create (создать) an app of type Business (бизнес)'},
          {ru:'Добавьте продукт WhatsApp → откройте раздел API Setup (настройка API)', en:'Add (добавить) the WhatsApp product → open API Setup (настройка API)'},
          {ru:'Скопируйте Phone Number ID (ID номера телефона) и Access Token (токен доступа)', en:'Copy the Phone Number ID and the Access Token'},
          {ru:'Вставьте оба значения в поля выше', en:'Paste both values (оба значения) into the fields above'}
        ]},
      {id:'instagram', name:'Instagram / Meta', desc:'СММ: охваты, публикации, лиды', icon:'Ig', color:'#dd2a7b',
        fields:[{k:'token', label:'Access Token (токен доступа)', type:'password'}], status:'off',
        guide:[
          {ru:'Откройте developers.facebook.com и войдите', en:'Open (открыть) developers.facebook.com and log in (войти)'},
          {ru:'Свяжите Instagram-аккаунт с Facebook-страницей (Page)', en:'Link (связать) your Instagram account to a Facebook Page (страница)'},
          {ru:'В разделе Graph API получите Access Token (токен доступа)', en:'In the Graph API section get an Access Token (токен доступа)'},
          {ru:'Вставьте токен в поле выше', en:'Paste (вставить) the token above'}
        ]},
      {id:'openrouter', name:'OpenRouter (AI-агенты)', desc:'Мозги AI-агентов в разделах', icon:'AI', color:'#8b5cf6',
        fields:[{k:'key', label:'API-ключ (API key)', type:'password'}], status:'off',
        guide:[
          {ru:'Откройте openrouter.ai и войдите', en:'Open (открыть) openrouter.ai and log in (войти)'},
          {ru:'Перейдите в раздел Keys (ключи) — openrouter.ai/keys', en:'Go to the Keys (ключи) section — openrouter.ai/keys'},
          {ru:'Нажмите Create Key (создать ключ)', en:'Click Create Key (создать ключ)'},
          {ru:'Скопируйте ключ (начинается с sk-or-) и вставьте выше', en:'Copy the key (starts with sk-or-) and paste (вставить) it above'}
        ]}
    ]
  };

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function load(){ try{ var d=JSON.parse(localStorage.getItem(KEY)); if(!d||!d.deals) return clone(SEED);
      Object.keys(SEED).forEach(function(k){ if(d[k]===undefined) d[k]=clone(SEED[k]); }); return d;
    }catch(e){ return clone(SEED); } }

  var data = load();
  var subs = {};
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(data)); }catch(e){} }
  function emit(coll){ (subs[coll]||[]).forEach(function(fn){ try{fn();}catch(e){} }); }
  function uid(){ return 'id'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36); }

  window.DB = {
    all: function(coll){ return clone(data[coll]||[]); },
    raw: function(coll){ return data[coll]||[]; },
    find: function(coll,id){ return (data[coll]||[]).filter(function(x){return x.id===id;})[0]; },
    add: function(coll,item){ item.id=item.id||uid(); if(!data[coll])data[coll]=[]; data[coll].push(item); save(); emit(coll); return item; },
    update: function(coll,id,patch){ var it=this.find(coll,id); if(it){ for(var k in patch)it[k]=patch[k]; save(); emit(coll); } return it; },
    remove: function(coll,id){ data[coll]=(data[coll]||[]).filter(function(x){return x.id!==id;}); save(); emit(coll); },
    on: function(coll,fn){ (subs[coll]=subs[coll]||[]).push(fn); },
    saveIntegration: function(id,values){ var it=this.find('integrations',id); if(it){ it.values=values; it.status=Object.keys(values).some(function(k){return values[k];})?'on':'off'; save(); emit('integrations'); } },
    reset: function(){ data=clone(SEED); save(); Object.keys(subs).forEach(emit); }
  };
})();
