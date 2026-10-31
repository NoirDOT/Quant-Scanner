// /home/z/my-project/src/lib/scanner/ict/killzones.ts
// ICT Killzones & Silver Bullet windows — expressed in EST (UTC-5)
// Times are from ICT's documented windows

export interface Killzone {
  name: string;
  startUTC: number;  // hours 0–23 UTC
  endUTC: number;
  description: string;
  // For Silver Bullet
  isSilverBullet?: boolean;
  bulletDirection?: "long" | "short";
}

// ICT killzones (in EST -> UTC-5 -> +5 for UTC)
// Asian: 8pm–midnight EST = 01:00–05:00 UTC
// London: 2am–5am EST = 07:00–10:00 UTC
// London KZ proper: 2am–5am London = 02:00–05:00 GMT = 07:00–10:00 UTC
// NY AM: 8:30am–11am EST = 13:30–16:00 UTC
// NY PM: 1:30pm–4pm EST = 18:30–21:00 UTC
// Silver Bullet long: 10am–11am EST = 15:00–16:00 UTC
// Silver Bullet short: 2pm–3pm EST = 19:00–20:00 UTC

export const KILLZONES: Killzone[] = [
  {
    name: "Asian Killzone",
    startUTC: 1,
    endUTC: 5,
    description: "Range accumulation, sweep setup window",
  },
  {
    name: "London Killzone",
    startUTC: 7,
    endUTC: 10,
    description: "Liquidity raid + institutional displacement",
  },
  {
    name: "NY AM Killzone",
    startUTC: 13,
    endUTC: 16,
    description: "US session open + AM Silver Bullet",
  },
  {
    name: "NY PM Killzone",
    startUTC: 18,
    endUTC: 21,
    description: "PM session, reversals targeting Asian liquidity",
  },
  {
    name: "Silver Bullet — Long",
    startUTC: 15,
    endUTC: 16,
    description: "Long-biased Silver Bullet window (10–11am EST)",
    isSilverBullet: true,
    bulletDirection: "long",
  },
  {
    name: "Silver Bullet — Short",
    startUTC: 19,
    endUTC: 20,
    description: "Short-biased Silver Bullet window (2–3pm EST)",
    isSilverBullet: true,
    bulletDirection: "short",
  },
];

export interface ActiveKillzone {
  name: string;
  description: string;
  isSilverBullet: boolean;
  bulletDirection?: "long" | "short";
  minutesRemaining: number;
}

export function activeKillzones(date = new Date()): ActiveKillzone[] {
  const utcHours = date.getUTCHours();
  const utcMin = date.getUTCMinutes();
  const utcTime = utcHours + utcMin / 60;
  const out: ActiveKillzone[] = [];
  for (const kz of KILLZONES) {
    if (utcTime >= kz.startUTC && utcTime < kz.endUTC) {
      out.push({
        name: kz.name,
        description: kz.description,
        isSilverBullet: !!kz.isSilverBullet,
        bulletDirection: kz.bulletDirection,
        minutesRemaining: Math.round((kz.endUTC - utcTime) * 60),
      });
    }
  }
  return out;
}

export function nextKillzone(date = new Date()): ActiveKillzone | null {
  const utcHours = date.getUTCHours();
  const utcMin = date.getUTCMinutes();
  const utcTime = utcHours + utcMin / 60;
  // Find next killzone by start time today; if none, wrap to tomorrow
  let candidate: Killzone | null = null;
  let minDiff = Infinity;
  for (const kz of KILLZONES) {
    if (kz.startUTC > utcTime) {
      if (kz.startUTC - utcTime < minDiff) {
        minDiff = kz.startUTC - utcTime;
        candidate = kz;
      }
    }
  }
  if (!candidate) {
    // next day, pick earliest killzone
    candidate = KILLZONES[0];
    minDiff = 24 - utcTime + candidate.startUTC;
  }
  return candidate
    ? {
        name: candidate.name,
        description: candidate.description,
        isSilverBullet: !!candidate.isSilverBullet,
        bulletDirection: candidate.bulletDirection,
        minutesRemaining: Math.round(minDiff * 60),
      }
    : null;
}
