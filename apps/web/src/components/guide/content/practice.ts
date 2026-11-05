import {
  BadgeCheck,
  BarChart3,
  BellRing,
  Bot,
  Briefcase,
  CalendarClock,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FilePlus2,
  FileText,
  Gavel,
  Globe,
  HandCoins,
  Inbox,
  LayoutDashboard,
  ListTodo,
  MessageCircle,
  Palette,
  RefreshCw,
  Send,
  Sparkles,
  TriangleAlert,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Hourglass,
  Ban,
  Target,
} from 'lucide-react';
import type { AreaKeys } from '../keys';
import { t, type Guide } from '../types';

export const PRACTICE_GUIDES: Record<AreaKeys<'practice'>, Guide> = {
  practiceHome: {
    section: t('Practice home', 'प्रैक्टिस होम'),
    title: t('How your practice runs', 'आपकी प्रैक्टिस कैसे चलती है'),
    flow: [
      { icon: Briefcase, label: t('Set up practice', 'प्रैक्टिस सेट करें'), tone: 'action' },
      { icon: UserPlus, label: t('Add clients and services', 'क्लाइंट और सर्विस जोड़ें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: CalendarClock, label: t('Deadlines', 'डेडलाइन'), tone: 'wait' }] },
          { flow: [{ icon: ClipboardList, label: t('Documents to collect', 'जमा करने वाले डॉक्यूमेंट'), tone: 'wait' }] },
          { flow: [{ icon: HandCoins, label: t('Fees to collect', 'वसूलनी फ़ीस'), tone: 'wait' }] },
        ],
      },
      { icon: LayoutDashboard, label: t('Practice home: where you stand', 'प्रैक्टिस होम: आज की हालत'), tone: 'done' },
    ],
    can: [
      t('See your clients, pending deadlines, fees collected and outstanding, at a glance.', 'अपने क्लाइंट, बाकी डेडलाइन, वसूली और बकाया फ़ीस एक नज़र में देखें।'),
      t('See upcoming compliance deadlines, documents still missing, leads and recent activity.', 'आने वाली कंप्लायंस डेडलाइन, बाकी डॉक्यूमेंट, लीड और हाल की गतिविधि देखें।'),
      t('See what waits on you: the support agent’s hand-offs and documents to check.', 'देखें आपके लिए क्या रुका है: सपोर्ट एजेंट के सौंपे सवाल और जाँचने वाले डॉक्यूमेंट।'),
      t('Click any tile to go straight to that work.', 'किसी भी टाइल पर क्लिक करके सीधे उस काम पर जाएँ।'),
    ],
    steps: [
      t('No firm yet? Enter your practice name and click **Set up**, then sign in again.', 'फ़र्म नहीं बनी? अपनी प्रैक्टिस का नाम भरें और **Set up** दबाएँ, फिर दोबारा साइन इन करें।'),
      t('The Practice, Growth & fees and Firm groups then appear in the sidebar.', 'फिर साइडबार में Practice, Growth & fees और Firm ग्रुप दिखेंगे।'),
      t('Add your clients on **Clients**, with the services you handle for them.', '**Clients** में अपने क्लाइंट जोड़ें, उनकी सर्विस के साथ।'),
      t('Come back here each day and click a tile to act on it.', 'हर दिन यहाँ आएँ और किसी टाइल पर क्लिक करके काम करें।'),
    ],
  },

  practiceClients: {
    section: t('Clients', 'क्लाइंट'),
    title: t('Life cycle of a client', 'क्लाइंट का पूरा सफ़र'),
    flow: [
      { icon: UserPlus, label: t('Add client', 'क्लाइंट जोड़ें'), tone: 'action' },
      { icon: ClipboardCheck, label: t('Pick their services', 'उनकी सर्विस चुनें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: CalendarClock, label: t('Deadlines appear', 'डेडलाइन बनती हैं'), tone: 'wait' }] },
          { flow: [{ icon: ClipboardList, label: t('Document checklists', 'डॉक्यूमेंट चेकलिस्ट'), tone: 'wait' }] },
          { flow: [{ icon: FileText, label: t('Fee invoices', 'फ़ीस इनवॉइस'), tone: 'action' }] },
        ],
      },
      { icon: BadgeCheck, label: t('Active client', 'चालू क्लाइंट'), tone: 'done' },
    ],
    can: [
      t('Keep every client with their type, contact, PAN, GSTIN, WhatsApp and email.', 'हर क्लाइंट को उनके प्रकार, संपर्क, PAN, GSTIN, WhatsApp और ईमेल के साथ रखें।'),
      t('Pick the services you handle; they decide which deadlines and document checklists the client gets.', 'जो सर्विस आप देते हैं वह चुनें; उसी से तय होता है क्लाइंट की कौन-सी डेडलाइन और डॉक्यूमेंट चेकलिस्ट बनेगी।'),
      t('Search by name, GSTIN, PAN or contact, and filter by service or status.', 'नाम, GSTIN, PAN या संपर्क से खोजें, और सर्विस या हालत से छाँटें।'),
    ],
    steps: [
      t('Click **Add client**.', '**Add client** दबाएँ।'),
      t('Enter the name, type, contact, PAN, GSTIN, WhatsApp and email.', 'नाम, प्रकार, संपर्क, PAN, GSTIN, WhatsApp और ईमेल भरें।'),
      t('Tick the services you handle for them, and save.', 'उनके लिए आप जो सर्विस देते हैं उन पर टिक करें, और सेव करें।'),
      t('Open **Compliance** to see the deadlines that came from those services.', 'उन सर्विस से बनी डेडलाइन देखने के लिए **Compliance** खोलें।'),
    ],
  },

  compliance: {
    section: t('Compliance', 'कंप्लायंस'),
    title: t('Life cycle of a deadline', 'डेडलाइन का पूरा सफ़र'),
    flow: [
      { icon: ClipboardCheck, label: t('Client’s services', 'क्लाइंट की सर्विस'), tone: 'action' },
      { icon: RefreshCw, label: t('Refresh calendar', 'Refresh calendar'), tone: 'action' },
      { icon: CalendarClock, label: t('GST, TDS, ITR, ROC deadline', 'GST, TDS, ITR, ROC डेडलाइन'), tone: 'wait' },
      { icon: BellRing, label: t('Reminders 7, 3 and 1 days before', '7, 3 और 1 दिन पहले रिमाइंडर'), tone: 'wait' },
      {
        branch: [
          { edge: t('Filed', 'फ़ाइल हुआ'), flow: [{ icon: FileCheck2, label: t('Mark filed', 'Mark filed'), tone: 'done' }] },
          { edge: t('Missed', 'छूट गया'), flow: [{ icon: TriangleAlert, label: t('Overdue', 'ओवरड्यू'), tone: 'error' }] },
        ],
      },
    ],
    can: [
      t('See GST, TDS, ITR and ROC deadlines, generated from each client’s services.', 'हर क्लाइंट की सर्विस से बनी GST, TDS, ITR और ROC डेडलाइन देखें।'),
      t('Remind clients 7, 3 and 1 days before each deadline.', 'हर डेडलाइन से 7, 3 और 1 दिन पहले क्लाइंट को याद दिलाएँ।'),
      t('Mark each one filed per client, and see what is urgent.', 'हर क्लाइंट के लिए फ़ाइल हुआ चिह्नित करें, और देखें क्या ज़रूरी है।'),
    ],
    steps: [
      t('Click **Refresh calendar** to add new deadlines from clients’ services.', 'क्लाइंट की सर्विस से नई डेडलाइन जोड़ने के लिए **Refresh calendar** दबाएँ।'),
      t('Click **Send due reminders** to remind clients whose deadlines are near.', 'जिनकी डेडलाइन पास है, उन्हें याद दिलाने के लिए **Send due reminders** दबाएँ।'),
      t('When a return is filed, click **Mark filed** on that client’s row.', 'रिटर्न फ़ाइल होने पर उस क्लाइंट की लाइन पर **Mark filed** दबाएँ।'),
    ],
  },

  documentHub: {
    section: t('Document hub', 'डॉक्यूमेंट हब'),
    title: t('Life cycle of a document request', 'डॉक्यूमेंट माँगने का पूरा सफ़र'),
    flow: [
      { icon: ClipboardList, label: t('Request documents', 'Request documents'), tone: 'action' },
      { icon: Hourglass, label: t('Missing: waiting for client', 'बाकी: क्लाइंट का इंतज़ार'), tone: 'wait' },
      {
        branch: [
          {
            edge: t('Uploaded', 'अपलोड हुआ'),
            flow: [
              { icon: Sparkles, label: t('Matched automatically', 'अपने-आप मिलाया'), tone: 'ai' },
              { icon: UserCheck, label: t('You verify', 'आप Verify करें'), tone: 'action' },
            ],
          },
          { edge: t('Not yet', 'अभी नहीं'), flow: [{ icon: BellRing, label: t('Remind', 'Remind'), tone: 'wait' }] },
        ],
      },
      { icon: CircleCheck, label: t('Complete', 'पूरा'), tone: 'done' },
    ],
    can: [
      t('Build a checklist of what each client must send, from the service.', 'सर्विस के हिसाब से हर क्लाइंट की भेजने वाली चीज़ों की चेकलिस्ट बनाएँ।'),
      t('Uploads are matched to the checklist automatically; you confirm each one before it counts.', 'अपलोड अपने-आप चेकलिस्ट से मिलाए जाते हैं; गिनती में आने से पहले आप हर एक को पक्का करते हैं।'),
      t('Chase one client, or everyone with something missing.', 'एक क्लाइंट को, या जिनका कुछ भी बाकी है उन सबको याद दिलाएँ।'),
    ],
    steps: [
      t('Click **Request documents**, pick the client and the service, and set when it is needed by.', '**Request documents** दबाएँ, क्लाइंट और सर्विस चुनें, और कब तक चाहिए वह भरें।'),
      t('When a file arrives, check it and click **Verify**.', 'फ़ाइल आने पर जाँचें और **Verify** दबाएँ।'),
      t('Click **Remind** for one client, or **Remind everyone**.', 'एक क्लाइंट के लिए **Remind** दबाएँ, या **Remind everyone**।'),
    ],
  },

  tasks: {
    section: t('Tasks', 'टास्क'),
    title: t('Life cycle of a task', 'टास्क का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('Add task', 'Add task'), tone: 'action' },
      { icon: ListTodo, label: t('To do', 'करना है'), tone: 'wait' },
      { icon: RefreshCw, label: t('In progress', 'चल रहा है'), tone: 'action' },
      {
        branch: [
          { edge: t('Stuck', 'अटका'), flow: [{ icon: Ban, label: t('Blocked', 'रुका हुआ'), tone: 'neutral' }] },
          { edge: t('Finished', 'पूरा'), flow: [{ icon: CircleCheck, label: t('Done', 'हो गया'), tone: 'done' }] },
        ],
      },
    ],
    can: [
      t('Keep your team’s own work on a board: To do, In progress, Blocked, Done.', 'टीम का काम एक बोर्ड पर रखें: To do, In progress, Blocked, Done।'),
      t('Give each task a client, priority, assignee and due date.', 'हर टास्क को क्लाइंट, प्राथमिकता, ज़िम्मेदार व्यक्ति और ड्यू डेट दें।'),
      t('See what is overdue or due today.', 'देखें क्या ओवरड्यू है या आज ड्यू है।'),
    ],
    steps: [
      t('Click **Add task**, write what to do, and pick the client, priority, who it is assigned to and the due date.', '**Add task** दबाएँ, क्या करना है लिखें, और क्लाइंट, प्राथमिकता, किसे सौंपा और ड्यू डेट चुनें।'),
      t('Move the task along the board as work goes on.', 'काम आगे बढ़ने पर टास्क को बोर्ड पर आगे खिसकाएँ।'),
      t('Click **Delete task** for one no longer needed.', 'जिसकी ज़रूरत नहीं, उसके लिए **Delete task** दबाएँ।'),
    ],
    note: t('Deadlines and document chases track themselves; tasks are for everything else.', 'डेडलाइन और डॉक्यूमेंट की याद अपने-आप चलती हैं; टास्क बाकी सब कामों के लिए हैं।'),
  },

  leads: {
    section: t('Leads', 'लीड'),
    title: t('Life cycle of a lead', 'लीड का पूरा सफ़र'),
    flow: [
      { icon: Inbox, label: t('New enquiry', 'नई पूछताछ'), tone: 'action', edge: t('Website, WhatsApp, referral, walk-in', 'वेबसाइट, WhatsApp, रेफ़रल, वॉक-इन') },
      { icon: Sparkles, label: t('Qualify with AI: score, summary', 'Qualify with AI: स्कोर, सारांश'), tone: 'ai' },
      { icon: Target, label: t('Qualifying', 'बातचीत जारी'), tone: 'wait' },
      { icon: Send, label: t('Proposal sent', 'प्रस्ताव भेजा'), tone: 'wait' },
      {
        branch: [
          { edge: t('Yes', 'हाँ'), flow: [{ icon: BadgeCheck, label: t('Won', 'मिल गया'), tone: 'done' }] },
          { edge: t('No', 'नहीं'), flow: [{ icon: CircleX, label: t('Lost', 'नहीं मिला'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Keep enquiries from every channel: website, WhatsApp, referral, walk-in.', 'हर जगह से आई पूछताछ रखें: वेबसाइट, WhatsApp, रेफ़रल, वॉक-इन।'),
      t('Let AI score and summarise a lead, list its signals and what is still to ask.', 'AI से लीड का स्कोर और सारांश बनवाएँ, उसके संकेत और अभी क्या पूछना है।'),
      t('Move a lead through the stages yourself; the AI only recommends.', 'लीड को चरणों में आप ख़ुद आगे बढ़ाएँ; AI सिर्फ़ सलाह देता है।'),
      t('Send follow-ups to leads that have gone quiet.', 'जो लीड चुप हो गईं, उन्हें फ़ॉलो-अप भेजें।'),
    ],
    steps: [
      t('Click **Add lead**: the name, contact person, WhatsApp number, source and services wanted.', '**Add lead** दबाएँ: नाम, संपर्क व्यक्ति, WhatsApp नंबर, स्रोत और चाही गई सर्विस भरें।'),
      t('Click **Qualify with AI** to score and summarise it.', 'स्कोर और सारांश के लिए **Qualify with AI** दबाएँ।'),
      t('Use **Move to…** to change its stage: Qualifying, Proposal sent, Won or Lost.', 'चरण बदलने के लिए **Move to…** से Qualifying, Proposal sent, Won या Lost चुनें।'),
      t('Click **Run follow-ups** to nudge the leads waiting on a reply.', 'जवाब का इंतज़ार कर रही लीड को याद दिलाने के लिए **Run follow-ups** दबाएँ।'),
    ],
  },

  fees: {
    section: t('Fees', 'फ़ीस'),
    title: t('Life cycle of a fee invoice', 'फ़ीस इनवॉइस का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('Raise invoice: draft, numbered', 'Raise invoice: ड्राफ़्ट, नंबर लगा'), tone: 'action' },
      { icon: Send, label: t('Issue: sent to client', 'Issue: क्लाइंट को भेजा'), tone: 'wait' },
      {
        branch: [
          { edge: t('Paid', 'पेमेंट मिला'), flow: [{ icon: HandCoins, label: t('Record payment', 'Record payment'), tone: 'done' }] },
          {
            edge: t('Not paid', 'पेमेंट नहीं'),
            flow: [
              { icon: BellRing, label: t('Run collections: reminders', 'Run collections: रिमाइंडर'), tone: 'wait' },
              { icon: Gavel, label: t('Very late: legal notice flag', 'बहुत देर: लीगल नोटिस'), tone: 'error' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Bill your clients for your own fees, with the service and the due date.', 'अपने क्लाइंट को अपनी फ़ीस का बिल भेजें, सर्विस और ड्यू डेट के साथ।'),
      t('Each invoice gets a gapless number per financial year when you raise it; **Issue** marks it sent.', 'हर इनवॉइस को बनाते समय वित्त वर्ष में बिना गैप वाला नंबर मिलता है; **Issue** से वह भेजा हुआ माना जाता है।'),
      t('Record payments in part or in full, and see what is owed by how late.', 'थोड़ा या पूरा पेमेंट दर्ज करें, और देखें कितना बकाया है और कितने दिन से।'),
      t('Send reminders on a ladder: seven days before, on the due date, then a week and a fortnight late; very late ones are flagged.', 'सीढ़ी की तरह रिमाइंडर भेजें: सात दिन पहले, ड्यू डेट पर, फिर एक और दो हफ़्ते देर से; बहुत देर वाले अलग चिह्नित होते हैं।'),
    ],
    steps: [
      t('Click **Raise invoice**, pick the client and service, the amount and due date. It is numbered and starts as a draft.', '**Raise invoice** दबाएँ, क्लाइंट, सर्विस, रकम और ड्यू डेट चुनें। इसे नंबर मिलता है और यह ड्राफ़्ट से शुरू होता है।'),
      t('Click **Issue** when it goes to the client.', 'क्लाइंट को भेजते समय **Issue** दबाएँ।'),
      t('When the client pays, click **Record payment**.', 'क्लाइंट पेमेंट करे तो **Record payment** दबाएँ।'),
      t('Click **Run collections** to send the reminders due today.', 'आज के रिमाइंडर भेजने के लिए **Run collections** दबाएँ।'),
    ],
    note: t('These are your firm’s own fee invoices, separate from your clients’ books.', 'ये आपकी फ़र्म के अपने फ़ीस इनवॉइस हैं, क्लाइंट की किताबों से अलग।'),
  },

  supportAgent: {
    section: t('Support agent', 'सपोर्ट एजेंट'),
    title: t('Life cycle of a client question', 'क्लाइंट के सवाल का पूरा सफ़र'),
    flow: [
      { icon: MessageCircle, label: t('Client asks', 'क्लाइंट पूछता है'), tone: 'action' },
      { icon: Bot, label: t('Agent reads their records', 'एजेंट उनके रिकॉर्ड पढ़ता है'), tone: 'ai' },
      {
        branch: [
          { edge: t('Sure', 'पक्का'), flow: [{ icon: CircleCheck, label: t('Answered', 'जवाब दिया'), tone: 'done' }] },
          {
            edge: t('Fees, sensitive, unsure', 'फ़ीस, संवेदनशील, शक'),
            flow: [
              { icon: UserCheck, label: t('Waiting on you', 'आपका इंतज़ार'), tone: 'wait' },
              { icon: Bot, label: t('Hand back to agent', 'Hand back to agent'), tone: 'action' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Let clients’ questions be answered from their real records.', 'क्लाइंट के सवालों के जवाब उनके असली रिकॉर्ड से दिलवाएँ।'),
      t('Anything about fees, anything sensitive, anything the agent is unsure of, and requests for a person come to you.', 'फ़ीस से जुड़ी बात, कोई संवेदनशील बात, जिसमें एजेंट को शक हो, और जब क्लाइंट इंसान से बात करना चाहे, वह आपके पास आता है।'),
      t('See how many questions it handled and how fast.', 'देखें उसने कितने सवाल संभाले और कितनी जल्दी।'),
    ],
    steps: [
      t('Open a conversation marked **Waiting on you** and read why it came to you.', '**Waiting on you** वाली बातचीत खोलें और पढ़ें कि वह आपके पास क्यों आई।'),
      t('Reply to the client yourself.', 'क्लाइंट को ख़ुद जवाब दें।'),
      t('Click **Hand back to agent** when you are done.', 'काम पूरा होने पर **Hand back to agent** दबाएँ।'),
      t('To try it, use **Send as client** with a sender number and a message.', 'आज़माने के लिए sender number और मैसेज के साथ **Send as client** इस्तेमाल करें।'),
    ],
    note: t('**Send as client** stands in for WhatsApp while the live connection is not set up.', 'जब तक असली कनेक्शन सेट नहीं, **Send as client** WhatsApp की जगह काम करता है।'),
  },

  messaging: {
    section: t('Messaging', 'मैसेजिंग'),
    title: t('Life cycle of a client message', 'क्लाइंट मैसेज का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: CalendarClock, label: t('Deadline reminder', 'डेडलाइन रिमाइंडर'), tone: 'action' }] },
          { flow: [{ icon: ClipboardList, label: t('Document chase', 'डॉक्यूमेंट की याद'), tone: 'action' }] },
          { flow: [{ icon: HandCoins, label: t('Fee reminder', 'फ़ीस रिमाइंडर'), tone: 'action' }] },
        ],
      },
      { icon: FileText, label: t('Written from a template', 'टेम्पलेट से लिखा'), tone: 'action' },
      { icon: Hourglass, label: t('Queued in the outbox', 'आउटबॉक्स में कतार में'), tone: 'wait' },
      { icon: Send, label: t('Sent by WhatsApp or email', 'WhatsApp या ईमेल से भेजा'), tone: 'done' },
    ],
    can: [
      t('See every message sent to clients, with its channel and status.', 'क्लाइंट को भेजा हर मैसेज, चैनल और हालत के साथ देखें।'),
      t('Read the templates behind reminders and chases.', 'रिमाइंडर और याद-दहानी के पीछे के टेम्पलेट पढ़ें।'),
      t('See which delivery adapter carries them, and send a test message.', 'देखें कौन-सा डिलीवरी एडैप्टर उन्हें भेजता है, और एक टेस्ट मैसेज भेजें।'),
    ],
    steps: [
      t('On **Outbox**, filter by status to find a message.', '**Outbox** में हालत से छाँटकर मैसेज ढूँढें।'),
      t('On **Templates**, read the wording clients receive.', '**Templates** में पढ़ें कि क्लाइंट को क्या लिखा जाता है।'),
      t('On **Delivery**, enter a WhatsApp number or email and click **Send test message**.', '**Delivery** में WhatsApp नंबर या ईमेल भरें और **Send test message** दबाएँ।'),
    ],
    note: t('In test mode, messages are written and logged but not sent; the outbox marks them **Mock**.', 'टेस्ट मोड में मैसेज लिखे और दर्ज होते हैं पर भेजे नहीं जाते; आउटबॉक्स में उन पर **Mock** लिखा होता है।'),
  },

  practiceReports: {
    section: t('Practice reports', 'प्रैक्टिस रिपोर्ट'),
    title: t('What practice reports show', 'प्रैक्टिस रिपोर्ट क्या दिखाती है'),
    flow: [
      { icon: Users, label: t('Clients, fees, deadlines, leads', 'क्लाइंट, फ़ीस, डेडलाइन, लीड'), tone: 'done' },
      { icon: BarChart3, label: t('Last six months', 'पिछले छह महीने'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: HandCoins, label: t('Revenue', 'आमदनी'), tone: 'action' }] },
          { flow: [{ icon: UserPlus, label: t('Client growth', 'क्लाइंट बढ़त'), tone: 'action' }] },
          { flow: [{ icon: FileCheck2, label: t('Compliance', 'कंप्लायंस'), tone: 'action' }] },
        ],
      },
      { icon: Sparkles, label: t('Leads and automation', 'लीड और ऑटोमेशन'), tone: 'action' },
    ],
    can: [
      t('See revenue billed and collected over six months.', 'छह महीने में बिल की गई और वसूली गई आमदनी देखें।'),
      t('See client growth: clients on the books at each month end.', 'क्लाइंट बढ़त देखें: हर महीने के अंत में कितने क्लाइंट।'),
      t('See compliance filed, pending and overdue, and leads by stage.', 'कंप्लायंस में फ़ाइल हुआ, बाकी और ओवरड्यू, और चरण के हिसाब से लीड देखें।'),
      t('See what automation did: questions answered, reminders sent, time saved.', 'देखें ऑटोमेशन ने क्या किया: जवाब दिए सवाल, भेजे रिमाइंडर, बचा समय।'),
    ],
    steps: [
      t('Open **Practice reports** from the Firm group.', 'Firm ग्रुप से **Practice reports** खोलें।'),
      t('Read each card; it covers the last six months.', 'हर कार्ड पढ़ें; यह पिछले छह महीने दिखाता है।'),
      t('Act on what you see from **Fees**, **Compliance** or **Leads**.', 'जो दिखे उस पर **Fees**, **Compliance** या **Leads** से काम करें।'),
    ],
  },

  firmBranding: {
    section: t('Firm & branding', 'फ़र्म और ब्रांडिंग'),
    title: t('How your firm portal works', 'आपका फ़र्म पोर्टल कैसे काम करता है'),
    flow: [
      { icon: Users, label: t('Clients: New client', 'Clients: New client'), tone: 'action' },
      {
        branch: [
          { edge: t('Check books', 'किताबें देखें'), flow: [{ icon: ClipboardCheck, label: t('Open their review queue', 'उनकी Review खोलें'), tone: 'wait' }] },
          { edge: t('Brand', 'ब्रांड'), flow: [{ icon: Palette, label: t('Logo and accent colour', 'लोगो और रंग'), tone: 'action' }] },
          { edge: t('Domain', 'डोमेन'), flow: [{ icon: Globe, label: t('Custom domain (CNAME)', 'कस्टम डोमेन (CNAME)'), tone: 'action' }] },
        ],
      },
      { icon: Upload, label: t('Client portal in your brand', 'आपके ब्रांड में क्लाइंट पोर्टल'), tone: 'done' },
    ],
    can: [
      t('See every client organisation with entries pending review and what needs attention.', 'हर क्लाइंट संस्था देखें, रिव्यू के लिए रुकी एंट्री और ध्यान देने वाली बातों के साथ।'),
      t('Click a client to open its review queue and check its books.', 'क्लाइंट पर क्लिक करके उसकी Review खोलें और उसकी किताबें जाँचें।'),
      t('Brand the client portal with your logo and accent colour, and preview it.', 'क्लाइंट पोर्टल पर अपना लोगो और रंग लगाएँ, और उसकी झलक देखें।'),
      t('Serve the portal on your own domain.', 'पोर्टल को अपने डोमेन पर चलाएँ।'),
    ],
    steps: [
      t('On **Clients**, click **New client**, enter the name and GSTIN, then **Create client**.', '**Clients** में **New client** दबाएँ, नाम और GSTIN भरें, फिर **Create client**।'),
      t('Click a client to open its review queue.', 'उसकी Review खोलने के लिए क्लाइंट पर क्लिक करें।'),
      t('On **Branding**, set the logo URL and accent colour, then **Save branding**.', '**Branding** में लोगो URL और रंग भरें, फिर **Save branding** दबाएँ।'),
      t('On **Custom domain**, enter your domain, point a CNAME record as shown, then **Save domain**.', '**Custom domain** में अपना डोमेन भरें, दिखाए अनुसार CNAME रिकॉर्ड लगाएँ, फिर **Save domain** दबाएँ।'),
    ],
  },
};

