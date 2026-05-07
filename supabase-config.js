// DarziMate — Supabase config.
// The KEY is the publishable / anon key — public by design, safe to commit.
// Real auth is enforced by Row-Level Security policies in supabase/schema.sql.
window.DARZIMATE_SUPABASE = {
  URL:    'https://xeigvfmejmvkzhwbjozp.supabase.co',
  KEY:    'sb_publishable_4DNG4hF3gZQFDEu8LW9IYQ_51aR2PaW',
  SCHEMA: 'public',
  // Whoever signs up with this mobile becomes the platform-level software admin
  // (sees every karkhana, approves new Bada Seth applications). Same pattern as
  // MilkMate. Change here if you want to hand the keys to someone else.
  SOFTWARE_ADMIN_MOBILE: '8858141463',
  // Default password used when the software admin row doesn't exist yet
  // (bootstrap path) AND auto-prefilled on the sign-in form when the mobile
  // above is entered, so signing in is one tap. Change this immediately if
  // you ever hand the credentials to someone else.
  SOFTWARE_ADMIN_PASSWORD: 'ankit@4545'
};
