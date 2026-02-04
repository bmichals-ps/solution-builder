import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  AppState, 
  WizardStep, 
  Integration, 
  Credentials, 
  ProjectConfig, 
  ClarifyingQuestion, 
  Solution,
  SavedSolution,
  UserProfile,
  RequirementQuestion,
  RequirementsAnswers,
  ExtractedDetails,
  InstantBuildResult,
  InstantStep,
  BrandAssets
} from '../types';
import * as solutionsApi from '../services/solutions-api';

const defaultIntegrations: Integration[] = [
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Import and export bot CSVs',
    connected: false,
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Import flows from Figma designs',
    connected: false,
  },
  {
    id: 'pypestream-api',
    name: 'Pypestream Bot Manager API',
    description: 'Deploy bots directly to Pypestream',
    connected: false,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Store action node scripts in GitHub',
    connected: false,
  },
];

const defaultProjectConfig: ProjectConfig = {
  clientName: 'CX',  // Always "CX" for bot ID purposes
  projectName: '',
  projectType: 'support',
  description: '',
  referenceFiles: [],
  targetCompany: undefined,  // The actual company/brand for branding
  brandAssets: undefined,    // Auto-detected brand colors/logos
};

// User starts as empty - populated from Supabase auth
const defaultUser: UserProfile = {
  name: '',
  email: '',
  avatar: '',
};

// No more mock data - solutions are fetched from Supabase

interface AppStore extends AppState {
  // Navigation
  setStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  
  // Sidebar
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  
  // Integrations
  setIntegrationConnected: (id: string, connected: boolean, connectionId?: string) => void;
  connectIntegration: (id: string) => Promise<boolean>;
  
  // Credentials
  setCredentials: (credentials: Partial<Credentials>) => void;
  
  // Project Config
  setProjectConfig: (config: Partial<ProjectConfig>) => void;
  addReferenceFile: (file: { id: string; name: string; type: string; size: number; content?: string }) => void;
  removeReferenceFile: (id: string) => void;
  
  // Requirements
  setRequirementsQuestions: (questions: RequirementQuestion[]) => void;
  setRequirementsAnswers: (answers: RequirementsAnswers) => void;
  updateRequirementsAnswer: (questionId: string, selectedOptionIds: string[]) => void;
  
  // Clarifying Questions (legacy)
  setClarifyingQuestions: (questions: ClarifyingQuestion[]) => void;
  answerQuestion: (id: string, answer: string) => void;
  
  // Solution
  setSolution: (solution: Solution | null) => void;
  
  // Saved Solutions (now with Supabase)
  fetchSavedSolutions: () => Promise<void>;
  addSavedSolution: (solution: Omit<SavedSolution, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SavedSolution | null>;
  updateSavedSolution: (id: string, updates: Partial<SavedSolution>) => Promise<void>;
  deleteSavedSolution: (id: string) => Promise<void>;
  setActiveSolution: (id: string | null) => void;
  setSavedSolutions: (solutions: SavedSolution[]) => void;
  restoreSolutionFromSaved: () => void;
  solutionsLoaded: boolean;
  
  // Instant Flow (new streamlined flow)
  instantStep: InstantStep;
  extractedDetails: ExtractedDetails | null;
  instantBuildResult: InstantBuildResult | null;
  setInstantStep: (step: InstantStep) => void;
  setExtractedDetails: (details: ExtractedDetails | null) => void;
  setInstantBuildResult: (result: InstantBuildResult | null) => void;
  
  // Loading / Error
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // User
  setUser: (user: Partial<UserProfile>) => void;
  syncUserFromAuth: (authUser: { email?: string | null; user_metadata?: { display_name?: string; avatar_url?: string } }) => void;
  
  // Reset
  reset: () => void;
  startNewSolution: () => void;
}

// Updated step order without 'integrations'
const stepOrder: WizardStep[] = [
  'welcome',
  'project-setup',
  'requirements',
  'clarifying-questions',
  'generation',
  'review',
  'deploy',
];

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Initial state
      currentStep: 'welcome',
      integrations: defaultIntegrations,
      credentials: {},
      projectConfig: defaultProjectConfig,
      // Requirements step
      requirementsQuestions: [],
      requirementsAnswers: {},
      clarifyingQuestions: [],
      solution: null,
      savedSolutions: [],
      activeSolutionId: null,
      isLoading: false,
      error: null,
      user: defaultUser,
      sidebarOpen: false,
      solutionsLoaded: false,
      // Instant flow state
      instantStep: 'create' as InstantStep,
      extractedDetails: null,
      instantBuildResult: null,
      
