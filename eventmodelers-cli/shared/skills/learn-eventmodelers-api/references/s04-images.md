## 4. Images

**File**: `src/slices/change/api-images/routes.ts`

### POST `/api/org/:orgId/boards/:boardId/images/:imageId`
Update a board image.

**Request**: `multipart/form-data` — field `file` (binary)  
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/imagesnapshots/:imageId`
Update an image snapshot.

**Request**: `multipart/form-data` — field `file` (binary)  
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/image-nodes/:nodeId`
Create an image node.

**Request**: `multipart/form-data` — fields: `file`, `chapterId`, `cellName`, `title?` (label shown on the node, `meta.title`)  
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/place-image`
Place an image on the board as a free-floating OUTLINE (no chapter, no cell, never connected). Accepts png, jpg, gif, webp and svg (rendered); stored as webp, at most 1600 px.

**Request**: `multipart/form-data` — fields: `file`, `x`, `y`, `width?`, `height?` (none: the image's size, ≤ 800 px on the long side; one: the other keeps the ratio), `title?`, `nodeId?`  
**Response**: `201` — `{ nodeId }` · `400` — `IMAGE_FILE_REQUIRED`, `IMAGE_INVALID`, `IMAGE_POSITION_REQUIRED`, `IMAGE_SIZE_INVALID`

---

### POST `/api/org/:orgId/boards/:boardId/images/:imageId/sketch`
Render a sketch description to WebP and upload.

**Request body**:
```typescript
{
  elements: object[]           // sketch element descriptors
  semanticDescription?: string // human-readable description stored in metadata
}
```
**Response**: `204`

---

### POST `/api/org/:orgId/boards/:boardId/image-nodes/:nodeId/sketch`
Create a SCREEN node from a sketch description.

**Request body**:
```typescript
{
  chapterId: string
  cellName: string
  description: { elements: object[] }
  semanticDescription?: string
  title?: string               // label shown on the node (meta.title)
}
```
**Response**: `204` OR `400` (validation error)

---
