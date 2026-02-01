# Profile Module – Implementation Summary

Comprehensive, category-based user profile for Digital House. Implemented on the **existing stack**: Node.js (Express) + **MySQL (Sequelize)** + React Native. A **MongoDB** schema reference is in `PROFILE_SCHEMA.md` for migration or greenfield use.

---

## What’s implemented

### Backend (Node.js + MySQL/Sequelize)

- **User model:** New columns `nativeDistrict`, `role` (USER | ADMIN | MODERATOR) for Basic section.
- **UserProfile model:** One row per user; JSON columns: `community`, `personal`, `matrimony`, `business`, `family`. Created on first `GET /api/profile/me` if missing.
- **GET /api/profile/me:** Returns full profile including:
  - Existing: `personal_info`, `professional_info`, `stats`
  - New: `sections` (basic, community, personal, matrimony, business, family), `completion_percentage`, `show_matrimony`, `show_business`
- **PUT /api/profile/me:** Unchanged (legacy single-body update).
- **PATCH /api/profile/me/sections/:section:** Update one section (`basic` | `community` | `personal` | `matrimony` | `business` | `family`). On update, user `status` is set to `PENDING_REVIEW`.
- **POST /api/profile/me/horoscope-upload-url:** Body: `fileName`, `fileType` (application/pdf | image/jpeg | image/png), `fileSize`. Returns `uploadUrl` (presigned PUT) and `publicUrl`. Client uploads to R2 then PATCHes `matrimony` with `horoscopeDocumentUrl: publicUrl`.
- **Validation:** Section payloads validated per section (Zod); horoscope upload limited to 10 MB.

### Conditional visibility

- **Matrimony section:** Shown in UI when `sections.matrimony.matrimonyProfileActive === true`.
- **Business section:** Shown when `sections.business.businessProfileActive === true`.
- Backend returns `show_matrimony` and `show_business` so the app can show/hide sections.

### Mobile (React Native / Expo)

- **Profile API:** Types for `sections`, `completion_percentage`, `show_matrimony`, `show_business`; `updateProfileSection(section, payload)`, `getHoroscopeUploadUrl(payload)`.
- **Profile screen:** Shows `completion_percentage` in the header (progress bar + “Profile X% complete”) when present.
- **Edit Profile:** Existing screen still uses PUT /me; section-wise edit can use PATCH /me/sections/:section (e.g. accordion/tabs per category).

### Cloudflare R2

- Horoscope: presigned PUT URL from backend; client uploads to R2; client then PATCHes `matrimony.horoscopeDocumentUrl` with the public URL.
- Same R2 config as media uploads (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_CDN_PUBLIC_URL`).

---

## MySQL: existing database

The app uses `sequelize.sync()` **without** `alter`, so:

1. **New table:** `user_profiles` is created automatically on startup.
2. **New columns on `users`:** `nativeDistrict`, `role` are **not** added automatically. Run once:

```sql
ALTER TABLE users
  ADD COLUMN nativeDistrict VARCHAR(80) NULL AFTER communityRole,
  ADD COLUMN role VARCHAR(20) NULL DEFAULT 'USER' AFTER nativeDistrict;
```

Or use a Sequelize migration that adds these columns.

---

## Flutter / MongoDB (requested stack)

The spec asked for **Flutter** UI and **MongoDB**. This repo uses **React Native (Expo)** and **MySQL**. Delivered:

- **Backend:** Node.js APIs and MySQL/Sequelize schema as above; profile data is modular and reusable across Matrimony, Business, Jobs, Community.
- **MongoDB:** Schema and API alignment documented in `PROFILE_SCHEMA.md` for a future Flutter + MongoDB app or migration.
- **Mobile UI:** Profile completion % in the existing React Native app; section-wise edit and accordion/tabs can be added on top of the existing Profile + Edit Profile screens using `updateProfileSection` and `sections`.

To build a **Flutter** client, use the same API contract (GET /me, PATCH /me/sections/:section, POST /me/horoscope-upload-url) and the MongoDB design in `PROFILE_SCHEMA.md` if you switch the backend to MongoDB.
