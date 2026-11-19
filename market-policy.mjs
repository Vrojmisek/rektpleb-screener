// One policy for market listings, search, chart access and alert validation.
const commodityTokens=new Set(['PAXG','XAUT','XAU','XAG','GOLD','SILVER','WTI','BRENT']);
export function isCryptoBinance(market){
 return market.status==='TRADING'&&market.contractType==='PERPETUAL'&&market.underlyingType==='COIN'&&market.quoteAsset!=='USDC'&&market.baseAsset!=='USDC'&&!commodityTokens.has(market.baseAsset);
}
export function isCryptoHyperliquid(market){
 return !market.isDelisted&&!market.name.includes(':')&&!market.name.endsWith('USDC')&&!commodityTokens.has(market.name);
}
