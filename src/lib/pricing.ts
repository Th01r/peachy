// Time-limited launch price. LAUNCH_PRICE_ENDS is an ISO datetime; past it,
// everything (display + the Polar product actually charged) flips to regular
// price automatically - no manual "go change the price" step to forget.

export interface PricingInfo {
  launchActive: boolean;
  price: number; // the price in effect right now
  launchPrice: number;
  regularPrice: number;
  perVideoPrice: number; // price / 5, always based on the *active* price
  endsAt: string;
}

export function getPricing(env: {
  LAUNCH_PRICE: string;
  REGULAR_PRICE: string;
  LAUNCH_PRICE_ENDS: string;
}): PricingInfo {
  const launchActive = Date.now() < new Date(env.LAUNCH_PRICE_ENDS).getTime();
  const launchPrice = Number(env.LAUNCH_PRICE);
  const regularPrice = Number(env.REGULAR_PRICE);
  const price = launchActive ? launchPrice : regularPrice;
  return {
    launchActive,
    price,
    launchPrice,
    regularPrice,
    perVideoPrice: Math.round((price / 5) * 100) / 100,
    endsAt: env.LAUNCH_PRICE_ENDS,
  };
}

export function polarProductId(env: {
  LAUNCH_PRICE_ENDS: string;
  POLAR_PRODUCT_ID_LAUNCH: string;
  POLAR_PRODUCT_ID_REGULAR: string;
}): string {
  const launchActive = Date.now() < new Date(env.LAUNCH_PRICE_ENDS).getTime();
  return launchActive ? env.POLAR_PRODUCT_ID_LAUNCH : env.POLAR_PRODUCT_ID_REGULAR;
}
