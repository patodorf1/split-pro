# External shopping list API

REST endpoints for syncing the shared shopping list with external systems (Home Assistant mirroring
an Alexa list, n8n flows, scripts). The shopping endpoints expose nothing about expenses; the same
key also enables the expenses endpoints described in [Gastos / Expenses](#gastos--expenses).

## Enabling it

Set `EXTERNAL_API_KEY` (minimum 16 characters) in the environment:

```bash
EXTERNAL_API_KEY=$(openssl rand -hex 32)
```

If the variable is **not** set, every `/api/external/*` route answers `404` — the API effectively
does not exist. When it is set, every request must carry:

```
Authorization: Bearer <EXTERNAL_API_KEY>
```

The key is compared in constant time. A missing or wrong key gets `401`.

> The key is a machine credential: it can read and write the shopping list of **any** group in the
> instance, and it can also add and delete expenses (see [Gastos / Expenses](#gastos--expenses)).
> It is not tied to a user.

## Base URL

```
/api/external/shopping/{groupId}
```

`groupId` is the numeric group id (the one in `/groups/{groupId}`). A group that does not exist
returns `404`.

## Item shape

```json
{
  "id": "1b9f0a3e-...",
  "name": "Leche",
  "quantity": "2 L",
  "note": "descremada",
  "checked": false,
  "checkedAt": null,
  "checkedBy": null,
  "addedBy": "Pato",
  "source": "alexa",
  "externalId": "alexa-8f21",
  "createdAt": "2026-09-18T12:00:00.000Z",
  "updatedAt": "2026-09-18T12:00:00.000Z"
}
```

- `source`: `app` (loaded in the app), `alexa` or `api` (loaded through this API).
- `externalId`: free string, unique **per group** when present. It is the anchor for idempotent
  syncing: the same `externalId` always updates the same row instead of creating a new one.
- `addedBy` / `checkedBy`: display name, or `null` when the actor was a machine.

## GET — read the list

Query param `status`: `all` (default), `pending`, `checked`.

```bash
curl -s "$BASE/api/external/shopping/1?status=pending" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY"
```

```json
{ "groupId": 1, "items": [ { "id": "...", "name": "Leche", ... } ] }
```

## POST — upsert items

```bash
curl -s -X POST "$BASE/api/external/shopping/1" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "alexa",
    "items": [
      { "externalId": "alexa-8f21", "name": "Leche", "quantity": "2 L" },
      { "name": "Pan" }
    ]
  }'
```

Body:

| field                | type                 | notes                                               |
| -------------------- | -------------------- | --------------------------------------------------- |
| `source`             | `"alexa"` \| `"api"` | optional, defaults to `api`. Only used on creation. |
| `items[].externalId` | string               | optional. Match key for idempotent upserts.         |
| `items[].name`       | string               | required.                                           |
| `items[].quantity`   | string \| null       | optional. Omit to leave untouched.                  |
| `items[].note`       | string \| null       | optional. Omit to leave untouched.                  |
| `items[].checked`    | boolean              | optional. Omit to leave untouched.                  |

Matching rules, in order:

1. If `externalId` is given and that id already exists in the group → that item.
2. Otherwise → a **pending** item with the same name, ignoring case and accents
   (`leche` matches `Leche`). Already-bought items do not block re-adding.
3. No match → a new item is created.

### What a sync is allowed to overwrite

`addedBy` and `source` are never touched, and the **name is protected**: the text a person typed
is theirs. Concretely:

| situation                                                      | `name`        | `externalId`                 |
| -------------------------------------------------------------- | ------------- | ---------------------------- |
| matched by name                                                | never changed | adopted if the item had none |
| matched by `externalId`, item has no `addedBy`                 | updated       | unchanged                    |
| matched by `externalId`, item has `addedBy` (a person made it) | never changed | unchanged                    |

`quantity`, `note` and `checked` are updated whenever they come in the body, in every case.

So `POST {"items":[{"name":"LECHE"}]}` against an existing `leche` that Pato typed updates its
quantity and note but leaves it called `leche`. Sending the same name together with a new
`externalId` links the two — the item keeps its name and gains the id, so the next sync finds it
by id instead of by name, and still cannot rename it because it has an `addedBy`.

```json
{ "groupId": 1, "created": 1, "updated": 1, "items": [ ... ] }
```

Max 100 items per request.

## PATCH — mark bought / pending

```bash
curl -s -X PATCH "$BASE/api/external/shopping/1" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "items": [ { "externalId": "alexa-8f21", "checked": true },
                   { "name": "Pan", "checked": false } ] }'
```

Each entry needs `checked` plus one of `id`, `externalId` or `name` (name match is
case-insensitive, pending items first). Entries with no match come back in `notFound`.

```json
{ "groupId": 1, "updated": 1, "notFound": ["Pan"], "items": [ ... ] }
```

## DELETE — remove items

Accepts a JSON body, query params, or both:

```bash
# one item by externalId
curl -s -X DELETE "$BASE/api/external/shopping/1?externalId=alexa-8f21" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY"

# everything already bought
curl -s -X DELETE "$BASE/api/external/shopping/1" \
  -H "Authorization: Bearer $EXTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "checked": true }'
```

| field / param | type     | notes                                   |
| ------------- | -------- | --------------------------------------- |
| `ids`         | uuid[]   | query alias: `?id=`                     |
| `externalIds` | string[] | query alias: `?externalId=`             |
| `names`       | string[] | query alias: `?name=`, case-insensitive |
| `checked`     | boolean  | query alias: `?checked=true`            |

At least one filter is required, otherwise `400`. Filters are OR-ed.

```json
{ "groupId": 1, "deleted": 3 }
```

## Status codes

| code | when                                                                  |
| ---- | --------------------------------------------------------------------- |
| 200  | ok                                                                    |
| 400  | invalid `groupId`, invalid `status`, malformed body, no delete filter |
| 401  | missing or wrong bearer key                                           |
| 404  | `EXTERNAL_API_KEY` not configured, or group not found                 |
| 405  | method other than GET/POST/PATCH/DELETE                               |

## Typical Home Assistant sync

1. `GET ?status=all` to read the current state.
2. `POST` the Alexa list with a stable `externalId` per Alexa item — new ones get created, existing
   ones get updated, and the names of items a person typed in the app are left alone.
3. `PATCH` with `checked: true` for what Alexa marked as bought.
4. `DELETE` with the `externalIds` that disappeared from the Alexa list.

---

## Gastos / Expenses

Endpoints for an assistant (a WhatsApp bot) to **add expenses and balance transfers** and read back
enough to confirm them. Same `EXTERNAL_API_KEY`, same `Authorization: Bearer` header, same
behaviour when the key is not configured (every route answers `404`).

> **Assumption:** the key is global to the installation, which belongs to a single family. It can
> read and write expenses in **every** group. What it can never do is assign a payer, participant,
> author or deleter who is not a member of the group in the URL: people are always resolved
> against that group's members only.

The API has no user session, so the caller says who paid (`paidBy`) and who is loading it
(`createdBy`). People are given as **email** (case-insensitive) or **user id**.

Expenses are created with the very same service the app uses (`createExpense`, behind the tRPC
`expense.addOrEditExpense` mutation), so rows, split math, penny rounding and push notifications are
identical to an expense typed in the app. Transfers use `buildSettlementInput`, the builder every
"settle up" flow of the app uses.

Examples use `$SPLIT_API_KEY` and `BASE=https://split.thepulso.com`.

### GET /api/external/groups

Groups with default currency and members.

```bash
curl -s "$BASE/api/external/groups" -H "Authorization: Bearer $SPLIT_API_KEY"
```

```json
{
  "groups": [
    {
      "id": 1,
      "name": "Casa",
      "defaultCurrency": "ARS",
      "archived": false,
      "members": [{ "id": 1, "name": "Pato", "email": "pato@example.com" }]
    }
  ]
}
```

### GET /api/external/groups/{groupId}/expenses?limit=10

Latest non-deleted expenses (by expense date, `limit` 1–50, default 10) plus the current balance
of the group, read from the same `BalanceView` the app uses (simplified when the group has
"simplify debts" on).

```bash
curl -s "$BASE/api/external/groups/1/expenses?limit=5" -H "Authorization: Bearer $SPLIT_API_KEY"
```

```json
{
  "groupId": 1,
  "expenses": [
    {
      "id": "e1c8dcf5-...",
      "type": "expense",
      "description": "Supermercado",
      "amount": 45000,
      "currency": "ARS",
      "category": "groceries",
      "splitType": "EQUAL",
      "date": "2026-09-18T19:37:32.230Z",
      "createdAt": "2026-09-18T19:37:32.239Z",
      "paidBy": { "id": 1, "name": "Pato", "email": "pato@example.com" },
      "createdBy": { "id": 1, "name": "Pato", "email": "pato@example.com" },
      "source": "api",
      "idempotencyKey": "wa-3EB0C4F2",
      "deleted": false,
      "participants": [
        { "id": 1, "name": "Pato", "email": "pato@example.com", "share": 22500, "balance": 22500 },
        {
          "id": 2,
          "name": "Belén",
          "email": "belen@example.com",
          "share": 22500,
          "balance": -22500
        }
      ]
    }
  ],
  "balances": [
    {
      "currency": "ARS",
      "amount": 285083.69,
      "debtor": { "id": 2, "name": "Belén", "email": "belen@example.com" },
      "creditor": { "id": 1, "name": "Pato", "email": "pato@example.com" },
      "text": "Belén le debe $ 285.083,69 a Pato"
    }
  ]
}
```

- Amounts are in currency units (`45000.5`), not cents.
- `type`: `expense` or `transfer`. `source`: `api` (loaded through this API) or `app`.
- `share`: the part of the expense that person consumes. `balance`: what the expense moves in
  their balance (paid − share). For transfers `category` is `null`.
- `balances` only lists non-zero debts; an empty list means the group is settled.

#### Filters and pagination (optional)

| param      | notes                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `from`     | `YYYY-MM-DD`, Buenos Aires day, inclusive. Only `from`: until today.                                     |
| `to`       | `YYYY-MM-DD`, inclusive. Only `to`: from the 1st of that month. Max range 10 years; `from > to` → `400`. |
| `category` | one or more category keys, comma separated (`groceries,diningOut`). Unknown key → `400`.                 |
| `q`        | text in the description, case and accent insensitive (`estefi` finds `Estefí`). Up to 100 chars.         |
| `paidBy`   | email or id of a group member (for transfers: who sent the money).                                       |
| `type`     | `expense` (what stats count) or `transfer` (balance movements).                                          |
| `offset`   | pagination, 0–10000. Use `pagination.nextOffset` from the previous page (`null` = no more pages).        |

Same order (expense date, newest first) and same `limit`. Without any of these params the response
is exactly the one above (unknown params are still ignored, as before); with at least one, it also
carries `filters` and `pagination`:

```bash
# When did we last pay Estefi, and how much?
curl -s "$BASE/api/external/groups/1/expenses?q=estefi&limit=1" -H "Authorization: Bearer $SPLIT_API_KEY"
```

```json
{
  "groupId": 1,
  "expenses": [{ "description": "Estefi", "amount": 220000, "date": "2026-09-11T15:00:00.000Z", "...": "..." }],
  "balances": [ ... ],
  "filters": { "from": null, "to": null, "category": null, "q": "estefi", "paidBy": null, "type": null },
  "pagination": { "limit": 1, "offset": 0, "nextOffset": 1 }
}
```

### POST /api/external/groups/{groupId}/expenses — expense

```bash
curl -s -X POST "$BASE/api/external/groups/1/expenses" \
  -H "Authorization: Bearer $SPLIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Supermercado",
    "amount": 45000,
    "paidBy": "pato@example.com",
    "category": "groceries",
    "idempotencyKey": "wa-3EB0C4F2"
  }'
```

| field            | type             | notes                                                                                                                                                                                                                                                          |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`    | string           | required, 1–100 chars.                                                                                                                                                                                                                                         |
| `amount`         | number \| string | required, positive, in units (`45000.5` or `"45000.50"`). Dot as decimal separator, no thousands separator. More decimals than the currency allows → `400` (never rounded silently).                                                                           |
| `currency`       | string           | optional, ISO code. Defaults to the group's default currency.                                                                                                                                                                                                  |
| `paidBy`         | email \| id      | required. Must be a member of the group.                                                                                                                                                                                                                       |
| `createdBy`      | email \| id      | optional, defaults to `paidBy`. Shown in the app as who added it.                                                                                                                                                                                              |
| `category`       | string           | optional, defaults to `general`. Must be a key of `CATEGORIES` in `src/lib/category.ts` (e.g. `groceries`, `diningOut`, `cleaning`, `childcare`, `services`, `electricity`, `water`, `fuel`, `parking`, `maintenance`, `sports`, `pets`, `travel`, `medical`). |
| `date`           | string           | optional. `YYYY-MM-DD` (stored at noon Buenos Aires time) or ISO datetime (no zone = Buenos Aires). Defaults to now.                                                                                                                                           |
| `split`          | object           | optional. Default: equal parts among **all** group members.                                                                                                                                                                                                    |
| `notes`          | string           | optional, up to 1000 chars. Saved as an expense note.                                                                                                                                                                                                          |
| `idempotencyKey` | string           | optional but recommended (up to 200 chars), e.g. derived from the chat message id.                                                                                                                                                                             |

`split` variants:

```json
{ "type": "EQUAL", "participants": ["pato@example.com", 2] }
{ "type": "EXACT", "shares": { "pato@example.com": 3000, "2": 7000 } }
```

- `EQUAL`: equal parts among that subset. The payer is always included in the record (with a zero
  share if not listed), exactly like the app.
- `EXACT`: shares must add up **exactly** to `amount`, otherwise `400` with both sums.

Response `201`:

```json
{ "groupId": 1, "created": true, "expense": { ... }, "balances": [ ... ] }
```

### POST — transfer (settle up)

A balance transfer between two members (`SETTLEMENT`): it moves the balance but does **not** count
as spending in stats.

```bash
curl -s -X POST "$BASE/api/external/groups/1/expenses" \
  -H "Authorization: Bearer $SPLIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "type": "transfer", "from": "pato@example.com", "to": "belen@example.com",
        "amount": 100000, "idempotencyKey": "wa-3EB0C4F3" }'
```

| field                             | type         | notes                                                 |
| --------------------------------- | ------------ | ----------------------------------------------------- |
| `type`                            | `"transfer"` | required.                                             |
| `from`                            | email \| id  | required: who sends the money. Recorded as the payer. |
| `to`                              | email \| id  | required: who receives it. Must differ from `from`.   |
| `amount`                          | number       | required, same rules as above.                        |
| `currency`                        | string       | optional, defaults to the group currency.             |
| `description`                     | string       | optional, defaults to `Transferencia de saldo`.       |
| `createdBy`                       | email \| id  | optional, defaults to `from`.                         |
| `date`, `notes`, `idempotencyKey` |              | same as for expenses.                                 |

`category` and `split` are not accepted for transfers (`400`).

### Idempotency

Send an `idempotencyKey` (unique per group) with every POST. If the key was already used in that
group, nothing is created and the **original** expense comes back with `200` and `"created": false`
— also if it was deleted afterwards (`"deleted": true`). Reusing a key for a _different_ entry
(other amount, currency, payer or type) is `409`. Two simultaneous requests with the same key:
one creates, the other gets `409` ("in progress") and can simply retry.

Implementation: a separate table `ExternalExpense` (group, expense, key; unique on
`(groupId, idempotencyKey)`). The key is reserved **before** creating the expense, so the database
itself prevents duplicates. The same table marks which expenses were created through the API.

### DELETE /api/external/groups/{groupId}/expenses/{expenseId}?deletedBy=<email|id>

Soft delete, exactly like the app (`deletedAt` + `deletedBy`, balance recalculated), to undo a
mistake. Only expenses **created through this API** can be deleted (`403` for expenses loaded in
the app). `deletedBy` is required and must be a group member (query param or JSON body).

```bash
curl -s -X DELETE \
  "$BASE/api/external/groups/1/expenses/e1c8dcf5-549a-4267-a5f5-de81615ccdc1?deletedBy=pato@example.com" \
  -H "Authorization: Bearer $SPLIT_API_KEY"
```

```json
{ "groupId": 1, "deleted": true, "expense": { ..., "deleted": true }, "balances": [ ... ] }
```

### Consultas / Summary — GET /api/external/groups/{groupId}/summary

Read only. How much was spent in a period, per currency (ARS and USD are **never** added up), with
what each member paid and what each one's share was, an optional breakdown and a sentence in
Spanish ready to read out. Answers questions like "¿cuánto gastamos en enero?", "¿cuánto en nafta
este año?", "¿en qué gastamos más el mes pasado?", "¿cuánto pagó Belu en agosto?".

**Same numbers as the app.** `total` uses the exact criterion and SQL of "Nosotros" in /stats and
"Gastado este mes" on the home page (shared code in `src/server/statsQueries.ts`): non-deleted
expenses of the group, excluding transfers (`SETTLEMENT`) and currency conversions. A member's
`shares` amount equals "Yo" in /stats filtered by that group. Months are Buenos Aires months, the
same intervals /stats uses. Everything is aggregated by the database.

| param      | notes                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `from`     | `YYYY-MM-DD`, inclusive, Buenos Aires. Default: the current month (1st to last day). Only `from`: until today.          |
| `to`       | `YYYY-MM-DD`, inclusive. Only `to`: from the 1st of that month. Max 10 years; `from > to` → `400 invalid_range`.        |
| `groupBy`  | optional: `month`, `category`, `payer` or a combination (`month,category`).                                             |
| `category` | optional filter, one or more exact keys comma separated (see `src/lib/category.ts`; `food` only matches `food` itself). |
| `q`        | optional text in the description, case and accent insensitive.                                                          |
| `paidBy`   | optional, email or id of a member: only what that person paid.                                                          |

Unknown params (`catgory=`) are rejected with `400 unknown_parameter`, so a typo never returns the
unfiltered total.

```bash
# ¿Cuánto gastamos en enero?
curl -s "$BASE/api/external/groups/1/summary?from=2026-01-01&to=2026-01-31" \
  -H "Authorization: Bearer $SPLIT_API_KEY"

# ¿En qué gastamos más este año?
curl -s "$BASE/api/external/groups/1/summary?from=2026-01-01&to=2026-12-31&groupBy=category" \
  -H "Authorization: Bearer $SPLIT_API_KEY"

# ¿Cuánto en el super en los últimos 3 meses, mes por mes?
curl -s "$BASE/api/external/groups/1/summary?from=2026-07-01&to=2026-09-21&groupBy=month&category=groceries" \
  -H "Authorization: Bearer $SPLIT_API_KEY"

# ¿Cuánto pagó Belu en agosto?
curl -s "$BASE/api/external/groups/1/summary?from=2026-08-01&to=2026-08-31&paidBy=belen@example.com" \
  -H "Authorization: Bearer $SPLIT_API_KEY"

# ¿Cuánto nos salió el viaje a Bariloche? (by description)
curl -s "$BASE/api/external/groups/1/summary?from=2022-01-01&to=2026-12-31&q=bariloche&groupBy=category" \
  -H "Authorization: Bearer $SPLIT_API_KEY"
```

```json
{
  "groupId": 1,
  "groupName": "Casa",
  "period": {
    "from": "2026-01-01",
    "to": "2026-01-31",
    "timeZone": "America/Argentina/Buenos_Aires"
  },
  "filters": { "category": null, "q": null, "paidBy": null },
  "groupBy": [],
  "currencies": [
    {
      "currency": "ARS",
      "total": 4707849.58,
      "formatted": "$ 4.707.849,58",
      "count": 43,
      "paid": [
        {
          "id": 1,
          "name": "Pato",
          "email": "pato@example.com",
          "amount": 2136700,
          "formatted": "$ 2.136.700"
        },
        {
          "id": 2,
          "name": "Belén",
          "email": "belen@example.com",
          "amount": 2571149.58,
          "formatted": "$ 2.571.149,58"
        }
      ],
      "shares": [
        {
          "id": 1,
          "name": "Pato",
          "email": "pato@example.com",
          "amount": 2353924.79,
          "formatted": "$ 2.353.924,79"
        },
        {
          "id": 2,
          "name": "Belén",
          "email": "belen@example.com",
          "amount": 2353924.79,
          "formatted": "$ 2.353.924,79"
        }
      ]
    }
  ],
  "transfers": [{ "currency": "ARS", "total": 539500, "formatted": "$ 539.500", "count": 2 }],
  "text": "En enero de 2026 gastaron $ 4.707.849,58 en 43 gastos (Pato puso $ 2.136.700, Belén $ 2.571.149,58)."
}
```

- Amounts are numbers in currency units (like the rest of the API); `formatted` is the same amount
  in es-AR (`$ 1.234,56`, `US$ 80`), as used in `text`. Formatted strings use a non-breaking space
  after the symbol.
- `currencies`: one entry per currency with expenses; the group's default currency is always there
  (with zeros if nothing was spent).
- `paid`: what each member paid. `shares`: what each member consumed. Both list every member.
- With `groupBy`, each currency carries `breakdown`: items with `month` (`2026-01`) + `monthName`,
  `category` + `categoryName` (Spanish name as in the app) and/or `payer`, plus `total`,
  `formatted`, `count` and `percentage` (of that currency's total, one decimal). Order: by month
  chronologically (with `groupBy=month` alone, months without expenses appear with `0`); by
  category or payer from highest to lowest.
- `transfers`: balance transfers (`SETTLEMENT`) of the period, per currency, never mixed with
  spending. It honours `q` and `paidBy` (the sender), and is `null` when filtering by `category`
  (transfers have no category).
- `text`: one or two sentences in Spanish. With a single `groupBy=category` it adds the top 3
  ("Lo que más: …"); with `groupBy=month` alone, the amount of each month (up to 12; otherwise the
  most expensive one).

### Errors

Errors carry a message in Spanish and English, a stable `code` and, when it applies, the `field`:

```json
{
  "error": "paidBy: \"x@example.com\" no es miembro de este grupo / paidBy: \"x@example.com\" is not a member of this group",
  "code": "not_a_member",
  "field": "paidBy"
}
```

| code | when                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 200  | ok; POST replay of an existing `idempotencyKey`                                                                                              |
| 201  | created                                                                                                                                      |
| 400  | invalid body/field (`validation_error`, `invalid_field`, `not_a_member`, `unknown_category`, `split_mismatch`), invalid `groupId` or `limit` |
| 401  | missing or wrong key                                                                                                                         |
| 403  | DELETE of an expense that was not created through the API (`not_created_by_api`)                                                             |
| 404  | API disabled (no `EXTERNAL_API_KEY`), group not found, expense not found in that group                                                       |
| 405  | method not allowed                                                                                                                           |
| 409  | `idempotency_key_reused`, `idempotency_in_progress`, `already_deleted`, `group_archived`                                                     |
| 500  | unexpected error (no details are returned; they go to the server log)                                                                        |

The query endpoints (`summary`, and the filters of the list) add these `400` codes: `invalid_range`
(`from` later than `to`), `range_too_long` (more than 10 years), `unknown_parameter` (summary only),
`unknown_category`, `not_a_member` (`paidBy`) and `invalid_field` (dates, `groupBy`, `q`, `type`,
`offset`).

Unknown fields are rejected (`400`), so a typo like `paidby` does not silently fall back to a
default.
