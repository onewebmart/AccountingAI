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

**The Dashboard** shows the things to act on today:
- **Ask your books:** type a question such as "Who owes me money?" and get the answer with the report rows behind it.
- **The month in words:** a short summary of the month, from the books.
- **Needs your attention:** entries to review, documents waiting, money overdue from customers, and GST mismatches. Each one links to where you sort it out.
- **Income, expenses, cash on hand and GST due**, with a cash-flow chart, AI observations under **What I noticed**, and a cash forecast.

---

## 4. Getting documents in: Inbox

**Inbox** is where bills, invoices, receipts and bank statements arrive. There are three ways in; whichever you use, each document is read by AI and waits in **Review**. Nothing posts by itself.

**1. Upload**
Drop files on **Drop bank statements, bills, invoices, or receipts**, or click to choose. Several at once is fine. AiBooks accepts:
- PDF;
- photos (JPG, PNG, WEBP, TIFF, HEIC);
- spreadsheets (CSV, XLSX, XLS);
- Word and text files.

Each file can be up to 20 MB. You can also upload from **Sales → Invoices** (**Upload invoice**), **Purchases → Bills** (**Upload bill**) and **Banking** (**Upload statement**).

**2. Forward bills by email**
Your business has its own address, like `bills-xxxx@yourdomain`. Copy it with **Copy address** and forward bills to it, or give it to your vendors. Each attachment is read and waits for review. If the address leaks, **Replace address** retires it at once.

**3. Send bills on WhatsApp**
1. Click **Link a phone**.
2. From that phone, send the message shown (for example `LINK ABC123`) to the business WhatsApp number. The code works once, for 15 minutes.
3. When it says **Phone linked**, photos and PDFs sent from that phone go to your Inbox.

A phone files to one business at a time.

**Following a document**
The table shows each document's status:
- **Reading…**
- **Ready to review**: click **Review**.
- **Posted**
- **Duplicate?**: AiBooks has seen this exact file before.
- **Couldn't read**: click **Try again**.

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
   - **GST likely not claimable**
4. To change the accounts or amounts, click **Edit lines**, then **Done editing**.
5. Click **Approve & post** to put it in the books (toast: **Posted to ledger**), or **Reject** to set it aside. A rejected entry is kept for the audit and never posts.

**Approve & post** stays greyed out until every line has an account and debits equal credits.

**Approve all high-confidence** posts in one go every entry at 90% or above with no warnings. A flagged entry is never included; it waits for you.

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
2. Enter the name, the **GSTIN** (leave it blank if unregistered), the state, email and phone.
   - With a GSTIN, the state is read from it.
   - Without one, pick the state. It is the place of supply on your GSTR-1.
3. Click **Save customer**.

The customer's page shows their details, what they owe, any advance they have paid, and their invoices, with **New invoice** and **Record receipt**. Files you keep against the customer (a rate agreement, say) go in its attachments. **Edit** changes the details.

### Raise an invoice
1. **Sales → Invoices**, then **New invoice**.
2. Under **Customer and dates**, pick the customer, the date and the due date. Leave the number blank to number it automatically. The form says whether the sale is within your state (CGST and SGST) or across states (IGST), from the customer's state.
3. Add a line for each thing sold: pick an **Item** (it fills the description, HSN/SAC, rate and GST %), or type them, with the quantity. Pick a **Project** on a line if the sale belongs to one. **Totals** adds it up as you go.
4. Click **Save invoice**. **It is saved as a draft** and you land on its page. The server works out the tax, so the figures you see are the ones that post.
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
  1. Pick the customer, the amount, the date, and **Bank** or **Cash**.
  2. Optionally add the reference (UTR, cheque number, or the invoice numbers it pays).
  3. Click **Suggest allocation** to let AiBooks spread it across the open invoices: it reads the reference, finds an exact combination, or takes the oldest first.
  4. Adjust it, including any **TDS** the customer deducted, then click **Record receipt**.

  Anything left over is held as an advance.
