# Profile Module – MongoDB Schema Design (Reference)

This document describes a **MongoDB** schema equivalent to the Digital House profile module, for migration or greenfield use. The current backend uses **MySQL + Sequelize** with a `users` table and a `user_profiles` table (JSON columns for sections).

---

## Collection: `users`

Stores auth, basic info, and status. Admin-approved login: `status` must be `APPROVED` to access the app.

```javascript
{
  _id: ObjectId,
  fullName: String,           // required
  email: String,              // required, unique
  mobile: String,
  dob: ISODate,
  gender: String,
  nativeDistrict: String,
  role: String,               // "USER" | "ADMIN" | "MODERATOR"
  status: String,             // "PENDING" | "APPROVED" | "REJECTED" | "PENDING_REVIEW"
  profilePhoto: String,       // URL
  // Legacy / professional (can be moved to profile.personal in a normalized design)
  occupation: String,
  location: String,
  city: String,
  district: String,
  community: String,
  kulam: String,
  bloodGroup: String,
  education: String,
  jobTitle: String,
  company: String,
  workLocation: String,
  skills: String,
  communityRole: String,
  govtIdType: String,
  govtIdFile: String,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `email` (unique), `status`, `createdAt`.

---

## Collection: `user_profiles`

One document per user; category-based sections as nested objects. Reusable across Matrimony, Business, Jobs, Community.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,           // ref users._id, unique
  community: {
    kulam: String,
    kulaDeivam: String,
    nativeVillage: String,
    nativeTaluk: String
  },
  personal: {
    currentLocation: String,
    occupation: String,
    instagram: String,
    facebook: String,
    linkedin: String,
    hobbies: String,
    fatherName: String
  },
  matrimony: {
    matrimonyProfileActive: Boolean,   // if true, show Matrimony section
    lookingFor: String,               // "SELF" | "SON" | "DAUGHTER"
    education: String,
    maritalStatus: String,
    rashi: String,
    nakshatram: String,
    dosham: String,
    familyType: String,
    familyStatus: String,
    motherName: String,
    fatherOccupation: String,
    numberOfSiblings: Number,
    partnerPreferences: String,
    horoscopeDocumentUrl: String      // R2 URL after upload
  },
  business: {
    businessProfileActive: Boolean,    // if true, show Business section
    businessName: String,
    businessType: String,
    businessDescription: String,
    businessAddress: String,
    businessPhone: String,
    businessWebsite: String
  },
  family: {
    familyMemberId1: Number,
    familyMemberId2: Number,
    familyMemberId3: Number,
    familyMemberId4: Number,
    familyMemberId5: Number
  },
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:** `userId` (unique).

---

## Conditional visibility

- **Matrimony section:** Show in UI only when `user_profiles.matrimony.matrimonyProfileActive === true`.
- **Business section:** Show only when `user_profiles.business.businessProfileActive === true`.
- Basic and Community sections are always visible; Personal and Family are always visible.

---

## Profile completion

Compute completion percentage from filled fields:

- **Basic (from users):** fullName, email, mobile, gender, dob, nativeDistrict, role.
- **Community, Personal, Family:** all fields in those objects.
- **Matrimony:** include only if `matrimonyProfileActive === true`.
- **Business:** include only if `businessProfileActive === true`.

`completion_percentage = 100 * (filled count) / (total considered fields)`.

---

## Horoscope document (R2)

- Client requests a presigned PUT URL from the backend (e.g. `POST /api/profile/me/horoscope-upload-url` with `fileName`, `fileType`, `fileSize`).
- Allowed types: `application/pdf`, `image/jpeg`, `image/png`; max size e.g. 10 MB.
- Backend returns `uploadUrl` (presigned PUT) and `publicUrl` (CDN URL).
- Client uploads the file to R2 with PUT, then updates profile: set `user_profiles.matrimony.horoscopeDocumentUrl = publicUrl`.

---

## API summary (aligned with Node.js implementation)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profile/me` | Full profile: basic + sections + completion_percentage + show_matrimony + show_business |
| PUT | `/api/profile/me` | Legacy: update profile_image, city, district, professional info |
| PATCH | `/api/profile/me/sections/:section` | Update one section: basic \| community \| personal \| matrimony \| business \| family |
| POST | `/api/profile/me/horoscope-upload-url` | Body: fileName, fileType, fileSize → returns uploadUrl, publicUrl |
| GET | `/api/profile/stats` | Community stats (posts, jobs, etc.) |
| GET | `/api/profile/activity` | Activity list (my / saved / liked) |

All profile endpoints require JWT and (for full access) admin-approved user (`status === "APPROVED"`).
