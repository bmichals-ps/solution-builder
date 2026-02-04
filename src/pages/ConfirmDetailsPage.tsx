import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { ArrowLeft, Check, Loader2, Building2, Palette, Type, Globe, Sparkles, Image, Pencil, X } from 'lucide-react';
import type { SavedSolution } from '../types';

// Module-level flag to prevent duplicate API calls across component instances
// This handles React StrictMode double-mounting and dual render paths
let purposeGenerationInProgress = false;
let lastPurposeCompany: string | null = null;

/**
 * ConfirmDetailsPage - DEBUG MODE confirmation step
 * 
 * Shows extracted project details and brand info before generation.
 * Allows user to verify AI extraction is working correctly.
 * 
 * Toggle with VITE_DEBUG_MODE=true in .env
 */
export function ConfirmDetailsPage() {
  const navigate = useNavigate();
  const { 
    extractedDetails, 
    projectConfig,
    setInstantStep,
    setStep,
    setExtractedDetails,
    addSavedSolution,
    setActiveSolution,
    activeSolutionId
  } = useStore();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isGeneratingPurpose, setIsGeneratingPurpose] = useState(false);
  const [generatedPurpose, setGeneratedPurpose] = useState<string | null>(null);
  const hasStartedGeneration = useRef(false);
  
  // Editable field states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  
  // Generate AI purpose on mount - with deduplication
  useEffect(() => {
    const generatePurpose = async () => {
      const company = extractedDetails?.targetCompany;
      
      // Skip if no details, already have purpose, or already generating for this company
      if (!extractedDetails || generatedPurpose) return;
      if (hasStartedGeneration.current) return;
      if (purposeGenerationInProgress && lastPurposeCompany === company) return;
      
      // Mark as in progress (module-level prevents duplicate across instances)
      hasStartedGeneration.current = true;
      purposeGenerationInProgress = true;
      lastPurposeCompany = company || null;
      
      setIsGeneratingPurpose(true);
      try {
        const response = await fetch('/api/generate-purpose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName: extractedDetails.targetCompany,
            botType: extractedDetails.projectType,
            additionalDetails: extractedDetails.description,
            projectType: extractedDetails.projectType
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          setGeneratedPurpose(data.purpose);
          // Update the extracted details with the AI-generated purpose
          setExtractedDetails({
            ...extractedDetails,
            botPurpose: data.purpose,
            description: data.purpose
          });
        }
      } catch (error) {
        console.error('[ConfirmPage] Failed to generate purpose:', error);
      } finally {
        setIsGeneratingPurpose(false);
        purposeGenerationInProgress = false;
      }
    };
    
    generatePurpose();
  }, [extractedDetails?.targetCompany]);
  
  // Handle starting edit
  const handleStartEdit = useCallback((field: string, currentValue: string) => {
    setEditingField(field);
    setEditValues(prev => ({ ...prev, [field]: currentValue }));
  }, []);
  
  // Handle saving edit
  const handleSaveEdit = useCallback((field: string) => {
    if (!extractedDetails) return;
    
    const newValue = editValues[field];
    if (newValue !== undefined) {
      const updatedDetails = { ...extractedDetails };
      
      switch (field) {
        case 'clientName':
          updatedDetails.clientName = newValue;
          break;
        case 'projectName':
          updatedDetails.projectName = newValue;
          break;
        case 'targetCompany':
          updatedDetails.targetCompany = newValue;
          break;
        case 'botPurpose':
          updatedDetails.botPurpose = newValue;
          updatedDetails.description = newValue;
          break;
      }
      
      setExtractedDetails(updatedDetails);
    }
    setEditingField(null);
  }, [extractedDetails, editValues, setExtractedDetails]);
  
  // Handle cancel edit
  const handleCancelEdit = useCallback(() => {
    setEditingField(null);
  }, []);
  
  const brandAssets = projectConfig.brandAssets;
  
  // Debug logging to trace brand data source
  console.log('[ConfirmPage] Brand check:', {
    'projectConfig.brandAssets?.name': projectConfig.brandAssets?.name,
    'projectConfig.targetCompany': projectConfig.targetCompany,
    'extractedDetails?.targetCompany': extractedDetails?.targetCompany,
  });
  
  const handleBack = () => {
    setInstantStep('create');
    setStep('welcome');
    navigate('/');
  };
  
  const handleConfirm = async () => {
    setIsConfirming(true);
    
    // ALWAYS create a new solution when confirming from the welcome page
    // This prevents reusing stale solution IDs from previously viewed projects
    let solutionId: string | null = null;
    
    if (extractedDetails) {
      try {
        // Build description that includes company context
        const descriptionWithContext = extractedDetails.targetCompany 
          ? `${extractedDetails.description || extractedDetails.botPurpose || ''}\n\nCompany: ${extractedDetails.targetCompany}`
          : extractedDetails.description || extractedDetails.botPurpose || '';
        
        // IMPORTANT: Save architectureState with brandAssets to prevent stale data pollution
        // Without this, SolutionArchitecturePage falls back to old projectConfig from localStorage
        const newSolution: Omit<SavedSolution, 'id' | 'createdAt' | 'updatedAt'> = {
          name: extractedDetails.projectName || 'Untitled Bot',
          description: descriptionWithContext,
          clientName: extractedDetails.clientName || 'CX',
          projectType: extractedDetails.projectType || 'support',
          status: 'draft',
          nodeCount: 0,
          // Save initial architecture state with brand to prevent fallback to old data
          architectureState: {
            plannedFlows: [],
            menuOptions: [],
            nodePositions: {},
            flowPreviews: {},
            hasGenerated: false,
            extractedDetails: extractedDetails,
            brandAssets: brandAssets || undefined,
            targetCompany: extractedDetails.targetCompany || projectConfig.targetCompany,
          },
        };
        
        const created = await addSavedSolution(newSolution);
        if (created?.id) {
          solutionId = created.id;
          setActiveSolution(created.id);
          console.log('[ConfirmPage] Saved new solution to dashboard:', created.id);
        }
      } catch (error) {
        console.error('[ConfirmPage] Failed to save solution:', error);
        // Continue anyway - don't block generation
      }
    }
    
    // Navigate to solution URL with ID in the slug
    if (solutionId) {
      navigate(`/solutions/${solutionId}`);
    } else {
      // Fallback to old behavior if no solution ID
      setInstantStep('architecture');
    }
  };
  
  if (!extractedDetails) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-[#6a6a75]">No details extracted. Please go back and describe your bot.</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 text-sm text-[#a5b4fc] hover:text-white"
          >
            ← Go Back
          </button>
        </div>
      </div>
    );
  }
  
  // Get colors - ensure we get distinct colors
  const allColors = brandAssets?.colors || [];
  const primaryColor = brandAssets?.primaryColor || 
    allColors.find(c => c.usage === 'primary')?.hex || 
    allColors[0]?.hex;
  
  // Get secondary color - must be different from primary
  let secondaryColor = brandAssets?.secondaryColor || 
    allColors.find(c => c.usage === 'secondary')?.hex;
  
  // If secondary is same as primary, try to find a different color
  if (secondaryColor === primaryColor || !secondaryColor) {
    const differentColor = allColors.find(c => c.hex !== primaryColor);
    secondaryColor = differentColor?.hex;
  }
  
  // Logo selection: use the best available logo URL
  const logoUrl = brandAssets?.logoUrl || 
    brandAssets?.logos?.find((l: any) => l.url)?.url || '';
  
  // Logo background: ALWAYS use the primary brand color.
  // Brand logos are designed to be visible against their own brand colors.
  // White bg fails for light logos (Lyft), dark bg fails for dark logos.
  // Primary color is the one thing guaranteed to contrast with the brand's own logo.
  const logoBgColor = primaryColor || '#6366f1';
  
  // Debug: log what we're working with
  console.log('[ConfirmPage] Logo:', { 
    logoUrl: logoUrl?.substring(0, 80), 
    logoBgColor, 
    primaryColor,
    brandPrimaryColor: brandAssets?.primaryColor,
    firstColorHex: allColors[0]?.hex,
    allColorHexes: allColors.map(c => c.hex),
    logoCount: brandAssets?.logos?.length, 
    backgrounds: brandAssets?.logos?.map((l: any) => l.background) 
  });
  
  // Get brand moment / header image
  const brandImageUrl = brandAssets?.brandMomentUrl || 
    brandAssets?.images?.find(img => img.type === 'banner' || img.type === 'cover')?.url ||
    brandAssets?.images?.[0]?.url;
  
  const fontName = brandAssets?.fonts?.[0]?.name;
  const domain = brandAssets?.domain;
  
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Header */}
      <div className="text-center py-6 px-4 shrink-0">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-medium mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          DEBUG MODE
        </div>
        <h1 className="text-2xl font-semibold text-white">Confirm Extracted Details</h1>
      </div>
      
      {/* Content - two column layout */}
      <div className="flex-1 px-6 pb-6 overflow-hidden">
        <div className="h-full max-w-5xl mx-auto grid grid-cols-2 gap-6">
          {/* Left: Extracted Details Card */}
          <div className="bg-[#1a1a1f] border border-white/10 rounded-2xl p-6 flex flex-col">
            <h2 className="text-xs font-medium text-[#8585a3] uppercase tracking-wider mb-6">
              Extracted from Description
            </h2>
            
            <div className="flex-1 flex flex-col justify-center space-y-5">
              <EditableDetailRow 
                label="Client" 
                value={extractedDetails.clientName}
                field="clientName"
                isEditing={editingField === 'clientName'}
                editValue={editValues['clientName'] || ''}
                onStartEdit={handleStartEdit}
                onSave={handleSaveEdit}
                onCancel={handleCancelEdit}
                onChange={(val) => setEditValues(prev => ({ ...prev, clientName: val }))}
              />
              <EditableDetailRow 
                label="Project" 
                value={extractedDetails.projectName}
                field="projectName"
                isEditing={editingField === 'projectName'}
                editValue={editValues['projectName'] || ''}
                onStartEdit={handleStartEdit}
                onSave={handleSaveEdit}
                onCancel={handleCancelEdit}
                onChange={(val) => setEditValues(prev => ({ ...prev, projectName: val }))}
              />
              <DetailRow 
                label="Type" 
                value={extractedDetails.projectType.charAt(0).toUpperCase() + extractedDetails.projectType.slice(1)} 
              />
              <EditableDetailRow 
                label="Company" 
                value={extractedDetails.targetCompany || 'Not detected'}
                field="targetCompany"
                isEditing={editingField === 'targetCompany'}
                editValue={editValues['targetCompany'] || ''}
                onStartEdit={handleStartEdit}
                onSave={handleSaveEdit}
                onCancel={handleCancelEdit}
                onChange={(val) => setEditValues(prev => ({ ...prev, targetCompany: val }))}
              />
              
              {/* Bot Purpose - Editable */}
              <div className="group relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-[#6a6a75]">Purpose</span>
                  {!editingField && !isGeneratingPurpose && (
                    <button
                      onClick={() => handleStartEdit('botPurpose', extractedDetails.botPurpose)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/5 text-[#6a6a75] hover:text-white transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                
                {isGeneratingPurpose ? (
                  <div className="flex items-center gap-2 text-sm text-[#6a6a75]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#6366f1]" />
                    <span>Generating description...</span>
                  </div>
                ) : editingField === 'botPurpose' ? (
                  <div className="space-y-2">
                    <textarea
                      value={editValues['botPurpose'] || ''}
                      onChange={(e) => setEditValues(prev => ({ ...prev, botPurpose: e.target.value }))}
                      className="w-full bg-[#0a0a0f] border border-[#6366f1]/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366f1]/30 min-h-[80px] resize-none"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1 text-xs text-[#6a6a75] hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveEdit('botPurpose')}
                        className="px-3 py-1 text-xs bg-[#6366f1] text-white rounded hover:bg-[#7c7ff2] transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-white leading-relaxed">{extractedDetails.botPurpose}</p>
                )}
              </div>
              
              {extractedDetails.keyFeatures.length > 0 && (
                <div>
                  <span className="text-sm text-[#6a6a75]">Key Features</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {extractedDetails.keyFeatures.map((feature, i) => (
                      <span 
                        key={i}
                        className="px-3 py-1.5 text-sm bg-[#6366f1]/10 text-[#a5b4fc] rounded-full"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Right: Brand Information Card */}
          <div className="bg-[#1a1a1f] border border-white/10 rounded-2xl p-6 flex flex-col">
            <h2 className="text-xs font-medium text-[#8585a3] uppercase tracking-wider mb-6">
              Brand Information {brandAssets ? '(Brandfetch)' : '(Not detected)'}
            </h2>
            
            {brandAssets ? (
              <div className="flex-1 flex flex-col justify-center space-y-5">
                {/* Brand Header Image */}
                {brandImageUrl && (
                  <div className="relative rounded-xl overflow-hidden bg-white/5 h-28">
                    <img 
                      src={brandImageUrl} 
                      alt="Brand" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                
                {/* Logo and Name */}
                <div className="flex items-center gap-4">
                  {logoUrl ? (
                    <div 
                      className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center overflow-hidden"
                      style={{ backgroundColor: logoBgColor }}
                    >
                      <img 
                        src={logoUrl} 
                        alt={brandAssets.name || 'Logo'}
                        className="w-full h-full"
                        style={{ objectFit: 'contain' }}
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = `<span style="color: white; font-size: 24px; font-weight: 700;">${(brandAssets.name || 'B')[0].toUpperCase()}</span>`;
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                      <Building2 className="w-8 h-8 text-[#6a6a75]" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-white font-medium text-lg">{brandAssets.name || extractedDetails.targetCompany}</p>
                    {domain && (
                      <p className="text-sm text-[#6a6a75] flex items-center gap-1.5 mt-0.5">
                        <Globe className="w-4 h-4 shrink-0" />
                        <span className="truncate">{domain}</span>
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Colors */}
                <div className="flex items-center gap-6">
                  {primaryColor && (
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-lg border border-white/10 shadow-sm"
                        style={{ backgroundColor: primaryColor }}
                      />
                      <div>
                        <p className="text-xs text-[#6a6a75]">Primary</p>
                        <p className="text-sm text-white font-mono">{primaryColor}</p>
                      </div>
                    </div>
                  )}
                  {secondaryColor ? (
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-lg border border-white/10 shadow-sm"
                        style={{ backgroundColor: secondaryColor }}
                      />
                      <div>
                        <p className="text-xs text-[#6a6a75]">Secondary</p>
                        <p className="text-sm text-white font-mono">{secondaryColor}</p>
                      </div>
                    </div>
                  ) : primaryColor && (
                    <span className="text-sm text-[#6a6a75] italic">Single color brand</span>
                  )}
                </div>
                
                {/* All colors palette */}
                {allColors.length > 2 && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[#6a6a75]">All colors:</span>
                    <div className="flex gap-1.5">
                      {allColors.map((color, i) => (
                        <div 
                          key={i}
                          className="w-7 h-7 rounded-md border border-white/10"
                          style={{ backgroundColor: color.hex }}
                          title={`${color.name || color.usage || 'Color'}: ${color.hex}`}
                        />
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Font */}
                {fontName && (
                  <div className="flex items-center gap-2 text-sm">
                    <Type className="w-4 h-4 text-[#6a6a75]" />
                    <span className="text-[#6a6a75]">Font:</span>
                    <span className="text-white">{fontName}</span>
                  </div>
                )}
                
                {/* No brand image indicator */}
                {!brandImageUrl && (
                  <div className="flex items-center gap-2 text-sm text-[#4a4a55]">
                    <Image className="w-4 h-4" />
                    <span className="italic">No brand header image available</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center">
                <Palette className="w-12 h-12 text-[#4a4a55] mb-3" />
                <p className="text-sm text-[#6a6a75]">No brand detected</p>
                <p className="text-xs text-[#4a4a55] mt-1">Default styling will be used</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Action Buttons */}
      <div className="shrink-0 px-6 py-4 border-t border-white/5 bg-[#0a0a0f]">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 px-5 py-2.5 text-sm text-[#8585a3] hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isConfirming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Looks Good, Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ 
  label, 
  value
}: { 
  label: string; 
  value: string; 
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-[#6a6a75] shrink-0">{label}</span>
      <span className="text-sm text-white text-right">{value}</span>
    </div>
  );
}

function EditableDetailRow({ 
  label, 
  value,
  field,
  isEditing,
  editValue,
  onStartEdit,
  onSave,
  onCancel,
  onChange
}: { 
  label: string; 
  value: string;
  field: string;
  isEditing: boolean;
  editValue: string;
  onStartEdit: (field: string, value: string) => void;
  onSave: (field: string) => void;
  onCancel: () => void;
  onChange: (value: string) => void;
}) {
  if (isEditing) {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-[#6a6a75] shrink-0">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
            className="bg-[#0a0a0f] border border-[#6366f1]/50 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366f1]/30 text-right min-w-[150px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(field);
              if (e.key === 'Escape') onCancel();
            }}
          />
          <button
            onClick={() => onSave(field)}
            className="p-1 text-[#22c55e] hover:bg-white/5 rounded transition-colors"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={onCancel}
            className="p-1 text-[#6a6a75] hover:text-white hover:bg-white/5 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="group flex items-center justify-between gap-4">
      <span className="text-sm text-[#6a6a75] shrink-0">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-white text-right">{value}</span>
        <button
          onClick={() => onStartEdit(field, value)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/5 text-[#6a6a75] hover:text-white transition-all"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
