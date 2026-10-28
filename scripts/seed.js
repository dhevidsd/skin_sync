// Seeds catalog-service with realistic skincare products through its API (PUT is idempotent,
// so re-running resets names, prices and stock). Usage: node scripts/seed.js
const { URLS, api } = require('./lib/common');

const PRODUCTS = [
  ['p-001', 'Gentle Foaming Cleanser', 'PureDerm', 'cleanser', 1299, ['all'], 50, 'Low-pH daily cleanser for every skin type.'],
  ['p-002', 'Salicylic Acid Oil-Control Cleanser', 'ClearLab', 'cleanser', 1499, ['oily', 'combination'], 40, '2% BHA cleanser that clears pores.'],
  ['p-003', 'Hydrating Cream Cleanser', 'Dewly', 'cleanser', 1399, ['dry', 'sensitive'], 35, 'Non-foaming cleanser with glycerin and ceramides.'],
  ['p-004', 'Niacinamide 10% + Zinc Serum', 'ClearLab', 'serum', 1899, ['oily', 'combination'], 30, 'Reduces shine and the look of pores.'],
  ['p-005', 'Hyaluronic Acid Hydrating Serum', 'Dewly', 'serum', 2199, ['dry', 'normal'], 30, 'Multi-weight hyaluronic acid for deep hydration.'],
  ['p-006', 'Centella Calming Serum', 'Soothe & Co', 'serum', 2499, ['sensitive'], 25, 'Cica serum that calms redness.'],
  ['p-007', 'Vitamin C Brightening Serum', 'Lumina', 'serum', 2899, ['normal', 'combination'], 20, '15% vitamin C for an even tone.'],
  ['p-008', 'Oil-Free Gel Moisturizer', 'ClearLab', 'moisturizer', 1699, ['oily'], 40, 'Lightweight gel hydration without grease.'],
  ['p-009', 'Ceramide Barrier Repair Cream', 'Dewly', 'moisturizer', 2299, ['dry', 'sensitive'], 30, 'Rich cream that restores the skin barrier.'],
  ['p-010', 'Balancing Daily Moisturizer', 'PureDerm', 'moisturizer', 1899, ['combination', 'normal'], 30, 'Hydrates dry areas without making the T-zone oily.'],
  ['p-011', 'Mineral Sunscreen SPF 50', 'Soothe & Co', 'sunscreen', 2099, ['sensitive', 'dry'], 25, 'Zinc oxide sunscreen, fragrance free.'],
  ['p-012', 'Matte Finish Sunscreen SPF 50', 'Lumina', 'sunscreen', 1999, ['oily', 'combination'], 25, 'Oil-absorbing sunscreen with a matte finish.'],
  ['p-013', 'Kaolin Clay Purifying Mask', 'ClearLab', 'mask', 1599, ['oily'], 15, 'Weekly clay mask that absorbs excess oil.'],
  ['p-014', 'Fragrance-Free Soothing Toner', 'Soothe & Co', 'toner', 1499, ['sensitive', 'normal'], 20, 'Alcohol-free toner with panthenol.'],
  ['p-015', 'Overnight Repair Sleeping Mask', 'Dewly', 'mask', 2599, ['dry'], 0, 'Sold out: shows that out-of-stock items are not recommended (BR3).'],
  ['p-016', 'Broad Spectrum Daily SPF 30', 'PureDerm', 'sunscreen', 1799, ['all'], 60, 'Everyday sunscreen for all skin types.'],
];

async function main() {
  for (const [id, name, brand, category, priceCents, skinTypes, stock, description] of PRODUCTS) {
    const res = await api('PUT', `${URLS.catalog}/api/v1/products/${id}`, {
      body: { name, brand, category, description, priceCents, skinTypes, stock },
    });
    if (res.status !== 200 && res.status !== 201) throw new Error(`${id}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    console.log(`${res.status === 201 ? 'created' : 'updated'}  ${id}  ${name.padEnd(38)} stock ${stock}  [${skinTypes.join(', ')}]`);
  }
  console.log(`\nSeeded ${PRODUCTS.length} products into ${URLS.catalog}`);
}

main().catch((err) => {
  console.error(`Seed failed: ${err.message}. Is catalog-service running?`);
  process.exit(1);
});
