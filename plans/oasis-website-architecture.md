# Oasis of Hope Website - System Architecture

## Overview
The Oasis of Hope website is a multi-page web application with authentication, user roles, community features, and admin moderation capabilities. It uses Supabase as its backend-as-a-service platform.

---

## 1. File Structure & Page Relationships

```mermaid
flowchart TB
    subgraph Public_Pages["Public Pages"]
        index["index.html<br/>Home Page"]
        programs["programs.html<br/>Programs"]
        team["team.html<br/>Team/About"]
        updates["updates.html<br/>News & Updates"]
        contact["contact.html<br/>Contact"]
        getinvolved["get-involved.html<br/>Get Involved"]
    end

    subgraph User_Pages["User Pages (Auth Required)"]
        login["login.html<br/>Login"]
        signup["signup.html<br/>Sign Up"]
        profile["profile.html<br/>User Profile"]
        notifications["notifications.html<br/>Notifications"]
    end

    subgraph Admin_Pages["Admin Pages (Admin Role)"]
        admindash["admin/dashboard.html<br/>Dashboard"]
        adminmod["admin/moderation.html<br/>Moderation"]
        adminqueue["admin/moderation-queue.html<br/>Queue"]
        admincontent["admin/content-control.html<br/>Content Control"]
        adminsignup["admin/signup.html<br/>Admin Signup"]
    end

    subgraph Assets["Assets"]
        js["assets/js/"]
        css["assets/css/"]
        images["assets/images/"]
    end

    index --> programs
    index --> team
    index --> updates
    index --> contact
    index --> getinvolved
    index --> login
    index --> signup

    login --> profile
    signup --> profile
    profile --> notifications
    profile --> updates

    admindash --> adminmod
    admindash --> adminqueue
    admindash --> admincontent
```

---

## 2. Database Schema & Relationships

### Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User accounts & roles | id, username, email, role, status, avatar_url |
| `activities` | Community posts | id, author_id, text, media_url, media_type, tag, likes_count |

```mermaid
erDiagram
    PROFILES ||--o{ ACTIVITIES : "authored by"

    PROFILES {
        uuid id PK
        string username UK
        string full_name
        string email UK
        string bio
        string role "community|admin|volunteer"
        string status "pending|approved|rejected"
        string avatar_url
        timestamp created_at
    }

    ACTIVITIES {
        bigint id PK
        uuid author_id FK
        string text
        string media_url
        string media_type "none|image|video"
        string tag
        integer likes_count
        timestamp created_at
    }
```

---

## 3. JavaScript Module Dependencies

```mermaid
flowchart LR
    subgraph Initialization
        config["config.js<br/>Supabase Config"]
        supabase["supabase.js<br/>RemoteDB Client"]
        auth["auth.js<br/>Auth Module"]
        community["community.js<br/>Community Features"]
    end

    config --> supabase
    supabase --> auth
    supabase --> community

    style config fill:#e1f5fe
    style supabase fill:#e1f5fe
    style auth fill:#fff3e0
    style community fill:#e8f5e9
```

### Module Responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| Configuration | [`assets/js/config.js`](assets/js/config.js) | Stores Supabase URL and API key |
| Database Client | [`assets/js/supabase.js`](assets/js/supabase.js) | Initializes Supabase client, provides CRUD methods |
| Authentication | [`assets/js/auth.js`](assets/js/auth.js) | Login, register, logout, session management |
| Community | [`assets/js/community.js`](assets/js/community.js) | Post composer, feed rendering, media handling |

---

## 4. Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant Supabase
    participant Database

    User->>Browser: Enter credentials
    Browser->>Supabase: signInWithPassword()
    Supabase->>Database: Verify credentials
    Database-->>Supabase: User data
    Supabase-->>Browser: Session token
    Browser->>Database: Load profile (profiles table)
    Database-->>Browser: Profile (role, status)
    Browser->>Browser: Update UI based on role
```

### Login Options
1. **Email + Password**: Direct login
2. **Username + Password**: Looks up email from profiles table, then authenticates

### Registration Roles
- Default: `role = 'community'`, `status = 'pending'`
- Admin: Use secret key `OASIS_ADMIN_2026` → `role = 'admin'`, `status = 'approved'`

---

## 5. User Role & Permission System

```mermaid
flowchart TB
    subgraph Roles["User Roles"]
        admin["Admin<br/>role: 'admin'"]
        volunteer["Volunteer<br/>role: 'volunteer'"]
        community["Community<br/>role: 'community'"]
    end

    subgraph Status["Account Status"]
        approved["Approved<br/>Can post"]
        pending["Pending<br/>Cannot post"]
        rejected["Rejected<br/>No access"]
    end

    subgraph Permissions
        view["View all pages"]
        post["Create posts"]
        mod["Moderate users"]
        admin_func["Admin functions"]
    end

    admin --> approved
    admin --> mod
    admin --> admin_func

    volunteer --> approved
    volunteer --> post

    community --> approved
    community --> post
    community --> pending
    community --> rejected
