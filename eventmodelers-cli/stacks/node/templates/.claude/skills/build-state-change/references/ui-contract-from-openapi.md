# UI Contract — derive from the `@openapi` block

Used by the `ui-contract` skill. This stack's `routes.ts` carries an `@openapi` JSDoc block above every
handler (guarded by the `openapi-annotation` commit check), so derive the contract from it mechanically
instead of re-reading handler logic.

| Contract key | OpenAPI source |
|---|---|
| `method` | the verb key under the path (`get` / `post`) |
| `path` | the path key, verbatim (`{param}` style) |
| `pathParams` / `queryParams` | `parameters[]` with `in: path` / `in: query` → `name`, `schema` (`optional` = not `required`) |
| `body` (write) | `requestBody…schema.properties` |
| `response.fields` (read) | the `200` response schema `properties` (follow a `$ref` to `components.schemas`); `Single` vs `List` = object vs `type: array` |
| `response.status` (write) | the success response code |
| `errors[]` | every non-2xx response: `status` = the key, `code` / `when` = its description / `error` example |
| `type` | `string`+`uuid` → `UUID`, `integer`/`int32` → `Int`, `int64` → `Long`, `number`/`double` → `Double`, `number` → `Decimal`, `boolean` → `Boolean`, `date` / `date-time` → `Date` / `DateTime`, `object` → `Custom`, else `String` |
| `example` | the schema's `example`, nothing invented |
