import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Card, CardHeader } from '../components/Card';
import { Input, Textarea } from '../components/Input';
import { 
  ArrowRight, 
  ArrowLeft,
  FolderPlus,
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  File,
  Sparkles,
  Pencil,
  Palette,
  Building2,
  Type
} from 'lucide-react';
import { useCallback, useState } from 'react';

const projectTypes = [
  { id: 'claims', label: 'Claims / FNOL', description: 'Insurance claims processing' },
  { id: 'support', label: 'Customer Support', description: 'Help desk & service' },
  { id: 'sales', label: 'Sales / Lead Gen', description: 'Lead qualification' },
  { id: 'faq', label: 'FAQ / Knowledge', description: 'Information delivery' },
  { id: 'survey', label: 'Survey / Feedback', description: 'Data collection' },
  { id: 'custom', label: 'Custom', description: 'Other use case' },
] as const;

export function ProjectSetupPage() {
  const { 
    projectConfig, 
    setProjectConfig, 
    addReferenceFile,
    removeReferenceFile,
    nextStep, 
    prevStep,
    addSavedSolution,
    activeSolutionId,
    setActiveSolution,
    user
  } = useStore();
  
  const [isSaving, setIsSaving] = useState(false);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        addReferenceFile({
          id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          content: reader.result as string,
        });
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, [addReferenceFile]);

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
    if (type.includes('pdf')) return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isValid = projectConfig.clientName.trim() && projectConfig.projectName.trim();
  const hasPrefilledData = projectConfig.description.trim().length > 0;

  return (
    <div className="space-y-6 stagger-children">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-headline text-[#f0f0f5] mb-2">Review project details</h2>
          <p className="text-body text-[#8585a3]">
            {hasPrefilledData 
              ? "We've extracted these details from your description. Edit as needed."
              : "Define your project. This helps the AI generate a tailored solution."
            }
          </p>
        </div>
        {hasPrefilledData && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)]">
            <Sparkles className="w-3 h-3 text-[#a5b4fc]" />
            <span className="text-[11px] text-[#a5b4fc] font-medium">AI Pre-filled</span>
          </div>
        )}
      </div>

      {/* Basic Info */}
      <Card variant="elevated">
        <CardHeader 
          title="Project Information" 
          description="These will form your Bot ID (Client.Project)"
          icon={<FolderPlus className="w-5 h-5" />}
        />
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Client Name"
            placeholder="e.g., TravelersInsurance"
            value={projectConfig.clientName}
            onChange={(e) => setProjectConfig({ clientName: e.target.value })}
            required
            helperText="PascalCase, no spaces"
            icon={projectConfig.clientName && <Pencil className="w-3.5 h-3.5" />}
          />
          
          <Input
            label="Project Name"
            placeholder="e.g., FNOLWebMVP"
            value={projectConfig.projectName}
            onChange={(e) => setProjectConfig({ projectName: e.target.value })}
            required
            helperText="PascalCase, no spaces"
            icon={projectConfig.projectName && <Pencil className="w-3.5 h-3.5" />}
          />
        </div>

        {/* Bot ID Preview */}
        {projectConfig.clientName && projectConfig.projectName && (
          <div className="mt-4 p-3 bg-[rgba(255,255,255,0.02)] rounded-xl border border-[rgba(255,255,255,0.06)]">
            <span className="text-[11px] text-[#5c5c78] uppercase tracking-wide">Bot ID</span>
            <p className="text-[14px] font-mono text-[#a5b4fc] mt-0.5">
              {projectConfig.clientName}.{projectConfig.projectName}
            </p>
          </div>
        )}
      </Card>

      {/* Project Type */}
      <Card>
        <CardHeader 
          title="Project Type" 
          description="Select the type that best describes your bot's purpose"
        />
        
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {projectTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setProjectConfig({ projectType: type.id })}
              className={`
                p-3.5 rounded-xl border text-left transition-all duration-200
                ${projectConfig.projectType === type.id
                  ? 'border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.08)]'
                  : 'border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)]'
                }
              `}
            >
              <h4 className={`text-[14px] font-medium ${projectConfig.projectType === type.id ? 'text-[#a5b4fc]' : 'text-[#e8e8f0]'}`}>
                {type.label}
              </h4>
              <p className="text-[12px] text-[#5c5c78] mt-0.5">{type.description}</p>
            </button>
          ))}
        </div>
      </Card>

      {/* Brand Assets Preview */}
      {projectConfig.brandAssets && (
        <Card className="border-[rgba(99,102,241,0.2)] bg-[rgba(99,102,241,0.02)]">
          <CardHeader 
            title="Brand Detected" 
            description={`Auto-detected from "${projectConfig.targetCompany || 'your description'}"`}
            icon={<Building2 className="w-5 h-5" />}
          />
          
          <div className="flex items-start gap-4">
            {/* Logo Preview - smart background based on logo */}
            {projectConfig.brandAssets.logoUrl && (
              <div 
                className={`w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden border ${
                  projectConfig.brandAssets.logoBackground === 'dark' 
                    ? 'bg-[#1a1a1f] border-[rgba(255,255,255,0.1)]' 
                    : 'bg-[#2a2a35] border-[rgba(255,255,255,0.15)]'
                }`}
              >
                <img 
                  src={projectConfig.brandAssets.logoUrl} 
                  alt={projectConfig.brandAssets.name || 'Brand logo'}
                  className="max-w-[48px] max-h-[48px] object-contain"
                />
              </div>
            )}
            
            <div className="flex-1 space-y-3">
              {/* Brand Name & Domain */}
              <div>
                <h4 className="text-[15px] font-semibold text-[#e8e8f0]">
                  {projectConfig.brandAssets.name || projectConfig.targetCompany}
                </h4>
                {projectConfig.brandAssets.domain && (
                  <p className="text-[11px] text-[#5c5c78]">
                    {projectConfig.brandAssets.domain}
                  </p>
                )}
              </div>
              
              {/* Color Palette */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-[#8585a3]" />
                  <span className="text-[12px] text-[#8585a3]">Colors:</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {projectConfig.brandAssets.colors?.slice(0, 6).map((color, i) => (
                    <div 
                      key={i}
                      className="w-6 h-6 rounded-md border border-[rgba(255,255,255,0.2)] shadow-sm" 
                      style={{ backgroundColor: color.hex }}
                      title={`${color.name}: ${color.hex}`}
                    />
                  ))}
                </div>
              </div>
              
              {/* Fonts */}
              {projectConfig.brandAssets.fonts && projectConfig.brandAssets.fonts.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Type className="w-3.5 h-3.5 text-[#8585a3]" />
                    <span className="text-[12px] text-[#8585a3]">Fonts:</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {projectConfig.brandAssets.fonts.map((font, i) => (
                      <span 
                        key={i}
                        className="text-[11px] text-[#c4c4d6] px-2 py-0.5 bg-[rgba(255,255,255,0.05)] rounded"
                      >
                        {font.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Brand Images */}
          {projectConfig.brandAssets.images && projectConfig.brandAssets.images.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.05)]">
              <div className="flex items-center gap-1.5 mb-2">
                <ImageIcon className="w-3.5 h-3.5 text-[#8585a3]" />
                <span className="text-[12px] text-[#8585a3]">Brand Images:</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {projectConfig.brandAssets.images.slice(0, 4).map((img, i) => (
                  <div 
                    key={i}
                    className="w-24 h-14 rounded-lg overflow-hidden bg-[#1a1a1f] border border-[rgba(255,255,255,0.1)] flex-shrink-0"
                  >
                    <img 
                      src={img.url} 
                      alt={img.type}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <p className="text-[11px] text-[#8585a3] mt-3 pt-3 border-t border-[rgba(255,255,255,0.05)]">
            These brand colors and logo will be applied to your deployed widget automatically.
          </p>
        </Card>
      )}

      {/* Description */}
      <Card>
        <CardHeader 
          title="Project Description" 
          description="Your original description - edit to refine"
        />
        
        <Textarea
          placeholder="Describe your bot's purpose, key user journeys, and any specific requirements..."
          value={projectConfig.description}
          onChange={(e) => setProjectConfig({ description: e.target.value })}
          rows={5}
        />
      </Card>

      {/* Reference Files */}
      <Card>
        <CardHeader 
          title="Reference Files" 
          description="Upload flowcharts, wireframes, or documentation (optional)"
          icon={<Upload className="w-5 h-5" />}
        />
        
        <label className="block cursor-pointer">
          <div className="border border-dashed border-[rgba(255,255,255,0.1)] rounded-xl p-6 text-center transition-all duration-200 hover:border-[rgba(99,102,241,0.3)] hover:bg-[rgba(99,102,241,0.02)]">
            <div className="w-10 h-10 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center mx-auto mb-3">
              <Upload className="w-5 h-5 text-[#5c5c78]" />
            </div>
            <p className="text-[14px] text-[#c4c4d6] font-medium">Click to upload</p>
            <p className="text-[12px] text-[#5c5c78] mt-1">
              PDF, images, CSV, or text files
            </p>
          </div>
          <input
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.csv,.txt,.md,.json"
            onChange={handleFileUpload}
          />
        </label>

        {projectConfig.referenceFiles.length > 0 && (
          <div className="mt-4 space-y-2">
            {projectConfig.referenceFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-[rgba(255,255,255,0.02)] rounded-xl border border-[rgba(255,255,255,0.06)]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.05)] flex items-center justify-center text-[#8585a3]">
                    {getFileIcon(file.type)}
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#e8e8f0] truncate max-w-[200px]">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-[#5c5c78]">{formatFileSize(file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeReferenceFile(file.id)}
                  className="p-1.5 text-[#5c5c78] hover:text-[#f87171] hover:bg-[rgba(248,113,113,0.1)] rounded-lg transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={prevStep} icon={<ArrowLeft className="w-4 h-4" />}>
          Back
        </Button>
        <Button 
          onClick={async () => {
            // Auto-save project setup before continuing
            if (!activeSolutionId && user.email) {
              setIsSaving(true);
              try {
                const saved = await addSavedSolution({
                  name: projectConfig.projectName || 'Untitled Solution',
                  clientName: projectConfig.clientName || '',
                  projectType: projectConfig.projectType,
                  description: projectConfig.description || '',
                  status: 'draft',
                  nodeCount: 0,
                  currentStep: 'project-setup',
                });
                if (saved) {
                  setActiveSolution(saved.id);
                }
              } catch (e) {
                console.error('Failed to auto-save:', e);
              }
              setIsSaving(false);
            }
            nextStep();
          }}
          icon={<ArrowRight className="w-4 h-4" />}
          iconPosition="right"
          disabled={!isValid || isSaving}
          loading={isSaving}
        >
          {isSaving ? 'Saving...' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
