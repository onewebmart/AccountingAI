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
      { icon: FilePlus2, label: t('New expense', 'नया खर्च'), tone: 'action' },
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
      t('Claim the GST when you have the supplier’s GSTIN; without it, the GST is part of the expense.', 'सप्लायर का GSTIN हो तो GST का क्रेडिट लें; न हो तो GST खर्च में ही जुड़ जाता है।'),
      t('Keep it as a draft, or save and post it at once as one payment voucher.', 'इसे ड्राफ़्ट में रखें, या एक ही बार में सेव करके पेमेंट वाउचर के रूप में पोस्ट करें।'),
      t('Tag it to a project, and attach the receipt on the expense’s page.', 'इसे किसी प्रोजेक्ट से जोड़ें, और खर्च के पेज पर रसीद लगाएँ।'),
    ],
    steps: [
      t('Click **New expense**. Enter the date, the **Expense account** and the bank or cash account it was **Paid through**.', '**New expense** दबाएँ। तारीख़, **Expense account** और जिस बैंक या कैश से पैसा गया (**Paid through**) वह भरें।'),
      t('Enter the amount before tax and the GST rate. Tick **Inter-state (IGST)** if the supplier is in another state.', 'टैक्स से पहले की रकम और GST रेट भरें। सप्लायर दूसरे राज्य का हो तो **Inter-state (IGST)** पर टिक करें।'),
      t('To claim the GST, pick the vendor or type the **Supplier’s GSTIN**.', 'GST क्रेडिट लेना हो तो वेंडर चुनें या **Supplier’s GSTIN** भरें।'),
      t('Click **Save expense** for a draft, or **Save and post** to post it now.', 'ड्राफ़्ट के लिए **Save expense** दबाएँ, या अभी पोस्ट करने के लिए **Save and post**।'),
      t('A draft posts later with **Post to ledger** on its page. Attach the receipt there too.', 'ड्राफ़्ट बाद में उसके पेज पर **Post to ledger** से पोस्ट होता है। रसीद भी वहीं लगाएँ।'),
    ],
    note: t('Expenses are numbered EXP/2026-27/0001 and on, with no gaps.', 'खर्च के नंबर EXP/2026-27/0001 से आगे बिना किसी गैप के लगते हैं।'),
  },

  recurringExpenses: {
    section: t('Recurring Expenses', 'रिकरिंग खर्च'),
    title: t('Life cycle of a recurring expense', 'रिकरिंग खर्च का पूरा सफ़र'),
    flow: [
      { icon: Repeat, label: t('New recurring expense', 'नया रिकरिंग खर्च'), tone: 'action' },
      { icon: CalendarClock, label: t('Monthly, quarterly or yearly', 'हर महीने, तिमाही या साल'), tone: 'wait' },
      { icon: FilePen, label: t('Drafted on its date at 6:30', 'तय दिन सुबह 6:30 पर ड्राफ़्ट'), tone: 'wait' },
      { icon: ClipboardCheck, label: t('Check this month’s amount', 'इस महीने की रकम जाँचें'), tone: 'action' },
      { icon: CircleCheck, label: t('Post to ledger', 'Post to ledger'), tone: 'done' },
    ],
    can: [
      t('Set up costs that come round again, paid straight from bank or cash: rent, internet, a software plan.', 'बार-बार आने वाले खर्च सेट करें जो सीधे बैंक या कैश से जाते हैं: किराया, इंटरनेट, सॉफ़्टवेयर प्लान।'),
      t('Each one is drafted as an expense on its date, marked as made by the schedule.', 'हर बार तय दिन पर खर्च का ड्राफ़्ट बनता है, जिस पर लिखा होता है कि शेड्यूल से बना।'),
      t('Check this month’s amount before posting; nothing posts on its own.', 'पोस्ट करने से पहले इस महीने की रकम जाँचें; अपने-आप कुछ पोस्ट नहीं होता।'),
      t('Pause, resume or end a schedule at any time.', 'शेड्यूल कभी भी रोकें, फिर चालू करें या ख़त्म करें।'),
    ],
    steps: [
      t('Click **New recurring expense** and give it a name.', '**New recurring expense** दबाएँ और नाम दें।'),
      t('Pick the expense account, the bank or cash account it is paid through, the amount and GST.', 'Expense account, जिस बैंक या कैश से पैसा जाता है, रकम और GST भरें।'),
      t('Set how often, the day, and the start and end dates. Click **Save recurring expense**.', 'कितनी बार, कौन-सा दिन, और शुरू व ख़त्म होने की तारीख़ भरें। **Save recurring expense** दबाएँ।'),
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
      t('Raise a PO with the vendor, needed-by date and lines, and email it as a PDF.', 'वेंडर, ज़रूरत की तारीख़ और लाइनों के साथ PO बनाएँ और PDF ईमेल करें।'),
      t('Record goods as they arrive, with the vendor’s challan number (a goods received note).', 'माल आने पर वेंडर के चालान नंबर के साथ दर्ज करें (goods received note)।'),
      t('Bill only what was received, as a draft bill you post from its page.', 'सिर्फ़ मिले माल का ड्राफ़्ट बिल बनाएँ, जिसे उसके पेज से पोस्ट करें।'),
      t('Let the 3-way match flag differences between the PO, what came and the bill, before you pay.', '3-वे मिलान से PO, मिले माल और बिल के बीच का फ़र्क़ पेमेंट से पहले पकड़ें।'),
    ],
    steps: [
      t('Click **New purchase order**, pick the vendor and the needed-by date, add the lines and click **Raise purchase order**.', '**New purchase order** दबाएँ, वेंडर और ज़रूरत की तारीख़ चुनें, लाइनें भरें और **Raise purchase order** दबाएँ।'),
      t('On its page, click **Send PO** to email it to the vendor.', 'उसके पेज पर **Send PO** दबाकर वेंडर को ईमेल करें।'),
      t('When goods arrive, under **Receive goods** enter the quantities and the vendor’s challan number, then **Record goods received**.', 'माल आने पर **Receive goods** में मात्रा और वेंडर का चालान नंबर भरें, फिर **Record goods received** दबाएँ।'),
      t('Under **Bill**, enter the vendor’s bill number and click **Make draft bill**. Post it from the bill’s page.', '**Bill** में वेंडर का बिल नंबर भरें और **Make draft bill** दबाएँ। बिल के पेज से उसे पोस्ट करें।'),
      t('Click **Close** or **Cancel PO** when nothing more will come.', 'और माल न आना हो तो **Close** या **Cancel PO** दबाएँ।'),
    ],
    note: t('A PO never posts. Lines to look at in the 3-way match are marked **Check before paying** on the bill.', 'PO से कोई एंट्री नहीं होती। 3-वे मिलान में जिन लाइनों पर ध्यान देना है, बिल पर **Check before paying** लिखा आता है।'),
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
          { edge: t('Wrong', 'ग़लती'), flow: [{ icon: Undo2, label: t('Debit note', 'डेबिट नोट'), tone: 'action' }] },
        ],
      },
    ],
    can: [
      t('Upload a bill and let AI read it into Review, or type it in yourself.', 'बिल अपलोड करें और AI उसे पढ़कर Review में रखे, या ख़ुद टाइप करें।'),
      t('Post it to the ledger. If an approval policy covers it, a second person approves it first.', 'उसे लेजर में पोस्ट करें। अगर मंज़ूरी की पॉलिसी लागू है, तो पहले कोई दूसरा व्यक्ति मंज़ूरी देता है।'),
      t('TDS is deducted when it posts, if the vendor has a TDS section.', 'वेंडर का TDS सेक्शन हो, तो पोस्ट होते समय TDS कट जाता है।'),
      t('See when each bill is due, and for MSME vendors the 43B(h) pay-by date.', 'हर बिल की ड्यू डेट देखें, और MSME वेंडर के लिए 43B(h) की आख़िरी तारीख़।'),
      t('Pay it in part or in full, or correct it with a debit note.', 'थोड़ा या पूरा भुगतान करें, या डेबिट नोट से सुधारें।'),
    ],
    steps: [
      t('Scanned: click **Upload bill**, then approve it in **Review** with **Approve & post**.', 'स्कैन बिल: **Upload bill** दबाएँ, फिर **Review** में **Approve & post** दबाएँ।'),
      t('Typed: click **New bill**, pick the vendor, enter their bill number, dates and lines, then **Save bill**. It is a draft.', 'टाइप करके: **New bill** दबाएँ, वेंडर चुनें, उनका बिल नंबर, तारीख़ और लाइनें भरें, फिर **Save bill**। यह ड्राफ़्ट है।'),
      t('On the bill’s page, click **Post to ledger**. If an approval policy covers it, the page says so, and it posts once approved on **Approvals**.', 'बिल के पेज पर **Post to ledger** दबाएँ। अगर मंज़ूरी की पॉलिसी लागू है, तो पेज पर यह लिखा आएगा, और **Approvals** में मंज़ूरी मिलते ही पोस्ट होगा।'),
      t('To pay, enter the amount and date and click **Record payment**, or pay many bills from **Payments Made** or **Payment Runs**.', 'पेमेंट के लिए रकम और तारीख़ भरकर **Record payment** दबाएँ, या **Payments Made** या **Payment Runs** से कई बिल एक साथ चुकाएँ।'),
      t('For goods returned or an overcharge, click **Debit note** on the bill’s page.', 'माल वापसी या ज़्यादा चार्ज के लिए बिल के पेज पर **Debit note** दबाएँ।'),
    ],
    note: t('The AI never posts a bill by itself: a person approves every one in Review.', 'AI कभी अपने-आप बिल पोस्ट नहीं करता: हर बिल को Review में कोई व्यक्ति मंज़ूर करता है।'),
  },

  recurringBills: {
    section: t('Recurring Bills', 'रिकरिंग बिल'),
    title: t('Life cycle of a recurring bill', 'रिकरिंग बिल का पूरा सफ़र'),
    flow: [
      { icon: Repeat, label: t('New recurring bill', 'नया रिकरिंग बिल'), tone: 'action' },
      { icon: CalendarClock, label: t('Monthly, quarterly or yearly', 'हर महीने, तिमाही या साल'), tone: 'wait' },
      { icon: FilePen, label: t('Bill drafted at 6:30', 'सुबह 6:30 पर बिल ड्राफ़्ट'), tone: 'wait' },
      { icon: CircleCheck, label: t('You check and post', 'आप जाँचकर पोस्ट करें'), tone: 'done' },
      { icon: HandCoins, label: t('Pay it', 'भुगतान करें'), tone: 'action' },
    ],
    can: [
      t('Set up bills that repeat: rent, a subscription, a maintenance contract.', 'बार-बार आने वाले बिल सेट करें: किराया, सब्सक्रिप्शन, मेंटेनेंस कॉन्ट्रैक्ट।'),
      t('Each one is drafted as a bill on its date, ready on **Bills** to check and post.', 'हर बार तय दिन पर बिल ड्राफ़्ट बनता है, जो **Bills** में जाँचने और पोस्ट करने के लिए तैयार रहता है।'),
      t('Nothing posts on its own.', 'अपने-आप कुछ पोस्ट नहीं होता।'),
      t('Pause, resume or end a schedule at any time.', 'शेड्यूल कभी भी रोकें, फिर चालू करें या ख़त्म करें।'),
    ],
    steps: [
      t('Click **New recurring bill** and give it a name.', '**New recurring bill** दबाएँ और नाम दें।'),
      t('Pick the vendor, the amount before tax and the GST rate, how often, the day, the dates and when each bill is due.', 'वेंडर, टैक्स से पहले की रकम, GST रेट, कितनी बार, दिन, तारीख़ें और हर बिल कब ड्यू होगा, भरें।'),
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
      { icon: FilePlus2, label: t('New debit note on a posted bill', 'पोस्ट हुए बिल पर डेबिट नोट'), tone: 'action' },
      { icon: CircleCheck, label: t('Post debit note', 'Post debit note'), tone: 'done' },
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
      t('Enter the amount before tax; the GST follows the bill’s own rates.', 'टैक्स से पहले की रकम भरें; GST बिल के रेट के हिसाब से लगता है।'),
      t('Use a credit left with the vendor against a bill, or record the refund they send.', 'वेंडर के पास बचा क्रेडिट किसी बिल पर लगाएँ, या उनसे मिला रिफ़ंड दर्ज करें।'),
      t('See every debit note with its reason and bill.', 'हर डेबिट नोट उसकी वजह और बिल के साथ देखें।'),
    ],
    steps: [
      t('Click **New debit note** (or **Debit note** on a posted bill’s page) and choose the bill.', '**New debit note** दबाएँ (या पोस्ट हुए बिल के पेज पर **Debit note**) और बिल चुनें।'),
      t('Enter the amount before tax to take off, the date and the reason.', 'घटाने वाली रकम (टैक्स से पहले), तारीख़ और वजह भरें।'),
      t('Click **Post debit note**. It posts straight away.', '**Post debit note** दबाएँ। यह तुरंत पोस्ट होता है।'),
      t('If a credit is left, use **Apply advance** or **Record refund received** on **Payments Made**.', 'क्रेडिट बचे तो **Payments Made** पर **Apply advance** या **Record refund received** दबाएँ।'),
    ],
    note: t('Goods sent back leave stock through **Stock → Adjust stock**: a debit note carries amounts, not quantities.', 'वापस भेजा माल **Stock → Adjust stock** से स्टॉक से घटाएँ: डेबिट नोट में सिर्फ़ रकम होती है, मात्रा नहीं।'),
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
