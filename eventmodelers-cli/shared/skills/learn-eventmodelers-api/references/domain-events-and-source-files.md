## Domain Events

### Snapshot Events (`src/events/SnapshotsEvents.ts`)

```typescript
SnapshotStored          // { name, id, payloadId, expiry }
SnapshotDeleted         // { id }
SnapshotCleanedUp       // { id }
PublishedSnapshotDeleted // { id }
SnapshotShared          // { id }
SnapshotPublished       // { id, payloadId, bucket, path }
```

### Invitation Events (`src/slices/organization/OrganizationEvent.ts`)

```typescript
UserInvited                  // { orgaId, userId, role, invitationId, token, description?, boardId?, email? }
InvitationConfirmed          // { orgaId, userId, invitationId, token?, email? }
InvitationDeleted            // { invitationId }
UserAssignedToOrganization   // { id, userId, orgaId, role?, boardId?, email? }
UserRemovedFromOrganization  // { orgaId, userId }
```

All events support optional metadata: `user_id`, `correlation_id`, `causation_id`

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/slices/change/types.ts` | `ElementType`, `NodeChangeEvent`, `EdgeEvent` |
| `src/slices/change/api-boards/routes.ts` | Board CRUD + event persistence |
| `src/slices/change/api-chapters/routes.ts` | Chapters, columns, lanes, cell drops |
| `src/slices/change/api-nodes/routes.ts` | Node event sourcing |
| `src/slices/extensions/supabase/nodes/AutoConnectNode.ts` | Auto-connect logic (timeline neighbor wiring) |
| `src/slices/change/api-images/routes.ts` | Image upload + sketch rendering |
| `src/slices/change/api-prompts/routes.ts` | Prompt submission, claiming, and status lifecycle |
| `src/slices/change/api-.slices/routes.ts` | Slice creation + slice definitions (SLICE_BORDER) |
| `src/slices/extensions/supabase/slices/CreateSliceDefinition.ts` | Slice definition (SLICE_BORDER) creation logic |
| `src/slices/change/api-specs/routes.ts` | GWT scenario management |
| `src/slices/change/config-import/routes.ts` | Config import |
| `src/slices/slicedata/routes.ts` | Slice data read models |
| `src/slices/extensions/routes.ts` | Extension management |
| `src/slices/Snapshots/routes.ts` | Snapshot CRUD |
| `src/slices/organization/InviteUser/routes.ts`, `ConfirmInvitation/routes.ts`, `DeleteInvitation/routes.ts` | Organization invitation commands |
| `src/events/SnapshotsEvents.ts` | Snapshot domain events |
| `src/slices/organization/OrganizationEvent.ts` | Organization/invitation domain events |
| `backend/src/server.ts` | Route wiring, CORS, `/api/user` |
