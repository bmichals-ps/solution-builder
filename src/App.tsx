import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom';
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
  SolutionArchitecturePage,
  ProcessingPage,
  ResultsPage,
  EditorPage,
  LiveEditPage,
} from './pages';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { Loader2 } from 'lucide-react';
import type { WizardStep, InstantStep } from './types';

// Protected route wrapper - requires authentication
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  
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
  
  if (!isAuthenticated) {
    return <LoginPage />;
  }
  
  return <>{children}</>;
}

// Solution route wrapper - sets active solution from URL and syncs view state
function SolutionRoute() {
  const { solutionId, view, flowName } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    setActiveSolution, 
    activeSolutionId,
    savedSolutions,
    setInstantStep,
    instantStep,
    fetchSavedSolutions,
    solutionsLoaded
  } = useStore();
  
  // Sync solution ID from URL to store
  useEffect(() => {
    if (solutionId && solutionId !== activeSolutionId) {
      setActiveSolution(solutionId);
      console.log('[Router] Set active solution from URL:', solutionId);
    }
  }, [solutionId, activeSolutionId, setActiveSolution]);
  
  // Ensure solutions are loaded
  useEffect(() => {
    if (!solutionsLoaded) {
      fetchSavedSolutions();
    }
  }, [solutionsLoaded, fetchSavedSolutions]);
  
  // Set instant step based on view
  useEffect(() => {
    if (view === 'confirm' && instantStep !== 'confirm') {
      setInstantStep('confirm');
    } else if (view === 'results' && instantStep !== 'results') {
      setInstantStep('results');
    } else if (view === 'editor' && instantStep !== 'editor') {
      setInstantStep('editor');
    } else if (!view || view === 'architecture') {
      // Default to architecture view for /solutions/:id
      if (instantStep !== 'architecture') {
        setInstantStep('architecture');
      }
    }
  }, [view, instantStep, setInstantStep]);
  
  // Pass flow name to architecture page via window for now
  // TODO: Use React context for cleaner state passing
  useEffect(() => {
    if (flowName) {
      (window as any).__selectedFlowFromURL = flowName;
    } else {
      delete (window as any).__selectedFlowFromURL;
    }
  }, [flowName]);
  
  // Render the appropriate view
  if (view === 'confirm') {
    return <ConfirmDetailsPage />;
  } else if (view === 'results') {
    return <ResultsPage />;
  } else if (view === 'editor') {
    return <EditorPage />;
  } else {
    // Default: architecture view (with optional flow drill-down)
    return <SolutionArchitecturePage />;
  }
}

// Main app content with routing
function AppContent() {
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
    instantStep,
    setInstantStep
  } = useStore();
  const { isLoading: authLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

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
    if (activeSolutionId && !solution && savedSolutions.length > 0) {
      restoreSolutionFromSaved();
    }
  }, [activeSolutionId, solution, savedSolutions, restoreSolutionFromSaved]);

  // Sync instantStep changes to URL for solution pages
  // IMPORTANT: Only redirect if we're NOT on the home page creating a new project
  // If we're on '/' or '/welcome', the user is in the new project flow - don't redirect to old solutions
  useEffect(() => {
    if (activeSolutionId && instantStep !== 'create') {
      const currentPath = location.pathname;
      
      // Skip redirect if user is on the home page - they're creating a new project
      // and we don't want to redirect them to an old solution from localStorage
      if (currentPath === '/' || currentPath === '/welcome') {
        return;
      }
      
      let targetPath = `/solutions/${activeSolutionId}`;
      
      if (instantStep === 'confirm') {
        targetPath = `/solutions/${activeSolutionId}/confirm`;
      } else if (instantStep === 'results') {
        targetPath = `/solutions/${activeSolutionId}/results`;
      } else if (instantStep === 'editor') {
        targetPath = `/solutions/${activeSolutionId}/editor`;
      }
      // architecture is the default, so /solutions/:id is sufficient
      
      if (currentPath !== targetPath && !currentPath.startsWith('/solutions/')) {
        navigate(targetPath, { replace: true });
      }
    }
  }, [instantStep, activeSolutionId, navigate, location.pathname]);

  return (
    <Routes>
      {/* Auth callback - no layout */}
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      
      {/* Live edit - no layout */}
      <Route path="/live-edit/*" element={
        <ProtectedRoute>
          <LiveEditPage />
        </ProtectedRoute>
      } />
      
      {/* Main app routes with layout */}
      <Route path="/*" element={
        <ProtectedRoute>
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
            
            <Routes>
              {/* Home / Welcome */}
              <Route path="/" element={<WelcomePage />} />
              <Route path="/welcome" element={<WelcomePage />} />
              
              {/* Dashboard */}
              <Route path="/dashboard" element={<DashboardPage />} />
              
              {/* Solution routes with ID in URL */}
              <Route path="/solutions/:solutionId" element={<SolutionRoute />} />
              <Route path="/solutions/:solutionId/:view" element={<SolutionRoute />} />
              <Route path="/solutions/:solutionId/flow/:flowName" element={<SolutionRoute />} />
              
              {/* Legacy routes for backward compatibility */}
              <Route path="/solution" element={<SolutionDetailPage />} />
              <Route path="/project-setup" element={<ProjectSetupPage />} />
              <Route path="/requirements" element={<RequirementsPage />} />
              <Route path="/clarifying-questions" element={<ClarifyingQuestionsPage />} />
              <Route path="/generation" element={<GenerationPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/deploy" element={<DeployPage />} />
              
              {/* Catch all - redirect to home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
