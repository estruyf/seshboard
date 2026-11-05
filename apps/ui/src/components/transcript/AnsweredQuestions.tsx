import { Check, MessageCircleQuestion } from 'lucide-react';
import type { AnsweredQuestion } from './questionAnswers.ts';

/**
 * A question Claude asked, once you answered it: each question with its options, the ones you picked marked, and what
 * you typed yourself. The card you answered in goes away, so this is where the conversation keeps your choice.
 */
export function AnsweredQuestions({ questions }: { questions: AnsweredQuestion[] }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3" data-answered-question>
      <p className="mb-2 flex items-center gap-2 text-ui font-medium text-muted">
        <MessageCircleQuestion size={14} className="text-accent-ink" aria-hidden />
        Claude asked you
      </p>
      <div className="grid gap-3">
        {questions.map((q) => (
          <div key={q.question} className="grid gap-1.5" data-answered-question-item>
            <p className="text-body font-medium select-text">
              {q.header && <span className="mr-2 rounded bg-border/70 px-1.5 py-0.5 text-meta font-normal text-muted uppercase">{q.header}</span>}
              {q.question}
            </p>
            {q.options.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Options">
                {q.options.map((option) => {
                  const picked = q.picked.includes(option);
                  return (
                    <li
                      key={option}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-ui ${picked ? 'bg-accent/15 font-medium text-accent-ink' : 'bg-text/6 text-faint'}`}
                      data-picked={picked || undefined}
                    >
                      {picked && <Check size={12} aria-hidden />}
                      {option}
                      {picked && <span className="sr-only"> (your answer)</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {q.other !== null && (
              <p className="text-body whitespace-pre-wrap select-text" data-answered-question-other>
                <span className="mr-2 text-meta text-muted">Your answer</span>
                {q.other}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
