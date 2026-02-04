import { createPortal } from 'react-dom';
import { 
  CheckCircle2, 
  ExternalLink, 
  FileSpreadsheet, 
  Rocket, 
  PenSquare, 
  X,
  Copy,
  Check,
  Key,
  RefreshCw,
  Loader2,
  Wrench
} from 'lucide-react';
import { useState } from 'react';
import type { InstantBuildResult, ProjectConfig, ExtractedDetails } from '../types';

interface ResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: InstantBuildResult | null;
  projectConfig: ProjectConfig;
  extractedDetails: ExtractedDetails | null;
  onEditFlow?: () => void;
  onCreateWidget?: () => void;
  onFixAndDeploy?: () => Promise<void>;
  isFixing?: boolean;
  onExportToSheets?: () => Promise<void>;
  isExporting?: boolean;
}

export function ResultsModal({ 
  isOpen, 
  onClose, 
  result,
  projectConfig,
  extractedDetails,
  onEditFlow,
  onCreateWidget,
  onFixAndDeploy,
  isFixing = false,
  onExportToSheets,
  isExporting = false
}: ResultsModalProps) {
  const [copiedWidget, setCopiedWidget] = useState(false);
  const [copiedSheets, setCopiedSheets] = useState(false);
  
  if (!isOpen || !result) return null;
  
  // Show fix button when deployment failed but CSV was generated
  const needsFixAndDeploy = !result.success && result.nodeCount > 0 && result.csv;
  
  const projectName = extractedDetails?.projectName || 'Solution';
  const targetCompany = extractedDetails?.targetCompany || projectConfig.targetCompany;
  const brandColor = projectConfig.brandAssets?.primaryColor || '#6366f1';
  
  const handleViewWidget = () => {
    if (result.widgetUrl) {
      window.open(result.widgetUrl, '_blank');
    }
  };
  
  const handleViewSheets = () => {
    if (result.sheetsUrl) {
      window.open(result.sheetsUrl, '_blank');
    }
  };
  
  const copyToClipboard = async (text: string, type: 'widget' | 'sheets') => {
    await navigator.clipboard.writeText(text);
    if (type === 'widget') {
      setCopiedWidget(true);
      setTimeout(() => setCopiedWidget(false), 2000);
    } else {
      setCopiedSheets(true);
      setTimeout(() => setCopiedSheets(false), 2000);
    }
  };
  
  return createPortal(
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
        <div 
          className="bg-[#0f0f14] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/5 text-[#6a6a75] hover:text-white transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="p-8">
            {/* Success Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-full bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-[#22c55e]" />
              </div>
              
              <h2 className="text-xl font-semibold text-white mb-2">
                Your solution is ready!
              </h2>
              
              <div className="flex items-center justify-center gap-2 text-[#8585a3]">
                {targetCompany && (
                  <>
                    <span>{targetCompany}</span>
                    <span className="text-[#4a4a55]">•</span>
                  </>
                )}
                <span>{projectName}</span>
              </div>
              
              <p className="text-sm text-[#6a6a75] mt-2">
                {result.nodeCount} nodes {result.success ? '• Deployed to sandbox' : '• Deployment pending'}
              </p>
              {result.error && (
                <p className="text-xs text-amber-400/80 mt-1 max-w-md mx-auto">
                  {result.error}
                </p>
              )}
            </div>
            
            {/* Fix & Deploy Button - shown when deployment failed but CSV exists */}
            {needsFixAndDeploy && onFixAndDeploy && (
              <div className="mb-6">
                <button
                  onClick={() => onFixAndDeploy()}
                  disabled={isFixing}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:from-amber-500/50 disabled:to-orange-500/50 text-white font-medium rounded-xl transition-all shadow-lg shadow-amber-500/20"
                >
                  {isFixing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Fixing errors and deploying...
                    </>
                  ) : (
                    <>
                      <Wrench className="w-5 h-5" />
                      Fix Errors & Deploy
                    </>
                  )}
                </button>
                <p className="text-xs text-[#6a6a75] text-center mt-2">
                  AI will attempt to fix validation errors and deploy to sandbox
                </p>
              </div>
            )}
            
            {/* Action Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* View in Google Sheets */}
              <div
                onClick={result.sheetsUrl ? handleViewSheets : (onExportToSheets && !isExporting ? onExportToSheets : undefined)}
                role="button"
                tabIndex={result.sheetsUrl || onExportToSheets ? 0 : -1}
                className={`group relative bg-[#1a1a1f] border rounded-xl p-5 text-left transition-all ${
                  result.sheetsUrl 
                    ? 'border-white/10 hover:border-[#22c55e]/50 cursor-pointer' 
                    : onExportToSheets && !isExporting
                      ? 'border-[#22c55e]/30 hover:border-[#22c55e]/50 cursor-pointer'
                      : 'border-white/5 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-[#22c55e]/10 flex items-center justify-center mb-3">
                  {isExporting ? (
                    <Loader2 className="w-5 h-5 text-[#22c55e] animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-5 h-5 text-[#22c55e]" />
                  )}
                </div>
                <h3 className="text-white font-medium text-sm mb-1">
                  {isExporting ? 'Exporting...' : result.sheetsUrl ? 'View in Sheets' : 'Export to Sheets'}
                </h3>
                <p className="text-xs text-[#6a6a75]">
                  {isExporting ? 'Creating spreadsheet' : result.sheetsUrl ? 'Open spreadsheet' : 'Create Google Sheet'}
                </p>
                {result.sheetsUrl && (
                  <>
                    <ExternalLink className="absolute top-3 right-3 w-3.5 h-3.5 text-[#4a4a55] group-hover:text-[#6a6a75]" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(result.sheetsUrl!, 'sheets');
                      }}
                      className="absolute bottom-3 right-3 p-1 rounded hover:bg-white/5"
                      title="Copy link"
                    >
                      {copiedSheets ? (
                        <Check className="w-3 h-3 text-[#22c55e]" />
                      ) : (
                        <Copy className="w-3 h-3 text-[#4a4a55]" />
                      )}
                    </button>
                  </>
                )}
              </div>
              
              {/* View Solution (Widget) */}
              <div
                onClick={result.widgetUrl ? handleViewWidget : onCreateWidget}
                role="button"
                tabIndex={0}
                className={`group relative bg-[#1a1a1f] border rounded-xl p-5 text-left transition-all cursor-pointer ${
                  result.widgetUrl 
                    ? 'border-white/10 hover:border-[#6366f1]/50' 
                    : 'border-amber-500/30 hover:border-amber-500/50'
                }`}
              >
                <div 
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ backgroundColor: result.widgetUrl ? `${brandColor}20` : 'rgba(245, 158, 11, 0.1)' }}
                >
                  {result.widgetUrl ? (
                    <Rocket className="w-5 h-5" style={{ color: brandColor }} />
                  ) : (
                    <Key className="w-5 h-5 text-amber-400" />
                  )}
                </div>
                <h3 className="text-white font-medium text-sm mb-1">
                  {result.widgetUrl ? 'View Solution' : 'Create Widget'}
                </h3>
                <p className="text-xs text-[#6a6a75]">
                  {result.widgetUrl ? 'Open in new tab' : 'API key required'}
                </p>
                {result.widgetUrl && (
                  <>
                    <ExternalLink className="absolute top-3 right-3 w-3.5 h-3.5 text-[#4a4a55] group-hover:text-[#6a6a75]" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(result.widgetUrl!, 'widget');
                      }}
                      className="absolute bottom-3 right-3 p-1 rounded hover:bg-white/5"
                      title="Copy link"
                    >
                      {copiedWidget ? (
                        <Check className="w-3 h-3 text-[#22c55e]" />
                      ) : (
                        <Copy className="w-3 h-3 text-[#4a4a55]" />
                      )}
                    </button>
                  </>
                )}
              </div>
              
              {/* Edit Flow */}
              <div
                onClick={onEditFlow || onClose}
                role="button"
                tabIndex={0}
                className="group relative bg-[#1a1a1f] border border-white/10 rounded-xl p-5 text-left hover:border-[#8b5cf6]/50 transition-all cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-[#8b5cf6]/10 flex items-center justify-center mb-3">
                  <PenSquare className="w-5 h-5 text-[#8b5cf6]" />
                </div>
                <h3 className="text-white font-medium text-sm mb-1">Edit Flow</h3>
                <p className="text-xs text-[#6a6a75]">Open visual editor</p>
                <ExternalLink className="absolute top-3 right-3 w-3.5 h-3.5 text-[#4a4a55] group-hover:text-[#6a6a75]" />
              </div>
            </div>
            
            {/* Bot Info */}
            {result.botId && (
              <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[#6a6a75] mb-1">Bot ID</p>
                    <p className="text-sm text-white font-mono">{result.botId}</p>
                  </div>
                  {result.versionId && (
                    <div className="text-right">
                      <p className="text-xs text-[#6a6a75] mb-1">Version</p>
                      <p className="text-sm text-white">{result.versionId}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Close Button */}
            <div className="flex justify-center">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Continue Editing
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
