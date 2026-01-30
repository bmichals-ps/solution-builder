/**
 * Supabase Edge Function: Action Scripts API
 * 
 * Manages official Pypestream action node scripts
 * 
 * Endpoints:
 * - GET /sd-action-scripts - List all scripts
 * - GET /sd-action-scripts/:name - Get a single script
 * - POST /sd-action-scripts - Create/update a script (admin only)
 * - POST /sd-action-scripts/batch - Get multiple scripts by name
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    // Remove the function name from path
    const funcIndex = pathParts.indexOf('sd-action-scripts');
    const subPath = pathParts.slice(funcIndex + 1);

    // GET /sd-action-scripts - List all scripts
    if (req.method === 'GET' && subPath.length === 0) {
      const { data, error } = await supabase
        .from('action_scripts')
        .select('name, description, category, created_at, updated_at')
        .order('name');

      if (error) throw error;

      return new Response(
        JSON.stringify({ scripts: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /sd-action-scripts/:name - Get a single script
    if (req.method === 'GET' && subPath.length === 1) {
      const scriptName = decodeURIComponent(subPath[0]);
      
      const { data, error } = await supabase
        .from('action_scripts')
        .select('*')
        .eq('name', scriptName)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return new Response(
            JSON.stringify({ error: 'Script not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw error;
      }

      return new Response(
        JSON.stringify({ script: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /sd-action-scripts/batch - Get multiple scripts
    if (req.method === 'POST' && subPath[0] === 'batch') {
      const { names } = await req.json();
      
      if (!Array.isArray(names)) {
        return new Response(
          JSON.stringify({ error: 'names must be an array' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data, error } = await supabase
        .from('action_scripts')
        .select('*')
        .in('name', names);

      if (error) throw error;

      return new Response(
        JSON.stringify({ scripts: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /sd-action-scripts - Create/update a script (admin only)
    if (req.method === 'POST' && subPath.length === 0) {
      // Verify authorization (service role key required)
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || !authHeader.includes(supabaseKey)) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized - admin access required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { name, content, description, category } = await req.json();

      if (!name || !content) {
        return new Response(
          JSON.stringify({ error: 'name and content are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data, error } = await supabase
        .from('action_scripts')
        .upsert({
          name,
          content,
          description: description || null,
          category: category || 'official',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'name' })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ script: data, message: 'Script saved successfully' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
