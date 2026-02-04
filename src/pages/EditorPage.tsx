import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useStore } from '../store/useStore';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
  Edge,
  MarkerType,
  Panel,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  ArrowLeft, 
  ExternalLink, 
  RefreshCw, 
  AlertCircle,
  MessageSquare,
  Cog,
  Loader2,
  Cloud,
  CloudOff,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Code2,
  FileCode,
  Link2
} from 'lucide-react';
import { SheetsSyncService } from '../services/sheets-sync';
import { oneClickDeploy } from '../services/botmanager';
import { exportToGoogleSheets } from '../services/composio';
import { ScriptEditorModal } from '../components';
import type { CustomScript } from '../types';

// System/Official action nodes that don't need custom scripts
const SYSTEM_ACTION_NODES = new Set([
  'SysAssignVariable',
  'SysMultiMatchRouting', 
  'SysShowMetadata',
  'SysSetEnv',
  'SysVariableReset',
  'HandleBotError',
  'UserPlatformRouting',
  'BotToPlatform',
  'GetValue',
  'SlackLogger',
  'PostEventToBQ',
  'LimitCounter',
  'EventsToGlobalVariableValues',
  'SetFormID',
  'SetVar',
  'MatchRouting',
  'VarCheck',
  'MultiMatchRouting',
  'AssignVariable',
  'ShowMetadata',
  'VariableReset'
]);

interface ParsedNode {
  nodeNumber: number;
  nodeType: 'D' | 'A';
  nodeName: string;
  message?: string;
  richAssetType?: string;
  richAssetContent?: string;
  command?: string;
  nextNodes?: string;
  whatNext?: string;
  answerRequired?: string;
  nluDisabled?: string;
}

