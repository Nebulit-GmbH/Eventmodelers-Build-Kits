## 10. Snapshots

**File**: `src/slices/Snapshots/routes.ts`

All snapshot endpoints require Supabase JWT authentication.

**Constraints**: max 3 snapshots per user, max 30-day retention, max 50 MB file size.

### GET `/api/snapshots`
List current user's snapshots.

**Response**: `200` — `Array<{ id, name, payload_id, expiry, shared }>`

---

### POST `/api/snapshots`
Create a snapshot.

**Request**: `multipart/form-data` — fields: `payloadFile` (binary), `name` (string), `retention?` (days, max 30)  
**Response**: `201` — `{ ok: true, id: string }`

---

### GET `/api/snapshots/:id`
Load a snapshot's payload.

**Response**: `200` — snapshot payload JSON

---

### PATCH `/api/snapshots/:id/share`
Share a snapshot (makes it publicly accessible).

**Response**: `200` — `{ ok: true }`

---

### DELETE `/api/snapshots/:id`
Delete a snapshot.

**Response**: `200` — `{ ok: true }`

---
