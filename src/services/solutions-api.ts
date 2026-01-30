/**
 * Solutions API Service
 * 
 * Handles CRUD operations for solutions via Supabase Edge Function
 */

import type { SavedSolution } from '../types';

const SUPABASE_URL = 'https://lkjxlgvqlcvlupyqjvpv.supabase.co';
const SOLUTIONS_ENDPOINT = `${SUPABASE_URL}/functions/v1/sd-solutions`;

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
  };
}

// Convert SavedSolution to database format
function solutionToDb(solution: Partial<SavedSolution>) {
  const db: any = {};
  if (solution.name !== undefined) db.name = solution.name;
  if (solution.clientName !== undefined) db.clientName = solution.clientName;
  if (solution.projectType !== undefined) db.projectType = solution.projectType;
  if (solution.description !== undefined) db.description = solution.description;
  if (solution.status !== undefined) db.status = solution.status;
  if (solution.nodeCount !== undefined) db.nodeCount = solution.nodeCount;
  if (solution.deployedEnvironment !== undefined) db.deployedEnvironment = solution.deployedEnvironment;
  // Creation progress
  if (solution.currentStep !== undefined) db.currentStep = solution.currentStep;
  // Requirements step data (stored as JSON)
  if (solution.requirementsQuestions !== undefined) db.requirementsQuestions = solution.requirementsQuestions;
  if (solution.requirementsAnswers !== undefined) db.requirementsAnswers = solution.requirementsAnswers;
  // Generated content
  if (solution.csvContent !== undefined) db.csvContent = solution.csvContent;
  // External links
  if (solution.spreadsheetUrl !== undefined) db.spreadsheetUrl = solution.spreadsheetUrl;
  if (solution.botUrl !== undefined) db.botUrl = solution.botUrl;
  if (solution.widgetUrl !== undefined) db.widgetUrl = solution.widgetUrl;
  return db;
}

/**
 * Fetch all solutions for a user
 */
export async function fetchSolutions(userEmail: string): Promise<SavedSolution[]> {
  try {
    const response = await fetch(`${SOLUTIONS_ENDPOINT}?userEmail=${encodeURIComponent(userEmail)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch solutions');
    }

    const data = await response.json();
    return (data.solutions || []).map(dbToSolution);
  } catch (error) {
    console.error('Error fetching solutions:', error);
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
    const response = await fetch(SOLUTIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userEmail,
        ...solutionToDb(solution),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create solution');
    }

    const data = await response.json();
    return dbToSolution(data.solution);
  } catch (error) {
    console.error('Error creating solution:', error);
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
    const response = await fetch(`${SOLUTIONS_ENDPOINT}/${solutionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(solutionToDb(updates)),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update solution');
    }

    const data = await response.json();
    return dbToSolution(data.solution);
  } catch (error) {
    console.error('Error updating solution:', error);
    return null;
  }
}

/**
 * Delete a solution
 */
export async function deleteSolution(solutionId: string): Promise<boolean> {
  try {
    const response = await fetch(`${SOLUTIONS_ENDPOINT}/${solutionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete solution');
    }

    return true;
  } catch (error) {
    console.error('Error deleting solution:', error);
    return false;
  }
}
