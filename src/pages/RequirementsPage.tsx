import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { 
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { RequirementQuestion } from '../types';

interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

// Extended local type with category (API returns this)
interface RequirementQuestionWithCategory extends RequirementQuestion {
  category?: string;
  allowMultiple?: boolean;
}

export function RequirementsPage() {
  const { 
    projectConfig,
    requirementsQuestions,
    setRequirementsQuestions,
    requirementsAnswers,
    setRequirementsAnswers,
    updateRequirementsAnswer,
    setClarifyingQuestions,
    setLoading,
    setStep,
    prevStep,
    activeSolutionId,
    updateSavedSolution
  } = useStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [lastSavedAnswers, setLastSavedAnswers] = useState<string>('');

  // Cast to extended type for category support
  const questions = requirementsQuestions as RequirementQuestionWithCategory[];
  const answers = requirementsAnswers;

  // Auto-save answers to Supabase when they change (debounced)
  useEffect(() => {
    const answersJson = JSON.stringify(answers);
    if (answersJson === lastSavedAnswers || Object.keys(answers).length === 0) return;
    
    const saveTimeout = setTimeout(async () => {
      if (activeSolutionId && questions.length > 0) {
        try {
          await updateSavedSolution(activeSolutionId, {
            currentStep: 'requirements',
            requirementsQuestions: questions,
            requirementsAnswers: answers,
          });
          setLastSavedAnswers(answersJson);
          console.log('[AutoSave] Saved requirements progress');
        } catch (e) {
          console.error('[AutoSave] Failed:', e);
        }
      }
    }, 2000); // Save after 2 seconds of no changes
    
    return () => clearTimeout(saveTimeout);
  }, [answers, questions, activeSolutionId, updateSavedSolution, lastSavedAnswers]);

  // Fetch AI-generated questions on mount (only if not already loaded)
  useEffect(() => {
    // Skip if we already have questions (restored from store)
    if (questions.length > 0) {
      console.log('[Requirements] Using cached questions:', questions.length);
      return;
    }

    const fetchQuestions = async () => {
      setIsLoadingQuestions(true);
      try {
        const response = await fetch('/api/generate-requirements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectConfig })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.questions && Array.isArray(data.questions)) {
            // Save to store (which persists to localStorage)
            setRequirementsQuestions(data.questions);
            console.log('[Requirements] Fetched and saved questions:', data.questions.length);
          }
        }
      } catch (error) {
        console.error('Failed to fetch questions:', error);
      } finally {
        setIsLoadingQuestions(false);
      }
    };
    
    fetchQuestions();
  }, [projectConfig, questions.length, setRequirementsQuestions]);

  const currentQuestion = questions[currentIndex];
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
  const isLastQuestion = currentIndex === questions.length - 1;
  const isFirstQuestion = currentIndex === 0;

  const handleSelectOption = useCallback((optionId: string) => {
    if (!currentQuestion) return;
    
    const current = answers[currentQuestion.id] || [];
    
    if (currentQuestion.allowMultiple || currentQuestion.multiSelect) {
      // Toggle selection for multi-select
      if (current.includes(optionId)) {
        updateRequirementsAnswer(currentQuestion.id, current.filter(id => id !== optionId));
      } else {
        updateRequirementsAnswer(currentQuestion.id, [...current, optionId]);
      }
    } else {
      // Single select - update and auto advance
      updateRequirementsAnswer(currentQuestion.id, [optionId]);
      
      // Auto-advance after a brief delay for visual feedback
      if (!isLastQuestion) {
        setTimeout(() => {
          setDirection('next');
          setIsTransitioning(true);
          setTimeout(() => {
            setCurrentIndex(i => i + 1);
            setIsTransitioning(false);
          }, 200);
        }, 300);
      }
    }
  }, [currentQuestion, answers, isLastQuestion, updateRequirementsAnswer]);

  const goToNext = useCallback(() => {
    if (isLastQuestion) return;
    setDirection('next');
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex(i => i + 1);
      setIsTransitioning(false);
    }, 200);
  }, [isLastQuestion]);

  const goToPrev = useCallback(() => {
    if (isFirstQuestion) return;
    setDirection('prev');
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex(i => i - 1);
      setIsTransitioning(false);
    }, 200);
  }, [isFirstQuestion]);

  const handleComplete = useCallback(async () => {
    // Convert answers to clarifying questions format
    const clarifyingQuestions = questions.map(q => {
      const selectedIds = answers[q.id] || [];
      const selectedLabels = (q.options || [])
        .filter(opt => selectedIds.includes(opt.id))
        .map(opt => opt.label);
      
      return {
        id: q.id,
        question: q.question,
        type: (q.allowMultiple || q.multiSelect) ? 'multiple_choice' as const : 'boolean' as const,
        options: (q.options || []).map(o => o.label),
        answer: (selectedLabels || []).join(', ') || 'No selection',
        reason: `Category: ${q.category || 'General'}`
      };
    });
    
    setClarifyingQuestions(clarifyingQuestions);
    
    // Save final state to Supabase
    if (activeSolutionId) {
      await updateSavedSolution(activeSolutionId, {
        currentStep: 'generation',
        requirementsQuestions: questions,
        requirementsAnswers: answers,
      });
    }
    
    setLoading(false);
    // Skip directly to generation (bypassing old clarifying-questions page)
    setStep('generation');
  }, [questions, answers, setClarifyingQuestions, setLoading, setStep, activeSolutionId, updateSavedSolution]);

  const hasCurrentAnswer = currentQuestion && (answers[currentQuestion.id]?.length || 0) > 0;
  const answeredCount = Object.keys(answers).filter(k => answers[k]?.length > 0).length;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (isLastQuestion && hasCurrentAnswer) {
          handleComplete();
        } else if (hasCurrentAnswer) {
          goToNext();
        }
      } else if (e.key === 'ArrowLeft') {
        goToPrev();
      } else if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (currentQuestion && currentQuestion.options[index]) {
          handleSelectOption(currentQuestion.options[index].id);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentQuestion, isLastQuestion, hasCurrentAnswer, goToNext, goToPrev, handleSelectOption, handleComplete]);

  // Loading state
  if (isLoadingQuestions) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[rgba(99,102,241,0.2)] to-[rgba(139,92,246,0.1)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-[#a5b4fc] animate-spin" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-semibold text-[#e8e8f0] mb-2">Analyzing your project...</h3>
          <p className="text-[#8585a3]">Generating personalized questions for {projectConfig.projectName || 'your bot'}</p>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <p className="text-[#8585a3]">No questions generated. Please go back and try again.</p>
        <Button variant="ghost" onClick={prevStep} icon={<ArrowLeft className="w-4 h-4" />}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[70vh]">
      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[#6a6a75] font-medium uppercase tracking-wider">
            {currentQuestion?.category || 'Question'}
          </span>
          <span className="text-xs text-[#6a6a75]">
            {currentIndex + 1} of {questions.length}
          </span>
        </div>
        <div className="h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <div className="flex-1 flex flex-col">
        <div 
          className={`transition-all duration-200 ease-out ${
            isTransitioning 
              ? direction === 'next' 
                ? 'opacity-0 translate-x-8' 
                : 'opacity-0 -translate-x-8'
              : 'opacity-100 translate-x-0'
          }`}
        >
          {/* Question */}
          <div className="mb-8">
            <h2 className="text-2xl md:text-3xl font-semibold text-[#f0f0f5] leading-tight mb-3">
              {currentQuestion?.question}
            </h2>
            {(currentQuestion?.allowMultiple || currentQuestion?.multiSelect) && (
              <p className="text-sm text-[#8585a3] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#a5b4fc]" />
                Select all that apply
              </p>
            )}
          </div>

          {/* Options */}
          <div className="space-y-3">
            {currentQuestion?.options.map((option, index) => {
              const isSelected = answers[currentQuestion.id]?.includes(option.id);
              
              return (
                <button
                  key={option.id}
                  onClick={() => handleSelectOption(option.id)}
                  className={`
                    w-full p-4 rounded-xl border text-left transition-all duration-200 group
                    ${isSelected
                      ? 'border-[rgba(99,102,241,0.5)] bg-[rgba(99,102,241,0.1)]'
                      : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.04)]'
                    }
                  `}
                >
                  <div className="flex items-start gap-4">
                    {/* Selection indicator */}
                    <div className={`
                      w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-all duration-200
                      ${isSelected
                        ? 'bg-[#6366f1] text-white'
                        : 'bg-[rgba(255,255,255,0.06)] text-[#5c5c78] group-hover:bg-[rgba(255,255,255,0.1)]'
                      }
                    `}>
                      {isSelected ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <span className="text-xs font-medium">{index + 1}</span>
                      )}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[15px] font-medium ${isSelected ? 'text-[#e8e8f0]' : 'text-[#c4c4d6]'}`}>
                        {option.label}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-8 pt-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between">
          {/* Left side - Back */}
          <div className="flex items-center gap-3">
            {isFirstQuestion ? (
              <Button variant="ghost" onClick={prevStep} icon={<ArrowLeft className="w-4 h-4" />}>
                Back to Setup
              </Button>
            ) : (
              <Button 
                variant="ghost" 
                onClick={goToPrev}
                icon={<ChevronLeft className="w-4 h-4" />}
              >
                Previous
              </Button>
            )}
          </div>

          {/* Center - Quick nav dots */}
          <div className="hidden sm:flex items-center gap-1.5">
            {questions.map((q, i) => (
              <button
                key={q.id}
                onClick={() => {
                  setDirection(i > currentIndex ? 'next' : 'prev');
                  setIsTransitioning(true);
                  setTimeout(() => {
                    setCurrentIndex(i);
                    setIsTransitioning(false);
                  }, 200);
                }}
                className={`
                  w-2 h-2 rounded-full transition-all duration-200
                  ${i === currentIndex 
                    ? 'w-6 bg-[#6366f1]' 
                    : answers[q.id]?.length 
                      ? 'bg-[#22c55e]' 
                      : 'bg-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.25)]'
                  }
                `}
                title={`Question ${i + 1}: ${q.question.substring(0, 30)}...`}
              />
            ))}
          </div>

          {/* Right side - Next/Complete */}
          <div className="flex items-center gap-3">
            {isLastQuestion ? (
              <Button 
                onClick={handleComplete}
                disabled={!hasCurrentAnswer}
                icon={<Sparkles className="w-4 h-4" />}
              >
                Generate Bot ({answeredCount}/{questions.length})
              </Button>
            ) : (
              <Button 
                variant={hasCurrentAnswer ? 'primary' : 'secondary'}
                onClick={goToNext}
                disabled={!hasCurrentAnswer && !(currentQuestion?.allowMultiple || currentQuestion?.multiSelect)}
                icon={<ChevronRight className="w-4 h-4" />}
                iconPosition="right"
              >
                {(currentQuestion?.allowMultiple || currentQuestion?.multiSelect) && !hasCurrentAnswer ? 'Skip' : 'Next'}
              </Button>
            )}
          </div>
        </div>
        
        {/* Keyboard hints */}
        <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-[#4a4a55]">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[#6a6a75]">1-9</kbd>
            select option
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[#6a6a75]">←</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[#6a6a75]">→</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[#6a6a75]">Enter</kbd>
            continue
          </span>
        </div>
      </div>
    </div>
  );
}
