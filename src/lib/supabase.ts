/**
 * Supabase Client
 * 
 * Central Supabase client for auth and database operations
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lkjxlgvqlcvlupyqjvpv.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxranhsZ3ZxbGN2bHVweXFqdnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MTYxMDUsImV4cCI6MjA3NTA5MjEwNX0.pEPI-XQYuZFDbs7blYwR-oCY-D2nwuOrSs_KWgQj7ug';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type { User, Session } from '@supabase/supabase-js';