- **Online:** **Payment link** on a posted invoice creates a Razorpay payment link and copies it for you to send. When the customer pays, the invoice shows it; confirm it to record the receipt.

**Payments Received** lists every receipt. A foreign-currency invoice is received from [Foreign currency](#13-foreign-currency), at the rate that day.

### Advances, credits and refunds
At the foot of **Payments Received**, **Advances and credits — customers** lists money customers paid ahead, and credit from notes. For each:
- **Apply advance** uses it against an invoice;
- **Refund** records paying it back.

### Credit notes
For goods returned, a discount, or a mistake on a posted invoice:
1. Click **Credit note** on the invoice's page, or **Sales → Credit Notes**, then **New credit note**, and choose the posted invoice.
2. Enter the taxable value to take off; the tax follows the invoice's proportions.
3. Give a reason (for example "Two cartons returned") and the date.
4. Click **Post credit note**.

It posts straight away. Any amount beyond what is owed becomes the customer's credit. **Credit Notes** lists them all.

### Chasing payment
The strip on **Invoices** shows what customers owe by how late it is: not yet due, then 1–30, 31–60, 61–90 and 90+ days. **Send reminder** on an invoice's page chases that one. For automatic reminders, see [section 15](#15-things-that-repeat-and-reminders).

---

## 7. Quotes, orders and challans

What comes before an invoice or a bill. **None of it posts.** An order becomes a draft invoice or bill, which you post from its page.

Each has a list, a **New** page, and a record page with its actions. Every form has the same line editor: pick an item (it fills the line, at this customer's last price), or type the description, quantity, rate and GST %.

### Quotes (Sales → Quotes)
- **New quote:** pick the customer and **Valid until**, add lines, then click **Save quote**.
- **Draft from a message** (on the Quotes list): paste the customer's email or WhatsApp message, pick the customer, and click **Draft quote**. AiBooks reads the items and quantities, at the customer's last prices. Check every line before sending.
- On the quote's page, **Send quote** emails the PDF. Then mark it **Accepted** or **Declined**.
- From an accepted quote, choose **Make order** or **Make invoice**; you are taken to what it made.
- **No answer after a week** (on the Quotes list) lists sent quotes to chase, with **Copy follow-up**.

### Sales orders (Sales → Sales Orders)
- **New sales order** (with the customer's PO number), then **Save sales order**.
- Its page shows each line as ordered, invoiced and delivered.
- **Invoice part of it**: choose the quantities, then **Make draft invoice**. Bill all of it or part of it; you cannot bill more than was ordered.
- **Close** or **Cancel order** when you will not bill it further.

### Delivery challans (Sales → Delivery Challans)
For goods that move without an invoice: on approval, job work, or supply invoiced later. Click **New challan**, give the reason and vehicle number, then **Issue challan**. On its page, mark it **Returned** when goods come back.

### Purchase orders and goods received (Purchases → Purchase Orders)
1. **New purchase order:** pick the vendor and the needed-by date, then **Raise purchase order**.
2. On its page, **Send PO** emails it to the vendor.
3. When goods arrive, under **Receive goods** enter the quantities and the vendor's challan number, then **Record goods received**.
4. Under **Bill**, **Make draft bill** bills what was received; post it from the bill's page.
5. **Close** or **Cancel PO** when nothing more will come.

**3-way match.** A bill made from a PO is checked against the PO and what was received. The bill's page shows each difference in words. For example: billed but not on the PO, billed more than ordered, a rate above the PO's, or a GST rate that differs. Items to check before paying are marked **Check before paying**.

---

## 8. Purchases

**Purchases** in the sidebar: one page for each of **Vendors**, **Expenses**, **Recurring Expenses**, **Purchase Orders**, **Bills**, **Recurring Bills**, **Payments Made**, **Payment Runs**, **Vendor Credits** and **Employee Claims**.

### Add a vendor
1. **Purchases → Vendors**, then **New vendor** (or the **+** beside Vendors).
2. Enter the name and **GSTIN** (optional), then click **Save vendor**.

The vendor's page shows their details, what you owe them, and their bills, with **New bill** and **Record payment**. Under **Payment details**:
- **Bank account.** If a vendor asks to change where they are paid, confirm it with them on a number you already have, not one from the email asking for the change.
- **MSME (Udyam) registration.** For micro and small enterprises, AiBooks shows the date you must pay by under section 43B(h): 15 days, or the agreed days up to 45. Paying later means the expense is deductible only in the year you pay.

### Enter a bill
- **Scanned:** **Upload bill** on **Bills** (or use the Inbox), then approve it in **Review**.
- **Typed:**
  1. **Purchases → Bills**, then **New bill**.
  2. Pick the vendor and enter the vendor's bill number and the dates.
  3. Add a line for each thing bought: item, description, HSN/SAC, quantity, rate, GST % and project, as on an invoice.
  4. Click **Save bill**. It is a draft.
  5. On its page, click **Post to ledger**. If an approval policy covers it, it goes for approval first.

TDS is deducted when the bill posts if the vendor has a TDS section set. A bill in a foreign currency is entered from [Foreign currency](#13-foreign-currency).

**Bills** lists them with filters (**Unpaid**, **MSME pay-by**, **Paid**). Each shows when it is due ("Overdue N days", "Due in N days"), and for MSME vendors the 43B(h) date.

### Expenses: paid straight from bank or cash
For money spent without a bill to enter first: a fuel receipt, a courier, bank charges, a small purchase paid by card.
1. **Purchases → Expenses**, then **New expense**.
2. Enter the date, the **expense account**, and the bank or cash account it was **paid through**.
3. Enter the amount before tax and the GST rate. Tick **Inter-state (IGST)** when the supplier is in another state.
4. To claim the GST, the supplier's GSTIN is needed: pick the vendor, or type their GSTIN. If you do not claim it, the GST is part of the expense.
5. Optionally add a reference, notes and a project.
6. Click **Save expense** to keep it as a draft, or **Save and post** to post it now.

Posting makes one payment voucher: the expense (and input GST, when claimed) debited, the bank or cash account credited. Expenses are numbered EXP/2026-27/0001 and on, without gaps. If a payment approval policy covers it, it waits on **Approvals** first. Attach the receipt on the expense's page.

### Pay
- **One bill:** on the bill's page, under **Record payment**, enter the amount and date, then **Record payment**.
- **One payment across many bills:** **Purchases → Payments Made**, then **Record payment**. It works like a receipt; see [Get paid](#get-paid).
- **Payments Made** lists payments to vendors. Switch to **All payment vouchers** to see every payment voucher, single-bill payments and payment runs included.
- **Payment runs** (**Purchases → Payment Runs**), to pay many vendors at once:
  1. Set **Pay on** and optionally a **Cash limit**.
  2. Click **Suggest a run**. AiBooks puts MSME vendors first, then overdue bills, then what falls due by the pay date, within the cash you can spare. Each bill shows why it is included.
  3. Untick anything to hold back, then **Save payment run**.
  4. **Download bank file** and upload it to your bank.
  5. Once the bank has paid, set the date and click **Record as paid**. This posts the payments.

Payments can need approval if a policy covers them.

### Vendor credits (debit notes)
For goods returned, a short supply, or an overcharge on a posted bill: click **Debit note** on the bill's page, or **Purchases → Vendor Credits**, then **New debit note**, and choose the bill. Enter the taxable value and a reason, then **Post debit note**.

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

**Items → Items**: what you sell and buy. Pick an item on an invoice or bill line and its HSN/SAC code, unit, rate and account fill in. The GSTR-1 HSN summary groups by them.

To add one:
1. Click **New item**.
2. Fill in the **Name**, **Code**, **Goods** or **Service**, **HSN or SAC code**, **Unit**, **GST rate**, **Sale price** and **Purchase price**. Optionally set the income and expense accounts; they default to Sales and Purchases.
3. Not sure of the code? Click **Suggest code**. AiBooks checks your past invoices and bills, then its rules, then asks AI, and shows the code with its reason and how sure it is. Click **Use this code**, or **Dismiss**.
4. For goods, **Count in stock** is on unless you turn it off (for consumables nobody counts). Set **Reorder at** and **Order this many** if you want reorder alerts.
5. Click **Create item**.

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
2. Fill in the name, the customer (or **Internal work**), and how it is billed: **By the hour, from timesheets** or **A fixed fee**.
3. Add the **Rate per hour** and the budget (a cap for hourly work, the fee for fixed work). **Budgeted hours** are optional.
4. Under **Invoiced as**, pick the service item that gives its invoices their SAC code, GST rate and income account.
5. Click **Save project**. You land on its page.

### Log time (everyone)
**Time Tracking → Timesheet**, or **Log time** on a project's page: pick the project, date, **Hours**, **Task** (for example "Design") and **Notes**. Tick **Billable** if the customer pays for it, then click **Log time**. Write good notes: invoice lines are worded from them.

The timesheet shows everyone's time, filtered by project, person and dates, with whether each entry is billable, on a draft invoice, or invoiced. You can **Edit** or **Remove** your own entries until they are invoiced.

### Bill the time
1. Open the project.
2. **Unbilled time** lists the hours waiting, by task and rate.
3. Click **Draft invoice from time**. AiBooks makes one draft invoice with a line per task, tags it with the project, and marks the time as invoiced, so it cannot be billed twice.
4. If AI is set up, it then words each line from the time notes.
5. **Open the draft invoice**, check it, and post it from its page.

### Track it
The **Projects** list shows each project's income, costs, profit, hours and unbilled time.
- Income and costs come from invoice, bill, expense and journal lines tagged with the project. Pick the project on the line when you create it.
- Alerts warn at 80% of the budget, and when it is over.
- A note lists anyone who has logged nothing in the last week.

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
Pick the month. AiBooks values what is still open at the month-end rate. **Propose revaluation** sends the gain or loss to Review; it reverses itself on the 1st of the next month. Enter the month-end rate on **Rates** first.

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
2. Pick the customer, add the lines, and set how often (monthly, quarterly or yearly), the day, the start and end dates, and when each invoice is due.
3. Click **Save schedule**.

### Recurring bills (Purchases → Recurring Bills)
**New recurring bill**: the vendor, the amount before tax, GST, how often, the day, the dates and when it is due. Then **Save recurring bill**. Each one is drafted as a bill.

### Recurring expenses (Purchases → Recurring Expenses)
**New recurring expense**: the expense account, the bank or cash account it is paid through, the amount and GST, and the schedule. Then **Save recurring expense**. Each one is drafted as an expense, marked as made by the schedule, so you can check this month's amount before posting it.

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
2. Enter the date and narration.
3. Add lines: the account, a debit or a credit, and a project if it belongs to one. **Add line** for more.
4. The debits and credits must be equal; the form shows any difference. Then click **Post journal**.

If an approval policy covers journals, it is **Sent for approval** and posts when approved on **Approvals**.

The list shows every journal voucher. On a journal's page, **Reverse journal** posts the opposite entry; the original stays on record. Files you keep against a journal go in its attachments.

### All vouchers
**Accountant → All Vouchers** lists every posted entry: purchase, sales, payment, receipt, contra and journal, with its number and status. Filter by type. To correct a posted entry, click **Reverse**, then **Reverse entry**. **Files** shows the documents attached to a voucher.

Voucher numbers run without gaps, per type and financial year.

### Bulk update
For posted lines booked to the wrong account: for example a month of repairs booked to rent.
1. **Accountant → Bulk Update**. Under **Find transactions**, pick the **Account**, optionally the dates (**From**, **To**) and **Narration or description contains**, then click **Find transactions**.
2. Tick the lines to move, or **Choose every line**.
3. Under **Move the chosen lines**, pick the account to move them to and say why.
4. Click **Propose reclassification**.

This never edits the posted vouchers. It proposes **one** reclassification entry, moving the net of the chosen lines, to the review queue; it posts when someone approves it there. A line already in a live reclassification shows as moved and cannot be moved twice. If every chosen line shares a project, the entry keeps it. Accounts kept by customer or vendor (receivables and payables) cannot be moved this way: use a credit or debit note.

### Chart of accounts
**Accountant → Chart of Accounts** shows your ledger groups and accounts under Assets, Liabilities, Income, Expenses and Capital, with each account's balance.

- **New account:** a name, a type and the group it sits under, then **Save account**. **Add sub-account** on a group starts one under it.
- **Edit** changes an account's name, code and group. Its type never changes, because past entries depend on it.
- **Deactivate account** retires one you no longer use; **Reactivate account** brings it back. Accounts the books rely on (the system accounts) cannot be deactivated.
- **Move posted lines** on an account opens Bulk Update for it.

### Currency adjustments
**Accountant → Currency Adjustments**: **Exchange rates** (**Save rate**) and the **Month-end revaluation** of open foreign invoices and bills (**Propose revaluation**). See [Foreign currency](#13-foreign-currency).

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

### Lock a period
Once a month's returns are filed:
1. Check the list **Still open on or before** the date: documents waiting for review, unposted invoices and bills, bank lines not in the books, bank matches waiting, and depreciation not booked. Each has a link to sort it out. The list is advice; it does not stop the lock.
2. Set **Lock through** and click **Lock through** *date*.

Nothing dated on or before the lock can then be posted, including payments, notes and reversals. **Unlock books** lifts it if you must change something. **Lock history** shows every lock and unlock.

### Close the year
After 31 March:
1. Finish March's month-end and returns.
2. Under **Year-end close**, click **Close FY** *year*. This moves the year's income and expenses into Retained Earnings with one entry dated 31 March, and locks the year. The year's P&L still shows what happened in it.
3. **Reopen FY** *year* reverses the closing entry and lifts the lock. A later closed year must be reopened first.

Also for the year: GSTR-9 (by 31 December), the Q4 Form 26Q, and fixed-asset tax depreciation.

---

## 21. Reports, documents and insights

### Reports
**Reports → Reports**: the books' statements for a financial year, from posted entries only.
- **P&L**, **Balance Sheet**, **Cash Flow**, **Trial Balance**
- **Ledger:** pick an account
- **Day Book:** every voucher
- **Ageing:** what customers owe and what you owe vendors, by how late

Download as **Excel**, **CSV** or **PDF**.

### Management reports
**Reports → Management Reports**.

**Reports tab.** Pick a report, then the months or year:
- **Profit:** profit and loss by month; profit and loss compared with the period before and with last year; expenses by category; budget against actual; profit by project.
- **Sales and purchases:** by customer or vendor, by item, by month.
- **Money owed:** receivables by customer and payables by vendor, with how long each takes to pay.
- **Tax and books:** GST summary, trial balance, balance sheet.

Download any as **PDF** or **CSV**, or **Email on a schedule**.

**Budgets** (also **Accountant → Budgets**)
1. Pick the year and type the budget for each income and expense account by month. Or **Fill from last year**, raised or cut by a percentage.
2. Click **Save budgets**.
3. Compare them under **Budget against actual**.

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
**Documents** in the sidebar lists every file in the books: bills, invoices, statements and receipts sent to the Inbox, and files attached to invoices, bills, vouchers, expenses, claims, customers and vendors.
- Search by file name, party or number, and filter by status (**Ready to review**, **Posted**, **Attached**, **Reading**, **Duplicate?**, **Couldn't read**, **Rejected**) or by type.
- **Open file** opens it. The link beside it takes you to where it is used: **Review** for a document waiting, **Open voucher** for one posted, or the record a file is attached to.
- **Upload in the inbox** adds new documents.

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
