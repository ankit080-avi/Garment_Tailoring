-- DarziMate — Postgres schema + RLS (public schema).
-- Idempotent — safe to re-run.
--
-- Roles: 'admin' (Bada Seth), 'contractor' (Chhota Seth), 'worker' (Darzi).

-- ============================================================
-- 1. Tables
-- ============================================================

create table if not exists shops (
  id            text primary key,
  name          text not null,
  owner_user_id text not null,
  address       text,
  phone         text,
  upi_id        text,
  upi_name      text,
  created_at    timestamptz not null default now()
);

create table if not exists users (
  id              text primary key,
  shop_id         text references shops(id) on delete cascade,
  mobile          text not null,
  name            text not null,
  role            text not null,
  password_hash   text,
  parent_user_id  text references users(id) on delete set null,
  photo           text,
  status          text default 'active',
  created_at      timestamptz not null default now(),
  unique (shop_id, mobile)
);

-- Tighten role + status checks (idempotent — drop old then add new).
alter table users drop constraint if exists users_role_check;
alter table users add  constraint users_role_check
  check (role in ('software_admin','admin','contractor','worker'));
alter table users drop constraint if exists users_status_check;
alter table users add  constraint users_status_check
  check (status in ('active','disabled','pending','rejected'));

-- Many-to-many: an admin (Bada Seth) can have many contractors (Chhota Seth);
-- a contractor can work for many admins.
create table if not exists admin_contractors (
  id            text primary key,
  admin_id      text not null references users(id) on delete cascade,
  contractor_id text not null references users(id) on delete cascade,
  status        text default 'active' check (status in ('active','paused','ended')),
  since         date default current_date,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (admin_id, contractor_id)
);

create table if not exists designs (
  id           text primary key,
  shop_id      text not null references shops(id) on delete cascade,
  name         text not null,
  sku          text,
  photo        text,
  default_rate numeric(10,2) default 0,
  active       boolean default true,
  created_at   timestamptz not null default now()
);

create table if not exists piece_types (
  id           text primary key,
  shop_id      text not null references shops(id) on delete cascade,
  design_id    text not null references designs(id) on delete cascade,
  name         text not null,
  default_rate numeric(10,2) not null default 0,
  sort_order   int default 0
);

create table if not exists orders (
  id          text primary key,
  shop_id     text not null references shops(id) on delete cascade,
  design_id   text not null references designs(id),
  total_qty   int not null check (total_qty > 0),
  deadline    date,
  notes       text,
  status      text default 'open' check (status in ('open','in_progress','completed','cancelled')),
  created_by  text references users(id),
  created_at  timestamptz not null default now()
);

create table if not exists lots (
  id             text primary key,
  shop_id        text not null references shops(id) on delete cascade,
  order_id       text not null references orders(id) on delete cascade,
  lot_no         int not null,
  qty            int not null check (qty > 0),
  contractor_id  text references users(id),
  status         text default 'unassigned' check (status in ('unassigned','assigned','in_progress','completed')),
  assigned_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (order_id, lot_no)
);

create table if not exists worker_assignments (
  id             text primary key,
  shop_id        text not null references shops(id) on delete cascade,
  lot_id         text not null references lots(id) on delete cascade,
  worker_id      text not null references users(id),
  contractor_id  text not null references users(id),
  piece_type_id  text not null references piece_types(id),
  qty_assigned   int not null check (qty_assigned > 0),
  rate           numeric(10,2) not null,
  status         text default 'open' check (status in ('open','in_progress','completed','cancelled')),
  assigned_at    timestamptz not null default now()
);

create table if not exists production_entries (
  id             text primary key,
  shop_id        text not null references shops(id) on delete cascade,
  assignment_id  text not null references worker_assignments(id) on delete cascade,
  worker_id      text not null references users(id),
  contractor_id  text not null references users(id),
  date           date not null default current_date,
  pieces_done    int not null check (pieces_done > 0),
  notes          text,
  photo          text,
  created_at     timestamptz not null default now()
);