```

### Role Permissions

| Role | View Content | Create Posts | Moderate Users | Access Admin |
|------|--------------|--------------|----------------|--------------|
| Admin | ✓ | ✓ | ✓ | ✓ |
| Volunteer | ✓ | ✓ (if approved) | ✗ | ✗ |
| Community | ✓ | ✓ (if approved) | ✗ | ✗ |

### Account Status Flow
```
New User Registers → Status: 'pending' → Admin approves → Status: 'approved' → Can post
                                                        → Admin rejects → Status: 'rejected' → Cannot post
```

---

## 6. Page Navigation & Access Control

### Public Pages (No Auth Required)
- [`index.html`](index.html) - Home
- [`programs.html`](programs.html) - Programs
- [`team.html`](team.html) - Team/About
- [`updates.html`](updates.html) - News & Stories
- [`contact.html`](contact.html) - Contact
- [`get-involved.html`](get-involved.html) - Get Involved

### User Pages (Login Required)
- [`login.html`](login.html) - Login
- [`signup.html`](signup.html) - Sign Up
- [`profile.html`](profile.html) - User Profile (edit)
- [`notifications.html`](notifications.html) - Notifications

### Admin Pages (Admin Role Required)
- [`admin/dashboard.html`](admin/dashboard.html) - Admin Dashboard
- [`admin/moderation.html`](admin/moderation.html) - User Moderation
- [`admin/moderation-queue.html`](admin/moderation-queue.html) - Approval Queue
- [`admin/content-control.html`](admin/content-control.html) - Content Management
- [`admin/signup.html`](admin/signup.html) - Admin Registration

---

## 7. Community Post Flow

```mermaid
flowchart LR
    subgraph Creation["Post Creation"]
        compose["Compose Post<br/>community.js"]
        media["Add Media<br/>images/videos"]
        submit["Submit"]
    end

    subgraph Validation["Validation"]
        check_auth["Auth Check"]
        check_status["Status Check<br/>approved?"]
    end

    subgraph Storage["Storage"]
        upload["Upload to<br/>Supabase Storage"]
        db["Save to<br/>activities table"]
    end

    subgraph Feed["Feed Display"]
        load["Load Posts"]
        render["Render Feed"]
    end

    compose --> media --> submit --> check_auth --> check_status
    check_status -->|Yes| upload --> db --> load --> render
    check_status -->|No| error["Show Error:<br/>Account must be<br/>approved"]
```

---

## 8. Supabase Security (Row Level Security)

### Profile Policies
| Operation | Condition |
|-----------|-----------|
| SELECT | Everyone can view |
| INSERT | Users can insert own profile |
| UPDATE | Users can update own (except role/status) |
| ALL (Admin) | Admins have full access |

### Activity Policies
| Operation | Condition |
|-----------|-----------|
| SELECT | Everyone can view |
| INSERT | Only approved users or admins |
| DELETE | Only post author |

---

## 9. Media Upload System

```mermaid
flowchart TB
    subgraph Upload_Process
        select["Select Media<br/>Image/Video"]
        preview["Preview thumbnails"]
        upload[".upload() to<br/>community-media bucket"]
        geturl["Get public URL"]
        save["Store URL in<br/>activities.media_url"]
    end

    subgraph Storage_Bucket
        bucket["Bucket: community-media<br/>Public: ON"]
    end

    select --> preview --> upload --> bucket --> geturl --> save
```

---

## 10. Key Data Relationships Summary

| Feature | Data Source | Key Tables | Flow |
|---------|-------------|------------|------|
| User Authentication | Supabase Auth | `auth.users` | Login → Session → Profile |
| User Profile | profiles table | `profiles` | Auto-created on signup |
| Community Posts | activities table | `profiles` → `activities` | Join on author_id |
| Role Management | profiles.role | `profiles` | Controls UI & permissions |
| Moderation | profiles.status | `profiles` | Pending → Approved/Rejected |
| Media Storage | Supabase Storage | `community-media` bucket | Upload → URL → DB |

---

## 11. Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5, Tailwind CSS, Vanilla JavaScript |
| Backend | Supabase (PostgreSQL + Auth + Storage) |
| External APIs | Google Fonts, Material Symbols |
| Hosting | Static files (any static host) |

---

## 12. Configuration

The Supabase connection is configured in [`assets/js/config.js`](assets/js/config.js):

```javascript
window.SUPABASE_CONFIG = {
    url: 'https://gdweuicswzgncxqfgbxy.supabase.co',
    key: 'sb_publishable_uq9jcG75OH5ywv4yVE9bUg_Jgg5Yh2G'
};
```

---

## Summary

The Oasis of Hope website is a **multi-tenant community platform** with:

1. **Three user roles**: Admin, Volunteer, Community
2. **Two-step approval**: Users register → pending → admin approves → can post
3. **Centralized authentication**: Supabase Auth handles all sessions
4. **Database-backed profiles**: Extended user data stored in `profiles` table
5. **Community feed**: Posts with media, linked to authors via foreign keys
6. **Admin moderation**: Full control over users and content
7. **Media storage**: Supabase Storage bucket for images/videos
