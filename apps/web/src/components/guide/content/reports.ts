import {
  BarChart3,
  BookOpen,
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
  Search,
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
    section: t('Reports', 'रिपोर्ट'),
    title: t('Where a report’s figures come from', 'रिपोर्ट के आंकड़े कहाँ से आते हैं'),
    flow: [
      { icon: CircleCheck, label: t('Posted entries only', 'सिर्फ़ पोस्ट हुई एंट्री'), tone: 'done' },
      { icon: CalendarClock, label: t('Pick the financial year', 'वित्त वर्ष चुनें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: BarChart3, label: t('P&L, balance sheet, cash flow', 'P&L, बैलेंस शीट, कैश फ़्लो'), tone: 'action' }] },
          { flow: [{ icon: BookOpen, label: t('Trial balance, ledger, day book', 'ट्रायल बैलेंस, लेजर, डे बुक'), tone: 'action' }] },
          { flow: [{ icon: Wallet, label: t('Ageing', 'एजिंग'), tone: 'action' }] },
        ],
      },
      { icon: Download, label: t('Excel, CSV or PDF', 'Excel, CSV या PDF'), tone: 'done' },
    ],
    can: [
      t('Read the P&L, balance sheet, cash flow and trial balance for a financial year.', 'वित्त वर्ष का P&L, बैलेंस शीट, कैश फ़्लो और ट्रायल बैलेंस देखें।'),
      t('Open any account’s ledger, and the day book of every voucher.', 'किसी भी अकाउंट का लेजर, और हर वाउचर की डे बुक खोलें।'),
      t('See ageing: what customers owe you and what you owe vendors, by how late.', 'एजिंग देखें: ग्राहकों पर कितना बाकी और वेंडरों को कितना देना है, कितने दिन से।'),
      t('Download any report as Excel, CSV or PDF.', 'कोई भी रिपोर्ट Excel, CSV या PDF में डाउनलोड करें।'),
    ],
    steps: [
      t('Pick the financial year.', 'वित्त वर्ष चुनें।'),
      t('Choose a report: **P&L**, **Balance Sheet**, **Cash Flow**, **Trial Balance**, **Ledger**, **Day Book** or **Ageing**.', 'रिपोर्ट चुनें: **P&L**, **Balance Sheet**, **Cash Flow**, **Trial Balance**, **Ledger**, **Day Book** या **Ageing**।'),
      t('For **Ledger**, pick the account.', '**Ledger** के लिए अकाउंट चुनें।'),
      t('Download it as **Excel**, **CSV** or **PDF**.', 'इसे **Excel**, **CSV** या **PDF** में डाउनलोड करें।'),
      t('For month-by-month, comparisons and budgets, open **Management reports**.', 'महीने-वार, तुलना और बजट के लिए **Management reports** खोलें।'),
    ],
    note: t('A draft invoice or an entry waiting in Review is not in any report until it is posted.', 'ड्राफ़्ट इनवॉइस या Review में रुकी एंट्री तब तक किसी रिपोर्ट में नहीं आती जब तक वह पोस्ट न हो।'),
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
      t('Compare budgets with actuals.', 'बजट और असल की तुलना करें।'),
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
          { flow: [{ icon: Upload, label: t('Sent to the Inbox', 'Inbox में भेजा'), tone: 'action' }] },
          { flow: [{ icon: Paperclip, label: t('Attached to a record', 'रिकॉर्ड से जुड़ा'), tone: 'action' }] },
        ],
      },
      { icon: FolderOpen, label: t('Listed in Documents', 'Documents में लिस्ट'), tone: 'done' },
      { icon: Search, label: t('Search and filter', 'खोजें और छाँटें'), tone: 'action' },
      {
        branch: [
          { edge: t('Waiting', 'इंतज़ार'), flow: [{ icon: ClipboardCheck, label: t('Review', 'Review'), tone: 'wait' }] },
          { edge: t('Posted', 'पोस्ट'), flow: [{ icon: Receipt, label: t('Open voucher', 'Open voucher'), tone: 'done' }] },
          { edge: t('Attached', 'जुड़ा'), flow: [{ icon: FileText, label: t('Open its record', 'उसका रिकॉर्ड खोलें'), tone: 'action' }] },
        ],
      },
    ],
    can: [
      t('Find every file in the books: bills, invoices, statements and receipts sent to the Inbox, and files attached to records.', 'किताबों की हर फ़ाइल ढूँढें: Inbox में आए बिल, इनवॉइस, स्टेटमेंट और रसीदें, और रिकॉर्ड से जुड़ी फ़ाइलें।'),
      t('Search by file name, party or number, and filter by status or type.', 'फ़ाइल के नाम, पार्टी या नंबर से खोजें, और हालत या प्रकार से छाँटें।'),
      t('Open the file, or jump to where it is used.', 'फ़ाइल खोलें, या सीधे वहाँ जाएँ जहाँ वह इस्तेमाल हुई है।'),
    ],
    steps: [
      t('Type in the search box, or pick a status such as **Ready to review**, **Posted** or **Attached**.', 'सर्च बॉक्स में लिखें, या **Ready to review**, **Posted** या **Attached** जैसी हालत चुनें।'),
      t('Click **Open file** to see it.', 'देखने के लिए **Open file** दबाएँ।'),
      t('Click **Review**, **Open voucher**, or the record link beside it to go where it is used.', 'जहाँ वह इस्तेमाल हुई वहाँ जाने के लिए **Review**, **Open voucher**, या बगल का रिकॉर्ड लिंक दबाएँ।'),
      t('To add new documents, click **Upload in the inbox**.', 'नए डॉक्यूमेंट जोड़ने के लिए **Upload in the inbox** दबाएँ।'),
    ],
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
