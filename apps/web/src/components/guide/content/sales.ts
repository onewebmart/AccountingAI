import {
  Ban,
  BellRing,
  CalendarClock,
  CircleCheck,
  CircleX,
  ClipboardList,
  Clock,
  FilePen,
  FilePlus2,
  FileText,
  HandCoins,
  Link2,
  MessageSquareText,
  PackageCheck,
  Percent,
  Repeat,
  RotateCcw,
  Send,
  ShoppingCart,
  Sparkles,
  Truck,
  Undo2,
  UserPlus,
  Wallet,
  QrCode,
} from 'lucide-react';
import type { AreaKeys } from '../keys';
import { t, type Guide } from '../types';

export const SALES_GUIDES: Record<AreaKeys<'sales'>, Guide> = {
  customers: {
    section: t('Customers', 'ग्राहक'),
    title: t('Life cycle of a customer', 'ग्राहक का पूरा सफ़र'),
    flow: [
      { icon: UserPlus, label: t('Add customer', 'ग्राहक जोड़ें'), tone: 'action' },
      { icon: FileText, label: t('Raise invoices', 'इनवॉइस बनाएँ'), tone: 'action' },
      { icon: Link2, label: t('Share portal link', 'पोर्टल लिंक भेजें'), tone: 'action' },
      {
        branch: [
          { edge: t('Pays', 'पेमेंट किया'), flow: [{ icon: HandCoins, label: t('Receipt recorded', 'पेमेंट दर्ज'), tone: 'done' }] },
          {
            edge: t('Pays extra', 'ज़्यादा दिया'),
            flow: [
              { icon: Wallet, label: t('Advance held', 'एडवांस जमा'), tone: 'wait' },
              { icon: RotateCcw, label: t('Apply or refund', 'लगाएँ या लौटाएँ'), tone: 'action' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Keep each customer’s GSTIN, state, address and contacts. The state is the place of supply on your GSTR-1.', 'हर ग्राहक का GSTIN, राज्य, पता और संपर्क रखें। यही राज्य GSTR-1 में place of supply बनता है।'),
      t('See what each customer owes, what is past the due date, and any advance or credit they hold.', 'देखें किस ग्राहक पर कितना बाकी है, कितना ड्यू डेट निकलने के बाद भी बाकी है, और उनका कोई एडवांस या क्रेडिट।'),
      t('Start a **New invoice** or **Record receipt** straight from the customer’s page.', 'ग्राहक के पेज से सीधे **New invoice** या **Record receipt** शुरू करें।'),
      t('Send a portal link: for 30 days, without a login, they see their invoices, download PDFs and pay.', 'पोर्टल लिंक भेजें: 30 दिन तक, बिना लॉगिन, ग्राहक अपने इनवॉइस देख सकते हैं, PDF ले सकते हैं और पेमेंट कर सकते हैं।'),
      t('Keep files such as a rate agreement in the customer’s attachments.', 'रेट एग्रीमेंट जैसी फ़ाइलें ग्राहक के attachments में रखें।'),
    ],
    steps: [
      t('Click **New customer**, or the **+** beside Customers in the sidebar.', '**New customer** दबाएँ, या साइडबार में Customers के पास **+** दबाएँ।'),
      t('Enter the name and the GSTIN. Leave the GSTIN blank if they are not registered, and pick the state instead.', 'नाम और GSTIN भरें। अगर ग्राहक GST में रजिस्टर्ड नहीं है तो GSTIN खाली छोड़ें और राज्य चुनें।'),
      t('Add the address, city, pincode, email and phone, then click **Save customer**.', 'पता, शहर, पिनकोड, ईमेल और फ़ोन भरें, फिर **Save customer** दबाएँ।'),
      t('On the customer’s page, click **New invoice** to bill them, or **Record receipt** when they pay.', 'ग्राहक के पेज पर बिल बनाने के लिए **New invoice** दबाएँ, और पैसा मिलने पर **Record receipt**।'),
      t('Click **Copy portal link** and send it to them. **Withdraw links** cancels every live link.', '**Copy portal link** दबाकर लिंक ग्राहक को भेजें। **Withdraw links** से सारे चालू लिंक बंद हो जाते हैं।'),
    ],
    note: t('A customer’s GSTIN decides CGST + SGST (same state) or IGST (another state) on every invoice.', 'ग्राहक का GSTIN तय करता है कि इनवॉइस पर CGST + SGST (एक ही राज्य) लगेगा या IGST (दूसरा राज्य)।'),
  },

  quotes: {
    section: t('Quotes', 'कोटेशन'),
    title: t('Life cycle of a quote', 'कोटेशन का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: FilePlus2, label: t('New quote', 'नया कोटेशन'), tone: 'action' }] },
          { flow: [{ icon: MessageSquareText, label: t('Draft from a message', 'मैसेज से ड्राफ़्ट'), tone: 'ai' }] },
        ],
      },
      { icon: FilePen, label: t('Draft', 'ड्राफ़्ट'), tone: 'neutral' },
      { icon: Send, label: t('Send quote', 'कोटेशन भेजें'), tone: 'action' },
      { icon: Clock, label: t('Sent, waiting for an answer', 'भेजा, जवाब का इंतज़ार'), tone: 'wait' },
      {
        branch: [
          {
            edge: t('Yes', 'हाँ'),
            flow: [
              { icon: CircleCheck, label: t('Accepted', 'मंज़ूर'), tone: 'done' },
              { icon: ShoppingCart, label: t('Make order or invoice', 'ऑर्डर या इनवॉइस बनाएँ'), tone: 'action' },
            ],
          },
          { edge: t('No', 'नहीं'), flow: [{ icon: CircleX, label: t('Declined', 'मना किया'), tone: 'neutral' }] },
          { edge: t('No reply', 'जवाब नहीं'), flow: [{ icon: CalendarClock, label: t('Expired after valid until', 'तारीख़ निकल गई'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Make a quote by hand, or paste a customer’s email or WhatsApp message and let AI draft it at their last prices.', 'कोटेशन ख़ुद बनाएँ, या ग्राहक का ईमेल या WhatsApp मैसेज पेस्ट करें; AI उनके पिछले रेट पर ड्राफ़्ट बना देगा।'),
      t('Email the quote as a PDF and mark the answer: **Accepted** or **Declined**.', 'कोटेशन PDF में ईमेल करें और जवाब दर्ज करें: **Accepted** या **Declined**।'),
      t('Turn an accepted quote into a sales order or a draft invoice in one click.', 'मंज़ूर हुए कोटेशन से एक क्लिक में सेल्स ऑर्डर या ड्राफ़्ट इनवॉइस बनाएँ।'),
      t('Chase quotes with no answer after a week, with a ready follow-up message.', 'एक हफ़्ते से जवाब न आए तो तैयार फ़ॉलो-अप मैसेज से याद दिलाएँ।'),
    ],
    steps: [
      t('Click **New quote**, pick the customer and **Valid until**, add the lines, then click **Save quote**.', '**New quote** दबाएँ, ग्राहक और **Valid until** चुनें, लाइनें जोड़ें, फिर **Save quote** दबाएँ।'),
      t('Or, under **Draft from a message** on this page, pick the customer, paste their message and click **Draft quote**. Check every line the AI filled.', 'या इसी पेज पर **Draft from a message** में ग्राहक चुनें, उनका मैसेज पेस्ट करें और **Draft quote** दबाएँ। AI की भरी हर लाइन ख़ुद जाँचें।'),
      t('On the quote’s page, click **Send quote** to email the PDF.', 'कोटेशन के पेज पर **Send quote** दबाकर PDF ईमेल करें।'),
      t('When they answer, click **Accepted** or **Declined**.', 'जवाब आने पर **Accepted** या **Declined** दबाएँ।'),
      t('From an accepted quote, click **Make order** or **Make invoice**. You are taken to what it made.', 'मंज़ूर कोटेशन पर **Make order** या **Make invoice** दबाएँ। जो बना, वहीं पहुँच जाएँगे।'),
    ],
    note: t('A quote never touches your books. Only the invoice made from it does, once you post it.', 'कोटेशन से खातों में कुछ नहीं बदलता। उससे बना इनवॉइस पोस्ट करने पर ही एंट्री होती है।'),
  },

  salesOrders: {
    section: t('Sales Orders', 'सेल्स ऑर्डर'),
    title: t('Life cycle of a sales order', 'सेल्स ऑर्डर का पूरा सफ़र'),
    flow: [
      { icon: ShoppingCart, label: t('New sales order', 'नया सेल्स ऑर्डर'), tone: 'action' },
      { icon: Clock, label: t('Open', 'चालू'), tone: 'wait' },
      {
        branch: [
          { edge: t('Bill', 'बिलिंग'), flow: [{ icon: FileText, label: t('Make draft invoice', 'ड्राफ़्ट इनवॉइस बनाएँ'), tone: 'action' }] },
          { edge: t('Deliver', 'डिलीवरी'), flow: [{ icon: Truck, label: t('Challan against it', 'इस पर चालान'), tone: 'action' }] },
        ],
      },
      {
        branch: [
          { edge: t('All invoiced', 'सब बिल हुआ'), flow: [{ icon: CircleCheck, label: t('Closed', 'बंद'), tone: 'done' }] },
          { edge: t('Stop early', 'बीच में रोकें'), flow: [{ icon: Ban, label: t('Close or cancel order', 'Close या Cancel order'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Record what a customer ordered, with their PO number and the expected date.', 'ग्राहक ने क्या ऑर्डर किया, उनके PO नंबर और अपेक्षित तारीख़ के साथ दर्ज करें।'),
      t('Invoice all of it or part of it. You cannot bill more than was ordered.', 'पूरा या थोड़ा-थोड़ा बिल करें। ऑर्डर से ज़्यादा बिल नहीं हो सकता।'),
      t('See each line as ordered, invoiced and delivered under challans.', 'हर लाइन देखें: कितना ऑर्डर हुआ, कितना बिल हुआ, कितना चालान से डिलीवर हुआ।'),
      t('Close the order when you will not bill the rest, or cancel it before anything is invoiced.', 'बाकी बिल नहीं करना हो तो ऑर्डर बंद करें; कुछ भी बिल होने से पहले उसे कैंसिल भी कर सकते हैं।'),
    ],
    steps: [
      t('Click **New sales order**, pick the customer, add their PO number and the lines, then click **Save sales order**.', '**New sales order** दबाएँ, ग्राहक चुनें, उनका PO नंबर और लाइनें भरें, फिर **Save sales order** दबाएँ।'),
      t('On the order’s page, under **Invoice part of it**, enter the quantities to bill and click **Make draft invoice**.', 'ऑर्डर के पेज पर **Invoice part of it** में बिल करने की मात्रा भरें और **Make draft invoice** दबाएँ।'),
      t('Open the draft invoice, check it and click **Post to ledger**.', 'ड्राफ़्ट इनवॉइस खोलें, जाँचें और **Post to ledger** दबाएँ।'),
      t('When every line is invoiced, the order closes by itself. To stop early, click **Close**, or **Cancel order** if nothing is billed yet.', 'हर लाइन बिल होते ही ऑर्डर अपने-आप बंद हो जाता है। पहले रोकना हो तो **Close** दबाएँ, या कुछ बिल न हुआ हो तो **Cancel order**।'),
    ],
    note: t('An order does not post. It becomes a draft invoice, which you post from its own page.', 'ऑर्डर से कोई एंट्री नहीं होती। उससे ड्राफ़्ट इनवॉइस बनता है, जिसे आप उसके पेज से पोस्ट करते हैं।'),
  },

  invoices: {
    section: t('Invoices', 'इनवॉइस'),
    title: t('Life cycle of an invoice', 'इनवॉइस का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: FilePlus2, label: t('New invoice', 'नया इनवॉइस'), tone: 'action' }] },
          { flow: [{ icon: ClipboardList, label: t('From order, quote or time', 'ऑर्डर, कोटेशन या टाइम से'), tone: 'action' }] },
          { flow: [{ icon: Repeat, label: t('Recurring schedule', 'रिकरिंग शेड्यूल'), tone: 'wait' }] },
        ],
      },
      { icon: FilePen, label: t('Draft', 'ड्राफ़्ट'), tone: 'neutral' },
      { icon: CircleCheck, label: t('Post to ledger', 'Post to ledger'), tone: 'done' },
      { icon: Send, label: t('Send: PDF, email, portal', 'भेजें: PDF, ईमेल, पोर्टल'), tone: 'action', edge: t('Numbered, in the books', 'नंबर लगा, खातों में दर्ज') },
      { icon: QrCode, label: t('E-invoice IRN, e-way bill', 'ई-इनवॉइस IRN, ई-वे बिल'), tone: 'action', edge: t('If needed', 'ज़रूरत हो तो') },
      {
        branch: [
          { edge: t('Partly', 'कुछ'), flow: [{ icon: Wallet, label: t('Part paid', 'आंशिक भुगतान'), tone: 'wait' }] },
          { edge: t('Fully', 'पूरा'), flow: [{ icon: HandCoins, label: t('Paid', 'पूरा भुगतान'), tone: 'done' }] },
          { edge: t('Late', 'देर'), flow: [{ icon: BellRing, label: t('Overdue: reminders', 'ओवरड्यू: रिमाइंडर'), tone: 'error' }] },
        ],
      },
      { icon: Undo2, label: t('Credit note if needed', 'ज़रूरत हो तो क्रेडिट नोट'), tone: 'action' },
    ],
    can: [
      t('Raise an invoice by hand, from a sales order, quote or project time, or let a recurring schedule draft it.', 'इनवॉइस ख़ुद बनाएँ, या सेल्स ऑर्डर, कोटेशन या प्रोजेक्ट के टाइम से बनाएँ, या रिकरिंग शेड्यूल से अपने-आप ड्राफ़्ट होने दें।'),
      t('Let the server work out GST: CGST + SGST within your state, IGST across states.', 'GST सर्वर ख़ुद निकालता है: अपने राज्य में CGST + SGST, दूसरे राज्य में IGST।'),
      t('Send it as a PDF, by email, or through the customer portal; generate the e-invoice IRN and e-way bill.', 'PDF, ईमेल या ग्राहक पोर्टल से भेजें; ई-इनवॉइस IRN और ई-वे बिल बनाएँ।'),
      t('Get paid in part or in full: **Mark paid**, a receipt across many invoices, or an online payment link.', 'थोड़ा या पूरा पैसा लें: **Mark paid**, कई इनवॉइस पर एक रसीद, या ऑनलाइन पेमेंट लिंक।'),
      t('See what customers owe by how late, and send a reminder on any invoice.', 'देखें ग्राहकों पर कितना बाकी है और कितने दिन से, और किसी भी इनवॉइस पर रिमाइंडर भेजें।'),
      t('Upload an invoice made elsewhere: AI reads it and it waits in Review.', 'बाहर बना इनवॉइस अपलोड करें: AI उसे पढ़ता है और वह Review में रुकता है।'),
    ],
    steps: [
      t('Click **New invoice**, pick the customer, date and due date. Leave the number blank to number it automatically.', '**New invoice** दबाएँ, ग्राहक, तारीख़ और ड्यू डेट चुनें। नंबर खाली छोड़ें, वह अपने-आप लगेगा।'),
      t('Add a line for each thing sold: pick an **Item** to fill the HSN/SAC, rate and GST %, and enter the quantity.', 'हर बिकी चीज़ की लाइन जोड़ें: **Item** चुनें तो HSN/SAC, रेट और GST % भर जाते हैं, फिर मात्रा भरें।'),
      t('Click **Save invoice**. It is saved as a draft and changes nothing in the books yet.', '**Save invoice** दबाएँ। यह ड्राफ़्ट में सेव होता है, अभी खातों में कुछ नहीं बदलता।'),
      t('Check it, then click **Post to ledger**. It gets its number, and the toast says **Posted to ledger**. (Sent a draft yourself already? **Mark sent** on the draft records that.)', 'जाँचें, फिर **Post to ledger** दबाएँ। इसे नंबर मिलता है और नीचे **Posted to ledger** लिखा आता है। (ड्राफ़्ट ख़ुद भेज चुके हैं? ड्राफ़्ट पर **Mark sent** दबाकर दर्ज करें।)'),
      t('Send it: **PDF** or **Email invoice**, or let the customer open it from their portal link. Under **E-invoice and e-way bill**, click **Generate IRN** when needed.', 'भेजें: **PDF** या **Email invoice**, या ग्राहक अपने पोर्टल लिंक से खोल ले। ज़रूरत हो तो **E-invoice and e-way bill** में **Generate IRN** दबाएँ।'),
      t('When the money comes, click **Mark paid**, check the amount and date, and click **Record receipt**.', 'पैसा आने पर **Mark paid** दबाएँ, रकम और तारीख़ जाँचें, फिर **Record receipt** दबाएँ।'),
    ],
    note: t('A posted invoice is never edited. To correct it, raise a **Credit note** on its page.', 'पोस्ट हुआ इनवॉइस बदला नहीं जाता। ग़लती सुधारनी हो तो उसके पेज पर **Credit note** बनाएँ।'),
  },

  recurringInvoices: {
    section: t('Recurring Invoices', 'रिकरिंग इनवॉइस'),
    title: t('Life cycle of a recurring invoice', 'रिकरिंग इनवॉइस का पूरा सफ़र'),
    flow: [
      { icon: Repeat, label: t('Save schedule', 'शेड्यूल सेव करें'), tone: 'action' },
      { icon: CalendarClock, label: t('Monthly, quarterly or yearly', 'हर महीने, तिमाही या साल'), tone: 'wait' },
      { icon: FilePen, label: t('Drafted on its date at 6:30', 'तय दिन सुबह 6:30 पर ड्राफ़्ट'), tone: 'wait' },
      { icon: CircleCheck, label: t('You check and post', 'आप जाँचकर पोस्ट करें'), tone: 'done' },
      { icon: Send, label: t('Send to customer', 'ग्राहक को भेजें'), tone: 'action' },
      {
        branch: [
          { edge: t('Paid', 'पेमेंट मिला'), flow: [{ icon: HandCoins, label: t('Receipt recorded', 'पेमेंट दर्ज'), tone: 'done' }] },
          { edge: t('Not yet', 'अभी नहीं'), flow: [{ icon: BellRing, label: t('Payment reminders', 'पेमेंट रिमाइंडर'), tone: 'wait' }] },
        ],
      },
    ],
    can: [
      t('Bill rent, retainers and subscriptions on a schedule: every month, quarter or year, on the day you choose.', 'किराया, रिटेनर और सब्सक्रिप्शन शेड्यूल से बिल करें: हर महीने, तिमाही या साल, आपके चुने दिन।'),
      t('Each invoice is drafted at 6:30 in the morning on its date. Nothing posts on its own.', 'हर इनवॉइस अपनी तारीख़ पर सुबह 6:30 बजे ड्राफ़्ट होता है। अपने-आप कुछ पोस्ट नहीं होता।'),
      t('Pause, resume or end a schedule at any time. Drafts already made stay.', 'शेड्यूल कभी भी रोकें, फिर चालू करें या ख़त्म करें। जो ड्राफ़्ट बन चुके, वे बने रहते हैं।'),
      t('Remind customers automatically: 3 days before the due date, on the day, then 7, 15 and 30 days late.', 'ग्राहकों को अपने-आप याद दिलाएँ: ड्यू डेट से 3 दिन पहले, उसी दिन, फिर 7, 15 और 30 दिन देर होने पर।'),
    ],
    steps: [
      t('Click **New recurring invoice**, give it a name and pick the customer.', '**New recurring invoice** दबाएँ, नाम दें और ग्राहक चुनें।'),
      t('Add the lines, set how often, the day, the start and end dates, and when each invoice is due. Click **Save schedule**.', 'लाइनें भरें, कितनी बार, कौन-सा दिन, शुरू और ख़त्म होने की तारीख़, और हर इनवॉइस कब ड्यू होगा, चुनें। **Save schedule** दबाएँ।'),
      t('On its date, open **Invoices**, check the draft and click **Post to ledger**. **Draft what’s due** drafts anything due now.', 'तय दिन **Invoices** खोलें, ड्राफ़्ट जाँचें और **Post to ledger** दबाएँ। **Draft what’s due** से अभी ड्यू सब ड्राफ़्ट हो जाता है।'),
      t('Under **Payment reminders**, turn on **Send reminders automatically** and choose email or WhatsApp.', '**Payment reminders** में **Send reminders automatically** चालू करें और ईमेल या WhatsApp चुनें।'),
      t('Use the pause, resume or end buttons on a schedule’s row to change it.', 'शेड्यूल की लाइन पर pause, resume या end बटन से उसे बदलें।'),
    ],
  },

  challans: {
    section: t('Delivery Challans', 'डिलीवरी चालान'),
    title: t('Life cycle of a delivery challan', 'डिलीवरी चालान का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('New challan', 'नया चालान'), tone: 'action' },
      {
        branch: [
          { flow: [{ icon: Truck, label: t('Supply, invoiced later', 'सप्लाई, बिल बाद में'), tone: 'action' }] },
          { flow: [{ icon: PackageCheck, label: t('Job work or on approval', 'जॉब वर्क या अप्रूवल पर'), tone: 'action' }] },
        ],
      },
      { icon: Send, label: t('Issue challan', 'चालान जारी करें'), tone: 'wait' },
      {
        branch: [
          { edge: t('Sold', 'बिक गया'), flow: [{ icon: FileText, label: t('Invoice from the order', 'ऑर्डर से इनवॉइस'), tone: 'done' }] },
          { edge: t('Came back', 'वापस आया'), flow: [{ icon: Undo2, label: t('Returned', 'वापस'), tone: 'neutral' }] },
          { edge: t('Not going', 'नहीं जाना'), flow: [{ icon: Ban, label: t('Cancel challan', 'चालान रद्द'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Move goods without a tax invoice: supply invoiced later, job work, on approval, or another reason.', 'बिना टैक्स इनवॉइस के माल भेजें: बाद में बिल होने वाली सप्लाई, जॉब वर्क, अप्रूवल पर, या कोई और वजह।'),
      t('Raise it against a sales order, so the order shows what was delivered.', 'इसे सेल्स ऑर्डर पर बनाएँ, ताकि ऑर्डर में दिखे कि कितना डिलीवर हुआ।'),
      t('Print the challan as a PDF with the vehicle number.', 'गाड़ी नंबर के साथ चालान का PDF निकालें।'),
      t('Mark job-work or on-approval goods **Returned** when they come back, or cancel a challan.', 'जॉब वर्क या अप्रूवल वाला माल लौटने पर **Returned** दबाएँ, या चालान कैंसिल करें।'),
    ],
    steps: [
      t('Click **New challan** and pick the customer.', '**New challan** दबाएँ और ग्राहक चुनें।'),
      t('Choose **Why the goods move**, enter the vehicle number and the lines.', '**Why the goods move** में वजह चुनें, गाड़ी नंबर और लाइनें भरें।'),
      t('Click **Issue challan**, then **PDF** to print it.', '**Issue challan** दबाएँ, फिर छापने के लिए **PDF**।'),
      t('Goods sold are billed from the sales order with **Make draft invoice**.', 'बिका हुआ माल सेल्स ऑर्डर से **Make draft invoice** दबाकर बिल होता है।'),
      t('When job-work or approval goods come back, click **Returned**. If the goods do not go, click **Cancel challan**.', 'जॉब वर्क या अप्रूवल का माल लौटे तो **Returned** दबाएँ। माल न जाए तो **Cancel challan** दबाएँ।'),
    ],
    note: t('A challan never posts and is returned whole: there are no part returns. A supply challan is invoiced, not returned.', 'चालान से कोई एंट्री नहीं होती और वह पूरा ही वापस होता है, आधा नहीं। सप्लाई वाले चालान का इनवॉइस बनता है, वह वापस नहीं होता।'),
  },

  paymentsReceived: {
    section: t('Payments Received', 'मिले पेमेंट'),
    title: t('Life cycle of a payment received', 'मिले पेमेंट का पूरा सफ़र'),
    flow: [
      { icon: HandCoins, label: t('Customer pays', 'ग्राहक पेमेंट करता है'), tone: 'action', edge: t('Bank, cash, link, portal', 'बैंक, कैश, लिंक, पोर्टल') },
      { icon: FilePlus2, label: t('Record receipt', 'Record receipt'), tone: 'action' },
      { icon: Sparkles, label: t('Suggest allocation', 'Suggest allocation'), tone: 'ai' },
      { icon: Percent, label: t('Adjust, with any TDS', 'TDS के साथ ठीक करें'), tone: 'action' },
      {
        branch: [
          { edge: t('Exact', 'पूरा मिला'), flow: [{ icon: CircleCheck, label: t('Invoices settled', 'इनवॉइस चुकता'), tone: 'done' }] },
          {
            edge: t('Extra', 'ज़्यादा'),
            flow: [
              { icon: Wallet, label: t('Held as advance', 'एडवांस जमा'), tone: 'wait' },
              { icon: RotateCcw, label: t('Apply advance or refund', 'Apply advance या Refund'), tone: 'action' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Record one payment against many invoices, by bank or cash, with the UTR or cheque number.', 'एक पेमेंट को कई इनवॉइस पर दर्ज करें, बैंक या कैश से, UTR या चेक नंबर के साथ।'),
      t('Let AI suggest how to spread it: it reads the reference, finds an exact match, or takes the oldest first.', 'AI से सुझाव लें कि पैसा किन इनवॉइस पर लगे: वह रेफ़रेंस पढ़ता है, सही जोड़ ढूँढता है, या सबसे पुराना पहले लेता है।'),
      t('Enter TDS the customer deducted, so it counts as your credit.', 'ग्राहक ने जो TDS काटा, वह दर्ज करें, ताकि वह आपका क्रेडिट बने।'),
      t('Keep anything extra as an advance, then apply it to an invoice or refund it.', 'ज़्यादा आया पैसा एडवांस में रखें, फिर किसी इनवॉइस पर लगाएँ या लौटा दें।'),
    ],
    steps: [
      t('Click **Record receipt**, pick the customer, the amount, the date, and **Bank** or **Cash**.', '**Record receipt** दबाएँ, ग्राहक, रकम, तारीख़ और **Bank** या **Cash** चुनें।'),
      t('Add the reference (UTR, cheque number, or the invoice numbers it pays).', 'रेफ़रेंस भरें (UTR, चेक नंबर, या किन इनवॉइस का पैसा है)।'),
      t('Click **Suggest allocation**, check how it is spread, and add any **TDS** deducted.', '**Suggest allocation** दबाएँ, बँटवारा जाँचें, और कटा हुआ **TDS** भरें।'),
      t('Click **Record receipt**. It posts at once and the invoices show as paid.', '**Record receipt** दबाएँ। यह तुरंत पोस्ट होता है और इनवॉइस भुगतान हुए दिखते हैं।'),
      t('Under **Advances and credits — customers**, click **Apply advance** or **Refund** for money held.', '**Advances and credits — customers** में जमा पैसे के लिए **Apply advance** या **Refund** दबाएँ।'),
    ],
    note: t('The AI only suggests the split. Nothing is recorded until you click **Record receipt**.', 'AI सिर्फ़ बँटवारे का सुझाव देता है। **Record receipt** दबाने तक कुछ दर्ज नहीं होता।'),
  },

  creditNotes: {
    section: t('Credit Notes', 'क्रेडिट नोट'),
    title: t('Life cycle of a credit note', 'क्रेडिट नोट का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: Undo2, label: t('Goods returned', 'माल वापस'), tone: 'neutral' }] },
          { flow: [{ icon: Percent, label: t('Discount', 'छूट'), tone: 'neutral' }] },
          { flow: [{ icon: FilePen, label: t('Mistake on invoice', 'इनवॉइस में ग़लती'), tone: 'neutral' }] },
        ],
      },
      { icon: FilePlus2, label: t('New credit note on a posted invoice', 'पोस्ट हुए इनवॉइस पर क्रेडिट नोट'), tone: 'action' },
      { icon: CircleCheck, label: t('Post credit note', 'Post credit note'), tone: 'done', edge: t('Posts at once', 'तुरंत पोस्ट') },
      { icon: HandCoins, label: t('Customer owes less', 'ग्राहक का बकाया घटा'), tone: 'done' },
      {
        branch: [
          { edge: t('Within what is owed', 'बकाया के अंदर'), flow: [{ icon: CircleCheck, label: t('Invoice reduced', 'इनवॉइस घटा'), tone: 'done' }] },
          {
            edge: t('More than owed', 'बकाया से ज़्यादा'),
            flow: [
              { icon: Wallet, label: t('Becomes their credit', 'उनका क्रेडिट'), tone: 'wait' },
              { icon: RotateCcw, label: t('Apply or refund', 'लगाएँ या लौटाएँ'), tone: 'action' },
            ],
          },
        ],
      },
    ],
    can: [
      t('Correct a posted invoice for goods returned, a discount or a mistake, without editing the invoice.', 'माल वापसी, छूट या ग़लती के लिए पोस्ट हुए इनवॉइस को बिना बदले सुधारें।'),
      t('Enter the taxable value to take off; the GST follows the invoice’s own rates.', 'घटाने वाली taxable value भरें; GST इनवॉइस के रेट के हिसाब से अपने-आप लगता है।'),
      t('Any amount beyond what is owed becomes the customer’s credit, to apply later or refund.', 'बकाया से ज़्यादा रकम ग्राहक का क्रेडिट बनती है, जिसे बाद में लगाएँ या लौटाएँ।'),
      t('See every credit note with its reason and the invoice it corrects.', 'हर क्रेडिट नोट उसकी वजह और जिस इनवॉइस को सुधारता है, उसके साथ देखें।'),
    ],
    steps: [
      t('Click **New credit note** (or **Credit note** on a posted invoice’s page) and choose the posted invoice.', '**New credit note** दबाएँ (या पोस्ट हुए इनवॉइस के पेज पर **Credit note**) और इनवॉइस चुनें।'),
      t('Enter the taxable value to take off.', 'घटाने वाली taxable value भरें।'),
      t('Give a reason, for example “Two cartons returned”, and the date.', 'वजह लिखें, जैसे “दो कार्टन वापस आए”, और तारीख़ भरें।'),
      t('Click **Post credit note**. It posts straight away.', '**Post credit note** दबाएँ। यह तुरंत पोस्ट हो जाता है।'),
      t('If it leaves a credit, use **Apply advance** or **Refund** on **Payments Received**.', 'अगर क्रेडिट बचे तो **Payments Received** पर **Apply advance** या **Refund** दबाएँ।'),
    ],
    note: t('Returned goods come back into stock through **Stock → Adjust stock**: a credit note carries amounts, not quantities.', 'लौटा माल **Stock → Adjust stock** से स्टॉक में वापस जोड़ें: क्रेडिट नोट में सिर्फ़ रकम होती है, मात्रा नहीं।'),
  },
};
