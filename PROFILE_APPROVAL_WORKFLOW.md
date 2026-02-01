# Profile Update & Admin Approval Workflow

## Overview

- **Non-restricted sections** (Basic, Community, Personal, Family): updates apply **immediately**. User login is never blocked.
- **Restricted sections** (Matrimony, Business): updates go to **pending_profile_updates** until admin approves. Approved data lives in **user_profiles**; pending data is never shown publicly until approved.

## Database: `pending_profile_updates`

If you use `sequelize.sync()`, the table is created automatically. Otherwise run:

```sql
CREATE TABLE IF NOT EXISTS pending_profile_updates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  section ENUM('MATRIMONY','BUSINESS') NOT NULL,
  data JSON NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  submitted_at DATETIME NOT NULL,
  reviewed_at DATETIME NULL,
  admin_remarks TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## Profile API Behavior

| Section     | PUT /api/profile/:section | Effect |
|------------|---------------------------|--------|
| basic      | ✅                        | Updates `users` immediately. Login unchanged. |
| community  | ✅                        | Updates `user_profiles.community` immediately. |
| personal   | ✅                        | Updates `user_profiles.personal` immediately. |
| family     | ✅                        | Updates `user_profiles.family` immediately. |
| matrimony  | ✅                        | Creates/updates row in `pending_profile_updates` (status PENDING). Does **not** overwrite `user_profiles.matrimony`. |
| business   | ✅                        | Same as matrimony for `user_profiles.business`. |

GET /api/profile (and /api/profile/me) returns:

- **sections.matrimony / sections.business**: always the **approved** data from `user_profiles`.
- **pending_matrimony / pending_business**: `{ status: "PENDING" | "APPROVED" | "REJECTED", admin_remarks? }` so the app can show status chips and disable edit when PENDING.

## Admin API

- **GET /api/admin/pending-updates**  
  List all PENDING rows (Matrimony & Business) with user info and **current approved** vs **pending** data for compare.

- **POST /api/admin/approve-update**  
  Body: `{ updateId: number, remarks?: string }`  
  Copies pending `data` into `user_profiles.matrimony` or `user_profiles.business`, sets row `status = APPROVED`, `reviewed_at`, `admin_remarks`.

- **POST /api/admin/reject-update**  
  Body: `{ updateId: number, remarks: string }`  
  Sets row `status = REJECTED`, `reviewed_at`, `admin_remarks`. User sees remarks in app.

All admin routes require **X-Admin-Key** (or **Authorization: Bearer &lt;key&gt;**).

## Login Safety

- Profile updates (any section) **do not** change `users.status`.
- Only initial user approval/rejection (registration flow) and explicit admin actions change `users.status`.
- User login remains allowed as long as `users.status === 'APPROVED'`.
