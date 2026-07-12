# Tachyel CRM

WhatsApp CRM by **Tachyel Technologies Private Limited** — a
multi-tenant CRM sold to business clients. Each client signs up, gets
an isolated account, connects their own WhatsApp Business number, and
runs their customer conversations, pipeline, and campaigns from here.

## What's inside

- **Shared inbox** on the official WhatsApp Business API — multiple
  agents on one number, per-conversation assignment, status, notes.
- **Contacts** with tags and custom fields, CSV import, deduplication.
- **Sales pipelines** (Kanban) with deals in INR, linked to conversations.
- **Broadcasts** with Meta-approved templates and per-recipient
  delivery/read tracking.
- **No-code automations** and a visual flow builder — triggers on
  inbound messages, new contacts, keywords, or schedule.
- **AI reply assistant** — each account brings its own OpenAI or
  Anthropic key (stored AES-256-GCM encrypted), with an optional
  knowledge base for grounded answers.
- **Team accounts** — invite by link, roles (owner / admin / agent /
  viewer), ownership transfer.
- **Public REST API** (`/api/v1`) with scoped keys (`tachyel_live_…`)
  and signed webhooks (`X-Tachyel-Signature`) — see
  [docs/public-api.md](./docs/public-api.md).
- **MCP server** for driving the CRM from AI assistants — see
  [docs/mcp.md](./docs/mcp.md).

## How multi-tenancy works

Every signup auto-creates an account. All data tables are
`account_id`-scoped with Postgres Row-Level Security enforcing
isolation. Each account stores its own WhatsApp credentials; one
shared webhook receives all inbound traffic and routes it by
`phone_number_id` to the right tenant. Clients' WABAs carry their own
Meta payment method — Meta bills them for messages directly.

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Realtime + Storage + RLS).
  The data layer depends on Supabase specifically — do not swap it
  for another database without budgeting a full rewrite.
- **WhatsApp** — Meta Cloud API under a single Tachyel-owned Meta app.

## Local development

```bash
git clone https://github.com/Rohanx04/Tachyel-wacrm.git
cd Tachyel-wacrm
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

Open <http://localhost:3000>. Checks before pushing:

```bash
npm run typecheck && npm run lint && npm run test
```

## Production deployment

1. **Supabase** — create a project, run every file in
   `supabase/migrations/` in order. Use the **Pro plan** in
   production: the free tier pauses idle projects, and a paused
   database silently drops clients' inbound WhatsApp webhooks.
2. **Meta app** — one app owned by Tachyel. Set the webhook callback
   to `https://<our-domain>/api/whatsapp/webhook` and subscribe to
   `messages` + `message_template_status_update`.
3. **Hosting** — Hostinger managed Node.js (or any Node 20+ host).
   Connect this repo, push to `main`, set the env vars below in the
   panel.
4. **Env vars** (see [.env.local.example](./.env.local.example) for
   full docs):

   | Variable | Required | Purpose |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase project |
   | `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side webhook/API auth paths |
   | `ENCRYPTION_KEY` | yes | AES-256-GCM for stored tokens. Back it up; rotating orphans every stored WhatsApp/AI token |
   | `META_APP_SECRET` | yes | Verifies inbound webhook signatures |
   | `NEXT_PUBLIC_SITE_URL` | yes in prod | Canonical URL; invite links fail loudly without a derivable origin |
   | `ALLOWED_INVITE_HOSTS` | recommended | Host-header allow-list for invite links |
   | `AUTOMATION_CRON_SECRET` | if using Wait steps | Protects `GET /api/automations/cron`; point a scheduler at it |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | for outbound email | SMTP relay for registration/auth emails and emailed invites — see [docs/email.md](./docs/email.md) |
   | `SEND_EMAIL_HOOK_SECRET` | with the Send Email hook | Verifies Supabase Auth hook calls to `/api/auth/send-email` |

5. **After two stable deploys** — flip the CSP header in
   `next.config.ts` from `Content-Security-Policy-Report-Only` to
   enforcing.

## Onboarding a client (Model 1)

1. Create/verify the client's Meta Business Manager; link their WABA
   and phone number under the Tachyel Meta app.
2. Generate a permanent System User token scoped to their WABA.
3. Client signs up in the CRM; paste `phone_number_id` + token in
   Settings → WhatsApp.
4. Send a test message to confirm webhook delivery, then walk them
   through template approval and the broadcast opt-in policy.

Full plan, costing, and roadmap live in the internal deployment-plan
document.

## License & attribution

[MIT](./LICENSE). Based on the open-source
[wacrm](https://github.com/ArnasDon/wacrm) template by Arnas
Donauskas; the original license and copyright notice are retained in
[LICENSE](./LICENSE).
