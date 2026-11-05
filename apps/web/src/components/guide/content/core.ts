import {
  ArrowDownUp,
  BadgeCheck,
  Boxes,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Copy,
  FilePlus2,
  FileText,
  Link2,
  Mail,
  MessageCircle,
  Package,
  PackagePlus,
  Pencil,
  Settings2,
  ScanLine,
  Sparkles,
  TriangleAlert,
  Undo2,
  Upload,
  UserCheck,
  Users,
  Warehouse,
  Scale,
} from 'lucide-react';
import type { AreaKeys } from '../keys';
import { t, type Guide } from '../types';

export const CORE_GUIDES: Record<AreaKeys<'core'>, Guide> = {
  inbox: {
    section: t('Inbox', 'इनबॉक्स'),
    title: t('Life cycle of a document', 'डॉक्यूमेंट का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: Upload, label: t('Upload', 'अपलोड'), tone: 'action' }] },
          { flow: [{ icon: Mail, label: t('Forward by email', 'ईमेल से भेजें'), tone: 'action' }] },
          { flow: [{ icon: MessageCircle, label: t('Send on WhatsApp', 'WhatsApp पर भेजें'), tone: 'action' }] },
        ],
      },
      { icon: ScanLine, label: t('Reading… (AI and OCR)', 'पढ़ रहा है… (AI और OCR)'), tone: 'ai' },
      {
        branch: [
          { edge: t('Read', 'पढ़ लिया'), flow: [{ icon: ClipboardCheck, label: t('Ready to review', 'रिव्यू के लिए तैयार'), tone: 'wait' }] },
          { edge: t('Seen before', 'पहले आ चुका'), flow: [{ icon: Copy, label: t('Duplicate?', 'डुप्लिकेट?'), tone: 'wait' }] },
          { edge: t('Failed', 'नहीं पढ़ा'), flow: [{ icon: TriangleAlert, label: t('Couldn’t read: Try again', 'नहीं पढ़ पाया: Try again'), tone: 'error' }] },
        ],
      },
      { icon: UserCheck, label: t('A person approves in Review', 'Review में व्यक्ति मंज़ूर करे'), tone: 'action' },
      { icon: CircleCheck, label: t('Posted', 'पोस्ट हुआ'), tone: 'done' },
    ],
    can: [
      t('Bring in bills, invoices, receipts and bank statements: PDF, photos, spreadsheets and Word files, up to 20 MB each.', 'बिल, इनवॉइस, रसीदें और बैंक स्टेटमेंट लाएँ: PDF, फ़ोटो, स्प्रेडशीट और Word फ़ाइलें, हर फ़ाइल 20 MB तक।'),
      t('Forward bills to your business’s own email address, or send photos from a linked WhatsApp phone.', 'बिल अपने बिज़नेस के ख़ास ईमेल पते पर फ़ॉरवर्ड करें, या लिंक किए WhatsApp फ़ोन से फ़ोटो भेजें।'),
      t('Follow each document: Reading…, Ready to review, Posted, Duplicate? or Couldn’t read.', 'हर डॉक्यूमेंट की हालत देखें: Reading…, Ready to review, Posted, Duplicate? या Couldn’t read।'),
      t('See how sure the reading is: green at 85% and above, amber at 70% and above.', 'देखें पढ़ाई कितनी पक्की है: 85% या ज़्यादा हरा, 70% या ज़्यादा पीला।'),
    ],
    steps: [
      t('Drop files on **Drop bank statements, bills, invoices, or receipts**, or click it to choose files.', 'फ़ाइलें **Drop bank statements, bills, invoices, or receipts** पर छोड़ें, या उस पर क्लिक करके चुनें।'),
      t('To forward by email, click **Copy address** and send bills to it. **Replace address** retires it if it leaks.', 'ईमेल से भेजने के लिए **Copy address** दबाएँ और उस पते पर बिल भेजें। पता लीक हो जाए तो **Replace address** दबाएँ।'),
      t('For WhatsApp, click **Link a phone** and send the code shown from that phone, within 15 minutes.', 'WhatsApp के लिए **Link a phone** दबाएँ और दिखाया गया कोड उसी फ़ोन से 15 मिनट के अंदर भेजें।'),
      t('When a document says **Ready to review**, click **Review**.', 'डॉक्यूमेंट पर **Ready to review** आए तो **Review** दबाएँ।'),
      t('If it says **Couldn’t read**, click **Try again**.', 'अगर **Couldn’t read** लिखा हो, तो **Try again** दबाएँ।'),
    ],
    note: t('Nothing in the Inbox posts by itself. A document from an unknown sender is marked: check it is genuine before approving.', 'Inbox से अपने-आप कुछ पोस्ट नहीं होता। अनजान भेजने वाले का डॉक्यूमेंट अलग से चिह्नित होता है: मंज़ूर करने से पहले जाँचें कि वह असली है।'),
  },

  review: {
    section: t('Review', 'रिव्यू'),
    title: t('Life cycle of a proposed entry', 'सुझाई गई एंट्री का पूरा सफ़र'),
    flow: [
      {
        branch: [
          { flow: [{ icon: ScanLine, label: t('AI read a document', 'AI ने डॉक्यूमेंट पढ़ा'), tone: 'ai' }] },
          { flow: [{ icon: Sparkles, label: t('Month-end, bank, bulk update', 'मंथ-एंड, बैंक, बल्क अपडेट'), tone: 'wait' }] },
        ],
      },
      { icon: ClipboardCheck, label: t('Proposed entry waits', 'सुझाई एंट्री इंतज़ार में'), tone: 'wait' },
      { icon: Pencil, label: t('Check fields, Edit lines', 'फ़ील्ड जाँचें, Edit lines'), tone: 'action' },
      {
        branch: [
          {
            edge: t('Right', 'सही'),
            flow: [
              { icon: CircleCheck, label: t('Approve & post', 'Approve & post'), tone: 'done' },
              { icon: BadgeCheck, label: t('Posted to ledger', 'लेजर में पोस्ट'), tone: 'done' },
            ],
          },
          { edge: t('Wrong', 'ग़लत'), flow: [{ icon: CircleX, label: t('Reject: kept for audit', 'Reject: ऑडिट के लिए रखा'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('See the original document beside what the AI read, with how sure it is of each field.', 'असली डॉक्यूमेंट और AI ने जो पढ़ा, दोनों साथ देखें, हर फ़ील्ड की पक्की होने की डिग्री के साथ।'),
      t('See the account chosen and why: your past choice, the HSN/SAC or wording, or an AI suggestion.', 'चुना गया अकाउंट और उसकी वजह देखें: आपकी पिछली पसंद, HSN/SAC या शब्द, या AI का सुझाव।'),
      t('Read the warnings: likely a duplicate, a GSTIN not on file, a new vendor with a large bill, GST likely not claimable.', 'चेतावनियाँ पढ़ें: शायद डुप्लिकेट, GSTIN मेल नहीं खाता, नए वेंडर का बड़ा बिल, GST क्रेडिट शायद नहीं मिलेगा।'),
      t('Fix the accounts or amounts, then approve and post, or reject.', 'अकाउंट या रकम ठीक करें, फिर मंज़ूर करके पोस्ट करें, या रिजेक्ट करें।'),
      t('Approve in one go every entry at 90% or above with no warnings.', '90% या ज़्यादा पक्की और बिना चेतावनी वाली सारी एंट्री एक साथ मंज़ूर करें।'),
    ],
    steps: [
      t('Open an entry. Compare the document on the left with the fields on the right.', 'एक एंट्री खोलें। बाईं ओर का डॉक्यूमेंट दाईं ओर के फ़ील्ड से मिलाएँ।'),
      t('Check **Filed under** and any warnings.', '**Filed under** और चेतावनियाँ जाँचें।'),
      t('To change accounts or amounts, click **Edit lines**, then **Done editing**.', 'अकाउंट या रकम बदलनी हो तो **Edit lines** दबाएँ, फिर **Done editing**।'),
      t('Click **Approve & post**. The toast says **Posted to ledger**. Or click **Reject** to set it aside.', '**Approve & post** दबाएँ। नीचे **Posted to ledger** लिखा आएगा। या अलग रखने के लिए **Reject** दबाएँ।'),
      t('To clear the easy ones, click **Approve all high-confidence**. Flagged entries always wait for you.', 'आसान एंट्री निपटाने के लिए **Approve all high-confidence** दबाएँ। चेतावनी वाली एंट्री हमेशा आपके लिए रुकती हैं।'),
    ],
    note: t('**Approve & post** stays greyed out until every line has an account and debits equal credits. Only a Company admin or Accountant can approve here.', '**Approve & post** तब तक बंद रहता है जब तक हर लाइन में अकाउंट न हो और डेबिट-क्रेडिट बराबर न हों। यहाँ सिर्फ़ Company admin या Accountant मंज़ूर कर सकते हैं।'),
  },

  approvals: {
    section: t('Approvals', 'मंज़ूरी'),
    title: t('Life cycle of an approval', 'मंज़ूरी का पूरा सफ़र'),
    flow: [
      { icon: Settings2, label: t('Policy set by admin', 'एडमिन की पॉलिसी'), tone: 'action' },
      { icon: FileText, label: t('Maker posts a document', 'बनाने वाला पोस्ट करे'), tone: 'action' },
      { icon: UserCheck, label: t('Sent for approval: Waiting', 'मंज़ूरी को भेजा: इंतज़ार'), tone: 'wait' },
      {
        branch: [
          {
            edge: t('Approve', 'मंज़ूर'),
            flow: [
              { icon: Users, label: t('Second approver, if two', 'दो हों तो दूसरा'), tone: 'wait' },
              { icon: CircleCheck, label: t('Approve & post', 'Approve & post'), tone: 'done' },
            ],
          },
          { edge: t('Send back', 'वापस'), flow: [{ icon: Undo2, label: t('Back to maker, with what to fix', 'सुधार के साथ वापस'), tone: 'neutral' }] },
        ],
      },
    ],
    can: [
      t('Make a second person approve bills, payments, vouchers or expense claims before they post.', 'बिल, पेमेंट, वाउचर या खर्च क्लेम पोस्ट होने से पहले किसी दूसरे व्यक्ति की मंज़ूरी ज़रूरी करें।'),
      t('Set a policy by amount, with one or two approvers and which roles may approve.', 'रकम के हिसाब से पॉलिसी बनाएँ, एक या दो मंज़ूरी देने वाले और कौन-से रोल मंज़ूरी दे सकते हैं।'),
      t('High-risk documents always need two people: a possible duplicate, a changed vendor bank account, a first bill, an unusual amount.', 'जोखिम वाले डॉक्यूमेंट को हमेशा दो लोगों की मंज़ूरी चाहिए: शायद डुप्लिकेट, वेंडर का बदला बैंक अकाउंट, पहला बिल, असामान्य रकम।'),
      t('Whoever made a document cannot approve it. Expense claims always need someone other than the employee.', 'जिसने डॉक्यूमेंट बनाया, वह उसे मंज़ूर नहीं कर सकता। खर्च क्लेम को हमेशा कर्मचारी के अलावा कोई और मंज़ूर करता है।'),
    ],
    steps: [
      t('Company admin: under **Policies**, name the policy, pick the document type, the “from” amount and the approvers, then **Save policy**.', 'Company admin: **Policies** में पॉलिसी का नाम, डॉक्यूमेंट का प्रकार, कितनी रकम से, और मंज़ूरी देने वाले चुनें, फिर **Save policy** दबाएँ।'),
      t('When a document needs approval, it appears under **Waiting**.', 'जब किसी डॉक्यूमेंट को मंज़ूरी चाहिए, वह **Waiting** में दिखता है।'),
      t('The approver clicks **Approve**. On the last approval the button reads **Approve & post** and posts it in the approver’s name.', 'मंज़ूरी देने वाला **Approve** दबाता है। आख़िरी मंज़ूरी पर बटन **Approve & post** बन जाता है और उसी के नाम से पोस्ट होता है।'),
      t('To return it, write **What needs fixing** and click **Send back**.', 'वापस भेजने के लिए **What needs fixing** में लिखें और **Send back** दबाएँ।'),
      t('**Turn off** pauses a policy; with no policy, documents post as usual.', '**Turn off** से पॉलिसी रुक जाती है; पॉलिसी न हो तो डॉक्यूमेंट सामान्य तरीक़े से पोस्ट होते हैं।'),
    ],
    note: t('Sales invoices, receipts, credit and debit notes, and the Review queue are not covered by approval policies.', 'सेल्स इनवॉइस, रसीदें, क्रेडिट और डेबिट नोट, और Review पर मंज़ूरी की पॉलिसी लागू नहीं होती।'),
  },

  items: {
    section: t('Items', 'आइटम'),
    title: t('Life cycle of an item', 'आइटम का पूरा सफ़र'),
    flow: [
      { icon: FilePlus2, label: t('New item', 'नया आइटम'), tone: 'action' },
      { icon: Sparkles, label: t('Suggest code (HSN/SAC)', 'कोड का सुझाव (HSN/SAC)'), tone: 'ai' },
      { icon: Package, label: t('Save item', 'Save item'), tone: 'done' },
      {
        branch: [
          { edge: t('Sell', 'बेचें'), flow: [{ icon: FileText, label: t('Picked on invoices', 'इनवॉइस में चुनें'), tone: 'action' }] },
          { edge: t('Buy', 'ख़रीदें'), flow: [{ icon: FileText, label: t('Picked on bills and POs', 'बिल और PO में चुनें'), tone: 'action' }] },
        ],
      },
      { icon: Warehouse, label: t('Goods tracked in stock', 'माल स्टॉक में ट्रैक'), tone: 'done' },
    ],
    can: [
      t('Keep what you sell and buy with its HSN or SAC code, unit, GST rate, selling and cost price.', 'जो बेचते और ख़रीदते हैं, उसे HSN या SAC कोड, यूनिट, GST रेट, बिक्री और लागत रेट के साथ रखें।'),
      t('Pick an item on an invoice or bill line and the code, unit, rate and account fill in.', 'इनवॉइस या बिल की लाइन में आइटम चुनें, तो कोड, यूनिट, रेट और अकाउंट अपने-आप भर जाते हैं।'),
      t('Not sure of the code? AiBooks checks your past documents, its rules, then AI, and shows how sure it is.', 'कोड पता नहीं? AiBooks आपके पुराने डॉक्यूमेंट, अपने नियम, फिर AI देखता है, और बताता है कितना पक्का है।'),
      t('Track goods in stock, with a reorder level and a preferred vendor.', 'माल को स्टॉक में ट्रैक करें, reorder level और पसंदीदा वेंडर के साथ।'),
      t('Archive an item you no longer use; it stays on old documents.', 'जो आइटम अब काम का नहीं, उसे archive करें; पुराने डॉक्यूमेंट पर वह बना रहता है।'),
    ],
    steps: [
      t('Click **New item**.', '**New item** दबाएँ।'),
      t('Fill in the name, **Goods** or **Service**, the unit, GST rate, selling price and cost price.', 'नाम, **Goods** या **Service**, यूनिट, GST रेट, बिक्री रेट और लागत रेट भरें।'),
      t('No HSN or SAC code? Click **Suggest code**, then **Use this code** or **Dismiss**.', 'HSN या SAC कोड नहीं पता? **Suggest code** दबाएँ, फिर **Use this code** या **Dismiss**।'),
      t('For goods, keep **Track stock** on, and set the **Reorder level** and **Reorder quantity** if you want alerts.', 'माल के लिए **Track stock** चालू रखें, और याद दिलाने के लिए **Reorder level** और **Reorder quantity** भरें।'),
      t('Click **Save item**. To retire one later, open it and click **Archive item**.', '**Save item** दबाएँ। बाद में हटाना हो तो आइटम खोलकर **Archive item** दबाएँ।'),
    ],
    note: t('Items without an HSN/SAC code are flagged on the GSTR-1, so fill the code in before you file.', 'बिना HSN/SAC कोड वाले आइटम GSTR-1 में चिह्नित होते हैं, इसलिए फ़ाइल करने से पहले कोड भरें।'),
  },

  stock: {
    section: t('Stock', 'स्टॉक'),
    title: t('Life cycle of stock', 'स्टॉक का पूरा सफ़र'),
    flow: [
      { icon: PackagePlus, label: t('Opening stock', 'ओपनिंग स्टॉक'), tone: 'action' },
      {
        branch: [
          { edge: t('In', 'आया'), flow: [{ icon: FileText, label: t('Posted bill line', 'पोस्ट हुए बिल की लाइन'), tone: 'done' }] },
          { edge: t('Out', 'गया'), flow: [{ icon: FileText, label: t('Posted invoice line', 'पोस्ट हुए इनवॉइस की लाइन'), tone: 'done' }] },
          { edge: t('Other', 'अन्य'), flow: [{ icon: ArrowDownUp, label: t('Adjust stock', 'Adjust stock'), tone: 'action' }] },
        ],
      },
      { icon: Link2, label: t('Link lines to items', 'लाइनें आइटम से जोड़ें'), tone: 'wait' },
      { icon: Boxes, label: t('Stock on hand, at average cost', 'मौजूद स्टॉक, औसत लागत पर'), tone: 'done' },
      { icon: Scale, label: t('Propose closing stock', 'Propose closing stock'), tone: 'action' },
      { icon: ClipboardCheck, label: t('Approved in Review', 'Review में मंज़ूर'), tone: 'wait' },
      { icon: CircleCheck, label: t('On the balance sheet', 'बैलेंस शीट में'), tone: 'done' },
    ],
    can: [
      t('Track goods in from bills and out on invoices, valued at weighted-average cost.', 'बिल से आया और इनवॉइस से गया माल ट्रैक करें, weighted-average लागत पर।'),
      t('See each item’s quantity, value, what is on order, and flags such as **Below nothing**, price moves and **Reorder**.', 'हर आइटम की मात्रा, कीमत, ऑर्डर में कितना है, और **Below nothing**, रेट में बदलाव और **Reorder** जैसी चेतावनियाँ देखें।'),
      t('Link bill and invoice lines to items, with a suggestion and the reason for each.', 'बिल और इनवॉइस की लाइनें आइटम से जोड़ें, हर लाइन के सुझाव और वजह के साथ।'),
      t('Record a count, breakage, returns, or goods taken for your own use.', 'गिनती, टूट-फूट, वापसी, या अपने इस्तेमाल के लिए लिया माल दर्ज करें।'),
      t('Once a month, put the stock you hold on the balance sheet with a closing-stock entry.', 'महीने में एक बार क्लोज़िंग स्टॉक एंट्री से मौजूद स्टॉक बैलेंस शीट में लाएँ।'),
    ],
    steps: [
      t('On **Opening & adjustments**, enter each item’s quantity and cost per unit, then **Save opening stock**.', '**Opening & adjustments** में हर आइटम की मात्रा और प्रति यूनिट लागत भरें, फिर **Save opening stock** दबाएँ।'),
      t('On **Link lines**, click **Link line**, **Create item and link**, or **Not stock** for each line.', '**Link lines** में हर लाइन के लिए **Link line**, **Create item and link**, या **Not stock** दबाएँ।'),
      t('For a count, breakage or return, use **Adjust stock** and click **Record adjustment**.', 'गिनती, टूट-फूट या वापसी के लिए **Adjust stock** में भरकर **Record adjustment** दबाएँ।'),
      t('Running low? Click **Make purchase order** to draft a PO at the last rate.', 'स्टॉक कम है? **Make purchase order** दबाकर पिछले रेट पर PO का ड्राफ़्ट बनाएँ।'),
      t('At month-end, on **Stock entries**, pick the month and click **Propose closing stock**, then approve it in Review.', 'महीने के अंत में **Stock entries** में महीना चुनें और **Propose closing stock** दबाएँ, फिर Review में मंज़ूर करें।'),
    ],
    note: t('Purchases stay as expenses; only the monthly closing-stock entry moves stock into the books, and only once approved.', 'ख़रीद खर्च में ही रहती है; सिर्फ़ महीने की क्लोज़िंग स्टॉक एंट्री, मंज़ूरी के बाद, स्टॉक को खातों में लाती है।'),
  },
};
