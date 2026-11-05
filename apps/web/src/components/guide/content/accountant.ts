import {
  ArrowRightLeft,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileInput,
  FilePen,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Globe,
  HandCoins,
  Keyboard,
  ListChecks,
  Lock,
  LockOpen,
  PencilLine,
  PiggyBank,
  Power,
  Scale,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Undo2,
  Upload,
  UserCheck,
  Building,
} from 'lucide-react';
import type { AreaKeys } from '../keys';
import { t, type Guide } from '../types';

export const ACCOUNTANT_GUIDES: Record<AreaKeys<'accountant'>, Guide> = {
  manualJournals: {
    section: t('Manual Journals', 'मैनुअल जर्नल'),
    title: t('Life cycle of a manual journal', 'मैनुअल जर्नल का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('New journal', 'नया जर्नल'), tone: 'action' },
      { icon: Scale, label: t('Debits equal credits', 'डेबिट = क्रेडिट'), tone: 'action' },
      {
        branch: [
          { edge: t('No policy', 'पॉलिसी नहीं'), flow: [{ icon: CircleCheck, label: t('Post journal', 'Post journal'), tone: 'done' }] },
          {
            edge: t('Policy applies', 'पॉलिसी लागू'),
            flow: [
              { icon: UserCheck, label: t('Sent for approval', 'मंज़ूरी को भेजा'), tone: 'wait' },
              { icon: CircleCheck, label: t('Posts when approved', 'मंज़ूरी पर पोस्ट'), tone: 'done' },
            ],
          },
        ],
      },
      { icon: Undo2, label: t('Wrong? Reverse journal', 'ग़लत? Reverse journal'), tone: 'action' },
    ],
    can: [
      t('Post entries that are not a sale, purchase or payment: a provision, a correction, a transfer between accounts.', 'ऐसी एंट्री पोस्ट करें जो बिक्री, ख़रीद या पेमेंट नहीं: प्रोविज़न, सुधार, अकाउंट्स के बीच ट्रांसफ़र।'),
      t('Add as many lines as you need, each with an account, a debit or credit, and a project if it belongs to one.', 'जितनी चाहिए उतनी लाइनें जोड़ें, हर लाइन में अकाउंट, डेबिट या क्रेडिट, और ज़रूरत हो तो प्रोजेक्ट।'),
      t('See the difference as you type; it posts only when debits equal credits.', 'टाइप करते समय फ़र्क़ दिखता है; डेबिट और क्रेडिट बराबर होने पर ही पोस्ट होता है।'),
      t('Correct a posted journal by reversing it; the original stays on record.', 'पोस्ट हुआ जर्नल रिवर्स करके सुधारें; असली एंट्री रिकॉर्ड में बनी रहती है।'),
    ],
    steps: [
      t('Click **New journal**. Enter the date and the narration.', '**New journal** दबाएँ। तारीख़ और narration भरें।'),
      t('Add lines: the account, a debit or a credit, and a project if needed. Use **Add line** for more.', 'लाइनें जोड़ें: अकाउंट, डेबिट या क्रेडिट, और ज़रूरत हो तो प्रोजेक्ट। और लाइनों के लिए **Add line**।'),
      t('When the totals say **Balanced**, click **Post journal**.', 'जब टोटल में **Balanced** दिखे, **Post journal** दबाएँ।'),
      t('If it says **Sent for approval**, it posts once approved on **Approvals**.', 'अगर **Sent for approval** लिखा आए, तो **Approvals** में मंज़ूरी के बाद पोस्ट होगा।'),
      t('To correct one, open it and click **Reverse journal**, then post the right entry.', 'सुधारने के लिए जर्नल खोलें और **Reverse journal** दबाएँ, फिर सही एंट्री पोस्ट करें।'),
    ],
    note: t('A posted journal is never edited, only reversed.', 'पोस्ट हुआ जर्नल कभी बदला नहीं जाता, सिर्फ़ रिवर्स होता है।'),
  },

  bulkUpdate: {
    section: t('Bulk Update', 'बल्क अपडेट'),
    title: t('Life cycle of a bulk update', 'बल्क अपडेट का पूरा सफ़र'),
    flow: [
      { icon: Search, label: t('Find transactions on an account', 'अकाउंट में एंट्री ढूँढें'), tone: 'action' },
      { icon: ListChecks, label: t('Choose the lines', 'लाइनें चुनें'), tone: 'action' },
      { icon: ArrowRightLeft, label: t('Propose reclassification', 'Propose reclassification'), tone: 'action' },
      { icon: ClipboardCheck, label: t('One entry waits in Review', 'एक एंट्री Review में'), tone: 'wait' },
      {
        branch: [
          { edge: t('Approved', 'मंज़ूर'), flow: [{ icon: CircleCheck, label: t('Posted; originals unchanged', 'पोस्ट; पुरानी एंट्री वैसी ही'), tone: 'done' }] },
          { edge: t('Rejected', 'रिजेक्ट'), flow: [{ icon: Undo2, label: t('Nothing moves', 'कुछ नहीं बदला'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Move posted lines booked to the wrong account, for example a month of repairs booked to rent.', 'ग़लत अकाउंट में पोस्ट हुई लाइनें सही अकाउंट में ले जाएँ, जैसे किराए में डली मरम्मत।'),
      t('Find them by account, dates and words in the narration.', 'उन्हें अकाउंट, तारीख़ और narration के शब्दों से ढूँढें।'),
      t('Propose one reclassification entry for the net of the chosen lines; it posts only when approved in Review.', 'चुनी लाइनों के कुल का एक reclassification प्रस्ताव बनाएँ; यह Review में मंज़ूरी पर ही पोस्ट होता है।'),
      t('A line already being moved shows as moved and cannot be moved twice.', 'जो लाइन पहले से बदली जा रही है, वह moved दिखती है और दोबारा नहीं बदली जा सकती।'),
    ],
    steps: [
      t('Under **Find transactions**, pick the **Account**, optionally **From**, **To** and **Narration or description contains**, then click **Find transactions**.', '**Find transactions** में **Account** चुनें, चाहें तो **From**, **To** और **Narration or description contains** भरें, फिर **Find transactions** दबाएँ।'),
      t('Tick the lines to move, or **Choose every line**.', 'बदलने वाली लाइनों पर टिक करें, या **Choose every line**।'),
      t('Under **Move the chosen lines**, pick the account to move them to and give the reason.', '**Move the chosen lines** में नया अकाउंट चुनें और वजह लिखें।'),
      t('Click **Propose reclassification**, then approve it in **Review**.', '**Propose reclassification** दबाएँ, फिर **Review** में मंज़ूर करें।'),
    ],
    note: t('Receivable and payable accounts cannot be moved this way: use a credit or debit note.', 'ग्राहक और वेंडर वाले अकाउंट (receivable, payable) ऐसे नहीं बदलते: क्रेडिट या डेबिट नोट बनाएँ।'),
  },

  currencyAdjustments: {
    section: t('Currency Adjustments', 'करेंसी एडजस्टमेंट'),
    title: t('Life cycle of a currency adjustment', 'करेंसी एडजस्टमेंट का पूरा सफ़र'),
    flow: [
      { icon: Coins, label: t('Save the exchange rate', 'एक्सचेंज रेट सेव करें'), tone: 'action' },
      { icon: FileText, label: t('Open foreign invoices and bills', 'खुले विदेशी इनवॉइस और बिल'), tone: 'wait' },
      { icon: CalendarCheck, label: t('Month-end rate', 'महीने के अंत का रेट'), tone: 'action' },
      { icon: TrendingUp, label: t('Propose revaluation', 'Propose revaluation'), tone: 'action' },
      { icon: ClipboardCheck, label: t('Gain or loss waits in Review', 'फ़ायदा या नुकसान Review में'), tone: 'wait' },
      { icon: CircleCheck, label: t('Approved and posted', 'मंज़ूर और पोस्ट'), tone: 'done' },
      { icon: Undo2, label: t('Reverses itself on the 1st', '1 तारीख़ को अपने-आप रिवर्स'), tone: 'neutral' },
    ],
    can: [
      t('Enter the rate for a currency and date: rupees for one unit, from the RBI reference rate or your bank.', 'करेंसी और तारीख़ का रेट भरें: एक यूनिट के कितने रुपये, RBI रेफ़रेंस रेट या बैंक से।'),
      t('Value what is still open in foreign currency at the month-end rate.', 'विदेशी करेंसी में जो अभी खुला है, उसे महीने के अंत के रेट पर आँकें।'),
      t('Send the exchange gain or loss to Review; it reverses on the 1st of the next month.', 'एक्सचेंज का फ़ायदा या नुकसान Review में भेजें; अगले महीने की 1 तारीख़ को वह रिवर्स हो जाता है।'),
    ],
    steps: [
      t('Under **Exchange rates**, enter the currency, date and rate, then **Save rate**.', '**Exchange rates** में करेंसी, तारीख़ और रेट भरें, फिर **Save rate** दबाएँ।'),
      t('At month-end, enter the month-end rate first.', 'महीने के अंत में पहले उस दिन का रेट भरें।'),
      t('Under **Month-end revaluation**, pick the month and click **Propose revaluation**.', '**Month-end revaluation** में महीना चुनें और **Propose revaluation** दबाएँ।'),
      t('Approve it in **Review**.', '**Review** में मंज़ूर करें।'),
    ],
    note: t('Rates are entered by hand; they are not fetched automatically.', 'रेट ख़ुद भरने होते हैं; वे अपने-आप नहीं आते।'),
  },

  chartOfAccounts: {
    section: t('Chart of Accounts', 'चार्ट ऑफ़ अकाउंट्स'),
    title: t('Life cycle of an account', 'अकाउंट का पूरा सफ़र'),
    flow: [
      { icon: FolderTree, label: t('Groups: assets to capital', 'ग्रुप: एसेट से कैपिटल तक'), tone: 'neutral' },
      { icon: FilePlus2, label: t('New account or sub-account', 'नया अकाउंट या सब-अकाउंट'), tone: 'action' },
      { icon: FileText, label: t('Entries post to it', 'इसमें एंट्री पोस्ट होती हैं'), tone: 'done' },
      {
        branch: [
          { edge: t('Rename', 'नाम बदलें'), flow: [{ icon: PencilLine, label: t('Edit name, code, group', 'नाम, कोड, ग्रुप बदलें'), tone: 'action' }] },
          { edge: t('Wrong lines', 'ग़लत लाइनें'), flow: [{ icon: ArrowRightLeft, label: t('Move posted lines', 'Move posted lines'), tone: 'action' }] },
          { edge: t('Not used', 'इस्तेमाल नहीं'), flow: [{ icon: Power, label: t('Deactivate account', 'Deactivate account'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('See your ledger groups and accounts under Assets, Liabilities, Income, Expenses and Capital, with each balance.', 'Assets, Liabilities, Income, Expenses और Capital के नीचे अपने ग्रुप और अकाउंट, हर एक के बैलेंस के साथ देखें।'),
      t('Add an account, or a sub-account under a group.', 'नया अकाउंट जोड़ें, या किसी ग्रुप के नीचे सब-अकाउंट।'),
      t('Change an account’s name, code and group. Its type never changes, because past entries depend on it.', 'अकाउंट का नाम, कोड और ग्रुप बदलें। उसका प्रकार कभी नहीं बदलता, क्योंकि पुरानी एंट्री उस पर टिकी हैं।'),
      t('Retire an account you no longer use, and bring it back later.', 'जो अकाउंट अब काम का नहीं, उसे बंद करें, और बाद में फिर चालू करें।'),
    ],
    steps: [
      t('Click **New account**: a name, a type and the group it sits under, then **Save account**.', '**New account** दबाएँ: नाम, प्रकार और ग्रुप चुनें, फिर **Save account**।'),
      t('To add one under a group, click **Add sub-account** on the group.', 'किसी ग्रुप के नीचे जोड़ने के लिए उस ग्रुप पर **Add sub-account** दबाएँ।'),
      t('Select an account and click **Edit** to change its name, code or group.', 'अकाउंट चुनें और नाम, कोड या ग्रुप बदलने के लिए **Edit** दबाएँ।'),
      t('Click **Move posted lines** to open Bulk Update for it, or **Deactivate account** to retire it.', 'Bulk Update खोलने के लिए **Move posted lines** दबाएँ, या बंद करने के लिए **Deactivate account**।'),
    ],
    note: t('System accounts the books rely on cannot be deactivated.', 'जिन सिस्टम अकाउंट पर खाते टिके हैं, वे बंद नहीं हो सकते।'),
  },

  budgets: {
    section: t('Budgets', 'बजट'),
    title: t('Life cycle of a budget', 'बजट का पूरा सफ़र'),
    flow: [
      { icon: CalendarClock, label: t('Pick the year', 'साल चुनें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: Keyboard, label: t('Type month by month', 'महीने-दर-महीने भरें'), tone: 'action' }] },
          { flow: [{ icon: Sparkles, label: t('Fill from last year', 'पिछले साल से भरें'), tone: 'action' }] },
        ],
      },
      { icon: PiggyBank, label: t('Save budgets', 'Save budgets'), tone: 'done' },
      { icon: Target, label: t('Budget against actual', 'बजट बनाम असल'), tone: 'done' },
    ],
    can: [
      t('Plan each income and expense account by month, for a financial year.', 'हर income और expense अकाउंट की महीने-वार योजना बनाएँ, एक वित्त वर्ष के लिए।'),
      t('Start from last year’s figures, raised or cut by a percentage.', 'पिछले साल के आंकड़ों से शुरू करें, प्रतिशत से बढ़ाकर या घटाकर।'),
      t('Compare the plan with what happened in Management Reports, under **Budget against actual**.', 'Management Reports में **Budget against actual** में योजना और असल को मिलाएँ।'),
    ],
    steps: [
      t('Pick the financial year.', 'वित्त वर्ष चुनें।'),
      t('Type the budget for each account by month, or click **Fill from last year** with a percentage.', 'हर अकाउंट का महीने-वार बजट भरें, या प्रतिशत के साथ **Fill from last year** दबाएँ।'),
      t('Click **Save budgets**.', '**Save budgets** दबाएँ।'),
      t('Open **Management reports** and choose **Budget against actual**.', '**Management reports** खोलें और **Budget against actual** चुनें।'),
    ],
    note: t('Budgets never touch the books.', 'बजट से खातों में कुछ नहीं बदलता।'),
  },

  transactionLocking: {
    section: t('Transaction Locking', 'ट्रांज़ैक्शन लॉकिंग'),
    title: t('Life cycle of a locked period', 'लॉक पीरियड का पूरा सफ़र'),
    flow: [
      { icon: FileText, label: t('Returns filed for the month', 'महीने के रिटर्न फ़ाइल'), tone: 'done' },
      { icon: ClipboardList, label: t('Check what is still open', 'जो खुला है, जाँचें'), tone: 'wait' },
      { icon: Lock, label: t('Lock through a date', 'तारीख़ तक लॉक'), tone: 'done' },
      {
        branch: [
          { edge: t('Must change', 'बदलना है'), flow: [{ icon: LockOpen, label: t('Unlock books', 'Unlock books'), tone: 'neutral' }] },
          {
            edge: t('After 31 March', '31 मार्च के बाद'),
            flow: [
              { icon: BadgeCheck, label: t('Close FY', 'Close FY'), tone: 'done' },
              { icon: Undo2, label: t('Reopen FY if needed', 'ज़रूरत हो तो Reopen FY'), tone: 'neutral' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Stop anything dated on or before a date from being posted, once that month’s returns are filed.', 'महीने के रिटर्न फ़ाइल होने के बाद, उस तारीख़ तक की कोई भी एंट्री पोस्ट होने से रोकें।'),
      t('See a checklist of what is still open: documents to review, unposted invoices and bills, bank lines, depreciation.', 'जो अभी खुला है उसकी लिस्ट देखें: रिव्यू के डॉक्यूमेंट, बिना पोस्ट इनवॉइस और बिल, बैंक लाइनें, डेप्रिसिएशन।'),
      t('Unlock if you must change something; every lock and unlock is in the history.', 'कुछ बदलना ज़रूरी हो तो अनलॉक करें; हर लॉक और अनलॉक इतिहास में दर्ज रहता है।'),
      t('Close the year: income and expenses move to Retained Earnings in one entry dated 31 March.', 'साल बंद करें: income और expense एक एंट्री में, 31 मार्च की तारीख़ से, Retained Earnings में जाते हैं।'),
    ],
    steps: [
      t('Set **Lock through** to the last day of the month.', '**Lock through** में महीने की आख़िरी तारीख़ चुनें।'),
      t('Work through **Still open on or before** the date; each item links to where you sort it out.', '**Still open on or before** वाली लिस्ट निपटाएँ; हर चीज़ के साथ उसे ठीक करने का लिंक है।'),
      t('Click **Lock through** the date.', 'उस तारीख़ के लिए **Lock through** दबाएँ।'),
      t('To change something, click **Unlock books**. **Lock history** shows every change.', 'कुछ बदलना हो तो **Unlock books** दबाएँ। **Lock history** में हर बदलाव दिखता है।'),
      t('After March’s returns, under **Year-end close**, click **Close FY**. **Reopen FY** reverses it.', 'मार्च के रिटर्न के बाद **Year-end close** में **Close FY** दबाएँ। **Reopen FY** से यह वापस होता है।'),
    ],
    note: t('Nothing dated in a locked period can be posted, including payments, notes and reversals.', 'लॉक पीरियड की तारीख़ वाली कोई एंट्री पोस्ट नहीं हो सकती, पेमेंट, नोट और रिवर्सल भी नहीं।'),
  },

  monthEnd: {
    section: t('Month-end', 'मंथ-एंड'),
    title: t('Life cycle of a month-end', 'मंथ-एंड का पूरा सफ़र'),
    flow: [
      { icon: CalendarCheck, label: t('Pick the month', 'महीना चुनें'), tone: 'action' },
      { icon: Sparkles, label: t('Assistant lists what is due', 'असिस्टेंट बताता है क्या बाकी'), tone: 'ai' },
      {
        branch: [
          { flow: [{ icon: TrendingUp, label: t('Depreciation', 'डेप्रिसिएशन'), tone: 'action' }] },
          { flow: [{ icon: CalendarClock, label: t('Accruals, prepaids', 'Accrual, prepaid'), tone: 'action' }] },
          { flow: [{ icon: Building, label: t('Capitalise assets', 'एसेट कैपिटलाइज़'), tone: 'action' }] },
        ],
      },
      { icon: ClipboardCheck, label: t('Proposals wait in Review', 'प्रस्ताव Review में'), tone: 'wait' },
      { icon: CircleCheck, label: t('Approve & post', 'Approve & post'), tone: 'done' },
      { icon: Lock, label: t('Lock the month', 'महीना लॉक करें'), tone: 'done' },
    ],
    can: [
      t('Let the assistant find what the month still needs: depreciation, scheduled entries, bills that usually come but have not.', 'असिस्टेंट से पता करें कि महीने में क्या बाकी है: डेप्रिसिएशन, तय एंट्री, जो बिल हर बार आते हैं पर इस बार नहीं आए।'),
      t('Spread a year paid in one month over 12 months, and capitalise purchases that should be assets.', 'एक महीने में भरा सालाना ख़र्च 12 महीनों में बाँटें, और जो ख़रीद एसेट होनी चाहिए उसे कैपिटलाइज़ करें।'),
      t('Keep a fixed-asset register (SLM or WDV, Schedule II lives), sell or scrap assets, and see tax depreciation.', 'फ़िक्स्ड एसेट रजिस्टर रखें (SLM या WDV, Schedule II की उम्र), एसेट बेचें या स्क्रैप करें, और टैक्स डेप्रिसिएशन देखें।'),
      t('Set up accruals, prepaids and recurring journals that draft themselves into Review.', 'Accrual, prepaid और रिकरिंग जर्नल सेट करें, जो अपने-आप Review में ड्राफ़्ट होते हैं।'),
    ],
    steps: [
      t('Pick the month. On **Assistant**, click **Propose entries**.', 'महीना चुनें। **Assistant** में **Propose entries** दबाएँ।'),
      t('Click **Spread over 12 months** for an annual cost, and **Capitalise** for an asset booked as an expense.', 'सालाना ख़र्च के लिए **Spread over 12 months**, और ख़र्च में डले एसेट के लिए **Capitalise** दबाएँ।'),
      t('On **Fixed assets**, use **Add asset**, and run depreciation to the month’s end.', '**Fixed assets** में **Add asset** करें, और महीने के अंत तक डेप्रिसिएशन चलाएँ।'),
      t('On **Accruals & prepaids**, use **New schedule** then **Create schedule**; on **Recurring journals**, **New recurring journal**.', '**Accruals & prepaids** में **New schedule** फिर **Create schedule**; **Recurring journals** में **New recurring journal**।'),
      t('Approve everything in **Review**, then lock the month on **Transaction Locking**.', 'सब कुछ **Review** में मंज़ूर करें, फिर **Transaction Locking** में महीना लॉक करें।'),
    ],
    note: t('Every month-end entry goes to Review first; nothing here posts by itself.', 'मंथ-एंड की हर एंट्री पहले Review में जाती है; यहाँ से अपने-आप कुछ पोस्ट नहीं होता।'),
  },

  openingBalances: {
    section: t('Opening Balances', 'ओपनिंग बैलेंस'),
    title: t('Life cycle of opening balances', 'ओपनिंग बैलेंस का पूरा सफ़र'),
    flow: [
      {
        branch: [
          {
            flow: [
              { icon: Upload, label: t('Import from Tally, Zoho, QuickBooks', 'Tally, Zoho, QuickBooks से इम्पोर्ट'), tone: 'action' },
              { icon: FileSpreadsheet, label: t('Read the files', 'Read the files'), tone: 'action' },
            ],
          },
          { flow: [{ icon: Keyboard, label: t('Enter by hand', 'ख़ुद भरें'), tone: 'action' }] },
        ],
      },
      { icon: ListChecks, label: t('Check accounts and totals', 'अकाउंट और टोटल जाँचें'), tone: 'wait' },
      { icon: Scale, label: t('Balanced', 'Balanced'), tone: 'done', edge: t('Or the difference to Suspense', 'या फ़र्क़ Suspense में') },
      { icon: FileInput, label: t('Import opening balances', 'Import opening balances'), tone: 'action' },
      { icon: CircleCheck, label: t('Posted straight to the books', 'सीधे खातों में पोस्ट'), tone: 'done' },
    ],
    can: [
      t('Bring your chart of accounts, customers, vendors and balances over from Tally, Zoho Books or QuickBooks.', 'Tally, Zoho Books या QuickBooks से अकाउंट्स, ग्राहक, वेंडर और बैलेंस लाएँ।'),
      t('Or type each account’s balance, and each customer’s and vendor’s balance, by hand.', 'या हर अकाउंट का बैलेंस, और हर ग्राहक व वेंडर का बैलेंस ख़ुद भरें।'),
      t('Give a type to every account AiBooks could not place, and check the totals balance.', 'जिन अकाउंट का प्रकार AiBooks तय नहीं कर पाया, उन्हें प्रकार दें, और देखें कि टोटल बराबर है।'),
      t('Start mid-year with income and expense balances too.', 'साल के बीच से शुरू करें तो income और expense के बैलेंस भी भरें।'),
    ],
    steps: [
      t('Choose **Import from another system** or **Enter by hand**.', '**Import from another system** या **Enter by hand** चुनें।'),
      t('To import: **Choose files** (Tally Masters XML; Zoho or QuickBooks reports), then **Read the files**.', 'इम्पोर्ट के लिए: **Choose files** (Tally का Masters XML; Zoho या QuickBooks की रिपोर्ट), फिर **Read the files**।'),
      t('Give a type with **What is this?** to anything unplaced, and check the totals say **Balanced**.', 'जिनका प्रकार तय नहीं, उन्हें **What is this?** से प्रकार दें, और देखें टोटल में **Balanced** लिखा है।'),
      t('Set **Balances as at** (usually 1 April) and click **Import opening balances**.', '**Balances as at** तारीख़ (आम तौर पर 1 अप्रैल) चुनें और **Import opening balances** दबाएँ।'),
    ],
    note: t('Only a Company admin can do this. To undo an import, reverse the opening voucher on **All Vouchers**.', 'यह सिर्फ़ Company admin कर सकता है। इम्पोर्ट वापस लेना हो तो **All Vouchers** में ओपनिंग वाउचर रिवर्स करें।'),
  },

  vouchers: {
    section: t('All Vouchers', 'सभी वाउचर'),
    title: t('Life cycle of a voucher', 'वाउचर का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: FilePen, label: t('Posted from a document', 'डॉक्यूमेंट से पोस्ट'), tone: 'action' }] },
          { flow: [{ icon: ClipboardCheck, label: t('Approved in Review', 'Review में मंज़ूर'), tone: 'action' }] },
        ],
      },
      { icon: CircleCheck, label: t('Posted, numbered without gaps', 'पोस्ट, बिना गैप के नंबर'), tone: 'done' },
      {
        branch: [
          { edge: t('Correct', 'सही'), flow: [{ icon: BadgeCheck, label: t('Stays as it is', 'वैसा ही रहता है'), tone: 'done' }] },
          {
            edge: t('Wrong', 'ग़लत'),
            flow: [
              { icon: Undo2, label: t('Reverse entry', 'Reverse entry'), tone: 'neutral' },
              { icon: FilePlus2, label: t('Post the right one', 'सही एंट्री पोस्ट'), tone: 'action' },
            ],
          },
        ],
      },
    ],
    can: [
      t('See every posted entry: purchase, sales, payment, receipt, contra and journal, with its number and status.', 'हर पोस्ट हुई एंट्री देखें: purchase, sales, payment, receipt, contra और journal, नंबर और हालत के साथ।'),
      t('Filter by voucher type.', 'वाउचर के प्रकार से छाँटें।'),
      t('Reverse a posted entry to correct it; the original and the reversal both stay on record.', 'पोस्ट हुई एंट्री रिवर्स करके सुधारें; असली और रिवर्सल दोनों रिकॉर्ड में रहते हैं।'),
      t('Open the files attached to a voucher.', 'वाउचर से जुड़ी फ़ाइलें खोलें।'),
    ],
    steps: [
      t('Pick a type to filter the list.', 'लिस्ट छाँटने के लिए प्रकार चुनें।'),
      t('To correct one, click **Reverse**, then **Reverse entry**.', 'सुधारने के लिए **Reverse** दबाएँ, फिर **Reverse entry**।'),
      t('Post the correct entry from the right page (an invoice, bill or journal).', 'सही एंट्री सही पेज से पोस्ट करें (इनवॉइस, बिल या जर्नल)।'),
      t('Click **Files** to see the documents behind a voucher.', 'वाउचर के डॉक्यूमेंट देखने के लिए **Files** दबाएँ।'),
    ],
    note: t('Voucher numbers run without gaps, per type and financial year. The year picker here does not filter the list yet.', 'वाउचर नंबर हर प्रकार और वित्त वर्ष में बिना गैप के चलते हैं। यहाँ का साल चुनने वाला अभी लिस्ट नहीं छाँटता।'),
  },

  foreignCurrency: {
    section: t('Foreign Currency', 'विदेशी मुद्रा'),
    title: t('Life cycle of a foreign-currency document', 'विदेशी मुद्रा डॉक्यूमेंट का पूरा सफ़र'),
    flow: [
      { icon: Coins, label: t('Save the rate', 'रेट सेव करें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: Globe, label: t('Export invoice (LUT)', 'एक्सपोर्ट इनवॉइस (LUT)'), tone: 'action' }] },
          { flow: [{ icon: FileText, label: t('Foreign bill', 'विदेशी बिल'), tone: 'action' }] },
        ],
      },
      { icon: FilePen, label: t('Draft: post from its page', 'ड्राफ़्ट: उसके पेज से पोस्ट'), tone: 'neutral' },
      { icon: HandCoins, label: t('Receive or pay at that day’s rate', 'उस दिन के रेट पर लें या दें'), tone: 'action' },
      { icon: TrendingUp, label: t('Exchange gain or loss posts', 'एक्सचेंज फ़ायदा/नुकसान पोस्ट'), tone: 'done' },
      { icon: CalendarCheck, label: t('Month-end revaluation', 'महीने के अंत में रीवैल्युएशन'), tone: 'wait', edge: t('Still open', 'अभी भी खुला') },
    ],
    can: [
      t('Raise export invoices under your LUT, with no GST, and the shipping bill details for goods.', 'अपने LUT के तहत बिना GST के एक्सपोर्ट इनवॉइस बनाएँ, माल के लिए शिपिंग बिल की जानकारी के साथ।'),
      t('Enter bills from vendors abroad, including imported services under IGST reverse charge.', 'विदेशी वेंडरों के बिल भरें, इम्पोर्ट की गई सर्विस पर IGST reverse charge के साथ।'),
      t('Keep the books in rupees at each document’s rate.', 'खाते रुपये में, हर डॉक्यूमेंट के रेट पर रखें।'),
      t('Record receipts and payments at the rate that day; the difference posts as exchange gain or loss.', 'उस दिन के रेट पर पैसा लेना-देना दर्ज करें; फ़र्क़ एक्सचेंज के फ़ायदे या नुकसान में पोस्ट होता है।'),
    ],
    steps: [
      t('On **Rates**, enter the currency, date and rate, then **Save rate**.', '**Rates** में करेंसी, तारीख़ और रेट भरें, फिर **Save rate** दबाएँ।'),
      t('On **Export invoice** or **Foreign bill**, fill in the party, currency, number, date, rate and lines, then **Save export invoice** or **Save bill**.', '**Export invoice** या **Foreign bill** में पार्टी, करेंसी, नंबर, तारीख़, रेट और लाइनें भरें, फिर **Save export invoice** या **Save bill** दबाएँ।'),
      t('Post the draft from its page under **Sales → Invoices** or **Purchases → Bills**.', 'ड्राफ़्ट को **Sales → Invoices** या **Purchases → Bills** में उसके पेज से पोस्ट करें।'),
      t('On **Documents**, click **Record receipt** or **Record payment**, with the **Rate that day**.', '**Documents** में **Record receipt** या **Record payment** दबाएँ, **Rate that day** के साथ।'),
      t('At month-end, on **Revaluation**, pick the month and click **Propose revaluation**.', 'महीने के अंत में **Revaluation** में महीना चुनें और **Propose revaluation** दबाएँ।'),
    ],
    note: t('Exports with payment of IGST, e-invoices for exports, and fetched exchange rates are not available yet.', 'IGST भरकर एक्सपोर्ट, एक्सपोर्ट के ई-इनवॉइस, और अपने-आप आने वाले एक्सचेंज रेट अभी उपलब्ध नहीं हैं।'),
  },
};
