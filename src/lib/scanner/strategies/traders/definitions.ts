// /home/z/my-project/src/lib/scanner/strategies/traders/definitions.ts
// Strategy definitions for 10 trader-specific scanners
// Based on YouTube research + ICT-niche educated guesses (where noted)

export interface TraderStrategyDef {
  key: string;          // tttrades, jaefx, ...
  name: string;
  description: string;
  confidenceLevel: "corroborated" | "inferred";
  sources: string[];
  rules: {
    htfTimeframes: string[];
    ltfTimeframe: string;
    requiredModules: string[];
    entryRules: string[];
    killzone: string;
    stopLossRule: string;
    takeProfitRule: string;
  };
}

export const TRADER_STRATEGIES: TraderStrategyDef[] = [
  {
    key: "tttrades",
    name: "TTtrades",
    description: "ICT trader teaching the MMXM ('Twitter Model') / Market Maker Sell-Buy Model, the 'Box Setup' (breaker-block) entry, and an A+ Entry Checklist. Combines HTF bias, Power-of-3 (AMD) manipulation logic, internal/external liquidity, and FVG/OB entries inside killzones.",
    confidenceLevel: "corroborated",
    sources: [
      "https://www.youtube.com/results?search_query=TTtrades+ICT+strategy+model+entry",
      "https://www.youtube.com/results?search_query=TTtrades+box+setup+MMXM+model",
    ],
    rules: {
      htfTimeframes: ["4h", "1h"],
      ltfTimeframe: "5m",
      requiredModules: ["HTF Bias / MMXM", "Power of 3 (AMD)", "Liquidity (Internal+External)", "BOS/MSS", "FVG", "Order Block", "Breaker/Box"],
      entryRules: [
        "Establish 4h/1h bias using draw on liquidity (which external pool is the target)",
        "Wait for manipulation leg: sweep of opposing liquidity (Power-of-3 manipulation) OR displacement BOS",
        "Confirm A+ checklist: HTF POI aligns with bias, displacement candle leaves a valid FVG/OB",
        "Price retraces into the LTF (5m) FVG or order block inside the POI",
        "Enter on LTF confirmation (engulfing/choch) within the killzone",
      ],
      killzone: "London or NY AM (model-agnostic; trades the killzone matching the sweep)",
      stopLossRule: "Below the LTF order block / beyond the sweep wick (invalidation of the FVG)",
      takeProfitRule: "Opposing external liquidity pool (draw on liquidity); partials at 1R, runner to opposite liquidity",
    },
  },
  {
    key: "jaefx",
    name: "Jaefx",
    description: "ICT trader focused on building complete entry models from liquidity + structure. Teaches a clean 2-model framework: HTF bias → liquidity sweep → Market Structure Shift with displacement → FVG entry. Heavy emphasis on the Asian Range and liquidity inducement.",
    confidenceLevel: "corroborated",
    sources: [
      "https://www.youtube.com/results?search_query=Jaefx+ICT+strategy+model",
      "https://www.youtube.com/results?search_query=Jaefx+entry+model+liquidity+inducement",
    ],
    rules: {
      htfTimeframes: ["4h", "1h"],
      ltfTimeframe: "1m",
      requiredModules: ["HTF Bias", "Asian Range", "Liquidity Sweep", "MSS (displacement)", "FVG", "Liquidity Inducement"],
      entryRules: [
        "Mark HTF bias from 4h draw on liquidity",
        "Map the Asian session range high/low as the liquidity target to be swept",
        "Wait for a sweep of Asian range liquidity (or session liquidity) with displacement",
        "Confirm MSS on the 1m/5m (break of last short-term high/low with momentum)",
        "Enter on retracement into the FVG left by the displacement leg",
      ],
      killzone: "NY AM / London (entries taken after the sweep, typically post-London-open or NY AM)",
      stopLossRule: "Beyond the sweep candle extreme / invalidation of the MSS leg",
      takeProfitRule: "Opposing session liquidity pool; minimum 2R, scale out at internal liquidity",
    },
  },
  {
    key: "movingaverage",
    name: "MovingAverage",
    description: "ICT/SMC trader who adds moving-average confluence (20 EMA) on top of standard ICT liquidity + FVG setups. The MA acts as a bias filter and entry magnet, not a crossover system.",
    confidenceLevel: "inferred",
    sources: ["https://www.youtube.com/results?search_query=MovingAverage+forex+ICT+trader+strategy"],
    rules: {
      htfTimeframes: ["1d", "4h"],
      ltfTimeframe: "15m",
      requiredModules: ["HTF Bias", "Moving Average (20 EMA) confluence", "Liquidity", "FVG", "BOS"],
      entryRules: [
        "Determine HTF bias from daily/4h structure (HH/HL) and price location vs 20 EMA",
        "Only trade in direction of HTF MA slope / MA acting as dynamic support/resistance",
        "Wait for liquidity sweep or BOS aligned with MA direction",
        "Enter on retracement into a 15m FVG that overlaps the 20 EMA (confluence)",
        "Reject setups where price is extended far from the MA",
      ],
      killzone: "London + NY AM (kills the Asia session)",
      stopLossRule: "Beyond the FVG / below the 20 EMA and structure swing on LTF",
      takeProfitRule: "Next HTF liquidity pool; trail with MA on LTF, target 2R+",
    },
  },
  {
    key: "jadecapfx",
    name: "Jadecapfx",
    description: "Defines a precise 3-Step A+ ICT Strategy: (1) Liquidity Sweep, (2) Market Structure Shift with displacement, (3) Order Block / FVG entry with Fibonacci confluence.",
    confidenceLevel: "corroborated",
    sources: [
      "https://www.instagram.com/p/DZVh0z1ABWA/",
      "https://www.youtube.com/results?search_query=Jadecapfx+strategy+liquidity+order+block",
    ],
    rules: {
      htfTimeframes: ["4h", "1h"],
      ltfTimeframe: "5m",
      requiredModules: ["Liquidity Sweep", "MSS (displacement)", "Order Block", "FVG", "Fibonacci (OTE 62-79%)"],
      entryRules: [
        "Step 1 — Liquidity Sweep: price takes out an obvious prior high/low",
        "Step 2 — MSS: immediate displacement candle breaks the opposing short-term structure, leaves a FVG",
        "Step 3 — Entry: retracement into the order block / FVG created by the displacement leg",
        "Fibonacci confluence: enter in the 62%–79% OTE zone of the displacement leg",
        "Bias must agree with HTF (4h) draw on liquidity",
      ],
      killzone: "London open or NY AM (the sweep+MSS must occur inside a killzone)",
      stopLossRule: "Beyond the sweep extreme / below the order block invalidation",
      takeProfitRule: "Unmitigated opposing liquidity; scale at internal liquidity, target external pool (min 2R)",
    },
  },
  {
    key: "forexcartel",
    name: "Forexcartel / RealWeirdGene",
    description: "The 'Weird Gene Model': sweeps Internal Range Liquidity (IRL) then targets External Range Liquidity (ERL). Entry is on the FVG left behind after the sweep + MSS — i.e., trade the reaction that runs IRL→ERL.",
    confidenceLevel: "inferred",
    sources: [
      "https://www.youtube.com/results?search_query=forexcartel+RealWeirdGene+ICT+strategy+model",
      "https://www.youtube.com/results?search_query=Weird+Gene+model+ICT+liquidity+sweep+FVG+entry",
    ],
    rules: {
      htfTimeframes: ["1h", "15m"],
      ltfTimeframe: "1m",
      requiredModules: ["IRL (Internal Range Liquidity)", "ERL (External Range Liquidity)", "Liquidity Sweep", "MSS", "FVG"],
      entryRules: [
        "Identify an internal range and its internal liquidity (IRL) — e.g., session range high/low or equal highs/lows",
        "Wait for price to sweep the IRL (stop hunt of the internal pool)",
        "Confirm MSS: displacement break of internal structure leaving a FVG",
        "Enter on retracement into the FVG; directional target is the external liquidity (ERL) on the opposite side of the range",
        "Skip if sweep doesn't produce displacement / no FVG formed",
      ],
      killzone: "London or NY AM (the IRL sweep must occur inside an active killzone)",
      stopLossRule: "Beyond the sweep wick / FVG invalidation on the 1m",
      takeProfitRule: "External Range Liquidity (ERL) on the opposite side of the range; full target at ERL",
    },
  },
  {
    key: "daveteachesfx",
    name: "DaveTeachesfx",
    description: "ICT educator with a structured, beginner-friendly killzone framework. Builds entries around the Asian, London, and New York killzones plus the ICT Silver Bullet window, often combining killzones with pivot points for HTF bias and entry timing.",
    confidenceLevel: "corroborated",
    sources: ["https://www.youtube.com/results?search_query=DaveTeachesfx+ICT+strategy+model+killzone"],
    rules: {
      htfTimeframes: ["1d", "4h"],
      ltfTimeframe: "15m",
      requiredModules: ["Killzones (Asian/London/NY)", "Silver Bullet window", "HTF Bias (Pivots)", "Liquidity", "FVG"],
      entryRules: [
        "Set HTF bias using daily/4h structure and pivot levels",
        "Only take setups inside a designated killzone (London or NY AM preferred)",
        "Wait for the Silver Bullet window: sweep of liquidity then displacement",
        "Enter on retracement into a 15m FVG/OB created during the displacement",
        "Bias + killzone + sweep + FVG must all align (no entries outside killzones)",
      ],
      killzone: "NY AM Silver Bullet (~10:00–11:00 ET) and London Silver Bullet (~02:00–03:00 ET); Asia for sweeps",
      stopLossRule: "Beyond the Silver Bullet FVG / sweep invalidation on 15m",
      takeProfitRule: "Next pivot / opposing liquidity; target 2R or HTF pivot",
    },
  },
  {
    key: "wordsofrizdom",
    name: "Words of Rizdom",
    description: "ICT trader and host of the WOR Podcast. Trades a model-based ICT approach: HTF bias → liquidity sweep → MSS → FVG/OTE entry.",
    confidenceLevel: "inferred",
    sources: ["https://www.youtube.com/results?search_query=Words+of+Rizdom+ICT+strategy+model"],
    rules: {
      htfTimeframes: ["4h", "1h"],
      ltfTimeframe: "5m",
      requiredModules: ["HTF Bias", "Liquidity Sweep", "MSS", "FVG", "OTE (Optimal Trade Entry)"],
      entryRules: [
        "Define 4h/1h bias via draw on liquidity and market structure",
        "Wait for a liquidity sweep of a HTF-identifiable pool",
        "Confirm MSS on 5m with displacement and a FVG",
        "Enter in the OTE (62–79% Fib of the displacement leg) within the FVG",
        "Filter: only trade the killzone/session aligned with the HTF bias",
      ],
      killzone: "London or NY AM",
      stopLossRule: "Beyond the sweep / below the OTE invalidation on 5m",
      takeProfitRule: "Opposing HTF liquidity; scale at internal liquidity, runner to external pool",
    },
  },
  {
    key: "toritrades",
    name: "Tori Trades",
    description: "ICT trader who adds trendline confluence to standard ICT entry models. Uses trendlines to define bias/structure and timing, then layers the A+ ICT entry checklist (sweep + MSS + FVG) for execution.",
    confidenceLevel: "corroborated",
    sources: ["https://www.youtube.com/results?search_query=Tori+Trades+ICT+strategy+model+entry"],
    rules: {
      htfTimeframes: ["4h", "1h"],
      ltfTimeframe: "5m",
      requiredModules: ["Trendlines (structure)", "HTF Bias", "Liquidity Sweep", "MSS", "FVG", "A+ Entry Checklist"],
      entryRules: [
        "Draw HTF trendlines to define bias and the structural trend",
        "Wait for price to sweep liquidity at/through the trendline (trendline sweep = manipulation)",
        "Confirm MSS with displacement breaking the short-term trendline structure",
        "Enter on retracement into the FVG/OB left by displacement, validated against the trendline",
        "Run the A+ checklist: bias + sweep + MSS + FVG + trendline confluence",
      ],
      killzone: "NY AM (primary), London (secondary)",
      stopLossRule: "Beyond the sweep wick / trendline invalidation on LTF",
      takeProfitRule: "Opposing trendline / liquidity pool; partials at 1R, target next trendline liquidity",
    },
  },
  {
    key: "diontrades",
    name: "Dion Trades",
    description: "Time-based ICT models for index futures (NQ). Core systems: the '10AM Model' and '9:30 Opening Range' (FTS Model), plus the 'Skool' No-Daily-Bias entry model and OTE.",
    confidenceLevel: "corroborated",
    sources: ["https://www.youtube.com/results?search_query=Dion+Trades+ICT+strategy+model+entry"],
    rules: {
      htfTimeframes: ["1h", "15m"],
      ltfTimeframe: "1m",
      requiredModules: ["Time windows (9:30 / 10AM)", "Opening Range", "Liquidity Sweep", "MSS", "FVG", "OTE"],
      entryRules: [
        "Define the 9:30 opening range (first X min of the US session) or wait for the 10AM time window",
        "Wait for a sweep of the opening-range high/low liquidity inside the time window",
        "Confirm MSS with displacement leaving a FVG (No-Daily-Bias model: bias derived from the time-window reaction, not HTF)",
        "Enter on retracement into the FVG / OTE (62–79%) of the displacement leg",
        "Take only setups that complete within the 10AM model time window",
      ],
      killzone: "NY 9:30 Opening Range + 10AM Model window (time-defined, not standard ICT killzones)",
      stopLossRule: "Beyond the time-window sweep extreme / FVG invalidation on 1m",
      takeProfitRule: "Opposite opening-range liquidity; target measured move of the displacement",
    },
  },
  {
    key: "rcvisionaries",
    name: "RCVisionaries",
    description: "ICT trader using the 'Sweep Model' and 'Rev (Reversal) Model' framed as 'Bias vs Reaction.' Confirms HTF bias, waits for a liquidity sweep that produces a reaction (MSS), then enters the reversal on the FVG left by the reaction leg.",
    confidenceLevel: "corroborated",
    sources: ["https://www.youtube.com/results?search_query=RCVisionaries+ICT+strategy+model+entry"],
    rules: {
      htfTimeframes: ["4h", "1h"],
      ltfTimeframe: "5m",
      requiredModules: ["HTF Bias", "Liquidity Sweep", "Reaction / MSS", "FVG (Reversal)", "Sweep Model", "Rev Model"],
      entryRules: [
        "Establish 4h/1h bias ('Bias') — which liquidity pool price should seek",
        "Wait for a sweep of liquidity that produces an immediate 'Reaction' (displacement + MSS against the swept direction = reversal signal)",
        "Confirm the reaction leaves a valid FVG on 5m (Rev Model: reversal FVG)",
        "Enter on retracement into the reversal FVG in the direction of HTF bias",
        "Reject sweeps that produce no reaction (no MSS / no FVG) — these are runs, not reversals",
      ],
      killzone: "London or NY AM (sweep+reaction must print inside a killzone)",
      stopLossRule: "Beyond the reaction-leg FVG / sweep wick invalidation on 5m",
      takeProfitRule: "Opposing HTF liquidity pool (the bias target); scale at internal liquidity, runner to external pool",
    },
  },
];

export function getTraderStrategy(key: string): TraderStrategyDef | undefined {
  return TRADER_STRATEGIES.find((t) => t.key === key);
}
