// src/lib/scanner/instruments.ts
// Comprehensive instrument universe for the multi-strategy scanner.
// Covers Forex, Crypto, Commodities, US Stocks (large caps), and Indices.

export type AssetClass = "forex" | "crypto" | "commodity" | "stock" | "index";

export interface Instrument {
  symbol: string;       // Yahoo Finance ticker
  display: string;      // Human-readable name shown in UI
  assetClass: AssetClass;
  category?: string;
}

export const INSTRUMENTS: Instrument[] = [
  // ===== FOREX MAJORS =====
  { symbol: "EURUSD=X", display: "EUR/USD", assetClass: "forex", category: "Major" },
  { symbol: "GBPUSD=X", display: "GBP/USD", assetClass: "forex", category: "Major" },
  { symbol: "USDJPY=X", display: "USD/JPY", assetClass: "forex", category: "Major" },
  { symbol: "USDCHF=X", display: "USD/CHF", assetClass: "forex", category: "Major" },
  { symbol: "AUDUSD=X", display: "AUD/USD", assetClass: "forex", category: "Major" },
  { symbol: "USDCAD=X", display: "USD/CAD", assetClass: "forex", category: "Major" },
  { symbol: "NZDUSD=X", display: "NZD/USD", assetClass: "forex", category: "Major" },
  // ===== FOREX CROSSES =====
  { symbol: "EURGBP=X", display: "EUR/GBP", assetClass: "forex", category: "Cross" },
  { symbol: "EURJPY=X", display: "EUR/JPY", assetClass: "forex", category: "Cross" },
  { symbol: "GBPJPY=X", display: "GBP/JPY", assetClass: "forex", category: "Cross" },
  { symbol: "GBPCHF=X", display: "GBP/CHF", assetClass: "forex", category: "Cross" },
  { symbol: "AUDJPY=X", display: "AUD/JPY", assetClass: "forex", category: "Cross" },
  { symbol: "EURAUD=X", display: "EUR/AUD", assetClass: "forex", category: "Cross" },
  { symbol: "EURCAD=X", display: "EUR/CAD", assetClass: "forex", category: "Cross" },
  { symbol: "GBPCAD=X", display: "GBP/CAD", assetClass: "forex", category: "Cross" },
  { symbol: "CADJPY=X", display: "CAD/JPY", assetClass: "forex", category: "Cross" },
  { symbol: "CHFJPY=X", display: "CHF/JPY", assetClass: "forex", category: "Cross" },
  { symbol: "NZDJPY=X", display: "NZD/JPY", assetClass: "forex", category: "Cross" },
  // ===== COMMODITIES =====
  { symbol: "GC=F", display: "Gold (XAU)", assetClass: "commodity", category: "Metals" },
  { symbol: "SI=F", display: "Silver (XAG)", assetClass: "commodity", category: "Metals" },
  { symbol: "CL=F", display: "Crude Oil WTI", assetClass: "commodity", category: "Energy" },
  { symbol: "BZ=F", display: "Brent Oil", assetClass: "commodity", category: "Energy" },
  { symbol: "NG=F", display: "Natural Gas", assetClass: "commodity", category: "Energy" },
  { symbol: "HG=F", display: "Copper", assetClass: "commodity", category: "Metals" },
  { symbol: "PL=F", display: "Platinum", assetClass: "commodity", category: "Metals" },
  // ===== CRYPTO =====
  { symbol: "BTC-USD", display: "Bitcoin", assetClass: "crypto", category: "Major" },
  { symbol: "ETH-USD", display: "Ethereum", assetClass: "crypto", category: "Major" },
  { symbol: "BNB-USD", display: "BNB", assetClass: "crypto", category: "Major" },
  { symbol: "SOL-USD", display: "Solana", assetClass: "crypto", category: "Major" },
  { symbol: "XRP-USD", display: "Ripple", assetClass: "crypto", category: "Major" },
  { symbol: "ADA-USD", display: "Cardano", assetClass: "crypto", category: "Major" },
  { symbol: "DOGE-USD", display: "Dogecoin", assetClass: "crypto", category: "Meme" },
  { symbol: "AVAX-USD", display: "Avalanche", assetClass: "crypto", category: "Major" },
  { symbol: "LINK-USD", display: "Chainlink", assetClass: "crypto", category: "Major" },
  { symbol: "DOT-USD", display: "Polkadot", assetClass: "crypto", category: "Major" },
  { symbol: "MATIC-USD", display: "Polygon", assetClass: "crypto", category: "Major" },
  { symbol: "LTC-USD", display: "Litecoin", assetClass: "crypto", category: "Major" },
  // ===== INDICES =====
  { symbol: "^GSPC", display: "S&P 500", assetClass: "index", category: "US" },
  { symbol: "^NDX", display: "Nasdaq 100", assetClass: "index", category: "US" },
  { symbol: "^DJI", display: "Dow Jones", assetClass: "index", category: "US" },
  { symbol: "^RUT", display: "Russell 2000", assetClass: "index", category: "US" },
  { symbol: "^VIX", display: "Volatility Index", assetClass: "index", category: "Vol" },
  // ===== US STOCKS =====
  { symbol: "AAPL", display: "Apple", assetClass: "stock", category: "Tech" },
  { symbol: "MSFT", display: "Microsoft", assetClass: "stock", category: "Tech" },
  { symbol: "NVDA", display: "NVIDIA", assetClass: "stock", category: "Tech" },
  { symbol: "AMZN", display: "Amazon", assetClass: "stock", category: "Consumer" },
  { symbol: "META", display: "Meta Platforms", assetClass: "stock", category: "Tech" },
  { symbol: "GOOGL", display: "Alphabet", assetClass: "stock", category: "Tech" },
  { symbol: "TSLA", display: "Tesla", assetClass: "stock", category: "Auto" },
  { symbol: "JPM", display: "JPMorgan", assetClass: "stock", category: "Finance" },
  { symbol: "BAC", display: "Bank of America", assetClass: "stock", category: "Finance" },
  { symbol: "GS", display: "Goldman Sachs", assetClass: "stock", category: "Finance" },
  { symbol: "WMT", display: "Walmart", assetClass: "stock", category: "Retail" },
  { symbol: "COST", display: "Costco", assetClass: "stock", category: "Retail" },
  { symbol: "HD", display: "Home Depot", assetClass: "stock", category: "Retail" },
  { symbol: "DIS", display: "Disney", assetClass: "stock", category: "Media" },
  { symbol: "NFLX", display: "Netflix", assetClass: "stock", category: "Media" },
  { symbol: "SPOT", display: "Spotify", assetClass: "stock", category: "Media" },
  { symbol: "AMD", display: "AMD", assetClass: "stock", category: "Tech" },
  { symbol: "INTC", display: "Intel", assetClass: "stock", category: "Tech" },
  { symbol: "QCOM", display: "Qualcomm", assetClass: "stock", category: "Tech" },
  { symbol: "AVGO", display: "Broadcom", assetClass: "stock", category: "Tech" },
  { symbol: "MU", display: "Micron", assetClass: "stock", category: "Tech" },
  { symbol: "PYPL", display: "PayPal", assetClass: "stock", category: "Finance" },
  { symbol: "SQ", display: "Block", assetClass: "stock", category: "Finance" },
  { symbol: "COIN", display: "Coinbase", assetClass: "stock", category: "Crypto" },
  { symbol: "MSTR", display: "MicroStrategy", assetClass: "stock", category: "Crypto" },
  { symbol: "PLTR", display: "Palantir", assetClass: "stock", category: "Tech" },
  { symbol: "SNOW", display: "Snowflake", assetClass: "stock", category: "Tech" },
  { symbol: "CRM", display: "Salesforce", assetClass: "stock", category: "Tech" },
  { symbol: "ORCL", display: "Oracle", assetClass: "stock", category: "Tech" },
  { symbol: "ADBE", display: "Adobe", assetClass: "stock", category: "Tech" },
  { symbol: "XOM", display: "ExxonMobil", assetClass: "stock", category: "Energy" },
  { symbol: "CVX", display: "Chevron", assetClass: "stock", category: "Energy" },
  { symbol: "BA", display: "Boeing", assetClass: "stock", category: "Industrial" },
  { symbol: "CAT", display: "Caterpillar", assetClass: "stock", category: "Industrial" },
  { symbol: "GE", display: "GE", assetClass: "stock", category: "Industrial" },
  { symbol: "F", display: "Ford", assetClass: "stock", category: "Auto" },
  { symbol: "GM", display: "General Motors", assetClass: "stock", category: "Auto" },
  { symbol: "NKE", display: "Nike", assetClass: "stock", category: "Consumer" },
  { symbol: "SBUX", display: "Starbucks", assetClass: "stock", category: "Consumer" },
  { symbol: "MCD", display: "McDonald's", assetClass: "stock", category: "Consumer" },
  { symbol: "KO", display: "Coca-Cola", assetClass: "stock", category: "Consumer" },
  { symbol: "PEP", display: "PepsiCo", assetClass: "stock", category: "Consumer" },
  { symbol: "PG", display: "Procter & Gamble", assetClass: "stock", category: "Consumer" },
  { symbol: "JNJ", display: "Johnson & Johnson", assetClass: "stock", category: "Health" },
  { symbol: "PFE", display: "Pfizer", assetClass: "stock", category: "Health" },
  { symbol: "MRK", display: "Merck", assetClass: "stock", category: "Health" },
  { symbol: "ABBV", display: "AbbVie", assetClass: "stock", category: "Health" },
  { symbol: "UNH", display: "UnitedHealth", assetClass: "stock", category: "Health" },
  { symbol: "T", display: "AT&T", assetClass: "stock", category: "Telecom" },
  { symbol: "VZ", display: "Verizon", assetClass: "stock", category: "Telecom" },
  { symbol: "SHOP", display: "Shopify", assetClass: "stock", category: "Tech" },
  { symbol: "UBER", display: "Uber", assetClass: "stock", category: "Tech" },
  { symbol: "ABNB", display: "Airbnb", assetClass: "stock", category: "Tech" },
  { symbol: "ZM", display: "Zoom", assetClass: "stock", category: "Tech" },
  { symbol: "DOCU", display: "DocuSign", assetClass: "stock", category: "Tech" },
  { symbol: "ROKU", display: "Roku", assetClass: "stock", category: "Media" },
  { symbol: "PINS", display: "Pinterest", assetClass: "stock", category: "Media" },
  { symbol: "SNAP", display: "Snap", assetClass: "stock", category: "Media" },
  { symbol: "MTCH", display: "Match", assetClass: "stock", category: "Media" },
  { symbol: "EBAY", display: "eBay", assetClass: "stock", category: "Consumer" },
  { symbol: "ETSY", display: "Etsy", assetClass: "stock", category: "Consumer" },
  { symbol: "BIDU", display: "Baidu", assetClass: "stock", category: "Tech" },
  { symbol: "JD", display: "JD.com", assetClass: "stock", category: "Tech" },
  { symbol: "BABA", display: "Alibaba", assetClass: "stock", category: "Tech" },
  { symbol: "TSM", display: "TSMC", assetClass: "stock", category: "Tech" },
  { symbol: "ASML", display: "ASML", assetClass: "stock", category: "Tech" },
  { symbol: "TM", display: "Toyota", assetClass: "stock", category: "Auto" },
  { symbol: "HMC", display: "Honda", assetClass: "stock", category: "Auto" },
  { symbol: "SNE", display: "Sony", assetClass: "stock", category: "Tech" },
  // ===== USER CSV-PROVIDED INSTRUMENTS (15y history available) =====
  { symbol: "XAUUSD=X", display: "XAU/USD (Gold)", assetClass: "commodity", category: "Metals" },
  { symbol: "US30=F", display: "US30 / Dow Jones", assetClass: "index", category: "US" },
  { symbol: "US500=F", display: "US500 / S&P 500", assetClass: "index", category: "US" },
  { symbol: "USTEC=F", display: "USTEC / Nasdaq 100", assetClass: "index", category: "US" },
  { symbol: "JP225=F", display: "JP225 / Nikkei 225", assetClass: "index", category: "Asia" },
  { symbol: "CA60=F", display: "CA60 / TSX 60", assetClass: "index", category: "Canada" },
];

export const TIMEFRAMES = ["1h", "2h", "4h", "1d", "1w"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const YF_INTERVAL: Record<Timeframe, "1h" | "2h" | "1d" | "1wk"> = {
  "1h": "1h",
  "2h": "2h",
  "4h": "1h",
  "1d": "1d",
  "1w": "1wk",
};

export const LOOKBACK_BARS: Record<Timeframe, number> = {
  "1h": 100000,  // full CSV history (no artificial cap)
  "2h": 100000,
  "4h": 100000,
  "1d": 100000,
  "1w": 100000,
};

export function getInstrumentsByClass(cls: AssetClass): Instrument[] {
  return INSTRUMENTS.filter((i) => i.assetClass === cls);
}

export function findInstrument(symbol: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.symbol === symbol);
}

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  forex: "Forex",
  crypto: "Crypto",
  commodity: "Commodities",
  stock: "Stocks",
  index: "Indices",
};
