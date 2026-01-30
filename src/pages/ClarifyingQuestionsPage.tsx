import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { 
  ArrowRight, 
  ArrowLeft,
  Check,
  Info
} from 'lucide-react';

export function ClarifyingQuestionsPage() {
  const { 
    clarifyingQuestions,
    answerQuestion,
    nextStep, 
    prevStep 
  } = useStore();

  const answeredCount = clarifyingQuestions.filter((q) => q.answer).length;
  const totalCount = clarifyingQuestions.length;
  const allAnswered = answeredCount === totalCount;

  return (
    <div className="space-y-6 stagger-children">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-headline text-[#f0f0f5]">Clarifying questions</h2>
          <span className="text-[13px] text-[#8585a3] font-medium">
            {answeredCount} of {totalCount}
          </span>
        </div>
        <p className="text-body text-[#8585a3]">
          Answer these to help generate a complete solution.
        </p>
      </div>

      {/* Progress Bar */}
      <div className="h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all duration-500 ease-out"
          style={{ width: `${(answeredCount / totalCount) * 100}%` }}
        />
      </div>

      {/* Questions */}
      <div className="space-y-4">
        {clarifyingQuestions.map((question, index) => (
          <Card 
            key={question.id}
            variant={question.answer ? 'outlined' : 'default'}
            className={question.answer ? 'border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.02)]' : ''}
          >
            <div className="flex items-start gap-4">
              {/* Question Number */}
              <div className={`
                w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px] font-semibold
                transition-all duration-300
                ${question.answer 
                  ? 'bg-[rgba(34,197,94,0.15)] text-[#4ade80] border border-[rgba(34,197,94,0.3)]' 
                  : 'bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] border border-[rgba(99,102,241,0.2)]'
                }
              `}>
                {question.answer ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> : index + 1}
              </div>

              <div className="flex-1 space-y-4">
                {/* Question Text */}
                <div>
                  <h3 className="text-[15px] font-medium text-[#e8e8f0] leading-relaxed">{question.question}</h3>
                  {question.reason && (
                    <p className="text-[12px] text-[#5c5c78] mt-1.5 flex items-start gap-1.5">
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {question.reason}
                    </p>
                  )}
                </div>

                {/* Answer Options */}
                {question.type === 'multiple_choice' && question.options && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {question.options.map((option, optIndex) => (
                      <button
                        key={optIndex}
                        onClick={() => answerQuestion(question.id, option)}
                        className={`
                          p-3 rounded-xl border text-left transition-all duration-200 text-[13px]
                          ${question.answer === option
                            ? 'border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.1)] text-[#c7d2fe]'
                            : 'border-[rgba(255,255,255,0.06)] text-[#a3a3bd] hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.02)]'
                          }
                        `}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className={`
                            w-4 h-4 rounded-full border flex items-center justify-center shrink-0
                            transition-all duration-200
                            ${question.answer === option
                              ? 'border-[#6366f1] bg-[#6366f1]'
                              : 'border-[rgba(255,255,255,0.2)]'
                            }
                          `}>
                            {question.answer === option && (
                              <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                            )}
                          </span>
                          {option}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {question.type === 'boolean' && (
                  <div className="flex gap-2">
                    {['Yes', 'No'].map((option) => (
                      <button
                        key={option}
                        onClick={() => answerQuestion(question.id, option)}
                        className={`
                          px-5 py-2.5 rounded-xl border transition-all duration-200 text-[13px] font-medium
                          ${question.answer === option
                            ? 'border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.1)] text-[#c7d2fe]'
                            : 'border-[rgba(255,255,255,0.06)] text-[#a3a3bd] hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.02)]'
                          }
                        `}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {question.type === 'text' && (
                  <textarea
                    value={question.answer || ''}
                    onChange={(e) => answerQuestion(question.id, e.target.value)}
                    placeholder="Type your answer..."
                    className="w-full px-4 py-3 bg-[rgba(10,10,15,0.6)] border border-[rgba(255,255,255,0.08)] rounded-xl text-[14px] text-[#e8e8f0] placeholder-[#5c5c78] focus:outline-none focus:border-[rgba(99,102,241,0.5)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)] resize-none transition-all"
                    rows={3}
                  />
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={prevStep} icon={<ArrowLeft className="w-4 h-4" />}>
          Back
        </Button>
        <Button 
          onClick={nextStep} 
          icon={<ArrowRight className="w-4 h-4" />}
          iconPosition="right"
          disabled={!allAnswered}
        >
          Generate Solution
        </Button>
      </div>
    </div>
  );
}
