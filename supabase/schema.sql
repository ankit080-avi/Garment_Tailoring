-- KarkhanaPro — Postgres schema + RLS
-- Lives in its own Postgres schema `karkhana` so it can co-exist with
-- MilkMate (or any other app) in the same Supabase project without
-- any table-name collisions.
--
-- One-time Supabase dashboard step AFTER running this:
--   Settings → API → "Exposed schemas" → add "karkhana"
-- (otherwise the supabase-js client can't see these tables)
--
-- Roles: 'admin' (Bada Seth), 'contractor' (Chhota Seth), 'worker' (Darzi).

-- ============================================================
-- 0. Schema container
-- ============================================================
create schema if not exists karkhana;

-- ============================================================
-- 1. Tables
-- ============================================================

create table if not exists karkhana.shops (
  id            text primary key,
  name          text not null,
  owner_user_id text not null,
  address       text,
  phone         text,
  upi_id        text,
  upi_name      text,
  created_at    timestamptz not null default now()
);

create table if not exists karkhana.users (
  id              text primary key,
  shop_id         text references karkhana.shops(id) on delete cascade,
  mobile          text not null,
  name            text not null,
  role            text not null check (role in ('admin','contractor','worker')),
  password_hash   text,
  parent_user_id  text references karkhana.users(id) on delete set null,
  photo           text,
  status          text default 'active' check (status in ('active','disabled','pending')),
  created_at      timestamptz not null default now(),
  unique (shop_id, mobile)
);

create table if not exists karkhana.designs (
  id           text primary key,
  shop_id      text not null references karkhana.shops(id) on delete cascade,
  name         text not null,
  sku          text,
  photo        text,
  default_rate numeric(10,2) default 0,
  active       boolean default true,
  created_at   timestamptz not null default now()
);

create table if not exists karkhana.piece_types (
  id           text primary key,
  shop_id      text not null references karkhana.shops(id) on delete cascade,
  design_id    text not null references karkhana.designs(id) on delete cascade,
  name         text not null,
  default_rate numeric(10,2) not null default 0,
  sort_order   int default 0
);

create table if not exists karkhana.orders (
  id          text primary key,
  shop_id     text not null references karkhana.shops(id) on delete cascade,
  design_id   text not null references karkhana.designs(id),
  total_qty   int not null check (total_qty > 0),
  deadline    date,
  notes       text,
  status      text default 'open' check (status in ('open','in_progress','completed','cancelled')),
  created_by  text references karkhana.users(id),
  created_at  timestamptz not null default now()
);

create table if not exists karkhana.lots (
  id             text primary key,
  shop_id        text not null references karkhana.shops(id) on delete cascade,
  order_id       text not null references karkhana.orders(id) on delete cascade,
  lot_no         int not null,
  qty            int not null check (qty > 0),
  contractor_id  text references karkhana.users(id),
  status         text default 'unassigned' check (status in ('unassigned','assigned','in_progress','completed')),
  assigned_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (order_id, lot_no)
);

create table if not exists karkhana.worker_assignments (
  id             text primary key,
  shop_id        text not null references karkhana.shops(id) on delete cascade,
  lot_id         text not null references karkhana.lots(id) on delete cascade,
  worker_id      text not null references karkhana.users(id),
  contractor_id  text not null references karkhana.users(id),
  piece_type_id  text not null references karkhana.piece_types(id),
  qty_assigned   int not null check (qty_assigned > 0),
  rate           numeric(10,2) not null,
  status         text default 'open' check (status in ('open','in_progress','completed','cancelled')),
  assigned_at    timestamptz not null default now()
);

create table if not exists karkhana.production_entries (
  id             text primary key,
  shop_id        text not null references karkhana.shops(id) on delete cascade,
  assignment_id  text not null references karkhana.worker_assignments(id) on delete cascade,
  worker_id      text not null references karkhana.users(id),
  contractor_id  text not null references karkhana.users(id),
  date           date not null default current_date,
  pieces_done    int not null check (pieces_done > 0),
  notes          text,
  photo          text,
  created_at     timestamptz not null default now()
);

create table if not exists karkhana.payments (
  id                    text primary key,
  shop_id               text not null references karkhana.shops(id) on delete cascade,
  payer_id              text not null references karkhana.users(id),
  payee_id              text not null references karkhana.users(id),
  amount                numeric(12,2) not null check (amount > 0),
  type                  text not null check (type in ('advance','settlement','bonus','adjustment')),
  method                text default 'cash' check (method in ('cash','upi','bank','other')),
  date                  date not null default current_date,
  note                  text,
  against_assignment_id text references karkhana.worker_assignments(id),
  against_lot_id        text references karkhana.lots(id),
  created_at            timestamptz not null default now()
);

create table if not exists karkhana.notifications (
  id        text primary key,
  shop_id   text not null references karkhana.shops(id) on delete cascade,
  user_id   text not null references karkhana.users(id) on delete cascade,
  type      text not null,
  title     text not null,
  body      text,
  date      timestamptz not null default now(),
  read      boolean default false
);

create table if not exists karkhana.holidays (
  id      text primary key,
  shop_id text not null references karkhana.shops(id) on delete cascade,
  date    date not null,
  label   text
);

-- ============================================================
-- 2. Indexes
-- ============================================================
create index if not exists kk_users_shop_idx       on karkhana.users(shop_id);
create index if not exists kk_users_parent_idx     on karkhana.users(parent_user_id);
create index if not exists kk_orders_shop_idx      on karkhana.orders(shop_id);
create index if not exists kk_lots_order_idx       on karkhana.lots(order_id);
create index if not exists kk_lots_contractor_idx  on karkhana.lots(contractor_id);
create index if not exists kk_assign_lot_idx       on karkhana.worker_assignments(lot_id);
create index if not exists kk_assign_worker_idx    on karkhana.worker_assignments(worker_id);
create index if not exists kk_assign_contr_idx     on karkhana.worker_assignments(contractor_id);
create index if not exists kk_prod_assign_idx      on karkhana.production_entries(assignment_id);
create index if not exists kk_prod_worker_date_idx on karkhana.production_entries(worker_id, date);
create index if not exists kk_pay_payee_idx        on karkhana.payments(payee_id);
create index if not exists kk_pay_payer_idx        on karkhana.payments(payer_id);

-- ============================================================
-- 3. Helper functions for RLS (live inside karkhana schema)
-- ============================================================

create or replace function karkhana.current_role_in_shop() returns text
language sql stable security definer
set search_path = karkhana, public, pg_temp as $$
  select role from karkhana.users where id = auth.uid()::text limit 1
$$;

create or replace function karkhana.current_shop_id() returns text
language sql stable security definer
set search_path = karkhana, public, pg_temp as $$
  select shop_id from karkhana.users where id = auth.uid()::text limit 1
$$;

-- ============================================================
-- 4. Enable Row-Level Security
-- ============================================================
alter table karkhana.shops              enable row level security;
alter table karkhana.users              enable row level security;
alter table karkhana.designs            enable row level security;
alter table karkhana.piece_types        enable row level security;
alter table karkhana.orders             enable row level security;
alter table karkhana.lots               enable row level security;
alter table karkhana.worker_assignments enable row level security;
alter table karkhana.production_entries enable row level security;
alter table karkhana.payments           enable row level security;
alter table karkhana.notifications      enable row level security;
alter table karkhana.holidays           enable row level security;

-- Drop previous policies if re-running this script (idempotent).
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'karkhana'
  loop
    execute format('drop policy if exists %I on karkhana.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ============================================================
-- 5. RLS policies — strict role-based access
-- ============================================================

-- SHOPS
create policy shops_select on karkhana.shops for select
  using (id = karkhana.current_shop_id());
create policy shops_update on karkhana.shops for update
  using (id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin');

-- USERS
create policy users_select on karkhana.users for select
  using (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or id = auth.uid()::text
      or (karkhana.current_role_in_shop() = 'contractor' and parent_user_id = auth.uid()::text)
      or (karkhana.current_role_in_shop() = 'worker' and id = (select parent_user_id from karkhana.users where id = auth.uid()::text))
      or role = 'admin'
    )
  );
create policy users_insert on karkhana.users for insert
  with check (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or (karkhana.current_role_in_shop() = 'contractor' and role = 'worker' and parent_user_id = auth.uid()::text)
    )
  );
create policy users_update on karkhana.users for update
  using (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or id = auth.uid()::text
      or (karkhana.current_role_in_shop() = 'contractor' and parent_user_id = auth.uid()::text)
    )
  );

