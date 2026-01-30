/**
 * Supabase Edge Function: Error Learning API
 * 
 * Manages error patterns and fix attempts for self-improvement system
 * 
 * Endpoints:
 * - GET /sd-error-learning/patterns - List error patterns (with optional filters)
 * - GET /sd-error-learning/patterns/:id - Get a single error pattern with its fixes
 * - POST /sd-error-learning/patterns - Log/upsert an error pattern
 * - GET /sd-error-learning/fixes - Get proven fixes (high confidence)
 * - POST /sd-error-learning/fixes - Log a fix attempt
 * - GET /sd-error-learning/errors-to-avoid - Get common errors for generation prompt
 * - POST /sd-error-learning/query-fixes - Query fixes for specific error signatures
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
    const funcIndex = pathParts.indexOf('sd-error-learning');
    const subPath = pathParts.slice(funcIndex + 1);
    const resource = subPath[0];

    // ============================================
    // ERROR PATTERNS ENDPOINTS
    // ============================================

    // GET /sd-error-learning/patterns - List error patterns
    if (req.method === 'GET' && resource === 'patterns' && subPath.length === 1) {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const orderBy = url.searchParams.get('order_by') || 'occurrence_count';
      const errorType = url.searchParams.get('error_type');

      let query = supabase
        .from('error_patterns')
        .select('*')
        .order(orderBy, { ascending: false })
        .limit(limit);

      if (errorType) {
        query = query.eq('error_type', errorType);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(
        JSON.stringify({ patterns: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /sd-error-learning/patterns/:id - Get single pattern with fixes
    if (req.method === 'GET' && resource === 'patterns' && subPath.length === 2) {
      const patternId = subPath[1];
      
      const { data: pattern, error: patternError } = await supabase
        .from('error_patterns')
        .select('*')
        .eq('id', patternId)
        .single();

      if (patternError) {
        if (patternError.code === 'PGRST116') {
          return new Response(
            JSON.stringify({ error: 'Pattern not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw patternError;
      }

      // Get associated fixes
      const { data: fixes, error: fixesError } = await supabase
        .from('fix_attempts')
        .select('*')
        .eq('error_pattern_id', patternId)
        .order('confidence_score', { ascending: false });

      if (fixesError) throw fixesError;

      return new Response(
        JSON.stringify({ pattern, fixes }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /sd-error-learning/patterns - Log/upsert an error pattern
    if (req.method === 'POST' && resource === 'patterns') {
      const { 
        error_signature, 
        error_type, 
        field_name, 
        error_description, 
        node_context 
      } = await req.json();

      if (!error_signature || !error_type || !error_description) {
        return new Response(
          JSON.stringify({ error: 'error_signature, error_type, and error_description are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Use the upsert function we created in the migration
      const { data, error } = await supabase.rpc('upsert_error_pattern', {
        p_error_signature: error_signature,
        p_error_type: error_type,
        p_field_name: field_name || null,
        p_error_description: error_description,
        p_node_context: node_context || null,
      });

      if (error) throw error;

      return new Response(
        JSON.stringify({ pattern_id: data, message: 'Error pattern logged' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================
    // FIX ATTEMPTS ENDPOINTS
    // ============================================

    // GET /sd-error-learning/fixes - Get proven fixes (high confidence)
    if (req.method === 'GET' && resource === 'fixes') {
      const minConfidence = parseFloat(url.searchParams.get('min_confidence') || '0.5');
      const minApplied = parseInt(url.searchParams.get('min_applied') || '2');
      const limit = parseInt(url.searchParams.get('limit') || '100');

      const { data, error } = await supabase
        .from('fix_attempts')
        .select(`
          *,
          error_patterns (
            error_signature,
            error_type,
            field_name,
            error_description
          )
        `)
        .gte('confidence_score', minConfidence)
        .gte('applied_count', minApplied)
        .order('confidence_score', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return new Response(
        JSON.stringify({ fixes: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /sd-error-learning/fixes - Log a fix attempt
    if (req.method === 'POST' && resource === 'fixes') {
      const { 
        error_pattern_id, 
        fix_description, 
        fix_diff, 
        success 
      } = await req.json();

      if (!error_pattern_id || !fix_description || success === undefined) {
        return new Response(
          JSON.stringify({ error: 'error_pattern_id, fix_description, and success are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Use the upsert function we created in the migration
      const { data, error } = await supabase.rpc('upsert_fix_attempt', {
        p_error_pattern_id: error_pattern_id,
        p_fix_description: fix_description,
        p_fix_diff: fix_diff || null,
        p_success: success,
      });

      if (error) throw error;

      return new Response(
        JSON.stringify({ fix_id: data, message: 'Fix attempt logged' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================
    // QUERY ENDPOINTS
    // ============================================

    // GET /sd-error-learning/errors-to-avoid - Get common errors for generation prompt
    if (req.method === 'GET' && resource === 'errors-to-avoid') {
      const limit = parseInt(url.searchParams.get('limit') || '20');

      // Get most frequent errors
      const { data: patterns, error: patternsError } = await supabase
        .from('error_patterns')
        .select('error_type, field_name, error_description, occurrence_count')
        .order('occurrence_count', { ascending: false })
        .limit(limit);

      if (patternsError) throw patternsError;

      // Get proven fixes for context
      const { data: fixes, error: fixesError } = await supabase
        .from('fix_attempts')
        .select(`
          fix_description,
          confidence_score,
          error_patterns (
            error_type
          )
        `)
        .gte('confidence_score', 0.7)
        .gte('applied_count', 3)
        .order('confidence_score', { ascending: false })
        .limit(30);

      if (fixesError) throw fixesError;

      // Format for prompt injection
      const errorsToAvoid = patterns.map(p => ({
        error_type: p.error_type,
        field: p.field_name,
        description: p.error_description,
        occurrences: p.occurrence_count,
        known_fix: fixes.find(f => f.error_patterns?.error_type === p.error_type)?.fix_description
      }));

      return new Response(
        JSON.stringify({ errors_to_avoid: errorsToAvoid }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /sd-error-learning/query-fixes - Query fixes for specific error signatures
    if (req.method === 'POST' && resource === 'query-fixes') {
      const { error_signatures } = await req.json();

      if (!Array.isArray(error_signatures) || error_signatures.length === 0) {
        return new Response(
          JSON.stringify({ error: 'error_signatures must be a non-empty array' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // First get matching patterns
      const { data: patterns, error: patternsError } = await supabase
        .from('error_patterns')
        .select('id, error_signature, error_type')
        .in('error_signature', error_signatures);

      if (patternsError) throw patternsError;

      if (patterns.length === 0) {
        return new Response(
          JSON.stringify({ fixes: [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const patternIds = patterns.map(p => p.id);

      // Get proven fixes for these patterns
      const { data: fixes, error: fixesError } = await supabase
        .from('fix_attempts')
        .select(`
          *,
          error_patterns (
            error_signature,
            error_type,
            field_name,
            error_description
          )
        `)
        .in('error_pattern_id', patternIds)
        .gte('confidence_score', 0.5)
        .order('confidence_score', { ascending: false });

      if (fixesError) throw fixesError;

      return new Response(
        JSON.stringify({ fixes }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /sd-error-learning/stats - Get learning system statistics
    if (req.method === 'GET' && resource === 'stats') {
      const { data: patternCount } = await supabase
        .from('error_patterns')
        .select('id', { count: 'exact', head: true });

      const { data: fixCount } = await supabase
        .from('fix_attempts')
        .select('id', { count: 'exact', head: true });

      const { data: successfulFixes } = await supabase
        .from('fix_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('success', true);

      const { data: highConfidenceFixes } = await supabase
        .from('fix_attempts')
        .select('id', { count: 'exact', head: true })
        .gte('confidence_score', 0.8)
        .gte('applied_count', 3);

      return new Response(
        JSON.stringify({
          stats: {
            total_error_patterns: patternCount,
            total_fix_attempts: fixCount,
            successful_fixes: successfulFixes,
            high_confidence_fixes: highConfidenceFixes
          }
        }),
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
