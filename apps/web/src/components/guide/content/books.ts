import {
  BadgeCheck,
  CalendarClock,
  CircleCheck,
  CirclePause,
  ClipboardCheck,
  Clock,
  Download,
  FileCheck2,
  FilePen,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  HandCoins,
  Landmark,
  Link2,
  ArrowLeftRight,
  Percent,
  Play,
  Receipt,
  RefreshCw,
  Scale,
  Send,
  Sparkles,
  Square,
  Timer,
  TrendingUp,
  Upload,
  TriangleAlert,
} from 'lucide-react';
import type { AreaKeys } from '../keys';
import { t, type Guide } from '../types';

export const BOOKS_GUIDES: Record<AreaKeys<'books'>, Guide> = {
  projects: {
    section: t('Projects', 'प्रोजेक्ट'),
    title: t('Life cycle of a project', 'प्रोजेक्ट का पूरा सफ़र'),
    flow: [
      { icon: FolderKanban, label: t('New project', 'नया प्रोजेक्ट'), tone: 'action' },
      { icon: Timer, label: t('Log time', 'टाइम लिखें'), tone: 'action' },
      { icon: Clock, label: t('Unbilled time', 'बिना बिल का टाइम'), tone: 'wait' },
      { icon: Sparkles, label: t('Draft invoice from time', 'टाइम से ड्राफ़्ट इनवॉइस'), tone: 'ai', edge: t('AI words the lines', 'AI लाइनें लिखता है') },
      { icon: CircleCheck, label: t('Check and post', 'जाँचें और पोस्ट करें'), tone: 'done' },
      { icon: TrendingUp, label: t('Profit and budget alerts', 'मुनाफ़ा और बजट अलर्ट'), tone: 'done' },
      {
        branch: [
          { edge: t('Pause', 'रोकें'), flow: [{ icon: CirclePause, label: t('Put on hold', 'Put on hold'), tone: 'neutral' }] },
          { edge: t('Finish', 'पूरा'), flow: [{ icon: BadgeCheck, label: t('Mark completed', 'Mark completed'), tone: 'done' }] },
          { edge: t('Again', 'फिर से'), flow: [{ icon: RefreshCw, label: t('Reopen', 'Reopen'), tone: 'action' }] },
        ],
      },
    ],
    can: [
      t(
        'Set up work for a customer, or internal work, billed one of four ways: a fixed fee, by project hours (one rate), by task hours (a rate per task) or by staff hours (a rate per person).',
        'ग्राहक का काम या अंदरूनी काम सेट करें, चार में से एक तरीक़े से बिल करें: तय फ़ीस, प्रोजेक्ट के घंटे (एक रेट), टास्क के घंटे (हर टास्क का रेट) या स्टाफ़ के घंटे (हर व्यक्ति का रेट)।',
      ),
      t('List the people on the project and its tasks; copy tasks from another project with **Import tasks**.', 'प्रोजेक्ट पर काम करने वाले लोग और उसके टास्क लिखें; दूसरे प्रोजेक्ट से टास्क **Import tasks** से कॉपी करें।'),
      t('Set a cost budget, a revenue budget and budgeted hours, and get alerts at 80% and when one is passed.', 'लागत का बजट, आमदनी का बजट और बजट के घंटे तय करें; 80% होने पर और बजट पार होने पर अलर्ट पाएँ।'),
      t('Turn unbilled time into one draft invoice, priced by the billing method; the time is then marked invoiced so it is never billed twice.', 'बिना बिल का टाइम एक ड्राफ़्ट इनवॉइस में बदलें, बिलिंग के तरीक़े के रेट पर; फिर वह टाइम invoiced हो जाता है, ताकि दोबारा बिल न हो।'),
      t('See each project’s income, costs, profit, hours and unbilled time, and put the ones you follow on the dashboard watchlist.', 'हर प्रोजेक्ट की आमदनी, लागत, मुनाफ़ा, घंटे और बिना बिल का टाइम देखें, और जिन पर नज़र रखनी है उन्हें डैशबोर्ड की watchlist में डालें।'),
      t('Tag invoice, bill, expense and journal lines to a project, so they count in its profit.', 'इनवॉइस, बिल, खर्च और जर्नल की लाइनें प्रोजेक्ट से जोड़ें, ताकि वे उसके मुनाफ़े में गिनी जाएँ।'),
    ],
    steps: [
      t('Click **New project**. Fill in the **Project name**, the **Customer name** (or **Internal work**) and the **Billing method**.', '**New project** दबाएँ। **Project name**, **Customer name** (या **Internal work**) और **Billing method** भरें।'),
      t(
        'Enter the rate the method needs: the **Rate per hour** for project hours, a rate on each task for task hours, a rate for each user for staff hours, or the **Fee** for a fixed cost. Under **Invoiced as**, pick the service item.',
        'तरीक़े के हिसाब से रेट भरें: प्रोजेक्ट के घंटों के लिए **Rate per hour**, टास्क के घंटों के लिए हर टास्क पर रेट, स्टाफ़ के घंटों के लिए हर user का रेट, या तय फ़ीस के लिए **Fee**। **Invoiced as** में सर्विस आइटम चुनें।',
      ),
      t(
        'Add the **Budget**, the **Users** (you are on it already) and the **Project tasks**, or **Import tasks** from another project. Tick **Add to the watchlist on my dashboard** to see it first there. Click **Save project**.',
        '**Budget**, **Users** (आप पहले से जुड़े हैं) और **Project tasks** भरें, या दूसरे प्रोजेक्ट से **Import tasks** करें। डैशबोर्ड पर सबसे ऊपर देखने के लिए **Add to the watchlist on my dashboard** पर टिक करें। **Save project** दबाएँ।',
      ),
      t('Everyone logs time to the project’s tasks on **Timesheet**, by hand or with the timer.', 'सब लोग **Timesheet** में प्रोजेक्ट के टास्क पर टाइम लिखते हैं, हाथ से या टाइमर से।'),
      t(
        'Under **Unbilled time**, click **Draft invoice from time**, then **Open the draft invoice**, check it and post it. If a task or person has no rate, the page names them: add the rate first.',
        '**Unbilled time** में **Draft invoice from time** दबाएँ, फिर **Open the draft invoice**, जाँचें और पोस्ट करें। किसी टास्क या व्यक्ति का रेट न हो तो पेज उसका नाम बताता है: पहले रेट भरें।',
      ),
      t('Use **Put on hold**, **Mark completed** or **Reopen** to change its status.', 'हालत बदलने के लिए **Put on hold**, **Mark completed** या **Reopen** दबाएँ।'),
    ],
    note: t('The AI only words the invoice lines from the time notes; you check the draft and post it yourself.', 'AI सिर्फ़ टाइम के नोट्स से इनवॉइस की लाइनें लिखता है; ड्राफ़्ट आप जाँचते और पोस्ट करते हैं।'),
  },

  timesheet: {
    section: t('Timesheet', 'टाइमशीट'),
    title: t('Life cycle of a time entry', 'टाइम एंट्री का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { edge: t('By hand', 'हाथ से'), flow: [{ icon: Timer, label: t('Log time', 'टाइम लिखें'), tone: 'action' }] },
          {
            edge: t('Timer', 'टाइमर'),
            flow: [
              { icon: Play, label: t('Start timer', 'Start timer'), tone: 'action' },
              { icon: Square, label: t('Stop timer', 'Stop timer'), tone: 'action' },
            ],
          },
        ],
      },
      { icon: Clock, label: t('Time entry', 'टाइम एंट्री'), tone: 'neutral' },
      {
        branch: [
          {
            edge: t('Billable', 'बिल होगा'),
            flow: [
              { icon: Clock, label: t('Unbilled', 'बिल बाकी'), tone: 'wait' },
              { icon: FilePen, label: t('On a draft invoice', 'ड्राफ़्ट इनवॉइस पर'), tone: 'wait' },
              { icon: CircleCheck, label: t('Invoiced', 'बिल हो गया'), tone: 'done' },
            ],
          },
          { edge: t('Not billable', 'बिल नहीं'), flow: [{ icon: Clock, label: t('Counts in hours only', 'सिर्फ़ घंटों में गिना'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Log time to a project’s task, as hours and minutes (like 1:30) or as a start and end time.', 'प्रोजेक्ट के टास्क पर टाइम लिखें, घंटे और मिनट में (जैसे 1:30) या शुरू और ख़त्म होने के समय से।'),
      t('Start a timer and stop it when you are done: it keeps running if you reload or leave the page, and logs the minutes.', 'टाइमर चालू करें और काम ख़त्म होने पर रोकें: पेज रीलोड करने या छोड़ने पर भी वह चलता रहता है, और मिनट लिख देता है।'),
      t('Mark time billable if the customer pays for it; it starts as the task says.', 'अगर ग्राहक पैसे देगा तो टाइम को billable रखें; शुरू में वह टास्क की सेटिंग के हिसाब से आता है।'),
      t(
        'View by period (today, this week, this month or dates you pick), customer, project, user and billing, with the hours, billable hours and unbilled amount of what is shown.',
        'अवधि (आज, इस हफ़्ते, इस महीने या चुनी तारीख़ें), ग्राहक, प्रोजेक्ट, user और बिलिंग से छाँटकर देखें, दिखाए गए टाइम के घंटे, billable घंटे और बिना बिल की रक़म के साथ।',
      ),
      t(
        'Change or remove unbilled time: your own, or anyone’s if you manage projects. A manager can also log time for anyone on the project.',
        'बिना बिल का टाइम बदलें या हटाएँ: अपना, या अगर आप प्रोजेक्ट संभालते हैं तो किसी का भी। मैनेजर प्रोजेक्ट पर किसी के लिए भी टाइम लिख सकता है।',
      ),
    ],
    steps: [
      t('Click **Log time** (or press c, then t). The **New log entry** panel opens on the right.', '**Log time** दबाएँ (या c, फिर t दबाएँ)। दाईं ओर **New log entry** पैनल खुलता है।'),
      t('Pick the **Date**, the **Project name** and the **Task name**, or choose **Another task** and type it.', '**Date**, **Project name** और **Task name** चुनें, या **Another task** चुनकर टाइप करें।'),
      t('Enter the **Time spent** as hours and minutes, like 1:30, or click **Set start and end time instead**.', '**Time spent** घंटे और मिनट में भरें, जैसे 1:30, या **Set start and end time instead** दबाएँ।'),
      t(
        'Check **Billable**, write **Notes** on what was done, and click **Save**. Or click **Start timer** to time it now; **Stop timer** at the top of the page logs it.',
        '**Billable** देखें, क्या काम हुआ उसके **Notes** लिखें, और **Save** दबाएँ। या अभी से समय गिनने के लिए **Start timer** दबाएँ; पेज के ऊपर **Stop timer** दबाने पर टाइम लिख जाता है।',
      ),
      t('To change an entry, click **Edit**, then **Save**; or **Remove** it.', 'एंट्री बदलनी हो तो **Edit** दबाएँ, फिर **Save**; या **Remove** दबाएँ।'),
    ],
    note: t(
      'Time is billed from the project’s page with **Draft invoice from time**, at the rate its billing method sets. Good notes make good invoice lines.',
      'टाइम का बिल प्रोजेक्ट के पेज से **Draft invoice from time** दबाकर बनता है, उसके बिलिंग तरीक़े के रेट पर। अच्छे नोट्स से इनवॉइस की लाइनें अच्छी बनती हैं।',
    ),
  },

  banking: {
    section: t('Banking', 'बैंकिंग'),
    title: t('Life cycle of a bank line', 'बैंक लाइन का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: Upload, label: t('Upload statement', 'स्टेटमेंट अपलोड'), tone: 'action' }] },
          { flow: [{ icon: Link2, label: t('Bank feed (AA)', 'बैंक फ़ीड (AA)'), tone: 'action' }] },
        ],
      },
      { icon: Scale, label: t('Run reconciliation', 'Run reconciliation'), tone: 'action' },
      {
        branch: [
          {
            edge: t('Matched', 'मिला'),
            flow: [
              { icon: ClipboardCheck, label: t('Suggested match', 'सुझाया मिलान'), tone: 'wait' },
              { icon: CircleCheck, label: t('Confirm matches: posts', 'Confirm matches: पोस्ट'), tone: 'done' },
            ],
          },
          {
            edge: t('Not matched', 'नहीं मिला'),
            flow: [
              { icon: Sparkles, label: t('Categorise: AI suggests account', 'Categorise: AI अकाउंट सुझाए'), tone: 'ai' },
              { icon: ClipboardCheck, label: t('Approve in Review', 'Review में मंज़ूर'), tone: 'wait' },
            ],
          },
          { edge: t('Own accounts', 'अपने खाते'), flow: [{ icon: ArrowLeftRight, label: t('Transfer', 'ट्रांसफ़र'), tone: 'action' }] },
        ],
      },
      { icon: BadgeCheck, label: t('Reconciled', 'मिलान पूरा'), tone: 'done' },
    ],
    can: [
      t('Upload your statement (PDF, CSV or Excel), or connect your bank through an Account Aggregator for a daily feed.', 'अपना स्टेटमेंट (PDF, CSV या Excel) अपलोड करें, या Account Aggregator से बैंक जोड़कर रोज़ की फ़ीड लें।'),
      t('Match statement lines to invoices, bills and receipts automatically, and confirm them in one click.', 'स्टेटमेंट की लाइनें इनवॉइस, बिल और रसीदों से अपने-आप मिलाएँ, और एक क्लिक में पक्का करें।'),
      t('Settle an invoice or pay a bill from a line by hand, including part payments.', 'किसी लाइन से इनवॉइस या बिल का मिलान ख़ुद करें, आंशिक पेमेंट भी।'),
      t('Send unmatched lines to AI for an account; they wait in Review for you.', 'न मिली लाइनों का अकाउंट AI से सुझवाएँ; वे Review में आपका इंतज़ार करती हैं।'),
      t('Post transfers between your own accounts, cash withdrawals and deposits, and payment-gateway settlements.', 'अपने खातों के बीच ट्रांसफ़र, कैश निकालना-जमा करना, और पेमेंट गेटवे का सेटलमेंट पोस्ट करें।'),
    ],
    steps: [
      t('Click **Upload statement**, or **Connect a bank**, enter your AA handle and click **Ask for consent**.', '**Upload statement** दबाएँ, या **Connect a bank** दबाकर AA हैंडल भरें और **Ask for consent** दबाएँ।'),
      t('Click **Run reconciliation**, check the suggestions, then **Confirm N matches**.', '**Run reconciliation** दबाएँ, सुझाव जाँचें, फिर **Confirm N matches**।'),
      t('For a line not in the books, use **Settles invoice…** or **Pays bill…**, or **Categorise N unmatched** to send them to Review.', 'जो लाइन खातों में नहीं, उसके लिए **Settles invoice…** या **Pays bill…** चुनें, या **Categorise N unmatched** से Review में भेजें।'),
      t('Use **Set aside** for a line to deal with later, and **Not a duplicate** to clear a duplicate flag.', 'बाद में देखने वाली लाइन के लिए **Set aside**, और डुप्लिकेट का निशान हटाने के लिए **Not a duplicate** दबाएँ।'),
      t('For money between your own accounts, use **Move money** and **Post transfer**, or **Pair as transfer** on a suggested pair.', 'अपने ही खातों के बीच पैसे के लिए **Move money** और **Post transfer**, या सुझाए जोड़े पर **Pair as transfer** दबाएँ।'),
    ],
    note: t('When the books agree with the bank, the page says **Reconciled**.', 'जब खाते और बैंक बराबर हों, पेज पर **Reconciled** लिखा आता है।'),
  },

  gst: {
    section: t('GST', 'GST'),
    title: t('Life cycle of a GST month', 'GST के एक महीने का सफ़र'),
    flow: [
      { icon: FileText, label: t('Post invoices and bills', 'इनवॉइस और बिल पोस्ट'), tone: 'action' },
      { icon: Upload, label: t('Import GSTR-2B', 'GSTR-2B इम्पोर्ट'), tone: 'action' },
      { icon: Scale, label: t('Run reconciliation', 'Run reconciliation'), tone: 'action' },
      {
        branch: [
          { edge: t('Matches', 'मेल खाता'), flow: [{ icon: CircleCheck, label: t('Credit confirmed', 'क्रेडिट पक्का'), tone: 'done' }] },
          {
            edge: t('Does not match', 'मेल नहीं'),
            flow: [
              { icon: TriangleAlert, label: t('What doesn’t match, and why', 'क्या मेल नहीं, और क्यों'), tone: 'wait' },
              { icon: Send, label: t('Message vendor or create entry', 'वेंडर को मैसेज या एंट्री'), tone: 'action' },
            ],
          },
        ],
      },
      { icon: FileCheck2, label: t('File GSTR-1 (by the 11th)', 'GSTR-1 फ़ाइल (11 तारीख़ तक)'), tone: 'action' },
      { icon: FileCheck2, label: t('File GSTR-3B (by the 20th)', 'GSTR-3B फ़ाइल (20 तारीख़ तक)'), tone: 'action' },
      { icon: HandCoins, label: t('Record GST payment', 'Record GST payment'), tone: 'done' },
    ],
    can: [
      t('Reconcile your bills with GSTR-2B: every difference is explained in plain words, with what to do.', 'अपने बिल GSTR-2B से मिलाएँ: हर फ़र्क़ सीधे शब्दों में समझाया जाता है, और क्या करना है वह भी।'),
      t('Check GSTR-1 for what the portal would refuse, then file it with an OTP, or download the JSON.', 'GSTR-1 में देखें कि पोर्टल क्या रिजेक्ट करेगा, फिर OTP से फ़ाइल करें, या JSON डाउनलोड करें।'),
      t('File GSTR-3B, with the tax to pay in cash after input credit.', 'GSTR-3B फ़ाइल करें, input credit के बाद कैश में देने वाले टैक्स के साथ।'),
      t('Post the month’s GST set-off and cash payment as one voucher.', 'महीने का GST set-off और कैश पेमेंट एक वाउचर में पोस्ट करें।'),
      t('See the purchase and sales registers, the summary, bills near 180 days unpaid, and the yearly GSTR-9.', 'ख़रीद और बिक्री रजिस्टर, सारांश, 180 दिन के क़रीब बिना पेमेंट वाले बिल, और सालाना GSTR-9 देखें।'),
    ],
    steps: [
      t('Pick the month at the top. On **2A/2B reconciliation**, click **Import GSTR-2B**, then **Run reconciliation**.', 'ऊपर महीना चुनें। **2A/2B reconciliation** में **Import GSTR-2B** दबाएँ, फिर **Run reconciliation**।'),
      t('Work through **What doesn’t match, and why**: **Copy message for vendor**, or **Create entry** for a 2B invoice missing from your books (it goes to Review).', '**What doesn’t match, and why** पर काम करें: **Copy message for vendor**, या आपके खातों में न दिखे 2B इनवॉइस के लिए **Create entry** (यह Review में जाता है)।'),
      t('On **GSTR-1 / 3B**, fix anything under **Fix before filing**, then **Save to GST portal**, **Send OTP**, enter the OTP and click **File GSTR-1**.', '**GSTR-1 / 3B** में **Fix before filing** वाली चीज़ें ठीक करें, फिर **Save to GST portal**, **Send OTP**, OTP भरें और **File GSTR-1** दबाएँ।'),
      t('File GSTR-3B the same way, once GSTR-1 is filed.', 'GSTR-1 फ़ाइल होने के बाद GSTR-3B भी इसी तरह फ़ाइल करें।'),
      t('Enter the challan CPIN and click **Record GST payment**.', 'चालान का CPIN भरें और **Record GST payment** दबाएँ।'),
    ],
    note: t('Filing cannot be undone. If the books change after you saved a return, save it again before filing.', 'फ़ाइल किया रिटर्न वापस नहीं होता। सेव करने के बाद खाते बदलें, तो फ़ाइल करने से पहले फिर से सेव करें।'),
  },

  tds: {
    section: t('TDS', 'TDS'),
    title: t('Life cycle of TDS', 'TDS का पूरा सफ़र'),
    flow: [
      { icon: Percent, label: t('Vendor has a TDS section', 'वेंडर का TDS सेक्शन'), tone: 'action' },
      { icon: Receipt, label: t('Deducted when the bill posts', 'बिल पोस्ट होते ही कटा'), tone: 'done' },
      { icon: CalendarClock, label: t('To deposit, by the 7th', 'जमा करना है, 7 तारीख़ तक'), tone: 'wait' },
      { icon: Landmark, label: t('Pay challan on the portal', 'पोर्टल पर चालान भरें'), tone: 'action' },
      {
        branch: [
          { edge: t('On time', 'समय पर'), flow: [{ icon: CircleCheck, label: t('Record deposit: posts', 'Record deposit: पोस्ट'), tone: 'done' }] },
          { edge: t('Late', 'देर'), flow: [{ icon: TriangleAlert, label: t('Overdue: interest 1.5% a month', 'ओवरड्यू: 1.5% महीना ब्याज'), tone: 'error' }] },
        ],
      },
      { icon: Download, label: t('Download 26Q each quarter', 'हर तिमाही 26Q डाउनलोड'), tone: 'action' },
      { icon: FileSpreadsheet, label: t('Match with Form 26AS', 'Form 26AS से मिलान'), tone: 'action' },
    ],
    can: [
      t('See TDS deducted from each vendor’s bill, and vendors without a PAN flagged.', 'हर वेंडर के बिल से कटा TDS देखें, और बिना PAN वाले वेंडर अलग दिखते हैं।'),
      t('See what is due to deposit, by month and section, and record each challan.', 'महीने और सेक्शन के हिसाब से जमा करने वाला TDS देखें, और हर चालान दर्ज करें।'),
      t('Download Form 26Q for the quarter as CSV, to key into the RPU.', 'तिमाही का Form 26Q CSV में डाउनलोड करें, ताकि RPU में भर सकें।'),
      t('See TDS your customers deducted from you, and match it with Form 26AS.', 'ग्राहकों ने आपके पेमेंट से जो TDS काटा, वह देखें और Form 26AS से मिलाएँ।'),
    ],
    steps: [
      t('Set a TDS section on the vendor. Their bills then deduct TDS when posted.', 'वेंडर पर TDS सेक्शन चुनें। फिर उनके बिल पोस्ट होते समय TDS कटता है।'),
      t('Pick the financial year. Under **To deposit**, pay the challan on the income-tax portal first.', 'वित्त वर्ष चुनें। **To deposit** में देखें, और पहले इनकम-टैक्स पोर्टल पर चालान भरें।'),
      t('Click **Record deposit**, enter the date and the challan number (CIN), then **Record deposit of ₹X**.', '**Record deposit** दबाएँ, तारीख़ और चालान नंबर (CIN) भरें, फिर **Record deposit of ₹X** दबाएँ।'),
      t('Each quarter, pick the quarter and click **Download 26Q (CSV)**. Fix anything in red, then file it through the RPU.', 'हर तिमाही, तिमाही चुनें और **Download 26Q (CSV)** दबाएँ। लाल में दिखी ग़लतियाँ ठीक करें, फिर RPU से फ़ाइल करें।'),
      t('Save Part I of your 26AS as CSV and click **Choose 26AS CSV** to match it.', '26AS का Part I CSV में सेव करें और मिलान के लिए **Choose 26AS CSV** दबाएँ।'),
    ],
    note: t('TDS customers deducted is entered when you record their receipt. Form 27Q is not available yet.', 'ग्राहकों का काटा TDS उनकी रसीद दर्ज करते समय भरा जाता है। Form 27Q अभी उपलब्ध नहीं है।'),
  },
};
