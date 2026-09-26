import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import type { StationProfile } from './stationProfile';

// The one look every NexGen document shares (M8): logo and station details at
// the top, the document's own body, and at the foot the payment details, the
// "not a tax invoice" notice and page numbers. Uses the PDF standard fonts, so
// no font files ship with NexGen; the logo is an image and keeps its lettering.

const NAVY = '#263C96';
const TEAL = '#00838F';
const GREY = '#5A6478';
const LINE = '#D5DAE3';

export const NOT_A_TAX_INVOICE = 'This is not a tax invoice. Tax invoices are issued through KRA eTIMS.';

const printer = new PdfPrinter({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
});

export const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const number2 = (value: unknown) => Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function longDate(value: unknown): string {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const [y, m, d] = text.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

const fuelName = (fuel: unknown) => {
  const text = String(fuel || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

export type Party = { name: string; phone?: string | null; kra_pin?: string | null };
export type DocumentLine = { description: string; litres: number | null; price: number | null; amount: number };

export type DocumentInput = {
  profile: StationProfile;
  logo: { data: Buffer; mime: string };
  title: string;
  number: string;
  details: Array<[string, string]>;
  customer: Party;
  lines: DocumentLine[];
  totals: Array<{ label: string; amount: number; strong?: boolean }>;
  notes: string[];
};

function stationBlock(p: StationProfile): Content {
  const rows: Content[] = [{ text: p.trading_name || '', bold: true, fontSize: 12, color: NAVY }];
  if (p.registered_name && p.registered_name !== p.trading_name) rows.push({ text: p.registered_name });
  if (p.physical_address) rows.push({ text: p.physical_address });
  if (p.postal_address) rows.push({ text: p.postal_address });
  const contact = [p.phone && `Tel ${p.phone}`, p.email].filter(Boolean).join('  ·  ');
  if (contact) rows.push({ text: contact });
  const tax = [p.kra_pin && `KRA PIN ${p.kra_pin}`, p.vat_number && `VAT No. ${p.vat_number}`].filter(Boolean).join('  ·  ');
  if (tax) rows.push({ text: tax });
  return { stack: rows, alignment: 'right', fontSize: 9, color: GREY, lineHeight: 1.2 };
}

function paymentFooter(p: StationProfile): string {
  return [p.mpesa_details && `M-Pesa: ${p.mpesa_details}`, p.bank_details && `Bank: ${p.bank_details}`]
    .filter(Boolean)
    .join('     ');
}

export function documentDefinition(input: DocumentInput): TDocumentDefinitions {
  const { profile } = input;
  const logo = `data:${input.logo.mime};base64,${input.logo.data.toString('base64')}`;
  const lineRows: TableCell[][] = [
    [
      { text: 'Description', style: 'th' },
      { text: 'Litres', style: 'th', alignment: 'right' },
      { text: 'Price per litre', style: 'th', alignment: 'right' },
      { text: 'Amount (KES)', style: 'th', alignment: 'right' },
    ],
    ...input.lines.map((line) => [
      { text: line.description },
      { text: line.litres == null ? '' : number2(line.litres), alignment: 'right' as const },
      { text: line.price == null ? '' : number2(line.price), alignment: 'right' as const },
      { text: number2(line.amount), alignment: 'right' as const },
    ]),
  ];
  const totalRows: TableCell[][] = input.totals.map((row) => [
    { text: row.label, alignment: 'right', bold: row.strong, color: row.strong ? NAVY : GREY },
    { text: kes(row.amount), alignment: 'right', bold: row.strong, color: row.strong ? NAVY : undefined },
  ]);
  const payment = paymentFooter(profile);

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 78],
    info: { title: `${input.title} ${input.number}`, author: profile.trading_name || 'NexGen', creator: 'NexGen' },
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#1F2937' },
    styles: {
      th: { bold: true, color: 'white', fillColor: NAVY, fontSize: 9 },
      label: { fontSize: 8, color: GREY, bold: true },
    },
    content: [
      { columns: [{ image: logo, fit: [200, 62] }, stationBlock(profile)], columnGap: 20 },
      { canvas: [{ type: 'line', x1: 0, y1: 10, x2: 515, y2: 10, lineWidth: 2, lineColor: TEAL }], margin: [0, 0, 0, 14] },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'BILL TO', style: 'label', margin: [0, 0, 0, 3] },
              { text: input.customer.name, bold: true, fontSize: 11 },
              ...(input.customer.phone ? [{ text: `Tel ${input.customer.phone}` }] : []),
              ...(input.customer.kra_pin ? [{ text: `KRA PIN ${input.customer.kra_pin}` }] : []),
            ],
          },
          {
            width: 'auto',
            stack: [
              { text: input.title, fontSize: 18, bold: true, color: NAVY, alignment: 'right' },
              { text: input.number, fontSize: 11, bold: true, color: TEAL, alignment: 'right', margin: [0, 0, 0, 6] },
              {
                table: {
                  body: input.details.map(([label, value]) => [
                    { text: label, style: 'label', alignment: 'right' },
                    { text: value, alignment: 'right' },
                  ]),
                },
                layout: 'noBorders',
              },
            ],
          },
        ],
        margin: [0, 0, 0, 18],
      },
      {
        table: { headerRows: 1, widths: ['*', 70, 85, 95], body: lineRows },
        layout: {
          hLineColor: () => LINE,
          vLineColor: () => LINE,
          hLineWidth: (i: number) => (i === 0 ? 0 : 0.7),
          vLineWidth: () => 0,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      },
      {
        columns: [
          { width: '*', text: '' },
          { width: 'auto', table: { widths: [150, 110], body: totalRows }, layout: 'noBorders', margin: [0, 10, 0, 0] },
        ],
      },
      ...input.notes.map((note) => ({ text: note, margin: [0, 10, 0, 0] as [number, number, number, number], color: GREY })),
      ...(profile.document_footer ? [{ text: profile.document_footer, margin: [0, 16, 0, 0] as [number, number, number, number] }] : []),
    ],
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 12, 40, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.7, lineColor: LINE }] },
        ...(payment ? [{ text: payment, fontSize: 8, color: GREY, margin: [0, 5, 0, 0] as [number, number, number, number] }] : []),
        {
          columns: [
            { text: NOT_A_TAX_INVOICE, fontSize: 8, bold: true, color: NAVY },
            { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: GREY, alignment: 'right', width: 70 },
          ],
          margin: [0, 4, 0, 0],
        },
      ],
    }),
  };
}

export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(definition);
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}

export const litresLine = (fuel: unknown, litres: unknown, price: unknown, amount: unknown, suffix = ''): DocumentLine => ({
  description: `${fuelName(fuel)}${suffix}`,
  litres: litres == null ? null : Number(litres),
  price: price == null ? null : Number(price),
  amount: Number(amount || 0),
});
