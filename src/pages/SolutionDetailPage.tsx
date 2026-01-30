import React from 'react';
import { 
  ArrowLeft, 
  Play, 
  FileSpreadsheet, 
  Rocket, 
  Layout, 
  Clock, 
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Edit3,
  Trash2,
  MoreHorizontal,
  Loader2
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { SavedSolution, WizardStep } from '../types';

// Step labels for display
const stepLabels: Record<WizardStep, string> = {
  'welcome': 'Getting Started',
  'dashboard': 'Dashboard',
  'solution-detail': 'Solution Details',
  'project-setup': 'Project Setup',
  'requirements': 'Requirements',
  'clarifying-questions': 'Clarifying Questions',
  'generation': 'Generation',
  'review': 'Review',
  'deploy': 'Deploy',
};

// Get progress percentage based on step
function getProgressPercentage(step?: WizardStep): number {
  const steps: WizardStep[] = ['project-setup', 'requirements', 'clarifying-questions', 'generation', 'review', 'deploy'];
  if (!step) return 0;
  const index = steps.indexOf(step);
  if (index === -1) return 0;
  return Math.round(((index + 1) / steps.length) * 100);
}

// Status badge component
function StatusBadge({ status }: { status: SavedSolution['status'] }) {
  const styles = {
    draft: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
    deployed: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    archived: 'bg-gray-400/10 text-gray-400 border-gray-400/20',
  };
  
  const icons = {
    draft: <Clock className="w-3.5 h-3.5" />,
    deployed: <CheckCircle2 className="w-3.5 h-3.5" />,
    archived: <AlertCircle className="w-3.5 h-3.5" />,
  };
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${styles[status]}`}>
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// Action card component
function ActionCard({ 
  icon: Icon, 
  title, 
  description, 
  onClick, 
  disabled,
  variant = 'default',
  external
}: { 
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'success';
  external?: boolean;
}) {
  const variants = {
    default: 'border-white/10 hover:border-white/20 hover:bg-white/5',
    primary: 'border-[#6366f1]/30 bg-[#6366f1]/10 hover:border-[#6366f1]/50 hover:bg-[#6366f1]/20',
    success: 'border-emerald-400/30 bg-emerald-400/10 hover:border-emerald-400/50 hover:bg-emerald-400/20',
  };
  
  const iconColors = {
    default: 'text-[#8585a3]',
    primary: 'text-[#a5b4fc]',
    success: 'text-emerald-400',
  };
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full p-5 rounded-xl border text-left transition-all duration-200 ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-xl bg-white/5 ${iconColors[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-medium">{title}</h3>
            {external && <ExternalLink className="w-3.5 h-3.5 text-[#6a6a75]" />}
          </div>
          <p className="text-sm text-[#6a6a75] mt-1">{description}</p>
        </div>
      </div>
    </button>
  );
}

export function SolutionDetailPage() {
  const activeSolutionId = useStore((state) => state.activeSolutionId);
  const savedSolutions = useStore((state) => state.savedSolutions);
  const setStep = useStore((state) => state.setStep);
  const setActiveSolution = useStore((state) => state.setActiveSolution);
  const setProjectConfig = useStore((state) => state.setProjectConfig);
  const setSolution = useStore((state) => state.setSolution);
  
  // Find the active solution
  const solution = savedSolutions.find(s => s.id === activeSolutionId);
  
  // If no solution found, redirect to dashboard
  if (!solution) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="w-12 h-12 text-[#6a6a75] mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Solution not found</h2>
        <p className="text-[#8585a3] mb-6">The solution you're looking for doesn't exist.</p>
        <button
          onClick={() => setStep('dashboard')}
          className="px-4 py-2 rounded-xl bg-[#6366f1] hover:bg-[#5558e3] text-white font-medium transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }
  
  const progress = getProgressPercentage(solution.currentStep);
  const isComplete = solution.currentStep === 'deploy' || solution.status === 'deployed';
  
  // Handle resume creation
  const handleResume = () => {
    // Set project config from solution
    setProjectConfig({
      clientName: solution.clientName,
      projectName: solution.name,
      projectType: solution.projectType,
      description: solution.description,
    });
    
    // If we have CSV content, restore the solution
    if (solution.csvContent) {
      setSolution({
        id: solution.id,
        nodes: [], // Will be parsed from CSV if needed
        csvContent: solution.csvContent,
        readme: '',
        spreadsheetUrl: solution.spreadsheetUrl,
      });
    }
    
    // Navigate to the saved step or project-setup
    const targetStep = solution.currentStep || 'project-setup';
    setStep(targetStep);
  };
  
  // Handle opening Google Sheets
  const handleOpenSheets = () => {
    if (solution.spreadsheetUrl) {
      window.open(solution.spreadsheetUrl, '_blank');
    }
  };
  
  // Handle opening Pypestream Bot
  const handleOpenBot = () => {
    if (solution.botUrl) {
      window.open(solution.botUrl, '_blank');
    }
  };
  
  // Handle opening Widget/Channel
  const handleOpenWidget = () => {
    if (solution.widgetUrl) {
      window.open(solution.widgetUrl, '_blank');
    }
  };
  
  // Handle back to dashboard
  const handleBack = () => {
    setActiveSolution(null);
    setStep('dashboard');
  };
  
  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={handleBack}
        className="flex items-center gap-2 text-[#8585a3] hover:text-white transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>
      
      {/* Header */}
      <div className="bg-[#1a1a1f] border border-white/5 rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{solution.name}</h1>
            <p className="text-[#8585a3]">{solution.clientName}</p>
          </div>
          <StatusBadge status={solution.status} />
        </div>
        
        <p className="text-[#6a6a75] mb-6">{solution.description}</p>
        
        {/* Meta info */}
        <div className="flex flex-wrap gap-6 text-sm text-[#6a6a75]">
          <div>
            <span className="text-[#5a5a65]">Created:</span>{' '}
            <span className="text-[#8585a3]">{formatDate(solution.createdAt)}</span>
          </div>
          <div>
            <span className="text-[#5a5a65]">Updated:</span>{' '}
            <span className="text-[#8585a3]">{formatDate(solution.updatedAt)}</span>
          </div>
          <div>
            <span className="text-[#5a5a65]">Nodes:</span>{' '}
            <span className="text-[#8585a3]">{solution.nodeCount}</span>
          </div>
          {solution.deployedEnvironment && (
            <div>
              <span className="text-[#5a5a65]">Environment:</span>{' '}
              <span className="text-[#a5b4fc]">{solution.deployedEnvironment}</span>
            </div>
          )}
        </div>
        
        {/* Progress bar for incomplete solutions */}
        {!isComplete && solution.currentStep && (
          <div className="mt-6 pt-6 border-t border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[#8585a3]">Creation Progress</span>
              <span className="text-sm text-[#6a6a75]">{progress}%</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#6366f1] to-[#a5b4fc] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-[#5a5a65] mt-2">
              Last step: {stepLabels[solution.currentStep]}
            </p>
          </div>
        )}
      </div>
      
      {/* Actions */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white mb-4">Actions</h2>
        
        <div className="grid gap-4 md:grid-cols-2">
          {/* Resume Creation - show if not complete */}
          {!isComplete && (
            <ActionCard
              icon={Play}
              title="Resume Creation"
              description={`Continue from ${solution.currentStep ? stepLabels[solution.currentStep] : 'the beginning'}`}
              onClick={handleResume}
              variant="primary"
            />
          )}
          
          {/* Edit Solution - show if complete */}
          {isComplete && (
            <ActionCard
              icon={Edit3}
              title="Edit Solution"
              description="Make changes to the generated bot CSV"
              onClick={handleResume}
              variant="default"
            />
          )}
          
          {/* Open in Google Sheets */}
          <ActionCard
            icon={FileSpreadsheet}
            title="Open in Google Sheets"
            description={solution.spreadsheetUrl ? 'View and edit the bot CSV in Google Sheets' : 'Export to Google Sheets to enable this action'}
            onClick={handleOpenSheets}
            disabled={!solution.spreadsheetUrl}
            variant={solution.spreadsheetUrl ? 'success' : 'default'}
            external={!!solution.spreadsheetUrl}
          />
          
          {/* View Bot in Pypestream */}
          <ActionCard
            icon={Rocket}
            title="View Bot in Pypestream"
            description={solution.botUrl ? 'Open the bot in Pypestream Bot Manager' : 'Deploy the bot to enable this action'}
            onClick={handleOpenBot}
            disabled={!solution.botUrl}
            variant={solution.botUrl ? 'success' : 'default'}
            external={!!solution.botUrl}
          />
          
          {/* View Channel/Widget */}
          <ActionCard
            icon={Layout}
            title="View Channel Design"
            description={solution.widgetUrl ? 'Preview the widget in the browser' : 'Create a channel to enable this action'}
            onClick={handleOpenWidget}
            disabled={!solution.widgetUrl}
            variant={solution.widgetUrl ? 'success' : 'default'}
            external={!!solution.widgetUrl}
          />
        </div>
      </div>
    </div>
  );
}
