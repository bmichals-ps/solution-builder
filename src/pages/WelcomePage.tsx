import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { HeroChat } from '../components/ui/hero-chat';
import { ImportModal } from '../components/ui/import-modal';
import { Loader2, FileSearch, Sparkles } from 'lucide-react';
import { analyzeFigmaFile } from '../services/figma-analyzer';
import { extractProjectDetails, fetchBrandAssets } from '../services/instant-build';
import type { ExtractedDetails } from '../types';

// Check if debug mode is enabled
const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'true';

// Analysis overlay component with animated steps
function AnalysisOverlay({ source, fileName }: { source: string; fileName: string }) {
  const [currentStep, setCurrentStep] = useState(0);
  
  const steps = [
    'Extracting file metadata',
    'Identifying flow structure', 
    'Detecting project type',
    'Extracting requirements',
    'Preparing project setup',
  ];
  
  // Animate through steps
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep(prev => {
        if (prev < steps.length - 1) return prev + 1;
        return prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [steps.length]);
  
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#1a1a1f] border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 text-center animate-scale-in">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/10 flex items-center justify-center mx-auto mb-6">
          <FileSearch className="w-8 h-8 text-[#a5b4fc] animate-pulse" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          Analyzing {source === 'figma' ? 'Figma Design' : 'Spreadsheet'}
        </h3>
        <p className="text-sm text-[#6a6a75] mb-6">
          Extracting project details from <span className="text-white font-medium">{fileName}</span>
        </p>
        <div className="mt-6 space-y-2.5 text-left max-w-xs mx-auto">
          {steps.map((step, index) => (
            <AnalysisStep 
              key={step}
              label={step} 
              done={index < currentStep}
              active={index === currentStep}
              pending={index > currentStep}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function AnalysisStep({ label, done, active, pending }: { label: string; done?: boolean; active?: boolean; pending?: boolean }) {
  return (
    <div className={`flex items-center gap-3 text-sm transition-all duration-300 ${
      done ? 'text-[#22c55e]' : 
      active ? 'text-[#a5b4fc]' : 
      'text-[#4a4a55]'
    }`}>
      <div className="w-5 h-5 flex items-center justify-center">
        {done ? (
          <Sparkles className="w-4 h-4" />
        ) : active ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-current opacity-40" />
        )}
      </div>
      <span className={done || active ? 'font-medium' : ''}>{label}</span>
    </div>
  );
}

export function WelcomePage() {
  const { 
    setProjectConfig, 
    nextStep, 
    setLoading, 
    credentials,
    setExtractedDetails,
    setInstantStep 
  } = useStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [importSource, setImportSource] = useState<'figma' | 'sheets' | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingFile, setAnalyzingFile] = useState<{ source: string; name: string } | null>(null);

  const handleSend = async (message: string) => {
    if (!message.trim()) return;
    
    setIsProcessing(true);
    setLoading(true);

    try {
      // Extract project details using AI
      console.log('[Welcome] Extracting project details...');
      const extracted = await extractProjectDetails(message.trim());
      
      // Fetch brand assets for the target company
      let brandAssets = null;
      if (extracted.targetCompany) {
        console.log('[Welcome] Fetching brand assets for:', extracted.targetCompany);
        brandAssets = await fetchBrandAssets(extracted.targetCompany);
        if (brandAssets) {
          console.log('[Welcome] Brand detected:', brandAssets.name);
        }
      }
      
      // Store extracted details in state
      setExtractedDetails(extracted);
      
      // Update project config with extracted details and brand
      setProjectConfig({
        clientName: extracted.clientName,
        projectName: extracted.projectName,
        projectType: extracted.projectType,
        description: extracted.description,
        targetCompany: extracted.targetCompany,
        brandAssets: brandAssets || undefined,
        referenceFiles: [],
      });
      
      setIsProcessing(false);
      setLoading(false);
      
      // Navigate based on debug mode
      if (DEBUG_MODE) {
        console.log('[Welcome] DEBUG_MODE enabled - showing confirm page');
        setInstantStep('confirm');
      } else {
        console.log('[Welcome] Instant mode - going straight to processing');
        setInstantStep('processing');
      }
      
    } catch (error) {
      console.error('Error in instant flow:', error);
      // Fall back to basic extraction
      const extracted = extractProjectDetailsBasic(message);
      setExtractedDetails(extracted);
      setProjectConfig({
        clientName: extracted.clientName,
        projectName: extracted.projectName,
        projectType: extracted.projectType,
        description: extracted.description,
        referenceFiles: [],
      });
      
      setIsProcessing(false);
      setLoading(false);
      
      if (DEBUG_MODE) {
        setInstantStep('confirm');
      } else {
        setInstantStep('processing');
      }
    }
  };
  
  // Basic extraction fallback (inline)
  const extractProjectDetailsBasic = (text: string): ExtractedDetails => {
    const lowerText = text.toLowerCase();
    let projectType: ExtractedDetails['projectType'] = 'custom';
    if (lowerText.includes('claim') || lowerText.includes('fnol')) projectType = 'claims';
    else if (lowerText.includes('support')) projectType = 'support';
    else if (lowerText.includes('sales')) projectType = 'sales';
    
    return {
      clientName: 'CX',
      projectName: 'ChatbotMVP',
      projectType,
      botPurpose: text.trim(),
      keyFeatures: [],
      targetCompany: '',
      description: text.trim(),
    };
  };

  const handleImport = (source: string) => {
    if (source === 'figma' || source === 'sheets') {
      setImportSource(source);
    }
  };
  
  const handleImportComplete = async (data: { source: string; file: { id: string; name: string; type: string } }) => {
    // Close the import modal
    setImportSource(null);
    
    // Show analysis overlay
    setIsAnalyzing(true);
    setAnalyzingFile({ source: data.source, name: data.file.name });
    setLoading(true);
    
    console.log('Analyzing imported file:', data);
    
    try {
      // Analyze the imported content
      const analysis = await analyzeImportedContent(data);
      
      // Pre-fill the project config with extracted details
      setProjectConfig({
        clientName: analysis.clientName || '',
        projectName: analysis.projectName || '',
        projectType: analysis.projectType || 'custom',
        description: analysis.description || '',
        importedRequirements: analysis.importedRequirements,
      });
      
      // Navigate to next step
      nextStep();
    } catch (error) {
      console.error('Analysis failed:', error);
      // Fall back to basic extraction
      const fileName = data.file.name;
      setProjectConfig({
        clientName: '',
        projectName: fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
        projectType: 'custom',
        description: `Imported from ${data.source === 'figma' ? 'Figma' : 'Google Sheets'}: ${fileName}`,
      });
      nextStep();
    } finally {
      setIsAnalyzing(false);
      setAnalyzingFile(null);
      setLoading(false);
    }
  };
  
  // Analyze imported content from Figma or Sheets
  const analyzeImportedContent = async (data: { source: string; file: { id: string; name: string; type: string } }) => {
    const fileName = data.file.name;
    const fileKey = data.file.id; // For Figma, this is the file key
    
    if (data.source === 'figma') {
      // Use the Figma analyzer service (which calls Supabase Edge Function)
      console.log('Analyzing Figma file:', fileKey, fileName);
      const figmaToken = credentials.figmaToken;
      const analysis = await analyzeFigmaFile(fileKey, fileName, figmaToken);
      
      return {
        clientName: analysis.clientName,
        projectName: analysis.projectName,
        projectType: analysis.projectType,
        description: analysis.description,
        importedRequirements: {
          sections: analysis.sections,
          dataFields: analysis.dataFields,
          decisionPoints: analysis.decisionPoints,
          userJourneys: analysis.userJourneys,
          escalationTriggers: analysis.escalationTriggers,
          dataCollection: analysis.dataFields?.join(', '),
        },
      };
    } else {
      // For Google Sheets, parse the spreadsheet content
      const nameAnalysis = analyzeFileName(fileName);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return {
        clientName: nameAnalysis.clientName,
        projectName: nameAnalysis.projectName,
        projectType: 'custom' as const,
        description: `Bot configuration imported from Google Sheets: ${fileName}\n\nReview the imported nodes and update any fields as needed.`,
      };
    }
  };
  
  // Analyze file name to extract client and project names
  const analyzeFileName = (fileName: string) => {
    // Remove file extension and clean up
    const cleanName = fileName.replace(/\.[^/.]+$/, '').trim();
    
    // Common patterns in file names
    // "ClientName - ProjectName" or "ClientName_ProjectName" or "FNOL - Website (1)"
    const patterns = [
      /^(.+?)\s*[-–—]\s*(.+?)(?:\s*\(\d+\))?$/,  // "Client - Project"
      /^(.+?)_(.+?)$/,                            // "Client_Project"
      /^(.+?)\s+(.+?)$/,                          // "Client Project" (space separated)
    ];
    
    for (const pattern of patterns) {
      const match = cleanName.match(pattern);
      if (match) {
        return {
          clientName: toPascalCase(match[1]),
          projectName: toPascalCase(match[2]),
        };
      }
    }
    
    // If no pattern matches, use the whole name as project name
    return {
      clientName: '',
      projectName: toPascalCase(cleanName),
    };
  };
  
  // Convert string to PascalCase
  const toPascalCase = (str: string) => {
    return str
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  };

  return (
    <>
      <HeroChat
        title="What will you"
        highlightedWord="design"
        subtitle="Describe your bot in plain language. AI will extract the details."
        isProcessing={isProcessing}
        onSend={handleSend}
        onImport={handleImport}
      />
      
      <ImportModal
        isOpen={importSource !== null}
        onClose={() => setImportSource(null)}
        source={importSource}
        onImport={handleImportComplete}
      />
      
      {isAnalyzing && analyzingFile && (
        <AnalysisOverlay source={analyzingFile.source} fileName={analyzingFile.name} />
      )}
    </>
  );
}