      // Navigation
      setStep: (step) => set({ currentStep: step, error: null }),
      
      // Sidebar
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      
      nextStep: () => {
        const currentIndex = stepOrder.indexOf(get().currentStep);
        if (currentIndex < stepOrder.length - 1) {
          set({ currentStep: stepOrder[currentIndex + 1], error: null });
        }
      },
      
      prevStep: () => {
        const currentIndex = stepOrder.indexOf(get().currentStep);
        if (currentIndex > 0) {
          set({ currentStep: stepOrder[currentIndex - 1], error: null });
        }
      },
      
      // Integrations
      setIntegrationConnected: (id, connected, connectionId) => {
        set((state) => ({
          integrations: state.integrations.map((i) =>
            i.id === id ? { ...i, connected, connectionId } : i
          ),
        }));
      },
      
      connectIntegration: async (id: string) => {
        try {
          // Import the composio service dynamically to avoid circular deps
          const { initiateComposioAuth } = await import('../services/composio');
          
          // Get user ID from state
          const userId = get().user.email || `user_${Date.now()}`;
          
          // Initiate OAuth flow via backend
          const result = await initiateComposioAuth(id, userId);
          
          if (result.success) {
            // Mark as connected
            get().setIntegrationConnected(id, true, result.connectionId);
            return true;
          } else {
            if (result.error) {
              get().setError(result.error);
            }
            return false;
          }
        } catch (error) {
          console.error('Connect integration error:', error);
          get().setError(`Failed to connect to ${id}`);
          return false;
        }
      },
      
      // Credentials
      setCredentials: (credentials) => {
        set((state) => ({
          credentials: { ...state.credentials, ...credentials },
        }));
      },
      
      // Project Config
      setProjectConfig: (config) => {
        set((state) => ({
          projectConfig: { ...state.projectConfig, ...config },
        }));
      },
      
      addReferenceFile: (file) => {
        set((state) => ({
          projectConfig: {
            ...state.projectConfig,
            referenceFiles: [...state.projectConfig.referenceFiles, file],
          },
        }));
      },
      
      removeReferenceFile: (id) => {
        set((state) => ({
          projectConfig: {
            ...state.projectConfig,
            referenceFiles: state.projectConfig.referenceFiles.filter((f) => f.id !== id),
          },
        }));
      },
      
      // Clarifying Questions
      // Requirements
      setRequirementsQuestions: (questions) => set({ requirementsQuestions: questions }),
      
      setRequirementsAnswers: (answers) => set({ requirementsAnswers: answers }),
      
      updateRequirementsAnswer: (questionId, selectedOptionIds) => {
        set((state) => ({
          requirementsAnswers: {
            ...state.requirementsAnswers,
            [questionId]: selectedOptionIds
          }
        }));
      },
      
      // Clarifying Questions (legacy)
      setClarifyingQuestions: (questions) => set({ clarifyingQuestions: questions }),
      
      answerQuestion: (id, answer) => {
        set((state) => ({
          clarifyingQuestions: state.clarifyingQuestions.map((q) =>
            q.id === id ? { ...q, answer } : q
          ),
        }));
      },
      
      // Solution
      setSolution: (solution) => set({ solution }),
      
      // Instant Flow
      setInstantStep: (instantStep) => set({ instantStep }),
      setExtractedDetails: (extractedDetails) => set({ extractedDetails }),
      setInstantBuildResult: (instantBuildResult) => set({ instantBuildResult }),
      
      // Saved Solutions (Supabase-backed)
      setSavedSolutions: (solutions) => set({ savedSolutions: solutions, solutionsLoaded: true }),
      
