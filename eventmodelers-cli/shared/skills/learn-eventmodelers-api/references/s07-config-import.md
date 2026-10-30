## 7. Config Import

**File**: `src/slices/change/config-import/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/import-config`
Import an EventModelingJson config to populate a board.

**Request**: `multipart/form-data` with field `file` OR `application/json` body:
```typescript
{ slices: SliceDefinition[] }
```

**Response**: `200` — transformed canvas with nodes and edges

---
