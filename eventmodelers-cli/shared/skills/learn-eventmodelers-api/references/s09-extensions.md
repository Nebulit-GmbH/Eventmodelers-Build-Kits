## 9. Extensions

**File**: `src/slices/extensions/routes.ts`

### GET `/api/org/:orgId/boards/:boardId/extensions`
List extension configs for a board.

**Response**: `200` — extension record array

---

### PUT `/api/org/:orgId/boards/:boardId/extensions/:type`
Enable or disable an extension.

**Request body**: `{ enabled: boolean, config?: object }`  
**Response**: `200` — updated extension config

---