      fetchSavedSolutions: async () => {
        const userEmail = get().user.email;
        if (!userEmail) return;
        
        try {
          const solutions = await solutionsApi.fetchSolutions(userEmail);
          set({ savedSolutions: solutions, solutionsLoaded: true });
        } catch (error) {
          console.error('Failed to fetch solutions:', error);
          set({ solutionsLoaded: true });
        }
      },
      
      addSavedSolution: async (solution) => {
        const userEmail = get().user.email;
        if (!userEmail) return null;
        
        const created = await solutionsApi.createSolution(userEmail, solution);
        if (created) {
          set((state) => ({
            savedSolutions: [created, ...state.savedSolutions],
          }));
        }
        return created;
      },
      
      updateSavedSolution: async (id, updates) => {
        const updated = await solutionsApi.updateSolution(id, updates);
        if (updated) {
          set((state) => ({
            savedSolutions: state.savedSolutions.map((s) =>
              s.id === id ? updated : s
            ),
          }));
        }
      },
      
      deleteSavedSolution: async (id) => {
        const success = await solutionsApi.deleteSolution(id);
        if (success) {
          set((state) => ({
            savedSolutions: state.savedSolutions.filter((s) => s.id !== id),
            activeSolutionId: state.activeSolutionId === id ? null : state.activeSolutionId,
          }));
        }
      },
      
      setActiveSolution: (id) => set({ activeSolutionId: id }),
      
      // Restore solution from saved solutions (useful after reload if solution was lost)
      restoreSolutionFromSaved: () => {
        const state = get();
        if (state.activeSolutionId) {
          const saved = state.savedSolutions.find(s => s.id === state.activeSolutionId);
          if (saved) {
            const updates: any = {
              // Restore project config
              projectConfig: {
                ...state.projectConfig,
                clientName: saved.clientName || state.projectConfig.clientName,
                projectName: saved.name || state.projectConfig.projectName,
                projectType: saved.projectType || state.projectConfig.projectType,
                description: saved.description || state.projectConfig.description,
              },
            };
            
            // Restore requirements data if available
            if (saved.requirementsQuestions && saved.requirementsQuestions.length > 0) {
              updates.requirementsQuestions = saved.requirementsQuestions;
            }
            if (saved.requirementsAnswers && Object.keys(saved.requirementsAnswers).length > 0) {
              updates.requirementsAnswers = saved.requirementsAnswers;
            }
            
            // Restore solution if CSV content exists and current solution is missing or empty
            if (saved.csvContent && (!state.solution || !state.solution.csvContent)) {
              console.log('[Store] Restoring solution from Supabase:', saved.name, 'with', saved.nodeCount, 'nodes');
              
              // Parse CSV to count decision vs action nodes
              let decisionNodes = 0;
              let actionNodes = 0;
              try {
                const lines = saved.csvContent.split('\n');
                // Skip header row, count node types
                for (let i = 1; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (!line) continue;
                  // Node Type is column 2 (index 1 after split)
                  // Simple parse - find the second comma-separated value
                  const match = line.match(/^[^,]*,\s*([^,]*)/);
                  const nodeType = match?.[1]?.trim().toUpperCase();
                  if (nodeType === 'D') decisionNodes++;
                  else if (nodeType === 'A') actionNodes++;
                }
              } catch (e) {
                console.warn('[Store] Could not parse CSV for node counts:', e);
              }
              
              const totalNodes = decisionNodes + actionNodes;
              console.log('[Store] Parsed node counts:', { totalNodes, decisionNodes, actionNodes });
              
              updates.solution = {
                id: saved.id,
                nodes: [],
                csvContent: saved.csvContent,
                readme: '',
                // Restore Google Sheets URL if was exported
                spreadsheetUrl: saved.spreadsheetUrl,
                // Restore deployment info if was deployed
                botUrl: saved.botUrl,
                deployedEnvironment: saved.deployedEnvironment,
                validationResult: {
                  passed: true,
                  stats: { totalNodes, decisionNodes, actionNodes },
                  errors: [],
                  warnings: [],
                },
              };
            }
            
            set(updates);
          }
        }
      },
      
      // Loading / Error
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      
      // User
      setUser: (user) => set((state) => ({ user: { ...state.user, ...user } })),
      