// Custom node component for Decision nodes
function DecisionNode({ data, selected }: { data: ParsedNode; selected: boolean }) {
  return (
    <div className={`px-4 py-3 rounded-xl shadow-lg min-w-[200px] max-w-[280px] transition-all ${
      selected 
        ? 'bg-blue-600 ring-2 ring-blue-400 ring-offset-2 ring-offset-[#0a0a0f]' 
        : 'bg-gradient-to-br from-blue-600 to-blue-700'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-3 !h-3" />
      
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="w-4 h-4 text-blue-200" />
        <span className="text-xs font-mono text-blue-200">#{data.nodeNumber}</span>
      </div>
      
      <div className="text-sm font-medium text-white mb-1 truncate">
        {data.nodeName}
      </div>
      
      {data.message && (
        <div className="text-xs text-blue-100/80 line-clamp-2">
          {data.message}
        </div>
      )}
      
      {data.richAssetType && (
        <div className="mt-2 px-2 py-1 bg-blue-500/30 rounded text-xs text-blue-100">
          {data.richAssetType}
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-3 !h-3" />
    </div>
  );
}

// Custom node component for Action nodes
function ActionNode({ data, selected }: { data: ParsedNode; selected: boolean }) {
  return (
    <div className={`px-4 py-3 rounded-xl shadow-lg min-w-[200px] max-w-[280px] transition-all ${
      selected 
        ? 'bg-emerald-600 ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#0a0a0f]' 
        : 'bg-gradient-to-br from-emerald-600 to-emerald-700'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-emerald-400 !w-3 !h-3" />
      
      <div className="flex items-center gap-2 mb-2">
        <Cog className="w-4 h-4 text-emerald-200" />
        <span className="text-xs font-mono text-emerald-200">#{data.nodeNumber}</span>
      </div>
      
      <div className="text-sm font-medium text-white mb-1 truncate">
        {data.nodeName}
      </div>
      
      {data.command && (
        <div className="mt-2 px-2 py-1 bg-emerald-500/30 rounded text-xs text-emerald-100 font-mono">
          {data.command}
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-400 !w-3 !h-3" />
    </div>
  );
}

// Custom node component for System/Error nodes
function SystemNode({ data, selected }: { data: ParsedNode; selected: boolean }) {
  return (
    <div className={`px-4 py-3 rounded-xl shadow-lg min-w-[180px] max-w-[240px] transition-all ${
      selected 
        ? 'bg-amber-600 ring-2 ring-amber-400 ring-offset-2 ring-offset-[#0a0a0f]' 
        : 'bg-gradient-to-br from-amber-600 to-amber-700'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-amber-400 !w-3 !h-3" />
      
      <div className="flex items-center gap-2 mb-1">
        <AlertCircle className="w-4 h-4 text-amber-200" />
        <span className="text-xs font-mono text-amber-200">#{data.nodeNumber}</span>
      </div>
      
      <div className="text-sm font-medium text-white truncate">
        {data.nodeName}
      </div>
      
      <Handle type="source" position={Position.Bottom} className="!bg-amber-400 !w-3 !h-3" />
    </div>
  );
}

const nodeTypes = {
  decision: DecisionNode,
  action: ActionNode,
  system: SystemNode,
};

/**
 * EditorPage - Visual flowchart editor with React Flow
 */
export function EditorPage() {
  const { 
    instantBuildResult, 
    extractedDetails,
    credentials,
    setInstantStep,
    setInstantBuildResult,
    integrations,
    connectIntegration,
    user,
    activeSolutionId,
    updateSavedSolution
  } = useStore();
  
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<ParsedNode | null>(null);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'offline'>('synced');
  const [isRedeploying, setIsRedeploying] = useState(false);
  const [redeployError, setRedeployError] = useState<string | null>(null);
  const [parsedNodes, setParsedNodes] = useState<ParsedNode[]>([]);
  const syncService = useRef<SheetsSyncService | null>(null);
  
  // Google Sheets export state
  const [exportingToSheets, setExportingToSheets] = useState(false);
  const [sheetsExportError, setSheetsExportError] = useState<string | null>(null);
  
  // Check if Google Sheets is connected
  const googleSheetsIntegration = integrations.find((i) => i.id === 'google-sheets');
  const isSheetsConnected = googleSheetsIntegration?.connected ?? false;
  
  // Script editor state
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<CustomScript | null>(null);
  const [scripts, setScripts] = useState<CustomScript[]>(instantBuildResult?.scripts || []);
  
  // Initialize scripts from instantBuildResult
  useEffect(() => {
    if (instantBuildResult?.scripts) {
      setScripts(instantBuildResult.scripts);
    }
  }, [instantBuildResult?.scripts]);
  
  // Check if a command is a custom script (not a system/official node)
  const isCustomScript = useCallback((command: string | undefined): boolean => {
    if (!command) return false;
    return !SYSTEM_ACTION_NODES.has(command);
  }, []);
  
  // Get script content for a command
  const getScriptForCommand = useCallback((command: string): CustomScript | null => {
    return scripts.find(s => s.name === command) || null;
  }, [scripts]);
  
  // Handle opening script editor
  const handleOpenScriptEditor = useCallback((command: string) => {
    const existingScript = getScriptForCommand(command);
    if (existingScript) {
      setEditingScript(existingScript);
    } else {
      // Create a new script with template
      setEditingScript({ name: command, content: '' });
    }
    setScriptEditorOpen(true);
  }, [getScriptForCommand]);
  
  // Handle saving script
  const handleSaveScript = useCallback((name: string, content: string) => {
    const updatedScripts = scripts.filter(s => s.name !== name);
    updatedScripts.push({ name, content });
    setScripts(updatedScripts);
    
    // Update instantBuildResult with new scripts
    if (instantBuildResult) {
      setInstantBuildResult({
        ...instantBuildResult,
        scripts: updatedScripts
      });
    }
    
    setScriptEditorOpen(false);
    setEditingScript(null);
    console.log(`[EditorPage] Script saved: ${name}`);
  }, [scripts, instantBuildResult, setInstantBuildResult]);
  
  // Parse CSV and create flow nodes/edges on mount
  useEffect(() => {
    if (instantBuildResult?.csv) {
      const parsed = parseCSVToNodes(instantBuildResult.csv);
      setParsedNodes(parsed);
      
      const { flowNodes, flowEdges } = createFlowElements(parsed);
      setNodes(flowNodes);
      setEdges(flowEdges);
    }
  }, [instantBuildResult?.csv, setNodes, setEdges]);
  
  // Initialize sync service
  useEffect(() => {
    if (instantBuildResult?.spreadsheetId) {
      syncService.current = new SheetsSyncService(instantBuildResult.spreadsheetId);
      
      syncService.current.startPolling((newCSV) => {
        console.log('[Editor] Remote change detected');
        const parsed = parseCSVToNodes(newCSV);
        setParsedNodes(parsed);
        const { flowNodes, flowEdges } = createFlowElements(parsed);
        setNodes(flowNodes);
        setEdges(flowEdges);
        setSyncStatus('synced');
      });
      
      return () => {
        syncService.current?.stopPolling();
      };
    } else {
      setSyncStatus('offline');
    }
  }, [instantBuildResult?.spreadsheetId, setNodes, setEdges]);
  
  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({
      ...connection,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#6366f1', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
    }, eds)),
    [setEdges]
  );
  
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const parsed = parsedNodes.find(n => n.nodeNumber === parseInt(node.id));
    setSelectedNode(parsed || null);
  }, [parsedNodes]);
  
  const handleBack = () => {
    setInstantStep('results');
  };
  
  const handleOpenSheets = async () => {
    // Case 1: Already have a sheetsUrl - just open it
    if (instantBuildResult?.sheetsUrl) {
      window.open(instantBuildResult.sheetsUrl, '_blank');
      return;
    }
    
    // Case 2: Not connected to Google Sheets - initiate OAuth flow
    if (!isSheetsConnected) {
      setExportingToSheets(true);
      setSheetsExportError(null);
      
      try {
        const connected = await connectIntegration('google-sheets');
        
        if (!connected) {
          setSheetsExportError('Failed to connect to Google Sheets');
          setExportingToSheets(false);
          return;
        }
        
        // After connecting, export the CSV
        await exportCSVToSheets();
      } catch (e: any) {
        console.error('Sheets connection error:', e);
        setSheetsExportError(e.message || 'Failed to connect');
        setExportingToSheets(false);
      }
      return;
    }
    
    // Case 3: Connected but no sheetsUrl yet - export now
    await exportCSVToSheets();
  };
  
  const exportCSVToSheets = async () => {
    if (!instantBuildResult?.csv) {
      setSheetsExportError('No CSV content available to export');
      setExportingToSheets(false);
      return;
    }
    
    setExportingToSheets(true);
    setSheetsExportError(null);
    
    try {
      const userId = user.email || `user_${Date.now()}`;
      const fileName = `${extractedDetails?.clientName || 'Solution'}_${extractedDetails?.projectName || 'Export'}`;
      
      const result = await exportToGoogleSheets(
        instantBuildResult.csv,
        fileName,
        userId
      );
      
      if (result.success && result.spreadsheetUrl) {
        // Update the result with the new sheetsUrl
        setInstantBuildResult({
          ...instantBuildResult,
          sheetsUrl: result.spreadsheetUrl,
          spreadsheetId: result.spreadsheetId,
        });
        
        // Also update in Supabase if we have an active solution
        if (activeSolutionId) {
          updateSavedSolution(activeSolutionId, {
            spreadsheetUrl: result.spreadsheetUrl,
          });
        }
        
        // Open the new spreadsheet
        window.open(result.spreadsheetUrl, '_blank');
      } else {
        setSheetsExportError(result.error || 'Failed to export to Google Sheets');
      }
    } catch (e: any) {
      console.error('Sheets export error:', e);
      setSheetsExportError(e.message || 'Export failed');
    } finally {
      setExportingToSheets(false);
    }
  };
  
  const handleRedeploy = async () => {
    if (!instantBuildResult?.botId || !credentials.pypestreamApiKey) {
      setRedeployError('Missing bot ID or API key');
      return;
    }
    
    setIsRedeploying(true);
    setRedeployError(null);
    
    try {
      const result = await oneClickDeploy(
        instantBuildResult.csv || '',
        instantBuildResult.botId,
        'sandbox',
        credentials.pypestreamApiKey
      );
      
      if (!result.success) {
        throw new Error(result.message || 'Deployment failed');
      }
      
      console.log('[Editor] Redeployed successfully');
    } catch (error: any) {
      setRedeployError(error.message || 'Redeploy failed');
    } finally {
      setIsRedeploying(false);
    }
  };
  
  const handleCloseDetails = () => {
    setSelectedNode(null);
  };
  
  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0f0f13] shrink-0 z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="p-2 text-[#6a6a75] hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-white">
              {extractedDetails?.projectName || 'Solution Editor'}
            </h1>
            <p className="text-xs text-[#6a6a75]">
              {extractedDetails?.targetCompany || ''} • {parsedNodes.length} nodes
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Sync status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
            syncStatus === 'synced' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
            syncStatus === 'syncing' ? 'bg-[#6366f1]/10 text-[#6366f1]' :
            syncStatus === 'offline' ? 'bg-[#4a4a55]/20 text-[#6a6a75]' :
            'bg-red-500/10 text-red-400'
          }`}>
            {syncStatus === 'synced' && <Cloud className="w-3.5 h-3.5" />}
            {syncStatus === 'syncing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {syncStatus === 'offline' && <CloudOff className="w-3.5 h-3.5" />}
            {syncStatus === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
            {syncStatus === 'synced' && 'Synced'}
            {syncStatus === 'syncing' && 'Syncing...'}
            {syncStatus === 'offline' && 'Offline'}
            {syncStatus === 'error' && 'Sync error'}
          </div>
          
          {/* Sheets link */}
          <button
            onClick={handleOpenSheets}
            disabled={exportingToSheets}
            className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${
              exportingToSheets
                ? 'text-[#22c55e] border-[#22c55e]/30 cursor-wait'
                : sheetsExportError
                ? 'text-red-400 border-red-500/30 hover:border-red-500/50'
                : instantBuildResult?.sheetsUrl
                ? 'text-[#8585a3] hover:text-white border-white/10 hover:border-white/20'
                : !isSheetsConnected
                ? 'text-amber-400 border-amber-500/30 hover:border-amber-500/50 hover:text-amber-300'
                : 'text-[#22c55e] border-[#22c55e]/30 hover:border-[#22c55e]/50 hover:text-[#22c55e]'
            }`}
            title={
              exportingToSheets
                ? 'Exporting...'
                : sheetsExportError
                ? sheetsExportError
                : instantBuildResult?.sheetsUrl
                ? 'Open in Google Sheets'
                : !isSheetsConnected
                ? 'Connect Google Sheets'
                : 'Export to Google Sheets'
            }
          >
            {exportingToSheets ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : !isSheetsConnected && !instantBuildResult?.sheetsUrl ? (
              <Link2 className="w-4 h-4" />
            ) : (
              <ExternalLink className="w-4 h-4" />
            )}
            {exportingToSheets
              ? 'Exporting...'
              : instantBuildResult?.sheetsUrl
              ? 'Sheets'
              : !isSheetsConnected
              ? 'Connect'
              : 'Export'}
          </button>
          
          {/* Redeploy button */}
          <button
            onClick={handleRedeploy}
            disabled={isRedeploying}
            className="flex items-center gap-2 px-4 py-2 bg-[#6366f1] text-white text-sm rounded-lg hover:bg-[#5558e3] transition-colors disabled:opacity-50"
          >
            {isRedeploying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Redeploy
          </button>
        </div>
      </div>
      
      {/* Redeploy error */}
      {redeployError && (
        <div className="mx-4 mt-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 shrink-0">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-sm text-red-400">{redeployError}</span>
          <button 
            onClick={() => setRedeployError(null)}
            className="ml-auto text-xs text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}
      
      {/* Flow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: { stroke: '#6366f1', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#333" gap={20} size={1} />
          <Controls 
            className="!bg-[#1a1a1f] !border-white/10 !shadow-lg"
            showZoom={true}
            showFitView={true}
            showInteractive={false}
          />
          <MiniMap 
            className="!bg-[#1a1a1f] !border-white/10"
            nodeColor={(node) => {
              switch (node.type) {
                case 'decision': return '#3b82f6';
                case 'action': return '#10b981';
                case 'system': return '#f59e0b';
                default: return '#6b7280';
              }
            }}
            maskColor="rgba(0, 0, 0, 0.7)"
          />
          
          {/* Legend */}
          <Panel position="top-left" className="!m-4">
            <div className="bg-[#1a1a1f]/90 backdrop-blur border border-white/10 rounded-lg p-3 space-y-2">
              <div className="text-xs font-medium text-[#8585a3] mb-2">Node Types</div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded bg-blue-500" />
                <span className="text-[#a5b4fc]">Decision</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded bg-emerald-500" />
                <span className="text-[#6ee7b7]">Action</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded bg-amber-500" />
                <span className="text-[#fcd34d]">System</span>
              </div>
            </div>
          </Panel>
        </ReactFlow>
        
        {/* Node Details Sidebar */}
        {selectedNode && (
          <div className="absolute top-0 right-0 bottom-0 w-80 bg-[#1a1a1f] border-l border-white/10 shadow-xl overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {selectedNode.nodeType === 'D' ? (
                    <MessageSquare className="w-5 h-5 text-blue-400" />
                  ) : (
                    <Cog className="w-5 h-5 text-emerald-400" />
                  )}
                  <span className="text-sm font-mono text-[#6a6a75]">#{selectedNode.nodeNumber}</span>
                </div>
                <button
                  onClick={handleCloseDetails}
                  className="p-1.5 text-[#6a6a75] hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <h3 className="text-lg font-semibold text-white mb-4">{selectedNode.nodeName}</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-[#6a6a75] uppercase tracking-wider mb-1">Type</label>
                  <p className="text-sm text-white">
                    {selectedNode.nodeType === 'D' ? 'Decision Node' : 'Action Node'}
                  </p>
                </div>
                
                {selectedNode.message && (
                  <div>
                    <label className="block text-xs text-[#6a6a75] uppercase tracking-wider mb-1">Message</label>
                    <p className="text-sm text-white whitespace-pre-wrap">{selectedNode.message}</p>
                  </div>
                )}
                
                {selectedNode.richAssetType && (
                  <div>
                    <label className="block text-xs text-[#6a6a75] uppercase tracking-wider mb-1">Rich Asset</label>
                    <p className="text-sm text-white font-mono">{selectedNode.richAssetType}</p>
                  </div>
                )}
                
                {selectedNode.command && (
                  <div>
                    <label className="block text-xs text-[#6a6a75] uppercase tracking-wider mb-1">Command</label>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-white font-mono">{selectedNode.command}</p>
                      {isCustomScript(selectedNode.command) ? (
                        <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 rounded">Custom</span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-300 rounded">System</span>
                      )}
                    </div>
                    
                    {/* Edit Script button for custom scripts */}
                    {isCustomScript(selectedNode.command) && (
                      <button
                        onClick={() => handleOpenScriptEditor(selectedNode.command!)}
                        className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        <FileCode className="w-3.5 h-3.5" />
                        {getScriptForCommand(selectedNode.command!) ? 'Edit Script' : 'Create Script'}
                      </button>
                    )}
                  </div>
                )}
                
                {selectedNode.nextNodes && (
                  <div>
                    <label className="block text-xs text-[#6a6a75] uppercase tracking-wider mb-1">Next Nodes</label>
                    <p className="text-sm text-white font-mono">{selectedNode.nextNodes}</p>
                  </div>
                )}
                
                {selectedNode.whatNext && (
                  <div>
                    <label className="block text-xs text-[#6a6a75] uppercase tracking-wider mb-1">What Next?</label>
                    <p className="text-sm text-white font-mono break-all">{selectedNode.whatNext}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Script Editor Modal */}
      <ScriptEditorModal
        isOpen={scriptEditorOpen}
        onClose={() => {
          setScriptEditorOpen(false);
          setEditingScript(null);
        }}
        script={editingScript}
        onSave={handleSaveScript}
      />
    </div>
  );
}

// Helper: Parse CSV to node objects
function parseCSVToNodes(csv: string): ParsedNode[] {
  const lines = csv.split('\n');
  if (lines.length < 2) return [];
  
  const nodes: ParsedNode[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = parseCSVLine(line);
    const nodeNum = parseInt(fields[0], 10);
    if (isNaN(nodeNum)) continue;
    
    nodes.push({
      nodeNumber: nodeNum,
      nodeType: (fields[1]?.trim().toUpperCase() === 'A' ? 'A' : 'D') as 'D' | 'A',
      nodeName: fields[2]?.trim() || `Node ${nodeNum}`,
      nluDisabled: fields[6]?.trim(),
      nextNodes: fields[7]?.trim(),
      message: fields[8]?.trim(),
      richAssetType: fields[9]?.trim(),
      richAssetContent: fields[10]?.trim(),
      answerRequired: fields[11]?.trim(),
      command: fields[13]?.trim(),
      whatNext: fields[19]?.trim(),
    });
  }
  
  return nodes.sort((a, b) => a.nodeNumber - b.nodeNumber);
}

// Helper: Parse CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Helper: Create React Flow nodes and edges from parsed nodes
function createFlowElements(parsedNodes: ParsedNode[]): { flowNodes: Node[]; flowEdges: Edge[] } {
  const nodeMap = new Map(parsedNodes.map(n => [n.nodeNumber, n]));
  
  // Calculate layout - organize nodes in a grid with connections
  const flowNodes: Node[] = [];
  const flowEdges: Edge[] = [];
  
  // Group nodes
  const systemNodes = parsedNodes.filter(n => n.nodeNumber < 0 || n.nodeNumber >= 600);
  const startupNodes = parsedNodes.filter(n => n.nodeNumber >= 1 && n.nodeNumber <= 110);
  const mainNodes = parsedNodes.filter(n => n.nodeNumber > 110 && n.nodeNumber < 600);
  
  let yOffset = 0;
  const xGap = 300;
  const yGap = 150;
  
  // Layout startup nodes in a row
  startupNodes.forEach((node, idx) => {
    const nodeType = node.nodeNumber < 0 || node.nodeNumber >= 600 
      ? 'system' 
      : node.nodeType === 'A' ? 'action' : 'decision';
    
    flowNodes.push({
      id: String(node.nodeNumber),
      type: nodeType,
      position: { x: idx * xGap, y: yOffset },
      data: node as unknown as Record<string, unknown>,
    });
  });
  
  yOffset += yGap * 2;
  
  // Layout main nodes in rows of 4
  mainNodes.forEach((node, idx) => {
    const row = Math.floor(idx / 4);
    const col = idx % 4;
    
    flowNodes.push({
      id: String(node.nodeNumber),
      type: node.nodeType === 'A' ? 'action' : 'decision',
      position: { x: col * xGap, y: yOffset + row * yGap },
      data: node as unknown as Record<string, unknown>,
    });
  });
  
  yOffset += Math.ceil(mainNodes.length / 4) * yGap + yGap;
  
  // Layout system nodes in a row at the bottom
  systemNodes.forEach((node, idx) => {
    flowNodes.push({
      id: String(node.nodeNumber),
      type: 'system',
      position: { x: idx * xGap, y: yOffset },
      data: node as unknown as Record<string, unknown>,
    });
  });
  
  // Create edges from Next Nodes and What Next
  parsedNodes.forEach(node => {
    // Parse Next Nodes (for Decision nodes)
    if (node.nextNodes) {
      const nextNodeNums = node.nextNodes.split('|').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      nextNodeNums.forEach((targetNum, idx) => {
        if (nodeMap.has(targetNum)) {
          flowEdges.push({
            id: `e${node.nodeNumber}-${targetNum}-${idx}`,
            source: String(node.nodeNumber),
            target: String(targetNum),
            type: 'smoothstep',
            animated: false,
            style: { stroke: '#6366f1', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
          });
        }
      });
    }
    
    // Parse What Next (for Action nodes)
    if (node.whatNext) {
      // Format: value~node|value~node
      const routes = node.whatNext.split('|');
      routes.forEach((route, idx) => {
        const parts = route.split('~');
        if (parts.length >= 2) {
          const targetNum = parseInt(parts[1].trim());
          if (!isNaN(targetNum) && nodeMap.has(targetNum)) {
            flowEdges.push({
              id: `e${node.nodeNumber}-${targetNum}-wn-${idx}`,
              source: String(node.nodeNumber),
              target: String(targetNum),
              type: 'smoothstep',
              animated: false,
              label: parts[0].trim(),
              labelStyle: { fill: '#a5b4fc', fontSize: 10 },
              labelBgStyle: { fill: '#1a1a1f', fillOpacity: 0.9 },
              style: { stroke: '#10b981', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
            });
          }
        }
      });
    }
  });
  
  return { flowNodes, flowEdges };
}
