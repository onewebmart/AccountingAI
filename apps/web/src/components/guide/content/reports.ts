import {
  BarChart3,
  Building2,
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  Download,
  Eye,
  FileText,
  Filter,
  FolderOpen,
  History,
  LineChart,
  Mail,
  MessageSquareText,
  Paperclip,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Wallet,
  Lightbulb,
} from 'lucide-react';
import type { AreaKeys } from '../keys';
import { t, type Guide } from '../types';

export const REPORT_GUIDES: Record<AreaKeys<'reports'>, Guide> = {
  reports: {
    section: t('Reports Center', 'रिपोर्ट सेंटर'),
    title: t('Finding, reading and making a report', 'रिपोर्ट ढूँढना, पढ़ना और बनाना'),
    flow: [
      { icon: CircleCheck, label: t('Posted entries only', 'सिर्फ़ पोस्ट हुई एंट्री'), tone: 'done' },
      { icon: Filter, label: t('Pick a category or search', 'कैटेगरी चुनें या खोजें'), tone: 'action' },
      { icon: CalendarClock, label: t('Set the period and filters', 'अवधि और फ़िल्टर चुनें'), tone: 'action' },
      {
        branch: [
          { edge: t('Read', 'पढ़ें'), flow: [{ icon: Download, label: t('PDF, CSV or Excel', 'PDF, CSV या Excel'), tone: 'done' }] },
          { edge: t('Send', 'भेजें'), flow: [{ icon: Mail, label: t('Schedule', 'Schedule'), tone: 'action' }] },
          { edge: t('Make your own', 'अपनी बनाएँ'), flow: [{ icon: BarChart3, label: t('Create New Report', 'Create New Report'), tone: 'action' }] },
        ],
      },
    ],
    can: [
      t('Open any of nearly ninety reports, by category: Business Overview, Sales, Receivables, Payments Received, Recurring Invoices, Payables, Purchases and Expenses, Taxes, Banking, Projects and Timesheet, Inventory, Accountant, Budgets, Currency, Activity and Automation.', 'कैटेगरी के हिसाब से लगभग नब्बे रिपोर्ट खोलें: Business Overview, Sales, Receivables, Payments Received, Recurring Invoices, Payables, Purchases and Expenses, Taxes, Banking, Projects and Timesheet, Inventory, Accountant, Budgets, Currency, Activity और Automation।'),
      t('Read the P&L and balance sheet in the Schedule III format, side by side (horizontal), the cash flow statement, business ratios and movement of equity.', 'P&L और बैलेंस शीट Schedule III फ़ॉर्मेट में, आमने-सामने (horizontal), कैश फ़्लो स्टेटमेंट, बिज़नेस रेशियो और इक्विटी का मूवमेंट देखें।'),
      t('Star the reports you use (**Favorites**); **Last visited** shows when you last opened each. Both are yours alone.', 'जो रिपोर्ट आप इस्तेमाल करते हैं उन्हें स्टार करें (**Favorites**); **Last visited** बताता है आपने हर रिपोर्ट आख़िरी बार कब खोली। दोनों सिर्फ़ आपके हैं।'),
      t('Download any report as PDF, CSV or Excel, or email it on a schedule (**Scheduled Reports** lists them).', 'कोई भी रिपोर्ट PDF, CSV या Excel में डाउनलोड करें, या तय समय पर ईमेल करें (**Scheduled Reports** में सब दिखते हैं)।'),
      t('Make your own report from an existing one, or an entirely new one from invoices, bills, expenses, payments, journal lines, items, customers, vendors or time. Keep it under **My Reports**, or share it with the organisation (**Shared Reports**).', 'किसी मौजूदा रिपोर्ट से अपनी रिपोर्ट बनाएँ, या इनवॉइस, बिल, खर्च, पेमेंट, जर्नल लाइन, आइटम, ग्राहक, वेंडर या समय से बिल्कुल नई। उसे **My Reports** में रखें, या संगठन के साथ शेयर करें (**Shared Reports**)।'),
    ],
    steps: [
      t('Pick a category on the left, or type in **Search reports**. Click a report’s name to open it.', 'बाईं ओर कैटेगरी चुनें, या **Search reports** में लिखें। रिपोर्ट खोलने के लिए उसके नाम पर क्लिक करें।'),
      t('Set the period (months, a year, a date or a quarter) and any filter, such as a customer or an account.', 'अवधि चुनें (महीने, साल, तारीख़ या तिमाही) और कोई फ़िल्टर, जैसे ग्राहक या अकाउंट।'),
      t('Download it with **PDF**, **CSV** or **Excel**. To email it regularly, click **Schedule**: the period, how often, and up to ten addresses.', '**PDF**, **CSV** या **Excel** से डाउनलोड करें। इसे नियमित ईमेल करने के लिए **Schedule** दबाएँ: अवधि, कितनी बार, और दस पतों तक।'),
      t('To make it your own, click **Customize** (or **Create New Report** → **Create from existing report** → **Proceed**): choose the columns and their order, the period, the filters, conditions on rows, grouping and sorting. Name it and click **Save report**.', 'इसे अपना बनाने के लिए **Customize** दबाएँ (या **Create New Report** → **Create from existing report** → **Proceed**): कॉलम और उनका क्रम, अवधि, फ़िल्टर, पंक्तियों की शर्तें, ग्रुपिंग और सॉर्टिंग चुनें। नाम दें और **Save report** दबाएँ।'),
      t('For a report from scratch, choose **Create an entirely new report**, pick a module, its fields and conditions, group by a field with totals, and sort. **Preview report** shows it before you save.', 'बिल्कुल नई रिपोर्ट के लिए **Create an entirely new report** चुनें, मॉड्यूल, उसके फ़ील्ड और शर्तें चुनें, किसी फ़ील्ड से टोटल के साथ ग्रुप करें, और सॉर्ट करें। सेव करने से पहले **Preview report** से देखें।'),
      t('The classic year view with charts is under **Statements with charts**; month-by-month, budgets and Ask your books are in **Management reports**.', 'चार्ट वाला पुराना साल-वार व्यू **Statements with charts** में है; महीने-वार, बजट और Ask your books **Management reports** में हैं।'),
    ],
    note: t('A draft invoice or an entry waiting in Review is not in any report until it is posted. A custom report saves only its design: it reads the books afresh every time, and only its maker can change it.', 'ड्राफ़्ट इनवॉइस या Review में रुकी एंट्री तब तक किसी रिपोर्ट में नहीं आती जब तक वह पोस्ट न हो। कस्टम रिपोर्ट सिर्फ़ अपना डिज़ाइन सेव करती है: हर बार किताबें नए सिरे से पढ़ती है, और उसे सिर्फ़ बनाने वाला बदल सकता है।'),
  },

  managementReports: {
    section: t('Management Reports', 'मैनेजमेंट रिपोर्ट'),
    title: t('Life cycle of a management report', 'मैनेजमेंट रिपोर्ट का पूरा सफ़र'),
    flow: [
      { icon: BarChart3, label: t('Pick a report and period', 'रिपोर्ट और अवधि चुनें'), tone: 'action' },
      {
        branch: [
          { edge: t('Read', 'पढ़ें'), flow: [{ icon: Download, label: t('PDF or CSV', 'PDF या CSV'), tone: 'done' }] },
          {
            edge: t('Send', 'भेजें'),
            flow: [
              { icon: CalendarClock, label: t('Schedule email', 'Schedule email'), tone: 'action' },
              { icon: Mail, label: t('Emailed as PDF', 'PDF ईमेल हुआ'), tone: 'done' },
            ],
          },
          { edge: t('Ask', 'पूछें'), flow: [{ icon: Sparkles, label: t('Ask your books', 'अपनी किताबों से पूछें'), tone: 'ai' }] },
        ],
      },
    ],
    can: [
      t('See profit by month, compared with the period before and last year, expenses by category, and profit by project.', 'महीने-वार मुनाफ़ा, पिछली अवधि और पिछले साल से तुलना, कैटेगरी-वार खर्च, और प्रोजेक्ट-वार मुनाफ़ा देखें।'),
      t('See sales and purchases by customer, vendor, item and month, and how long each party takes to pay.', 'ग्राहक, वेंडर, आइटम और महीने के हिसाब से बिक्री-ख़रीद देखें, और हर पार्टी कितने दिन में पेमेंट करती है।'),
      t('Compare a budget with actuals: under **Budget against actual**, pick the year and the **Budget** (the year’s default unless you pick another).', 'बजट और असल की तुलना करें: **Budget against actual** में साल और **Budget** चुनें (कोई और न चुनें तो साल का default)।'),
      t('Email any report as a PDF on a schedule, to up to ten addresses.', 'कोई भी रिपोर्ट तय समय पर PDF में ईमेल करें, दस पतों तक।'),
      t('Ask a question in plain words, and read the month in words, from the books.', 'सीधे शब्दों में सवाल पूछें, और किताबों से महीने का सार पढ़ें।'),
    ],
    steps: [
      t('On the **Reports** tab, pick a report, then the months or year.', '**Reports** टैब में रिपोर्ट चुनें, फिर महीने या साल।'),
      t('Download it as **PDF** or **CSV**.', 'इसे **PDF** या **CSV** में डाउनलोड करें।'),
      t('On **Scheduled emails**, click **Schedule email**: the report, the period, how often, and the email addresses. **Send now** checks it.', '**Scheduled emails** में **Schedule email** दबाएँ: रिपोर्ट, अवधि, कितनी बार, और ईमेल पते। **Send now** से जाँचें।'),
      t('Under **The month in words**, pick a month and click **Write the summary**.', '**The month in words** में महीना चुनें और **Write the summary** दबाएँ।'),
    ],
    note: t('AI answers are marked and every figure in them is checked against the report. They only read your books; they change nothing.', 'AI के जवाब अलग से चिह्नित होते हैं और उनका हर आंकड़ा रिपोर्ट से जाँचा जाता है। वे सिर्फ़ किताबें पढ़ते हैं, कुछ बदलते नहीं।'),
  },

  insights: {
    section: t('Insights', 'इनसाइट्स'),
    title: t('How insights are made', 'इनसाइट्स कैसे बनती हैं'),
    flow: [
      { icon: CircleCheck, label: t('Posted books', 'पोस्ट हुई किताबें'), tone: 'done' },
      { icon: Sparkles, label: t('AI reads the trends', 'AI रुझान पढ़ता है'), tone: 'ai' },
      {
        branch: [
          { flow: [{ icon: LineChart, label: t('13-week cash forecast', '13 हफ़्ते का कैश अनुमान'), tone: 'wait' }] },
          { flow: [{ icon: TrendingUp, label: t('Profit outlook', 'मुनाफ़े का अनुमान'), tone: 'wait' }] },
          { flow: [{ icon: Lightbulb, label: t('Cards worth a look', 'ध्यान देने लायक़ बातें'), tone: 'wait' }] },
        ],
      },
      { icon: Eye, label: t('You decide what to do', 'क्या करना है, आप तय करें'), tone: 'action' },
    ],
    can: [
      t('See a 13-week cash forecast, with a warning if cash runs short.', '13 हफ़्ते का कैश अनुमान देखें, कैश कम पड़ने पर चेतावनी के साथ।'),
      t('See a profit outlook from what has been posted so far.', 'अब तक पोस्ट हुई एंट्री से मुनाफ़े का अनुमान देखें।'),
      t('Read cards on things worth a look, marked by how urgent they are.', 'ध्यान देने लायक़ बातों के कार्ड पढ़ें, ज़रूरत के हिसाब से चिह्नित।'),
    ],
    steps: [
      t('Post your entries first; insights appear as you post more.', 'पहले अपनी एंट्री पोस्ट करें; जितना पोस्ट करेंगे, उतनी इनसाइट्स दिखेंगी।'),
      t('Read the forecast chart week by week.', 'अनुमान का चार्ट हफ़्ते-दर-हफ़्ते पढ़ें।'),
      t('Open a card for the detail, and act on it from the right page.', 'जानकारी के लिए कार्ड खोलें, और सही पेज पर जाकर कदम उठाएँ।'),
    ],
    note: t('It is a projection, not a promise, and it changes nothing in the books.', 'यह सिर्फ़ अनुमान है, वादा नहीं, और इससे खातों में कुछ नहीं बदलता।'),
  },

  audit: {
    section: t('Audit Trail', 'ऑडिट ट्रेल'),
    title: t('How a change is recorded', 'हर बदलाव कैसे दर्ज होता है'),
    flow: [
      { icon: FileText, label: t('Someone changes a record', 'कोई रिकॉर्ड बदलता है'), tone: 'action' },
      { icon: History, label: t('Logged: who, when, before, after', 'दर्ज: कौन, कब, पहले, बाद'), tone: 'done' },
      { icon: Filter, label: t('Filter by record, person, action, date', 'रिकॉर्ड, व्यक्ति, काम, तारीख़ से छाँटें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: Eye, label: t('Open a row: before and after', 'लाइन खोलें: पहले और बाद'), tone: 'action' }] },
          { flow: [{ icon: History, label: t('A record’s whole history', 'रिकॉर्ड का पूरा इतिहास'), tone: 'action' }] },
        ],
      },
      { icon: ShieldCheck, label: t('Never edited or deleted', 'कभी बदला या मिटाया नहीं जाता'), tone: 'done' },
    ],
    can: [
      t('See every change to your books: who made it, when, and what it was before.', 'किताबों में हर बदलाव देखें: किसने किया, कब, और पहले क्या था।'),
      t('Filter by record, person, action and date.', 'रिकॉर्ड, व्यक्ति, काम और तारीख़ से छाँटें।'),
      t('Open a change to compare before and after, or a record to see its whole history.', 'किसी बदलाव को खोलकर पहले और बाद की तुलना करें, या रिकॉर्ड का पूरा इतिहास देखें।'),
      t('Rely on it: nothing here can be edited or deleted.', 'इस पर भरोसा करें: यहाँ कुछ भी बदला या मिटाया नहीं जा सकता।'),
    ],
    steps: [
      t('Pick a **Record** type, a **Person**, an **Action** or dates to narrow the list.', 'लिस्ट छोटी करने के लिए **Record** का प्रकार, **Person**, **Action** या तारीख़ चुनें।'),
      t('Click a row to see the fields before and after.', 'पहले और बाद के फ़ील्ड देखने के लिए लाइन पर क्लिक करें।'),
      t('Click the record’s name in the **Record** column to see every change to that record.', '**Record** कॉलम में रिकॉर्ड के नाम पर क्लिक करें, उस रिकॉर्ड का हर बदलाव दिखेगा।'),
      t('Click **Show older changes** to go further back.', 'और पुराने बदलाव देखने के लिए **Show older changes** दबाएँ।'),
    ],
    note: t('Each invoice, bill and party also has a **History** link to its own trail.', 'हर इनवॉइस, बिल और पार्टी के पेज पर भी उसके अपने इतिहास का **History** लिंक है।'),
  },

  documents: {
    section: t('Documents', 'डॉक्यूमेंट'),
    title: t('Where every file lives', 'हर फ़ाइल कहाँ रहती है'),
    flow: [
      {
        branch: [
          { flow: [{ icon: Upload, label: t('Uploaded or sent in', 'अपलोड किया या भेजा'), tone: 'action' }] },
          { flow: [{ icon: Paperclip, label: t('Attached to a record', 'रिकॉर्ड से जुड़ा'), tone: 'action' }] },
        ],
      },
      { icon: FolderOpen, label: t('All Documents', 'All Documents'), tone: 'action' },
      {
        branch: [
          { edge: t('Waiting', 'इंतज़ार'), flow: [{ icon: ClipboardCheck, label: t('Review or Add to', 'Review या Add to'), tone: 'wait' }] },
          { edge: t('Statement', 'स्टेटमेंट'), flow: [{ icon: Wallet, label: t('Bank reconciliation', 'बैंक मिलान'), tone: 'wait' }] },
          { edge: t('Done', 'हो गया'), flow: [{ icon: Receipt, label: t('Bill, expense or voucher', 'बिल, खर्च या वाउचर'), tone: 'done' }] },
        ],
      },
      { icon: Filter, label: t('Filed in a folder, if you like', 'चाहें तो फ़ोल्डर में रखें'), tone: 'action' },
    ],
    can: [
      t('See every file in one list: uploads and files kept against records, with who brought each in, when, and what it became (**Associated to**).', 'हर फ़ाइल एक लिस्ट में देखें: अपलोड और रिकॉर्ड से जुड़ी फ़ाइलें, किसने और कब लाई, और वह क्या बनी (**Associated to**)।'),
      t('Filter by file type or status, and search by file name, party, number or record.', 'फ़ाइल के प्रकार या हालत से छाँटें, और फ़ाइल के नाम, पार्टी, नंबर या रिकॉर्ड से खोजें।'),
      t('File documents in folders: make, rename and delete folders in the panel on the left.', 'डॉक्यूमेंट फ़ोल्डर में रखें: बाईं पट्टी में फ़ोल्डर बनाएँ, नाम बदलें और हटाएँ।'),
      t('See the bank statements that came in under **Bank Statements**: the account, the period, and how many lines are matched.', '**Bank Statements** में आए बैंक स्टेटमेंट देखें: खाता, अवधि, और कितनी लाइनें मिल चुकी हैं।'),
      t('Enter a document yourself with **Add to**, or read it again with **Try again** when it could not be read.', '**Add to** से डॉक्यूमेंट ख़ुद दर्ज करें, या न पढ़ा गया हो तो **Try again** से दोबारा पढ़वाएँ।'),
    ],
    steps: [
      t('Click a file name to open the file. Click the link under **Associated to** to open what it became: the bill, expense or voucher, or the statement’s reconciliation.', 'फ़ाइल खोलने के लिए उसके नाम पर क्लिक करें। **Associated to** का लिंक दबाएँ, वह खुलेगा जो यह बनी: बिल, खर्च या वाउचर, या स्टेटमेंट का मिलान।'),
      t('Pick a type in **Filter by file type**, or a status such as **Not entered yet** or **Couldn’t read**. Click **Uploaded on** to show the oldest first.', '**Filter by file type** में प्रकार चुनें, या **Not entered yet** या **Couldn’t read** जैसी हालत। पुरानी फ़ाइलें पहले देखने के लिए **Uploaded on** दबाएँ।'),
      t('To make a folder, click **+** beside **Folders**, type the name and click **Create folder**. Point at a folder to rename or delete it; deleting moves its files to no folder.', 'फ़ोल्डर बनाने के लिए **Folders** के बगल में **+** दबाएँ, नाम लिखें और **Create folder** दबाएँ। नाम बदलने या हटाने के लिए फ़ोल्डर पर पॉइंटर ले जाएँ; हटाने पर उसकी फ़ाइलें बिना फ़ोल्डर के हो जाती हैं।'),
      t('To file one document, use its **Folder** menu. To file several, tick them, choose a folder under **Move to** and click **Move**.', 'एक डॉक्यूमेंट रखने के लिए उसका **Folder** मेन्यू इस्तेमाल करें। कई रखने हों तो उन्हें टिक करें, **Move to** में फ़ोल्डर चुनें और **Move** दबाएँ।'),
      t('Click **Upload file** to add documents. Inside a folder, they are filed there.', 'डॉक्यूमेंट जोड़ने के लिए **Upload file** दबाएँ। किसी फ़ोल्डर के अंदर हों तो वे उसी में रखे जाते हैं।'),
    ],
    note: t('Folders only group files. Filing a document changes nothing in the books, and every move is in the audit trail.', 'फ़ोल्डर सिर्फ़ फ़ाइलें समूह में रखते हैं। फ़ाइल रखने से किताबों में कुछ नहीं बदलता, और हर बदलाव ऑडिट ट्रेल में दर्ज होता है।'),
  },

  settings: {
    section: t('Settings', 'सेटिंग्स'),
    title: t('Setting up your business', 'अपना बिज़नेस सेट करें'),
    flow: [
      { icon: Building2, label: t('General: name, address, bank', 'General: नाम, पता, बैंक'), tone: 'action' },
      { icon: Receipt, label: t('Tax & GST: GSTIN, PAN, TAN', 'Tax & GST: GSTIN, PAN, TAN'), tone: 'action' },
      { icon: UserPlus, label: t('Team & roles: add members', 'Team & roles: लोग जोड़ें'), tone: 'action' },
      { icon: Users, label: t('Roles decide who can post', 'रोल तय करते हैं कौन पोस्ट करे'), tone: 'done' },
      { icon: MessageSquareText, label: t('Integrations, template, branding: preview', 'Integrations, template, branding: झलक'), tone: 'neutral' },
    ],
    can: [
      t('Set the company name, address, city and pincode (a tax invoice needs the address; e-invoices need the pincode).', 'कंपनी का नाम, पता, शहर और पिनकोड भरें (टैक्स इनवॉइस पर पता ज़रूरी है; ई-इनवॉइस के लिए पिनकोड)।'),
      t('Add bank or UPI details printed on every invoice.', 'हर इनवॉइस पर छपने वाली बैंक या UPI जानकारी भरें।'),
      t('Enter your GSTIN (the state fills in), PAN, TAN and GST filing frequency.', 'अपना GSTIN (राज्य अपने-आप भरता है), PAN, TAN और GST फ़ाइलिंग की अवधि भरें।'),
      t('Add team members with a role: Company admin, Accountant, CA reviewer, Employee or Auditor.', 'टीम के लोगों को रोल के साथ जोड़ें: Company admin, Accountant, CA reviewer, Employee या Auditor।'),
    ],
    steps: [
      t('On **General**, fill in the business details and **Printed on every invoice**, then **Save changes**.', '**General** में बिज़नेस की जानकारी और **Printed on every invoice** भरें, फिर **Save changes** दबाएँ।'),
      t('On **Tax & GST**, enter the GSTIN, PAN, TAN and filing frequency, then **Save changes**.', '**Tax & GST** में GSTIN, PAN, TAN और फ़ाइलिंग की अवधि भरें, फिर **Save changes** दबाएँ।'),
      t('On **Team & roles**, click **Add member**, enter their email, pick a role and click **Add**. They must sign up first; no invitation email is sent.', '**Team & roles** में **Add member** दबाएँ, उनका ईमेल भरें, रोल चुनें और **Add** दबाएँ। उन्हें पहले साइन अप करना होगा; कोई निमंत्रण ईमेल नहीं जाता।'),
    ],
    note: t('**Integrations** and **Branding** here are previews and do not save; **Invoice template** is coming. Firm branding works in **Firm & branding**.', 'यहाँ **Integrations** और **Branding** सिर्फ़ झलक हैं, सेव नहीं होते; **Invoice template** जल्द आएगा। फ़र्म की ब्रांडिंग **Firm & branding** में काम करती है।'),
  },
};
