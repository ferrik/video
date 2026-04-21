'use strict';

const { createClient } = require('@supabase/supabase-js');

let supabaseClient = null;
let supabaseInit = false;

function getSupabaseClient() {
  if (supabaseInit) return supabaseClient;
  supabaseInit = true;
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.warn('[Supabase] Server sync disabled: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    supabaseClient = null;
    return null;
  }
  supabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

module.exports = { getSupabaseClient };
