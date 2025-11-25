# CLAUDE.md - AI Assistant Guide for JobBot Norway

This file contains critical information for AI assistants working on this codebase.

## Project Overview

JobBot Norway is a job search automation platform built with:
- **Frontend**: React 19, TypeScript, Vite, TailwindCSS
- **Backend**: Supabase (PostgreSQL, Auth, Realtime)
- **Deployment**: Netlify

## CRITICAL: Supabase JS Client Issue

### Problem
The `@supabase/supabase-js` client **hangs indefinitely** on certain operations in production:
- `supabase.auth.getSession()` - hangs
- `supabase.auth.signInWithPassword()` - hangs
- `supabase.from('table').select()` - works but is very slow (~1-1.5 seconds)

### Root Cause
Unknown. Direct `fetch()` to the same Supabase endpoints works fine (~400-600ms).
The issue appears to be in the Supabase JS client initialization or promise handling.

### Solution Implemented
All authentication operations bypass the Supabase JS client and use direct `fetch()`:

1. **Login** (`pages/LoginPage.tsx`):
   - Uses direct `fetch()` to `/auth/v1/token?grant_type=password`
   - Stores session in localStorage manually

2. **Session Check** (`contexts/AuthContext.tsx`):
   - Reads session directly from localStorage
   - Does NOT call `supabase.auth.getSession()`
   - Uses direct `fetch()` for `fetchUserRole()`

3. **Sign Out** (`contexts/AuthContext.tsx`):
   - Does NOT call `supabase.auth.signOut()`
   - Simply clears localStorage and React state

### Important Constants
```typescript
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const STORAGE_KEY = 'sb-ptrmidlhfdbybxmyovtm-auth-token';
```

## Key Files

### Authentication
- `contexts/AuthContext.tsx` - Auth state management (uses direct fetch)
- `pages/LoginPage.tsx` - Login form (uses direct fetch)
- `services/supabase.ts` - Supabase client (still exported but avoid using for auth)

### Components
- `components/Sidebar.tsx` - Navigation with logout button
- `App.tsx` - Main app with AuthProvider

### Pages
- `pages/DashboardPage.tsx` - Main dashboard
- `pages/JobsPage.tsx` - Job listings
- `pages/SettingsPage.tsx` - User settings

## Auth Flow

```
1. User visits site
2. AuthContext checks localStorage for session
3. If valid session found:
   - Fetch user role via direct fetch
   - Show Dashboard
4. If no session:
   - Show LoginPage
5. On login:
   - Direct fetch to /auth/v1/token
   - Store response in localStorage
   - Reload page
6. On logout:
   - Clear localStorage
   - Clear React state
   - Show LoginPage
```

## Database Tables

- `jobs` - Job listings from FINN/NAV
- `user_settings` - User preferences and roles
- `activity_log` - User activity tracking
- `applications` - Job applications

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Deployment

- **Platform**: Netlify
- **Build command**: `npm ci && npm run build`
- **Publish directory**: `dist`
- **Branch**: Develop on feature branches, merge to main

## Debugging

### Console Logging
The codebase includes debug logging with prefixes:
- `[Supabase]` - Supabase client operations
- `[Auth]` - Authentication flow
- `[Login]` - Login operations

### Common Issues

1. **"Loading your workspace..." stuck forever**
   - Cause: Supabase client hanging
   - Fix: Ensure auth uses direct fetch, not Supabase client

2. **Logout not working**
   - Cause: `supabase.auth.signOut()` hanging
   - Fix: Use direct localStorage clear

3. **Data not loading**
   - The Supabase client for data queries is slow but works
   - Consider implementing direct fetch for data too if issues persist

## Recent Changes (2025-11-25)

1. Added direct fetch bypass for all auth operations
2. Removed dependency on `supabase.auth.onAuthStateChange()`
3. Increased reliability of login/logout flow
4. Added comprehensive debug logging

## TODO

- [ ] Consider replacing all Supabase client calls with direct fetch
- [ ] Remove debug tests from `services/supabase.ts` in production
- [ ] Implement token refresh mechanism
- [ ] Fix recharts width/height warnings
