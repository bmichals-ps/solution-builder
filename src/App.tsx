import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { Layout } from './components/Layout';
import { useAuth } from './contexts/AuthContext';
import {
  WelcomePage,
  DashboardPage,
  SolutionDetailPage,
  ProjectSetupPage,
  RequirementsPage,
  ClarifyingQuestionsPage,
  GenerationPage,
  ReviewPage,
  DeployPage,
  LoginPage,
  ConfirmDetailsPage,
  ProcessingPage,
  ResultsPage,
  EditorPage,
} from './pages';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { Loader2 } from 'lucide-react';
import type { WizardStep, InstantStep } from './types';

// Map URL paths to wizard steps
const pathToStep: Record<string, WizardStep> = {
  '/': 'welcome',
  '/welcome': 'welcome',
  '/dashboard': 'dashboard',
  '/solution': 'solution-detail',
  '/project-setup': 'project-setup',
  '/requirements': 'requirements',
  '/clarifying-questions': 'clarifying-questions',
  '/generation': 'generation',
  '/review': 'review',
  '/deploy': 'deploy',
};

// Map wizard steps to URL paths
const stepToPath: Record<WizardStep, string> = {
  'welcome': '/',
  'dashboard': '/dashboard',
  'solution-detail': '/solution',
  'project-setup': '/project-setup',
  'requirements': '/requirements',
  'clarifying-questions': '/clarifying-questions',
  'generation': '/generation',
  'review': '/review',
  'deploy': '/deploy',
};

function App() {
  const { 
    currentStep, 
    error, 
    setError, 
    setStep, 
    syncUserFromAuth,
    restoreSolutionFromSaved,
    activeSolutionId,
    solution,
    savedSolutions,
    fetchSavedSolutions,
    solutionsLoaded,
    instantStep
  } = useStore();
  const { isLoading: authLoading, isAuthenticated, user } = useAuth();
  
  // Handle OAuth callback route
  if (window.location.pathname === '/auth/callback') {
    return <AuthCallbackPage />;
  }

  // Sync auth user to store when auth state changes
  useEffect(() => {
    if (user) {
      syncUserFromAuth(user);
    }
  }, [user, syncUserFromAuth]);
  
  // Fetch saved solutions when user is authenticated
  useEffect(() => {
    if (user && !solutionsLoaded) {
      fetchSavedSolutions();
    }
  }, [user, solutionsLoaded, fetchSavedSolutions]);
  
  // Restore solution from saved solutions if needed (after reload)
  useEffect(() => {
    // If we have an active solution ID but no solution data, try to restore from saved
    if (activeSolutionId && !solution && savedSolutions.length > 0) {
      restoreSolutionFromSaved();
    }
  }, [activeSolutionId, solution, savedSolutions, restoreSolutionFromSaved]);

  // Sync URL → State on initial load and browser navigation
  useEffect(() => {
    const handleNavigation = () => {
      const path = window.location.pathname;
      const step = pathToStep[path];
      if (step && step !== currentStep) {
        setStep(step);
      }
    };

    // Set initial step from URL
    handleNavigation();

    // Listen for browser back/forward
    window.addEventListener('popstate', handleNavigation);
    return () => window.removeEventListener('popstate', handleNavigation);
  }, []);

  // Sync State → URL when step changes
  useEffect(() => {
    const targetPath = stepToPath[currentStep];
    if (targetPath && window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  }, [currentStep]);

  // Show loading screen while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[#6366f1] animate-spin mx-auto mb-4" />
          <p className="text-[#8585a3] text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const renderPage = () => {
    // Check instant flow steps first (takes precedence when active)
    if (instantStep !== 'create') {
      switch (instantStep) {
        case 'confirm':
          return <ConfirmDetailsPage />;
        case 'processing':
          return <ProcessingPage />;
        case 'results':
          return <ResultsPage />;
        case 'editor':
          return <EditorPage />;
      }
    }
    
    // Legacy wizard flow
    switch (currentStep) {
      case 'welcome':
        return <WelcomePage />;
      case 'dashboard':
        return <DashboardPage />;
      case 'solution-detail':
        return <SolutionDetailPage />;
      case 'project-setup':
        return <ProjectSetupPage />;
      case 'requirements':
        return <RequirementsPage />;
      case 'clarifying-questions':
        return <ClarifyingQuestionsPage />;
      case 'generation':
        return <GenerationPage />;
      case 'review':
        return <ReviewPage />;
      case 'deploy':
        return <DeployPage />;
      default:
        return <WelcomePage />;
    }
  };

  return (
    <Layout>
      {/* Global Error Banner */}
      {error && (
        <div className="mb-4 p-3.5 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] rounded-xl flex items-center justify-between">
          <span className="text-[13px] text-[#f87171]">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-[12px] text-[#f87171] hover:text-[#fca5a5] font-medium"
          >
            Dismiss
          </button>
        </div>
      )}
      
      <div key={currentStep} className="page-transition">
        {renderPage()}
      </div>
    </Layout>
  );
}

export default App;
