# External shopping list API

REST endpoints for syncing the shared shopping list with external systems (Home Assistant mirroring
an Alexa list, n8n flows, scripts). Nothing about expenses, balances or group members is exposed.

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
> instance. It is not tied to a user and grants no access to expenses.

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

1. If `externalId` is given → the item with that `externalId` in the group.
2. Otherwise → a **pending** item with the same name, ignoring case and accents
   (`leche` matches `Leche`). Already-bought items do not block re-adding.
3. No match → a new item is created.

An upsert never overwrites `addedBy` or `source` of an existing item, so a sync cannot steal an
item a person loaded by hand.

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
   ones get updated, and items loaded in the app are left alone.
3. `PATCH` with `checked: true` for what Alexa marked as bought.
4. `DELETE` with the `externalIds` that disappeared from the Alexa list.
