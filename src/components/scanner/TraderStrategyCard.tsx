"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ExternalLink, Youtube } from "lucide-react";

export interface TraderInfo {
  key: string;
  traderKey: string;
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

export function TraderStrategyCard({ trader }: { trader: TraderInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Youtube className="h-4 w-4" />
            {trader.name}
          </div>
          <Badge variant={trader.confidenceLevel === "corroborated" ? "default" : "outline"}>
            {trader.confidenceLevel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{trader.description}</p>
        <div className="flex flex-wrap gap-1">
          {trader.rules.requiredModules.map((m) => (
            <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
          ))}
        </div>
        <Accordion type="single" collapsible>
          <AccordionItem value="rules">
            <AccordionTrigger className="text-xs">Entry rules</AccordionTrigger>
            <AccordionContent>
              <ol className="list-decimal pl-4 space-y-1 text-xs">
                {trader.rules.entryRules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
              <div className="mt-3 space-y-1 text-xs">
                <div className="text-muted-foreground">
                  <strong>Killzone:</strong> {trader.rules.killzone}
                </div>
                <div className="text-muted-foreground">
                  <strong>Stop:</strong> {trader.rules.stopLossRule}
                </div>
                <div className="text-muted-foreground">
                  <strong>Target:</strong> {trader.rules.takeProfitRule}
                </div>
                <div className="text-muted-foreground">
                  <strong>Timeframes:</strong> HTF {trader.rules.htfTimeframes.join(", ")} · LTF {trader.rules.ltfTimeframe}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="sources">
            <AccordionTrigger className="text-xs">Sources</AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-1">
                {trader.sources.map((s, i) => (
                  <li key={i}>
                    <a
                      href={s}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {s.replace("https://www.youtube.com/results?search_query=", "YouTube: ").replace("https://www.", "")}
                    </a>
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
