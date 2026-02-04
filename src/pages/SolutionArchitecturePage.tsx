import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { instantBuild } from '../services/instant-build';
import { createChannelWithWidget } from '../services/botmanager';
import { GenerationProgressPanel } from '../components/GenerationProgress';
import { ResultsModal } from '../components/ResultsModal';
import type { InstantBuildResult, ArchitectureState } from '../types';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Handle,
  Position,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import type { Node, Edge, Connection, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  ArrowLeft, 
  ArrowRight, 
  Sparkles, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  Loader2,
  RefreshCw,
  Boxes,
  Home,
  GitBranch,
  MessageCircle,
  Bot,
  Send,
  Maximize2,
  Type,
  Brain,
  LayoutGrid,
  List,
  Calendar,
  Upload,
  Image as ImageIcon,
  Code,
  Play,
  CheckCircle,
  XCircle,
  Copy,
  Download,
  Rocket,
  ChevronDown,
  Key,
  AlertCircle
} from 'lucide-react';

// ============================================
// CUSTOM NODE COMPONENTS
// ============================================

// Start Node (Entry Point)
function StartNode() {
  return (
    <div className="px-4 py-3 rounded-full bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/30 border-2 border-white/20">
      <Handle type="source" position={Position.Bottom} className="!bg-white !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4" />
        <span className="font-medium text-sm">Start</span>
      </div>
    </div>
  );
}

// Main Menu Node - Wide container with inline buttons and edit mode
function MenuNode({ data, id }: NodeProps) {
  const menuOptions = (data.menuOptions || []) as Array<{ label: string; flowName?: string; handleId?: string }>;
  const flows = (data.availableFlows || []) as Array<{ name: string; label: string }>;
  const buttonCount = menuOptions.length || 1;
  const [isEditing, setIsEditing] = useState(false);
  const [editingButtonIdx, setEditingButtonIdx] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  
  const onUpdateMenu = data.onUpdateMenu as ((id: string, options: Array<{ label: string; flowName?: string }>) => void) | undefined;
  
  // Handle button label edit
  const startEditButton = (idx: number) => {
    setEditingButtonIdx(idx);
    setEditLabel(menuOptions[idx]?.label || '');
  };
  
  const saveButtonLabel = () => {
    if (editingButtonIdx !== null && onUpdateMenu) {
      const updated = [...menuOptions];
      updated[editingButtonIdx] = { ...updated[editingButtonIdx], label: editLabel };
      onUpdateMenu(id, updated);
    }
    setEditingButtonIdx(null);
  };
  
  const deleteButton = (idx: number) => {
    if (onUpdateMenu) {
      const updated = menuOptions.filter((_, i) => i !== idx);
      onUpdateMenu(id, updated);
    }
  };
  
  const addButton = () => {
    if (onUpdateMenu) {
      const updated = [...menuOptions, { label: 'New Option', flowName: '' }];
      onUpdateMenu(id, updated);
    }
  };
  
  const changeRouting = (idx: number, flowName: string) => {
    if (onUpdateMenu) {
      const updated = [...menuOptions];
      updated[idx] = { ...updated[idx], flowName };
      onUpdateMenu(id, updated);
    }
  };
  
  // Edit mode view
  if (isEditing) {
    return (
      <div className="relative min-w-[300px] rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white shadow-xl shadow-indigo-500/30 border-2 border-white/20">
        <Handle type="target" position={Position.Top} className="!bg-white !w-3 !h-3" />
        
        {/* Header with Done button */}
        <div className="px-4 py-2 border-b border-white/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Home className="w-4 h-4" />
            <span className="font-semibold text-sm">Edit Menu</span>
          </div>
          <button
            onClick={() => setIsEditing(false)}
            className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium"
          >
            Done
          </button>
        </div>
        
        {/* Editable Buttons List */}
        <div className="px-3 py-3 space-y-2">
          {menuOptions.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {editingButtonIdx === idx ? (
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onBlur={saveButtonLabel}
                  onKeyDown={(e) => e.key === 'Enter' && saveButtonLabel()}
                  className="flex-1 px-2 py-1 bg-white/10 border border-white/30 rounded text-xs text-white focus:outline-none"
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => startEditButton(idx)}
                  className="flex-1 px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs text-left truncate"
                >
                  {opt.label}
                </button>
              )}
              
              {/* Routing dropdown */}
              <select
                value={opt.flowName || ''}
                onChange={(e) => changeRouting(idx, e.target.value)}
                className="px-1 py-1 bg-white/10 border border-white/20 rounded text-[10px] text-white focus:outline-none cursor-pointer"
                title="Route to flow"
              >
                <option value="" className="bg-[#1a1a24] text-white">Select flow...</option>
                {flows.map((flow) => (
                  <option key={flow.name} value={flow.name} className="bg-[#1a1a24] text-white">
                    {flow.label}
                  </option>
                ))}
              </select>
              
              {/* Delete button */}
              <button
                onClick={() => deleteButton(idx)}
                className="p-1 text-white/50 hover:text-red-300 hover:bg-red-400/20 rounded"
                title="Delete button"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          
          {/* Add button */}
          <button
            onClick={addButton}
            className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-white/10 hover:bg-white/20 rounded text-xs text-white/70 hover:text-white"
          >
            <Plus className="w-3 h-3" />
            Add Button
          </button>
        </div>
        
        {/* Connection handles */}
        {menuOptions.map((_, idx) => {
          const percentage = ((idx + 0.5) / buttonCount) * 100;
          return (
            <Handle
              key={`btn-${idx}`}
              type="source"
              position={Position.Bottom}
              id={`btn-${idx}`}
              className="!bg-white !w-2.5 !h-2.5 !border-2 !border-[#6366f1]"
              style={{ left: `${percentage}%` }}
            />
          );
        })}
      </div>
    );
  }
  
  // Normal view with hover-to-reveal edit button
  return (
    <div className="group relative rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white shadow-xl shadow-indigo-500/30 border-2 border-white/20">
      <Handle type="target" position={Position.Top} className="!bg-white !w-3 !h-3" />
      
      {/* Header with edit button on hover */}
      <div className="px-4 py-2 border-b border-white/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Home className="w-4 h-4" />
          <span className="font-semibold text-sm">{String(data.label || 'Main Menu')}</span>
        </div>
        <button
          onClick={() => setIsEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-white/60 hover:text-white hover:bg-white/20 rounded"
          title="Edit menu"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </div>
      
      {/* Buttons Row */}
      <div className="px-3 py-3 flex items-center gap-2 flex-wrap">
        {menuOptions.map((opt, idx) => (
          <div
            key={idx}
            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-md text-[11px] font-medium text-white cursor-default transition-colors whitespace-nowrap"
          >
            {opt.label}
          </div>
        ))}
      </div>
      
      {/* Connection handles */}
      {menuOptions.map((_, idx) => {
        const percentage = ((idx + 0.5) / buttonCount) * 100;
        return (
          <Handle
            key={`btn-${idx}`}
            type="source"
            position={Position.Bottom}
            id={`btn-${idx}`}
            className="!bg-white !w-2.5 !h-2.5 !border-2 !border-[#6366f1]"
            style={{ left: `${percentage}%` }}
          />
        );
      })}
    </div>
  );
}

// Flow Node (Editable + Clickable for drill-down) - Sized to fit content
function FlowNode({ data, id }: NodeProps) {
  const [editLabel, setEditLabel] = useState(String(data.label || ''));
  const [editDesc, setEditDesc] = useState(String(data.description || ''));
  
  const onEdit = data.onEdit as ((id: string) => void) | undefined;
  const onDelete = data.onDelete as ((id: string) => void) | undefined;
  const onSave = data.onSave as ((id: string, label: string, description: string) => void) | undefined;
  const onCancel = data.onCancel as ((id: string) => void) | undefined;
  const onDrillDown = data.onDrillDown as ((flowName: string, flowLabel: string, description: string) => void) | undefined;
  
  const description = String(data.description || '');
  const flowName = id.replace('flow-', '');
  
  if (data.isEditing) {
    return (
      <div className="w-[240px] rounded-xl bg-[#1a1a24] border-2 border-[#6366f1] shadow-xl shadow-[#6366f1]/20">
        <Handle type="target" position={Position.Top} className="!bg-[#6366f1] !w-3 !h-3" />
        <div className="p-4 space-y-3">
          <input
            type="text"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            className="w-full px-3 py-2 bg-[#12121a] border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[#6366f1]"
            placeholder="Flow name"
            autoFocus
          />
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            className="w-full px-3 py-2 bg-[#12121a] border border-white/10 rounded-lg text-white text-xs resize-none focus:outline-none focus:border-[#6366f1]"
            rows={3}
            placeholder="Description..."
          />
          <div className="flex gap-2">
            <button
              onClick={() => onSave?.(id, editLabel, editDesc)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#6366f1] text-white text-xs rounded-lg hover:bg-[#5558e3]"
            >
              <Check className="w-3 h-3" /> Save
            </button>
            <button
              onClick={() => onCancel?.(id)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white/5 text-white/60 text-xs rounded-lg hover:bg-white/10"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-[#6366f1] !w-3 !h-3" />
      </div>
    );
  }
  
  return (
    <div 
      className="group w-[240px] rounded-xl bg-[#12121a] border border-white/10 shadow-lg hover:border-[#6366f1]/50 hover:shadow-[#6366f1]/10 transition-all cursor-pointer"
      onClick={() => onDrillDown?.(flowName, String(data.label || ''), description)}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#6366f1] !w-3 !h-3" />
      {/* Header */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-4 h-4 text-[#a5b4fc] shrink-0" />
            <span className="font-medium text-sm text-white">{String(data.label || '')}</span>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit?.(id); }}
              className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(id); }}
              className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-lg"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {data.startNode !== undefined && (
          <span className="text-[10px] text-white/30 font-mono mt-0.5 block">Node {String(data.startNode)}</span>
        )}
      </div>
      {/* Description + Click hint */}
      <div className="px-4 pb-4 pt-0">
        <p className="text-xs text-white/50 leading-relaxed">
          {description}
        </p>
        <p className="text-[10px] text-[#6366f1]/60 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          Click to view conversation flow →
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#6366f1] !w-3 !h-3" />
    </div>
  );
}

