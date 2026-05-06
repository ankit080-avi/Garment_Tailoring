-- KarkhanaPro — Postgres schema + RLS
-- Run this in the Supabase SQL editor on a fresh project.
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
  role            text not null check (role in ('admin','contractor','worker')),
  password_hash   text,
  parent_user_id  text references users(id) on delete set null,  -- contractor for a worker; null for admin
  photo           text,
  status          text default 'active' check (status in ('active','disabled','pending')),
  created_at      timestamptz not null default now(),
  unique (shop_id, mobile)
);

create table if not exists designs (
  id           text primary key,
  shop_id      text not null references shops(id) on delete cascade,
  name         text not null,
  sku          text,
  photo        text,
  default_rate numeric(10,2) default 0,    -- per piece "all-in" rate (overridden by piece_types)
  active       boolean default true,
  created_at   timestamptz not null default now()
);

create table if not exists piece_types (
  id           text primary key,
  shop_id      text not null references shops(id) on delete cascade,
  design_id    text not null references designs(id) on delete cascade,
  name         text not null,             -- 'cutting','stitching','finishing','button','iron'
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
  contractor_id  text references users(id),       -- assigned contractor (null = unassigned)
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
  payer_id              text not null references users(id),     -- who paid
  payee_id              text not null references users(id),     -- who received
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
create index if not exists idx_users_shop on users(shop_id);
create index if not exists idx_users_parent on users(parent_user_id);
create index if not exists idx_orders_shop on orders(shop_id);
create index if not exists idx_lots_order on lots(order_id);
create index if not exists idx_lots_contractor on lots(contractor_id);
create index if not exists idx_assign_lot on worker_assignments(lot_id);
create index if not exists idx_assign_worker on worker_assignments(worker_id);
create index if not exists idx_assign_contractor on worker_assignments(contractor_id);
create index if not exists idx_prod_assignment on production_entries(assignment_id);
create index if not exists idx_prod_worker_date on production_entries(worker_id, date);
create index if not exists idx_pay_payee on payments(payee_id);
create index if not exists idx_pay_payer on payments(payer_id);

-- ============================================================
-- 3. Helper functions for RLS
-- ============================================================

-- Returns the current user's role in their shop. Reads from users table.
create or replace function current_role_in_shop() returns text
language sql stable security definer as $$
  select role from users where id = auth.uid()::text limit 1
$$;

create or replace function current_shop_id() returns text
language sql stable security definer as $$
  select shop_id from users where id = auth.uid()::text limit 1
$$;

-- ============================================================
-- 4. Enable Row-Level Security
-- ============================================================
alter table shops              enable row level security;
alter table users              enable row level security;
alter table designs            enable row level security;
alter table piece_types        enable row level security;
alter table orders             enable row level security;
alter table lots               enable row level security;
alter table worker_assignments enable row level security;
alter table production_entries enable row level security;
alter table payments           enable row level security;
alter table notifications      enable row level security;
alter table holidays           enable row level security;

-- ============================================================
-- 5. RLS policies — strict role-based access
-- ============================================================

-- SHOPS: members see their own shop; admin can update.
create policy shops_select on shops for select
  using (id = current_shop_id());
create policy shops_update on shops for update
  using (id = current_shop_id() and current_role_in_shop() = 'admin');

-- USERS:
--  admin  → all users in their shop
--  contractor → themselves + workers under them + the admin
--  worker  → themselves + their contractor + the admin
create policy users_select on users for select
  using (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or id = auth.uid()::text
      or (current_role_in_shop() = 'contractor' and parent_user_id = auth.uid()::text)
      or (current_role_in_shop() = 'worker' and id = (select parent_user_id from users where id = auth.uid()::text))
      or role = 'admin'
    )
  );
create policy users_insert on users for insert
  with check (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or (current_role_in_shop() = 'contractor' and role = 'worker' and parent_user_id = auth.uid()::text)
    )
  );
create policy users_update on users for update
  using (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or id = auth.uid()::text
      or (current_role_in_shop() = 'contractor' and parent_user_id = auth.uid()::text)
    )
  );

-- DESIGNS + PIECE_TYPES: admin full access; contractor/worker read-only (within shop).
create policy designs_select on designs for select using (shop_id = current_shop_id());
create policy designs_admin_write on designs for all using (
  shop_id = current_shop_id() and current_role_in_shop() = 'admin'
) with check (shop_id = current_shop_id() and current_role_in_shop() = 'admin');

create policy piece_types_select on piece_types for select using (shop_id = current_shop_id());
create policy piece_types_admin_write on piece_types for all using (
  shop_id = current_shop_id() and current_role_in_shop() = 'admin'
) with check (shop_id = current_shop_id() and current_role_in_shop() = 'admin');

-- ORDERS:
--  admin → all in shop
--  contractor → orders that have at least one lot assigned to them
--  worker → no direct order access
create policy orders_select on orders for select
  using (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or (current_role_in_shop() = 'contractor'
          and exists (select 1 from lots l where l.order_id = orders.id and l.contractor_id = auth.uid()::text))
    )
  );
