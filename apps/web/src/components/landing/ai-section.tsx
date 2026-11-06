import { Reveal } from './reveal';
import { cn } from '@/lib/utils';
import { AiFlow } from './ai-flow';
import { AskBooks } from './ask-books';
import { Eyebrow, container, h2Class, sectionY } from './shared';

/** How the AI works, on the light green band: paper to proposal to posting, then questions. */
export function AiSection() {
  return (
    <section id="ai" aria-labelledby="ai-title" className={cn('scroll-mt-16 bg-brand-50', sectionY)}>
      <div className={container}>
        <Reveal className="max-w-3xl">
          <Eyebrow>AI that shows its work</Eyebrow>
          <h2 id="ai-title" className={cn(h2Class, 'mt-3')}>
            AI suggests. You approve.
          </h2>
          <p className="mt-4 text-body-lg text-ink-600">
            AiBooks reads your paperwork and drafts the entry. A person reviews it, and only then does
            it reach the ledger. Every proposal is kept apart from your books until someone approves it.
          </p>
        </Reveal>

        <div className="mt-12">
          <AiFlow />
        </div>

        <div id="ask" className="mt-20 scroll-mt-24 border-t border-brand-100 pt-16 sm:mt-24">
          <AskBooks />
        </div>
      </div>
    </section>
  );
}