create table if not exists payments (
  id                    text primary key,
  shop_id               text not null references shops(id) on delete cascade,
  payer_id              text not null references users(id),
  payee_id              text not null references users(id),
  amount                numeric(12,2) not null check (amount > 0),
  type                  text not null check (type in ('advance','settlement','bonus','adjustment')),
  method                text default 'cash' check (method in ('cash','upi','bank','other')),
  date                  date not null default current_date,
  note                  text,
  against_assignment_id text references worker_assignments(id),
  against_lot_id        text references lots(id),
  created_at            timestamptz not null default now()
);

create table if not exists notifications (
  id        text primary key,
  shop_id   text not null references shops(id) on delete cascade,
  user_id   text not null references users(id) on delete cascade,
  type      text not null,
  title     text not null,
  body      text,
  date      timestamptz not null default now(),
  read      boolean default false
);

create table if not exists holidays (
  id      text primary key,
  shop_id text not null references shops(id) on delete cascade,
  date    date not null,
  label   text
);

-- ============================================================
-- 2. Indexes
-- ============================================================
create index if not exists kk_users_shop_idx       on users(shop_id);
create index if not exists kk_users_parent_idx     on users(parent_user_id);
create index if not exists kk_ac_admin_idx         on admin_contractors(admin_id);
create index if not exists kk_ac_contractor_idx    on admin_contractors(contractor_id);
create index if not exists kk_orders_shop_idx      on orders(shop_id);
create index if not exists kk_lots_order_idx       on lots(order_id);
create index if not exists kk_lots_contractor_idx  on lots(contractor_id);
create index if not exists kk_assign_lot_idx       on worker_assignments(lot_id);
create index if not exists kk_assign_worker_idx    on worker_assignments(worker_id);
create index if not exists kk_assign_contr_idx     on worker_assignments(contractor_id);
create index if not exists kk_prod_assign_idx      on production_entries(assignment_id);
create index if not exists kk_prod_worker_date_idx on production_entries(worker_id, date);
create index if not exists kk_pay_payee_idx        on payments(payee_id);
create index if not exists kk_pay_payer_idx        on payments(payer_id);

-- ============================================================
-- 3. Helper functions for RLS
-- ============================================================

create or replace function current_role_in_shop() returns text
language sql stable security definer
set search_path = public, pg_temp as $$
  select role from users where id = auth.uid()::text limit 1
$$;

create or replace function current_shop_id() returns text
language sql stable security definer
set search_path = public, pg_temp as $$
  select shop_id from users where id = auth.uid()::text limit 1
$$;

create or replace function is_software_admin() returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce((select role from users where id = auth.uid()::text limit 1) = 'software_admin', false)
$$;

-- Used inside RLS policies that need to look at "my parent" without re-
-- entering the policy (which causes infinite recursion). SECURITY DEFINER
-- bypasses RLS for the inner select.
create or replace function current_parent_user_id() returns text
language sql stable security definer
set search_path = public, pg_temp as $$
  select parent_user_id from users where id = auth.uid()::text limit 1
$$;

-- Public RPC: lets the unauthenticated signup screen check whether the
-- platform already has a software admin. Used to decide whether to
-- promote the first signup. No personal data leaks.
create or replace function has_software_admin() returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from users where role = 'software_admin')
$$;
revoke all on function has_software_admin() from public;
grant execute on function has_software_admin() to anon, authenticated;

-- ============================================================
-- 4. Enable Row-Level Security
-- ============================================================
alter table shops              enable row level security;
alter table users              enable row level security;
alter table admin_contractors  enable row level security;
alter table designs            enable row level security;
alter table piece_types        enable row level security;
alter table orders             enable row level security;
alter table lots               enable row level security;
alter table worker_assignments enable row level security;
alter table production_entries enable row level security;
alter table payments           enable row level security;
alter table notifications      enable row level security;
alter table holidays           enable row level security;

