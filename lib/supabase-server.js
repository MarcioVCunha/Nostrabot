const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://slkztbeihpesepamjcbo.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_bB3svjN36RwUrz-4RHBP3Q_P8XzyaDs";

function createAnonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  createAnonClient
};
