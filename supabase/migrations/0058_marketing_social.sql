-- ============================================================================
-- 0058 · Marketing foundations: social accounts, posts, unified inbox
--
-- Phase 0 of the Marketing expansion (Google Business, Instagram/Facebook,
-- TikTok, and one inbox for every customer message). Schema only — the
-- providers arrive in later phases.
--
--   org_profile          address / phone / hours / website for the venue
--                        (Google Business Profile needs them structured)
--   social_accounts      one row per connected external account. Holds NO
--                        secrets; safe to select from the browser.
--   social_credentials   the OAuth tokens (encrypted by the app). RLS on, NO
--                        policies and revoked from anon/authenticated → only the
--                        service-role key can read it. Stronger than
--                        channels.credentials, which relies on the client
--                        never selecting the column.
--   outbound_posts         a piece of content, plus one outbound_post_targets row
--                        per account it goes to (status, permalink, retries)
--   conversations        one thread per customer per channel: Messenger,
--   messages             Instagram, SMS, email, website chat, Google reviews
--   quick_replies        canned answers
--
-- NOTE: the publishing queue is called outbound_posts / outbound_post_targets on
-- purpose. 0057 already owns social_posts (the manual content calendar) and
-- social_targets (weekly posting goals); this is a different table.
--
-- Provider / channel / status columns are text + CHECK, not enums, so adding a
-- value never hits the "new enum value can't be used in the same transaction"
-- problem (see 0043).
--
-- Also: managers get the Marketing module by default (default_modules_for_role
-- + a backfill for members who already have explicit per-module rows, the 0037
-- pattern), and has_module_access() lets RLS enforce the module gate for
-- tables that hold customer PII — the client-side RequireModule alone is not a
-- boundary.
-- ============================================================================

-- ---- 1. Module gate usable from RLS ----------------------------------------
-- Mirrors useOrg.tsx: owner/admin always; otherwise the member's explicit rows;
-- otherwise (no rows at all) the role default.
create or replace function public.has_module_access(_org uuid, _module text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members om
    where om.org_id = _org and om.user_id = auth.uid()
      and (
        om.role::text in ('owner','admin')
        or exists (
          select 1 from public.member_module_access ma
          where ma.org_id = om.org_id and ma.user_id = om.user_id
            and ma.module_id = _module and ma.can_access
        )
        or (
          not exists (
            select 1 from public.member_module_access ma2
            where ma2.org_id = om.org_id and ma2.user_id = om.user_id
          )
          and _module = any(public.default_modules_for_role(om.role))
        )
      )
  )
$$;

-- ---- 2. Managers get Marketing by default ----------------------------------
-- Same function as 0056 with 'marketing' added for manager.
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till','dailytasks','marketing']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks','dailytasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

-- Existing managers who already have explicit per-module rows (a lone row would
-- otherwise flip a member into explicit mode and hide their other modules).
insert into public.member_module_access (org_id, user_id, module_id, can_access)
select distinct om.org_id, om.user_id, 'marketing', true
from public.org_members om
where om.role::text = 'manager'
  and exists (
    select 1 from public.member_module_access ma
    where ma.org_id = om.org_id and ma.user_id = om.user_id
  )
on conflict (org_id, user_id, module_id) do nothing;

