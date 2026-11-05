import { ClipboardCheck, HandCoins, LayoutDashboard, Sparkles, CircleCheck, Upload, TriangleAlert, Landmark } from 'lucide-react';
import { GUIDE_AREAS, type GuideArea, type GuideKey } from './keys';
import { t, type Guide } from './types';

export { GUIDE_AREAS, type GuideKey } from './keys';
export type { Guide, GuideLang, Bi, Tone, Flow, FlowRow, FlowStep, FlowBranch } from './types';

/**
 * Home (the dashboard). Kept here rather than in a content file so the
 * dashboard can import it directly: `import { HOME_GUIDE } from '@/components/guide/guides'`,
 * or render `<ModuleGuide guide="home" />` / `<GuideButton guide="home" />`.
 */
export const HOME_GUIDE: Guide = {
  section: t('Home', 'होम'),
  title: t('How your day starts on Home', 'होम पेज से दिन की शुरुआत'),
  flow: [
    { icon: Upload, label: t('Upload documents', 'डॉक्यूमेंट अपलोड'), tone: 'action' },
    { icon: Sparkles, label: t('AI reads and suggests', 'AI पढ़कर सुझाव देता है'), tone: 'ai' },
    { icon: TriangleAlert, label: t('Needs your attention', 'आपका ध्यान चाहिए'), tone: 'wait' },
    {
      branch: [
        {
          edge: t('Review', 'रिव्यू'),
          flow: [
            { icon: ClipboardCheck, label: t('Entries to review', 'रिव्यू की एंट्री'), tone: 'wait' },
            { icon: CircleCheck, label: t('Approve & post', 'Approve & post'), tone: 'action' },
          ],
        },
        {
          edge: t('Overdue', 'बकाया'),
          flow: [
            { icon: Landmark, label: t('Overdue from customers', 'ग्राहकों का बकाया'), tone: 'error' },
            { icon: HandCoins, label: t('Record receipt', 'Record receipt'), tone: 'action' },
          ],
        },
        {
          edge: t('GST', 'GST'),
          flow: [
            { icon: TriangleAlert, label: t('GST mismatch', 'GST मिसमैच'), tone: 'wait' },
            { icon: ClipboardCheck, label: t('Reconcile on GST', 'GST में मिलान'), tone: 'action' },
          ],
        },
      ],
    },
    { icon: LayoutDashboard, label: t('Figures update', 'आंकड़े अपडेट'), tone: 'done' },
  ],
  can: [
    t('See this month’s income, expenses, cash and bank, and what customers and vendors owe, at a glance.', 'इस महीने की आमदनी, खर्च, कैश और बैंक, और ग्राहकों-वेंडरों का बकाया एक नज़र में देखें।'),
    t('Find what needs you today under **Needs your attention**: entries to review, documents waiting, money overdue and GST mismatches.', '**Needs your attention** में आज के ज़रूरी काम देखें: रिव्यू की एंट्री, रुके डॉक्यूमेंट, बकाया पैसा और GST मिसमैच।'),
    t('Read the cash flow chart, the cash forecast and **What I noticed**, the AI’s observations from your posted books.', 'कैश फ़्लो चार्ट, कैश का अनुमान और **What I noticed** (पोस्ट हुई किताबों से AI की बातें) पढ़ें।'),
    t('Ask your books a question in plain words, such as “Who owes me money?”.', 'सीधे शब्दों में सवाल पूछें, जैसे “मुझे किसका पैसा लेना है?”।'),
  ],
  steps: [
    t('Click **Upload documents** to send bills, invoices or a bank statement to the Inbox.', '**Upload documents** दबाकर बिल, इनवॉइस या बैंक स्टेटमेंट Inbox में भेजें।'),
    t('Click a tile under **Needs your attention** to go straight to that work.', '**Needs your attention** की किसी टाइल पर क्लिक करें, सीधे उसी काम पर पहुँचेंगे।'),
    t('In Review, check each entry and click **Approve & post**.', 'Review में हर एंट्री जाँचें और **Approve & post** दबाएँ।'),
    t('Come back to Home: the figures now include what you posted.', 'होम पर लौटें: अब आंकड़ों में आपकी पोस्ट की हुई एंट्री जुड़ गई है।'),
  ],
  note: t('Figures on Home come only from posted entries. A draft or an AI suggestion changes nothing until a person posts it.', 'होम के आंकड़े सिर्फ़ पोस्ट हुई एंट्री से बनते हैं। ड्राफ़्ट या AI का सुझाव तब तक कुछ नहीं बदलता जब तक कोई व्यक्ति उसे पोस्ट न करे।'),
};

type GuideMap = Partial<Record<GuideKey, Guide>>;

/** Each area's content, loaded the first time one of its guides is opened. */
const LOADERS: Record<GuideArea, () => Promise<GuideMap>> = {
  home: () => Promise.resolve({ home: HOME_GUIDE }),
  core: () => import('./content/core').then((m) => m.CORE_GUIDES),
  sales: () => import('./content/sales').then((m) => m.SALES_GUIDES),
  purchases: () => import('./content/purchases').then((m) => m.PURCHASE_GUIDES),
  books: () => import('./content/books').then((m) => m.BOOKS_GUIDES),
  accountant: () => import('./content/accountant').then((m) => m.ACCOUNTANT_GUIDES),
  reports: () => import('./content/reports').then((m) => m.REPORT_GUIDES),
  practice: () => import('./content/practice').then((m) => m.PRACTICE_GUIDES),
};

const loaded = new Map<GuideKey, Guide>([['home', HOME_GUIDE]]);
const pending = new Map<GuideArea, Promise<GuideMap>>();

/** A guide already loaded, if it is. */
export function peekGuide(key: GuideKey): Guide | undefined {
  return loaded.get(key);
}

/** Load a section's guide (and the rest of its area, which comes in the same file). */
export function loadGuide(key: GuideKey): Promise<Guide> {
  const hit = loaded.get(key);
  if (hit) return Promise.resolve(hit);
  const area = GUIDE_AREAS[key];
  let p = pending.get(area);
  if (!p) {
    p = LOADERS[area]();
    pending.set(area, p);
    // A failed load (offline, a new deploy) may be retried next time.
    p.catch(() => pending.delete(area));
  }
  return p.then((all) => {
    for (const [k, g] of Object.entries(all) as Array<[GuideKey, Guide]>) loaded.set(k, g);
    const g = all[key];
    if (!g) throw new Error(`No guide for ${key}`);
    return g;
  });
}
