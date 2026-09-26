# Station profile, logo and documents

NexGen makes PDF documents for invoice customers: **invoices**, **debit notes**
(DN- bills) and **credit notes**. Each one carries the station's logo and
details at the top and the payment details at the foot.

## The station profile

Fill it in once on the desktop: **Settings → Station profile**. Only the
station name is required before documents can be made; the rest is shown when
filled in:

- station name, registered business name, location, postal address;
- phone, email, KRA PIN, VAT number (if registered);
- M-Pesa payment details (e.g. Buy Goods Till number) and bank details;
- a short note printed at the end of every document.

The name and address the desktop used to keep on its own are carried into the
form the first time you open it; check them and press Save.

## The logo

NexGen comes with the NexGen Filling Station logo, rebuilt from the canopy
sign. It shows on documents, at the top of the desktop menu and on the phone's
sign-in page. To use a different logo, press **Upload a logo** in the station
profile (PNG or JPEG, under 2 MB); **Use the NexGen logo** switches back.

## Documents

- **Desktop:** open an invoice (Invoice Customers → Invoices → View) and press
  **PDF**; a credit note has its own **PDF** in the invoice's notes. The
  customer's invoice list also has **PDF** beside each issued invoice.
- **Phone (administrators):** Invoice Customers → a customer → Invoices →
  **PDF**.

Each document is **saved the moment it is issued**, with the profile as it is
then, and the same file is shown every time after. Changing the profile later
changes only documents issued from then on, so a reprint years later matches
what the customer received. An invoice issued before this feature gets its PDF
the first time it is opened. Drafts have no document until they are issued.

Every document says at the foot: **"This is not a tax invoice. Tax invoices
are issued through KRA eTIMS."** Since 1 January 2024 a business can only claim
fuel as an expense with an eTIMS tax invoice, so customers still need theirs
from POSitive.

## Backups

The saved PDFs are kept inside the database, so every backup holds them. Since
this change a backup also copies the uploaded supplier invoice PDFs into a
folder beside the database copy.

## Not yet

Documents are not emailed or sent by WhatsApp from NexGen, and customers'
addresses are not on file, so documents show the customer's name, phone and
KRA PIN.
