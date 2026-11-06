# AiBooks user guide

How to use AiBooks, from your first sign-in to closing the year. Every screen, what it is for, and the steps, with the names of the buttons as you will see them.

**Who this is for:** business owners, accountants and their teams, employees who send in bills and claims, and CA firms who look after clients' books.

---

## Contents

1. [How AiBooks works](#1-how-aibooks-works)
2. [Getting started](#2-getting-started)
3. [Finding your way around](#3-finding-your-way-around)
4. [Getting documents in: Inbox](#4-getting-documents-in-inbox)
5. [Review and approvals](#5-review-and-approvals)
6. [Sales](#6-sales)
7. [Quotes, orders and challans](#7-quotes-orders-and-challans)
8. [Purchases](#8-purchases)
9. [Employee claims](#9-employee-claims)
10. [Items](#10-items)
11. [Stock](#11-stock)
12. [Time tracking: projects and timesheets](#12-time-tracking-projects-and-timesheets)
13. [Foreign currency](#13-foreign-currency)
14. [Banking](#14-banking)
15. [Things that repeat, and reminders](#15-things-that-repeat-and-reminders)
16. [Accountant: journals, bulk update and the chart of accounts](#16-accountant-journals-bulk-update-and-the-chart-of-accounts)
17. [GST](#17-gst)
18. [TDS](#18-tds)
19. [Month-end](#19-month-end)
20. [Transaction locking and year-end](#20-transaction-locking-and-year-end)
21. [Reports, documents and insights](#21-reports-documents-and-insights)
22. [For CA firms: the Practice section](#22-for-ca-firms-the-practice-section)
23. [Your monthly and yearly checklist](#23-your-monthly-and-yearly-checklist)
24. [Test mode, and what is not live yet](#24-test-mode-and-what-is-not-live-yet)
25. [Quick answers](#25-quick-answers)

---

## 1. How AiBooks works

AiBooks keeps double-entry books for an Indian business. It reads the bills, invoices and bank statements you send it, and proposes the entries. **Nothing reaches your books until a person approves it.**

- **AI suggests, you decide.** What the AI reads or suggests waits in the **Review** queue. Pressing **Approve & post** is what puts it in the books.
- **Colours mean the same thing everywhere.** Amber means waiting or suggested by AI. Green means confirmed and posted. Red is only for errors.
- **Posted entries are never edited.** To correct one, you reverse it or raise a credit or debit note. The original and the correction both stay on record.
- **Everything is recorded.** Every change shows in the **Audit trail**: who made it, when, and what it was before.
- **Drafts first.** Invoices, bills and orders start as drafts. A draft changes nothing in the books until you press **Post to ledger**.

### Who can do what

Your role decides what you can do. Pages are not hidden; an action you may not take is refused when you try it.

| Role | Can |
|---|---|
| **Company admin** | Everything: settings, team, all books, posting and reversing, approvals, GST, opening balances |
| **Accountant** | Upload, post, reverse, approve review entries, GST, sales and purchase, reports. Not settings or team. |
| **CA reviewer** | See the review queue and reports, manage GST, sales and purchase. Cannot approve or post review entries. |
| **Employee** | Upload documents, log time, submit expense claims, view reports. Cannot post. |
| **Auditor** | Read only: journals, reports and the audit trail |
| **Firm admin** | Runs a CA firm's practice and its clients' organisations. Cannot post. |

---

## 2. Getting started

### Create your account

1. Go to the sign-up page and fill in **Your name**, **Email**, **Password** (at least 8 characters) and **Business / organisation name**.
2. Click **Create account**. You land on the **Dashboard**, and you are the business's Company admin.

You can also sign in with Google: **Continue with Google** on the sign-in page. The first time, it creates a business called "*Your name*'s Business", which you can rename in Settings.

### Sign in, and reset your password

- Sign in with your email and password, then **Sign in**.
- Forgot it? Click **Forgot password?**, enter your email and click **Send reset link**. The link in the email works for an hour. Setting a new password signs you out everywhere else.

### Set up your business (first day)

Do these once, in this order. The rest of AiBooks relies on them.

**1. Business details: Settings → General**
Fill in the company name, **Address**, **City** and **Pincode** (a tax invoice must carry the address, and e-invoices need the pincode), phone and email. Under **Printed on every invoice**, add your bank or UPI details. Then click **Save changes**.

**2. Tax: Settings → Tax & GST**
Enter your **GSTIN**; the state fills in from it. Then enter your **PAN**, **TAN** (needed for Form 26Q) and **GST filing frequency** (monthly, or quarterly under QRMP). Click **Save changes**.

Your GSTIN matters: AiBooks uses it to tell a bill you received from an invoice you issued.

**3. Your team: Settings → Team & roles**
Click **Add member**, enter their email, pick a role and click **Add**. The person must sign up for an account first; no invitation email is sent.

**4. Your opening position: Opening balances**
If you are moving from Tally, Zoho Books or QuickBooks, or starting mid-year, bring your balances over. See [Opening balances](#opening-balances) below.

**5. Customers, vendors and items**
- Add customers on **Sales → Customers → New customer**.
- Add vendors on **Purchase → Vendors → New vendor**.
- Add what you sell or buy on **Items → New item**.

**6. Your bank**
Upload a bank statement on **Banking**, or connect your bank through an Account Aggregator. See [Banking](#14-banking).

### Opening balances

**Accountant → Opening Balances.** Only a Company admin can do this. The result posts straight to the books.

You can **Import from another system** or **Enter by hand**.

**Import from Tally, Zoho Books or QuickBooks**
1. Upload the exports:
   - **Tally:** the Masters XML.
   - **Zoho Books:** the Trial Balance, Chart of Accounts and Contacts.
   - **QuickBooks:** the Trial Balance, Account List, and Customer and Vendor Balance Summaries.

   Click **Choose files**, then **Read the files**.
2. **Check what was read.** Give every account AiBooks could not place a type with **What is this?**. Check that the totals say **Balanced**.
3. **Bring it over.** Set **Balances as at** (usually 1 April, or the day you start keeping books here). If the totals are out, tick the box to post the difference to Suspense and sort it out later. Click **Import opening balances**.

**Enter by hand**
1. Type the debit or credit balance of each account in rupees. Starting mid-year? Tick **Opening mid-year? Show income and expense accounts**.
2. Under **Customers — what each owes you** and **Vendors — what you owe each**, enter each party's balance. They must already exist on Sales or Purchase. Enter an advance with a minus sign.
3. Click **Check the balances**, then bring it over as above.

To undo an import, reverse the opening voucher from **Accountant → All Vouchers**.

---

## 3. Finding your way around

**The sidebar** is grouped. Click a group's name to open or close it; AiBooks remembers which are open.
- **Home, Inbox, Review, Approvals** at the top.
- **Items:** Items, Stock.
- **Sales:** Customers, Quotes, Sales Orders, Invoices, Recurring Invoices, Delivery Challans, Payments Received, Credit Notes.
- **Purchases:** Vendors, Expenses, Recurring Expenses, Purchase Orders, Bills, Recurring Bills, Payments Made, Payment Runs, Vendor Credits, Employee Claims.
- **Time Tracking:** Projects, Timesheet.
- **Banking.**
- **Accountant:** Manual Journals, Bulk Update, Currency Adjustments, Chart of Accounts, Budgets, Transaction Locking, Month-end, Opening Balances, All Vouchers, Foreign Currency.
- **Taxes:** GST, TDS.
- **Reports:** Reports, Management Reports, Insights, Audit Trail.
- **Documents:** every file in the books.
- **Practice** (CA firms only). Settings is at the bottom.

The **+** beside **Customers** and **Vendors** adds one straight away.

**Every list, form and record is its own page.** A list (for example **Invoices**) has search and status filters; **New invoice** opens the form as a page, with its buttons in a bar along the bottom; saving takes you to the record's page, where its actions are (post, pay, send, PDF, history). **Back** links take you to the list. Messages such as **Posted to ledger** appear at the bottom right and stay while you move between pages.

Inbox and Review show how many documents are waiting.

**The top bar** shows:
- your business name and GSTIN;
- **AI this month**, the rupees spent on AI reading this month;
- a bell that lights up when entries wait in Review;
- your profile menu, with Settings and **Sign out**.

**How it works.** Every section has a **How it works** button at the top: a chart of how a document moves through that section, what you can do there, and the steps, in English or हिंदी (switch at the top of the guide; your choice is remembered). A list with nothing in it yet shows the same guide underneath.

**Ask your books.** The round button at the bottom right of every page opens a small chat: type a question such as "Who owes me money?" and get the answer with the report rows behind it. It only reads your books; nothing changes.

**The Dashboard** shows the things to act on today:
- **Ask your books:** type a question such as "Who owes me money?" and get the answer with the report rows behind it.
- **The month in words:** a short summary of the month, from the books.
- **Needs your attention:** entries to review, documents waiting, money overdue from customers, and GST mismatches. Each one links to where you sort it out.
- **Documents:** the reading and data entry at a glance: how many documents are **Being read**, **Ready for review**, **Couldn't read** (with the reason, such as no AI credit left) and **Entered today** (and this week). Links take you to **Review**, to the documents that **Couldn't read**, and to those you can enter yourself with **Add to**.
- **Income, expenses, cash on hand and GST due**, with a cash-flow chart, AI observations under **What I noticed**, and a cash forecast.

---

## 4. Getting documents in: Inbox

**Inbox** is where bills, invoices, receipts and bank statements arrive. It is the **Files** inbox of the Documents area: the panel on its left also has **All Documents**, **Bank Statements** and your folders (see [Documents](#documents) in section 21). There are three ways in; whichever you use, each document is read by AI in the background and waits for you: a bill or invoice in **Review**, a bank statement's lines in Banking. Nothing posts by itself.

**1. Upload**
Drop files on **Drag & Drop Files Here**, or click **Choose files to upload**. Several at once is fine; each file shows its own progress, then **Sent for reading** (or **Duplicate?**, or why it was not taken). AiBooks accepts:
- PDF;
- photos (JPG, PNG, WEBP, TIFF, HEIC);
- spreadsheets (CSV, XLSX, XLS);
- Word and text files.

Each file can be up to 20 MB. You can also upload from **All Documents** (**Upload file**), **Bank Statements** (**Upload statement**), **Sales → Invoices** (**Upload invoice**), **Purchases → Bills** (**Upload bill**) and **Banking** (**Upload statement**).

**How reading works.** Text is taken straight from the file where it has some, scans and photos go through OCR, and then AI picks out the party, number, dates, amounts and lines. A bank statement is recognised and its lines go to Banking to be matched.

**2. Send documents by email**
Your business has its own address, like `bills-xxxx@yourdomain`, shown at the bottom of the inbox: **Send your documents to …**. Copy it with **Copy address** and forward bills to it, or give it to your vendors. Each attachment is read and waits for you. If the address leaks, open **Email and WhatsApp set-up** and click **Replace address**; the old one stops working at once.

**3. Send bills on WhatsApp**
Open **Email and WhatsApp set-up** at the bottom of the inbox, then:
1. Click **Link a phone**.
2. From that phone, send the message shown (for example `LINK ABC123`) to the business WhatsApp number. The code works once, for 15 minutes.
3. When it says **Phone linked**, photos and PDFs sent from that phone go to your Inbox.

A phone files to one business at a time.

**Following a document**
The table shows each document's status:
- **Reading…**
- **Ready to review**: click **Review**.
- **Imported**: a bank statement whose lines went to Banking; **Bank Statements** shows how far they are matched.
- **Posted**
- **Duplicate?**: AiBooks has seen this exact file before.
- **Couldn't read**: the reason is shown (for example, the AI service has no credit left). Click **Try again** once it is sorted, or enter it yourself with **Add to**.
- **Entered**: you entered it by hand as a record (see below); the link opens that record.
- **Rejected**: turned down in Review.

When the AI could not read some documents, a red box at the top of the inbox says how many and why. **Show them** lists them. Nothing is lost: the files are kept.

**Add to: enter a document as a record yourself.** On a document that has been read (or could not be), **Add to** offers New bill, New expense, New purchase order, New vendor credit, New customer, New vendor, New manual journal, New quote, New sales order and New invoice. The form opens beside the file, filled with what the AI read: the party, GSTIN, number, dates and lines. If the vendor or customer is not in your books yet, **Add new vendor** (or customer) makes them from the scan and brings you back. Check each field against the file, then save as usual: the file is kept with the record, and the AI's version of the same document is closed, so it is never in the books twice. **Save and next** moves to the next document; **Skip for now** leaves this one.

The confidence column shows how sure the reading is: green at 85% and above, amber at 70% and above. A document from an unknown sender is marked **Unknown sender**; check it is genuine before approving.

---

## 5. Review and approvals

### Review & post

**Review** is the heart of AiBooks: everything the AI reads or proposes waits here for a person.

1. The left side shows the original document; the right shows what was read. Each field (vendor, GSTIN, invoice number, dates, amounts) shows how sure the reading is. Entries below 80% are marked **Needs attention**.
2. **Filed under** shows the account chosen and why: **Your past choice**, **From the HSN/SAC or wording**, **AI suggestion**, or **Nothing matched — check this**.
3. Read the warnings, if any:
   - **Likely a duplicate** / **Possibly a duplicate**
   - **Not the GSTIN on file**
   - **New vendor, large bill**
   - **GST likely not claimable**: GST the law blocks under section 17(5), such as on a restaurant meal, a salon visit or a club membership. When the bill shows it plainly (the restaurant's SAC code, or a vendor named as a restaurant, dhaba or caterer), the entry already adds the GST to the cost instead of claiming it. If you can claim it, move it back to Input GST with **Edit lines** before approving. Food bought to resell is only flagged, never moved.
   - **Already paid**: the bill says "Paid by UPI", "Payment mode: Cash" or similar. Click **Record as expense** to record it as an expense paid from your bank (or cash), with the file and everything read from it filled in. The account the AI chose is selected, and blocked GST is not claimed. Or approve it as a bill and record the payment.
   - **TDS may apply**: the bill looks like contract work (194C), professional or technical fees (194J), rent (194I) or commission (194H), and this bill or the vendor's bills this year are past the section's limit (₹30,000 on one bill or ₹1,00,000 in the year for 194C; ₹50,000 in the year for 194J; ₹50,000 a month for rent; ₹20,000 in the year for 194H). Set the vendor's TDS section and it is withheld from this bill and the next.
4. To change the accounts or amounts, click **Edit lines**, then **Done editing**.
5. Click **Approve & post** to put it in the books (toast: **Posted to ledger**), or **Reject** to set it aside. A rejected entry is kept for the audit and never posts.

**How the account is chosen**
- A person's past choice for the vendor comes first.
- Then the HSN/SAC code or the wording. Toner, ink, cables and anything under ₹5,000 a unit are expenses, not fixed assets, even when their HSN code is a printer's or a laptop's.
- A bill of different things is split: a laptop goes to Office Equipment and the paper with it to Office & Stationery.
- Only then the AI model, choosing from your own accounts. If the AI could not be reached, the entry says so.

**Approve & post** stays greyed out until every line has an account and debits equal credits.

**Approve all high-confidence** posts in one go every entry at 90% or above with no warnings, whose account came from your past choice or a rule. An entry with a warning, or whose account the AI model picked or nothing matched, is never included; it waits for you.

Month-end entries, opening and closing stock, exchange revaluations and bank lines sent for categorising also come here, each labelled with what made it.

Only a Company admin or Accountant can approve or reject here.

### Approvals

**Approvals** handles maker-checker: a second person approving before something posts.

**Set up a policy (Company admin)**
In **Policies**, name it (for example "Bills over ₹50,000") and pick the document type: bills, payments, vouchers or expense claims. Then set:
- **From ₹**: leave it blank to cover all amounts;
- **One approver** or **Two approvers**;
- which roles may approve. For bills there is also **Only a vendor's first bill**.

Click **Save policy**. **Turn off** pauses a policy.

**How it works**
- With no policy for a kind of document, it posts as it always has.
- Under a policy, whoever made the document cannot approve it.
- A high-risk one always needs two people. Risks flagged include a possible duplicate, a vendor whose bank account changed in the last 30 days, a vendor's first bill, three times the vendor's usual amount, and a bill dated on a Sunday.
- **Expense claims always need someone other than the employee**, even with no policy.

**Approving**
When a document needs approval, the maker sees "Sent for approval" and it appears under **Waiting**. The approver clicks **Approve**; on the last approval the button reads **Approve & post** and posts it in the approver's name. **Send back** returns it to the maker with what needs fixing.

What policies can cover: posting a purchase bill, paying bills (single or in a payment run), vouchers and expense claims. Sales invoices, receipts, credit and debit notes, and the Review queue are not covered.

---

## 6. Sales

**Sales** in the sidebar: one page for each of **Customers**, **Quotes**, **Sales Orders**, **Invoices**, **Recurring Invoices**, **Delivery Challans**, **Payments Received** and **Credit Notes**. Quotes, orders and challans are in [section 7](#7-quotes-orders-and-challans); recurring invoices in [section 15](#15-things-that-repeat-and-reminders).

### Add a customer
1. **Sales → Customers**, then **New customer** (or the **+** beside Customers).
2. Only the **Display name** is required. Fill in what you have:
   - **Customer type** (Business or Individual), the primary contact (salutation, first and last name), **Company name**, email, work phone and mobile, and language. **Display name** offers the company name or the contact's name, or type your own.
   - **GSTIN**: type it, or click **Prefill**. AiBooks reads the state, PAN and the kind of business from the GSTIN itself, and says if another customer already has it. The legal name and address come from the GST portal only once a GST provider is connected. Without a GSTIN, pick the state: it is the place of supply on your GSTR-1.
   - **Other details:** PAN, currency, **Payment terms** (Due on receipt, Net 15, Net 30… or end of month; new invoices take their due date from it), portal access, website, department and designation, and an opening balance (company admins).
   - **Address:** billing and shipping (**Copy billing address**). **Contact persons:** as many as you need. **Remarks:** notes for yourself.
3. Click **Save customer**.

The customer's page shows their details, what they owe, any advance they have paid, and their invoices, with **New invoice** and **Record receipt**. Files you keep against the customer (a rate agreement, say) go in its attachments. **Edit** changes the details.

### Raise an invoice
1. **Sales → Invoices**, then **New invoice**.
2. Pick the **Customer** (search by name, company, GSTIN or phone; **+ New customer** if they are not there yet). The form says whether the sale is within your state (CGST and SGST) or across states (IGST).
3. The **Invoice#** is given automatically when it posts; click the cog to type your own. Add the **Order number**, the invoice date, **Terms** (the customer's, to start with) and the **Due date** that follows from them, a **Salesperson**, a **Project** and a **Subject** the customer will see.
4. Add a line for each thing sold: pick an **Item** (it fills the description, HSN/SAC, rate and GST %), or type them, with the quantity. **Add items in bulk** adds several at once.
5. Under the lines:
   - **Discount**, as a percent or in rupees. It comes off before tax, spread across the lines, so GST is charged on the discounted value, as the law asks.
   - **Adjustment**, for rounding: up to ₹99.99 either way, after tax, posted to Round Off. A bigger reduction is a discount.
   - **Customer notes** ("Thanks for your business."), **Terms & conditions**, and files to attach.
6. Click **Save invoice**. **It is saved as a draft** and you land on its page. The server works out the tax, so the figures you see are the ones that post.
5. Check it, then click **Post to ledger**. Only now does it reach the books (**Posted to ledger**).

For a customer abroad, choose the currency on the form: it becomes an export invoice under your LUT, with no GST, and asks for the shipping bill for goods. See [Foreign currency](#13-foreign-currency).

**Sales → Invoices** lists them with filters (**Draft**, **Sent**, **Posted**, **Paid**, **Overdue**) and a strip showing what is owed by how late. **Upload invoice** sends an invoice you made elsewhere to the Inbox to be read.

### Send it
On the invoice's page:
- **PDF** gives the tax invoice as a PDF.
- **Email** opens a page with the message; click **Email invoice** to send it with the PDF, once it has a number. It needs email set up on the server.
- **Mark sent** records that you sent it yourself.
- **Customer portal:** on the customer's page, click **Copy portal link**. For 30 days, with no login, they can see their invoices, download PDFs and pay. **Withdraw links** cancels them.

### E-invoice and e-way bill
On a posted invoice's page, under **E-invoice and e-way bill**:
- **Generate IRN** registers it with the IRP. An IRN can only be cancelled within 24 hours; after that, correct it with a credit note. Customers without a GSTIN (B2C) need no IRN.
- **Cancel IRN and reverse sale** (within 24 hours) cancels it at the IRP and reverses the sale in your books.
- **Make e-way bill**: enter the distance and transport details, then click **Generate e-way bill**. Goods worth over ₹50,000 need one to move. **Cancel e-way bill** works within 24 hours.

AiBooks checks the invoice before it goes to the IRP and lists what to fix first: missing pincode, HSN, place of supply.

### Get paid
- **One invoice:** click **Mark paid** on a posted invoice. Check the amount (change it for a part payment) and the date, then click **Record receipt**.
- **One payment across many invoices:** **Sales → Payments Received**, then **Record receipt**.
  1. Pick the customer, the amount received, the date, the **Payment mode**, and the bank or cash account under **Deposit to**.
  2. If the bank kept a fee, enter it under **Bank charges**: the customer is still credited with the whole amount, the bank with the rest, and the fee goes to Bank Charges.
  3. Optionally add the reference (UTR, cheque number, or the invoice numbers it pays).
  4. If the customer deducted TDS, set **TDS deducted?** to **Yes** and enter it on each invoice.
  5. Click **Suggest allocation** to let AiBooks spread it across the unpaid invoices: it reads the reference, finds an exact combination, or takes the oldest first. Narrow the list with **Filter by date range**, or start again with **Clear applied amount**.
  6. Add any notes (internal) and files, then click **Record receipt**.

  The receipt is numbered when it is recorded (RCT/2026-27/0001, in order, with no gaps). The summary shows what was used and what is in excess; anything in excess is held as an advance. Click a receipt's number in the list to see its notes, charges and files.
- **Online:** **Payment link** on a posted invoice creates a Razorpay payment link and copies it for you to send. When the customer pays, the invoice shows it; confirm it to record the receipt.

**Payments Received** lists every receipt. A foreign-currency invoice is received from [Foreign currency](#13-foreign-currency), at the rate that day.

### Advances, credits and refunds
At the foot of **Payments Received**, **Advances and credits — customers** lists money customers paid ahead, and credit from notes. For each:
- **Apply advance** uses it against an invoice;
- **Refund** records paying it back.

### Credit notes
For goods returned, a discount, or a mistake on a posted invoice. GST needs every credit note to name the invoice it corrects, so you always choose one.
1. Click **Credit note** on the invoice's page, or **Sales → Credit Notes**, then **New credit note**.
2. Choose **Line by line** (the usual way) or **Taxable value only**.
   - **Line by line:** pick the customer and the invoice (**Copy the invoice's lines** fills them), then keep the lines being credited, each with its income account, quantity, rate and GST %. A discount works as on invoices. It is taxed as the invoice was, and it cannot take back more than the invoice has left.
   - **Taxable value only:** enter the value to take off; the tax follows the invoice's proportions.
3. Give a reason (for example "Two cartons returned"), the date, and any reference, subject or notes.
4. Click **Post credit note**.

It posts straight away. Any amount beyond what is owed becomes the customer's credit. **Credit Notes** lists them all.

### Chasing payment
The strip on **Invoices** shows what customers owe by how late it is: not yet due, then 1–30, 31–60, 61–90 and 90+ days. **Send reminder** on an invoice's page chases that one. For automatic reminders, see [section 15](#15-things-that-repeat-and-reminders).

---

## 7. Quotes, orders and challans

What comes before an invoice or a bill. **None of it posts.** An order becomes a draft invoice or bill, which you post from its page.

Each has a list, a **New** page, and a record page with its actions. They share the invoice's form: the customer, a number given automatically (or your own, with the cog), a **Reference#**, the dates, a **Salesperson** and a **Subject**; the same lines, **Discount** and **Adjustment**; and **Customer notes** and **Terms & conditions**. A discount or adjustment on a quote or order is carried onto the invoice made from it. A purchase order has the bill's form instead (below), and carries its accounts, discount and adjustment onto the bills made from it.

### Quotes (Sales → Quotes)
- **New quote:** pick the customer, the date and the **Expiry date**, a project if it is for one, add lines, then click **Save quote**.
- **Draft from a message** (on the Quotes list): paste the customer's email or WhatsApp message, pick the customer, and click **Draft quote**. AiBooks reads the items and quantities, at the customer's last prices. Check every line before sending.
- On the quote's page, **Send quote** emails the PDF. Then mark it **Accepted** or **Declined**.
- From an accepted quote, choose **Make order** or **Make invoice**; you are taken to what it made.
- **No answer after a week** (on the Quotes list) lists sent quotes to chase, with **Copy follow-up**.

### Sales orders (Sales → Sales Orders)
- **New sales order:** the customer's PO number as **Reference#**, the **Expected shipment date**, **Payment terms** and **Delivery method**, then **Save sales order**.
- Its page shows each line as ordered, invoiced and delivered.
- **Invoice part of it**: choose the quantities, then **Make draft invoice**. Bill all of it or part of it; you cannot bill more than was ordered.
- **Close** or **Cancel order** when you will not bill it further.

### Delivery challans (Sales → Delivery Challans)
For goods that move without an invoice. Click **New challan**, pick the **Challan type** (supply of liquid gas whose quantity is not known yet, job work, supply on approval, supply invoiced later, or others), add the lines and vehicle number, then **Issue challan**. On its page, mark it **Returned** when goods sent on approval or for job work come back.

### Purchase orders and goods received (Purchases → Purchase Orders)
1. **New purchase order.** The form is laid out like the bill's:
   - **Vendor name**, searchable, with **+ New vendor** under it.
   - **Delivery address**: **Organisation** (your address from Settings) or **Customer**, for goods sent straight to a customer's shipping address. **Change destination to deliver** picks another customer. The address is kept on the PO as it was when you raised it.
   - **Purchase order#** is given when you save (PO/2026-27/0001); the cog types your own, checked unused, and the series skips it. **Reference#** (the vendor's quotation, or yours), **Date**, **Delivery date**, **Payment terms** (the vendor's, unless you change them) and **Shipment preference** (choose or type: Road, Courier, Hand delivery).
   - The lines: pick an item (its purchase description and cost price fill in) or type one; **Account** says where the bill made from it will book the line (the item's account, or Purchases); quantity, rate and tax. **Add new row**, or **Add items in bulk**.
   - Under the totals, a **Discount** (a percent or rupees, before tax, shared across the lines) and an **Adjustment** (at most ₹99.99 either way, after tax).
   - **Notes** (printed on the PO), **Terms & conditions**, and files to attach.

   Then **Raise purchase order**. Opened from a scanned quotation (**Add to**), the file shows beside the form, which starts filled from it.
2. On its page, which shows all of the above and the account of each line, **Send PO** emails it to the vendor. The PDF carries the reference, delivery date, terms, shipment, delivery address, discount and terms & conditions.
3. When goods arrive, under **Receive goods** enter the quantities and the vendor's challan number, then **Record goods received**.
4. Under **Bill**, **Make draft bill** bills what was received; post it from the bill's page. The bill keeps each line's account, its order number (the PO's), the PO's payment terms (which give its due date), and each line's share of the PO's discount, in proportion to what is billed. The bill that completes a line takes exactly what is left of its discount, so the bills of a PO add up to its discount to the paisa. The PO's adjustment goes on a bill that bills all of the PO at once; a part bill rounds on its own.

   For example, a PO for 120 reams at ₹250 and 4 toners at ₹3,000, with 10% off (₹4,200: ₹3,000 on the paper, ₹1,200 on the toner). 100 reams and the 4 toners arrive and are billed: the paper takes ₹2,500 of its discount (100 of 120) and the toner all ₹1,200. When the last 20 reams are billed, the paper takes the ₹500 left. The paper is booked to the account chosen on the PO at ₹22,500 on the first bill.
5. **Close** or **Cancel PO** when nothing more will come.

The list searches PO numbers, references and vendors.

**3-way match.** A bill made from a PO is checked against the PO and what was received. The bill's page shows each difference in words. For example: billed but not on the PO, billed more than ordered, a rate above the PO's, or a GST rate that differs. Items to check before paying are marked **Check before paying**.

---

## 8. Purchases

**Purchases** in the sidebar: one page for each of **Vendors**, **Expenses**, **Recurring Expenses**, **Purchase Orders**, **Bills**, **Recurring Bills**, **Payments Made**, **Payment Runs**, **Vendor Credits** and **Employee Claims**.

### Add a vendor
1. **Purchases → Vendors**, then **New vendor** (or the **+** beside Vendors).
2. The form is the customer's (only the display name is required; **Prefill** reads the state, PAN and kind of business from the GSTIN), with a **Bank details** tab, and the **TDS section** and **MSME** under Other details.
3. Click **Save vendor**.

The vendor's page shows their details, what you owe them, and their bills, with **New bill** and **Record payment**. Under **Payment details**:
- **Bank account.** If a vendor asks to change where they are paid, confirm it with them on a number you already have, not one from the email asking for the change.
- **MSME (Udyam) registration.** For micro and small enterprises, AiBooks shows the date you must pay by under section 43B(h): 15 days, or the agreed days up to 45. Paying later means the expense is deductible only in the year you pay.

### Enter a bill
- **Scanned:** **Upload bill** on **Bills** (or use the Inbox), then approve it in **Review**.
- **Typed:**
  1. **Purchases → Bills**, then **New bill**.
  2. Pick the vendor (or **+ New vendor**: the form waits, and comes back with them chosen). Enter the **Bill#** as printed on their bill, the **Order number** (our PO, or the reference they quoted), the **Bill date**, and the **Payment terms**: the vendor's to start with. The **Due date** follows the terms and the bill date until you type one. Add a **Subject** if you like (what the bill is for, in a line).
  3. Choose where the discount goes: **At transaction level** (one discount under the totals, a percent or rupees, shared across the lines) or **At line item level** (a discount on each line, a percent or rupees). Either way it comes off before tax, so the GST and your input credit are on the value after it.
  4. Add a line for each thing bought: item, description, HSN/SAC, **Account**, quantity, rate, discount (at line level) and tax. **Account** says where the line is booked: the item's account, or Purchases, unless you pick another (Rent for a rent bill, Professional Fees for your CA, Computers & IT Equipment for a laptop the business keeps). Under **Customer details**, name the customer a cost is for and tick **Billable** to bill it on to them; a project goes beside it.
  5. Under the totals, an **Adjustment** of at most ₹99.99 either way rounds the total. It is not taxed.
  6. **Notes** are for you: they are not printed. Attach the bill's files, then click **Save bill**. It is a draft.
  7. On its page, click **Post to ledger**. If an approval policy covers it, it goes for approval first. Each line is booked to its account at its value after its discount; the adjustment goes to Round Off (a debit when it adds, a credit when it takes off), and the vendor is owed the total less any TDS.

The bill's page shows the order number, subject and terms, each line's account, discount and customer (marked **Billable**), and the sub total, discount, taxable value, tax, adjustment and total. Listing the billable lines per customer, to put them on an invoice, is not there yet.

TDS is deducted when the bill posts if the vendor has a TDS section set. A bill in a foreign currency is entered from [Foreign currency](#13-foreign-currency).

**Bills** lists them with filters (**Unpaid**, **MSME pay-by**, **Paid**). Each shows when it is due ("Overdue N days", "Due in N days"), and for MSME vendors the 43B(h) date.

### Expenses: paid straight from bank or cash
For money spent without a bill to enter first: a fuel receipt, a courier, bank charges, a small purchase paid by card. **Purchases → Expenses**, then **New expense**. The page has three tabs: **Record Expense**, **Record Mileage** and **Bulk Add Expenses**. (**Bulk add** on the list opens the third.)

**Record Expense**
1. Enter the date, the **Expense account**, and the bank or cash account it was **Paid through**.
2. Enter the amount before tax and the GST rate. Tick **Inter-state (IGST)** when the supplier is in another state.
3. **Itemize** (beside Expense account) splits one payment across several accounts: a line each, with its own account, description, amount before tax and GST rate. **Add another line** for more; **Use one account** goes back.
4. To claim the GST, the supplier's GSTIN is needed: pick the vendor, or type their GSTIN. If you do not claim it, the GST is part of the expense (on each line's account, when itemized).
5. Optionally add the **Invoice# / reference**, notes (up to 500 characters) and a project.
6. **Customer name**: the customer it was spent for. Tick **Billable** to bill it on to them later. Billable expenses not yet invoiced are listed per customer (the **Billable** filter on the list); putting them on an invoice is not built yet.
7. Click **Save expense** to keep it as a draft, or **Save and post** to post it now.

**Record Mileage** (a trip in a personal or hired vehicle)
1. The first time, with no rate set, **Set your mileage preferences** opens first (anyone who manages the organisation can change them later from **Mileage preferences** on the tab):
   - **Default mileage account**: where trips are booked, such as Travelling & Conveyance.
   - **Default unit**: **Km** or **Mile**.
   - **Mileage rates**: a rate per unit with the date it starts. A trip takes the rate in force on its date, so a new rate from 1 April leaves earlier trips as they were.
2. Enter the date, the distance (up to two decimals), the employee who drove or the vendor (both optional), the account (the default fills in), **Paid through**, and the customer and **Billable** if it is for one.
3. The rate in force and the amount (distance × rate, to the paisa) show as you type. To use another rate for this trip, type it in **Rate per km**. Mileage carries no GST.
4. **Save expense** or **Save and post**.

**Bulk Add Expenses** (many at once)
1. Fill a row for each expense: **Date**, **Expense account**, **Amount**, **Paid through**, and optionally **Vendor**, **Customer name**, **Project** and **Billable**. Ten rows to start; **Add more expenses** adds five. The row menu (**⋯**) duplicates or removes a row. Blank rows are left out.
2. Click **Save expenses** to save them all as drafts, or **Save and post** to post each one as well.

Every row is checked first, as a single expense would be. **If any row is wrong, nothing is saved**: the rows that need a fix show why, in red, under themselves. Once all are right they are saved together, numbered in row order. With **Save and post**, each is posted as its own payment voucher; one held by a payment approval policy waits on **Approvals**, and the rest post. At most 100 rows at a time. The grid's amount has no GST split: for GST to claim, an itemized expense or mileage, use the other tabs.

Posting makes one payment voucher: each line's expense account (and input GST, when claimed) debited, the bank or cash account credited. Expenses are numbered EXP/2026-27/0001 and on, without gaps, whichever tab they come from. If a payment approval policy covers it, it waits on **Approvals** first. Attach the receipt on the expense's page, which also shows the lines, the mileage, the customer and whether it is billable. A draft can be edited from there; a posted one cannot (reverse its voucher instead).

### Pay
- **One bill:** on the bill's page, under **Record payment**, enter the amount and date, then **Record payment**.
- **One payment across many bills:** **Purchases → Payments Made**, then **Record payment**. It works like a receipt (see [Get paid](#get-paid)), with three differences: you choose the account under **Paid through**; **Bank charges** are paid on top of the amount; and there is no TDS step, because TDS on a bill is withheld when the bill is posted. Payments are numbered PMT/2026-27/0001.
- **Payments Made** lists payments to vendors. Switch to **All payment vouchers** to see every payment voucher, single-bill payments and payment runs included.
- **Payment runs** (**Purchases → Payment Runs**), to pay many vendors at once:
  1. Set **Pay on** and optionally a **Cash limit**.
  2. Click **Suggest a run**. AiBooks puts MSME vendors first, then overdue bills, then what falls due by the pay date, within the cash you can spare. Each bill shows why it is included.
  3. Untick anything to hold back, then **Save payment run**.
  4. **Download bank file** and upload it to your bank.
  5. Once the bank has paid, set the date and click **Record as paid**. This posts the payments.

Payments can need approval if a policy covers them.

### Vendor credits (debit notes)
For goods returned, a short supply, or an overcharge on a posted bill: click **Vendor credit** on the bill's page, or **Purchases → Vendor Credits**, then **New vendor credit**.
1. Pick the vendor and the bill it corrects (**Against bill**: GST asks the note to name it). The bill's date, taxable value, total and what is still owed show under it.
2. Enter the vendor's **Credit note#**, the **Order number**, the **Vendor credit date** and a **Subject**.
3. **Enter it as**:
   - **Item by item**: the lines that go back, as on a bill (item, **Account**, quantity, rate, tax), with the discount at transaction or line level and an adjustment. **Copy the bill's lines** fills them in to change. Each line comes back off its account (the one chosen, else its item's, else Purchases), and the note is taxed as the bill was: IGST, or CGST and SGST, and under reverse charge if the bill was.
   - **An amount before tax**: the taxable value to take off and a reason; the tax follows in the bill's own proportions.
4. Add notes and files, then **Post vendor credit**. It posts at once as a DEBIT_NOTE voucher, numbered DBN/2026-27/0001 and on without gaps.

A vendor credit never takes back more taxable value, nor more of any tax, than the bill has left after earlier credits. Its GST comes off your input credit in GSTR-3B. If TDS was taken on the bill, its share comes back off TDS Payable. Anything beyond what the bill still owes becomes the vendor's credit: apply it to their next bill, or record their refund, on **Payments Made**. The list shows the vendor's credit note number beside ours.

### What you owe
The vendor's page shows what you owe them. At the foot of **Payments Made**, **Advances and credits — vendors** lists money you paid ahead and credit from notes: **Apply advance** to a bill, or **Record refund received**.

---

## 9. Employee claims

**Purchases → Employee Claims**: money employees spent for the business. Someone else approves it, an accountant posts it, and the reimbursement clears it.

**As the employee**
1. Click **New claim** and give it a title (for example "Client visit, Pune").
2. Add a line for each expense: date, what for, the expense account, amount paid and any GST. Add the merchant's GSTIN if you want the GST claimed. For travel by your own vehicle, choose **Km** and enter the distance.
3. Click **Save claim**. You land on the claim's page.
4. Attach each receipt.
5. Click **Submit claim**.

**Then**
1. Someone other than the employee approves it on **Approvals**.
2. An accountant clicks **Post claim**: the expense goes to the books, and the money is owed to the employee.
3. When they are paid, click **Record reimbursement**.

If a claim is sent back, it returns to draft with the reason shown. Fix it and submit again. An employee sees only their own claims.

AiBooks flags lines that need a look under **What the policy flagged**: missing receipts, possible duplicates, weekends, amounts over the limit, and GST that cannot be claimed.

---

## 10. Items

**Items** in the sidebar (with **Stock** as a tab at the top of the page): what you sell and buy. Pick an item on an invoice or bill line and its HSN/SAC code, unit, rate and account fill in. The GSTR-1 HSN summary groups by them.

To add one:
1. Click **New item**.
2. Fill in the **Name**, **Code / SKU**, **Goods** or **Service**, the **Unit** (search the GST units, such as "KGS - kilogram"; a service has none), the **HSN or SAC code** and the **GST rate**.
3. Not sure of the code? Click **Suggest code**. AiBooks checks your past invoices and bills, then its rules, then asks AI, and shows the code with its reason and how sure it is. Click **Use this code**, or **Dismiss**.
4. **Sales information** (tick it if you sell the item): the selling price, the **Account** its sales go to (picked for you: Sales Revenue for goods, Service Revenue for a service) and a description.
5. **Purchase information** (tick it if you buy the item): the cost price, the **Account** (Purchases, picked for you; an asset account such as Computers & IT Equipment for things the business keeps), the description bills should carry, and a **Preferred vendor**. An item that is only sold is not offered on bills, and one only bought is not offered on invoices.
6. **Inventory**, for goods: **Track stock for this item** is on unless you turn it off (for consumables nobody counts). Set the **Reorder level** and **Reorder quantity** for reorder alerts.
7. Click **Save item**.

Archive an item you no longer use. It stays on old documents.

---

## 11. Stock

**Items → Stock**: goods in from bills and out on invoices, valued at weighted-average cost. AiBooks keeps stock periodically: purchases stay as expenses, and once a month a closing-stock entry puts the stock you hold on the balance sheet.

It has four tabs: **Stock on hand**, **Link lines**, **Opening & adjustments** and **Stock entries**.

**How stock moves.** A posted bill line linked to a goods item brings stock in; a posted invoice line takes it out. Reverse a bill or invoice and its stock movement goes with it.

**Stock on hand**
Each item shows quantity, average cost, value, what is on order, and 90 days of sales. Click an item for its ledger, move by move. It also flags:
- **Below nothing**: a bill may be missing.
- **Price up / down N%**: the purchase price moved.
- **Reorder**

**Running low** groups items to reorder by the vendor you last bought from. **Make purchase order** drafts a PO at their last rate.

**Link lines**
Bill and invoice lines not linked to an item do not count in stock. Each shows a suggestion and why ("Looks like Basmati Rice 25kg, 95% sure"). Your choices:
- **Link line**
- **Create a new item** (then **Create item and link**)
- **Not stock**, for packing or a one-off

**Link N as before** links every line this vendor sent before in one click. Linking changes only the link, never an amount.

**Opening & adjustments**
- **Opening stock:** enter each item's quantity and cost per unit as at the day you started, then **Save opening stock**.
- **Adjust stock:** use this for a count, a breakage, goods returned by a customer or to a vendor, or goods taken for your own use. Enter a count or a quantity in or out, then **Record adjustment**. Credit and debit notes carry amounts, not quantities, so record returned goods here with the note's number.
- A mistaken entry can be voided; it stays in the list.

**Stock entries** (pick a month)
This compares stock at cost with what the books carry.
- **Propose closing stock** sends the difference to Review.
- If your opening stock is not in the books yet, **Propose opening stock** comes first, so it is not counted as this month's profit.

Nothing posts until approved.

---

## 12. Time tracking: projects and timesheets

**Time Tracking** in the sidebar: **Projects** (work for customers, and its profit) and **Timesheet** (the time spent on it).

### Set up a project
1. **Time Tracking → Projects**, then **New project**.
2. Fill in the **Project name**, the **Project code** (optional), the **Customer name** (or **Internal work (no customer)**), and a **Description** of up to 2,000 characters.
3. Pick the **Billing method**. It decides how an hour is priced:
   - **Fixed cost for project**: an agreed **Fee**, invoiced by hand. Time starts as not billable. The optional **Rate per hour** prices any extra time you mark billable.
   - **Based on project hours**: one **Rate per hour** for every hour on the project.
   - **Based on task hours**: each task has its own rate, in the **Rate per hour** column under **Project tasks**.
   - **Based on staff hours**: each person has their own rate, in the **Rate per hour** column under **Users**.
4. Under **Invoiced as**, pick the service item that gives its invoices their SAC code, GST rate and income account.
5. **Budget**: a **Cost budget** (checked against bills, expenses and journals tagged with the project) and a **Revenue budget** (checked against time billed and not yet billed; for a fixed fee, the fee). Tick **Add budget for project hours** to set **Budgeted hours**.
6. **Users**: the people on the project. You are added when you create it. **Add user** picks anyone on your team (**Settings → Team**).
7. **Project tasks**: **Add project task** for each piece of work, with a description and whether its time starts as **Billable**. **Import tasks** copies the tasks of another project (names already there are skipped).
8. Tick **Add to the watchlist on my dashboard** to show the project first in the dashboard's **Projects** card.
9. Click **Save project**. You land on its page, which shows the billing method, budgets, tasks and users. **Add to watchlist** and **Remove from watchlist** are there too.

A task that still has billable time waiting to be invoiced cannot be removed: invoice the time first, or move it to another task.

Projects made before the four billing methods keep working. One billed **By the hour** reads as **Based on project hours**. Its single budget (a cap for hourly work, the fee for fixed work) reads as the revenue budget, and alerts work as before until you save a cost or revenue budget on it.

### Log time
**Time Tracking → Timesheet**, then **Log time** (or press **c**, then **t**). **Log time** on a project's page opens the same panel for that project. The **New log entry** panel opens on the right; **Esc** closes it.
1. Pick the **Date**, the **Project name** and the **Task name**. A project with no tasks, or **Another task (type it)**, lets you type the task, for example "Design".
2. Enter the **Time spent** as hours and minutes, like `1:30`. Or click **Set start and end time instead** and enter both; AiBooks works out the hours (to two decimals) and checks the end is after the start.
3. **Billable** starts as the task says, or billable unless the project is a fixed fee. Change it if needed.
4. **User** is whose time it is: you. Someone who manages projects (the **Manage sales** permission, held by accountants, CA reviewers and company admins) can pick anyone on the project instead. The entry records who logged it.
5. Write **Notes** on what was done (invoice lines are worded from them), then click **Save**. The toast says **Time logged**.

**The timer:** in the same panel, click **Start timer** instead of **Save**. You can have one timer running at a time. It is kept on the server, so it carries on through a reload and shows at the top of the timesheet and of the project's page. Click **Stop timer** there: the time from start to stop, rounded to the minute, is logged on the day it started (**Time logged from the timer**). The **×** beside it discards the timer without logging anything. A timer left running for more than a day is not logged: discard it and log the time by hand.

**The list:** **View by** a period (**All**, **Today**, **This week**, **This month** or **Date range**), a customer, a project, a user and billing (**Billable**, **Unbilled**, **Invoiced**, **Not billable**). Above the list are the hours logged, the billable hours and the unbilled amount for what is shown. Each entry shows whether it is billable, on a draft invoice or invoiced. Until it is invoiced, an entry can be changed with **Edit** (the same panel) or **Remove**: by the person whose time it is, or by someone who manages projects. Every change is in the audit trail.

### Bill the time
1. Open the project.
2. **Unbilled time** lists the hours waiting, a line per task and rate, priced by the billing method: the project's rate, each task's rate, or each person's rate (with a line per task and person).
3. If a task or person has no rate, the page names them and **Draft invoice from time** waits until you add it on the project. An hour can also carry a rate of its own, which comes first.
4. Click **Draft invoice from time**. AiBooks makes one draft invoice, tags it with the project, and marks the time as invoiced, so it cannot be billed twice.
5. If AI is set up, it then words each line from the time notes.
6. **Open the draft invoice**, check it, and post it from its page.

For a fixed fee, invoice the fee from **Sales → Invoices** with the project on the line. **Draft invoice from time** bills only extra time you marked billable that has a rate.

### Track it
The **Projects** list shows each project's income, costs, profit, hours and unbilled time.
- Income and costs come from invoice, bill, expense and journal lines tagged with the project. Pick the project on the line when you create it.
- Alerts warn at 80% of the cost budget, the revenue budget or the budgeted hours, and again when one is passed.
- A note lists anyone who has logged nothing in the last week.
- The dashboard's **Projects** card shows watchlisted projects first.

**Put on hold**, **Mark completed** and **Reopen** on a project's page change its status. **Profit by project** is also a report you can download or email.

---

## 13. Foreign currency

**Accountant → Foreign Currency**: invoices and bills in other currencies. Your books stay in rupees, at each document's rate. It has five tabs: **Documents**, **Export invoice**, **Foreign bill**, **Rates** and **Revaluation**.

**Rates**
Enter the rate for a currency and date: rupees for one unit, from the RBI reference rate or your bank. Click **Save rate**. Rates and the month-end revaluation are also on **Accountant → Currency Adjustments**. A document takes the latest rate on or before its date, and you can change it on the document.

**Export invoice**
For exports zero-rated under your letter of undertaking (LUT), with no GST:
1. Fill in the customer, currency, number, date and rate.
2. Add lines with prices in that currency.
3. For goods, add the shipping bill number, date and port code.
4. Click **Save export invoice**. It is a draft; post it from its page under **Sales → Invoices**. It is reported in GSTR-1 table 6A.

**Foreign bill**
The same steps, for a vendor abroad. For imported services, choose the **IGST under reverse charge** rate; you pay that GST on the rupee value. Click **Save bill**, then post it from its page under **Purchases → Bills**.

**Getting paid or paying**
On **Documents**, click **Record receipt** or **Record payment**. Enter the date, the amount in the currency, and **Rate that day**. If the rupees differ from what was booked, the difference posts as an exchange gain or loss, and the message tells you which.

**Revaluation** (month-end)
Pick the month. AiBooks values what is still open at the month-end rate. **Propose revaluation** sends the gain or loss to Review; it reverses itself on the 1st of the next month. Enter the month-end rate on **Rates** first. A currency already given its own adjustment that month is left out.

To revalue one currency on any date at a rate you enter, use a **base currency adjustment** on **Accountant → Currency Adjustments** (see [Currency adjustments](#currency-adjustments)).

---

## 14. Banking

**Banking**: matching your bank statement to your books.

### Bring in the statement
- **Upload statement:** PDF, CSV or Excel, as your bank gives it. AiBooks reads it, sets up the account, and flags lines it may have seen before.
- **Bank feed:**
  1. Click **Connect a bank**.
  2. Enter your Account Aggregator handle (for example `9876543210@onemoney`) and click **Ask for consent**.
  3. Approve it in your AA app, then click **Check approval**.

  New transactions arrive each morning; **Sync now** pulls them at once. **Disconnect** stops the feed; lines already pulled stay.

### Reconcile
The top shows the bank balance, what is in the books, and the difference.

1. Click **Run reconciliation**. AiBooks matches statement lines to invoices, bills and receipts.
2. Check the suggestions, then click **Confirm N matches**. This posts them.
3. For lines that are not in the books:
   - **Settles invoice…** or **Pays bill…** matches one by hand, including part payments.
   - **Categorise N unmatched** asks AI to suggest an account for each. They go to Review for you to approve.
   - **Set aside** parks a line; **Not a duplicate** clears a duplicate flag.
4. **In the books, not on the statement** lists items such as cheques not yet cleared.

When the books agree with the bank, the page says **Reconciled**.

### Transfers
Money between your own accounts, cash withdrawn, cash paid in:
- **Move money:** from, to, amount and date, then **Post transfer**.
- **Look like transfers** suggests pairs AiBooks spotted. Use **Pair as transfer**, **Post to cash in hand** or **Post from cash in hand**.
- **Payment gateway settled into …**: enter the gateway's fee, then **Post from gateway**. This is how Razorpay settlements reach your bank in the books.

---

## 15. Things that repeat, and reminders

For rent, subscriptions, retainers and anything else that comes round again. **Nothing posts on its own:** each is drafted on its date, every morning at 6:30, for you to check and post from its page.

### Recurring invoices (Sales → Recurring Invoices)
1. Click **New recurring invoice**.
2. Pick the customer and give the schedule a **Profile name**. Add the order number, lines, discount and adjustment as on an invoice.
3. Set **Repeat every** (week, 2 weeks, month, 2 months, quarter, 6 months or year), **Start on**, and an end date or **Never expires**, with the payment terms, salesperson and subject.
4. Click **Save schedule**.

### Recurring bills (Purchases → Recurring Bills)
**New recurring bill** is laid out as a bill: the **Vendor name**, a **Profile name** ("Office rent"), **Repeat every** (a week, 2 weeks, a month, 2 months, a quarter, 6 months or a year), **Start on** (the first bill is drafted that day; the form says when the next ones fall), **Ends on** or **Never expires**, and the **Payment terms** each bill is due by. Add the lines with their accounts, tax, discount (on the lines or the whole bill) and customers, and an adjustment, then **Save recurring bill**.

Each one is drafted as a bill on its date, priced on the server as a typed bill is: the same amounts, accounts, discount and adjustment. Nothing posts on its own: check it on **Bills** and post it. The list shows each schedule's lines, discount, adjustment and terms.

### Recurring expenses (Purchases → Recurring Expenses)
1. Click **New recurring expense** and give it a **Profile name**.
2. Set **Repeat every** (week, 2 weeks, month, 2 months, quarter, 6 months or year) and the **Start date**. Under it the form says the date the first one will be created, and the one after. Monthly ones fall on the start date's day (the month's last day when the month is shorter); weekly ones on its weekday.
3. Set **Ends on**, or tick **Never expires**.
4. Fill in the expense as on **Record Expense**: the account (or **Itemize** across accounts), **Paid through**, the amount and GST, the vendor, the customer and **Billable**, a project and notes.
5. Click **Save recurring expense**.

Each one is drafted as an expense on its date, marked as made by the schedule, so you can check this month's amount before posting it. The list shows how often, the next date, the customer and whether it ends.

On each list, **Draft what's due** drafts anything due now, and you can pause, resume or end a schedule at any time.

### Payment reminders
On **Sales → Recurring Invoices**, under **Payment reminders**. Customers with an open invoice hear from you 3 days before it is due, on the day, and 7, 15 and 30 days after. Each step is sent once.
- Turn on **Send reminders automatically** and choose how to send: email, WhatsApp, or WhatsApp when there is no email.
- **Send today's reminders** sends what is due now.
- The log shows every reminder sent.

For provisions and allocations that repeat, use recurring journals in [Month-end](#19-month-end).

---

## 16. Accountant: journals, bulk update and the chart of accounts

**Accountant** in the sidebar: **Manual Journals**, **Bulk Update**, **Currency Adjustments**, **Chart of Accounts**, **Budgets**, **Transaction Locking**, then **Month-end**, **Opening Balances**, **All Vouchers** and **Foreign Currency**.

### Manual journals
For entries that are not a sale, purchase or payment: a provision, a correction, a transfer between accounts.
1. **Accountant → Manual Journals**, then **New journal**.
2. Enter the **Date** and the **Notes** (why the entry is made, up to 500 characters), and a **Reference#** if you have one.
3. **Journal#** shows the number the journal will get in the JNL series. To use a number of your own, click the cog beside it and type it; each one can be used once. The journal still gets its JNL voucher number, so that series has no gaps.
4. Add lines: the **Account**, a **Description**, the **Contact** (a customer or vendor the line is about), and a **Debits** or **Credits** amount, plus a project if it belongs to one. **Enter** in an amount moves to the next line; **Add New Row** adds one.
5. The totals show the **Sub Total** and **Total** of the debits and credits, and the **Difference** in red until it is zero. **Post journal** works once it is.
6. Add the papers behind it under **Attachments**: they are kept with the journal once it posts.

If an approval policy covers journals, it is **Sent for approval** and posts when approved on **Approvals**; attach the files from its page then.

**Reverse journal date.** For an accrual or a provision that cancels itself (say on the 1st of next month), set **Reverse Journal Date**, after the journal's date:
- With **Publish reverse journal only on the reverse journal date** ticked (the usual way), the reversal posts on that date, in the 6:30 am daily run. Until then nothing of it is in the ledger, and the journal shows **Reverses** *date*. If that date is in a locked period, it waits, and posts in the first daily run after the period is unlocked.
- Unticked, the reversal posts at once with the journal, dated the reverse date.

**Accounts a journal cannot use.** Accounts Receivable, Accounts Payable, Advances from Customers, Advances to Vendors and Employee Reimbursements Payable are kept customer by customer, vendor by vendor and claim by claim, from the documents. A journal line on them would move the account without moving any invoice, bill, advance or claim, and the ageing would stop agreeing with the ledger. So the form does not offer them and the books refuse them. Use a credit note or debit note, **Record receipt** or **Record payment**, the advance or claim itself, or **Opening Balances**. A contact on any other line is a tag that shows in the account's ledger; it changes no one's balance.

There is no reporting method to choose: the reports are on the accrual basis.

The list shows every journal voucher, with your Journal# and Reference#. On a journal's page, **Reverse journal** posts the opposite entry; the original stays on record. A journal dated in a locked Accountant period cannot be reversed (see [Transaction locking](#20-transaction-locking-and-year-end)). Files you keep against a journal go in its attachments.

### All vouchers
**Accountant → All Vouchers** lists every posted entry: purchase, sales, payment, receipt, contra and journal, with its number and status. Filter by type. To correct a posted entry, click **Reverse**, then **Reverse entry**. **Files** shows the documents attached to a voucher.

Voucher numbers run without gaps, per type and financial year.

### Bulk update
For posted lines booked to the wrong account: for example a month of repairs booked to rent.
1. **Accountant → Bulk Update**. Under **Filter transactions**, pick the **Account** (required). To narrow it, add any of:
   - **Contact**: a customer or vendor. A line counts as theirs when it is tagged with them (a manual journal's line can carry a contact), or, untagged, when their invoice, bill, credit or debit note, receipt, payment or expense posted the voucher.
   - **Date from** and **Date to**.
   - **Amount from** and **Amount to** (₹): on each line's own debit or credit.
   - **Narration or description contains**.

   Click **Search**. The list shows each line's voucher, date, contact, description and amount. **Clear filters** keeps the account and resets the rest.
2. Tick the lines to move, or **Choose every line**.
3. Under **Move the chosen lines**, pick the account to move them to and say why.
4. Under **Entries**, choose:
   - **One entry per month**: each month's lines move in their own entry, dated at that month's end (today, for this month). The monthly profit and loss then moves in the months the lines are in. This is chosen for you when the lines span months.
   - **One entry for all**: one entry for the net, dated at the end of the latest line's month.

   The table under it shows each entry, its date and what it moves.
5. Click **Propose reclassification**.

This never edits the posted vouchers. The entries go to the review queue together (all or none), and each posts when someone approves it there. A month whose chosen lines net to nothing gets no entry and its lines stay free to move. If a month is locked, its entry is dated the day after the lock. A line already in a live reclassification shows as moved and cannot be moved twice. If every line in an entry shares a project, the entry keeps it. Accounts kept by customer or vendor (receivables and payables) cannot be moved this way: use a credit or debit note.

### Chart of accounts
**Accountant → Chart of Accounts** lists every account with its **Account name**, **Account code**, **Account type**, **Parent account** and balance, groups first with their accounts under them. A lock marks an account the books rely on (a system account); an eye marks one on the dashboard watchlist. Filter by **Active**, **Inactive** or **All** and by type, or search by name, code or type. Click an account to edit it.

**New account:**
1. Choose the **Account Type**. What belongs in it shows beside it.
2. Enter the **Account Name**, and an **Account Code** if you want one (left blank, the next free code for the type is used).
3. Tick **Make this a sub-account** and choose the **Parent Account**: a group of the same kind. Untick it for a top-level account.
4. Add a **Description** (up to 500 characters) and tick **Add to the watchlist on my dashboard** to see its balance on the dashboard.
5. Click **Save account**. Ticking **A group** makes a header that holds accounts and takes no entries.

The account types, and the statement each is reported in:

| Kind (reports) | Account types |
|---|---|
| Asset (balance sheet) | Other Asset, Other Current Asset, Cash, Bank, Fixed Asset, Stock, Payment Clearing, Input Tax |
| Liability (balance sheet) | Other Current Liability, Credit Card, Long Term Liability, Other Liability, Output Tax |
| Equity (balance sheet) | Equity |
| Income (profit and loss) | Income, Other Income |
| Expense (profit and loss) | Expense, Cost of Goods Sold, Other Expense |

Accounts made before these types existed were given one from what they are: Bank and Cash for those accounts, Input Tax for input GST, Output Tax for output GST and reverse-charge GST, Stock for stock in hand, Fixed Asset for the fixed-asset group and accumulated depreciation, Cost of Goods Sold for purchases and direct expenses, Other Income and Other Expense for gains, losses, round-off and suspense, and otherwise by the group they sit in. An asset account typed Bank or Cash can be chosen to pay expenses through.

**Edit** changes the name, code, parent account, description and watchlist. The type can change only to another of the same kind (one expense type to another), because past entries depend on which statement the account is in. A system account keeps its type and cannot be deactivated; it can be renamed and moved. On the edit page, **Deactivate account** retires one you no longer use (**Reactivate account** brings it back), **Move posted lines** opens Bulk Update for it, and **Add sub-account** on a group starts one under it.

### Currency adjustments
**Accountant → Currency Adjustments** lists the **base currency adjustments**: the date, currency, rate, the gain or loss, and whether each is **In review**, **Posted** or **Reversed on the 1st**. Filter by currency and by period (this month, last month, this or last financial year).

**New adjustment** revalues what is still open in one currency at a rate you enter:
1. Click **New adjustment**. Pick the **Currency** and the **Date of adjustment** (today or earlier), type the **Exchange rate** as rupees for one unit (1 AED = 25.58 INR; the last saved rate is filled in to start from) and the **Notes**: why, or the rate's source.
2. Click **Continue**. Each open invoice and bill in that currency shows what is still owed, the rate it is booked at, its booked rupees, its rupees at the new rate, and the gain or loss. Money owed to you worth more is a gain; money you owe worth more is a loss.
3. Click **Propose adjustment**. The rate is saved as that currency's rate for the day, and the gain or loss goes to the review queue: it posts when someone approves it there.

Example: AED 10,000 invoiced at 22.50 (₹2,25,000) and an AED 4,000 bill at 22.60 (₹90,400), revalued at 25.58. The receivable is now ₹2,55,800, up ₹30,800; the payable ₹1,02,320, up ₹11,920. The entry debits Accounts Receivable ₹30,800 and credits Foreign Exchange Gain ₹30,800, and debits Foreign Exchange Loss ₹11,920 and credits Accounts Payable ₹11,920: an unrealised gain of ₹18,880 overall.

It is unrealised, the same entry and accounts as the month-end revaluation: it reverses itself on the 1st of the next month, the documents stay at their booked rate, and the real gain or loss posts when each is paid. So a currency has **one adjustment a month**: a second would count the same difference twice. A month already revalued at month-end (every currency) takes no adjustment, and a date in a locked period is refused. Bank accounts are kept in rupees, so no bank balance is revalued.

Below the list: the **Month-end revaluation** of every open currency at the month-end rates (**Propose revaluation**), and the **Exchange rates** (**Save rate**). See [Foreign currency](#13-foreign-currency).

---

## 17. GST

**Taxes → GST**: returns, registers, reconciliation and input tax credit. Pick the month at the top; **Export registers** downloads the sales and purchase registers as CSV.

The tabs are **GSTR-1 / 3B**, **GSTR-9**, **Purchase register**, **Sales register**, **2A/2B reconciliation** and **Summary**. The page opens on **2A/2B reconciliation**.

### Each month, in this order

**1. Import GSTR-2B and reconcile** (**2A/2B reconciliation** tab)
1. Download your GSTR-2B from the GST portal and click **Import GSTR-2B**. JSON, Excel and CSV all work.
2. Click **Run reconciliation**.
3. Work through **What doesn't match, and why**. Each difference is explained in plain words with what to do, for example a number typed differently, IGST against CGST + SGST, or not in your books.
   - Where the vendor must act, **Copy message for vendor** gives you the message to send.
   - A 2B invoice missing from your books has **Create entry**, which sends it to Review.
4. **Pay before 180 days** lists bills whose GST credit will be reversed if they stay unpaid 180 days after their date.

Importing the 2B matters: without it, credit is claimed on every bill in the month, when the law allows only what your vendors reported.

**2. Check and file GSTR-1** (**GSTR-1 / 3B** tab)
- A red **Fix before filing** box lists what the portal would refuse. An amber **Worth a look** box lists notes.
- Filing:
  1. Click **Save to GST portal**.
  2. Click **Send OTP**.
  3. Enter the 6-digit OTP and tick that you have checked the return.
  4. Click **File GSTR-1**.

  Filing cannot be undone.
- **Download GSTR-1 JSON** gives the file for the GST offline tool, if you prefer to file there.

**3. File GSTR-3B**
GSTR-3B can only be saved once GSTR-1 is filed; the portal fills its sales from it. It shows the tax to pay in cash after input credit, and credit carried forward. File it the same way.

**4. Record the GST payment**
After saving the 3B, enter the challan CPIN (optional) and click **Record GST payment**. This posts the set-off and cash payment for the month as one voucher.

If the books change after you saved a return, save it again before filing.

### Registers and summary
**Purchase register** and **Sales register** list the month's documents with their tax. **Summary** shows your input tax credit, 2B status, output tax and net GST payable.

### GSTR-9 (yearly)
Pick the financial year. AiBooks adds up the monthly returns into tables 4, 5, 6, 7, 9 and 17. Tables 8 and 10–19 are not worked out here: take table 8 from the portal. GSTR-9 is due by 31 December after the year, and is mandatory above ₹2 crore turnover.

### Exports
Exports under LUT appear in GSTR-1 table 6A, GSTR-3B 3.1(b) and GSTR-9 5A. See [Foreign currency](#13-foreign-currency).

---

## 18. TDS

**Taxes → TDS**: tax deducted at source. Pick the financial year. The sections are below.

**Deducting from vendors**
Set a vendor's TDS section on Purchase. Their bills then deduct TDS when posted. **Deducted from vendors** shows each bill's deduction. A vendor without a PAN is flagged: TDS is then due at 20% or more, and the TDS return needs the PAN.

**Depositing**
**To deposit** shows what is due by month and section. One challan per month and section is due by the 7th of the next month (30 April for March).
1. Pay the challan on the income-tax portal first.
2. Click **Record deposit** and enter the date and challan number (CIN).
3. Click **Record deposit of ₹X**. This posts it.

Late deposits are marked **Overdue**; interest runs at 1.5% a month.

**Deducted by customers**
TDS your customers deducted from you is your credit, once it shows in Form 26AS. Enter it when you record their receipt.

**Form 26Q (quarterly)**
Pick the quarter and click **Download 26Q (CSV)**. Fix anything flagged in red, then key it into the RPU and file it. After it is processed, download each vendor's Form 16A from TRACES; only that certificate is valid.

**Match with Form 26AS**
Save Part I of your 26AS as CSV and click **Choose 26AS CSV**. AiBooks shows:
- what customers deducted but did not deposit (ask them to file their TDS return);
- amounts that differ;
- credit in 26AS that your books don't show (likely a receipt recorded without its TDS).

---

## 19. Month-end

**Accountant → Month-end**: adjustments before the books close. Pick the month. **Every entry goes to Review first.**

It has four tabs: **Assistant**, **Fixed assets**, **Accruals & prepaids** and **Recurring journals**.

### Assistant
AiBooks reads the month and lists what it still needs:
- **To propose:** depreciation due, scheduled entries, and accruals for bills that usually come but have not. Click **Propose entries**.
- **A year paid in one month:** an annual cost such as insurance booked in one month. Click **Spread over 12 months**.
- **Assets booked as expenses:** a purchase that should be an asset. Click **Capitalise**, check the details, and confirm.
- **Closing stock:** if you keep stock. See [Stock](#11-stock).

Then approve them in Review.

### Fixed assets
- **Add asset:** name, category, cost, asset account, purchase and put-to-use dates, and method (SLM or WDV). Useful lives follow Schedule II.
- **Run depreciation to the end of** the month sends depreciation to Review.
- **Sell or scrap:** the date and the sale price (0 if scrapped), then **Propose disposal**. Depreciation to the date, removing the asset, and the gain or loss go to Review as one entry.
- **Tax depreciation** shows the income-tax block table for the year. Additions in use under 180 days take half the rate.

### Accruals & prepaids
- **Accrual:** a month's cost before its bill comes, such as rent or audit fees. Each month it books the expense, and reverses it on the 1st.
- **Prepaid:** paid ahead, spread over the months it covers.

Use **New schedule**, then **Create schedule**. **Draft entries due to** the month sends them to Review.

### Recurring journals
For provisions or allocations that repeat: **New recurring journal** (debit, credit, amount, how often), then **Create recurring journal**. On each date it is drafted into Review; it never posts by itself.

### Also at month-end
- **Accountant → Currency Adjustments** (or **Foreign Currency → Revaluation**) for open foreign invoices and bills.
- **Accountant → Bulk Update** to move anything booked to the wrong account.
- GST and TDS, then lock the month. See the [checklist](#23-your-monthly-and-yearly-checklist).

---

## 20. Transaction locking and year-end

**Accountant → Transaction Locking**

### Lock a module
Sales, Purchases, Banking and Accountant each have a card that says either **You have not locked the transactions in this module** or the date it is locked through, with the reason.
1. On the card, click **Lock**. A panel opens at the right.
2. Set the **Lock date** (today at the latest) and the **Reason**, for example "GSTR-1 for September filed", then click **Lock** *module*.
3. To lift it, click **Unlock** on the card, say why, and click **Unlock** *module*. **Change date** moves the lock to another date.

Once a module is locked, nothing in it dated on or before the lock date can be created, changed or deleted:
- no entry of that module dated on or before it can be posted: payments, notes and reversals included;
- an entry of that module dated on or before it cannot be reversed (reversing a sale or a bill would also send its invoice or bill back to draft). Correct it with a new entry dated after the lock, or unlock the module first.

What each module covers:

| Module | Entries |
|---|---|
| Sales | Invoices, credit notes, customer receipts, customer advances and refunds to customers, and advances applied to invoices |
| Purchases | Bills, debit notes, vendor payments and advances, vendor refunds, expenses (including a bank line filed as an expense), expense claims and their reimbursement |
| Banking | Transfers between bank, cash and the payment gateway, confirming bank matches, and other money in or out of the bank that is not one of the above (owner's money, TDS deposited, loan repaid) |
| Accountant | Manual journals, month-end adjustments and accruals, depreciation, revaluation of foreign invoices and bills, GST set-off, and opening balances |

A journal's scheduled reversal (see [Manual journals](#16-accountant-journals-bulk-update-and-the-chart-of-accounts)) is checked on its own date: if that date is locked it waits, and posts in the first daily run after the period is unlocked.

### Lock the whole books
Once a month's returns are filed you can also lock every module at once:
1. Check the list **Still open on or before** the date: documents waiting for review, unposted invoices and bills, bank lines not in the books, bank matches waiting, and depreciation not booked. Each has a link to sort it out. The list is advice; it does not stop the lock.
2. Under **Lock the whole books**, set **Lock through** and click **Lock books**.

Nothing dated on or before that date can then be posted, in any module, including payments, notes and reversals. It applies on top of the module locks: an entry is refused when either covers it, and unlocking a module leaves the whole-books lock in place. **Unlock books** lifts it if you must change something. **Lock history** shows every lock and unlock, of the whole books and of each module, with the reason.

### Close the year
After 31 March:
1. Finish March's month-end and returns.
2. Under **Year-end close**, click **Close FY** *year*. This moves the year's income and expenses into Retained Earnings with one entry dated 31 March, and locks the year. The year's P&L still shows what happened in it.
3. **Reopen FY** *year* reverses the closing entry and lifts the lock. A later closed year must be reopened first.

Also for the year: GSTR-9 (by 31 December), the Q4 Form 26Q, and fixed-asset tax depreciation.

---

## 21. Reports, documents and insights

### Reports Center
**Reports → Reports** opens the **Reports Center**: every report in one place, from posted entries only.

**The panel on the left**
- **Home:** all reports, grouped by category.
- **Favorites:** the reports you starred. Click the star beside a report's name to add or remove it.
- **Shared Reports:** custom reports someone shared with the organisation.
- **My Reports:** custom reports you made.
- **Scheduled Reports:** every report emailed on a schedule, with **Send now**, **Stop** and **Resume**.
- **Report category:** Business Overview, Sales, Receivables, Payments Received, Recurring Invoices, Payables, Purchases and Expenses, Taxes, Banking, Projects and Timesheet, Inventory, Accountant, Budgets, Currency, Activity, Automation.

The list shows each report's **Report name**, **Report category**, **Created by** (**System Generated**, or the person) and **Last visited**. Favorites and Last visited are your own; others in the organisation have theirs. Type in **Search reports** to find one by name.

**The reports, by category**
- **Business Overview:** Profit and loss; Profit and loss (Schedule III); Horizontal profit and loss; Balance sheet; Balance sheet (Schedule III), with MSME dues shown apart; Horizontal balance sheet; Cash flow statement (indirect method); Cash in and out; Cash flow forecasting; Business performance ratios (current, quick and cash ratio, debt-equity, margins, return on equity, interest cover, debtor, creditor and inventory days); Movement of equity; P&L by month; P&L compared.
- **Sales:** by customer, item, month and salesperson; Sales summary.
- **Receivables:** AR ageing summary and details; Invoice, Sales order, Delivery challan, Quote and Quote item details; Customer balance summary; Receivable summary and details.
- **Payments Received:** Payments received; Credit note details; Refund history; Time to get paid.
- **Recurring Invoices:** Recurring invoice details.
- **Payables:** AP ageing summary and details; Bill details; Vendor balance summary; Payable summary and details; Purchase order details; Vendor credit details; Payments made; Refund history; MSME dues (section 43B(h)).
- **Purchases and Expenses:** Purchases by vendor, item and month; Expenses by category, customer, project and employee; Expense details; Billable expense details; Mileage expenses; Expense claim details.
- **Taxes:** GST summary; GSTR-1 summary; GSTR-3B summary; HSN summary; ITC reconciliation (GSTR-2B); TDS deducted; TDS payable; Form 26Q summary; TDS receivable.
- **Banking:** Reconciliation status; Bank book; Cash book.
- **Projects and Timesheet:** Project summary; Project details; Project profit; Timesheet details; Unbilled time.
- **Inventory:** Inventory summary; Inventory valuation summary.
- **Accountant:** General ledger; Detailed general ledger; Account transactions; Account type summary; Journal report; Account ledger; Trial balance; Day book.
- **Budgets:** Budget against actual.
- **Currency:** Realised and Unrealised exchange gain or loss.
- **Activity:** Activity log; Activity by user.
- **Automation:** Recurring runs; Payment reminders sent.

**Opening a report.** Click its name. Set the period it takes (from and to months, a financial year, an **As at** date, a month, or a quarter) and any filter it has, such as a customer, vendor, account, project or status. Then:
- **PDF**, **CSV** or **Excel** downloads it;
- **Schedule** emails it as a PDF on a rhythm: the period it covers (last month, last quarter, this year so far…), monthly on a day or weekly, to up to ten addresses;
- the star adds it to Favorites;
- **Customize** makes your own copy (below).

Statements that must agree show **Ties out ✓**: the trial balance, the balance sheets, the cash flow statement.

**Schedule III.** The Schedule III statements follow the Companies Act, 2013, Division I. Each account is placed under a head by its role, its group and its name (a bank account in credit is a short-term borrowing, a security deposit is a long-term advance). Choose **Show: Heads and their accounts** to see where every account went. Trade payables are split into dues of micro and small enterprises and the rest, from your vendors' MSME details. The previous year's figures sit beside this year's.

**Create New Report.** Click **Create New Report**, choose one, then **Proceed**:
- **Create from existing report:** pick a report, then choose the columns and their order, the period (chosen when opened, relative to the day it runs, or fixed), the report's own filters, conditions on rows ("Net sales at least ₹50,000"), **Group by** with subtotals (or **Show only the group totals**) and **Sort by**. A statement such as a balance sheet keeps its rows in order: only its columns and period can be chosen.
- **Create an entirely new report:** pick a module (invoices, bills, expenses, payments, journal lines, items, customers, vendors or time entries), its fields, conditions, a field to group by with sums, and the sort. Only posted invoices, bills, expenses, payments and journal lines are read.

**Preview report** shows it; give it a name and click **Save report**. It goes under **My Reports**. Tick **Share with everyone in the organisation** to put it in **Shared Reports**: others can open, download and schedule it, but only you can change or delete it (**Edit report**, **Delete**). A custom report saves only its design and reads the books afresh every time. Creating, changing, sharing and deleting it are in the audit trail.

**Statements with charts** (at the foot of the panel) is the year view of the P&L, balance sheet, cash flow, trial balance, ledger, day book and ageing, with charts.

### Management reports
**Reports → Management Reports**.

**Reports tab.** Pick a report, then the months or year:
- **Profit:** profit and loss by month; profit and loss compared with the period before and with last year; expenses by category; budget against actual; profit by project.
- **Sales and purchases:** by customer or vendor, by item, by month.
- **Money owed:** receivables by customer and payables by vendor, with how long each takes to pay.
- **Tax and books:** GST summary, trial balance, balance sheet.

Download any as **PDF** or **CSV**, or **Email on a schedule**.

**Budgets** (**Accountant → Budgets**; also the **Budgets** tab here)
A year can have several budgets, each with a name (a plan and a stretch plan, say). One is the year's **default**: the first made for the year, until you **Make default** another.
1. Click **New budget**. Give the **Name**, the **Financial year** and the **Budget period**: **Monthly**, **Quarterly**, **Half-yearly** or **Yearly**.
2. Under **Accounts**, add the **Income accounts** and **Expense accounts** to plan (**All** adds every one). Tick **Include asset, liability and capital accounts in the budget** to plan those too, as the movement you expect in each period.
3. Type the amounts in the grid, one column per period. Each row and each column has a total, and the profit shows under them. Or set a percentage and click **Fill from last year**: last year's figures from the books, raised or cut by it (for the accounts chosen, or every account with a figure if none is chosen yet).
4. Click **Save budget**.

A quarter's, half-year's or year's amount is kept as months: split evenly to the paisa, the remainder on the last month (₹1,000 for a quarter is ₹333.33, ₹333.33 and ₹333.34). Changing the period later re-spreads each row's amounts.

In the list, **Make default**, **Archive** (kept out of the way; **Restore** brings it back) or **Delete** (gone from every list; its last figures stay in the audit trail). If the default is archived or deleted, the year's most recently changed budget becomes the default.

**Budget against actual** reads the budget you pick under **Budget**, or the year's default. Asset, liability and capital rows compare the budget with each account's movement in those months. **Against actual** in the budgets list opens it for that budget.

A budget made before named budgets existed is carried over, once, as **Budget** and its year (for example **Budget 2026-27**), by month, as that year's default.

Budgets never touch the books.

**Scheduled emails tab**
Click **Schedule email**, then choose:
- a report;
- the period it covers (last month, last quarter, this year so far…);
- how often (monthly on a day, or weekly);
- up to ten email addresses.

Each email carries the report as a PDF. **Send now** sends it at once to check. **Stop** and **Resume** control it.

### Ask your books
On the Dashboard and Management reports. Type a question in plain words:
- "What was my profit last month?"
- "Who owes me money?"
- "How much did we spend on rent this year?"

You get a short answer, the report rows it used (marked), and **Open the report**. Answers worded by AI are amber with a sparkle; every figure in them is checked against the report. It only reads your books; it cannot change anything.

### The month in words
Pick a month and click **Write the summary**. You get a few sentences: profit and what moved it, who is paying late, and cash. Every figure comes from the books; **Show the figures behind it** lists them.

### Insights
**Reports → Insights** shows:
- a 13-week cash forecast, with a warning if cash runs short;
- a profit outlook;
- cards on things worth a look.

It is a projection, not a promise, and changes nothing.

### Exports and Tally
At `/exports` (also linked from Settings → Integrations), download reports as CSV or Excel. **Sync now** queues the year's posted vouchers for the Tally connector running on your Tally PC.

### Audit trail
**Reports → Audit Trail**: every change to your books, who made it, when, and what it was before. Filter by record, person, action and date. Click a row to see before and after, or a record to see its whole history. Nothing here can be edited.

Each invoice, bill and party also has a **History** link.

### Documents
**Documents** in the sidebar has a panel of its own on the left:

- **All Documents:** every file in the books.
- **Inboxes:** **Files** (the Inbox, section 4) and **Bank Statements**.
- **Folders:** your own folders, each with how many files it holds.

**All Documents** lists bills, invoices, statements and receipts that came in (uploaded, emailed or sent on WhatsApp) and files attached to invoices, bills, vouchers, expenses, claims, customers and vendors. Each row shows:

- **File name**, with its status (**Reading…**, **Ready to review**, **Imported**, **Posted**, **Entered**, **Attached**, **Duplicate?**, **Couldn't read**, **Rejected**). For a document that could not be read, the reason and **Try again**. Click the name to open the file.
- **Uploaded by:** the person, or the email address or WhatsApp number it was sent from.
- **Uploaded on:** click the heading to show the oldest first.
- **Associated to:** what it became, as a link: **Bill SGP/1342**, **Expense EXP/…**, **Journal JNL/…**, the record a file is attached to, or for a statement its bank account and lines (the link opens its reconciliation). One still waiting says **Waiting in Review**.
- **Folder**, with a menu to move it.
- **Add to** on a document not yet entered, to enter it yourself (section 4).

Search by file name, party, number or record; use **Filter by file type** (PDF, images, spreadsheets, Word and text) and the status list (**Not entered yet** shows what you can still enter with **Add to**). **Upload file** adds documents; inside a folder, they are filed there.

**Folders.** Click **+** beside **Folders**, type a name and click **Create folder**. Point at a folder to rename it (pencil) or delete it (bin); deleting a folder moves its files to no folder and deletes no file. To file documents, use a row's **Folder** menu, or tick several, choose the folder under **Move to** and click **Move**. Folders only group files: filing changes nothing in the books, and every move is in the audit trail.

**Bank Statements** lists every statement that came in: its bank account, the period, the lines imported, and how many are matched, confirmed and unmatched. **Run reconciliation** opens that account in Banking. A statement that could not be read shows why; export it from your bank as Excel or CSV, or try a clearer PDF. **Upload statement** adds one.

---

## 22. For CA firms: the Practice section

If you are a CA firm, AiBooks also runs your practice. Without a firm, the sidebar shows **Practice → Set up practice**: enter your practice name, click **Set up**, then sign in again. The Practice, Growth & fees and Firm groups then appear.

| Screen | What it does |
|---|---|
| **Practice home** | Clients, pending deadlines, fees collected and outstanding, upcoming compliance deadlines, leads and recent activity |
| **Clients** | Every client with their services. **Add client**: name, type, contact, PAN, GSTIN, WhatsApp, email and the services you handle. Services decide which deadlines and document checklists they get. |
| **Compliance** | GST, TDS, ITR and ROC deadlines generated from each client's services. **Refresh calendar** adds new ones; **Send due reminders** reminds clients 7, 3 and 1 days before. **Mark filed** per client. |
| **Document hub** | What each client still owes you. **Request documents** builds a checklist from the service. Uploads are matched to it automatically; you **Verify** each. **Remind** or **Remind everyone** chases them. |
| **Tasks** | Your team's own work board: To do, In progress, Blocked, Done. **Add task** with a client, priority, assignee and due date. |
| **Leads** | Enquiries from every channel. **Add lead**; **Qualify with AI** scores and summarises it, and moving it is your call. **Run follow-ups** nudges them. |
| **Fees** | Your own fee invoices. **Raise invoice**, **Issue**, **Record payment**. **Run collections** sends reminders on a ladder, and flags very late ones. |
| **Support agent** | Answers clients' questions from their real records. Fees, sensitive matters and anything it is unsure of come to you; **Hand back to agent** when done. |
| **Messaging** | The outbox of every message sent to clients, the templates, and the delivery settings |
| **Practice reports** | Revenue, client growth, compliance, leads and automation over six months |
| **Firm & branding** | Your client list (click a client to open its review queue), portal branding (logo, accent colour) and your custom domain |

To check a client's books, click the client in **Firm & branding**: it opens that client's review queue.

---

## 23. Your monthly and yearly checklist

**Every day or week**
- [ ] Clear the **Inbox** and **Review** queue.
- [ ] Approve what waits in **Approvals**.
- [ ] Post draft invoices and bills.
- [ ] Record receipts and payments; reconcile the bank.

**By the 7th:** record last month's TDS deposits (**TDS**).

**Each month, after it ends**
1. [ ] **Accountant → Month-end → Assistant:** propose entries, spread prepaids, capitalise assets.
2. [ ] **Stock → Stock entries:** propose closing stock, if you keep stock.
3. [ ] **Accountant → Currency Adjustments:** the month-end revaluation, if you have foreign documents.
4. [ ] **Review:** approve the month-end entries, and any reclassification from **Bulk Update**.
5. [ ] **Banking:** the books agree with the bank.
6. [ ] **GST:** import the 2B, reconcile, file GSTR-1 (by the 11th), file GSTR-3B (by the 20th), and record the GST payment.
7. [ ] **Accountant → Transaction Locking:** clear the list, then lock the month.
8. [ ] **Reports:** read the month in words; send the reports.

**Each quarter:** Form 26Q, and match Form 26AS.

**Each year, after 31 March**
1. [ ] March's month-end and returns.
2. [ ] Fixed-asset tax depreciation.
3. [ ] **Close FY** on **Transaction Locking**.
4. [ ] The Q4 Form 26Q.
5. [ ] GSTR-9 by 31 December.

---

## 24. Test mode, and what is not live yet

Some connections run in test mode until they are set up on your server. The screen always says so.

| Where | What test mode means |
|---|---|
| GST filing | "Test gateway: nothing reaches the GST portal. The OTP is 123456." Results say **Filed (test)**. |
| E-invoice and e-way bill | "Test gateway: IRNs made here are not registered with the IRP." Results say **(test)**. |
| Bank feed | Runs against a test bank with made-up transactions; use **Approve (test bank)**. |
| Payment links | "Test payment link copied. It takes no money." **Test: pay** marks it paid. |
| Reminders and client messages | Written and logged but not sent: **Logged (not sent)**, or **Mock** in the Practice outbox. |
| Support agent | **Send as client** stands in for WhatsApp. |
| Email | Invoice email, password resets and scheduled reports need a mail server set up. |
| Reading documents and AI | Needs an AI key on the server. Without one, Ask your books and the month in words answer by rules only. |

**Not available yet**
- Two-factor sign-in can be used, but there is no screen to turn it on.
- Adding a team member does not send an invitation: they must sign up first.
- **Settings → Integrations** and **Settings → Branding** are previews and do not save. Firm branding works in **Firm & branding**.
- **Settings → Invoice template** is coming; invoices use the default.
- The financial-year picker on **All Vouchers** does not filter the list.
- **Skip** on a duplicate in the Inbox only hides it in your browser.
- Exports with payment of IGST, and e-invoices for exports. Exports are supported under LUT.
- Form 27Q, and filing GSTR-9 from AiBooks (it is prepared, not filed).
- More than one stock location.
- Exchange rates are entered by hand, not fetched.
- Billable expenses are listed per customer, but cannot yet be added to an invoice from there: add them to the invoice by hand.

---

## 25. Quick answers

**Where do I add a customer or vendor?**
**Sales → Customers → New customer**, and **Purchases → Vendors → New vendor**. The **+** beside each in the sidebar does the same.

**I created an invoice but it is not in my reports.**
It is a draft. Open it and click **Post to ledger**.

**Approve & post is greyed out.**
A line has no account, or debits do not equal credits. Click **Edit lines** and fix it.

**My bill says "Sent for approval".**
An approval policy covers it. Someone else must approve it on **Approvals**.

**I posted something wrong.**
Reverse it (**Reverse journal** on a manual journal, or **Reverse** on **All Vouchers**), or raise a credit or debit note. Then enter it correctly. Posted entries are never edited.

**It says the books are locked.**
The date falls in a locked period. Date it after the lock, or **Unlock books** on **Accountant → Transaction Locking**.

**My uploaded bill is not in Review.**
Check the **Inbox**. It may still be **Reading…**, marked **Duplicate?**, or **Couldn't read** (**Try again**).

**Why is my input tax credit lower than my bills' GST?**
Credit is claimed only for what your vendors reported in GSTR-2B. Check **What doesn't match, and why**, and send vendors the message.

**My stock shows "Below nothing".**
An invoice took out more than the bills brought in. A bill is probably missing, or its line is not linked to the item. Check **Link lines**.

**Something was booked to the wrong account, many times.**
Use **Accountant → Bulk Update**: find the lines, pick the right account, and **Propose reclassification**. It goes to Review as one entry; the originals stay as posted.

**I paid for something by card or cash, with no bill.**
Enter it under **Purchases → Expenses → New expense**, and post it.

**Where are all my files?**
**Documents** lists every upload and every file attached to a record, with a link to open each one and its record.

**Can the AI post entries on its own?**
No. Everything AI reads or suggests waits for a person to approve it.
