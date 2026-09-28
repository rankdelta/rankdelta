# Supabase URL setup (self-host or your own cloud project)

When the SPA is on Vercel (or any host), Supabase Auth must allow that origin.

1. In the **Supabase dashboard** for *your* project: Authentication → URL Configuration.
2. **Site URL** = your app origin (e.g. `https://your-domain.com` or `http://localhost:5173`).
3. **Redirect URLs** (one per line):

```
https://your-domain.com/auth/callback
https://your-domain.com/**
http://localhost:5173/auth/callback
http://localhost:5173/**
```

Google OAuth: the authorized redirect in Google Cloud Console is:

```
https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
```

Never commit a real project ref or a production Vercel URL into this repo.
