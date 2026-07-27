# Supabase JWT Authentication for Backend API

This backend API uses Supabase JWT tokens for authentication. Clients must include a valid JWT token in the
`Authorization` header.

## Quick Start

1. **Set up environment variables** in `.env`:
   ```env
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_PUBLISHABLE_KEY=your-anon-key-here
   ```

2. **Start the server**: `npm run dev`

3. **Get a test JWT token**: sign in a user via the Supabase client SDK or `supabase auth` CLI and use the returned `access_token` in your API requests.

## How It Works

1. **Client obtains JWT token** from Supabase (via your frontend app)
2. **Client sends requests** with `Authorization: Bearer <jwt-token>` header
3. **Backend verifies JWT** using Supabase and extracts user info
4. **Protected routes** return user data or 401 Unauthorized

## Usage Examples

### Option 1: Using `requireUser` function

```typescript
import {requireUser} from './src/supabase/requireUser';
import {Request, Response} from 'express';

app.get('/api/protected', async (req: Request, res: Response) => {
    const result = await requireUser(req, res, false);

    if (result.error) {
        return res.status(401).json({error: result.error});
    }

    const user = result.user;
    res.json({
        message: 'Protected data',
        userId: user.id,
        email: user.email
    });
});
```

### Testing with curl

```bash
# Get JWT token from your Supabase client first
TOKEN="your-jwt-token-here"

# Test protected endpoint
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/user

# Expected response:
# {
#   "userId": "...",
#   "email": "user@example.com",
#   "metadata": { ... }
# }
```

### Testing with JavaScript fetch

```javascript
const token = supabase.auth.session()?.access_token;

fetch('http://localhost:3000/api/user', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
})
    .then(res => res.json())
    .then(data => console.log(data));
```

## API Endpoints

### `GET /api/user`

Returns current authenticated user information.

**Headers:**

- `Authorization: Bearer <jwt-token>` (required)

**Success Response (200):**

```json
{
    "userId": "uuid",
    "email": "user@example.com",
    "metadata": { ... }
}
```

**Error Responses:**

- `401 Unauthorized`: Missing or invalid token
- `500 Internal Server Error`: Server error

## Files

- **`api.ts`**: Supabase client creation
- **`requireUser.ts`**: JWT verification function
- **`requireSysUser.ts`**: Requires an authenticated system ("sys") user
- **`requireOrgaAdmin.ts`**: Requires the caller to be an org admin
- **`README.md`**: This documentation

## Architecture

```
Client Request
    |
    v
Authorization: Bearer <JWT>
    |
    v
Express Route
    |
    v
requireUser() / requireSysUser() / requireOrgaAdmin()
    |
    v
Supabase JWT Verification
    |
    +---> Valid: Continue with user data
    |
    +---> Invalid: Return 401 Unauthorized
```

## Security Notes

- JWT tokens are verified with Supabase on every request
- No session storage on the backend (stateless)
- Tokens expire based on Supabase configuration
- Always use HTTPS in production
- Store the anon key securely (use environment variables)
