"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Zap, Globe } from "lucide-react";
import { useEffect, useState } from "react";

interface KillzoneInfo {
  name: string;
  description: string;
  isSilverBullet: boolean;
  bulletDirection?: "long" | "short";
  minutesRemaining: number;
}

interface KillzoneApiResponse {
  now: string;
  active: KillzoneInfo[];
  next: KillzoneInfo | null;
  all: any[];
}

export function KillzoneClock() {
  const [data, setData] = useState<KillzoneApiResponse | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    fetch("/api/scanner/killzones")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
    const i = setInterval(() => fetch("/api/scanner/killzones").then((r) => r.json()).then(setData), 60_000);
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(i); clearInterval(t); };
  }, []);

  const utcHours = now.getUTCHours().toString().padStart(2, "0");
  const utcMin = now.getUTCMinutes().toString().padStart(2, "0");
  const utcSec = now.getUTCSeconds().toString().padStart(2, "0");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          ICT Killzones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl tabular-nums">{utcHours}:{utcMin}:{utcSec}</span>
          <span className="text-xs text-muted-foreground">UTC</span>
        </div>
        {data?.active && data.active.length > 0 ? (
          <div className="space-y-2">
            {data.active.map((kz, i) => (
              <div
                key={i}
                className={`flex items-start justify-between rounded-md border p-2 ${
                  kz.isSilverBullet ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : ""
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    {kz.isSilverBullet ? (
                      <Zap className="h-3 w-3 text-amber-500" />
                    ) : (
                      <Globe className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">{kz.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{kz.description}</p>
                </div>
                <Badge variant="outline" className="tabular-nums">
                  {kz.minutesRemaining}m left
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {data?.next ? (
              <>
                <div className="text-xs uppercase tracking-wide">Next killzone</div>
                <div className="mt-1 font-medium">{data.next.name}</div>
                <div className="text-xs">in ~{data.next.minutesRemaining} min</div>
              </>
            ) : (
              "Loading…"
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
