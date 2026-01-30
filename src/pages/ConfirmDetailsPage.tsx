import { useState } from 'react';
import { useStore } from '../store/useStore';
import { ArrowLeft, Check, Loader2, Building2, Palette, Type, Globe, Sparkles, Image } from 'lucide-react';

/**
 * ConfirmDetailsPage - DEBUG MODE confirmation step
 * 
 * Shows extracted project details and brand info before generation.
 * Allows user to verify AI extraction is working correctly.
 * 
 * Toggle with VITE_DEBUG_MODE=true in .env
 */
export function ConfirmDetailsPage() {
  const { 
    extractedDetails, 
    projectConfig,
    setInstantStep,
    setStep
  } = useStore();
  const [isConfirming, setIsConfirming] = useState(false);
  
  const brandAssets = projectConfig.brandAssets;
  
  const handleBack = () => {
    setInstantStep('create');
    setStep('welcome');
  };
  
  const handleConfirm = () => {
    setIsConfirming(true);
    setInstantStep('processing');
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
              <DetailRow label="Client" value={extractedDetails.clientName} />
              <DetailRow label="Project" value={extractedDetails.projectName} />
              <DetailRow 
                label="Type" 
                value={extractedDetails.projectType.charAt(0).toUpperCase() + extractedDetails.projectType.slice(1)} 
              />
              <DetailRow label="Company" value={extractedDetails.targetCompany || 'Not detected'} />
              
              {/* Bot Purpose */}
              <div>
                <span className="text-sm text-[#6a6a75]">Purpose</span>
                <p className="text-sm text-white mt-1.5 leading-relaxed">{extractedDetails.botPurpose}</p>
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
