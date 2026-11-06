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
      {
        branch: [
          { edge: t('Reverse date set', 'रिवर्स तारीख़ दी'), flow: [{ icon: CalendarClock, label: t('Reverses itself on that date', 'उस तारीख़ पर ख़ुद रिवर्स'), tone: 'done' }] },
          { edge: t('Wrong?', 'ग़लत?'), flow: [{ icon: Undo2, label: t('Reverse journal', 'Reverse journal'), tone: 'action' }] },
        ],
      },
    ],
    can: [
      t('Post entries that are not a sale, purchase or payment: a provision, a correction, a transfer between accounts.', 'ऐसी एंट्री पोस्ट करें जो बिक्री, ख़रीद या पेमेंट नहीं: प्रोविज़न, सुधार, अकाउंट्स के बीच ट्रांसफ़र।'),
      t('Give it a Reference#, and your own Journal# if you keep one; the JNL voucher number is given as always.', 'Reference# दें, और चाहें तो अपना Journal#; JNL वाउचर नंबर हमेशा की तरह मिलता है।'),
      t('Add as many lines as you need, each with an account, a description, a customer or vendor, a debit or credit, and a project if it belongs to one.', 'जितनी चाहिए उतनी लाइनें जोड़ें, हर लाइन में अकाउंट, विवरण, ग्राहक या वेंडर, डेबिट या क्रेडिट, और ज़रूरत हो तो प्रोजेक्ट।'),
      t('Set a reverse journal date for an accrual: it reverses itself on that date.', 'एक्रूअल के लिए रिवर्स जर्नल तारीख़ दें: उस तारीख़ पर जर्नल ख़ुद रिवर्स हो जाता है।'),
      t('See the totals and the difference as you type; it posts only when debits equal credits.', 'टाइप करते समय टोटल और फ़र्क़ दिखता है; डेबिट और क्रेडिट बराबर होने पर ही पोस्ट होता है।'),
      t('Attach the papers behind it, and correct a posted journal by reversing it; the original stays on record.', 'उसके काग़ज़ अटैच करें, और पोस्ट हुआ जर्नल रिवर्स करके सुधारें; असली एंट्री रिकॉर्ड में बनी रहती है।'),
    ],
    steps: [
      t('Click **New journal**. Enter the **Date** and the **Notes** (why the entry is made), and a **Reference#** if you have one.', '**New journal** दबाएँ। **Date** और **Notes** (एंट्री क्यों) भरें, और हो तो **Reference#**।'),
      t('To use your own number, click the cog beside **Journal#** and type it. Each number is used once.', 'अपना नंबर देने के लिए **Journal#** के पास वाले कॉग को दबाएँ और टाइप करें। हर नंबर एक ही बार चलता है।'),
      t('Add lines: the account, a description, the contact, and a debit or a credit. **Enter** in an amount moves to the next line; **Add New Row** adds one.', 'लाइनें जोड़ें: अकाउंट, विवरण, कॉन्टैक्ट, और डेबिट या क्रेडिट। रकम में **Enter** दबाने से अगली लाइन आती है; **Add New Row** से नई लाइन।'),
      t('For an accrual, set **Reverse Journal Date**. Ticked, **Publish reverse journal only on the reverse journal date** posts the reversal that morning; unticked, it posts now, dated that day.', 'एक्रूअल के लिए **Reverse Journal Date** दें। टिक हो तो **Publish reverse journal only on the reverse journal date** रिवर्सल उस दिन सुबह पोस्ट करता है; टिक न हो तो अभी, उसी तारीख़ से।'),
      t('When the **Difference** is zero, click **Post journal**. If it says **Sent for approval**, it posts once approved on **Approvals**.', 'जब **Difference** शून्य हो, **Post journal** दबाएँ। **Sent for approval** आए तो **Approvals** में मंज़ूरी पर पोस्ट होगा।'),
      t('To correct one, open it and click **Reverse journal**, then post the right entry.', 'सुधारने के लिए जर्नल खोलें और **Reverse journal** दबाएँ, फिर सही एंट्री पोस्ट करें।'),
    ],
    note: t(
      'A posted journal is never edited, only reversed. Receivables, payables, advances and employee claims are kept by document, so a journal cannot post to them: use a credit or debit note, a receipt or payment, or Opening Balances.',
      'पोस्ट हुआ जर्नल कभी बदला नहीं जाता, सिर्फ़ रिवर्स होता है। Receivables, payables, एडवांस और कर्मचारी क्लेम डॉक्यूमेंट से चलते हैं, इसलिए जर्नल उनमें पोस्ट नहीं होता: क्रेडिट या डेबिट नोट, रसीद या पेमेंट, या Opening Balances इस्तेमाल करें।',
    ),
  },

  bulkUpdate: {
    section: t('Bulk Update', 'बल्क अपडेट'),
    title: t('Life cycle of a bulk update', 'बल्क अपडेट का पूरा सफ़र'),
    flow: [
      { icon: Search, label: t('Filter transactions on an account', 'अकाउंट की एंट्री छाँटें'), tone: 'action' },
      { icon: ListChecks, label: t('Choose the lines', 'लाइनें चुनें'), tone: 'action' },
      {
        branch: [
          { edge: t('Lines span months', 'कई महीनों की लाइनें'), flow: [{ icon: CalendarCheck, label: t('One entry per month', 'हर महीने की एक एंट्री'), tone: 'action' }] },
          { edge: t('Or', 'या'), flow: [{ icon: ArrowRightLeft, label: t('One entry for all', 'सबकी एक एंट्री'), tone: 'action' }] },
        ],
      },
      { icon: ClipboardCheck, label: t('Entries wait in Review', 'एंट्री Review में'), tone: 'wait' },
      {
        branch: [
          { edge: t('Approved', 'मंज़ूर'), flow: [{ icon: CircleCheck, label: t('Posted; originals unchanged', 'पोस्ट; पुरानी एंट्री वैसी ही'), tone: 'done' }] },
          { edge: t('Rejected', 'रिजेक्ट'), flow: [{ icon: Undo2, label: t('Nothing moves', 'कुछ नहीं बदला'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Move posted lines booked to the wrong account, for example a month of repairs booked to rent.', 'ग़लत अकाउंट में पोस्ट हुई लाइनें सही अकाउंट में ले जाएँ, जैसे किराए में डली मरम्मत।'),
      t('Filter them by account, contact (the customer or vendor on the bill, invoice, payment or expense, or the line’s own contact), dates, amount range and words in the narration.', 'उन्हें अकाउंट, कॉन्टैक्ट (बिल, इनवॉइस, पेमेंट या ख़र्च का ग्राहक या वेंडर, या लाइन का अपना कॉन्टैक्ट), तारीख़, रक़म की सीमा और narration के शब्दों से छाँटें।'),
      t('Move lines from several months as one entry per month, each dated at that month’s end, so the monthly profit and loss moves where the lines are. Or as one entry for all.', 'कई महीनों की लाइनें हर महीने की एक एंट्री में ले जाएँ, हर एक उस महीने की आख़िरी तारीख़ पर, ताकि महीने-वार मुनाफ़ा-नुकसान वहीं बदले जहाँ लाइनें हैं। या सबकी एक एंट्री।'),
      t('Every entry posts only when approved in Review. A line already being moved shows as moved and cannot be moved twice.', 'हर एंट्री Review में मंज़ूरी पर ही पोस्ट होती है। जो लाइन पहले से बदली जा रही है, वह moved दिखती है और दोबारा नहीं बदली जा सकती।'),
    ],
    steps: [
      t('Under **Filter transactions**, pick the **Account**; optionally a **Contact**, **Date from** and **Date to**, **Amount from** and **Amount to**, and words. Click **Search**.', '**Filter transactions** में **Account** चुनें; चाहें तो **Contact**, **Date from** और **Date to**, **Amount from** और **Amount to**, और शब्द भरें। **Search** दबाएँ।'),
      t('Tick the lines to move, or **Choose every line**.', 'बदलने वाली लाइनों पर टिक करें, या **Choose every line**।'),
      t('Under **Move the chosen lines**, pick the account to move them to and give the reason.', '**Move the chosen lines** में नया अकाउंट चुनें और वजह लिखें।'),
      t('Under **Entries**, keep **One entry per month** (chosen for you when the lines span months) or pick **One entry for all**. The table shows each entry, its date and amount.', '**Entries** में **One entry per month** रहने दें (लाइनें कई महीनों की हों तो यही चुना होता है) या **One entry for all** चुनें। तालिका में हर एंट्री, उसकी तारीख़ और रक़म दिखती है।'),
      t('Click **Propose reclassification**, then approve each entry in **Review**.', '**Propose reclassification** दबाएँ, फिर **Review** में हर एंट्री मंज़ूर करें।'),
    ],
    note: t('A locked month’s entry is dated the day after the lock; a month whose lines net to nothing is left as it is. Receivable and payable accounts cannot be moved this way: use a credit or debit note.', 'लॉक महीने की एंट्री लॉक के अगले दिन की तारीख़ पर जाती है; जिस महीने की लाइनें आपस में कट जाएँ, वह वैसा ही रहता है। ग्राहक और वेंडर वाले अकाउंट (receivable, payable) ऐसे नहीं बदलते: क्रेडिट या डेबिट नोट बनाएँ।'),
  },

  currencyAdjustments: {
    section: t('Currency Adjustments', 'करेंसी एडजस्टमेंट'),
    title: t('Life cycle of a currency adjustment', 'करेंसी एडजस्टमेंट का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('New adjustment: currency, date, rate, notes', 'नया एडजस्टमेंट: करेंसी, तारीख़, रेट, नोट'), tone: 'action' },
      { icon: FileText, label: t('Continue: open invoices and bills at the new rate', 'Continue: नए रेट पर खुले इनवॉइस और बिल'), tone: 'wait' },
      { icon: TrendingUp, label: t('Propose adjustment', 'Propose adjustment'), tone: 'action' },
      { icon: ClipboardCheck, label: t('Gain or loss waits in Review', 'फ़ायदा या नुकसान Review में'), tone: 'wait' },
      { icon: CircleCheck, label: t('Approved and posted', 'मंज़ूर और पोस्ट'), tone: 'done' },
      { icon: Undo2, label: t('Reverses itself on the 1st', '1 तारीख़ को अपने-आप रिवर्स'), tone: 'neutral' },
    ],
    can: [
      t('Revalue what is still open in one currency at a rate you enter, on a date you pick: each invoice and bill with its booked rupees, its new rupees and the gain or loss.', 'एक करेंसी में जो अभी खुला है, उसे आपके भरे रेट पर, आपकी चुनी तारीख़ पर आँकें: हर इनवॉइस और बिल की बुक हुई रक़म, नई रक़म और फ़ायदा या नुकसान।'),
      t('See every adjustment by date and currency, with its rate, gain or loss and whether it is in Review, posted or reversed.', 'हर एडजस्टमेंट तारीख़ और करेंसी से देखें, उसके रेट, फ़ायदे या नुकसान के साथ, और यह कि वह Review में है, पोस्ट हुआ या रिवर्स।'),
      t('At month-end, revalue every open currency at once at the month-end rates.', 'महीने के अंत में सभी खुली करेंसी एक साथ महीने के अंत के रेट पर आँकें।'),
      t('Keep the exchange rates: rupees for one unit, from the RBI reference rate or your bank.', 'एक्सचेंज रेट रखें: एक यूनिट के कितने रुपये, RBI रेफ़रेंस रेट या बैंक से।'),
    ],
    steps: [
      t('Click **New adjustment**. Pick the **Currency** and the **Date of adjustment**, type the **Exchange rate** (1 AED = 25.58 INR) and the **Notes**.', '**New adjustment** दबाएँ। **Currency** और **Date of adjustment** चुनें, **Exchange rate** (1 AED = 25.58 INR) और **Notes** भरें।'),
      t('Click **Continue**: each open invoice and bill in that currency shows its booked rupees, the new rupees and the gain or loss.', '**Continue** दबाएँ: उस करेंसी के हर खुले इनवॉइस और बिल की बुक हुई रक़म, नई रक़म और फ़ायदा या नुकसान दिखता है।'),
      t('Click **Propose adjustment**. The rate is saved as that day’s rate, and the entry goes to **Review**; approve it there.', '**Propose adjustment** दबाएँ। रेट उस दिन के रेट के रूप में सेव होता है, और एंट्री **Review** में जाती है; वहाँ मंज़ूर करें।'),
      t('For every currency at month-end, use **Month-end revaluation**: pick the month and click **Propose revaluation**.', 'महीने के अंत में सभी करेंसी के लिए **Month-end revaluation** में महीना चुनें और **Propose revaluation** दबाएँ।'),
    ],
    note: t('One adjustment a currency a month: each reverses only on the 1st, so a second would count the difference twice. The month-end revaluation leaves out a currency already adjusted that month. Bank accounts are kept in rupees, so no bank balance is revalued. Rates are entered by hand.', 'एक करेंसी का महीने में एक एडजस्टमेंट: हर एक 1 तारीख़ को ही रिवर्स होता है, दूसरा उसी फ़र्क़ को दोबारा गिनेगा। महीने के अंत का रीवैल्युएशन उस करेंसी को छोड़ देता है जिसका उस महीने एडजस्टमेंट हो चुका। बैंक अकाउंट रुपये में रहते हैं, इसलिए किसी बैंक बैलेंस का रीवैल्युएशन नहीं होता। रेट ख़ुद भरने होते हैं।'),
  },

  chartOfAccounts: {
    section: t('Chart of Accounts', 'चार्ट ऑफ़ अकाउंट्स'),
    title: t('Life cycle of an account', 'अकाउंट का पूरा सफ़र'),
    flow: [
      { icon: FolderTree, label: t('Groups: assets to capital', 'ग्रुप: एसेट से कैपिटल तक'), tone: 'neutral' },
      { icon: FilePlus2, label: t('New account: pick its type', 'नया अकाउंट: प्रकार चुनें'), tone: 'action' },
      { icon: FileText, label: t('Entries post to it', 'इसमें एंट्री पोस्ट होती हैं'), tone: 'done' },
      {
        branch: [
          { edge: t('Change', 'बदलें'), flow: [{ icon: PencilLine, label: t('Edit name, code, type, parent', 'नाम, कोड, प्रकार, पैरेंट बदलें'), tone: 'action' }] },
          { edge: t('Wrong lines', 'ग़लत लाइनें'), flow: [{ icon: ArrowRightLeft, label: t('Move posted lines', 'Move posted lines'), tone: 'action' }] },
          { edge: t('Not used', 'इस्तेमाल नहीं'), flow: [{ icon: Power, label: t('Deactivate account', 'Deactivate account'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('See every account with its code, type, parent account and balance. A lock marks the accounts the books rely on.', 'हर अकाउंट उसके कोड, प्रकार, पैरेंट अकाउंट और बैलेंस के साथ देखें। ताले का निशान उन अकाउंट पर है जिन पर खाते टिके हैं।'),
      t('Filter by Active, Inactive or All, and by type; search by name, code or type.', 'Active, Inactive या All से, और प्रकार से छाँटें; नाम, कोड या प्रकार से खोजें।'),
      t('Add an account of a detailed type (Bank, Fixed Asset, Input Tax, Cost of Goods Sold…), with a code, a description and a parent account.', 'एक विस्तृत प्रकार (Bank, Fixed Asset, Input Tax, Cost of Goods Sold…) का अकाउंट जोड़ें, कोड, विवरण और पैरेंट अकाउंट के साथ।'),
      t('Put an account on the dashboard watchlist to see its balance there.', 'अकाउंट को डैशबोर्ड वॉचलिस्ट में डालें ताकि उसका बैलेंस वहाँ दिखे।'),
      t('Retire an account you no longer use, and bring it back later.', 'जो अकाउंट अब काम का नहीं, उसे बंद करें, और बाद में फिर चालू करें।'),
    ],
    steps: [
      t('Click **New account**. Choose the **Account Type**: what belongs in it shows beside it.', '**New account** दबाएँ। **Account Type** चुनें: उसमें क्या आता है, बगल में दिखता है।'),
      t('Enter the **Account Name**, and an **Account Code** if you want one (left blank, the next free code is used).', '**Account Name** भरें, और चाहें तो **Account Code** (ख़ाली छोड़ें तो अगला ख़ाली कोड लगता है)।'),
      t('Tick **Make this a sub-account** and pick the **Parent Account**, add a **Description**, and tick **Add to the watchlist on my dashboard** if you want it there. Then **Save account**.', '**Make this a sub-account** टिक करके **Parent Account** चुनें, **Description** लिखें, और चाहें तो **Add to the watchlist on my dashboard** टिक करें। फिर **Save account**।'),
      t('Click an account to edit it. Its type can change only to another of the same kind (an expense to another expense type), because past entries depend on it.', 'बदलने के लिए अकाउंट पर क्लिक करें। उसका प्रकार सिर्फ़ उसी तरह के दूसरे प्रकार में बदलता है (एक expense से दूसरे expense प्रकार में), क्योंकि पुरानी एंट्री उस पर टिकी हैं।'),
      t('On the edit page, **Move posted lines** opens Bulk Update for it, and **Deactivate account** retires it.', 'एडिट पेज पर **Move posted lines** उसके लिए Bulk Update खोलता है, और **Deactivate account** उसे बंद करता है।'),
    ],
    note: t('System accounts the books rely on keep their type and cannot be deactivated; they can be renamed and moved.', 'जिन सिस्टम अकाउंट पर खाते टिके हैं, उनका प्रकार नहीं बदलता और वे बंद नहीं हो सकते; उनका नाम बदल सकते हैं और उन्हें दूसरे ग्रुप में ले जा सकते हैं।'),
  },

  budgets: {
    section: t('Budgets', 'बजट'),
    title: t('Life cycle of a budget', 'बजट का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('New budget: name, year, period', 'नया बजट: नाम, साल, अवधि'), tone: 'action' },
      { icon: ListChecks, label: t('Add income and expense accounts', 'income और expense अकाउंट जोड़ें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: Keyboard, label: t('Type by month, quarter, half-year or year', 'महीना, तिमाही, छमाही या साल से भरें'), tone: 'action' }] },
          { flow: [{ icon: Sparkles, label: t('Fill from last year', 'पिछले साल से भरें'), tone: 'action' }] },
        ],
      },
      { icon: PiggyBank, label: t('Save budget', 'Save budget'), tone: 'done' },
      { icon: Target, label: t('Budget against actual', 'बजट बनाम असल'), tone: 'done' },
    ],
    can: [
      t('Keep several budgets a year, each with a name, such as a plan and a stretch plan. One is the year’s default.', 'एक साल के कई बजट रखें, हर एक का नाम, जैसे एक योजना और एक ऊँची योजना। उनमें से एक साल का default होता है।'),
      t('Type amounts by month, quarter, half-year or for the year. A quarter’s amount is split over its months to the paisa, the remainder on the last month.', 'रक़म महीना, तिमाही, छमाही या पूरे साल के हिसाब से भरें। तिमाही की रक़म उसके महीनों में पैसे तक बँटती है, बचा हिस्सा आख़िरी महीने में।'),
      t('Add asset, liability and capital accounts too, planned as their movement.', 'चाहें तो asset, liability और capital अकाउंट भी जोड़ें, उनकी बढ़त-घटत की योजना के रूप में।'),
      t('Start from last year’s figures, raised or cut by a percentage, and see totals for every row and column.', 'पिछले साल के आंकड़ों से शुरू करें, प्रतिशत से बढ़ाकर या घटाकर, और हर पंक्ति और कॉलम का टोटल देखें।'),
      t('Compare any budget with the books in Management Reports, under **Budget against actual**.', 'Management Reports में **Budget against actual** में किसी भी बजट को खातों से मिलाएँ।'),
    ],
    steps: [
      t('Click **New budget**. Give the **Name**, the **Financial year** and the **Budget period**.', '**New budget** दबाएँ। **Name**, **Financial year** और **Budget period** भरें।'),
      t('Under **Accounts**, add income and expense accounts (**All** adds every one). Tick **Include asset, liability and capital accounts** to plan those too.', '**Accounts** में income और expense अकाउंट जोड़ें (**All** से सभी)। उन्हें भी जोड़ना हो तो **Include asset, liability and capital accounts** पर टिक करें।'),
      t('Type the amounts in the grid, or click **Fill from last year** with a percentage. Then **Save budget**.', 'ग्रिड में रक़म भरें, या प्रतिशत के साथ **Fill from last year** दबाएँ। फिर **Save budget**।'),
      t('In the list: **Make default**, **Archive** (and **Restore**), or **Delete**. **Against actual** opens the report for that budget.', 'लिस्ट में: **Make default**, **Archive** (और **Restore**), या **Delete**। **Against actual** उस बजट की रिपोर्ट खोलता है।'),
    ],
    note: t('Budgets never touch the books. A budget kept before named budgets is carried over as “Budget <year>”, that year’s default.', 'बजट से खातों में कुछ नहीं बदलता। नाम वाले बजट से पहले का बजट “Budget <साल>” नाम से, उस साल के default के रूप में आ जाता है।'),
  },

  transactionLocking: {
    section: t('Transaction Locking', 'ट्रांज़ैक्शन लॉकिंग'),
    title: t('Life cycle of a locked period', 'लॉक पीरियड का पूरा सफ़र'),
    flow: [
      { icon: FileText, label: t('Returns filed for the month', 'महीने के रिटर्न फ़ाइल'), tone: 'done' },
      { icon: ClipboardList, label: t('Check what is still open', 'जो खुला है, जाँचें'), tone: 'wait' },
      { icon: Lock, label: t('Lock a module, or the whole books', 'मॉड्यूल या पूरे खाते लॉक'), tone: 'done' },
      {
        branch: [
          { edge: t('Must change', 'बदलना है'), flow: [{ icon: LockOpen, label: t('Unlock, with a reason', 'कारण देकर अनलॉक'), tone: 'neutral' }] },
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
      t('Lock Sales, Purchases, Banking and Accountant separately: nothing in a locked module dated on or before its date can be posted, and nothing posted in it can be reversed.', 'Sales, Purchases, Banking और Accountant अलग-अलग लॉक करें: लॉक मॉड्यूल में उस तारीख़ तक की कोई एंट्री पोस्ट नहीं होती, और पोस्ट हुई रिवर्स नहीं होती।'),
      t('Sales covers invoices, credit notes and customer payments; Purchases covers bills, debit notes, vendor payments and expenses; Banking covers transfers and bank matches; Accountant covers journals, adjustments, depreciation and revaluation.', 'Sales में इनवॉइस, क्रेडिट नोट और ग्राहक पेमेंट; Purchases में बिल, डेबिट नोट, वेंडर पेमेंट और ख़र्च; Banking में ट्रांसफ़र और बैंक मैच; Accountant में जर्नल, एडजस्टमेंट, डेप्रिसिएशन और रीवैल्यूएशन।'),
      t('Lock the whole books through a date too: an entry is refused when either lock covers it.', 'पूरे खाते भी एक तारीख़ तक लॉक करें: किसी भी लॉक में आने वाली एंट्री रुकती है।'),
      t('See a checklist of what is still open: documents to review, unposted invoices and bills, bank lines, depreciation.', 'जो अभी खुला है उसकी लिस्ट देखें: रिव्यू के डॉक्यूमेंट, बिना पोस्ट इनवॉइस और बिल, बैंक लाइनें, डेप्रिसिएशन।'),
      t('Unlock if you must change something; every lock and unlock, with its reason, is in the history.', 'कुछ बदलना ज़रूरी हो तो अनलॉक करें; हर लॉक और अनलॉक, कारण के साथ, इतिहास में दर्ज रहता है।'),
      t('Close the year: income and expenses move to Retained Earnings in one entry dated 31 March.', 'साल बंद करें: income और expense एक एंट्री में, 31 मार्च की तारीख़ से, Retained Earnings में जाते हैं।'),
    ],
    steps: [
      t('On a module’s card, click **Lock**. In the panel, set the **Lock date** and the **Reason**, then click **Lock** with the module’s name.', 'मॉड्यूल के कार्ड पर **Lock** दबाएँ। पैनल में **Lock date** और **Reason** भरें, फिर मॉड्यूल के नाम वाला **Lock** दबाएँ।'),
      t('To lift it, click **Unlock** on the card and say why. **Change date** moves the lock.', 'हटाने के लिए कार्ड पर **Unlock** दबाएँ और कारण बताएँ। **Change date** से लॉक की तारीख़ बदलती है।'),
      t('To lock every module at once, set **Lock through** under **Lock the whole books**, after working through **Still open on or before** the date.', 'सारे मॉड्यूल एक साथ लॉक करने के लिए **Still open on or before** वाली लिस्ट निपटाकर **Lock the whole books** में **Lock through** भरें।'),
      t('**Unlock books** lifts the whole-books lock. **Lock history** shows every change.', '**Unlock books** पूरे खातों का लॉक हटाता है। **Lock history** में हर बदलाव दिखता है।'),
      t('After March’s returns, under **Year-end close**, click **Close FY**. **Reopen FY** reverses it.', 'मार्च के रिटर्न के बाद **Year-end close** में **Close FY** दबाएँ। **Reopen FY** से यह वापस होता है।'),
    ],
    note: t(
      'A lock covers payments, notes and reversals too. Correct a locked entry with a new one dated after the lock, or unlock the module first.',
      'लॉक में पेमेंट, नोट और रिवर्सल भी आते हैं। लॉक हुई एंट्री को लॉक के बाद की तारीख़ वाली नई एंट्री से सुधारें, या पहले मॉड्यूल अनलॉक करें।',
    ),
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
