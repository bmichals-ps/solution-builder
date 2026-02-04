/**
 * Supabase Client
 * 
 * Central Supabase client for auth and database operations
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://jcsfggahtaewgqytvgau.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type { User, Session } from '@supabase/supabase-js';
