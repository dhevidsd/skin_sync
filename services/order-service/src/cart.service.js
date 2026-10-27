// Cart business logic.
const config = require('./config');
const repo = require('./repository');
const rules = require('./rules');
const { callService } = require('./http');
const { AppError } = require('./errors');

async function getCart(userId) {
  const items = await repo.getCartItems(userId);
  return { userId, items, totalQuantity: items.reduce((n, i) => n + i.quantity, 0) };
}

// Only the product id is stored; catalog-service stays the owner of product data.
async function assertProductExists(productId) {
  const res = await callService('catalog-service', config.catalogServiceUrl, `/api/v1/products/${encodeURIComponent(productId)}`, {
    timeoutMs: config.httpTimeoutMs,
  });
  if (res.status === 404) throw new AppError(422, 'UNKNOWN_PRODUCT', `Product ${productId} does not exist`, { productId });
  if (res.status !== 200) throw new AppError(502, 'BAD_GATEWAY', 'catalog-service returned an unexpected response', { status: res.status });
}

async function addItem(userId, productId, quantity) {
  const current = await repo.getCartQuantity(userId, productId);
  const total = rules.mergedQuantity(current, quantity); // BR4
  await assertProductExists(productId);
  await repo.saveCartItem(userId, productId, total);
  return getCart(userId);
}

async function updateItem(userId, productId, quantity) {
  rules.assertCartQuantity(quantity); // BR4
  if (!(await repo.updateCartItem(userId, productId, quantity))) {
    throw new AppError(404, 'CART_ITEM_NOT_FOUND', `Product ${productId} is not in the cart`, { userId, productId });
  }
  return getCart(userId);
}

async function removeItem(userId, productId) {
  if (!(await repo.deleteCartItem(userId, productId))) {
    throw new AppError(404, 'CART_ITEM_NOT_FOUND', `Product ${productId} is not in the cart`, { userId, productId });
  }
}

module.exports = { getCart, addItem, updateItem, removeItem };