-- ---- 3. Venue profile ------------------------------------------------------
create table if not exists public.org_profile (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  description text,
  phone text,
  website text,
  address_line text,
  postal_code text,
  city text,
  country text not null default 'DE',
  google_place_id text,
  categories text[] not null default '{}',
  -- {"mon":[{"open":"11:00","close":"22:00"}], ..., "sun":[]}; empty day = closed
  hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- address / phone used to live as loose keys in orgs.settings.
insert into public.org_profile (org_id, phone, address_line)
select o.id, nullif(o.settings->>'phone', ''), nullif(o.settings->>'address', '')
from public.orgs o
on conflict (org_id) do nothing;

-- ---- 4. Connected social accounts ------------------------------------------
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null
    check (provider in ('google_business','facebook','instagram','tiktok','tiktok_shop','meta_catalog')),
  -- The platform's id for the asset: IG user id, FB page id, GBP location name…
  external_id text not null,
  display_name text not null default '',
  handle text,
  avatar_url text,
  scopes text[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  -- Set by the server when the refresh token dies; the UI shows "Reconnect".
  needs_reauth boolean not null default false,
  token_expires_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (org_id, provider, external_id)
);

create table if not exists public.social_credentials (
  account_id uuid primary key references public.social_accounts(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- AES-256-GCM blobs written by src/lib/social/crypto.ts, never plaintext.
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.social_credentials enable row level security;
revoke all on table public.social_credentials from anon, authenticated;

-- ---- 5. Posts + per-account publish state ----------------------------------
create table if not exists public.outbound_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  caption text not null default '',
  -- [{"url": "...", "type": "image"|"video", "w": 1080, "h": 1350}]
  media jsonb not null default '[]'::jsonb,
  recipe_id uuid references public.recipes(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','publishing','published','partial','failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  ai_generated boolean not null default false,
  utm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists outbound_posts_org_status_idx on public.outbound_posts (org_id, status, scheduled_at);

create table if not exists public.outbound_post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.outbound_posts(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  provider text not null,
  status text not null default 'pending'
    check (status in ('pending','publishing','published','failed','skipped')),
  external_id text,
  permalink text,
  -- Persisted BEFORE the final publish call so a retry resumes instead of
  -- double-posting (Instagram container id / TikTok publish id).
  container_id text,
  publish_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  error text,
  metrics jsonb not null default '{}'::jsonb,
  metrics_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, account_id)
);
create index if not exists outbound_post_targets_due_idx
  on public.outbound_post_targets (status, next_attempt_at)
  where status in ('pending','publishing');

-- Atomically hand due targets to ONE cron run. `skip locked` means two
-- overlapping runs never receive the same row. A target stuck in 'publishing'
-- (crashed worker) is reclaimed after 10 minutes and resumes from its
-- container_id/publish_id. Service-role only.
create or replace function public.claim_due_outbound_targets(_limit integer default 10)
returns setof public.outbound_post_targets
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select t.id
    from public.outbound_post_targets t
    join public.outbound_posts p on p.id = t.post_id
    where p.status in ('scheduled','publishing')
      and (
        (t.status = 'pending'
          and coalesce(t.next_attempt_at, p.scheduled_at, now()) <= now())
        or (t.status = 'publishing' and t.updated_at < now() - interval '10 minutes')
      )
    order by coalesce(t.next_attempt_at, p.scheduled_at, t.created_at)
    limit _limit
    for update of t skip locked
  )
  update public.outbound_post_targets t
     set status = 'publishing', attempts = t.attempts + 1, updated_at = now()
    from due
   where t.id = due.id
  returning t.*;
end $$;
revoke all on function public.claim_due_outbound_targets(integer) from public, anon, authenticated;

-- ---- 6. Unified inbox ------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  channel text not null
    check (channel in ('facebook','instagram','whatsapp','sms','email','webchat','google_review')),
  kind text not null default 'message' check (kind in ('message','comment','review')),
  account_id uuid references public.social_accounts(id) on delete set null,
  -- Platform thread id (PSID, phone number, email Message-ID root, chat token…).
  external_thread_id text not null,
  -- {"name","handle","email","phone","avatar"}
  contact jsonb not null default '{}'::jsonb,
  customer_id uuid references public.customers(id) on delete set null,
  rating smallint check (rating between 1 and 5),
  subject text,
  status text not null default 'open' check (status in ('open','pending','closed')),
  assignee_id uuid references auth.users(id) on delete set null,
  unread_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, channel, external_thread_id)
);
create index if not exists conversations_org_status_idx
  on public.conversations (org_id, status, last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  -- Platform message id: makes webhook redelivery idempotent. NULL for an
  -- outbound message not yet accepted by the platform (NULLs never collide).
  external_id text,
  status text not null default 'received'
    check (status in ('received','queued','sent','delivered','read','failed')),
  error text,
  sent_by uuid references auth.users(id),
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- Keep the thread header honest without every webhook having to remember to:
-- bump last_message_at, count unread inbound, reopen a closed thread.
create or replace function public.bump_conversation_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations c set
    last_message_at = new.created_at,
    last_inbound_at = case when new.direction = 'in' then new.created_at else c.last_inbound_at end,
    unread_count = c.unread_count + case when new.direction = 'in' then 1 else 0 end,
    status = case when new.direction = 'in' and c.status = 'closed' then 'open' else c.status end,
    updated_at = now()
  where c.id = new.conversation_id;
  return new;
end $$;

drop trigger if exists bump_conversation_on_message on public.messages;
create trigger bump_conversation_on_message
  after insert on public.messages
  for each row execute function public.bump_conversation_on_message();

create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  body text not null,
  -- Empty = offered on every channel.
  channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- 7. Triggers -----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['org_profile','social_accounts','outbound_posts','outbound_post_targets','conversations'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['social_accounts','outbound_posts','quick_replies'] loop
    execute format('drop trigger if exists set_created_by on public.%I', t);
    execute format('create trigger set_created_by before insert on public.%I for each row execute function public.set_created_by()', t);
  end loop;
end $$;

-- ---- 8. RLS ----------------------------------------------------------------
-- Customer messages and reviews are PII → gated by the Marketing module in the
-- database, not just in the UI. Server code (webhooks, cron, sending) uses the
-- service-role key and so never depends on these policies.
alter table public.org_profile enable row level security;
alter table public.social_accounts enable row level security;
alter table public.outbound_posts enable row level security;
alter table public.outbound_post_targets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.quick_replies enable row level security;

-- org_profile: any member reads (it is the venue's public details); managers edit.
drop policy if exists org_profile_member_select on public.org_profile;
create policy org_profile_member_select on public.org_profile for select
  using (is_org_member(org_id));
drop policy if exists org_profile_editor_insert on public.org_profile;
create policy org_profile_editor_insert on public.org_profile for insert
  with check (has_org_role(org_id,'owner','admin','partner','manager'));
drop policy if exists org_profile_editor_update on public.org_profile;
create policy org_profile_editor_update on public.org_profile for update
  using (has_org_role(org_id,'owner','admin','partner','manager'));

-- social_accounts: marketing users see them; only owner/admin connect/change.
drop policy if exists social_accounts_select on public.social_accounts;
create policy social_accounts_select on public.social_accounts for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists social_accounts_admin_insert on public.social_accounts;
create policy social_accounts_admin_insert on public.social_accounts for insert
  with check (has_org_role(org_id,'owner','admin'));
drop policy if exists social_accounts_admin_update on public.social_accounts;
create policy social_accounts_admin_update on public.social_accounts for update
  using (has_org_role(org_id,'owner','admin'));
drop policy if exists social_accounts_admin_delete on public.social_accounts;
create policy social_accounts_admin_delete on public.social_accounts for delete
  using (has_org_role(org_id,'owner','admin'));

-- outbound_posts / targets: marketing users read; owner/admin/partner/manager write.
do $$
declare t text;
begin
  foreach t in array array['outbound_posts','outbound_post_targets'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select using (has_module_access(org_id, ''marketing''))', t, t);
    execute format('drop policy if exists %I_editor_insert on public.%I', t, t);
    execute format('create policy %I_editor_insert on public.%I for insert with check (has_module_access(org_id, ''marketing'') and has_org_role(org_id,''owner'',''admin'',''partner'',''manager''))', t, t);
    execute format('drop policy if exists %I_editor_update on public.%I', t, t);
    execute format('create policy %I_editor_update on public.%I for update using (has_module_access(org_id, ''marketing'') and has_org_role(org_id,''owner'',''admin'',''partner'',''manager''))', t, t);
    execute format('drop policy if exists %I_editor_delete on public.%I', t, t);
    execute format('create policy %I_editor_delete on public.%I for delete using (has_module_access(org_id, ''marketing'') and has_org_role(org_id,''owner'',''admin'',''partner'',''manager''))', t, t);
  end loop;
end $$;

-- conversations: marketing users read and triage (assign, close, mark read).
-- Rows are created by webhooks and the send route, never by the browser.
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update
  using (has_module_access(org_id, 'marketing'));
drop policy if exists conversations_admin_delete on public.conversations;
create policy conversations_admin_delete on public.conversations for delete
  using (has_org_role(org_id,'owner','admin'));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists messages_admin_delete on public.messages;
create policy messages_admin_delete on public.messages for delete
  using (has_org_role(org_id,'owner','admin'));

-- quick_replies: anyone with Marketing manages the canned answers.
drop policy if exists quick_replies_select on public.quick_replies;
create policy quick_replies_select on public.quick_replies for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists quick_replies_insert on public.quick_replies;
create policy quick_replies_insert on public.quick_replies for insert
  with check (has_module_access(org_id, 'marketing'));
drop policy if exists quick_replies_update on public.quick_replies;
create policy quick_replies_update on public.quick_replies for update
  using (has_module_access(org_id, 'marketing'));
drop policy if exists quick_replies_delete on public.quick_replies;
create policy quick_replies_delete on public.quick_replies for delete
  using (has_module_access(org_id, 'marketing'));

-- ---- 9. Realtime (live inbox + publish status) -----------------------------
do $$ begin alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.outbound_post_targets;
exception when duplicate_object then null; end $$;
