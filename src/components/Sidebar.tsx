import { useStore } from '../store/useStore';
import { useAuth } from '../contexts/AuthContext';
import type { WizardStep } from '../types';
import { 
  Home, 
  FolderPlus, 
  FileText, 
  HelpCircle, 
  Sparkles, 
  CheckCircle2, 
  Rocket,
  Check,
  LogOut,
  User
} from 'lucide-react';

const steps: { id: WizardStep; label: string; icon: React.ElementType }[] = [
  { id: 'welcome', label: 'Welcome', icon: Home },
  { id: 'project-setup', label: 'Project Setup', icon: FolderPlus },
  { id: 'requirements', label: 'Requirements', icon: FileText },
  { id: 'clarifying-questions', label: 'Clarify Details', icon: HelpCircle },
  { id: 'generation', label: 'Generate Solution', icon: Sparkles },
  { id: 'review', label: 'Review & Validate', icon: CheckCircle2 },
  { id: 'deploy', label: 'Deploy', icon: Rocket },
];

export function Sidebar() {
  const { currentStep, setStep, user, activeSolutionId, savedSolutions, solution } = useStore();
  const { signOut } = useAuth();
  
  const currentIndex = steps.findIndex((s) => s.id === currentStep);
  
  // Get the highest step reached for the active solution
  // This allows users to navigate back to any previously completed step
  const getHighestStepIndex = (): number => {
    // If we have a deployed solution, all steps are accessible
    const activeSolution = savedSolutions.find(s => s.id === activeSolutionId);
    if (activeSolution?.status === 'deployed') {
      return steps.length - 1; // All steps accessible
    }
    
    // If we have CSV content (solution generated), at least up to review
    if (solution?.csvContent) {
      const reviewIndex = steps.findIndex(s => s.id === 'review');
      return Math.max(currentIndex, reviewIndex);
    }
    
    // Check the saved solution's currentStep
    if (activeSolution?.currentStep) {
      const savedStepIndex = steps.findIndex(s => s.id === activeSolution.currentStep);
      return Math.max(currentIndex, savedStepIndex);
    }
    
    return currentIndex;
  };
  
  const highestStepIndex = getHighestStepIndex();
  
  return (
    <aside className="w-[260px] flex flex-col bg-[rgba(10,10,15,0.7)] border-r border-[rgba(255,255,255,0.04)] fixed top-0 left-0 h-screen z-40">
      {/* Logo - Click to go to dashboard */}
      <div className="h-16 flex items-center px-5 border-b border-[rgba(255,255,255,0.04)]">
        <button 
          onClick={() => setStep('dashboard')}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <img 
            src="/pypestream-logo.png" 
            alt="Solution Designer" 
            className="w-8 h-8 rounded-lg"
          />
          <span className="text-[#e8e8f0] font-semibold text-[15px] tracking-[-0.01em]">Solution Designer</span>
        </button>
      </div>
      
      {/* Steps */}
      <nav className="flex-1 py-5 px-3 overflow-y-auto">
        <div className="text-overline px-3 mb-3">Progress</div>
        <ul className="space-y-0.5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.id === currentStep;
            // A step is completed if it's before the current step OR before the highest reached step
            const isCompleted = index < currentIndex || (index < highestStepIndex && index !== currentIndex);
            // A step is accessible if it's at or before the highest reached step, or one step ahead
            const isAccessible = index <= highestStepIndex || index <= currentIndex + 1;
            const isDisabled = !isAccessible;
            
            return (
              <li key={step.id}>
                <button
                  onClick={() => !isDisabled && setStep(step.id)}
                  disabled={isDisabled}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] 
                    transition-all duration-200 ease-out
                    group relative
                    ${isActive 
                      ? 'bg-gradient-to-r from-[rgba(99,102,241,0.12)] to-[rgba(99,102,241,0.06)] text-[#a5b4fc]' 
                      : isCompleted
                        ? 'text-[#c4c4d6] hover:bg-[rgba(255,255,255,0.03)]'
                        : isDisabled
                          ? 'text-[#3d3d52] cursor-not-allowed'
                          : 'text-[#8585a3] hover:bg-[rgba(255,255,255,0.03)] hover:text-[#c4c4d6]'
                    }
                  `}
                >
                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#6366f1] rounded-r-full" />
                  )}
                  
                  {/* Step indicator */}
                  <div className={`
                    w-6 h-6 rounded-full flex items-center justify-center shrink-0
                    text-[11px] font-semibold
                    transition-all duration-200
                    ${isActive 
                      ? 'bg-[#6366f1] text-white shadow-[0_0_12px_rgba(99,102,241,0.4)]' 
                      : isCompleted
                        ? 'bg-[rgba(34,197,94,0.15)] text-[#4ade80] border border-[rgba(34,197,94,0.3)]'
                        : 'bg-[rgba(255,255,255,0.05)] text-[#5c5c78] border border-[rgba(255,255,255,0.06)]'
                    }
                  `}>
                    {isCompleted ? (
                      <Check className="w-3 h-3" strokeWidth={3} />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  
                  {/* Label */}
                  <span className="text-[13px] font-medium truncate">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      
      {/* User & Sign Out */}
      <div className="p-4 border-t border-[rgba(255,255,255,0.04)]">
        {user.email && (
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-[rgba(99,102,241,0.15)] border border-[rgba(99,102,241,0.2)] flex items-center justify-center">
              {user.avatar ? (
                <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full" />
              ) : (
                <User className="w-4 h-4 text-[#a5b4fc]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-[#e8e8f0] truncate">
                {user.name || 'User'}
              </div>
              <div className="text-[11px] text-[#5c5c78] truncate">
                {user.email}
              </div>
            </div>
          </div>
        )}
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] text-[#8585a3] hover:text-[#e8e8f0] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
