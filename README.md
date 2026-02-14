# Uptimer

Uptimer is a Cloudflare-native uptime monitoring + status page project:

- Backend: Cloudflare Workers (Hono + Zod)
- Frontend: Cloudflare Pages (React + Vite + Tailwind)
- Database: Cloudflare D1 (SQLite)

## Settings (Plan.md Phase 12)

Non-sensitive configuration is stored in D1 `settings`.

- Admin API: `GET/PATCH /api/v1/admin/settings`
- UI: Admin Dashboard → `Settings` tab (includes **Uptime Color Rating**)

Typical settings:

- `site_title` / `site_description` / `site_timezone`
- `retention_check_results_days` (daily cleanup)
- `state_failures_to_down_from_up` / `state_successes_to_up_from_down`
- `admin_default_overview_range` / `admin_default_monitor_range`
- `uptime_rating_level`

## Local development

One-command local bootstrap + start:

```bash
pnpm dev
```

See `LOCAL-TESTING.md` for full workflow.
