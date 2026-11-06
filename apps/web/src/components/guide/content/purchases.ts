import {
  Ban,
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Download,
  FilePen,
  FilePlus2,
  FileText,
  HandCoins,
  Landmark,
  ListChecks,
  PackageCheck,
  Paperclip,
  Percent,
  Receipt,
  Repeat,
  RotateCcw,
  ScanLine,
  Send,
  Sparkles,
  Undo2,
  Upload,
  UserCheck,
  UserPlus,
  Wallet,
  Scale,
  ShieldCheck,
  Building2,
  Car,
  Rows3,
} from 'lucide-react';
import type { AreaKeys } from '../keys';
import { t, type Guide } from '../types';

export const PURCHASE_GUIDES: Record<AreaKeys<'purchases'>, Guide> = {
  vendors: {
    section: t('Vendors', 'वेंडर'),
    title: t('Life cycle of a vendor', 'वेंडर का पूरा सफ़र'),
    flow: [
      { icon: UserPlus, label: t('Add vendor', 'वेंडर जोड़ें'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: Building2, label: t('Bank details', 'बैंक डिटेल'), tone: 'action' }] },
          { flow: [{ icon: ShieldCheck, label: t('MSME (Udyam)', 'MSME (उद्यम)'), tone: 'action' }] },
          { flow: [{ icon: Percent, label: t('TDS section', 'TDS सेक्शन'), tone: 'action' }] },
        ],
      },
      { icon: FileText, label: t('Bills come in', 'बिल आते हैं'), tone: 'action' },
      { icon: Clock, label: t('What you owe, and pay-by date', 'बकाया और पेमेंट की आख़िरी तारीख़'), tone: 'wait' },
      { icon: HandCoins, label: t('Paid', 'पेमेंट हुआ'), tone: 'done' },
    ],
    can: [
      t('Keep each vendor’s GSTIN, PAN, address and bank account, which payment runs pay into.', 'हर वेंडर का GSTIN, PAN, पता और बैंक अकाउंट रखें; पेमेंट रन इसी अकाउंट में पैसा भेजता है।'),
      t('Mark MSME vendors with their Udyam number: AiBooks shows the date to pay by under section 43B(h).', 'MSME वेंडर का उद्यम नंबर डालें: AiBooks सेक्शन 43B(h) के हिसाब से पेमेंट की आख़िरी तारीख़ दिखाता है।'),
      t('Set a TDS section, so TDS is deducted when their bills post.', 'TDS सेक्शन चुनें, ताकि उनके बिल पोस्ट होते समय TDS कट जाए।'),
      t('See what you owe each vendor, their open bills, and any advance or credit with them.', 'देखें हर वेंडर का कितना देना है, उनके खुले बिल, और उनके पास आपका एडवांस या क्रेडिट।'),
    ],
    steps: [
      t('Click **New vendor**, or the **+** beside Vendors in the sidebar.', '**New vendor** दबाएँ, या साइडबार में Vendors के पास **+** दबाएँ।'),
      t('Enter the name and GSTIN (blank if they are not registered), and the PAN.', 'नाम और GSTIN भरें (रजिस्टर्ड न हों तो खाली), और PAN भरें।'),
      t('Add the bank account, the MSME category and Udyam number if they have one, and the TDS section.', 'बैंक अकाउंट, MSME कैटेगरी और उद्यम नंबर (अगर हो), और TDS सेक्शन भरें।'),
      t('Click **Save vendor**.', '**Save vendor** दबाएँ।'),
      t('On the vendor’s page, click **New bill** or **Record payment**.', 'वेंडर के पेज पर **New bill** या **Record payment** दबाएँ।'),
    ],
    note: t('If a vendor asks to change their bank account, confirm it on a number you already have, not one from that email.', 'अगर वेंडर बैंक अकाउंट बदलने को कहे, तो पहले से मौजूद नंबर पर फ़ोन करके पक्का करें, उसी ईमेल वाले नंबर पर नहीं।'),
  },

  expenses: {
    section: t('Expenses', 'खर्च'),
    title: t('Life cycle of an expense', 'खर्च का पूरा सफ़र'),
    flow: [
      { icon: Receipt, label: t('Paid from bank or cash', 'बैंक या कैश से भुगतान'), tone: 'action' },
      {
        branch: [
          { edge: t('One', 'एक'), flow: [{ icon: FilePlus2, label: t('Record Expense, or Itemize', 'Record Expense, या Itemize'), tone: 'action' }] },
          { edge: t('A trip', 'यात्रा'), flow: [{ icon: Car, label: t('Record Mileage', 'Record Mileage'), tone: 'action' }] },
          { edge: t('Many', 'कई'), flow: [{ icon: Rows3, label: t('Bulk Add Expenses', 'Bulk Add Expenses'), tone: 'action' }] },
        ],
      },
      {
        branch: [
          { edge: t('Later', 'बाद में'), flow: [{ icon: FilePen, label: t('Save expense: draft', 'Save expense: ड्राफ़्ट'), tone: 'neutral' }] },
          { edge: t('Now', 'अभी'), flow: [{ icon: Send, label: t('Save and post', 'Save and post'), tone: 'action' }] },
        ],
      },
      {
        branch: [
          { edge: t('No policy', 'कोई पॉलिसी नहीं'), flow: [{ icon: CircleCheck, label: t('Payment voucher posted', 'पेमेंट वाउचर पोस्ट'), tone: 'done' }] },
          {
            edge: t('Policy applies', 'पॉलिसी लागू'),
            flow: [
              { icon: UserCheck, label: t('Waits on Approvals', 'Approvals में इंतज़ार'), tone: 'wait' },
              { icon: CircleCheck, label: t('Posts when approved', 'मंज़ूरी पर पोस्ट'), tone: 'done' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Record money spent without a bill to enter first: fuel, courier, bank charges, a small card purchase.', 'बिना बिल वाले खर्च दर्ज करें: पेट्रोल, कूरियर, बैंक चार्ज, कार्ड से छोटी ख़रीद।'),
      t('**Itemize** one payment across several accounts, each line with its own GST rate.', 'एक ही पेमेंट को **Itemize** करके कई अकाउंट में बाँटें, हर लाइन का अपना GST रेट।'),
      t('Claim the GST when you have the supplier’s GSTIN; without it, the GST is part of the expense.', 'सप्लायर का GSTIN हो तो GST का क्रेडिट लें; न हो तो GST खर्च में ही जुड़ जाता है।'),
      t('Record a trip at your mileage rate: distance × the rate in force on its date, with no GST.', 'माइलेज रेट पर यात्रा दर्ज करें: दूरी × उस तारीख़ पर लागू रेट, GST नहीं।'),
      t('Enter many expenses at once on **Bulk Add Expenses**: all are saved, or none if a row is wrong.', '**Bulk Add Expenses** पर एक साथ कई खर्च भरें: सब सेव होते हैं, या कोई लाइन ग़लत हो तो एक भी नहीं।'),
      t('Pick the customer it was spent for and mark it **Billable**, to bill on to them later.', 'जिस कस्टमर के लिए खर्च हुआ उसे चुनें और **Billable** पर टिक करें, ताकि बाद में उनसे वसूला जा सके।'),
    ],
    steps: [
      t('Click **New expense**. On **Record Expense**, enter the date, the **Expense account** and the bank or cash account it was **Paid through**.', '**New expense** दबाएँ। **Record Expense** पर तारीख़, **Expense account** और जिस बैंक या कैश से पैसा गया (**Paid through**) वह भरें।'),
      t('Enter the amount before tax and the GST rate, or click **Itemize** to split it into lines. Tick **Inter-state (IGST)** if the supplier is in another state.', 'टैक्स से पहले की रकम और GST रेट भरें, या लाइनों में बाँटने के लिए **Itemize** दबाएँ। सप्लायर दूसरे राज्य का हो तो **Inter-state (IGST)** पर टिक करें।'),
      t('To claim the GST, pick the vendor or type the **Supplier’s GSTIN**. Pick the **Customer name** and tick **Billable** if it is to be billed on.', 'GST क्रेडिट लेना हो तो वेंडर चुनें या **Supplier’s GSTIN** भरें। कस्टमर से वसूलना हो तो **Customer name** चुनें और **Billable** पर टिक करें।'),
      t('For a trip, open **Record Mileage**. The first time, set the account, the unit and the rates in **Mileage preferences**; then enter the distance.', 'यात्रा के लिए **Record Mileage** खोलें। पहली बार **Mileage preferences** में अकाउंट, यूनिट और रेट सेट करें; फिर दूरी भरें।'),
      t('For many at once, open **Bulk Add Expenses**, fill a row each (**Add more expenses** for more), then **Save expenses** or **Save and post**.', 'एक साथ कई के लिए **Bulk Add Expenses** खोलें, हर खर्च की एक लाइन भरें (और चाहिए तो **Add more expenses**), फिर **Save expenses** या **Save and post** दबाएँ।'),
      t('Click **Save expense** for a draft, or **Save and post** to post it now. A draft posts later with **Post to ledger** on its page; attach the receipt there too.', 'ड्राफ़्ट के लिए **Save expense** दबाएँ, या अभी पोस्ट करने के लिए **Save and post**। ड्राफ़्ट बाद में उसके पेज पर **Post to ledger** से पोस्ट होता है; रसीद भी वहीं लगाएँ।'),
    ],
    note: t('Expenses are numbered EXP/2026-27/0001 and on, with no gaps. Each posts as one payment voucher.', 'खर्च के नंबर EXP/2026-27/0001 से आगे बिना किसी गैप के लगते हैं। हर खर्च एक पेमेंट वाउचर के रूप में पोस्ट होता है।'),
  },

  recurringExpenses: {
    section: t('Recurring Expenses', 'रिकरिंग खर्च'),
    title: t('Life cycle of a recurring expense', 'रिकरिंग खर्च का पूरा सफ़र'),
    flow: [
      { icon: Repeat, label: t('New recurring expense', 'नया रिकरिंग खर्च'), tone: 'action' },
      { icon: CalendarClock, label: t('Every week to every year', 'हर हफ़्ते से हर साल तक'), tone: 'wait' },
      { icon: FilePen, label: t('Drafted on its date at 6:30', 'तय दिन सुबह 6:30 पर ड्राफ़्ट'), tone: 'wait' },
      { icon: ClipboardCheck, label: t('Check this month’s amount', 'इस महीने की रकम जाँचें'), tone: 'action' },
      { icon: CircleCheck, label: t('Post to ledger', 'Post to ledger'), tone: 'done' },
    ],
    can: [
      t('Set up costs that come round again, paid straight from bank or cash: rent, internet, a software plan.', 'बार-बार आने वाले खर्च सेट करें जो सीधे बैंक या कैश से जाते हैं: किराया, इंटरनेट, सॉफ़्टवेयर प्लान।'),
      t('Repeat every week, 2 weeks, month, 2 months, quarter, 6 months or year, until an end date or for good.', 'हर हफ़्ते, 2 हफ़्ते, महीने, 2 महीने, तिमाही, 6 महीने या साल दोहराएँ, किसी तारीख़ तक या हमेशा।'),
      t('Itemize it across accounts, and mark it billable to a customer, as on a single expense.', 'एक खर्च की तरह ही इसे अकाउंट में बाँटें (Itemize), और कस्टमर के लिए Billable बनाएँ।'),
      t('Each one is drafted as an expense on its date, marked as made by the schedule. Check it before posting; nothing posts on its own.', 'हर बार तय दिन पर खर्च का ड्राफ़्ट बनता है, जिस पर लिखा होता है कि शेड्यूल से बना। पोस्ट करने से पहले जाँचें; अपने-आप कुछ पोस्ट नहीं होता।'),
      t('Pause, resume or end a schedule at any time.', 'शेड्यूल कभी भी रोकें, फिर चालू करें या ख़त्म करें।'),
    ],
    steps: [
      t('Click **New recurring expense** and give it a **Profile name**.', '**New recurring expense** दबाएँ और **Profile name** दें।'),
      t('Choose **Repeat every**, the **Start date** (the form shows the date the first one is created) and an end date, or tick **Never expires**.', '**Repeat every** चुनें, **Start date** भरें (फ़ॉर्म बताता है पहला कब बनेगा), और ख़त्म होने की तारीख़ भरें या **Never expires** पर टिक करें।'),
      t('Pick the expense account (or **Itemize**), the bank or cash account it is paid through, the amount and GST, and the vendor or customer. Click **Save recurring expense**.', 'Expense account (या **Itemize**), जिस बैंक या कैश से पैसा जाता है, रकम और GST, और वेंडर या कस्टमर भरें। **Save recurring expense** दबाएँ।'),
      t('On its date, open **Expenses**, check the draft and click **Post to ledger**. **Draft what’s due** drafts anything due now.', 'तय दिन **Expenses** खोलें, ड्राफ़्ट जाँचें और **Post to ledger** दबाएँ। **Draft what’s due** से अभी ड्यू सब ड्राफ़्ट हो जाता है।'),
    ],
  },

  purchaseOrders: {
    section: t('Purchase Orders', 'परचेज़ ऑर्डर'),
    title: t('Life cycle of a purchase order', 'परचेज़ ऑर्डर का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('Raise purchase order', 'PO बनाएँ'), tone: 'action' },
      { icon: Send, label: t('Send PO', 'PO भेजें'), tone: 'action' },
      { icon: Clock, label: t('Open, waiting for goods', 'खुला, माल का इंतज़ार'), tone: 'wait' },
      { icon: PackageCheck, label: t('Receive goods (GRN)', 'माल मिला (GRN)'), tone: 'action' },
      { icon: FileText, label: t('Make draft bill', 'ड्राफ़्ट बिल बनाएँ'), tone: 'action' },
      { icon: Scale, label: t('3-way match', '3-वे मिलान'), tone: 'wait' },
      {
        branch: [
          { edge: t('All billed', 'सब बिल हुआ'), flow: [{ icon: CircleCheck, label: t('Closed', 'बंद'), tone: 'done' }] },
          { edge: t('No more coming', 'और नहीं आएगा'), flow: [{ icon: Ban, label: t('Close or Cancel PO', 'Close या Cancel PO'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Raise a PO with the vendor, where the goods go (your address or a customer’s), the delivery date, payment terms and shipment preference, and email it as a PDF.', 'वेंडर, माल कहाँ जाना है (आपका पता या किसी ग्राहक का), डिलीवरी की तारीख़, पेमेंट टर्म्स और शिपमेंट के तरीक़े के साथ PO बनाएँ और PDF ईमेल करें।'),
      t('Give each line the account its bill will book it to, and a discount and adjustment on the whole PO. The bill made from it carries them.', 'हर लाइन का अकाउंट चुनें जिसमें उसका बिल बुक होगा, और पूरे PO पर डिस्काउंट और एडजस्टमेंट दें। उससे बना बिल ये सब साथ ले जाता है।'),
      t('Record goods as they arrive, with the vendor’s challan number (a goods received note).', 'माल आने पर वेंडर के चालान नंबर के साथ दर्ज करें (goods received note)।'),
      t('Bill only what was received, as a draft bill you post from its page.', 'सिर्फ़ मिले माल का ड्राफ़्ट बिल बनाएँ, जिसे उसके पेज से पोस्ट करें।'),
      t('Let the 3-way match flag differences between the PO, what came and the bill, before you pay.', '3-वे मिलान से PO, मिले माल और बिल के बीच का फ़र्क़ पेमेंट से पहले पकड़ें।'),
    ],
    steps: [
      t('Click **New purchase order** and pick the vendor. Under **Delivery address** choose **Organisation** or a **Customer**.', '**New purchase order** दबाएँ और वेंडर चुनें। **Delivery address** में **Organisation** या कोई **Customer** चुनें।'),
      t('The number is given when you save; the cog types your own. Add the **Reference#**, **Delivery date**, **Payment terms** and **Shipment preference**.', 'नंबर सेव होने पर मिलता है; अपना नंबर देने के लिए कॉग दबाएँ। **Reference#**, **Delivery date**, **Payment terms** और **Shipment preference** भरें।'),
      t('Add the lines: pick an item (its purchase description and cost price fill in) or type one, and the **Account** for each. Give a **Discount** or **Adjustment** under the totals, add **Notes**, **Terms & conditions** and files, then click **Raise purchase order**.', 'लाइनें भरें: आइटम चुनें (उसकी परचेज़ डिस्क्रिप्शन और लागत भर जाती है) या टाइप करें, और हर लाइन का **Account**। टोटल के नीचे **Discount** या **Adjustment** दें, **Notes**, **Terms & conditions** और फ़ाइलें जोड़ें, फिर **Raise purchase order** दबाएँ।'),
      t('On its page, click **Send PO** to email it to the vendor.', 'उसके पेज पर **Send PO** दबाकर वेंडर को ईमेल करें।'),
      t('When goods arrive, under **Receive goods** enter the quantities and the vendor’s challan number, then **Record goods received**.', 'माल आने पर **Receive goods** में मात्रा और वेंडर का चालान नंबर भरें, फिर **Record goods received** दबाएँ।'),
      t('Under **Bill**, enter the vendor’s bill number and click **Make draft bill**. Post it from the bill’s page.', '**Bill** में वेंडर का बिल नंबर भरें और **Make draft bill** दबाएँ। बिल के पेज से उसे पोस्ट करें।'),
      t('Click **Close** or **Cancel PO** when nothing more will come.', 'और माल न आना हो तो **Close** या **Cancel PO** दबाएँ।'),
    ],
    note: t('A PO never posts. Each bill made from it takes its share of the discount; a bill for the whole PO at once also takes the adjustment. Lines to look at in the 3-way match are marked **Check before paying** on the bill.', 'PO से कोई एंट्री नहीं होती। उससे बने हर बिल में डिस्काउंट का उसका हिस्सा आता है; पूरे PO का एक ही बिल हो तो एडजस्टमेंट भी आता है। 3-वे मिलान में जिन लाइनों पर ध्यान देना है, बिल पर **Check before paying** लिखा आता है।'),
  },

  bills: {
    section: t('Bills', 'बिल'),
    title: t('Life cycle of a bill', 'बिल का पूरा सफ़र'),
    flow: [
      {
        branch: [
          {
            flow: [
              { icon: Upload, label: t('Upload bill', 'बिल अपलोड'), tone: 'action' },
              { icon: ScanLine, label: t('AI reads it', 'AI पढ़ता है'), tone: 'ai' },
              { icon: ClipboardCheck, label: t('Approve & post in Review', 'Review में Approve & post'), tone: 'wait' },
            ],
          },
          {
            flow: [
              { icon: FilePlus2, label: t('New bill (typed)', 'नया बिल (टाइप करके)'), tone: 'action' },
              { icon: FilePen, label: t('Draft', 'ड्राफ़्ट'), tone: 'neutral' },
              { icon: Send, label: t('Post to ledger', 'Post to ledger'), tone: 'action' },
              { icon: UserCheck, label: t('Approval, if a policy applies', 'पॉलिसी हो तो मंज़ूरी'), tone: 'wait' },
            ],
          },
        ],
      },
      { icon: CircleCheck, label: t('Posted, TDS deducted', 'पोस्ट, TDS कटा'), tone: 'done' },
      {
        branch: [
          { edge: t('Pay', 'भुगतान'), flow: [{ icon: HandCoins, label: t('Record payment or a run', 'Record payment या रन'), tone: 'done' }] },
          { edge: t('Wrong', 'ग़लती'), flow: [{ icon: Undo2, label: t('Vendor credit', 'वेंडर क्रेडिट'), tone: 'action' }] },
        ],
      },
    ],
    can: [
      t('Upload a bill and let AI read it into Review, or type it in yourself.', 'बिल अपलोड करें और AI उसे पढ़कर Review में रखे, या ख़ुद टाइप करें।'),
      t('Give a discount on each line or on the whole bill, before tax: GST and your input credit are on the value after it. An **Adjustment** of up to ₹99.99 rounds the total and posts to Round Off.', 'हर लाइन पर या पूरे बिल पर टैक्स से पहले डिस्काउंट दें: GST और इनपुट क्रेडिट डिस्काउंट के बाद की रकम पर लगते हैं। ₹99.99 तक का **Adjustment** टोटल को राउंड करता है और Round Off में जाता है।'),
      t('Book each line to its account, and mark a cost **Billable** to the customer it is for.', 'हर लाइन को उसके अकाउंट में बुक करें, और जिस ग्राहक के लिए ख़र्च है उसके लिए **Billable** चुनें।'),
      t('Post it to the ledger. If an approval policy covers it, a second person approves it first.', 'उसे लेजर में पोस्ट करें। अगर मंज़ूरी की पॉलिसी लागू है, तो पहले कोई दूसरा व्यक्ति मंज़ूरी देता है।'),
      t('TDS is deducted when it posts, if the vendor has a TDS section.', 'वेंडर का TDS सेक्शन हो, तो पोस्ट होते समय TDS कट जाता है।'),
      t('See when each bill is due, and for MSME vendors the 43B(h) pay-by date.', 'हर बिल की ड्यू डेट देखें, और MSME वेंडर के लिए 43B(h) की आख़िरी तारीख़।'),
      t('Pay it in part or in full, or correct it with a vendor credit (debit note).', 'थोड़ा या पूरा भुगतान करें, या वेंडर क्रेडिट (डेबिट नोट) से सुधारें।'),
    ],
    steps: [
      t('Scanned: click **Upload bill**, then approve it in **Review** with **Approve & post**.', 'स्कैन बिल: **Upload bill** दबाएँ, फिर **Review** में **Approve & post** दबाएँ।'),
      t('Typed: click **New bill** and pick the vendor (or **+ New vendor**). Enter the **Bill#**, the **Order number**, the **Bill date** and the **Payment terms**: the due date follows the terms until you type one.', 'टाइप करके: **New bill** दबाएँ और वेंडर चुनें (या **+ New vendor**)। **Bill#**, **Order number**, **Bill date** और **Payment terms** भरें: जब तक आप ड्यू डेट ख़ुद न भरें, वह टर्म्स के हिसाब से बदलती है।'),
      t('Choose the discount **At transaction level** or **At line item level**, add the lines with their **Account**, **Tax** and **Customer details**, then the **Adjustment** and notes, and click **Save bill**. It is a draft.', 'डिस्काउंट **At transaction level** या **At line item level** चुनें, लाइनें उनके **Account**, **Tax** और **Customer details** के साथ भरें, फिर **Adjustment** और नोट्स, और **Save bill** दबाएँ। यह ड्राफ़्ट है।'),
      t('On the bill’s page, click **Post to ledger**. If an approval policy covers it, the page says so, and it posts once approved on **Approvals**.', 'बिल के पेज पर **Post to ledger** दबाएँ। अगर मंज़ूरी की पॉलिसी लागू है, तो पेज पर यह लिखा आएगा, और **Approvals** में मंज़ूरी मिलते ही पोस्ट होगा।'),
      t('To pay, enter the amount and date and click **Record payment**, or pay many bills from **Payments Made** or **Payment Runs**.', 'पेमेंट के लिए रकम और तारीख़ भरकर **Record payment** दबाएँ, या **Payments Made** या **Payment Runs** से कई बिल एक साथ चुकाएँ।'),
      t('For goods returned or an overcharge, click **Vendor credit** on the bill’s page.', 'माल वापसी या ज़्यादा चार्ज के लिए बिल के पेज पर **Vendor credit** दबाएँ।'),
    ],
    note: t('The AI never posts a bill by itself: a person approves every one in Review.', 'AI कभी अपने-आप बिल पोस्ट नहीं करता: हर बिल को Review में कोई व्यक्ति मंज़ूर करता है।'),
  },

  recurringBills: {
    section: t('Recurring Bills', 'रिकरिंग बिल'),
    title: t('Life cycle of a recurring bill', 'रिकरिंग बिल का पूरा सफ़र'),
    flow: [
      { icon: Repeat, label: t('New recurring bill', 'नया रिकरिंग बिल'), tone: 'action' },
      { icon: CalendarClock, label: t('Every week, month, quarter or year', 'हर हफ़्ते, महीने, तिमाही या साल'), tone: 'wait' },
      { icon: FilePen, label: t('Bill drafted at 6:30', 'सुबह 6:30 पर बिल ड्राफ़्ट'), tone: 'wait' },
      { icon: CircleCheck, label: t('You check and post', 'आप जाँचकर पोस्ट करें'), tone: 'done' },
      { icon: HandCoins, label: t('Pay it', 'भुगतान करें'), tone: 'action' },
    ],
    can: [
      t('Set up bills that repeat: rent, a subscription, a maintenance contract.', 'बार-बार आने वाले बिल सेट करें: किराया, सब्सक्रिप्शन, मेंटेनेंस कॉन्ट्रैक्ट।'),
      t('Each one is drafted as a bill on its date, priced like a typed bill (each line’s account, discount and customer, and the adjustment), ready on **Bills** to check and post.', 'हर बार तय दिन पर बिल ड्राफ़्ट बनता है, टाइप किए बिल की तरह (हर लाइन का अकाउंट, डिस्काउंट और ग्राहक, और एडजस्टमेंट), जो **Bills** में जाँचने और पोस्ट करने के लिए तैयार रहता है।'),
      t('Nothing posts on its own.', 'अपने-आप कुछ पोस्ट नहीं होता।'),
      t('Pause, resume or end a schedule at any time.', 'शेड्यूल कभी भी रोकें, फिर चालू करें या ख़त्म करें।'),
    ],
    steps: [
      t('Click **New recurring bill**, pick the vendor and give it a **Profile name**.', '**New recurring bill** दबाएँ, वेंडर चुनें और **Profile name** दें।'),
      t('Choose **Repeat every** (a week up to a year), **Start on** (the first bill is drafted that day), **Ends on** or **Never expires**, and the **Payment terms**.', '**Repeat every** (हफ़्ते से साल तक), **Start on** (पहला बिल उसी दिन ड्राफ़्ट होता है), **Ends on** या **Never expires**, और **Payment terms** चुनें।'),
      t('Add the lines as on a bill: item, **Account**, quantity, rate, tax and customer, the discount on the lines or the whole bill, and the adjustment.', 'बिल की तरह लाइनें भरें: आइटम, **Account**, मात्रा, रेट, टैक्स और ग्राहक, लाइनों पर या पूरे बिल पर डिस्काउंट, और एडजस्टमेंट।'),
      t('Click **Save recurring bill**.', '**Save recurring bill** दबाएँ।'),
      t('On its date, open **Bills**, check the draft and click **Post to ledger**. **Draft what’s due** drafts anything due now.', 'तय दिन **Bills** खोलें, ड्राफ़्ट जाँचें और **Post to ledger** दबाएँ। **Draft what’s due** से अभी ड्यू सब ड्राफ़्ट हो जाता है।'),
    ],
  },

  paymentsMade: {
    section: t('Payments Made', 'किए गए पेमेंट'),
    title: t('Life cycle of a payment made', 'किए गए पेमेंट का पूरा सफ़र'),
    flow: [
      { icon: HandCoins, label: t('Record payment', 'Record payment'), tone: 'action' },
      { icon: Sparkles, label: t('Suggest allocation', 'Suggest allocation'), tone: 'ai' },
      { icon: ListChecks, label: t('Spread across bills', 'बिलों में बाँटें'), tone: 'action' },
      { icon: UserCheck, label: t('Approval, if a policy applies', 'पॉलिसी हो तो मंज़ूरी'), tone: 'wait' },
      {
        branch: [
          { edge: t('Exact', 'पूरा'), flow: [{ icon: CircleCheck, label: t('Bills paid', 'बिल चुकता'), tone: 'done' }] },
          {
            edge: t('Paid extra', 'ज़्यादा दिया'),
            flow: [
              { icon: Wallet, label: t('Held as advance', 'एडवांस जमा'), tone: 'wait' },
              { icon: RotateCcw, label: t('Apply advance or refund received', 'Apply advance या refund'), tone: 'action' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Record one payment to a vendor across many bills, by bank or cash, with the UTR or cheque number.', 'एक वेंडर को किया पेमेंट कई बिलों पर दर्ज करें, बैंक या कैश से, UTR या चेक नंबर के साथ।'),
      t('Let AI suggest how to spread it across the open bills.', 'AI से सुझाव लें कि पेमेंट किन खुले बिलों पर लगे।'),
      t('Hold anything paid ahead as an advance, then apply it to a bill or record the refund the vendor sends.', 'पहले दिया पैसा एडवांस में रखें, फिर किसी बिल पर लगाएँ या वेंडर से मिला रिफ़ंड दर्ज करें।'),
      t('Switch to **All payment vouchers** to see every payment, single bills and runs included.', '**All payment vouchers** पर जाकर हर पेमेंट देखें, एक बिल वाले और पेमेंट रन वाले भी।'),
    ],
    steps: [
      t('Click **Record payment**, pick the vendor, the amount, the date, and **Bank** or **Cash**.', '**Record payment** दबाएँ, वेंडर, रकम, तारीख़ और **Bank** या **Cash** चुनें।'),
      t('Add the reference: UTR, cheque number, or the bills it pays.', 'रेफ़रेंस भरें: UTR, चेक नंबर, या किन बिलों का पेमेंट है।'),
      t('Click **Suggest allocation** and check the split.', '**Suggest allocation** दबाएँ और बँटवारा जाँचें।'),
      t('Click **Record payment**. If a policy covers it, it waits on **Approvals** first.', '**Record payment** दबाएँ। अगर पॉलिसी लागू है, तो पहले **Approvals** में रुकेगा।'),
      t('Under **Advances and credits — vendors**, click **Apply advance** or **Record refund received**.', '**Advances and credits — vendors** में **Apply advance** या **Record refund received** दबाएँ।'),
    ],
  },

  paymentRuns: {
    section: t('Payment Runs', 'पेमेंट रन'),
    title: t('Life cycle of a payment run', 'पेमेंट रन का पूरा सफ़र'),
    flow: [
      { icon: CalendarClock, label: t('Pay on date, cash limit', 'पेमेंट की तारीख़, कैश लिमिट'), tone: 'action' },
      { icon: Sparkles, label: t('Suggest a run', 'Suggest a run'), tone: 'ai', edge: t('MSME, overdue, then due', 'MSME, ओवरड्यू, फिर ड्यू') },
      { icon: ListChecks, label: t('Untick what to hold', 'जो रोकना है, हटाएँ'), tone: 'action' },
      { icon: FileText, label: t('Save payment run', 'Save payment run'), tone: 'wait' },
      { icon: Download, label: t('Download bank file', 'बैंक फ़ाइल डाउनलोड'), tone: 'action' },
      { icon: Landmark, label: t('Upload to your bank', 'बैंक में अपलोड'), tone: 'action' },
      {
        branch: [
          { edge: t('Bank paid', 'बैंक ने भेजा'), flow: [{ icon: CircleCheck, label: t('Record as paid: posts', 'Record as paid: पोस्ट'), tone: 'done' }] },
          { edge: t('Not paying', 'नहीं भेजना'), flow: [{ icon: Ban, label: t('Cancel run', 'Cancel run'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Pay many vendors at once from one plan.', 'एक ही प्लान से कई वेंडरों को एक साथ पेमेंट करें।'),
      t('Let AiBooks pick the bills: MSME vendors first, then overdue, then what falls due by the pay date, within the cash you can spare.', 'AiBooks बिल चुनता है: पहले MSME वेंडर, फिर ओवरड्यू, फिर पेमेंट की तारीख़ तक ड्यू होने वाले, आपकी कैश लिमिट के अंदर।'),
      t('See why each bill is in the run, and hold any back.', 'देखें हर बिल रन में क्यों है, और जो चाहें रोकें।'),
      t('Download a bank file to upload to your bank, then record the run as paid.', 'बैंक फ़ाइल डाउनलोड करके बैंक में अपलोड करें, फिर रन को paid दर्ज करें।'),
    ],
    steps: [
      t('Set **Pay on** and, if you like, a cash limit.', '**Pay on** तारीख़ चुनें और चाहें तो कैश लिमिट डालें।'),
      t('Click **Suggest a run**. Untick anything to hold back, then click **Save payment run**.', '**Suggest a run** दबाएँ। जो बिल रोकना है उसका टिक हटाएँ, फिर **Save payment run** दबाएँ।'),
      t('Click **Download bank file** and upload it on your bank’s website.', '**Download bank file** दबाएँ और अपने बैंक की वेबसाइट पर अपलोड करें।'),
      t('Once the bank has paid, set **Paid on** and click **Record as paid**. This posts the payments.', 'बैंक से पैसा जाने के बाद **Paid on** तारीख़ भरें और **Record as paid** दबाएँ। इससे पेमेंट पोस्ट होते हैं।'),
      t('Not paying it after all? Click **Cancel run**; nothing has been paid from it.', 'पेमेंट नहीं करना? **Cancel run** दबाएँ; इससे कोई पेमेंट नहीं हुआ है।'),
    ],
    note: t('A vendor with no bank account on file is flagged: add it on the vendor’s page first.', 'जिस वेंडर का बैंक अकाउंट दर्ज नहीं, वह अलग दिखता है: पहले वेंडर के पेज पर अकाउंट जोड़ें।'),
  },

  vendorCredits: {
    section: t('Vendor Credits', 'वेंडर क्रेडिट'),
    title: t('Life cycle of a vendor credit (debit note)', 'वेंडर क्रेडिट (डेबिट नोट) का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: Undo2, label: t('Goods returned', 'माल वापस'), tone: 'neutral' }] },
          { flow: [{ icon: PackageCheck, label: t('Short supply', 'कम माल आया'), tone: 'neutral' }] },
          { flow: [{ icon: Percent, label: t('Overcharged', 'ज़्यादा चार्ज'), tone: 'neutral' }] },
        ],
      },
      { icon: FilePlus2, label: t('New vendor credit on a posted bill', 'पोस्ट हुए बिल पर नया वेंडर क्रेडिट'), tone: 'action' },
      { icon: CircleCheck, label: t('Post vendor credit', 'Post vendor credit'), tone: 'done' },
      {
        branch: [
          { edge: t('Within what you owe', 'बकाया के अंदर'), flow: [{ icon: CircleCheck, label: t('You owe less', 'देनदारी घटी'), tone: 'done' }] },
          {
            edge: t('More than owed', 'बकाया से ज़्यादा'),
            flow: [
              { icon: Wallet, label: t('Credit with vendor', 'वेंडर के पास क्रेडिट'), tone: 'wait' },
              { icon: RotateCcw, label: t('Apply or refund received', 'लगाएँ या रिफ़ंड लें'), tone: 'action' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Correct a posted bill for goods returned, a short supply or an overcharge, without editing the bill.', 'माल वापसी, कम सप्लाई या ज़्यादा चार्ज के लिए पोस्ट हुए बिल को बिना बदले सुधारें।'),
      t('Enter it item by item (taxed as the bill was, each line coming back off its account, with a discount and adjustment), or as an amount before tax with the GST in the bill’s own proportions.', 'इसे आइटम के हिसाब से भरें (बिल की तरह टैक्स, हर लाइन अपने अकाउंट से वापस, डिस्काउंट और एडजस्टमेंट के साथ), या टैक्स से पहले की एक रकम के रूप में, जिस पर GST बिल के अनुपात में लगता है।'),
      t('It never takes back more value or GST than the bill has left, and your input credit in GSTR-3B drops by its GST.', 'यह बिल में बची रकम या GST से ज़्यादा वापस नहीं लेता, और GSTR-3B में आपका इनपुट क्रेडिट उसके GST जितना घटता है।'),
      t('Use a credit left with the vendor against a bill, or record the refund they send.', 'वेंडर के पास बचा क्रेडिट किसी बिल पर लगाएँ, या उनसे मिला रिफ़ंड दर्ज करें।'),
      t('See every vendor credit with the vendor’s credit note number, its reason and bill.', 'हर वेंडर क्रेडिट वेंडर के क्रेडिट नोट नंबर, वजह और बिल के साथ देखें।'),
    ],
    steps: [
      t('Click **New vendor credit** (or **Vendor credit** on a posted bill’s page), pick the vendor and the bill it corrects.', '**New vendor credit** दबाएँ (या पोस्ट हुए बिल के पेज पर **Vendor credit**), वेंडर और वह बिल चुनें जिसे यह सुधारता है।'),
      t('Enter the vendor’s **Credit note#**, the **Order number**, the date and the **Subject**.', 'वेंडर का **Credit note#**, **Order number**, तारीख़ और **Subject** भरें।'),
      t('**Item by item**: add the lines (or **Copy the bill’s lines** and change them), with the discount and adjustment. **An amount before tax**: enter the amount and the reason.', '**Item by item**: लाइनें भरें (या **Copy the bill’s lines** दबाकर बदलें), डिस्काउंट और एडजस्टमेंट के साथ। **An amount before tax**: रकम और वजह भरें।'),
      t('Click **Post vendor credit**. It posts straight away.', '**Post vendor credit** दबाएँ। यह तुरंत पोस्ट होता है।'),
      t('If a credit is left, use **Apply advance** or **Record refund received** on **Payments Made**.', 'क्रेडिट बचे तो **Payments Made** पर **Apply advance** या **Record refund received** दबाएँ।'),
    ],
    note: t('Goods sent back leave stock through **Stock → Adjust stock**: a vendor credit does not move stock.', 'वापस भेजा माल **Stock → Adjust stock** से स्टॉक से घटाएँ: वेंडर क्रेडिट से स्टॉक नहीं घटता।'),
  },

  claims: {
    section: t('Employee Claims', 'कर्मचारी क्लेम'),
    title: t('Life cycle of an employee claim', 'कर्मचारी क्लेम का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('New claim', 'नया क्लेम'), tone: 'action' },
      { icon: Paperclip, label: t('Save claim, attach receipts', 'Save claim, रसीदें लगाएँ'), tone: 'action' },
      { icon: Send, label: t('Submit claim', 'Submit claim'), tone: 'action' },
      { icon: UserCheck, label: t('Someone else approves', 'कोई और मंज़ूर करे'), tone: 'wait' },
      {
        branch: [
          {
            edge: t('Approved', 'मंज़ूर'),
            flow: [
              { icon: CircleCheck, label: t('Post claim', 'Post claim'), tone: 'done' },
              { icon: HandCoins, label: t('Record reimbursement', 'Record reimbursement'), tone: 'done' },
            ],
          },
          { edge: t('Sent back', 'वापस भेजा'), flow: [{ icon: Undo2, label: t('Back to draft, with the reason', 'वजह के साथ ड्राफ़्ट में'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Claim money spent for the business, line by line, with the account and any GST.', 'कारोबार के लिए ख़र्च किया पैसा लाइन-दर-लाइन क्लेम करें, अकाउंट और GST के साथ।'),
      t('Claim travel in your own vehicle by the kilometre.', 'अपनी गाड़ी से सफ़र का क्लेम किलोमीटर के हिसाब से करें।'),
      t('Attach a receipt to each line; the policy flags missing receipts, duplicates, weekends and amounts over the limit.', 'हर लाइन पर रसीद लगाएँ; पॉलिसी बिना रसीद, डुप्लिकेट, छुट्टी के दिन और लिमिट से ज़्यादा रकम को चिह्नित करती है।'),
      t('Someone other than the employee always approves; an accountant posts it and records the reimbursement.', 'मंज़ूरी हमेशा कर्मचारी के अलावा कोई और देता है; अकाउंटेंट पोस्ट करता है और पैसा लौटाना दर्ज करता है।'),
    ],
    steps: [
      t('Click **New claim** and give it a title, like “Client visit, Pune”.', '**New claim** दबाएँ और नाम दें, जैसे “Client visit, Pune”।'),
      t('Add a line for each expense: date, what for, account, amount and GST. Click **Save claim**.', 'हर खर्च की लाइन जोड़ें: तारीख़, किस लिए, अकाउंट, रकम और GST। **Save claim** दबाएँ।'),
      t('On the claim’s page, click **Attach receipt** on each line, then **Submit claim**.', 'क्लेम के पेज पर हर लाइन में **Attach receipt** दबाएँ, फिर **Submit claim**।'),
      t('Another person approves it on **Approvals**. If it is sent back, fix it and submit again.', 'कोई दूसरा व्यक्ति **Approvals** में मंज़ूरी देता है। वापस आए तो ठीक करके फिर सबमिट करें।'),
      t('The accountant clicks **Post claim**, and **Record reimbursement** once the employee is paid.', 'अकाउंटेंट **Post claim** दबाता है, और कर्मचारी को पैसा मिलने पर **Record reimbursement**।'),
    ],
    note: t('An employee sees only their own claims.', 'कर्मचारी को सिर्फ़ अपने क्लेम दिखते हैं।'),
  },
};
