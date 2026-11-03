/**
 * Unit tests — bill check rules.
 *
 *  ✓ Bill numbers and vendor names compare without punctuation or "Pvt Ltd"
 *  ✓ Blocked credit under 17(5) is caught by HSN/SAC or wording, one flag per kind
 *  ✓ Ordinary purchases, hotel stays and bills with no GST are not flagged
 */
import { blockedItc, normaliseBillNumber, normaliseName } from './bill-checks';

describe('normalising', () => {
  it('compares numbers and names the way people write them', () => {
    expect(normaliseBillNumber('INV/2026-27/001')).toBe(normaliseBillNumber('inv 2026 27 001'));
    expect(normaliseBillNumber(' - ')).toBeNull();
    expect(normaliseName('Sigma Supplies Pvt. Ltd.')).toBe(normaliseName('SIGMA SUPPLIES PRIVATE LIMITED'));
    expect(normaliseName('M/s Rao & Co')).toBe(normaliseName('Rao'));
  });
});

describe('blockedItc', () => {
  const gst = 18000;
  it('flags supplies whose credit is blocked', () => {
    const codes = (lines: Array<{ description?: string; hsnSac?: string }>, vendorName?: string) =>
      blockedItc({ vendorName, lines, gstPaise: gst }).map((c) => c.message.match(/looks like ([^(]+) \(/)?.[1].trim());

    expect(codes([{ description: 'Hyundai Creta SX', hsnSac: '8703' }])).toEqual(['a motor vehicle']);
    expect(codes([{ description: 'Team lunch', hsnSac: '996331' }])).toEqual(['food, drink or catering']);
    expect(codes([{ description: 'Order #8812' }], 'Swiggy Limited')).toEqual(['food, drink or catering']);
    expect(codes([{ description: 'Annual gym membership' }])).toEqual(['a club or fitness membership']);
    expect(codes([{ description: 'Group health insurance premium' }])).toEqual(['life or health insurance']);
    expect(codes([{ description: 'Diwali gift hampers for clients' }])).toEqual(['gifts or free samples']);
    expect(codes([{ description: 'Civil work for new office floor', hsnSac: '995411' }])).toEqual(['construction work']);
    expect(codes([{ description: 'Lunch', hsnSac: '996331' }, { description: 'Car hire for the week' }])).toEqual([
      'food, drink or catering',
      'renting or leasing a car',
    ]);
  });

  it('says why, and what to do instead', () => {
    const [flag] = blockedItc({ lines: [{ description: 'Hyundai Creta', hsnSac: '8703 23' }], gstPaise: gst });
    expect(flag).toMatchObject({ code: 'blocked_itc', severity: 'medium' });
    expect(flag.message).toBe(
      'This looks like a motor vehicle (HSN/SAC 8703 23). GST on cars and two-wheelers is blocked unless you deal in them, run a transport service or a driving school (17(5)(a)). If so, book the GST into the expense rather than as input credit.',
    );
  });

  it('leaves ordinary purchases alone', () => {
    expect(blockedItc({ lines: [{ description: 'A4 paper, 50 reams', hsnSac: '4802' }], gstPaise: gst })).toEqual([]);
    // A hotel stay on business is claimable; only food and drink service (99633) is blocked.
    expect(blockedItc({ lines: [{ description: 'Room charges, 2 nights', hsnSac: '996311' }], gstPaise: gst })).toEqual([]);
    expect(blockedItc({ lines: [{ description: 'Team lunch', hsnSac: '996331' }], gstPaise: 0 })).toEqual([]);
    // The vendor's name decides only for a one-line bill.
    expect(blockedItc({ vendorName: 'Zomato', lines: [{ description: 'Ads, Sept' }, { description: 'Ads, Oct' }], gstPaise: gst })).toEqual([]);
  });
});
