# CRM MVP — API и импорт

Дата: 2026-09-18. Все маршруты ниже начинаются с `/api/crm`, используют существующие Bearer auth + актуальные роли и token_ver. По умолчанию доступны mgr/fin. Каждая мутация требует непустой `reqId` длиной 8–100 символов `[A-Za-z0-9_-]`; при сетевом повторе отправляется ТО ЖЕ тело с тем же ключом.

| Метод / путь | Контракт |
|---|---|
| GET /meta | stages, managers, user_id |
| GET /clients?q= | Поиск по имени/телефону, clients с deals_count |
| POST /clients | name, phone; необязательные instagram/source/note; возвращает client, использует существующий по телефону |
| GET /clients/:id | client + deals |
| PATCH /clients/:id | baseRev, изменённые поля клиента |
| GET /deals | deals с клиентом, телефоном, этапом, менеджером |
| POST /deals | client_id либо client:{name,phone,source}; title, amount, stage_id, manager_id, note, items, ship_date необязательны |
| GET /deals/:id | deal + files |
| PATCH /deals/:id | baseRev и title/amount/manager_id/source/note/items/ship_date/lost_reason; closed_at разрешён закрытой сделке |
| POST /deals/:id/stage | baseRev, stage_id; items, ship_date, amount для завершения; lost_reason для отказа |
| GET /deals/:id/events | events, новые первыми |
| POST /deals/:id/events | kind=note/call/msg, text; status создаётся только сервером |
| POST /deals/:id/files | name, data (data URL JPEG/PNG/WebP/PDF ≤5 МБ) |
| GET /templates | templates |
| POST /templates | mgr: title, text |
| DELETE /templates/:id | mgr: reqId в JSON body |
| GET /analytics?from&to | YYYY-MM-DD, обе границы включены, UTC+05; stages/sources/leads/won/conversion/sales_count/sales_amount/missing |
| POST /import | mgr: data, stageMap, reqId |

При редактировании `baseRev` — число из последнего GET. 409 означает конфликт; открыть актуальную карточку и повторить намеренное изменение. Ошибки 400 сохраняют черновик формы. Если результат записи не получен, форма повторяет тот же payload/reqId, а не создаёт новый ключ.

## Формат MindSales

Минимум — `data.deals`. Остальные массивы необязательны. При отсутствии клиента в `clients` используются `clientName`, `contacts` из сделки. Без clientId генерируется устойчивый внешний ключ `deal:<externalDealId>`. Одному внешнему ID клиента соответствует одна запись. Отсутствующий телефон остаётся NULL; некорректный непустой телефон вызывает ошибку всего импорта.

```json
{
  "reqId": "example-import-request-0001",
  "stageMap": {"ms-new": 1, "ms-won": 5},
  "data": {
    "stages": [{"id":"ms-new","name":"Входящий"},{"id":"ms-won","name":"Продажа"}],
    "clients": [{"id":"example-client","name":"Синтетический клиент","contacts":[{"type":"phone","value":"+77000000001"}]}],
    "products": [{"id":"example-product","name":"Тестовый стол","price":1000}],
    "deals": [{"id":"example-deal","statusId":"ms-new","clientId":"example-client","clientName":"Синтетический клиент","amount":1000,"source":"Тест","items":[{"productId":"example-product","qty":1}],"created_at":"2026-09-01T12:00:00+05:00"}]
  }
}
```

Числа 1/5 в примере stageMap — иллюстрация, реальные ID получать из GET /meta. Интерфейс делает это сам. Если имена stages точно совпадают с CRM, сервер может сопоставить их автоматически; неизвестный статус без явного mapping — 400. Сопоставления сохраняются в `crm_import_stages`.

Поддерживаемые поля:

- clients: id, name (или clientName), phone либо contacts, instagram, source, note, created_at/createdAt;
- contacts: строки телефонов либо `{type:"phone"|"tel"|"mobile"|"whatsapp",value:"…"}`; также объект `{phone:"…"}`. Используется первый телефон;
- products: id, name/title, price;
- deals: id, statusId, clientId, clientName, contacts/phone, title, amount, source, note, items, ship_date/shipDate, lost_reason, created_at/createdAt, stage_entered_at/stageEnteredAt, closed_at/closedAt;
- items: `{name,qty,price}` либо `{productId,qty|quantity,price?}`. Цена/имя могут браться из products. В состав сделки сохраняется снимок name/qty/price;
- дата отгрузки — YYYY-MM-DD, даты событий/создания/закрытия — ISO timestamp. Без amount сумма вычисляется по items. Без состава сумма 0; пользователь может уточнить её в карточке.

Новые импортируемые сделки назначаются импортирующему mgr: внешний manager ID не сопоставляется молча с users.id. После импорта менеджер меняется в карточке.

Каждый массив ограничен 10 000 элементами, JSON body — существующий лимит 15 МБ, файл в UI — 10 МБ. Неизвестные даты не заменяются сегодняшними; счётчики `incomplete_won`, `undated_closed`, `undated_leads` сообщают, что нужно уточнить. Повтор с новым reqId также не дублирует ext_id; существующие записи не обновляются.

## Аналитика

- stages — текущая воронка по всем сделкам, независимо от фильтра периода;
- leads/sources — созданные в период; won/conversion — сколько из этой когорты сейчас в is_won;
- sales_amount/sales_count — текущие is_won с closed_at в периоде;
- reopened/lost исключаются из продаж, повторное завершение задаёт новую дату закрытия;
- `missing` — глобальные количества неизвестных дат создания/закрытия и неполного состава исторических won;
- сумма продажи — сумма сделки, не факт платежа; касса и fin_state не участвуют.

Все запросы аналитики выполняются в одной read-only REPEATABLE READ транзакции, чтобы срез не менялся между запросами.
