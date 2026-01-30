/**
 * Figma Analyzer Service
 * 
 * Analyzes Figma/FigJam files by calling the Supabase Edge Function.
 * The Edge Function checks for cached analysis in the database,
 * and if not found, performs basic analysis from the file name.
 */

export interface FigmaAnalysis {
  clientName: string;
  projectName: string;
  projectType: 'claims' | 'support' | 'sales' | 'faq' | 'survey' | 'custom';
  description: string;
  sections: string[];
  dataFields: string[];
  decisionPoints: string[];
  userJourneys: string;
  escalationTriggers: string;
}

// Supabase project URL
const SUPABASE_URL = 'https://lkjxlgvqlcvlupyqjvpv.supabase.co';

/**
 * Analyze a Figma file by its key via Supabase Edge Function
 * @param fileKey - The Figma file key from the URL
 * @param fileName - The file name (used for fallback analysis)
 * @param figmaToken - Optional Figma personal access token for real API analysis
 */
export async function analyzeFigmaFile(
  fileKey: string, 
  fileName: string,
  figmaToken?: string
): Promise<FigmaAnalysis> {
  try {
    console.log('Calling Supabase Edge Function to analyze Figma file:', fileKey);
    console.log('Figma token provided:', !!figmaToken);
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-figma`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileKey, fileName, figmaToken }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Edge function error:', errorText);
      throw new Error(`Failed to analyze: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.analysis) {
      console.log('Analysis received:', data.cached ? 'from cache' : 'freshly analyzed');
      return data.analysis as FigmaAnalysis;
    }

    throw new Error(data.error || 'Unknown error');
  } catch (error) {
    console.error('Error calling Figma analyzer:', error);
    // Fall back to local analysis
    return analyzeFromFileName(fileName);
  }
}

/**
 * Fallback: Analyze project details from file name when API unavailable
 */
function analyzeFromFileName(fileName: string): FigmaAnalysis {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').trim();
  const lowerName = cleanName.toLowerCase();
  
  // Detect project type
  let projectType: FigmaAnalysis['projectType'] = 'custom';
  if (lowerName.includes('fnol') || lowerName.includes('claim')) {
    projectType = 'claims';
  } else if (lowerName.includes('support') || lowerName.includes('help')) {
    projectType = 'support';
  } else if (lowerName.includes('sales') || lowerName.includes('lead')) {
    projectType = 'sales';
  } else if (lowerName.includes('faq')) {
    projectType = 'faq';
  } else if (lowerName.includes('survey') || lowerName.includes('feedback')) {
    projectType = 'survey';
  }

  // Extract client and project names
  const { clientName, projectName } = parseFileName(cleanName);

  return {
    clientName,
    projectName,
    projectType,
    description: `Bot flow imported from Figma: ${fileName}\n\nThis appears to be a ${projectType} bot. Review and update the extracted details.`,
    sections: [],
    dataFields: [],
    decisionPoints: [],
    userJourneys: '',
    escalationTriggers: ''
  };
}

/**
 * Parse file name to extract client and project names
 */
function parseFileName(fileName: string): { clientName: string; projectName: string } {
  // Common patterns: "Client - Project", "Client_Project", "Project (version)"
  const patterns = [
    /^(.+?)\s*[-–—]\s*(.+?)(?:\s*\(\d+\))?$/,
    /^(.+?)_(.+?)$/,
  ];

  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match) {
      return {
        clientName: toPascalCase(match[1]),
        projectName: toPascalCase(match[2]),
      };
    }
  }

  return {
    clientName: '',
    projectName: toPascalCase(fileName),
  };
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
