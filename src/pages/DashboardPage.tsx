import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Search, Filter, MoreHorizontal, FileText, 
  Rocket, Archive, Clock, ChevronDown, Edit3, 
  Copy, Trash2, ExternalLink, LayoutGrid, List,
  ArrowLeft, Menu, Loader2, X
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { SavedSolution } from '../types';
import { NavDrawer, NavMenuButton } from '../components/ui/nav-drawer';

// Format date
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Status badge
function StatusBadge({ status, size = 'sm' }: { status: SavedSolution['status']; size?: 'sm' | 'md' }) {
  const config = {
    draft: { icon: FileText, label: 'Draft', className: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
    deployed: { icon: Rocket, label: 'Deployed', className: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
    archived: { icon: Archive, label: 'Archived', className: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
  };
  
  const { icon: Icon, label, className } = config[status];
  const sizeClasses = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${className} ${sizeClasses}`}>
      <Icon className={size === 'md' ? 'w-4 h-4' : 'w-3 h-3'} />
      {label}
    </span>
  );
}

// Project type badge
function TypeBadge({ type }: { type: SavedSolution['projectType'] }) {
  const labels: Record<string, string> = {
    claims: 'Claims',
    support: 'Support',
    sales: 'Sales',
    faq: 'FAQ',
    survey: 'Survey',
    custom: 'Custom',
  };
  
  return (
    <span className="px-2 py-0.5 rounded-md text-xs font-medium text-[#8a8a95] bg-white/5">
      {labels[type] || type}
    </span>
  );
}

// Delete confirmation modal
function DeleteConfirmModal({ 
  solutionName, 
  isDeleting, 
  onConfirm, 
  onCancel 
}: { 
  solutionName: string; 
  isDeleting: boolean; 
  onConfirm: () => void; 
  onCancel: () => void; 
}) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative bg-[#1a1a1f] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="w-12 h-12 rounded-full bg-red-400/10 flex items-center justify-center mx-auto mb-4">
          <Trash2 className="w-6 h-6 text-red-400" />
        </div>
        
        {/* Title */}
        <h3 className="text-lg font-semibold text-white text-center mb-2">
          Delete Solution
        </h3>
        
        {/* Message */}
        <p className="text-[#8585a3] text-center text-sm mb-6">
          Are you sure you want to delete <span className="text-white font-medium">"{solutionName}"</span>? This action cannot be undone.
        </p>
        
        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-[#a0a0a5] hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Solution card component
function SolutionCard({ solution, onSelect, onDelete }: { solution: SavedSolution; onSelect: () => void; onDelete: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;
    setShowDeleteConfirm(true);
    setShowMenu(false);
  };
  
  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    await onDelete();
    setIsDeleting(false);
    setShowDeleteConfirm(false);
  };
  
  return (
    <div 
      className="animate-card group relative bg-[#1a1a1f] border border-white/5 rounded-2xl p-5 hover:border-white/10 hover:bg-[#1c1c22] transition-all duration-200 cursor-pointer"
      onClick={onSelect}
    >
      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          solutionName={solution.name}
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
      
      {/* Delete button - top right corner on hover */}
      <button
        onClick={handleDeleteClick}
        disabled={isDeleting}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-[#1a1a1f]/80 backdrop-blur-sm border border-white/10 text-[#6a6a75] hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/10 transition-all duration-200 opacity-0 group-hover:opacity-100 z-10 disabled:opacity-50"
        title="Delete solution"
      >
        {isDeleting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <X className="w-4 h-4" />
        )}
      </button>
      
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white truncate group-hover:text-[#a5b4fc] transition-colors">
            {solution.name}
          </h3>
          <p className="text-sm text-[#6a6a75] mt-0.5">{solution.clientName}</p>
        </div>
        
        {/* Menu button */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1.5 rounded-lg text-[#5a5a65] hover:text-white hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }} />
              <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-[#1a1a1f] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#a0a0a5] hover:bg-white/5 hover:text-white transition-colors">
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
                <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#a0a0a5] hover:bg-white/5 hover:text-white transition-colors">
                  <Copy className="w-4 h-4" />
                  Duplicate
                </button>
                <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#a0a0a5] hover:bg-white/5 hover:text-white transition-colors">
                  <ExternalLink className="w-4 h-4" />
                  Export CSV
                </button>
                <div className="border-t border-white/5 my-1" />
                <button 
                  onClick={handleDeleteClick}
                  disabled={isDeleting}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                >
                  {isDeleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Description */}
      <p className="text-sm text-[#6a6a75] line-clamp-2 mb-4 min-h-[2.5rem]">
        {solution.description}
      </p>
      
      {/* Tags */}
      <div className="flex items-center gap-2 mb-4">
        <StatusBadge status={solution.status} />
        <TypeBadge type={solution.projectType} />
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <div className="flex items-center gap-1.5 text-xs text-[#5a5a65]">
          <Clock className="w-3.5 h-3.5" />
          Updated {formatDate(solution.updatedAt)}
        </div>
        <div className="text-xs text-[#5a5a65]">
          {solution.nodeCount} nodes
        </div>
      </div>
      
      {/* Environment indicator */}
      {solution.deployedEnvironment && (
        <div className="absolute top-3 right-10 px-2 py-0.5 rounded-md text-xs font-medium bg-[#6366f1]/20 text-[#a5b4fc] group-hover:right-12 transition-all">
          {solution.deployedEnvironment}
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SavedSolution['status']>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  
  const navigate = useNavigate();
  const savedSolutions = useStore((state) => state.savedSolutions);
  const solutionsLoaded = useStore((state) => state.solutionsLoaded);
  const userEmail = useStore((state) => state.user.email);
  const fetchSavedSolutions = useStore((state) => state.fetchSavedSolutions);
  const deleteSavedSolution = useStore((state) => state.deleteSavedSolution);
  const setStep = useStore((state) => state.setStep);
  const startNewSolution = useStore((state) => state.startNewSolution);
  const setActiveSolution = useStore((state) => state.setActiveSolution);
  
  // Sync solutions from Supabase on mount and when user email is available
  // Cached solutions show immediately, then we sync in background to remove deleted items
  useEffect(() => {
    if (userEmail) {
      fetchSavedSolutions();
    }
  }, [userEmail, fetchSavedSolutions]);
  
  // Filter solutions
  const filteredSolutions = savedSolutions.filter((solution) => {
    const matchesSearch = 
      solution.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      solution.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      solution.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || solution.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });
  
  const handleNewSolution = () => {
    startNewSolution();
  };
  
  const handleSelectSolution = (solutionId: string) => {
    setActiveSolution(solutionId);
    // Navigate to solution with ID in URL
    navigate(`/solutions/${solutionId}`);
  };
  
  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <NavDrawer />
      
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0a0a0c]/80 backdrop-blur-xl border-b border-white/5 animate-element">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <NavMenuButton />
              <div className="flex items-center gap-3">
                <img src="/pypestream-logo.png" alt="Pypestream" className="w-8 h-8" />
                <div>
                  <h1 className="text-lg font-semibold text-white">Solutions Dashboard</h1>
                  <p className="text-sm text-[#6a6a75]">Manage your bot solutions</p>
                </div>
              </div>
            </div>
            
            <button
              onClick={handleNewSolution}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6366f1] hover:bg-[#7c7ff2] text-white text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Solution
            </button>
          </div>
        </div>
      </header>
      
      {/* Toolbar */}
      <div className="max-w-7xl mx-auto px-6 py-6 animate-element animate-element-delay-1">
        <div className="flex items-center justify-between gap-4">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a5a65]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search solutions..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#1a1a1f] border border-white/5 text-white text-sm placeholder-[#5a5a65] focus:outline-none focus:border-[#6366f1]/50 focus:ring-1 focus:ring-[#6366f1]/25 transition-all"
            />
          </div>
          
          {/* Filters and View Toggle */}
          <div className="flex items-center gap-2">
            {/* Status Filter */}
            <div className="relative">
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a1f] border border-white/5 text-sm text-[#a0a0a5] hover:border-white/10 transition-colors"
              >
                <Filter className="w-4 h-4" />
                {statusFilter === 'all' ? 'All Status' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
                <ChevronDown className="w-4 h-4" />
              </button>
              
              {showFilterMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowFilterMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-36 bg-[#1a1a1f] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                    {(['all', 'deployed', 'draft', 'archived'] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setStatusFilter(status);
                          setShowFilterMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                          statusFilter === status 
                            ? 'bg-[#6366f1]/20 text-white' 
                            : 'text-[#a0a0a5] hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {status === 'all' ? 'All Status' : status.charAt(0).toUpperCase() + status.slice(1)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            
            {/* View Toggle */}
            <div className="flex items-center bg-[#1a1a1f] border border-white/5 rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-[#5a5a65] hover:text-white'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'list' ? 'bg-white/10 text-white' : 'text-[#5a5a65] hover:text-white'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Solutions Grid */}
      <div className="max-w-7xl mx-auto px-6 pb-12">
        {!solutionsLoaded ? (
          // Loading state
          <div className="text-center py-16 animate-element">
            <Loader2 className="w-8 h-8 text-[#6366f1] animate-spin mx-auto mb-4" />
            <p className="text-sm text-[#6a6a75]">Loading your solutions...</p>
          </div>
        ) : filteredSolutions.length > 0 ? (
          <div className={viewMode === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' 
            : 'space-y-3'
          }>
            {filteredSolutions.map((solution) => (
              <SolutionCard
                key={solution.id}
                solution={solution}
                onSelect={() => handleSelectSolution(solution.id)}
                onDelete={() => deleteSavedSolution(solution.id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 animate-element animate-element-delay-2">
            <FileText className="w-12 h-12 text-[#3a3a45] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No solutions found</h3>
            <p className="text-sm text-[#6a6a75] mb-6">
              {searchQuery || statusFilter !== 'all' 
                ? 'Try adjusting your search or filters'
                : 'Create your first solution to get started'
              }
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <button
                onClick={handleNewSolution}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6366f1] hover:bg-[#7c7ff2] text-white text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Solution
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