// Endpoint Node (End Chat, Agent Transfer, etc.) - with inline editing
function EndpointNode({ data, id }: NodeProps) {
  const label = String(data.label || '');
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(label);
  
  const onUpdateLabel = data.onUpdateLabel as ((id: string, label: string) => void) | undefined;
  
  const isAgent = label.toLowerCase().includes('agent');
  const bgColor = isAgent ? 'from-amber-500 to-orange-500' : 'from-rose-500 to-red-500';
  const shadowColor = isAgent ? 'shadow-amber-500/30' : 'shadow-rose-500/30';
  
  const saveLabel = () => {
    if (onUpdateLabel && editLabel.trim()) {
      onUpdateLabel(id, editLabel.trim());
    }
    setIsEditing(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveLabel();
    } else if (e.key === 'Escape') {
      setEditLabel(label);
      setIsEditing(false);
    }
  };
  
  return (
    <div className={`group px-4 py-3 rounded-xl bg-gradient-to-r ${bgColor} text-white shadow-lg ${shadowColor} border-2 border-white/20`}>
      <Handle type="target" position={Position.Top} className="!bg-white !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <MessageCircle className="w-4 h-4 shrink-0" />
        {isEditing ? (
          <input
            type="text"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={saveLabel}
            onKeyDown={handleKeyDown}
            className="bg-white/20 border border-white/30 rounded px-2 py-0.5 text-sm font-medium text-white focus:outline-none w-24"
            autoFocus
          />
        ) : (
          <>
            <span className="font-medium text-sm">{label}</span>
            <button
              onClick={() => {
                setEditLabel(label);
                setIsEditing(true);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-white/60 hover:text-white rounded"
              title="Edit label"
            >
              <Edit2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Convergence Node - Small dot where all flows converge before endpoints
function ConvergenceNode() {
  return (
    <div className="w-3 h-3 rounded-full bg-[#4a4a55] border-2 border-[#6a6a75]">
      <Handle type="target" position={Position.Top} className="!bg-transparent !w-full !h-full !border-0 !top-0 !left-0 !transform-none" />
      <Handle type="source" position={Position.Bottom} id="left" className="!bg-[#4a4a55] !w-2 !h-2" style={{ left: '20%' }} />
      <Handle type="source" position={Position.Bottom} id="right" className="!bg-[#4a4a55] !w-2 !h-2" style={{ left: '80%' }} />
    </div>
  );
}

// ============================================
// CONVERSATION DETAIL NODE COMPONENTS
// ============================================

// Question node - Bot asks a question
function ConversationQuestionNode({ data }: NodeProps) {
  return (
    <div className="w-[360px] rounded-xl bg-[#1a1a28] border-2 border-[#6366f1]/40 shadow-lg shadow-[#6366f1]/10">
      <Handle type="target" position={Position.Top} className="!bg-[#6366f1] !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-[#6366f1]/20 bg-[#6366f1]/10">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-[#a5b4fc]" />
          <span className="text-xs text-[#a5b4fc] font-semibold uppercase tracking-wide">Question</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white leading-relaxed">{String(data.message || data.label || '')}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#6366f1] !w-3 !h-3" />
    </div>
  );
}

// Response/Message node - Bot sends information
function ConversationResponseNode({ data }: NodeProps) {
  return (
    <div className="w-[360px] rounded-xl bg-[#12121a] border border-emerald-500/30 shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-emerald-500 !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wide">Response</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white/90 leading-relaxed">{String(data.message || data.label || '')}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !w-3 !h-3" />
    </div>
  );
}

// Action node - Backend operation (clickable for code generation)
function ConversationActionNode({ data }: NodeProps) {
  const onGenerateCode = data.onGenerateCode as ((nodeData: any) => void) | undefined;
  
  return (
    <div 
      className="w-[280px] rounded-xl bg-amber-500/10 border-2 border-amber-500/30 shadow-lg cursor-pointer hover:border-amber-500/60 hover:shadow-amber-500/20 transition-all group"
      onClick={() => onGenerateCode?.({ type: 'action', label: data.label, message: data.message })}
    >
      <Handle type="target" position={Position.Top} className="!bg-amber-500 !w-3 !h-3" />
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <span className="text-[10px] text-amber-400/70 uppercase tracking-wide">Action Node</span>
          <p className="text-sm text-amber-200">{String(data.label || 'Process')}</p>
        </div>
        <span className="text-[10px] text-amber-400/50 opacity-0 group-hover:opacity-100 transition-opacity">
          →
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-amber-500 !w-3 !h-3" />
    </div>
  );
}

// Message node - Generic bot message
function ConversationMessageNode({ data }: NodeProps) {
  return (
    <div className="w-[360px] rounded-xl bg-[#12121a] border border-white/10 shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-white/50 !w-3 !h-3" />
      <div className="px-4 py-4">
        <p className="text-sm text-white/80 leading-relaxed">{String(data.message || data.label || '')}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-white/50 !w-3 !h-3" />
    </div>
  );
}

// Free Text Input node - Open-ended user input
function ConversationFreetextNode({ data }: NodeProps) {
  return (
    <div className="w-[360px] rounded-xl bg-[#1a1a28] border-2 border-cyan-500/40 shadow-lg shadow-cyan-500/10">
      <Handle type="target" position={Position.Top} className="!bg-cyan-500 !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-cyan-500/20 bg-cyan-500/10">
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-cyan-400" />
          <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wide">Free Text Input</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white leading-relaxed mb-3">{String(data.message || data.label || '')}</p>
        <div className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/40 italic">
          {String(data.placeholder || 'User types here...')}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-500 !w-3 !h-3" />
    </div>
  );
}

// NLU Intent node - Natural language understanding (clickable for code generation)
function ConversationNluNode({ data }: NodeProps) {
  const intents = (data.intents as string[]) || [];
  const onGenerateCode = data.onGenerateCode as ((nodeData: any) => void) | undefined;
  
  return (
    <div 
      className="w-[360px] rounded-xl bg-[#1a1a28] border-2 border-violet-500/40 shadow-lg shadow-violet-500/10 cursor-pointer hover:border-violet-500/70 hover:shadow-violet-500/20 transition-all group"
      onClick={() => onGenerateCode?.({ type: 'nlu_intent', intents, message: data.message })}
    >
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-violet-500/20 bg-violet-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-violet-400 font-semibold uppercase tracking-wide">NLU Intent Detection</span>
          </div>
          <span className="text-[10px] text-violet-400/60 opacity-0 group-hover:opacity-100 transition-opacity">
            Click to generate code →
          </span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white/80 leading-relaxed mb-3">{String(data.message || 'Processing user input...')}</p>
        {intents.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {intents.map((intent, i) => (
              <span key={i} className="px-2.5 py-1 bg-violet-500/20 border border-violet-500/30 rounded-md text-[11px] text-violet-300">
                {intent}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-3 !h-3" />
    </div>
  );
}

// Carousel node - Scrollable cards
function ConversationCarouselNode({ data }: NodeProps) {
  const items = (data.items as Array<{title: string; description: string}>) || [];
  return (
    <div className="w-[360px] rounded-xl bg-[#12121a] border-2 border-pink-500/30 shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-pink-500 !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-pink-500/20 bg-pink-500/5">
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-pink-400" />
          <span className="text-xs text-pink-400 font-semibold uppercase tracking-wide">Carousel</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white/80 leading-relaxed mb-4">{String(data.message || '')}</p>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {items.slice(0, 3).map((item, i) => (
            <div key={i} className="flex-shrink-0 w-[100px] p-2.5 bg-white/5 border border-white/10 rounded-lg">
              <div className="w-full h-14 bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-md mb-2 flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-pink-400/50" />
              </div>
              <p className="text-[11px] text-white/70 font-medium truncate">{item.title}</p>
            </div>
          ))}
          {items.length > 3 && (
            <div className="flex-shrink-0 w-[60px] flex items-center justify-center text-xs text-white/40">
              +{items.length - 3} more
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-pink-500 !w-3 !h-3" />
    </div>
  );
}

// List Picker node - Vertical selection list
function ConversationListpickerNode({ data }: NodeProps) {
  const options = (data.options as Array<{label: string; description?: string}>) || [];
  return (
    <div className="w-[360px] rounded-xl bg-[#12121a] border-2 border-orange-500/30 shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-orange-500 !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-orange-500/20 bg-orange-500/5">
        <div className="flex items-center gap-2">
          <List className="w-4 h-4 text-orange-400" />
          <span className="text-xs text-orange-400 font-semibold uppercase tracking-wide">List Picker</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white/80 leading-relaxed mb-4">{String(data.message || '')}</p>
        <div className="space-y-2">
          {options.slice(0, 4).map((opt, i) => (
            <div key={i} className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
              <p className="text-sm text-white/80">{opt.label}</p>
              {opt.description && <p className="text-[11px] text-white/40 mt-0.5">{opt.description}</p>}
            </div>
          ))}
          {options.length > 4 && (
            <p className="text-xs text-white/40 text-center pt-1">+{options.length - 4} more options</p>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-orange-500 !w-3 !h-3" />
    </div>
  );
}

// Datepicker node
function ConversationDatepickerNode({ data }: NodeProps) {
  return (
    <div className="w-[360px] rounded-xl bg-[#12121a] border-2 border-blue-500/30 shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-blue-500/20 bg-blue-500/5">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-400" />
          <span className="text-xs text-blue-400 font-semibold uppercase tracking-wide">Date Picker</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white/80 leading-relaxed mb-3">{String(data.message || 'Select a date')}</p>
        <div className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/40 flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5" />
          <span>MM/DD/YYYY</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-3 !h-3" />
    </div>
  );
}

// File Upload node
function ConversationFileUploadNode({ data }: NodeProps) {
  return (
    <div className="w-[360px] rounded-xl bg-[#12121a] border-2 border-teal-500/30 shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !w-3 !h-3" />
      <div className="px-4 py-2.5 border-b border-teal-500/20 bg-teal-500/5">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-teal-400" />
          <span className="text-xs text-teal-400 font-semibold uppercase tracking-wide">File Upload</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm text-white/80 leading-relaxed mb-3">{String(data.message || 'Upload a file')}</p>
        <div className="px-3 py-4 bg-white/5 border border-dashed border-white/20 rounded-lg text-xs text-white/40 text-center">
          <Upload className="w-5 h-5 mx-auto mb-1.5 opacity-50" />
          Drop file or click to upload
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-teal-500 !w-3 !h-3" />
    </div>
  );
}

// Option/Button node - User choice (compact pill style)
function ConversationOptionNode({ data }: NodeProps) {
  return (
    <div className="w-[150px] px-4 py-3 rounded-xl bg-[#22c55e]/10 border-2 border-[#22c55e]/50 shadow-md hover:bg-[#22c55e]/20 hover:border-[#22c55e]/70 transition-all cursor-pointer">
      <Handle type="target" position={Position.Top} className="!bg-[#22c55e] !w-2.5 !h-2.5" />
      <p className="text-xs text-[#4ade80] font-semibold text-center leading-tight">
        {String(data.label || 'Option')}
      </p>
      <Handle type="source" position={Position.Bottom} className="!bg-[#22c55e] !w-2.5 !h-2.5" />
    </div>
  );
}

const nodeTypes = {
  start: StartNode,
  menu: MenuNode,
  flow: FlowNode,
  convergence: ConvergenceNode,
  endpoint: EndpointNode,
  // Conversation detail node types
  conversationQuestion: ConversationQuestionNode,
  conversationResponse: ConversationResponseNode,
  conversationAction: ConversationActionNode,
  conversationMessage: ConversationMessageNode,
  conversationOption: ConversationOptionNode,
  // Rich conversation node types
  conversationFreetext: ConversationFreetextNode,
  conversationNlu: ConversationNluNode,
  conversationCarousel: ConversationCarouselNode,
  conversationListpicker: ConversationListpickerNode,
  conversationDatepicker: ConversationDatepickerNode,
  conversationFileUpload: ConversationFileUploadNode,
};

// Fit to Screen Button - uses React Flow context
function FitViewButton() {
  const { fitView } = useReactFlow();
  
  return (
    <Panel position="bottom-right" className="!m-4 !mb-[180px]">
      <button
        onClick={() => fitView({ padding: 0.15, duration: 300 })}
        className="flex items-center gap-2 px-3 py-2 bg-[#12121a] hover:bg-[#1a1a24] border border-white/10 rounded-xl text-xs text-white/70 hover:text-white transition-colors shadow-lg"
        title="Fit to screen"
      >
        <Maximize2 className="w-4 h-4" />
        Fit View
      </button>
    </Panel>
  );
}

// Generate Dropdown - appears after successful generation
interface GenerateDropdownProps {
  onViewResults: () => void;
  onRegenerate: () => void;
  isGenerating: boolean;
}

function GenerateDropdown({ onViewResults, onRegenerate, isGenerating }: GenerateDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as globalThis.Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isGenerating}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-emerald-500/20"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Regenerating...
          </>
        ) : (
          <>
            <Check className="w-4 h-4" />
            Generated
            <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </>
        )}
      </button>
      
      {isOpen && !isGenerating && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-[#1a1a24] border border-white/10 rounded-xl shadow-xl overflow-hidden z-50">
          <button
            onClick={() => {
              onViewResults();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-white/5 transition-colors"
          >
            <Rocket className="w-4 h-4 text-emerald-400" />
            View Solution
          </button>
          <div className="border-t border-white/5" />
          <button
            onClick={() => {
              onRegenerate();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-white/5 transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-[#a5b4fc]" />
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN ARCHITECTURE PAGE
// ============================================

interface PlannedFlow {
  name: string;
  label?: string;  // Optional since it may not be set initially
  description: string;
  startNode: number;
}

interface MainMenuOption {
  label: string;
  description?: string;
  flowName?: string;
}

// CSV Node structure - matches actual generated bot nodes
interface CSVNode {
  num: number;
  type: 'D' | 'A';
  name: string;
  intent?: string;
  entityType?: string;
  entity?: string;
  nluDisabled?: string;
  nextNodes?: string;
  message?: string;
  richType?: string;
  richContent?: string | object;
  ansReq?: string;
  behaviors?: string;
  command?: string;
  description?: string;
  output?: string;
  nodeInput?: string;
  paramInput?: string | object;
  decVar?: string;
  whatNext?: string;
  nodeTags?: string;
  skillTag?: string;
  variable?: string;
  platformFlag?: string;
  flows?: string;
  cssClass?: string;
}

// Generation progress tracking
interface GenerationProgress {
  totalFlows: number;
  completedFlows: number;
  currentFlows: string[];
  nodesGenerated: number;
  flowProgress: Map<string, { status: 'pending' | 'generating' | 'done' | 'error'; nodeCount: number; nodes: CSVNode[] }>;
  stage: 'planning' | 'generating' | 'converting' | 'deploying' | 'done';
  message: string;
}

// Parse CSV string into structured nodes grouped by flow
function parseCSVToFlowNodes(csvString: string, plannedFlows: PlannedFlow[]): Map<string, CSVNode[]> {
  const flowNodes = new Map<string, CSVNode[]>();
  
  if (!csvString) return flowNodes;
  
  // Initialize all flows with empty arrays
  for (const flow of plannedFlows) {
    flowNodes.set(flow.name, []);
  }
  
  // Parse CSV rows (skip header)
  const lines = csvString.split('\n').slice(1);
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Parse CSV fields (handles quoted fields with commas)
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.replace(/^"|"$/g, '').trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.replace(/^"|"$/g, '').trim());
    
    // Map to CSVNode
    const nodeNum = parseInt(fields[0], 10);
    if (isNaN(nodeNum)) continue;
    
    const node: CSVNode = {
      num: nodeNum,
      type: fields[1] as 'D' | 'A',
      name: fields[2] || '',
      intent: fields[3],
      entityType: fields[4],
      entity: fields[5],
      nluDisabled: fields[6],
      nextNodes: fields[7],
      message: fields[8],
      richType: fields[9],
      richContent: fields[10],
      ansReq: fields[11],
      behaviors: fields[12],
      command: fields[13],
      description: fields[14],
      output: fields[15],
      nodeInput: fields[16],
      paramInput: fields[17],
      decVar: fields[18],
      whatNext: fields[19],
      nodeTags: fields[20],
      skillTag: fields[21],
      variable: fields[22],
      platformFlag: fields[23],
      flows: fields[24],
      cssClass: fields[25]
    };
    
    // Assign node to the appropriate flow based on node number range
    // Flows are assigned sequential start nodes (300, 400, 500, etc.)
    // Each flow owns nodes from its startNode to the next flow's startNode - 1
    let assignedFlow: string | null = null;
    
    // Skip system nodes (negative or >= 99990)
    if (nodeNum < 0 || nodeNum >= 99990) continue;
    
    // Skip startup nodes (< 300)
    if (nodeNum < 300) continue;
    
    // Find which flow this node belongs to
    const sortedFlows = [...plannedFlows].sort((a, b) => a.startNode - b.startNode);
    for (let i = 0; i < sortedFlows.length; i++) {
      const flow = sortedFlows[i];
      const nextFlowStart = i < sortedFlows.length - 1 ? sortedFlows[i + 1].startNode : 99990;
      
      if (nodeNum >= flow.startNode && nodeNum < nextFlowStart) {
        assignedFlow = flow.name;
        break;
      }
    }
    
    if (assignedFlow && flowNodes.has(assignedFlow)) {
      flowNodes.get(assignedFlow)!.push(node);
    }
  }
  
  return flowNodes;
}

// Convert CSV nodes to visual React Flow nodes for display
function csvNodesToVisualNodes(csvNodes: CSVNode[], flowName: string): { nodes: Node[], edges: Edge[] } {
  const visualNodes: Node[] = [];
  const visualEdges: Edge[] = [];
  
  // Layout constants
  const cardWidth = 280;
  const cardHeight = 120;
  const verticalGap = 100;
  const horizontalGap = 60;
  const centerX = 400;
  
  let currentY = 50;
  const nodePositions = new Map<number, { x: number; y: number }>();
  
  // First pass: create nodes and track positions
  csvNodes.forEach((csvNode, index) => {
    // Determine node type for visual display
    let nodeType: string;
    if (csvNode.type === 'A') {
      nodeType = csvNode.command?.includes('GenAI') || csvNode.name?.toLowerCase().includes('nlu') 
        ? 'conversationNlu' 
        : 'conversationAction';
    } else {
      // Decision node - determine subtype
      if (csvNode.richType?.includes('carousel')) {
        nodeType = 'conversationCarousel';
      } else if (csvNode.richType?.includes('list') || csvNode.richType?.includes('picker')) {
        nodeType = 'conversationListpicker';
      } else if (csvNode.richType?.includes('date') || csvNode.richType?.includes('time')) {
        nodeType = 'conversationDatepicker';
      } else if (csvNode.richType?.includes('upload') || csvNode.richType?.includes('file')) {
        nodeType = 'conversationFileUpload';
      } else if (csvNode.nluDisabled !== '1' && csvNode.richType) {
        nodeType = 'conversationQuestion';
      } else if (csvNode.nluDisabled === '1') {
        nodeType = 'conversationFreetext';
      } else {
        nodeType = 'conversationMessage';
      }
    }
    
    // Calculate position - simple vertical layout with horizontal offset for branching
    const x = centerX + ((index % 3) - 1) * (cardWidth + horizontalGap) * 0.3;
    const y = currentY;
    currentY += cardHeight + verticalGap;
    
    nodePositions.set(csvNode.num, { x, y });
    
    // Parse rich content if present
    let options: Array<{ label: string; destination: string }> = [];
    if (csvNode.richContent) {
      try {
        const richContent = typeof csvNode.richContent === 'string' 
          ? JSON.parse(csvNode.richContent) 
          : csvNode.richContent;
        if (richContent.options) {
          options = richContent.options.map((opt: any) => ({
            label: opt.label || opt.text || 'Option',
            destination: String(opt.dest || opt.destination || '')
          }));
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    visualNodes.push({
      id: `csv-${flowName}-${csvNode.num}`,
      type: nodeType,
      position: { x, y },
      data: {
        label: csvNode.name || `Node ${csvNode.num}`,
        message: csvNode.message || '',
        nodeNum: csvNode.num,
        options,
        command: csvNode.command,
        isFromCSV: true
      },
      draggable: true
    });
  });
  
  // Second pass: create edges from nextNodes and richContent destinations
  csvNodes.forEach((csvNode) => {
    const sourceId = `csv-${flowName}-${csvNode.num}`;
    
    // Parse nextNodes
    if (csvNode.nextNodes) {
      const nextNodeNums = csvNode.nextNodes.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      nextNodeNums.forEach((targetNum, idx) => {
        if (nodePositions.has(targetNum)) {
          visualEdges.push({
            id: `edge-${csvNode.num}-${targetNum}-${idx}`,
            source: sourceId,
            target: `csv-${flowName}-${targetNum}`,
            type: 'straight',
            style: { stroke: '#6366f1', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' }
          });
        }
      });
    }
    
    // Parse rich content destinations
    if (csvNode.richContent) {
      try {
        const richContent = typeof csvNode.richContent === 'string' 
          ? JSON.parse(csvNode.richContent) 
          : csvNode.richContent;
        if (richContent.options) {
          richContent.options.forEach((opt: any, idx: number) => {
            const targetNum = parseInt(opt.dest || opt.destination);
            if (!isNaN(targetNum) && nodePositions.has(targetNum)) {
              visualEdges.push({
                id: `edge-rich-${csvNode.num}-${targetNum}-${idx}`,
                source: sourceId,
                target: `csv-${flowName}-${targetNum}`,
                type: 'straight',
                style: { stroke: '#22c55e', strokeWidth: 2 },
                label: opt.label?.substring(0, 20),
                markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' }
              });
            }
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  });
  
  return { nodes: visualNodes, edges: visualEdges };
}

export function SolutionArchitecturePage() {
  const navigate = useNavigate();
  const { solutionId, flowName: urlFlowName } = useParams();
  const location = useLocation();
  
  const { 
    projectConfig,
    setInstantStep,
    extractedDetails,
    credentials,
    setCredentials,
    user,
    setInstantBuildResult: setGlobalInstantBuildResult,
    updateSavedSolution,
    activeSolutionId,
    savedSolutions,
    setExtractedDetails,
    setProjectConfig,
    setActiveSolution
  } = useStore();
  
  // Track the current solution ID for detecting switches
  const currentSolutionIdRef = useRef<string | null>(null);
  
  // Sync solution ID from URL if different from store
  useEffect(() => {
    if (solutionId && solutionId !== activeSolutionId) {
      setActiveSolution(solutionId);
    }
  }, [solutionId, activeSolutionId, setActiveSolution]);
  
  // Track if we've restored from saved state - use ref to prevent re-restoration
  const [hasRestoredState, setHasRestoredState] = useState(false);
  const hasInitializedRef = useRef(false); // Prevents re-restore on savedSolutions updates
  
  const [isLoading, setIsLoading] = useState(true);
  const [flows, setFlows] = useState<PlannedFlow[]>([]);
  const [menuOptions, setMenuOptions] = useState<MainMenuOption[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [chatPrompt, setChatPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  
  // Flow drill-down state
  const [selectedFlow, setSelectedFlow] = useState<{ name: string; label: string; description: string } | null>(null);
  const [flowDetailNodes, setFlowDetailNodes, onFlowDetailNodesChange] = useNodesState<Node>([]);
  const [flowDetailEdges, setFlowDetailEdges, onFlowDetailEdgesChange] = useEdgesState<Edge>([]);
  const [isLoadingFlowDetail, setIsLoadingFlowDetail] = useState(false);
  
  // Generated flows cache - stores actual CSV nodes per flow
  const [generatedFlows, setGeneratedFlows] = useState<Map<string, CSVNode[]>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [showResultsPopup, setShowResultsPopup] = useState(false);
  const [instantBuildResult, setLocalInstantBuildResult] = useState<any>(null);
  
  // Cached generation for retry - stores the expensive AI-generated CSV when deployment fails
  const [cachedGeneration, setCachedGeneration] = useState<{ result: any; projectConfig: any } | null>(null);
  
  // Fix and deploy state
  const [isFixingErrors, setIsFixingErrors] = useState(false);
  
  // Export to sheets state
  const [isExportingToSheets, setIsExportingToSheets] = useState(false);
  
  // Flow previews cache - stores the conversation structure the user has seen/approved
  // This ensures the final CSV matches what the user previewed
  const [flowPreviews, setFlowPreviews] = useState<Map<string, any[]>>(new Map());
  // Ref to hold previews synchronously (React state updates are async)
  const flowPreviewsRef = useRef<Map<string, any[]>>(new Map());
  
  // API Key modal state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [apiKeyModalAction, setApiKeyModalAction] = useState<'generate' | 'fixAndDeploy'>('generate');
  
  // Widget creation state
  const [showWidgetModal, setShowWidgetModal] = useState(false);
  const [widgetApiKey, setWidgetApiKey] = useState('');
  const [isCreatingWidget, setIsCreatingWidget] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  
  // Action node code generation modal state
  const [codeModal, setCodeModal] = useState<{
    isOpen: boolean;
    nodeData: any;
    generatedCode: string;
    isGenerating: boolean;
    isTesting: boolean;
    testResult: { success: boolean; output: string } | null;
  }>({
    isOpen: false,
    nodeData: null,
    generatedCode: '',
    isGenerating: false,
    isTesting: false,
    testResult: null,
  });
  
  // Save architecture state to Supabase
  const saveArchitectureState = useCallback(async () => {
    if (!activeSolutionId) {
      console.log('[Architecture] No active solution ID, skipping save');
      return;
    }
    
    // Collect node positions from current nodes
    const nodePositions: Record<string, { x: number; y: number }> = {};
    nodes.forEach(node => {
      nodePositions[node.id] = { x: node.position.x, y: node.position.y };
    });
    
    // Convert flowPreviews Map to plain object for JSON storage
    const flowPreviewsObj: Record<string, any[]> = {};
    flowPreviews.forEach((nodes, name) => {
      flowPreviewsObj[name] = nodes;
    });
    
    const architectureState = {
      plannedFlows: flows,
      menuOptions: menuOptions,
      nodePositions: nodePositions,
      flowPreviews: flowPreviewsObj,
      hasGenerated: hasGenerated,
      extractedDetails: extractedDetails || undefined,
      brandAssets: projectConfig.brandAssets || undefined,
      targetCompany: projectConfig.targetCompany || extractedDetails?.targetCompany || projectConfig.projectName,
      instantStep: 'architecture' as const,
      instantBuildResult: instantBuildResult || undefined,
    };
    
    try {
      await updateSavedSolution(activeSolutionId, {
        architectureState: architectureState,
      });
      console.log('[Architecture] State saved to Supabase');
    } catch (error) {
      console.error('[Architecture] Failed to save state:', error);
    }
  }, [activeSolutionId, flows, menuOptions, nodes, flowPreviews, hasGenerated, extractedDetails, projectConfig.brandAssets, instantBuildResult, updateSavedSolution]);
  
  // Auto-save state when significant changes occur (debounced)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveArchitectureState();
    }, 2000); // Save after 2 seconds of inactivity
  }, [saveArchitectureState]);
  
  // Trigger auto-save when flows, menuOptions, or nodes change
  useEffect(() => {
    if (hasRestoredState && flows.length > 0) {
      debouncedSave();
    }
  }, [flows, menuOptions, nodes, hasGenerated, debouncedSave, hasRestoredState]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);
  
  // Reset initialization state when solution ID changes (switching projects)
  // This prevents state from bleeding between different projects
  useEffect(() => {
    const effectiveSolutionId = solutionId || activeSolutionId;
    if (currentSolutionIdRef.current && effectiveSolutionId !== currentSolutionIdRef.current) {
      console.log('[Architecture] Solution changed from', currentSolutionIdRef.current, 'to', effectiveSolutionId, '- resetting state');
      hasInitializedRef.current = false;
      setHasRestoredState(false);
      setFlows([]);
      setMenuOptions([]);
      setNodes([]);
      setEdges([]);
      setHasGenerated(false);
      flowPreviewsRef.current = new Map();
      setFlowPreviews(new Map());
      setGeneratedFlows(new Map());
      setSelectedFlow(null);
    }
    currentSolutionIdRef.current = effectiveSolutionId || null;
  }, [solutionId, activeSolutionId, setNodes, setEdges]);
  
  const formatFlowName = (name: string): string => {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };
  
  // Handle edit/delete/save functions need to be defined before updateFlowChart
  const handleEditNode = useCallback((id: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: { ...node.data, isEditing: true },
          };
        }
        return node;
      })
    );
  }, [setNodes]);
  
  const handleDeleteNode = useCallback((id: string) => {
    const flowName = id.replace('flow-', '');
    setFlows((f) => f.filter((flow) => flow.name !== flowName));
    setMenuOptions((m) => m.filter((opt) => opt.flowName !== flowName));
    setNodes((nds) => nds.filter((node) => node.id !== id));
    setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id));
    // Invalidate cache - requires regeneration
    setGeneratedFlows(new Map());
    flowPreviewsRef.current = new Map();
    setFlowPreviews(new Map());
    setHasGenerated(false);
  }, [setNodes, setEdges]);
  
  const handleSaveNode = useCallback((id: string, label: string, description: string) => {
    const oldFlowName = id.replace('flow-', '');
    const newFlowName = label.toLowerCase().replace(/\s+/g, '_');
    
    // Update flows
    setFlows((f) =>
      f.map((flow) =>
        flow.name === oldFlowName
          ? { ...flow, name: newFlowName, description }
          : flow
      )
    );
    
    // Update menu options
    setMenuOptions((m) =>
      m.map((opt) =>
        opt.flowName === oldFlowName
          ? { ...opt, label, flowName: newFlowName, description }
          : opt
      )
    );
    
    // Update node
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            id: `flow-${newFlowName}`,
            data: { 
              ...node.data, 
              label, 
              description,
              isEditing: false 
            },
          };
        }
        return node;
      })
    );
    
    // Update edges
    setEdges((eds) =>
      eds.map((edge) => ({
        ...edge,
        source: edge.source === id ? `flow-${newFlowName}` : edge.source,
        target: edge.target === id ? `flow-${newFlowName}` : edge.target,
      }))
    );
    
    // Invalidate cache - requires regeneration
    setGeneratedFlows(new Map());
    flowPreviewsRef.current = new Map();
    setFlowPreviews(new Map());
    setHasGenerated(false);
  }, [setNodes, setEdges]);
  
  const handleCancelEdit = useCallback((id: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: { ...node.data, isEditing: false },
          };
        }
        return node;
      })
    );
  }, [setNodes]);
  
  // Handle menu options update (add/edit/delete buttons, change routing)
  const handleUpdateMenu = useCallback((id: string, newOptions: Array<{ label: string; flowName?: string }>) => {
    // Update menuOptions state
    setMenuOptions(newOptions.map(opt => ({
      label: opt.label,
      flowName: opt.flowName,
      description: opt.label
    })));
    
    // Update the menu node data
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: { 
              ...node.data, 
              menuOptions: newOptions.map((opt, idx) => ({
                ...opt,
                handleId: `btn-${idx}`
              }))
            },
          };
        }
        return node;
      })
    );
    
    // Rebuild edges for menu buttons
    setEdges((eds) => {
      // Remove old menu button edges
      const nonMenuEdges = eds.filter(e => !e.id.startsWith('menu-btn-'));
      
      // Create new edges for each button with a valid flowName
      const newButtonEdges: Edge[] = [];
      newOptions.forEach((opt, idx) => {
        if (opt.flowName) {
          newButtonEdges.push({
            id: `menu-btn-${idx}-flow`,
            source: 'menu',
            sourceHandle: `btn-${idx}`,
            target: `flow-${opt.flowName}`,
            type: 'straight',
            style: { stroke: '#22c55e', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
          });
        }
      });
      
      return [...nonMenuEdges, ...newButtonEdges];
    });
  }, [setNodes, setEdges]);
  
  // Handle endpoint label update
  const handleUpdateEndpointLabel = useCallback((id: string, newLabel: string) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: { ...node.data, label: newLabel },
          };
        }
        return node;
      })
    );
  }, [setNodes]);
  
  // Handle going back to architecture view
  const handleBackToArchitecture = useCallback(() => {
    // Update URL to remove flow view
    const currentSolutionId = solutionId || activeSolutionId;
    if (currentSolutionId) {
      navigate(`/solutions/${currentSolutionId}`, { replace: false });
    }
    
    setSelectedFlow(null);
    setFlowDetailNodes([]);
    setFlowDetailEdges([]);
  }, [solutionId, activeSolutionId, navigate]);
  
  // Handle action node code generation
  const handleGenerateCode = useCallback(async (nodeData: any) => {
    setCodeModal({
      isOpen: true,
      nodeData,
      generatedCode: '',
      isGenerating: true,
      isTesting: false,
      testResult: null,
    });
    
    try {
      // Only pass serializable fields - avoid passing full projectConfig which may contain DOM refs or blobs
      const response = await fetch('/api/generate-action-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeData,
          flowContext: selectedFlow,
          projectConfig: {
            targetCompany: projectConfig.targetCompany
          },
        })
      });
      
      if (!response.ok) throw new Error('Failed to generate code');
      
      const data = await response.json();
      setCodeModal(prev => ({
        ...prev,
        generatedCode: data.code || '',
        isGenerating: false,
      }));
    } catch (err) {
      console.error('[CodeGen] Error:', err);
      setCodeModal(prev => ({
        ...prev,
        generatedCode: '# Error generating code. Please try again.',
        isGenerating: false,
      }));
    }
  }, [selectedFlow, projectConfig]);
  
  // Helper function to build visual nodes from preview nodes
  const buildPreviewNodes = useCallback((conversationNodes: any[], flowName: string): { detailNodes: Node[]; detailEdges: Edge[] } => {
    const detailNodes: Node[] = [];
    const detailEdges: Edge[] = [];
    
    // Layout constants - GENEROUS SPACING to prevent overlap
    const cardWidth = 360;
    const baseCardHeight = 160;
    const longTextExtraHeight = 50;
    const optionRowHeight = 60;
    const gapAfterCard = 40;
    const gapAfterOptions = 70;
    const gapBetweenCards = 80;
    const optionWidth = 150;
    const optionGap = 20;
    const centerX = 450;
    
    let currentY = 60;
    let previousNodeId: string | null = null;
    let previousNodeHadOptions = false;
    
    const estimateCardHeight = (node: any) => {
      const message = node.message || node.label || '';
      const charCount = message.length;
      let height = baseCardHeight;
      if (charCount > 150) height += longTextExtraHeight * 2;
      else if (charCount > 80) height += longTextExtraHeight;
      if (node.type === 'carousel') height += 100;
      else if (node.type === 'listpicker') height += Math.min(node.options?.length || 0, 4) * 40;
      else if (node.type === 'nlu_intent') height += 40;
      else if (node.type === 'freetext') height += 30;
      return height;
    };
    
    const nodeTypeMap: Record<string, string> = {
      'question': 'conversationQuestion',
      'response': 'conversationResponse',
      'action': 'conversationAction',
      'freetext': 'conversationFreetext',
      'nlu_intent': 'conversationNlu',
      'carousel': 'conversationCarousel',
      'listpicker': 'conversationListpicker',
      'datepicker': 'conversationDatepicker',
      'file_upload': 'conversationFileUpload',
    };
    
    conversationNodes.forEach((node: any, idx: number) => {
      const nodeType = nodeTypeMap[node.type] || 'conversationMessage';
      const isButtonQuestion = node.type === 'question' && node.options && node.options.length > 0;
      const hasOptions = isButtonQuestion;
      const nodeId = `conv-${idx}`;
      const thisCardHeight = estimateCardHeight(node);
      
      detailNodes.push({
        id: nodeId,
        type: nodeType,
        position: { x: centerX - cardWidth / 2, y: currentY },
        data: {
          label: node.label || node.message,
          message: node.message,
          nodeType: node.type,
          options: node.options,
          items: node.items,
          intents: node.intents,
          placeholder: node.placeholder,
          inputType: node.inputType,
          onGenerateCode: handleGenerateCode,
        },
        draggable: true,
      });
      
      if (previousNodeId && !previousNodeHadOptions) {
        detailEdges.push({
          id: `edge-${previousNodeId}-to-${nodeId}`,
          source: previousNodeId,
          target: nodeId,
          type: 'straight',
          style: { stroke: '#6366f1', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
        });
      }
      
      currentY += thisCardHeight;
      
      if (hasOptions) {
        const options = node.options;
        const numOptions = options.length;
        const totalOptionsWidth = numOptions * optionWidth + (numOptions - 1) * optionGap;
        const optionsStartX = centerX - totalOptionsWidth / 2;
        currentY += gapAfterCard;
        const parentX = centerX - cardWidth / 2;
        const optionsOffsetY = thisCardHeight + gapAfterCard;
        
        options.forEach((opt: any, optIdx: number) => {
          const optionId = `conv-${idx}-opt-${optIdx}`;
          const optXRelative = (optionsStartX - parentX) + optIdx * (optionWidth + optionGap);
          
          detailNodes.push({
            id: optionId,
            type: 'conversationOption',
            position: { x: optXRelative, y: optionsOffsetY },
            parentId: nodeId,
            draggable: false,
            data: { label: opt.label, destination: opt.destination },
          });
          
          detailEdges.push({
            id: `edge-${nodeId}-to-${optionId}`,
            source: nodeId,
            target: optionId,
            type: 'straight',
            style: { stroke: '#22c55e', strokeWidth: 1.5 },
          });
          
          if (idx < conversationNodes.length - 1) {
            detailEdges.push({
              id: `edge-${optionId}-to-conv-${idx + 1}`,
              source: optionId,
              target: `conv-${idx + 1}`,
              type: 'straight',
              style: { stroke: '#6366f1', strokeWidth: 1.5, strokeDasharray: '4 2' },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
            });
          }
        });
        
        currentY += optionRowHeight + gapAfterOptions;
      } else {
        currentY += gapBetweenCards;
      }
      
      previousNodeId = nodeId;
      previousNodeHadOptions = hasOptions;
    });
    
    return { detailNodes, detailEdges };
  }, [handleGenerateCode]);
  
  // Handle flow drill-down - Uses cached CSV nodes if available, otherwise AI generates
  const handleFlowDrillDown = useCallback(async (flowName: string, flowLabel: string, description: string) => {
    // Update URL to reflect the flow view
    const currentSolutionId = solutionId || activeSolutionId;
    if (currentSolutionId) {
      navigate(`/solutions/${currentSolutionId}/flow/${encodeURIComponent(flowName)}`, { replace: false });
    }
    
    setSelectedFlow({ name: flowName, label: flowLabel, description });
    setIsLoadingFlowDetail(true);
    
    try {
      // CHECK CACHE FIRST - if we have generated CSV nodes, use them
      const cachedNodes = generatedFlows.get(flowName);
      if (cachedNodes && cachedNodes.length > 0) {
        console.log(`[FlowDrillDown] Using cached CSV ${cachedNodes.length} nodes for "${flowName}"`);
        const { nodes: visualNodes, edges: visualEdges } = csvNodesToVisualNodes(cachedNodes, flowName);
        setFlowDetailNodes(visualNodes);
        setFlowDetailEdges(visualEdges);
        setIsLoadingFlowDetail(false);
        return;
      }
      
      // CHECK PREVIEW CACHE - if we already generated a preview, use it
      // Use ref for synchronous access (React state updates are async)
      console.log(`[FlowDrillDown] Checking preview cache for "${flowName}". Ref size: ${flowPreviewsRef.current.size}, keys:`, Array.from(flowPreviewsRef.current.keys()));
      const cachedPreview = flowPreviewsRef.current.get(flowName);
      if (cachedPreview && cachedPreview.length > 0) {
        console.log(`[FlowDrillDown] Using cached preview ${cachedPreview.length} nodes for "${flowName}"`);
        // Re-render the preview nodes (same logic as below, but skip API call)
        const { detailNodes, detailEdges } = buildPreviewNodes(cachedPreview, flowName);
        setFlowDetailNodes(detailNodes);
        setFlowDetailEdges(detailEdges);
        setIsLoadingFlowDetail(false);
        return;
      }
      
      // No cache - generate via API (pre-generation preview mode)
      console.log(`[FlowDrillDown] No cache for "${flowName}", generating via API`);
      // Only pass serializable fields - avoid passing full projectConfig which may contain DOM refs or blobs
      const response = await fetch('/api/generate-flow-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowName,
          flowLabel,
          description,
          projectConfig: {
            targetCompany: projectConfig.targetCompany
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate flow detail');
      }
      
      const data = await response.json();
      const conversationNodes = data.nodes || [];
      
      // STORE THE PREVIEW - This ensures the final CSV matches what the user saw
      // Update ref immediately for synchronous access
      flowPreviewsRef.current.set(flowName, conversationNodes);
      console.log(`[FlowDrillDown] Stored preview for "${flowName}" (${conversationNodes.length} nodes). Ref cache size: ${flowPreviewsRef.current.size}`);
      // Also update state for React re-renders and persistence
      setFlowPreviews(prev => {
        const updated = new Map(prev);
        updated.set(flowName, conversationNodes);
        return updated;
      });
      
      // Convert to React Flow nodes using helper
      const { detailNodes, detailEdges } = buildPreviewNodes(conversationNodes, flowName);
      setFlowDetailNodes(detailNodes);
      setFlowDetailEdges(detailEdges);
    } catch (err) {
      console.error('[FlowDetail] Error:', err);
      // Show empty state on error
      setFlowDetailNodes([]);
      setFlowDetailEdges([]);
    } finally {
      setIsLoadingFlowDetail(false);
    }
  }, [solutionId, activeSolutionId, navigate, projectConfig, generatedFlows, buildPreviewNodes]);
  
  // Update flow nodes' onDrillDown handler when handleFlowDrillDown changes
  // This ensures nodes always have the latest function reference with current flowPreviews
  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.type === 'flowNode' && node.data.onDrillDown) {
          return {
            ...node,
            data: {
              ...node.data,
              onDrillDown: handleFlowDrillDown,
            },
          };
        }
        return node;
      })
    );
  }, [handleFlowDrillDown, setNodes]);
  
  // Handle regenerating the current flow (clears cache and re-fetches)
  const handleRegenerateFlow = useCallback(async () => {
    if (!selectedFlow) return;
    
    const { name: flowName, label: flowLabel, description } = selectedFlow;
    
    // Clear caches for this flow
    // Clear from ref immediately
    flowPreviewsRef.current.delete(flowName);
    console.log(`[Regenerate] Cleared preview cache from ref for "${flowName}"`);
    
    setFlowPreviews(prev => {
      const updated = new Map(prev);
      updated.delete(flowName);
      return updated;
    });
    
    setGeneratedFlows(prev => {
      const updated = new Map(prev);
      updated.delete(flowName);
      console.log(`[Regenerate] Cleared generated cache for "${flowName}"`);
      return updated;
    });
    
    // Now trigger a fresh generation
    setIsLoadingFlowDetail(true);
    
    try {
      console.log(`[Regenerate] Fetching fresh flow detail for "${flowName}"`);
      // Only pass serializable fields - avoid passing full projectConfig which may contain DOM refs or blobs
      const response = await fetch('/api/generate-flow-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowName,
          flowLabel,
          description,
          projectConfig: {
            targetCompany: projectConfig.targetCompany
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to regenerate flow detail');
      }
      
      const data = await response.json();
      const conversationNodes = data.nodes || [];
      
      // Store the new preview - update ref immediately
      flowPreviewsRef.current.set(flowName, conversationNodes);
      console.log(`[Regenerate] Stored new preview for "${flowName}" (${conversationNodes.length} nodes). Ref size: ${flowPreviewsRef.current.size}`);
      setFlowPreviews(prev => {
        const updated = new Map(prev);
        updated.set(flowName, conversationNodes);
        return updated;
      });
      
      // Convert to React Flow nodes
      const { detailNodes, detailEdges } = buildPreviewNodes(conversationNodes, flowName);
      setFlowDetailNodes(detailNodes);
      setFlowDetailEdges(detailEdges);
    } catch (err) {
      console.error('[Regenerate] Error:', err);
      setFlowDetailNodes([]);
      setFlowDetailEdges([]);
    } finally {
      setIsLoadingFlowDetail(false);
    }
  }, [selectedFlow, projectConfig, buildPreviewNodes]);
  
  // Handle testing the generated code
  const handleTestCode = useCallback(async () => {
    setCodeModal(prev => ({ ...prev, isTesting: true, testResult: null }));
    
    try {
      const response = await fetch('/api/test-action-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: codeModal.generatedCode,
          nodeData: codeModal.nodeData,
        })
      });
      
      const data = await response.json();
      setCodeModal(prev => ({
        ...prev,
        isTesting: false,
        testResult: {
          success: data.success,
          output: data.output || data.error || 'Test completed',
        },
      }));
    } catch (err) {
      setCodeModal(prev => ({
        ...prev,
        isTesting: false,
        testResult: {
          success: false,
          output: 'Failed to run test: ' + String(err),
        },
      }));
    }
  }, [codeModal.generatedCode, codeModal.nodeData]);
  
  // Close code modal
  const handleCloseCodeModal = useCallback(() => {
    setCodeModal({
      isOpen: false,
      nodeData: null,
      generatedCode: '',
      isGenerating: false,
      isTesting: false,
      testResult: null,
    });
  }, []);
  
  // Convert flows to React Flow nodes/edges - CLEAN HIERARCHICAL LAYOUT
  const updateFlowChart = useCallback((flowData: PlannedFlow[], menuData: MainMenuOption[]) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    
    // Layout constants
    const flowCardWidth = 250;  // Wider cards
    const horizontalGap = 30;   // More spacing
    const verticalGap = 60;
    
    // Calculate flow row width
    const totalFlowWidth = flowData.length * flowCardWidth + (flowData.length - 1) * horizontalGap;
    
    // Menu width based on buttons (~80px per button + padding)
    const menuWidth = Math.max(200, menuData.length * 90 + 30);
    
    const canvasCenter = Math.max(totalFlowWidth / 2 + 50, menuWidth / 2 + 50, 400);
    
    // Y positions for each tier
    const startY = 30;
    const menuY = 110;
    const flowsY = menuY + 100 + verticalGap; // Menu height ~100px
    const endpointsY = flowsY + 160 + verticalGap; // Taller flow cards
    
    // ===== TIER 1: START =====
    newNodes.push({
      id: 'start',
      type: 'start',
      position: { x: canvasCenter - 40, y: startY },
      data: { label: 'Start', description: 'Entry point', nodeType: 'start' },
      draggable: true,
    });
    
    // ===== TIER 2: MAIN MENU (with inline buttons) =====
    newNodes.push({
      id: 'menu',
      type: 'menu',
      position: { x: canvasCenter - menuWidth / 2, y: menuY },
      data: { 
        label: 'Main Menu', 
        nodeType: 'menu',
        menuOptions: menuData.map((opt, idx) => ({
          ...opt,
          handleId: `btn-${idx}`
        })),
        availableFlows: flowData.map(f => ({ name: f.name, label: formatFlowName(f.name) })),
        onUpdateMenu: handleUpdateMenu,
      },
      draggable: true,
    });
    
    // Edge from start to menu
    newEdges.push({
      id: 'start-menu',
      source: 'start',
      target: 'menu',
      type: 'straight',
      animated: true,
      style: { stroke: '#6366f1', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
    });
    
    // ===== TIER 3: FLOWS =====
    const flowStartX = canvasCenter - totalFlowWidth / 2;
    
    // Create a map from flowName to its index for positioning
    const flowIndexMap = new Map(flowData.map((f, idx) => [f.name, idx]));
    
    flowData.forEach((flow, idx) => {
      const x = flowStartX + idx * (flowCardWidth + horizontalGap);
      
      newNodes.push({
        id: `flow-${flow.name}`,
        type: 'flow',
        position: { x, y: flowsY },
        data: {
          label: formatFlowName(flow.name),
          description: flow.description,
          nodeType: 'flow',
          startNode: flow.startNode,
          isEditing: false,
          onEdit: handleEditNode,
          onDelete: handleDeleteNode,
          onSave: handleSaveNode,
          onCancel: handleCancelEdit,
          onDrillDown: handleFlowDrillDown,
        },
        draggable: true,
      });
    });
    
    // Edges from menu buttons to flows - straight lines
    menuData.forEach((option, idx) => {
      if (option.flowName && flowIndexMap.has(option.flowName)) {
        newEdges.push({
          id: `menu-btn-${idx}-flow`,
          source: 'menu',
          sourceHandle: `btn-${idx}`,
          target: `flow-${option.flowName}`,
          type: 'straight',
          style: { stroke: '#22c55e', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
        });
      }
    });
    
    // ===== TIER 4: CONVERGENCE POINT =====
    const convergenceY = flowsY + 160 + 40; // Below flows
    
    newNodes.push({
      id: 'convergence',
      type: 'convergence',
      position: { x: canvasCenter - 6, y: convergenceY },
      data: { nodeType: 'convergence' },
      draggable: true,
    });
    
    // Connect all flows to convergence point
    flowData.forEach((flow) => {
      newEdges.push({
        id: `flow-${flow.name}-converge`,
        source: `flow-${flow.name}`,
        target: 'convergence',
        type: 'straight',
        style: { stroke: '#4a4a55', strokeWidth: 1, opacity: 0.5 },
      });
    });
    
    // ===== TIER 5: ENDPOINTS =====
    const endpointGap = 140;
    const endpointsYFinal = convergenceY + 60;
    
    newNodes.push({
      id: 'end-chat',
      type: 'endpoint',
      position: { x: canvasCenter - endpointGap - 60, y: endpointsYFinal },
      data: { 
        label: 'End Chat', 
        description: 'Conversation ends', 
        nodeType: 'endpoint',
        onUpdateLabel: handleUpdateEndpointLabel,
      },
      draggable: true,
    });
    
    newNodes.push({
      id: 'live-agent',
      type: 'endpoint',
      position: { x: canvasCenter + endpointGap - 60, y: endpointsYFinal },
      data: { 
        label: 'Live Agent', 
        description: 'Transfer to human', 
        nodeType: 'endpoint',
        onUpdateLabel: handleUpdateEndpointLabel,
      },
      draggable: true,
    });
    
    // Connect convergence to endpoints
    newEdges.push({
      id: 'converge-end',
      source: 'convergence',
      sourceHandle: 'left',
      target: 'end-chat',
      type: 'straight',
      style: { stroke: '#f43f5e', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#f43f5e' },
    });
    
    newEdges.push({
      id: 'converge-agent',
      source: 'convergence',
      sourceHandle: 'right',
      target: 'live-agent',
      type: 'straight',
      style: { stroke: '#f59e0b', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
    });
    
    setNodes(newNodes);
    setEdges(newEdges);
  }, [handleEditNode, handleDeleteNode, handleSaveNode, handleCancelEdit, handleUpdateMenu, handleUpdateEndpointLabel, handleFlowDrillDown, formatFlowName, setNodes, setEdges]);
  
  const fetchPlan = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Only pass serializable fields - avoid passing full projectConfig which may contain DOM refs or blobs
      const response = await fetch('/api/plan-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          projectConfig: {
            projectName: projectConfig.projectName,
            projectType: projectConfig.projectType,
            description: projectConfig.description,
            targetCompany: projectConfig.targetCompany
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to plan solution');
      }
      
      const data = await response.json();
      const flowData = data.flows || [];
      const menuData = data.mainMenuOptions || [];
      
      setFlows(flowData);
      setMenuOptions(menuData);
      updateFlowChart(flowData, menuData);
    } catch (err: any) {
      console.error('[Architecture] Planning failed:', err);
      setError(err.message || 'Failed to plan solution');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Fetch initial plan on mount - or restore from saved state
  // IMPORTANT: Only run once on mount, not on every savedSolutions change
  useEffect(() => {
    // Skip if already initialized (prevents restore loop)
    if (hasInitializedRef.current) {
      return;
    }
    
    // Skip if currently generating (don't interrupt)
    if (isGenerating) {
      return;
    }
    
    const restoreOrFetch = async () => {
      // Check if we have saved state to restore
      if (activeSolutionId && savedSolutions.length > 0) {
        const savedSolution = savedSolutions.find(s => s.id === activeSolutionId);
        
        if (savedSolution?.architectureState) {
          const state = savedSolution.architectureState;
          console.log('[Architecture] Restoring from saved state:', {
            flows: state.plannedFlows?.length || 0,
            menuOptions: state.menuOptions?.length || 0,
            hasGenerated: state.hasGenerated,
            nodePositions: Object.keys(state.nodePositions || {}).length
          });
          
          // Mark as initialized BEFORE setting state to prevent loops
          hasInitializedRef.current = true;
          
          // Restore flows and menu options
          if (state.plannedFlows && state.plannedFlows.length > 0) {
            setFlows(state.plannedFlows);
            setMenuOptions(state.menuOptions || []);
            
            // Restore flow previews
            if (state.flowPreviews) {
              const previewsMap = new Map<string, any[]>();
              Object.entries(state.flowPreviews).forEach(([name, nodes]) => {
                previewsMap.set(name, nodes as any[]);
              });
              // Update ref immediately for synchronous access
              flowPreviewsRef.current = previewsMap;
              console.log(`[Architecture] Restored flowPreviews to ref: ${previewsMap.size} flows`);
              setFlowPreviews(previewsMap);
            }
            
            // Restore hasGenerated flag
            if (state.hasGenerated) {
              setHasGenerated(true);
            }
            
            // ALWAYS restore extracted details for this solution (not just if missing)
            // This fixes cross-contamination when switching between solutions
            if (state.extractedDetails) {
              console.log('[Architecture] Restoring extractedDetails:', state.extractedDetails.targetCompany || state.extractedDetails.projectName);
              setExtractedDetails(state.extractedDetails);
            }
            
            // ALWAYS restore project config with brand assets and target company
            // Build complete projectConfig from architectureState and savedSolution
            // IMPORTANT: Do NOT fall back to old projectConfig values - they may be stale from localStorage
            // Priority: state.targetCompany > state.extractedDetails > savedSolution.name
            const targetCompany = state.targetCompany || state.extractedDetails?.targetCompany || savedSolution.name;
            const restoredConfig = {
              clientName: 'CX',
              projectName: savedSolution.name || state.extractedDetails?.projectName || '',
              projectType: state.extractedDetails?.projectType || savedSolution.projectType || 'support',
              description: state.extractedDetails?.description || savedSolution.description || '',
              referenceFiles: [],
              targetCompany: targetCompany,
              // Use ONLY brandAssets from saved state - do NOT fall back to old projectConfig
              brandAssets: state.brandAssets,
            };
            console.log('[Architecture] Restoring projectConfig for:', restoredConfig.targetCompany || restoredConfig.projectName);
            setProjectConfig(restoredConfig);
            
            // Update flow chart with restored data
            updateFlowChart(state.plannedFlows, state.menuOptions || []);
            
            // Restore node positions after chart is built
            if (state.nodePositions && Object.keys(state.nodePositions).length > 0) {
              setTimeout(() => {
                setNodes(nds => nds.map(node => {
                  const savedPos = state.nodePositions?.[node.id];
                  if (savedPos) {
                    return { ...node, position: savedPos };
                  }
                  return node;
                }));
              }, 100);
            }
            
            // Restore instantBuildResult for View Solution popup
            let csvToParseForFlows = '';
            if (state.instantBuildResult) {
              setLocalInstantBuildResult(state.instantBuildResult);
              setGlobalInstantBuildResult(state.instantBuildResult);
              csvToParseForFlows = state.instantBuildResult.csv || '';
            } else if (state.hasGenerated && savedSolution) {
              // Fallback: reconstruct instantBuildResult from savedSolution properties
              // This handles solutions saved before we added instantBuildResult to architectureState
              const csvContent = savedSolution.csv || savedSolution.csvContent || '';
              const reconstructedResult = {
                success: savedSolution.status === 'deployed',
                csv: csvContent,
                botId: savedSolution.botId || '',
                versionId: savedSolution.versionId,
                widgetUrl: savedSolution.widgetUrl,
                widgetId: savedSolution.widgetId,
                nodeCount: csvContent ? (csvContent.split('\n').length - 1) : 0,
                error: savedSolution.status !== 'deployed' ? 'Deployment pending' : undefined
              };
              console.log('[Architecture] Reconstructed instantBuildResult from savedSolution:', reconstructedResult);
              setLocalInstantBuildResult(reconstructedResult);
              setGlobalInstantBuildResult(reconstructedResult);
              csvToParseForFlows = csvContent;
            }
            
            // CRITICAL: Parse CSV into generatedFlows so drill-down shows actual content
            if (csvToParseForFlows && state.plannedFlows && state.plannedFlows.length > 0) {
              const flowNodeMap = parseCSVToFlowNodes(csvToParseForFlows, state.plannedFlows);
              setGeneratedFlows(flowNodeMap);
              console.log('[Architecture] Restored generatedFlows from CSV:', flowNodeMap.size, 'flows');
            }
            
            setHasRestoredState(true);
            setIsLoading(false);
            console.log('[Architecture] State restored successfully');
            return; // Skip fetching new plan
          }
        }
      }
      
      // No saved state - fetch new plan
      console.log('[Architecture] No saved state, fetching new plan');
      hasInitializedRef.current = true;
      setHasRestoredState(true);
      fetchPlan();
    };
    
    restoreOrFetch();
  }, [activeSolutionId, savedSolutions, isGenerating]);
  
  // Handle URL-based flow drill-down - when user navigates directly to /solutions/:id/flow/:flowName
  useEffect(() => {
    if (!urlFlowName || !hasRestoredState || isLoading || flows.length === 0) return;
    
    const decodedFlowName = decodeURIComponent(urlFlowName);
    
    // Check if already viewing this flow
    if (selectedFlow?.name === decodedFlowName) return;
    
    // Find the flow in our list
    const flow = flows.find(f => f.name === decodedFlowName);
    if (flow) {
      console.log('[Architecture] Auto-drilling into flow from URL:', decodedFlowName);
      // Skip the navigate call since we're already at the URL - just load the flow data
      // handleFlowDrillDown will call navigate which is fine (replace:false won't cause issues)
      handleFlowDrillDown(flow.name, flow.label || flow.name, flow.description || '');
    }
  }, [urlFlowName, hasRestoredState, isLoading, flows, selectedFlow, handleFlowDrillDown]);
  
  const handleBack = () => {
    const currentSolutionId = solutionId || activeSolutionId;
    if (currentSolutionId) {
      navigate(`/solutions/${currentSolutionId}/confirm`);
    } else {
      setInstantStep('confirm');
    }
  };
  
  // Inline generation - stays on this page
  // Accepts optional overrideApiKey to avoid stale closure issues when called after setCredentials
  const handleGenerate = async (overrideApiKey?: string) => {
    if (!extractedDetails) {
      setError('Missing project details. Please go back and fill in required information.');
      return;
    }
    
    // Use override key if provided, otherwise check credentials
    const apiKey = overrideApiKey || credentials.pypestreamApiKey;
    
    // Debug log to trace API key issues
    console.log('[Architecture] handleGenerate called with:', {
      hasOverrideKey: !!overrideApiKey,
      hasCredentialsKey: !!credentials.pypestreamApiKey,
      apiKeyLength: apiKey?.length || 0,
      apiKeyPrefix: apiKey?.substring(0, 20) + '...',
      hasCachedGeneration: !!cachedGeneration
    });
    
    // Check for API key - show modal if missing
    if (!apiKey) {
      setTempApiKey('');
      setApiKeyModalAction('generate');
      setShowApiKeyModal(true);
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    
    // Initialize progress
    const initialProgress: GenerationProgress = {
      totalFlows: flows.length,
      completedFlows: 0,
      currentFlows: [],
      nodesGenerated: 0,
      flowProgress: new Map(flows.map(f => [f.name, { status: 'pending', nodeCount: 0, nodes: [] }])),
      stage: 'planning',
      message: 'Preparing to generate flows...'
    };
    setGenerationProgress(initialProgress);
    
    try {
      // Store planned flows for the generation service
      (window as any).__plannedFlows = flows;
      (window as any).__plannedMenuOptions = menuOptions;
      
      // Store flow previews - these are the conversation structures the user has seen/approved
      // The generation service will use these to ensure the CSV matches what was previewed
      const previewsObject: Record<string, any[]> = {};
      flowPreviews.forEach((nodes, name) => {
        previewsObject[name] = nodes;
      });
      (window as any).__flowPreviews = previewsObject;
      console.log(`[Architecture] Passing ${Object.keys(previewsObject).length} flow previews to generation`);
      
      // Run the full build pipeline with progress tracking
      // Pass cached generation if available to skip expensive AI regeneration on retry
      const result = await instantBuild(
        extractedDetails.description || '',
        extractedDetails,
        projectConfig.brandAssets || null,
        apiKey, // Use the resolved API key (override or from credentials)
        'anonymous', // User ID not available in UserProfile
        (progress) => {
          // Update generation progress based on instant-build progress
          setGenerationProgress(prev => {
            if (!prev) return prev;
            
            let stage = prev.stage;
            if (progress.step === 'generating') stage = 'generating';
            else if (progress.step === 'validating') stage = 'converting';
            else if (progress.step === 'deploying') stage = 'deploying';
            else if (progress.step === 'done') stage = 'done';
            
            // Update per-flow progress if available from sequential progress
            const newFlowProgress = new Map(prev.flowProgress);
            const seqProgress = progress.sequentialProgress;
            
            let totalNodes = 0;
            
            if (seqProgress?.flows) {
              // Update flow statuses based on the flows array
              for (const flowItem of seqProgress.flows) {
                // Use nodeCount from progress if available
                const nodeCount = flowItem.nodeCount || 0;
                totalNodes += nodeCount;
                
                if (flowItem.status === 'active') {
                  newFlowProgress.set(flowItem.name, {
                    status: 'generating',
                    nodeCount: nodeCount,
                    nodes: []
                  });
                } else if (flowItem.status === 'done') {
                  newFlowProgress.set(flowItem.name, {
                    status: 'done',
                    nodeCount: nodeCount,
                    nodes: []
                  });
                }
              }
            }
            
            // Also check for total node count in progress object
            if (progress.nodeCount && progress.nodeCount > totalNodes) {
              totalNodes = progress.nodeCount;
            }
            
            // Count completed flows
            const completedCount = seqProgress?.flows?.filter(f => f.status === 'done').length || prev.completedFlows;
            
            return {
              ...prev,
              stage,
              message: progress.message || prev.message,
              nodesGenerated: totalNodes > 0 ? totalNodes : prev.nodesGenerated,
              completedFlows: completedCount,
              flowProgress: newFlowProgress
            };
          });
        },
        cachedGeneration || undefined, // Pass cached generation to skip AI regeneration on retry
        undefined // AI credentials - not used
      );
      
      // Store cached generation for retry if deployment fails
      if (result._cachedGeneration) {
        setCachedGeneration(result._cachedGeneration);
        console.log('[Architecture] Cached generation stored for potential retry');
      }
      
      // Store result
      setLocalInstantBuildResult(result);
      setGlobalInstantBuildResult(result);
      setHasGenerated(true);
      
      // Parse generated CSV and store per-flow nodes in cache - do this even on partial failure
      if (result.csv) {
        const flowNodeMap = parseCSVToFlowNodes(result.csv, flows);
        setGeneratedFlows(flowNodeMap);
        
        console.log('[Architecture] Cached generated nodes per flow:');
        for (const [flowName, nodes] of flowNodeMap) {
          console.log(`  - ${flowName}: ${nodes.length} nodes`);
        }
      }
      
      // Update the saved solution in the dashboard with generation results AND architecture state
      if (activeSolutionId) {
        try {
          // Collect node positions for state persistence
          const nodePositions: Record<string, { x: number; y: number }> = {};
          nodes.forEach(node => {
            nodePositions[node.id] = { x: node.position.x, y: node.position.y };
          });
          
          // Convert flowPreviews Map to plain object
          const flowPreviewsObj: Record<string, any[]> = {};
          flowPreviews.forEach((nodeList, name) => {
            flowPreviewsObj[name] = nodeList;
          });
          
          await updateSavedSolution(activeSolutionId, {
            nodeCount: result.nodeCount || 0,
            csvContent: result.csv || '',
            csv: result.csv || '',
            widgetUrl: result.widgetUrl,
            widgetId: result.widgetId,
            botId: result.botId,
            versionId: result.versionId,
            spreadsheetUrl: result.sheetsUrl,
            status: result.success ? 'deployed' : 'draft',
            deployedEnvironment: result.success ? 'sandbox' : undefined,
            // Save full architecture state for restoration
            architectureState: {
              plannedFlows: flows,
              menuOptions: menuOptions,
              nodePositions: nodePositions,
              flowPreviews: flowPreviewsObj,
              hasGenerated: true,
              extractedDetails: extractedDetails || undefined,
              brandAssets: projectConfig.brandAssets || undefined,
              instantStep: 'architecture',
            },
          });
          console.log('[Architecture] Updated solution with architecture state:', activeSolutionId);
        } catch (updateError) {
          console.error('[Architecture] Failed to update solution:', updateError);
        }
      }
      
      // Update progress to done
      setGenerationProgress(prev => prev ? {
        ...prev,
        stage: 'done',
        message: result.success ? 'Generation complete!' : 'Generation completed with issues'
      } : null);
      
      // Show results popup - always show if we have nodes, even with partial errors
      // This allows user to see what was generated and potentially fix/retry
      if (result.nodeCount > 0 || result.success) {
        setShowResultsPopup(true);
      }
      
    } catch (err: any) {
      console.error('[Architecture] Generation failed:', err);
      setError(err.message || 'Generation failed');
      setGenerationProgress(prev => prev ? {
        ...prev,
        stage: 'done',
        message: `Error: ${err.message || 'Generation failed'}`
      } : null);
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Handle API key submission from modal
  const handleApiKeySubmit = () => {
    if (tempApiKey.trim()) {
      const newApiKey = tempApiKey.trim();
      setCredentials({ ...credentials, pypestreamApiKey: newApiKey });
      setShowApiKeyModal(false);
      setTempApiKey('');
      
      // For fixAndDeploy, continue the deploy action
      // For generate, just save and close - user can manually trigger generation
      if (apiKeyModalAction === 'fixAndDeploy') {
        handleFixAndDeploy(newApiKey);
      }
      // Note: 'generate' action just saves the key - no auto-generation
    }
  };
  
  // Handle Fix & Deploy - uses cached CSV and attempts to fix/redeploy
  const handleFixAndDeploy = async (overrideApiKey?: string) => {
    const apiKey = overrideApiKey || credentials.pypestreamApiKey;
    
    if (!instantBuildResult?.csv) {
      setError('Missing CSV for deployment');
      return;
    }
    
    if (!apiKey) {
      // Show API key modal for fix and deploy
      setApiKeyModalAction('fixAndDeploy');
      setShowApiKeyModal(true);
      return;
    }
    
    setIsFixingErrors(true);
    setError(null);
    
    try {
      // Import the necessary functions
      const { validateAndRefineIteratively } = await import('../services/generation');
      const { uploadToBotManager, generateBotId } = await import('../services/botmanager');
      
      const botId = generateBotId(
        extractedDetails?.clientName || 'CX',
        extractedDetails?.projectName || 'Bot'
      );
      
      console.log('[FixAndDeploy] Starting fix and deploy for:', botId);
      
      // Run validation and refinement
      // Only pass serializable fields - avoid passing full projectConfig which may contain DOM refs or blobs
      const validationResult = await validateAndRefineIteratively(
        instantBuildResult.csv,
        botId,
        apiKey,
        {
          clientName: projectConfig.clientName,
          projectName: projectConfig.projectName,
          projectType: projectConfig.projectType
        },
        (update) => {
          console.log('[FixAndDeploy] Validation:', update.message);
        },
        5 // max iterations
      );
      
      console.log('[FixAndDeploy] Validation complete:', {
        valid: validationResult.valid,
        errorsRemaining: validationResult.remainingErrors.length
      });
      
      // Try to deploy the refined CSV
      const deployResult = await uploadToBotManager(
        validationResult.csv,
        botId,
        apiKey,
        { environment: 'sandbox' }
      );
      
      // Check for auth error
      if (deployResult.authError) {
        console.log('[FixAndDeploy] Auth error - showing API key modal');
        setIsFixingErrors(false);
        setApiKeyModalAction('fixAndDeploy');
        setShowApiKeyModal(true);
        return;
      }
      
      if (deployResult.success) {
        console.log('[FixAndDeploy] Deployment successful!');
        
        // Update the result
        const updatedResult = {
          ...instantBuildResult,
          csv: validationResult.csv,
          success: true,
          error: undefined,
          versionId: deployResult.versionId,
          botId: botId
        };
        
        setLocalInstantBuildResult(updatedResult);
        setGlobalInstantBuildResult(updatedResult);
        
        // Update saved solution
        if (activeSolutionId) {
          await updateSavedSolution(activeSolutionId, {
            csvContent: validationResult.csv,
            csv: validationResult.csv,
            status: 'deployed',
            deployedEnvironment: 'sandbox',
            botId: botId,
            versionId: deployResult.versionId
          });
        }
      } else {
        // Check if errors indicate auth issue
        const errorMsg = deployResult.errors?.join(', ') || 'Deployment failed';
        if (errorMsg.toLowerCase().includes('token') || errorMsg.toLowerCase().includes('auth') || errorMsg.toLowerCase().includes('invalid')) {
          console.log('[FixAndDeploy] Possible auth error in message - showing API key modal');
          setIsFixingErrors(false);
          setApiKeyModalAction('fixAndDeploy');
          setShowApiKeyModal(true);
          return;
        }
        
        console.error('[FixAndDeploy] Deployment failed:', deployResult.errors);
        setLocalInstantBuildResult({
          ...instantBuildResult,
          csv: validationResult.csv,
          error: errorMsg
        });
      }
      
    } catch (err: any) {
      console.error('[FixAndDeploy] Error:', err);
      // Check if it's an auth error
      if (err.message?.toLowerCase().includes('token') || err.message?.toLowerCase().includes('auth')) {
        setIsFixingErrors(false);
        setApiKeyModalAction('fixAndDeploy');
        setShowApiKeyModal(true);
        return;
      }
      setError(err.message || 'Fix and deploy failed');
    } finally {
      setIsFixingErrors(false);
    }
  };
  
  // Handle Create Widget - opens modal for API key input then creates widget
  const handleCreateWidget = async () => {
    if (!widgetApiKey.trim() || !instantBuildResult?.botId) return;
    
    setIsCreatingWidget(true);
    setWidgetError(null);
    
    try {
      // Save the API key
      setCredentials({ ...credentials, pypestreamApiKey: widgetApiKey.trim() });
      
      const widgetResult = await createChannelWithWidget(
        instantBuildResult.botId,
        'sandbox',
        widgetApiKey.trim(),
        {
          targetCompany: extractedDetails?.targetCompany || projectConfig.targetCompany || extractedDetails?.projectName,
          brandAssets: projectConfig.brandAssets ? {
            name: projectConfig.brandAssets.name,
            domain: projectConfig.brandAssets.domain,
            primaryColor: projectConfig.brandAssets.primaryColor,
            secondaryColor: projectConfig.brandAssets.secondaryColor,
            logoUrl: projectConfig.brandAssets.logoUrl || (projectConfig.brandAssets as any).logo,
            brandMomentUrl: projectConfig.brandAssets.brandMomentUrl,
            images: projectConfig.brandAssets.images,
            colors: projectConfig.brandAssets.colors,
            fonts: projectConfig.brandAssets.fonts,
          } : undefined,
        }
      );
      
      if (widgetResult.success && widgetResult.widgetUrl) {
        // Update the result with the new widget URL
        const updatedResult = {
          ...instantBuildResult,
          widgetUrl: widgetResult.widgetUrl,
          widgetId: widgetResult.widgetId,
        };
        setLocalInstantBuildResult(updatedResult);
        setGlobalInstantBuildResult(updatedResult);
        
        // Update saved solution
        if (activeSolutionId) {
          await updateSavedSolution(activeSolutionId, {
            widgetUrl: widgetResult.widgetUrl,
            widgetId: widgetResult.widgetId,
          });
        }
        
        setShowWidgetModal(false);
        setWidgetApiKey('');
        // Open the widget
        window.open(widgetResult.widgetUrl, '_blank');
      } else {
        setWidgetError(widgetResult.error || 'Failed to create widget');
      }
    } catch (e: any) {
      console.error('[Architecture] Widget creation failed:', e);
      setWidgetError(e.message || 'Failed to create widget');
    } finally {
      setIsCreatingWidget(false);
    }
  };
  
  // Handle Export to Sheets - exports CSV to Google Sheets
  const handleExportToSheets = async () => {
    if (!instantBuildResult?.csv) {
      setError('No CSV data to export');
      return;
    }
    
    setIsExportingToSheets(true);
    setError(null);
    
    try {
      const { exportToGoogleSheets } = await import('../services/composio');
      
      const projectName = extractedDetails?.projectName || 'Bot';
      const clientName = extractedDetails?.clientName || 'CX';
      const sheetName = `${clientName} - ${projectName}`;
      const userId = user?.email || 'anonymous';
      
      console.log('[ExportToSheets] Starting export:', sheetName);
      
      const result = await exportToGoogleSheets(instantBuildResult.csv, sheetName, userId);
      
      if (result.success && result.spreadsheetUrl) {
        console.log('[ExportToSheets] Export successful:', result.spreadsheetUrl);
        
        // Update the result with sheetsUrl
        const updatedResult = {
          ...instantBuildResult,
          sheetsUrl: result.spreadsheetUrl,
          spreadsheetId: result.spreadsheetId
        };
        
        setLocalInstantBuildResult(updatedResult);
        setGlobalInstantBuildResult(updatedResult);
        
        // Update saved solution
        if (activeSolutionId) {
          await updateSavedSolution(activeSolutionId, {
            sheetsUrl: result.spreadsheetUrl
          } as any);
        }
        
        // Open the sheet in a new tab
        window.open(result.spreadsheetUrl, '_blank');
      } else {
        throw new Error(result.error || 'Export failed');
      }
      
    } catch (err: any) {
      console.error('[ExportToSheets] Error:', err);
      setError(err.message || 'Export to Sheets failed');
    } finally {
      setIsExportingToSheets(false);
    }
  };
  
  // Legacy function for backward compatibility
  const handleProceed = handleGenerate;
  
  const handleAddFlow = () => {
    const newStartNode = flows.length > 0 
      ? Math.max(...flows.map(f => f.startNode)) + 100 
      : 300;
    
    const newFlow: PlannedFlow = {
      name: `new_flow_${flows.length + 1}`,
      label: 'New Flow',
      description: 'New conversation flow',
      startNode: newStartNode
    };
    
    const newFlows = [...flows, newFlow];
    const newMenu = [...menuOptions, {
      label: 'New Flow',
      description: 'New conversation flow',
      flowName: newFlow.name
    }];
    
    setFlows(newFlows);
    setMenuOptions(newMenu);
    updateFlowChart(newFlows, newMenu);
    
    // Invalidate cache - requires regeneration
    setGeneratedFlows(new Map());
    flowPreviewsRef.current = new Map();
    setFlowPreviews(new Map());
    setHasGenerated(false);
  };
  
  const handleChatRefine = async () => {
    if (!chatPrompt.trim()) return;
    
    setIsRefining(true);
    
    try {
      // Only pass serializable fields - avoid passing full projectConfig which may contain DOM refs or blobs
      const response = await fetch('/api/refine-architecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentFlows: flows,
          currentMenuOptions: menuOptions,
          userPrompt: chatPrompt,
          projectConfig: {
            targetCompany: projectConfig.targetCompany,
            projectName: projectConfig.projectName
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.flows) {
          setFlows(data.flows);
          setMenuOptions(data.mainMenuOptions || menuOptions);
          updateFlowChart(data.flows, data.mainMenuOptions || menuOptions);
        }
      }
      
      setChatPrompt('');
    } catch (err) {
      console.error('[Architecture] Refine failed:', err);
    } finally {
      setIsRefining(false);
    }
  };
  
  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge: Edge = {
        id: `${params.source}-${params.target}`,
        source: params.source || '',
        target: params.target || '',
        type: 'smoothstep',
        style: { stroke: '#6366f1', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );
  
  if (isLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0a0a0f]">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 flex items-center justify-center mb-6">
          <Loader2 className="w-8 h-8 text-[#a5b4fc] animate-spin" />
        </div>
        <h2 className="text-xl font-medium text-white mb-2">Planning Solution Architecture</h2>
        <p className="text-[#6a6a75]">AI is analyzing your requirements...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0a0a0f]">
        <div className="text-center max-w-md">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchPlan}
            className="px-4 py-2 bg-[#6366f1] text-white rounded-lg hover:bg-[#5558e3] transition-colors"
          >
            <RefreshCw className="w-4 h-4 inline mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  // If no project details, show helpful message and redirect option
  if (!extractedDetails) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0a0a0f]">
        <div className="text-center p-8 max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-500/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-3">No Project Details Found</h2>
          <p className="text-[#8585a3] mb-6">
            Your session may have expired or you navigated here directly. 
            Please start a new project by describing what you want to build.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Start New Project
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f]">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl px-4 py-3 z-10">
        <div className="flex items-center justify-between max-w-[1800px] mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#6a6a75] hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <h1 className="text-lg font-semibold text-white flex items-center gap-2">
                <Boxes className="w-5 h-5 text-[#a5b4fc]" />
                Solution Architecture
              </h1>
              <p className="text-xs text-[#6a6a75]">
                Drag nodes to rearrange • Double-click to edit • Connect flows by dragging handles
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg text-sm">
              <span className="text-[#6a6a75]">Flows:</span>
              <span className="text-white font-medium">{flows.length}</span>
            </div>
            
            <button
              onClick={handleAddFlow}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#a5b4fc] hover:text-white hover:bg-[#6366f1]/10 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Flow
            </button>
            
            <button
              onClick={() => setShowChat(!showChat)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                showChat 
                  ? 'bg-[#6366f1] text-white' 
                  : 'text-[#a5b4fc] hover:text-white hover:bg-[#6366f1]/10'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              AI Architect
            </button>
            
            {/* API Key button - shows status and allows update */}
            <button
              onClick={() => {
                setTempApiKey(credentials.pypestreamApiKey || '');
                setApiKeyModalAction('generate');
                setShowApiKeyModal(true);
              }}
              title={credentials.pypestreamApiKey ? 'Update API Key' : 'Set API Key (required)'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                credentials.pypestreamApiKey
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
              }`}
            >
              <Key className="w-4 h-4" />
              {credentials.pypestreamApiKey ? 'API Key Set' : 'Set API Key'}
            </button>
            
            {hasGenerated ? (
              <GenerateDropdown
                onViewResults={() => setShowResultsPopup(true)}
                onRegenerate={() => {
                  setHasGenerated(false);
                  handleGenerate();
                }}
                isGenerating={isGenerating}
              />
            ) : (
              <button
                onClick={() => handleGenerate()}
                disabled={flows.length === 0 || isGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-[#6366f1]/20"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    Generate
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Generation Progress Overlay */}
      {isGenerating && generationProgress && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center">
          <GenerationProgressPanel
            progress={generationProgress}
            flows={flows}
          />
        </div>,
        document.body
      )}
      
      {/* Results Modal */}
      <ResultsModal
        isOpen={showResultsPopup}
        onClose={() => setShowResultsPopup(false)}
        result={instantBuildResult}
        projectConfig={projectConfig}
        extractedDetails={extractedDetails}
        onEditFlow={() => {
          setShowResultsPopup(false);
          // User can continue editing on this page
        }}
        onFixAndDeploy={handleFixAndDeploy}
        isFixing={isFixingErrors}
        onCreateWidget={() => {
          setWidgetApiKey(credentials.pypestreamApiKey || '');
          setWidgetError(null);
          setShowWidgetModal(true);
        }}
        onExportToSheets={handleExportToSheets}
        isExporting={isExportingToSheets}
      />
      
      {/* API Key Modal */}
      {showApiKeyModal && createPortal(
        <>
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]" 
            onClick={() => setShowApiKeyModal(false)}
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
            <div 
              className="bg-[#0f0f14] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-semibold text-white mb-2">
                  {apiKeyModalAction === 'fixAndDeploy' ? 'API Key Required for Deployment' : 'Pypestream API Key Required'}
                </h2>
                <p className="text-sm text-[#6a6a75] mb-4">
                  {apiKeyModalAction === 'fixAndDeploy' 
                    ? 'Your API key is invalid or expired. Enter a fresh API key to continue deploying.'
                    : 'Enter your Pypestream API key to deploy the bot. Keys expire every hour.'}
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-1.5">API Key</label>
                    <input
                      type="password"
                      value={tempApiKey}
                      onChange={(e) => setTempApiKey(e.target.value)}
                      placeholder="Enter your Pypestream API key..."
                      className="w-full px-4 py-3 bg-[#1a1a1f] border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-[#6366f1]/50 focus:ring-1 focus:ring-[#6366f1]/20"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tempApiKey.trim()) {
                          handleApiKeySubmit();
                        }
                      }}
                    />
                  </div>
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowApiKeyModal(false)}
                      className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleApiKeySubmit}
                      disabled={!tempApiKey.trim()}
                      className={`flex-1 px-4 py-2.5 text-white text-sm font-medium rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all ${
                        apiKeyModalAction === 'fixAndDeploy'
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                          : 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]'
                      }`}
                    >
                      {apiKeyModalAction === 'fixAndDeploy' ? 'Deploy Now' : 'Save'}
                    </button>
                  </div>
                </div>
                
                <p className="text-xs text-[#4a4a55] mt-4">
                  Get your API key from the Pypestream Bot Manager dashboard.
                </p>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
      
      {/* Widget Creation Modal */}
      {showWidgetModal && createPortal(
        <>
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]"
            onClick={() => setShowWidgetModal(false)}
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
            <div 
              className="bg-[#0f0f14] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-semibold text-white mb-2">Create Widget</h2>
                <p className="text-sm text-[#6a6a75] mb-4">
                  Enter your Pypestream API key to create a test widget for this bot.
                </p>
                
                {widgetError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                    <p className="text-sm text-red-400">{widgetError}</p>
                  </div>
                )}
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-1.5">API Key</label>
                    <input
                      type="password"
                      value={widgetApiKey}
                      onChange={(e) => setWidgetApiKey(e.target.value)}
                      placeholder="Enter your Pypestream API key..."
                      className="w-full px-4 py-3 bg-[#1a1a1f] border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-[#6366f1]/50 focus:ring-1 focus:ring-[#6366f1]/20"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && widgetApiKey.trim() && !isCreatingWidget) {
                          handleCreateWidget();
                        }
                      }}
                    />
                  </div>
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowWidgetModal(false)}
                      className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateWidget}
                      disabled={!widgetApiKey.trim() || isCreatingWidget}
                      className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white text-sm font-medium rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                      {isCreatingWidget ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create Widget'
                      )}
                    </button>
                  </div>
                </div>
                
                <p className="text-xs text-[#4a4a55] mt-4">
                  Get your API key from the Pypestream Bot Manager dashboard.
                </p>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
      
      {/* Canvas - Show either Architecture or Flow Detail view */}
      <div className="flex-1 relative">
        {selectedFlow ? (
          // ===== FLOW DETAIL VIEW =====
          <>
            {/* Back button and flow title */}
            <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
              <button
                onClick={handleBackToArchitecture}
                className="flex items-center gap-2 px-3 py-2 bg-[#12121a] hover:bg-[#1a1a24] border border-white/10 rounded-xl text-sm text-white/70 hover:text-white transition-colors shadow-lg"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Architecture
              </button>
              <div className="px-4 py-2 bg-[#6366f1]/20 border border-[#6366f1]/30 rounded-xl flex items-center gap-3">
                <div>
                  <span className="text-sm text-white font-medium">{selectedFlow.label}</span>
                  <span className="text-xs text-white/50 ml-2">Conversation Flow</span>
                </div>
                <button
                  onClick={handleRegenerateFlow}
                  disabled={isLoadingFlowDetail}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#6366f1]/30 hover:bg-[#6366f1]/50 border border-[#6366f1]/40 rounded-lg text-xs text-white/80 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Regenerate this flow"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFlowDetail ? 'animate-spin' : ''}`} />
                  Regenerate
                </button>
              </div>
            </div>
            
            {isLoadingFlowDetail ? (
              <div className="h-full flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 text-[#a5b4fc] animate-spin mb-4" />
                <p className="text-white/60">Generating conversation flow...</p>
              </div>
            ) : (
              <ReactFlow
                nodes={flowDetailNodes}
                edges={flowDetailEdges}
                onNodesChange={onFlowDetailNodesChange}
                onEdgesChange={onFlowDetailEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.3}
                maxZoom={2}
                defaultEdgeOptions={{
                  type: 'straight',
                  style: { stroke: '#4a4a55', strokeWidth: 1.5 },
                }}
                proOptions={{ hideAttribution: true }}
                style={{ background: '#0a0a0f' }}
              >
                <Background color="#1a1a24" gap={20} size={1} />
                <Controls 
                  showInteractive={false}
                  className="!bg-[#12121a] !border-white/10 !rounded-xl !shadow-xl"
                />
                <FitViewButton />
                
                {/* Flow Detail Legend */}
                <Panel position="bottom-left" className="!m-4">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-[#12121a]/90 backdrop-blur-sm rounded-xl border border-white/5 text-xs max-w-[600px]">
                    <div className="flex items-center gap-1.5">
                      <Bot className="w-3 h-3 text-emerald-400" />
                      <span className="text-white/60">Response</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MessageCircle className="w-3 h-3 text-[#6366f1]" />
                      <span className="text-white/60">Question</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Type className="w-3 h-3 text-cyan-400" />
                      <span className="text-white/60">Free Text</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Brain className="w-3 h-3 text-violet-400" />
                      <span className="text-white/60">NLU</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <LayoutGrid className="w-3 h-3 text-pink-400" />
                      <span className="text-white/60">Carousel</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <List className="w-3 h-3 text-orange-400" />
                      <span className="text-white/60">List</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span className="text-white/60">Action</span>
                    </div>
                  </div>
                </Panel>
              </ReactFlow>
            )}
          </>
        ) : (
          // ===== ARCHITECTURE VIEW =====
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={2}
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { stroke: '#4a4a55', strokeWidth: 1.5 },
            }}
            proOptions={{ hideAttribution: true }}
            style={{ background: '#0a0a0f' }}
          >
            <Background color="#1a1a24" gap={20} size={1} />
            <Controls 
              showInteractive={false}
              className="!bg-[#12121a] !border-white/10 !rounded-xl !shadow-xl"
            />
            {/* Fit to Screen Button */}
            <FitViewButton />
            
            <MiniMap 
              nodeColor={(node) => {
                switch (node.type) {
                  case 'start': return '#10b981';
                  case 'menu': return '#6366f1';
                  case 'flow': return '#3b3b4a';
                  case 'convergence': return '#4a4a55';
                  case 'endpoint': return '#f43f5e';
                  default: return '#3b3b4a';
                }
              }}
              maskColor="rgba(0, 0, 0, 0.8)"
              className="!bg-[#12121a] !border-white/10 !rounded-xl"
            />
            
            {/* Legend Panel */}
            <Panel position="bottom-left" className="!m-4">
              <div className="flex items-center gap-4 px-4 py-2 bg-[#12121a]/90 backdrop-blur-sm rounded-xl border border-white/5 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-gradient-to-r from-emerald-500 to-green-500" />
                  <span className="text-white/60">Start</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6]" />
                  <span className="text-white/60">Menu</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-[#12121a] border border-white/20" />
                  <span className="text-white/60">Flow</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 bg-[#22c55e]" />
                  <span className="text-white/60">Routes to</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-gradient-to-r from-rose-500 to-red-500" />
                  <span className="text-white/60">End</span>
                </div>
              </div>
            </Panel>
          </ReactFlow>
        )}
        
        {/* AI Chat Panel */}
        {showChat && (
          <div className="absolute top-4 right-4 w-80 bg-[#12121a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50">
            <div className="p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">AI Architect</h3>
                  <p className="text-[10px] text-[#6a6a75]">Describe changes in natural language</p>
                </div>
                <button 
                  onClick={() => setShowChat(false)}
                  className="ml-auto p-1 text-white/40 hover:text-white rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="p-4">
              <textarea
                value={chatPrompt}
                onChange={(e) => setChatPrompt(e.target.value)}
                placeholder="e.g., 'Add a returns flow' or 'Merge billing and payments'"
                className="w-full px-3 py-2 bg-[#1a1a24] border border-white/10 rounded-lg text-white text-sm placeholder:text-[#4a4a55] focus:outline-none focus:border-[#6366f1] resize-none"
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatRefine();
                  }
                }}
              />
              
              <button
                onClick={handleChatRefine}
                disabled={isRefining || !chatPrompt.trim()}
                className="w-full mt-3 py-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isRefining ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Apply Changes
                  </>
                )}
              </button>
              
              <div className="mt-4 space-y-2">
                <p className="text-[10px] text-[#6a6a75] uppercase tracking-wider">Quick actions</p>
                {[
                  'Add a FAQ flow',
                  'Add escalation to agent',
                  'Simplify to 3 main flows',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setChatPrompt(suggestion)}
                    className="w-full text-left px-3 py-2 text-xs text-[#8585a3] bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Action Node Code Generation Modal */}
      {codeModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-8">
          <div className="w-full max-w-4xl max-h-[90vh] bg-[#0a0a0f] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/10 bg-gradient-to-r from-violet-500/10 to-amber-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-amber-500 flex items-center justify-center">
                    <Code className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Action Node Generator</h2>
                    <p className="text-xs text-white/50">
                      {codeModal.nodeData?.type === 'nlu_intent' ? 'NLU Intent Detection' : 'Action Node'} → Python Script
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseCodeModal}
                  className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-6">
              {codeModal.isGenerating ? (
                <div className="h-64 flex flex-col items-center justify-center">
                  <Loader2 className="w-8 h-8 text-violet-400 animate-spin mb-4" />
                  <p className="text-white/60">Generating Python code...</p>
                  <p className="text-xs text-white/40 mt-2">Analyzing intents and creating action script</p>
                </div>
              ) : (
                <>
                  {/* Node Info */}
                  {codeModal.nodeData?.intents && (
                    <div className="mb-4 p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                      <p className="text-xs text-violet-400 font-semibold uppercase mb-2">Detected Intents</p>
                      <div className="flex flex-wrap gap-2">
                        {codeModal.nodeData.intents.map((intent: string, i: number) => (
                          <span key={i} className="px-3 py-1 bg-violet-500/20 border border-violet-500/30 rounded-lg text-sm text-violet-300">
                            {intent}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Code Display */}
                  <div className="relative">
                    <div className="absolute top-3 right-3 flex gap-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(codeModal.generatedCode)}
                        className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors"
                        title="Copy code"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          const blob = new Blob([codeModal.generatedCode], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${codeModal.nodeData?.type || 'action'}_node.py`;
                          a.click();
                        }}
                        className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors"
                        title="Download file"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                    <pre className="p-4 bg-[#12121a] border border-white/10 rounded-xl overflow-auto text-sm text-white/80 font-mono leading-relaxed max-h-[400px]">
                      <code>{codeModal.generatedCode}</code>
                    </pre>
                  </div>
                  
                  {/* Test Result */}
                  {codeModal.testResult && (
                    <div className={`mt-4 p-4 rounded-xl border ${
                      codeModal.testResult.success 
                        ? 'bg-emerald-500/10 border-emerald-500/30' 
                        : 'bg-red-500/10 border-red-500/30'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        {codeModal.testResult.success ? (
                          <CheckCircle className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400" />
                        )}
                        <span className={`font-semibold ${
                          codeModal.testResult.success ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {codeModal.testResult.success ? 'Test Passed' : 'Test Failed'}
                        </span>
                      </div>
                      <pre className="text-xs text-white/60 font-mono whitespace-pre-wrap">
                        {codeModal.testResult.output}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex items-center justify-between">
              <p className="text-xs text-white/40">
                Generated for: {selectedFlow?.label || 'Flow'}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCloseCodeModal}
                  className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleTestCode}
                  disabled={codeModal.isGenerating || codeModal.isTesting || !codeModal.generatedCode}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/30 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {codeModal.isTesting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Run Test
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SolutionArchitecturePage;
