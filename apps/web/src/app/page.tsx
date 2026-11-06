import { AiSection } from '@/components/landing/ai-section';
import { CtaBand } from '@/components/landing/cta';
import { Features } from '@/components/landing/features';
import { Footer } from '@/components/landing/footer';
import { Hero } from '@/components/landing/hero';
import { LandingNav } from '@/components/landing/nav';
import { Pricing } from '@/components/landing/pricing';
import { Showcase } from '@/components/landing/showcase';

/**
 * Public landing page.
 *
 * Every claim maps to something the product does today, and the figures in
 * the mock dashboard are labelled as sample data. No customer counts, logos
 * or testimonials: there are none to show yet, and inventing them would be
 * the first lie a prospective customer catches.
 *
 * Sections, top to bottom: nav, hero (navy), features and safeguards
 * (white), AI (light green), dashboard showcase (grey), pricing (white),
 * call to action (navy) and footer (dark navy).
 */
export default function LandingPage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface-card focus:px-4 focus:py-2 focus:text-body focus:font-semibold focus:text-navy-900 focus:shadow-e2"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="main" className="overflow-x-clip">
        <Hero />
        <Features />
        <AiSection />
        <Showcase />
        <Pricing />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
