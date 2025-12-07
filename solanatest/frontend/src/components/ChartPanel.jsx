import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  ColorType,
} from "lightweight-charts";

export default function ChartPanel({ mint }) {
  const chartContainer = useRef(null);
  const chartRef = useRef(null);
  const candleSeries = useRef(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chartContainer.current) return;

    // Initialize once
    if (!chartRef.current) {
      const chart = createChart(chartContainer.current, {
        width: chartContainer.current.clientWidth,
        height: 280,
        layout: {
          background: { color: "transparent" },
          textColor: "#f5f1ff",
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.05)" },
          horzLines: { color: "rgba(255,255,255,0.05)" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        timeScale: {
          borderColor: "rgba(255,255,255,0.15)",
        },
      });

      const series = chart.addCandlestickSeries({
        upColor: "#16a34a",
        downColor: "#dc2626",
        borderDownColor: "#dc2626",
        borderUpColor: "#16a34a",
        wickDownColor: "#dc2626",
        wickUpColor: "#16a34a",
      });

      chartRef.current = chart;
      candleSeries.current = series;
    }
  }, []);

  // Load price data each time mint changes
  useEffect(() => {
    if (!mint) return;
    loadHeliusPrice();
  }, [mint]);

  const loadHeliusPrice = async () => {
    setLoading(true);

    try {
      const url =
        `https://api-mainnet.helius-rpc.com/v0/addresses/${mint}/transactions?api-key=${import.meta.env.VITE_HELIUS_KEY}`;

      const res = await fetch(url);
      const data = await res.json();

      const candles = reconstructCandles(data);

      candleSeries.current.setData(candles);
    } catch (e) {
      console.error("Chart load error:", e);
    }

    setLoading(false);
  };

  // Convert parsed swaps → OHLC candles
  const reconstructCandles = (txs) => {
    const interval = 60; // 1 min candles
    const buckets = {};

    for (const tx of txs) {
      if (!tx.events?.swaps?.length) continue;
      const s = tx.events.swaps[0];

      const price = s.nativeInput
        ? Number(s.tokenOutputAmount) / Number(s.nativeInputAmount)
        : Number(s.nativeInputAmount) / Number(s.tokenOutputAmount);

      const ts = Math.floor(tx.timestamp / interval) * interval;

      if (!buckets[ts]) {
        buckets[ts] = { time: ts, open: price, high: price, low: price, close: price };
      } else {
        buckets[ts].high = Math.max(buckets[ts].high, price);
        buckets[ts].low = Math.min(buckets[ts].low, price);
        buckets[ts].close = price;
      }
    }

    return Object.values(buckets).sort((a, b) => a.time - b.time);
  };

  return (
    <div>
      <h2>Token chart (Axiom-style)</h2>
      <div
        ref={chartContainer}
        style={{
          width: "100%",
          height: 280,
          borderRadius: 14,
          marginBottom: 12,
        }}
      />

      {loading && <div style={{ opacity: 0.7 }}>Loading chart…</div>}
    </div>
  );
}