-- Drop existing policies for idempotent re-run.
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies where schemaname = 'public'
      and tablename in ('shops','users','admin_contractors','designs','piece_types',
                        'orders','lots','worker_assignments','production_entries',
                        'payments','notifications','holidays')
  loop
    execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ============================================================
-- 5. RLS policies
-- ============================================================

-- SHOPS
create policy shops_select on shops for select
  using (is_software_admin() or id = current_shop_id());
create policy shops_self_insert on shops for insert
  with check (owner_user_id = auth.uid()::text);
create policy shops_update on shops for update
  using (
    is_software_admin()
    or (id = current_shop_id() and current_role_in_shop() = 'admin')
  );
-- Software admin (or the owner themselves) can hard-delete a shop.
-- Cascade FKs wipe orders/lots/assignments/production/payments/notifications/holidays/designs/piece_types.
create policy shops_delete on shops for delete
  using (is_software_admin() or owner_user_id = auth.uid()::text);

-- USERS
-- Self-signup: a freshly-authenticated user can create exactly their own row.
create policy users_select on users for select
  using (
    is_software_admin()
    or shop_id = current_shop_id()
    or id = auth.uid()::text
    or (current_role_in_shop() = 'contractor' and parent_user_id = auth.uid()::text)
    or (current_role_in_shop() = 'worker' and id = current_parent_user_id())
    -- Look-up by mobile during signup: anyone can find an admin or contractor by mobile.
    or role in ('admin','contractor','software_admin')
  );
create policy users_self_insert on users for insert
  with check (id = auth.uid()::text);
create policy users_admin_insert on users for insert
  with check (current_role_in_shop() = 'admin');
create policy users_update on users for update
  using (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or id = auth.uid()::text
    or (current_role_in_shop() = 'contractor' and parent_user_id = auth.uid()::text)
  );
-- Software admin (or the user themselves) can hard-delete a users row.
-- Other users referencing this one via parent_user_id are nulled (FK on delete set null).
create policy users_delete on users for delete
  using (is_software_admin() or id = auth.uid()::text);

-- ADMIN_CONTRACTORS
create policy ac_select on admin_contractors for select
  using (is_software_admin() or admin_id = auth.uid()::text or contractor_id = auth.uid()::text);
create policy ac_self_insert on admin_contractors for insert
  with check (admin_id = auth.uid()::text or contractor_id = auth.uid()::text);
create policy ac_admin_write on admin_contractors for all
  using (is_software_admin() or (admin_id = auth.uid()::text and current_role_in_shop() = 'admin'))
  with check (is_software_admin() or (admin_id = auth.uid()::text and current_role_in_shop() = 'admin'));

-- DESIGNS / PIECE_TYPES
create policy designs_select on designs for select
  using (is_software_admin() or shop_id = current_shop_id());
