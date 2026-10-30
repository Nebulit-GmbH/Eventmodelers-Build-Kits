## 11. Invitations (Organization Membership) — Commands

**Files**: `src/slices/organization/InviteUser/routes.ts`, `src/slices/organization/ConfirmInvitation/routes.ts`, `src/slices/organization/DeleteInvitation/routes.ts`

There is no generic "group"/"role-assignment" API — an organization *is* the group, and a
member's role is set once, at invite time (there is no separate call to change an existing
member's role afterward). All of these require a Supabase JWT (`Authorization: Bearer`), never
a bot `x-token`.

### POST `/api/org/:orga_id/invitations`
Invite a user to join an organization with a given role. Caller must already be an `admin` of `orga_id`.

**Body**: `{ role: string, email: string, description?: string }`
**Response**: `201` — invitation created
**Errors**: `400` role/email missing · `403` caller is not an org admin · `409` user already invited or already a member

---

### POST `/api/invitations/:token/confirm`
Accept an invitation — `token` is the invitation's own token (from the invite email link), not an API token. The confirming user's own account email must match the invited email.

**Response**: `200` — invitation confirmed, membership created
**Errors**: `404` invitation not found

---

### DELETE `/api/org/:orga_id/invitations/:invitation_id`
Cancel a pending invitation.

**Response**: `200`/`204` on success

---

## 12. Invitations (Organization Membership) — Read Models

All require a Supabase JWT (`Authorization: Bearer`).

### GET `/api/user-organizations`
Organizations (and the caller's role in each) that the authenticated user belongs to.

### GET `/api/client/org/:orgId/invitations`
Pending invitations for an organization (client-facing list — used by the org settings UI).

---
