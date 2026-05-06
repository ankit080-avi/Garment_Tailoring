// KarkhanaPro — Supabase config
// Shares the MilkMate Supabase project. KarkhanaPro lives in its own
// Postgres schema `karkhana`, so its tables don't collide with MilkMate's.
// (See supabase/schema.sql.)
//
// The `KEY` here is the publishable / anon key — public by design.
// Real auth is enforced by Row-Level Security in the karkhana schema.
window.KARKHANA_SUPABASE = {
  URL:    'https://kmauurezrgovucpbkekq.supabase.co',
  KEY:    'sb_publishable_a3klASpmaN__EX38mCq9Ew_l_cUpUr3',
  SCHEMA: 'karkhana'
};
