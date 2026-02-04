/**
 * Solutions API Service
 * 
 * Handles CRUD operations for solutions via direct Supabase client
 */

import { supabase } from '../lib/supabase';
import type { SavedSolution } from '../types';

// Convert database row to SavedSolution format
function dbToSolution(row: any): SavedSolution {
  return {
    id: row.id,
    name: row.name,
    clientName: row.client_name || '',
    projectType: row.project_type || 'custom',
    description: row.description || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status || 'draft',
    nodeCount: row.node_count || 0,
    deployedEnvironment: row.deployed_environment || undefined,
    // Creation progress
    currentStep: row.current_step || undefined,
    // Requirements step data
    requirementsQuestions: row.requirements_questions || undefined,
    requirementsAnswers: row.requirements_answers || undefined,
    // Generated content
    csvContent: row.csv_content || undefined,
    // External links
    spreadsheetUrl: row.spreadsheet_url || undefined,
    botUrl: row.bot_url || undefined,
    widgetUrl: row.widget_url || undefined,
    // Deployment details
    widgetId: row.widget_id || undefined,
    botId: row.bot_id || undefined,
    versionId: row.version_id || undefined,
    // Architecture editor state
    architectureState: row.architecture_state || undefined,
  };
}

// Convert SavedSolution to database format (snake_case)
function solutionToDb(solution: Partial<SavedSolution>) {
  const db: any = {};
  if (solution.name !== undefined) db.name = solution.name;
  if (solution.clientName !== undefined) db.client_name = solution.clientName;
  if (solution.projectType !== undefined) db.project_type = solution.projectType;
  if (solution.description !== undefined) db.description = solution.description;
  if (solution.status !== undefined) db.status = solution.status;
  if (solution.nodeCount !== undefined) db.node_count = solution.nodeCount;
  if (solution.deployedEnvironment !== undefined) db.deployed_environment = solution.deployedEnvironment;
  // Creation progress
  if (solution.currentStep !== undefined) db.current_step = solution.currentStep;
  // Requirements step data (stored as JSONB)
  if (solution.requirementsQuestions !== undefined) db.requirements_questions = solution.requirementsQuestions;
  if (solution.requirementsAnswers !== undefined) db.requirements_answers = solution.requirementsAnswers;
  // Generated content
  if (solution.csvContent !== undefined) db.csv_content = solution.csvContent;
  // External links
  if (solution.spreadsheetUrl !== undefined) db.spreadsheet_url = solution.spreadsheetUrl;
  if (solution.botUrl !== undefined) db.bot_url = solution.botUrl;
  if (solution.widgetUrl !== undefined) db.widget_url = solution.widgetUrl;
  // Deployment details
  if (solution.widgetId !== undefined) db.widget_id = solution.widgetId;
  if (solution.botId !== undefined) db.bot_id = solution.botId;
  if (solution.versionId !== undefined) db.version_id = solution.versionId;
  // Architecture editor state (stored as JSONB)
  if (solution.architectureState !== undefined) db.architecture_state = solution.architectureState;
  return db;
}

/**
 * Get the current user's profile ID from Supabase auth
 */
async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * Fetch all solutions for the current user
 */
export async function fetchSolutions(userEmail?: string): Promise<SavedSolution[]> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.log('[Solutions API] No authenticated user');
      return [];
    }

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[Solutions API] Error fetching solutions:', error);
      return [];
    }

    console.log(`[Solutions API] Fetched ${data?.length || 0} solutions for user`);
    return (data || []).map(dbToSolution);
  } catch (error) {
    console.error('[Solutions API] Error fetching solutions:', error);
    return [];
  }
}

/**
 * Create a new solution
 */
export async function createSolution(
  userEmail: string,
  solution: Omit<SavedSolution, 'id' | 'createdAt' | 'updatedAt'>
): Promise<SavedSolution | null> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.error('[Solutions API] No authenticated user for create');
      return null;
    }

    const dbData = {
      ...solutionToDb(solution),
      user_id: userId,
    };

    console.log('[Solutions API] Creating solution:', solution.name);

    const { data, error } = await supabase
      .from('projects')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      console.error('[Solutions API] Error creating solution:', error);
      return null;
    }

    console.log('[Solutions API] Solution created:', data.id);
    return dbToSolution(data);
  } catch (error) {
    console.error('[Solutions API] Error creating solution:', error);
    return null;
  }
}

/**
 * Update an existing solution
 */
export async function updateSolution(
  solutionId: string,
  updates: Partial<SavedSolution>
): Promise<SavedSolution | null> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.error('[Solutions API] No authenticated user for update');
      return null;
    }

    const dbData = {
      ...solutionToDb(updates),
      updated_at: new Date().toISOString(),
    };

    console.log('[Solutions API] Updating solution:', solutionId);

    const { data, error } = await supabase
      .from('projects')
      .update(dbData)
      .eq('id', solutionId)
      .eq('user_id', userId) // RLS safety - only update own projects
      .select()
      .single();

    if (error) {
      console.error('[Solutions API] Error updating solution:', error);
      return null;
    }

    console.log('[Solutions API] Solution updated:', data.id);
    return dbToSolution(data);
  } catch (error) {
    console.error('[Solutions API] Error updating solution:', error);
    return null;
  }
}

/**
 * Delete a solution
 */
export async function deleteSolution(solutionId: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.error('[Solutions API] No authenticated user for delete');
      return false;
    }

    console.log('[Solutions API] Deleting solution:', solutionId);

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', solutionId)
      .eq('user_id', userId); // RLS safety - only delete own projects

    if (error) {
      console.error('[Solutions API] Error deleting solution:', error);
      return false;
    }

    console.log('[Solutions API] Solution deleted:', solutionId);
    return true;
  } catch (error) {
    console.error('[Solutions API] Error deleting solution:', error);
    return false;
  }
}

/**
 * Get a single solution by ID
 */
export async function getSolution(solutionId: string): Promise<SavedSolution | null> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      console.error('[Solutions API] No authenticated user');
      return null;
    }

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', solutionId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('[Solutions API] Error fetching solution:', error);
      return null;
    }

    return dbToSolution(data);
  } catch (error) {
    console.error('[Solutions API] Error fetching solution:', error);
    return null;
  }
}
