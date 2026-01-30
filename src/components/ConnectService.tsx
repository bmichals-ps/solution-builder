import { useState } from 'react';
import { useStore } from '../store/useStore';
import { Button } from './Button';
import { 
  FileSpreadsheet, 
  Figma, 
  Github, 
  Link2,
  Check,
  Loader2,
  AlertCircle
} from 'lucide-react';

interface ConnectServiceProps {
  serviceId: 'google-sheets' | 'figma' | 'github';
  onConnected?: () => void;
  variant?: 'inline' | 'card';
  actionLabel?: string;
}

const serviceConfig = {
  'google-sheets': {
    name: 'Google Sheets',
    icon: FileSpreadsheet,
    description: 'Connect to export your bot CSV directly',
    color: 'from-[#0F9D58] to-[#0a7a44]',
    bgColor: 'rgba(15, 157, 88, 0.1)',
    borderColor: 'rgba(15, 157, 88, 0.2)',
  },
  'figma': {
    name: 'Figma',
    icon: Figma,
    description: 'Connect to import design flows',
    color: 'from-[#F24E1E] to-[#d43a0d]',
    bgColor: 'rgba(242, 78, 30, 0.1)',
    borderColor: 'rgba(242, 78, 30, 0.2)',
  },
  'github': {
    name: 'GitHub',
    icon: Github,
    description: 'Connect to store action scripts',
    color: 'from-[#6e5494] to-[#5a4279]',
    bgColor: 'rgba(110, 84, 148, 0.1)',
    borderColor: 'rgba(110, 84, 148, 0.2)',
  },
};

export function ConnectService({ 
  serviceId, 
  onConnected, 
  variant = 'card',
  actionLabel 
}: ConnectServiceProps) {
  const { integrations, connectIntegration, error, setError } = useStore();
  const [isConnecting, setIsConnecting] = useState(false);
  
  const integration = integrations.find((i) => i.id === serviceId);
  const config = serviceConfig[serviceId];
  const Icon = config.icon;
  
  const isConnected = integration?.connected ?? false;
  const hasComposioKey = !!import.meta.env.VITE_COMPOSIO_API_KEY;
  
  const handleConnect = async () => {
    if (!hasComposioKey) {
      setError('Composio not configured. Add VITE_COMPOSIO_API_KEY to .env');
      return;
    }
    
    setIsConnecting(true);
    const success = await connectIntegration(serviceId);
    setIsConnecting(false);
    
    if (success && onConnected) {
      onConnected();
    }
  };
  
  if (variant === 'inline') {
    if (isConnected) {
      return (
        <div className="flex items-center gap-2 text-[13px] text-[#4ade80]">
          <Check className="w-4 h-4" />
          <span>{config.name} connected</span>
        </div>
      );
    }
    
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleConnect}
        loading={isConnecting}
        disabled={!hasComposioKey}
        icon={<Icon className="w-4 h-4" />}
      >
        {actionLabel || `Connect ${config.name}`}
      </Button>
    );
  }
  
  // Card variant
  return (
    <div className={`
      p-4 rounded-xl border transition-all duration-200
      ${isConnected 
        ? 'bg-[rgba(34,197,94,0.04)] border-[rgba(34,197,94,0.15)]' 
        : `bg-[${config.bgColor}] border-[${config.borderColor}]`
      }
    `}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`
            w-10 h-10 rounded-xl flex items-center justify-center
            ${isConnected 
              ? 'bg-[rgba(34,197,94,0.12)] text-[#4ade80]' 
              : `bg-gradient-to-br ${config.color} text-white`
            }
          `}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-[14px] font-medium text-[#e8e8f0]">{config.name}</h4>
            <p className="text-[12px] text-[#5c5c78] mt-0.5">{config.description}</p>
          </div>
        </div>
        
        {isConnected ? (
          <span className="flex items-center gap-1.5 text-[13px] text-[#4ade80] font-medium">
            <Check className="w-4 h-4" />
            Connected
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleConnect}
            loading={isConnecting}
            disabled={!hasComposioKey}
          >
            Connect
          </Button>
        )}
      </div>
      
      {!hasComposioKey && !isConnected && (
        <div className="mt-3 flex items-start gap-2 text-[12px] text-[#fbbf24]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Add VITE_COMPOSIO_API_KEY to .env to enable</span>
        </div>
      )}
    </div>
  );
}
