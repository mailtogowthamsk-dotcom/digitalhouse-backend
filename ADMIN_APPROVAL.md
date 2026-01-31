# Admin approval – Digital House

Admin approval is **API only** (no web UI). You use the API with a secret key.

---

## 1. Set the admin key

In `backend/.env` set a long, random value for `ADMIN_API_KEY`.

**Option A – Generate a secure key (recommended):**

```bash
cd backend
npm run generate-admin-key
```

Copy the printed line (e.g. `ADMIN_API_KEY=abc123...`) into your `.env` file, or replace the existing `ADMIN_API_KEY=` line with it.

**Option B – Manual:** Use any long random string (e.g. `MySecureAdminKey2024!`). Avoid short or guessable values.

**Every admin API request must send this value** in the header:

```http
X-Admin-Key: your_secret_key_here
```

Without this header (or with a wrong value), the server returns **401 Unauthorized**.

---

## 2. Flow overview

1. User registers in the app → saved with **status = PENDING**.
2. Admin calls **GET /api/admin/pending** → sees list of pending users.
3. Admin calls **GET /api/admin/users/:id** → sees full profile (optional).
4. Admin either:
   - **POST /api/admin/users/:id/approve** → user can log in (OTP).
   - **POST /api/admin/users/:id/reject** → user sees “Account not approved” and cannot log in.

---

## 3. API reference

**Base URL:** `http://localhost:4000/api` (or your server URL)

**Required header on all admin requests:**

| Header       | Value              |
|-------------|--------------------|
| `X-Admin-Key` | Same as `ADMIN_API_KEY` in `.env` |
| `Content-Type` | `application/json` (for POST)     |

### List pending users

```http
GET /api/admin/pending
X-Admin-Key: your_secret_key_here
```

**Response:** `{ "ok": true, "users": [ ... ] }`  
Each user has: id, fullName, email, mobile, location, kulam, status, createdAt, etc.

### Get one user (full profile + history)

Use a **real user id** from the pending list (see above). `1` is just an example.

```http
GET /api/admin/users/<id>
X-Admin-Key: your_secret_key_here
```

**Response:** `{ "ok": true, "user": { ... }, "verificationHistory": [ ... ] }`

### Approve user

Use the **user id** from **GET /api/admin/pending** (e.g. if the user has `"id": 2`, use `/users/2/approve`).

```http
POST /api/admin/users/<id>/approve
X-Admin-Key: your_secret_key_here
Content-Type: application/json

{}
```

Optional body (e.g. for audit):

```json
{ "remarks": "Verified documents." }
```

**Success:** `{ "ok": true, "message": "User approved." }`  
**404 Not Found:** `{ "ok": false, "message": "User not found" }` — the `<id>` does not exist. **Always get real IDs from GET /api/admin/pending first** (e.g. if the list shows `"id": 5`, call `POST .../users/5/approve`).  
User **status** becomes **APPROVED** and they can log in with email + OTP. An **approval email** is sent to the user’s email (optional remarks included).

### Reject user

Use the same **user id** from the pending list.

```http
POST /api/admin/users/<id>/reject
X-Admin-Key: your_secret_key_here
Content-Type: application/json

{ "remarks": "Invalid documents." }
```

**Response:** `{ "ok": true, "message": "User rejected." }`  
User **status** becomes **REJECTED**. They see “Account not approved” when trying to log in. A **rejection email** is sent to the user’s email (remarks/reason included).

---

## 4. Example with cURL

Replace `YOUR_ADMIN_KEY` and `1` (user id) as needed.

```bash
# List pending
curl -X GET "http://localhost:4000/api/admin/pending" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY"

# Get user 1
curl -X GET "http://localhost:4000/api/admin/users/1" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY"

# Approve user 1
curl -X POST "http://localhost:4000/api/admin/users/1/approve" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"remarks":"Approved."}'

# Reject user 1
curl -X POST "http://localhost:4000/api/admin/users/1/reject" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"remarks":"Invalid ID."}'
```

---

## 5. Example with Postman

1. Create a collection (e.g. “Digital House Admin”).
2. Add a collection variable: `admin_key` = your `ADMIN_API_KEY` value.
3. In collection **Headers**, add:  
   `X-Admin-Key` = `{{admin_key}}`
4. Create requests:
   - **GET** `{{base_url}}/admin/pending`
   - **GET** `{{base_url}}/admin/users/1`
   - **POST** `{{base_url}}/admin/users/1/approve` with body `{"remarks":"Approved."}`
   - **POST** `{{base_url}}/admin/users/1/reject` with body `{"remarks":"Reason here."}`
5. Set `base_url` = `http://localhost:4000/api` (or your server).

---

## 6. Audit

Every approve/reject is stored in **admin_verifications**:

- `userId`
- `verifiedBy` (currently the same as admin key identifier)
- `verifiedAt`
- `remarks`

So you have a simple audit log of who was approved or rejected and when.