-- DESIGNS
create policy designs_select on karkhana.designs for select
  using (shop_id = karkhana.current_shop_id());
create policy designs_admin_write on karkhana.designs for all
  using (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin')
  with check (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin');

-- PIECE_TYPES
create policy piece_types_select on karkhana.piece_types for select
  using (shop_id = karkhana.current_shop_id());
create policy piece_types_admin_write on karkhana.piece_types for all
  using (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin')
  with check (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin');

-- ORDERS
create policy orders_select on karkhana.orders for select
  using (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or (karkhana.current_role_in_shop() = 'contractor'
          and exists (select 1 from karkhana.lots l where l.order_id = orders.id and l.contractor_id = auth.uid()::text))
    )
  );
create policy orders_admin_write on karkhana.orders for all
  using (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin')
  with check (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin');

-- LOTS
create policy lots_select on karkhana.lots for select
  using (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or contractor_id = auth.uid()::text
      or (karkhana.current_role_in_shop() = 'worker'
          and exists (select 1 from karkhana.worker_assignments wa where wa.lot_id = lots.id and wa.worker_id = auth.uid()::text))
    )
  );
create policy lots_admin_write on karkhana.lots for all
  using (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin')
  with check (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin');

-- WORKER_ASSIGNMENTS
create policy assignments_select on karkhana.worker_assignments for select
  using (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or contractor_id = auth.uid()::text
      or worker_id = auth.uid()::text
    )
  );
create policy assignments_contractor_write on karkhana.worker_assignments for all
  using (
    shop_id = karkhana.current_shop_id()
    and (karkhana.current_role_in_shop() = 'admin'
         or (karkhana.current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text))
  ) with check (
    shop_id = karkhana.current_shop_id()
    and (karkhana.current_role_in_shop() = 'admin'
         or (karkhana.current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text))
  );

-- PRODUCTION_ENTRIES
create policy prod_select on karkhana.production_entries for select
  using (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or contractor_id = auth.uid()::text
      or worker_id = auth.uid()::text
    )
  );
create policy prod_worker_insert on karkhana.production_entries for insert
  with check (
    shop_id = karkhana.current_shop_id()
    and worker_id = auth.uid()::text
  );
create policy prod_contractor_admin_update on karkhana.production_entries for update
  using (
    shop_id = karkhana.current_shop_id()
    and (karkhana.current_role_in_shop() = 'admin'
         or (karkhana.current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text))
  );

-- PAYMENTS
create policy pay_select on karkhana.payments for select
  using (
    shop_id = karkhana.current_shop_id()
    and (
      karkhana.current_role_in_shop() = 'admin'
      or payer_id = auth.uid()::text
      or payee_id = auth.uid()::text
    )
  );
create policy pay_admin_contractor_write on karkhana.payments for all
  using (
    shop_id = karkhana.current_shop_id()
    and (karkhana.current_role_in_shop() = 'admin'
         or (karkhana.current_role_in_shop() = 'contractor' and payer_id = auth.uid()::text))
  ) with check (
    shop_id = karkhana.current_shop_id()
    and (karkhana.current_role_in_shop() = 'admin'
         or (karkhana.current_role_in_shop() = 'contractor' and payer_id = auth.uid()::text))
  );

-- NOTIFICATIONS
create policy notif_select on karkhana.notifications for select
  using (shop_id = karkhana.current_shop_id() and user_id = auth.uid()::text);
create policy notif_update on karkhana.notifications for update
  using (shop_id = karkhana.current_shop_id() and user_id = auth.uid()::text);

-- HOLIDAYS
create policy hol_select on karkhana.holidays for select
  using (shop_id = karkhana.current_shop_id());
create policy hol_admin_write on karkhana.holidays for all
  using (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin')
  with check (shop_id = karkhana.current_shop_id() and karkhana.current_role_in_shop() = 'admin');

-- ============================================================
-- 6. Convenience views
-- ============================================================

create or replace view karkhana.v_assignment_progress as
select
  wa.id as assignment_id,
  wa.shop_id,
  wa.lot_id,
  wa.worker_id,
  wa.contractor_id,
  wa.piece_type_id,
  wa.qty_assigned,
  wa.rate,
  coalesce(sum(pe.pieces_done), 0)::int as pieces_done,
  greatest(wa.qty_assigned - coalesce(sum(pe.pieces_done), 0), 0)::int as pieces_remaining,
  (coalesce(sum(pe.pieces_done), 0) * wa.rate)::numeric(12,2) as earned
from karkhana.worker_assignments wa
left join karkhana.production_entries pe on pe.assignment_id = wa.id
group by wa.id;

create or replace view karkhana.v_worker_balance as
select
  u.id as worker_id,
  u.shop_id,
  u.name,
  u.parent_user_id as contractor_id,
  coalesce((
    select sum(pe.pieces_done * wa.rate)
    from karkhana.production_entries pe
    join karkhana.worker_assignments wa on wa.id = pe.assignment_id
    where pe.worker_id = u.id
  ), 0)::numeric(12,2) as total_earned,
  coalesce((
    select sum(p.amount)
    from karkhana.payments p
    where p.payee_id = u.id and p.type in ('settlement','advance','bonus')
  ), 0)::numeric(12,2) as total_paid,
  (
    coalesce((select sum(pe.pieces_done * wa.rate) from karkhana.production_entries pe join karkhana.worker_assignments wa on wa.id = pe.assignment_id where pe.worker_id = u.id), 0)
    -
    coalesce((select sum(p.amount) from karkhana.payments p where p.payee_id = u.id and p.type in ('settlement','advance','bonus')), 0)
  )::numeric(12,2) as balance
from karkhana.users u
where u.role = 'worker';

-- ============================================================
-- 7. Grants — let the supabase-js client (anon, authenticated)
--    actually see the schema and operate on its tables.
--    RLS still controls per-row access.
-- ============================================================
grant usage on schema karkhana to anon, authenticated;
grant all on all tables    in schema karkhana to anon, authenticated;
grant all on all sequences in schema karkhana to anon, authenticated;
grant all on all routines  in schema karkhana to anon, authenticated;

-- Future objects automatically get the same grants.
alter default privileges in schema karkhana grant all on tables    to anon, authenticated;
alter default privileges in schema karkhana grant all on sequences to anon, authenticated;
alter default privileges in schema karkhana grant all on routines  to anon, authenticated;

-- ============================================================
-- DONE.
-- Remember the post-run dashboard step:
--   Settings → API → "Exposed schemas" → add "karkhana"
-- ============================================================
