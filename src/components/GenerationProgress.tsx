import { Loader2, Check, Clock, Zap, Box, FileCode, Rocket, CheckCircle } from 'lucide-react';

interface FlowProgress {
  status: 'pending' | 'generating' | 'done' | 'error';
  nodeCount: number;
  nodes: any[];
}

interface GenerationProgress {
  totalFlows: number;
  completedFlows: number;
  currentFlows: string[];
  nodesGenerated: number;
  flowProgress: Map<string, FlowProgress>;
  stage: 'planning' | 'generating' | 'converting' | 'deploying' | 'done';
  message: string;
}

interface PlannedFlow {
  name: string;
  description: string;
  startNode: number;
}

interface GenerationProgressPanelProps {
  progress: GenerationProgress;
  flows: PlannedFlow[];
}

const stageIcons = {
  planning: Clock,
  generating: Zap,
  converting: FileCode,
  deploying: Rocket,
  done: CheckCircle
};

const stageLabels = {
  planning: 'Planning',
  generating: 'Generating Flows',
  converting: 'Converting to CSV',
  deploying: 'Deploying',
  done: 'Complete'
};

export function GenerationProgressPanel({ progress, flows }: GenerationProgressPanelProps) {
  const StageIcon = stageIcons[progress.stage];
  const overallProgress = progress.stage === 'done' 
    ? 100 
    : Math.round((progress.completedFlows / Math.max(progress.totalFlows, 1)) * 80) + 
      (progress.stage === 'deploying' ? 10 : 0);
  
  const formatFlowName = (name: string): string => {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };
  
  return (
    <div className="bg-[#0f0f14] border border-white/10 rounded-2xl p-8 max-w-2xl w-full shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 flex items-center justify-center">
          {progress.stage === 'done' ? (
            <CheckCircle className="w-7 h-7 text-emerald-400" />
          ) : (
            <Loader2 className="w-7 h-7 text-[#a5b4fc] animate-spin" />
          )}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white">
            {progress.stage === 'done' ? 'Generation Complete' : 'Generating Solution'}
          </h2>
          <p className="text-sm text-[#6a6a75] mt-0.5">{progress.message}</p>
        </div>
      </div>
      
      {/* Overall Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-[#6a6a75] mb-2">
          <span>Overall Progress</span>
          <span>{overallProgress}%</span>
        </div>
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all duration-500 ease-out"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>
      
      {/* Stage Pills - now more compact and responsive */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(['planning', 'generating', 'converting', 'deploying', 'done'] as const).map((stage) => {
          const Icon = stageIcons[stage];
          const isActive = progress.stage === stage;
          const isPast = ['planning', 'generating', 'converting', 'deploying', 'done'].indexOf(progress.stage) > 
                         ['planning', 'generating', 'converting', 'deploying', 'done'].indexOf(stage);
          
          return (
            <div
              key={stage}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                isActive 
                  ? 'bg-[#6366f1]/20 text-[#a5b4fc] ring-1 ring-[#6366f1]/30' 
                  : isPast 
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-white/5 text-[#4a4a55]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{stageLabels[stage]}</span>
            </div>
          );
        })}
      </div>
      
      {/* Flow Progress List */}
      <div className="space-y-2 max-h-[240px] overflow-y-auto">
        {flows.map((flow) => {
          const flowProgress = progress.flowProgress.get(flow.name);
          const status = flowProgress?.status || 'pending';
          
          return (
            <div 
              key={flow.name}
              className={`flex items-center justify-between p-3 rounded-lg transition-all ${
                status === 'generating' 
                  ? 'bg-[#6366f1]/10 ring-1 ring-[#6366f1]/20' 
                  : status === 'done'
                    ? 'bg-emerald-500/5'
                    : 'bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  status === 'generating' 
                    ? 'bg-[#6366f1]/20' 
                    : status === 'done'
                      ? 'bg-emerald-500/10'
                      : 'bg-white/5'
                }`}>
                  {status === 'generating' ? (
                    <Loader2 className="w-4 h-4 text-[#a5b4fc] animate-spin" />
                  ) : status === 'done' ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Box className="w-4 h-4 text-[#4a4a55]" />
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${
                    status === 'generating' 
                      ? 'text-white' 
                      : status === 'done'
                        ? 'text-emerald-300'
                        : 'text-[#6a6a75]'
                  }`}>
                    {formatFlowName(flow.name)}
                  </p>
                  {status === 'generating' && (
                    <p className="text-xs text-[#6a6a75]">Generating nodes...</p>
                  )}
                  {status === 'done' && (
                    <p className="text-xs text-emerald-400/60">
                      {flowProgress?.nodeCount ? `${flowProgress.nodeCount} nodes` : 'Complete'}
                    </p>
                  )}
                </div>
              </div>
              
              {status === 'done' && (
                <CheckCircle className="w-5 h-5 text-emerald-400" />
              )}
            </div>
          );
        })}
      </div>
      
      {/* Stats Footer */}
      <div className="mt-6 pt-4 border-t border-white/5 flex justify-between text-sm">
        <div className="text-[#6a6a75]">
          <span className="text-white font-medium">{progress.completedFlows}</span>
          <span> of {progress.totalFlows} flows</span>
        </div>
        <div className="text-[#6a6a75]">
          <span className="text-white font-medium">{progress.nodesGenerated}</span>
          <span> nodes generated</span>
        </div>
      </div>
    </div>
  );
}
