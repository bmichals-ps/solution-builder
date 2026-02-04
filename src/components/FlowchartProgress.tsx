import { useEffect, useState, useRef } from 'react';
import { Check, Loader2, Database, GitBranch, Boxes, CheckCircle2, Sparkles, LayoutGrid } from 'lucide-react';
import type { SequentialProgressState, FlowProgressItem } from '../services/instant-build';

interface FlowchartProgressProps {
  sequentialProgress?: SequentialProgressState;
}

type NodeStatus = 'hidden' | 'pending' | 'active' | 'done' | 'error';

interface FlowNode {
  id: string;
  label: string;
  status: NodeStatus;
  x: number;
  y: number;
  icon?: React.ComponentType<{ className?: string }>;
  error?: string;  // Error message to show on hover
}

/**
 * FlowchartProgress - Real-time animated visualization of bot generation
 * 
 * Shows the sequential generation process as an animated flowchart:
 * - Planning → Startup → Flows → Assembly
 * - Nodes appear when they become active
 * - Connections animate between related nodes
 */
export function FlowchartProgress({ sequentialProgress }: FlowchartProgressProps) {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [connections, setConnections] = useState<{ from: string; to: string; active: boolean }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Fixed positions for layout (relative to container)
  const LAYOUT = {
    width: 420,
    height: 500,
    centerX: 210,
    nodeWidth: 160,
    nodeHeight: 52, // Taller to accommodate 2-line text
  };
  
  // Update nodes based on sequential progress
  useEffect(() => {
    if (!sequentialProgress) {
      // Initial state - show placeholder
      setNodes([]);
      setConnections([]);
      return;
    }
    
    const { phase, status, flows } = sequentialProgress;
    const newNodes: FlowNode[] = [];
    const newConnections: { from: string; to: string; active: boolean }[] = [];
    
    // Planning node - always visible once we start
    const planningStatus = getNodeStatus('planning', phase, status);
    if (planningStatus !== 'hidden') {
      newNodes.push({
        id: 'planning',
        label: 'Planning',
        status: planningStatus,
        x: LAYOUT.centerX,
        y: 40,
        icon: Sparkles,
      });
    }
    
    // Startup node (System Nodes)
    const startupStatus = getNodeStatus('startup', phase, status);
    if (startupStatus !== 'hidden') {
      newNodes.push({
        id: 'startup',
        label: 'System Nodes',
        status: startupStatus,
        x: LAYOUT.centerX,
        y: 110,
        icon: Database,
      });
      if (planningStatus !== 'hidden') {
        newConnections.push({ 
          from: 'planning', 
          to: 'startup', 
          active: startupStatus === 'active' || planningStatus === 'done'
        });
      }
    }
    
    // Main Menu node - shown after startup is done
    const mainMenuStatus = startupStatus === 'done' ? 'done' : 
                           startupStatus === 'active' ? 'pending' : 'hidden';
    if (mainMenuStatus !== 'hidden') {
      newNodes.push({
        id: 'mainmenu',
        label: 'Main Menu',
        status: mainMenuStatus,
        x: LAYOUT.centerX,
        y: 180,
        icon: LayoutGrid,
      });
      if (startupStatus !== 'hidden') {
        newConnections.push({
          from: 'startup',
          to: 'mainmenu',
          active: mainMenuStatus === 'done' || startupStatus === 'done'
        });
      }
    }
    
    // Flow nodes - show them as they are generated
    // Use vertical stacking for flows to avoid overlap
    const flowsToShow = flows.filter(f => f.status !== 'pending' || phase === 'flow' || phase === 'assembly' || phase === 'validation');
    const numFlows = Math.max(flowsToShow.length, 1);
    
    // Calculate flow positions - stack vertically with slight horizontal offset
    const flowStartY = 260;
    const flowVerticalSpacing = 65; // Vertical spacing between flows
    
    flowsToShow.forEach((flow, index) => {
      const flowId = `flow-${index}`;
      const flowStatus = flow.status === 'active' ? 'active' : flow.status === 'done' ? 'done' : flow.status === 'error' ? 'error' : 'pending';
      
      // Alternate left/right for visual interest, center if only 1-2 flows
      let xOffset = 0;
      if (numFlows > 2) {
        xOffset = (index % 2 === 0 ? -80 : 80);
      } else if (numFlows === 2) {
        xOffset = (index === 0 ? -70 : 70);
      }
      
      newNodes.push({
        id: flowId,
        label: formatFlowName(flow.name),
        status: flowStatus,
        x: LAYOUT.centerX + xOffset,
        y: flowStartY + index * flowVerticalSpacing,
        icon: GitBranch,
        error: flow.error,  // Pass error message for tooltip
      });
      
      // Connect from main menu to each flow
      if (mainMenuStatus === 'done' || phase === 'flow' || phase === 'assembly' || phase === 'validation') {
        newConnections.push({
          from: 'mainmenu',
          to: flowId,
          active: flowStatus === 'active' || flowStatus === 'done'
        });
      }
    });
    
    // Calculate assembly Y position based on number of flows
    const assemblyY = flowStartY + (numFlows * flowVerticalSpacing) + 40;
    
    // Assembly node
    const assemblyStatus = getNodeStatus('assembly', phase, status);
    if (assemblyStatus !== 'hidden') {
      newNodes.push({
        id: 'assembly',
        label: 'Assembly',
        status: assemblyStatus,
        x: LAYOUT.centerX,
        y: assemblyY,
        icon: Boxes,
      });
      
      // Connect from flows to assembly
      flowsToShow.forEach((_, index) => {
        const flowId = `flow-${index}`;
        newConnections.push({
          from: flowId,
          to: 'assembly',
          active: assemblyStatus === 'active' || assemblyStatus === 'done'
        });
      });
    }
    
    // Complete node
    const validationStatus = getNodeStatus('validation', phase, status);
    if (validationStatus !== 'hidden') {
      newNodes.push({
        id: 'validation',
        label: 'Complete',
        status: validationStatus,
        x: LAYOUT.centerX,
        y: assemblyY + 70,
        icon: CheckCircle2,
      });
      
      if (assemblyStatus !== 'hidden') {
        newConnections.push({
          from: 'assembly',
          to: 'validation',
          active: validationStatus === 'active' || validationStatus === 'done'
        });
      }
    }
    
    setNodes(newNodes);
    setConnections(newConnections);
  }, [sequentialProgress]);
  
  // Helper to determine node status based on current phase
  function getNodeStatus(nodePhase: string, currentPhase: string, currentStatus: string): NodeStatus {
    const phaseOrder = ['planning', 'startup', 'flow', 'assembly', 'validation'];
    const nodeIndex = phaseOrder.indexOf(nodePhase);
    const currentIndex = phaseOrder.indexOf(currentPhase);
    
    if (nodeIndex < currentIndex) {
      return 'done';
    } else if (nodeIndex === currentIndex) {
      return currentStatus === 'done' ? 'done' : currentStatus === 'error' ? 'error' : 'active';
    } else if (nodeIndex === currentIndex + 1 && currentStatus === 'done') {
      return 'pending';
    }
    return 'hidden';
  }
  
  // Format flow name for display - no truncation, allow full name
  function formatFlowName(name: string): string {
    // Convert snake_case to Title Case
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  
  // Render if no progress yet
  if (!sequentialProgress) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/5 flex items-center justify-center mb-4">
          <GitBranch className="w-8 h-8 text-[#6366f1]/50" />
        </div>
        <h3 className="text-lg font-medium text-white/70 mb-2">Solution Architecture</h3>
        <p className="text-sm text-[#6a6a75]">
          Visualizing your bot's conversation flows...
        </p>
      </div>
    );
  }
  
  // Calculate dynamic height based on number of flows
  const numFlows = sequentialProgress?.flows?.length || 0;
  const dynamicHeight = Math.max(LAYOUT.height, 250 + (numFlows * 60) + 100);
  
  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center overflow-auto">
      <svg 
        width={LAYOUT.width} 
        height={dynamicHeight} 
        className="absolute inset-0 m-auto"
        style={{ overflow: 'visible' }}
      >
        {/* Render connections */}
        {connections.map((conn, idx) => {
          const fromNode = nodes.find(n => n.id === conn.from);
          const toNode = nodes.find(n => n.id === conn.to);
          if (!fromNode || !toNode) return null;
          
          const startY = fromNode.y + LAYOUT.nodeHeight / 2;
          const endY = toNode.y - LAYOUT.nodeHeight / 2;
          
          return (
            <g key={`${conn.from}-${conn.to}-${idx}`}>
              <line
                x1={fromNode.x}
                y1={startY}
                x2={toNode.x}
                y2={endY}
                stroke={conn.active ? '#6366f1' : '#2a2a35'}
                strokeWidth={2}
                className={`transition-all duration-500 ${conn.active ? 'opacity-100' : 'opacity-40'}`}
                strokeDasharray={conn.active ? '0' : '4 4'}
              />
              {/* Animated dot for active connections */}
              {conn.active && (
                <circle r="3" fill="#a5b4fc" className="animate-pulse">
                  <animateMotion
                    dur="1.5s"
                    repeatCount="indefinite"
                    path={`M${fromNode.x},${startY} L${toNode.x},${endY}`}
                  />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
      
      {/* Render nodes */}
      <div 
        className="relative" 
        style={{ width: LAYOUT.width, height: dynamicHeight }}
      >
        {nodes.map((node) => (
          <FlowchartNode key={node.id} node={node} layout={LAYOUT} />
        ))}
      </div>
      
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 text-center">
        <h3 className="text-sm font-medium text-white/80">Solution Architecture</h3>
        <p className="text-xs text-[#6a6a75] mt-1">
          {sequentialProgress.phase === 'planning' && 'Analyzing requirements...'}
          {sequentialProgress.phase === 'startup' && 'Building system foundation...'}
          {sequentialProgress.phase === 'flow' && `Generating flows (${(sequentialProgress.currentFlowIndex || 0) + 1}/${sequentialProgress.totalFlows || 1})...`}
          {sequentialProgress.phase === 'assembly' && 'Assembling solution...'}
          {sequentialProgress.phase === 'validation' && 'Finalizing...'}
        </p>
      </div>
    </div>
  );
}

/**
 * Individual flowchart node component
 */
function FlowchartNode({ 
  node, 
  layout 
}: { 
  node: FlowNode; 
  layout: { nodeWidth: number; nodeHeight: number } 
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const Icon = node.icon || GitBranch;
  
  const statusStyles = {
    hidden: 'opacity-0 scale-75',
    pending: 'opacity-50 bg-[#1a1a24] border-[#2a2a35]',
    active: 'opacity-100 bg-[#6366f1]/10 border-[#6366f1] shadow-lg shadow-[#6366f1]/20 animate-pulse-subtle',
    done: 'opacity-100 bg-[#22c55e]/10 border-[#22c55e]',
    error: 'opacity-100 bg-red-500/10 border-red-500 cursor-pointer',
  };
  
  const iconStyles = {
    hidden: 'text-[#4a4a55]',
    pending: 'text-[#6a6a75]',
    active: 'text-[#a5b4fc]',
    done: 'text-[#22c55e]',
    error: 'text-red-400',
  };
  
  const hasError = node.status === 'error' && node.error;
  
  return (
    <div
      className={`
        absolute flex items-center gap-2 px-3 py-2 rounded-xl border
        transition-all duration-500 ease-out transform
        ${statusStyles[node.status]}
      `}
      style={{
        left: node.x - layout.nodeWidth / 2,
        top: node.y - layout.nodeHeight / 2,
        width: layout.nodeWidth,
        minHeight: layout.nodeHeight,
      }}
      onMouseEnter={() => hasError && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className={`flex-shrink-0 self-start mt-0.5 ${iconStyles[node.status]}`}>
        {node.status === 'active' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : node.status === 'done' ? (
          <Check className="w-4 h-4" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      <span className={`text-xs font-medium leading-tight ${
        node.status === 'done' ? 'text-[#22c55e]' :
        node.status === 'active' ? 'text-white' :
        node.status === 'error' ? 'text-red-400' :
        'text-[#8585a3]'
      }`}>
        {node.label}
      </span>
      
      {/* Error tooltip */}
      {showTooltip && hasError && (
        <div 
          className="absolute z-50 left-full ml-2 top-1/2 -translate-y-1/2 w-64 p-3 bg-[#1a1a24] border border-red-500/30 rounded-lg shadow-xl"
          style={{ maxWidth: '280px' }}
        >
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-red-400 text-xs">!</span>
            </div>
            <div>
              <p className="text-xs font-medium text-red-400 mb-1">Generation Failed</p>
              <p className="text-xs text-[#8585a3] leading-relaxed">{node.error}</p>
            </div>
          </div>
          {/* Tooltip arrow */}
          <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[6px] border-r-red-500/30" />
        </div>
      )}
    </div>
  );
}

export default FlowchartProgress;
