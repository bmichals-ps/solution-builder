import { ReactNode, useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { Sidebar } from './Sidebar';
import { ArrowUp } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { currentStep, instantStep } = useStore();
  const [showScrollTop, setShowScrollTop] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  
  // Instant flow pages are full-screen (no wizard sidebar)
  const isInstantFlowActive = instantStep !== 'create';
  
  // Full-screen pages without wizard sidebar
  const isFullScreenPage = currentStep === 'welcome' || currentStep === 'dashboard' || isInstantFlowActive;
  
  // Handle scroll to show/hide back to top button
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    
    const handleScroll = () => {
      setShowScrollTop(content.scrollTop > 200);
    };
    
    content.addEventListener('scroll', handleScroll);
    return () => content.removeEventListener('scroll', handleScroll);
  }, []);
  
  const scrollToTop = () => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  // Full-screen pages: landing page / dashboard without wizard sidebar
  if (isFullScreenPage) {
    return (
      <div className="min-h-screen bg-[#0a0a0f]">
        {children}
      </div>
    );
  }
  
  // Other pages: standard layout with sidebar
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Sidebar (fixed) */}
      <Sidebar />
      
      {/* Main Content (offset for fixed sidebar) */}
      <main className="ml-[260px] min-h-screen flex flex-col">
        {/* Header (sticky) */}
        <header className="h-16 border-b border-[rgba(255,255,255,0.04)] bg-[rgba(10,10,15,0.95)] backdrop-blur-xl flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
          {/* Empty header - title is now in sidebar */}
        </header>
        
        {/* Content Area (scrollable) */}
        <div ref={contentRef} className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            {children}
          </div>
        </div>
        
        {/* Scroll to top button */}
        <button
          onClick={scrollToTop}
          className={`
            fixed bottom-6 right-6 z-50
            w-10 h-10 rounded-full
            bg-[rgba(99,102,241,0.9)] hover:bg-[#6366f1]
            text-white shadow-lg
            flex items-center justify-center
            transition-all duration-300 ease-out
            ${showScrollTop 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4 pointer-events-none'
            }
          `}
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      </main>
    </div>
  );
}
