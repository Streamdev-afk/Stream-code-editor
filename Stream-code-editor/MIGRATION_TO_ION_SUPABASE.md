# Moving Stream to the ION Supabase project

Done for you (already applied to the ION project):
- Tables: sessions, session_messages, session_files, subscriptions, github_tokens
- Row Level Security: users only see their own sessions; subscriptions are read-only for users (only the server writes after a payment); github_tokens has no public access at all.

You do (about 10 minutes):
1. Supabase dashboard (ION project) > Project Settings > API Keys: copy the URL, the anon/publishable key and the service_role key.
2. Vercel (frontend) env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY. Redeploy.
3. Render (backend) env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (secret!), GITHUB_TOKEN_ENCRYPTION_KEY, plus your existing GROQ / OPENROUTER / PAYSTACK / FRONTEND_URL values. Redeploy.
4. Supabase > Authentication > URL Configuration: add your Stream site URL (Vercel link or custom domain) to Site URL / Redirect URLs.
5. Supabase > Authentication > Providers: enable GitHub and Google again in THIS project (new Client ID and Secret; set their callback URL to the one Supabase shows).
6. Paystack dashboard: keep the webhook URL pointing at your Render backend (/api/paystack/webhook).

Notes:
- The old project's users and saved sessions are not moved. The shutdown project must be restored first to export them. New sign-ins work right away.
- Old GitHub tokens were encrypted with the old key. Users reconnect GitHub once.
- ION users and Stream users are now the same accounts (auth.users).