create policy orders_admin_write on orders for all using (
  shop_id = current_shop_id() and current_role_in_shop() = 'admin'
) with check (shop_id = current_shop_id() and current_role_in_shop() = 'admin');

-- LOTS:
--  admin → all
--  contractor → only their lots
--  worker → only lots they have assignments in
create policy lots_select on lots for select
  using (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or contractor_id = auth.uid()::text
      or (current_role_in_shop() = 'worker'
          and exists (select 1 from worker_assignments wa where wa.lot_id = lots.id and wa.worker_id = auth.uid()::text))
    )
  );
create policy lots_admin_write on lots for all using (
  shop_id = current_shop_id() and current_role_in_shop() = 'admin'
) with check (shop_id = current_shop_id() and current_role_in_shop() = 'admin');

-- WORKER_ASSIGNMENTS:
--  admin → all
--  contractor → assignments where contractor_id = me; can insert/update for their own lots
--  worker → assignments where worker_id = me (read-only)
create policy assignments_select on worker_assignments for select
  using (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or contractor_id = auth.uid()::text
      or worker_id = auth.uid()::text
    )
  );
create policy assignments_contractor_write on worker_assignments for all using (
  shop_id = current_shop_id()
  and (current_role_in_shop() = 'admin'
       or (current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text))
) with check (
  shop_id = current_shop_id()
  and (current_role_in_shop() = 'admin'
       or (current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text))
);

-- PRODUCTION_ENTRIES:
--  admin → all
--  contractor → entries by workers under them
--  worker → their own entries; can insert their own
create policy prod_select on production_entries for select
  using (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or contractor_id = auth.uid()::text
      or worker_id = auth.uid()::text
    )
  );
create policy prod_worker_insert on production_entries for insert
  with check (
    shop_id = current_shop_id()
    and worker_id = auth.uid()::text
  );
create policy prod_contractor_admin_write on production_entries for update
  using (
    shop_id = current_shop_id()
    and (current_role_in_shop() = 'admin'
         or (current_role_in_shop() = 'contractor' and contractor_id = auth.uid()::text))
  );

-- PAYMENTS:
--  admin → all
--  contractor → payments where they are payer or payee
--  worker → payments where they are payee (read-only)
create policy pay_select on payments for select
  using (
    shop_id = current_shop_id()
    and (
      current_role_in_shop() = 'admin'
      or payer_id = auth.uid()::text
      or payee_id = auth.uid()::text
    )
  );
create policy pay_admin_contractor_write on payments for all using (
  shop_id = current_shop_id()
  and (current_role_in_shop() = 'admin'
       or (current_role_in_shop() = 'contractor' and payer_id = auth.uid()::text))
) with check (
  shop_id = current_shop_id()
  and (current_role_in_shop() = 'admin'
       or (current_role_in_shop() = 'contractor' and payer_id = auth.uid()::text))
);

-- NOTIFICATIONS: each user sees their own.
create policy notif_select on notifications for select
  using (shop_id = current_shop_id() and user_id = auth.uid()::text);
create policy notif_update on notifications for update
  using (shop_id = current_shop_id() and user_id = auth.uid()::text);

-- HOLIDAYS: shop-wide read; admin write.
create policy hol_select on holidays for select using (shop_id = current_shop_id());
create policy hol_admin_write on holidays for all using (
  shop_id = current_shop_id() and current_role_in_shop() = 'admin'
) with check (shop_id = current_shop_id() and current_role_in_shop() = 'admin');

-- ============================================================
-- 6. Convenience views (optional but used by reports)
-- ============================================================

-- Per-assignment progress: pieces done vs assigned.
create or replace view v_assignment_progress as
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
from worker_assignments wa
left join production_entries pe on pe.assignment_id = wa.id
group by wa.id;

-- Worker balance: earned − paid (settlement/advance count toward payout).
create or replace view v_worker_balance as
select
  u.id as worker_id,
  u.shop_id,
  u.name,
  u.parent_user_id as contractor_id,
  coalesce((
    select sum(pe.pieces_done * wa.rate)
    from production_entries pe
    join worker_assignments wa on wa.id = pe.assignment_id
    where pe.worker_id = u.id
  ), 0)::numeric(12,2) as total_earned,
  coalesce((
    select sum(p.amount)
    from payments p
    where p.payee_id = u.id and p.type in ('settlement','advance','bonus')
  ), 0)::numeric(12,2) as total_paid,
  (
    coalesce((select sum(pe.pieces_done * wa.rate) from production_entries pe join worker_assignments wa on wa.id = pe.assignment_id where pe.worker_id = u.id), 0)
    -
    coalesce((select sum(p.amount) from payments p where p.payee_id = u.id and p.type in ('settlement','advance','bonus')), 0)
  )::numeric(12,2) as balance
from users u
where u.role = 'worker';
