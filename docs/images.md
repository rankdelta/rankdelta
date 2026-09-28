# Images (Wikimedia first, optional Pexels/Unsplash)

Featured images prefer **Wikimedia Commons CC0**. Pexels/Unsplash are optional fallbacks.

Those keys are **edge-function secrets**, never `VITE_*` (Vite would ship them in the browser bundle).

```bash
supabase secrets set PEXELS_API_KEY=... UNSPLASH_ACCESS_KEY=...
```

If the secrets are unset, stock fallbacks are skipped and Wikimedia/placeholders still work.

Do not paste real API tokens into this file or into git.