create policy designs_admin_write on designs for all
  using (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'))
  with check (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'));

create policy piece_types_select on piece_types for select
  using (is_software_admin() or shop_id = current_shop_id());
create policy piece_types_admin_write on piece_types for all
  using (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'))
  with check (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'));

-- ORDERS
create policy orders_select on orders for select
  using (
    is_software_admin()
    or (current_role_in_shop() = 'admin' and shop_id = current_shop_id())
    or (current_role_in_shop() = 'contractor'
        and exists (select 1 from lots l where l.order_id = orders.id and l.contractor_id = auth.uid()::text))
  );
create policy orders_admin_write on orders for all
  using (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'))
  with check (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'));

-- LOTS
create policy lots_select on lots for select
  using (
    is_software_admin()
    or (current_role_in_shop() = 'admin' and shop_id = current_shop_id())
    or contractor_id = auth.uid()::text
    or (current_role_in_shop() = 'worker'
        and exists (select 1 from worker_assignments wa where wa.lot_id = lots.id and wa.worker_id = auth.uid()::text))
  );
create policy lots_admin_write on lots for all
  using (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'))
  with check (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'));

-- WORKER_ASSIGNMENTS
create policy assignments_select on worker_assignments for select
  using (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or contractor_id = auth.uid()::text
    or worker_id = auth.uid()::text
  );
create policy assignments_contractor_write on worker_assignments for all
  using (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or (current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text)
  ) with check (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or (current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text)
  );

-- PRODUCTION_ENTRIES
create policy prod_select on production_entries for select
  using (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or contractor_id = auth.uid()::text
    or worker_id = auth.uid()::text
  );
create policy prod_worker_insert on production_entries for insert
  with check (worker_id = auth.uid()::text);
create policy prod_contractor_admin_update on production_entries for update
  using (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or (current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text)
  );

-- PAYMENTS
create policy pay_select on payments for select
  using (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or payer_id = auth.uid()::text
    or payee_id = auth.uid()::text
  );
create policy pay_admin_contractor_write on payments for all
  using (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or (current_role_in_shop() = 'contractor' and payer_id = auth.uid()::text)
  ) with check (
    is_software_admin()
    or current_role_in_shop() = 'admin'
    or (current_role_in_shop() = 'contractor' and payer_id = auth.uid()::text)
  );

-- NOTIFICATIONS
create policy notif_select on notifications for select
  using (is_software_admin() or user_id = auth.uid()::text);
create policy notif_update on notifications for update
  using (is_software_admin() or user_id = auth.uid()::text);

-- HOLIDAYS
create policy hol_select on holidays for select
  using (is_software_admin() or shop_id = current_shop_id());
create policy hol_admin_write on holidays for all
  using (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'))
  with check (is_software_admin() or (shop_id = current_shop_id() and current_role_in_shop() = 'admin'));

-- ============================================================
-- 6. Convenience views
-- ============================================================

create or replace view v_assignment_progress as
select
  wa.id as assignment_id,
  wa.shop_id, wa.lot_id, wa.worker_id, wa.contractor_id, wa.piece_type_id,
  wa.qty_assigned, wa.rate,
  coalesce(sum(pe.pieces_done), 0)::int as pieces_done,
  greatest(wa.qty_assigned - coalesce(sum(pe.pieces_done), 0), 0)::int as pieces_remaining,
  (coalesce(sum(pe.pieces_done), 0) * wa.rate)::numeric(12,2) as earned
from worker_assignments wa
left join production_entries pe on pe.assignment_id = wa.id
group by wa.id;

-- ============================================================
-- 7. Realtime — let supabase-js subscribe to changes on these tables
-- ============================================================
do $$
declare t text;
begin
  for t in select unnest(array[
    'shops','users','admin_contractors','designs','piece_types',
    'orders','lots','worker_assignments','production_entries',
    'payments','notifications','holidays'
  ]) loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

create or replace view v_worker_balance as
select
  u.id as worker_id, u.shop_id, u.name, u.parent_user_id as contractor_id,
  coalesce((
    select sum(pe.pieces_done * wa.rate)
    from production_entries pe
    join worker_assignments wa on wa.id = pe.assignment_id
    where pe.worker_id = u.id
  ), 0)::numeric(12,2) as total_earned,
  coalesce((
    select sum(p.amount) from payments p
    where p.payee_id = u.id and p.type in ('settlement','advance','bonus')
  ), 0)::numeric(12,2) as total_paid,
  (
    coalesce((select sum(pe.pieces_done * wa.rate) from production_entries pe join worker_assignments wa on wa.id = pe.assignment_id where pe.worker_id = u.id), 0)
    -
    coalesce((select sum(p.amount) from payments p where p.payee_id = u.id and p.type in ('settlement','advance','bonus')), 0)
  )::numeric(12,2) as balance
from users u
where u.role = 'worker';