      syncUserFromAuth: (authUser) => {
        const email = authUser.email || '';
        const name = authUser.user_metadata?.display_name || email.split('@')[0] || '';
        const avatar = authUser.user_metadata?.avatar_url || '';
        const currentEmail = get().user.email;
        
        // If user changed, clear cached solutions
        const userChanged = currentEmail !== email;
        
        set({
          user: {
            name,
            email,
            avatar,
          },
          // Only reset solutions if user changed
          ...(userChanged && {
            savedSolutions: [],
            solutionsLoaded: false,
          }),
        });
      },
      
      // Reset - clears current work but PRESERVES saved solutions and credentials
      reset: () => set((state) => ({
        currentStep: 'welcome',
        // Preserve integrations and credentials (don't make user re-auth)
        integrations: state.integrations,
        credentials: state.credentials,
        // Clear current work
        projectConfig: defaultProjectConfig,
        clarifyingQuestions: [],
        solution: null,
        // CRITICAL: Preserve saved solutions - never wipe user data
        savedSolutions: state.savedSolutions,
        solutionsLoaded: state.solutionsLoaded,
        activeSolutionId: null,
        isLoading: false,
        error: null,
        // Preserve user (comes from auth)
        user: state.user,
        sidebarOpen: false,
        // Reset instant flow state
        instantStep: 'create' as InstantStep,
        extractedDetails: null,
        instantBuildResult: null,
      })),
      
      // Start new solution (clears current work but keeps saved solutions)
      startNewSolution: () => set((state) => ({
        currentStep: 'welcome',
        projectConfig: defaultProjectConfig,
        // Clear requirements step data
        requirementsQuestions: [],
        requirementsAnswers: {},
        clarifyingQuestions: [],
        solution: null,
        activeSolutionId: null,
        isLoading: false,
        error: null,
        sidebarOpen: false,
        // Reset instant flow state
        instantStep: 'create' as InstantStep,
        extractedDetails: null,
        instantBuildResult: null,
      })),
    }),
    {
      name: 'pypestream-solution-designer',
      version: 10, // Bumped - now persisting work-in-progress to prevent data loss on reload
      // Persist credentials AND current work-in-progress
      // This prevents losing work when the page is reloaded during generation/deploy
      partialize: (state) => ({
        // API credentials (always persist)
        credentials: state.credentials,
        // Current work-in-progress (auto-save)
        projectConfig: state.projectConfig,
        instantStep: state.instantStep,
        extractedDetails: state.extractedDetails,
        instantBuildResult: state.instantBuildResult,
        solution: state.solution,
        activeSolutionId: state.activeSolutionId,
        // Requirements data
        requirementsQuestions: state.requirementsQuestions,
        requirementsAnswers: state.requirementsAnswers,
      }),
      // Migration from old versions
      migrate: (persistedState: any, version: number) => {
        console.log('[Store] Migrating from version', version, 'to 10');
        // Accept data from version 9 (credentials only) - just pass through
        // The merge function will handle setting defaults for missing fields
        return persistedState;
      },
      // Merge persisted state with current state
      merge: (persistedState: any, currentState) => {
        if (!persistedState) return currentState;
        
        console.log('[Store] Restoring persisted state:', {
          hasCredentials: !!persistedState.credentials,
          hasProjectConfig: !!persistedState.projectConfig,
          hasInstantBuildResult: !!persistedState.instantBuildResult,
          instantStep: persistedState.instantStep,
        });
        
        return {
          ...currentState,
          // Restore credentials
          credentials: persistedState.credentials || currentState.credentials,
          // Restore work-in-progress
          projectConfig: persistedState.projectConfig || currentState.projectConfig,
          instantStep: persistedState.instantStep || currentState.instantStep,
          extractedDetails: persistedState.extractedDetails || currentState.extractedDetails,
          instantBuildResult: persistedState.instantBuildResult || currentState.instantBuildResult,
          solution: persistedState.solution || currentState.solution,
          activeSolutionId: persistedState.activeSolutionId || currentState.activeSolutionId,
          // Restore requirements
          requirementsQuestions: persistedState.requirementsQuestions || currentState.requirementsQuestions,
          requirementsAnswers: persistedState.requirementsAnswers || currentState.requirementsAnswers,
        };
      },
    }
  )
);
