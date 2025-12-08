// frontend/src/components/FreshTracker.jsx
// Fresh Tracker встроенный в React panel
import React, { useState, useEffect, useRef } from 'react';

export default function FreshTracker({ 
  onCopyAddress,
  mint,
  setMint
}) {
  const [trades, setTrades] = useState([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('all'); // all | smart | profitable
  const [minWinRate, setMinWinRate] = useState(60);
  const [minTrades, setMinTrades] = useState(50);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // WebSocket connection
  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const connectWebSocket = () => {
    const WS_URL = 'ws://localhost:4000/fresh-tracker';

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('✅ Fresh Tracker connected');
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'trades_snapshot') {
            setTrades(data.trades || []);
          } else if (data.type === 'new_trade') {
            setTrades(prev => [data.trade, ...prev].slice(0, 100));
          } else if (data.type === 'wallet_analysis') {
            console.log('Wallet analysis:', data);
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ Fresh Tracker WS error:', error);
        setConnected(false);
      };

      ws.onclose = () => {
        console.log('⚠️ Fresh Tracker disconnected, reconnecting...');
        setConnected(false);
        
        // Reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 5000);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Failed to connect to Fresh Tracker:', e);
      setConnected(false);
    }
  };

  // Filter trades
  const filteredTrades = trades.filter(trade => {
    if (filter === 'smart') {
      return (trade.walletWinRate || 0) >= minWinRate && 
             (trade.walletTotalTrades || 0) >= minTrades;
    }
    if (filter === 'profitable') {
      return (trade.walletProfit || 0) > 0;
    }
    return true;
  });

  const handleCopyToken = (trade) => {
    const address = trade.tokenMint;
    if (address && address !== 'unknown') {
      navigator.clipboard.writeText(address);
      if (setMint) {
        setMint(address);
      }
      if (onCopyAddress) {
        onCopyAddress(address);
      }
      console.log('📋 Copied:', address);
    }
  };

  const handleCopyWallet = (trade) => {
    const address = trade.walletAddress;
    if (address && address !== 'unknown') {
      navigator.clipboard.writeText(address);
      console.log('📋 Copied wallet:', address);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleTimeString();
  };

  const formatAmount = (amount) => {
    if (!amount) return '0';
    return Number(amount).toFixed(3);
  };

  const formatPercent = (value) => {
    if (!value) return '0%';
    return `${Number(value).toFixed(1)}%`;
  };

  return (
    <div className="fresh-tracker">
      <div className="fresh-header">
        <h3>
          🔴 Fresh Tracker
          <span className={`status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
        </h3>

        <div className="fresh-filters">
          <select 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Trades</option>
            <option value="smart">Smart Wallets</option>
            <option value="profitable">Profitable Only</option>
          </select>

          {filter === 'smart' && (
            <>
              <input
                type="number"
                value={minWinRate}
                onChange={(e) => setMinWinRate(Number(e.target.value))}
                placeholder="Min Win Rate %"
                className="filter-input"
              />
              <input
                type="number"
                value={minTrades}
                onChange={(e) => setMinTrades(Number(e.target.value))}
                placeholder="Min Trades"
                className="filter-input"
              />
            </>
          )}
        </div>
      </div>

      <div className="fresh-stats">
        <span>Total: {trades.length}</span>
        <span>Filtered: {filteredTrades.length}</span>
      </div>

      <div className="fresh-trades">
        {filteredTrades.length === 0 && (
          <div className="fresh-empty">
            {connected ? 'Waiting for trades...' : 'Connecting...'}
          </div>
        )}

        {filteredTrades.map((trade, index) => (
          <div 
            key={`${trade.timestamp}-${index}`} 
            className={`fresh-trade ${trade.type}`}
          >
            <div className="trade-header">
              <span className="trade-type">
                {trade.type === 'buy' ? '🟢 BUY' : '🔴 SELL'}
              </span>
              <span className="trade-time">{formatTime(trade.timestamp)}</span>
            </div>

            <div className="trade-token" onClick={() => handleCopyToken(trade)}>
              <span className="token-symbol">
                {trade.tokenSymbol || 'Unknown'}
              </span>
              <span className="token-address">
                {trade.tokenMint?.slice(0, 4)}...{trade.tokenMint?.slice(-4)}
              </span>
            </div>

            <div className="trade-amount">
              <span className="amount">{formatAmount(trade.amount)} SOL</span>
              {trade.price && (
                <span className="price">${formatAmount(trade.price)}</span>
              )}
            </div>

            <div 
              className="trade-wallet"
              onClick={() => handleCopyWallet(trade)}
            >
              <span>👤 {trade.walletAddress?.slice(0, 6)}...{trade.walletAddress?.slice(-4)}</span>
            </div>

            {(trade.walletWinRate !== null || trade.walletTotalTrades !== null) && (
              <div className="trade-stats">
                {trade.walletWinRate !== null && (
                  <span className="win-rate">
                    Win: {formatPercent(trade.walletWinRate)}
                  </span>
                )}
                {trade.walletTotalTrades !== null && (
                  <span className="total-trades">
                    Trades: {trade.walletTotalTrades}
                  </span>
                )}
                {trade.walletProfit !== null && (
                  <span className={`profit ${trade.walletProfit >= 0 ? 'positive' : 'negative'}`}>
                    P&L: {formatAmount(trade.walletProfit)} SOL
                  </span>
                )}
              </div>
            )}

            {trade.marketCap && (
              <div className="trade-mcap">
                MC: ${(trade.marketCap / 1000).toFixed(1)}K
              </div>
            )}
          </div>
        ))}
      </div>

      <style jsx>{`
        .fresh-tracker {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #1a1a2e;
          border-radius: 8px;
          overflow: hidden;
        }

        .fresh-header {
          padding: 16px;
          background: linear-gradient(135deg, #b478ff 0%, #7c3aed 100%);
          border-bottom: 2px solid #c69fff;
        }

        .fresh-header h3 {
          margin: 0 0 12px 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 18px;
          color: white;
        }

        .status {
          font-size: 12px;
          padding: 4px 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.2);
        }

        .status.connected {
          background: rgba(34, 197, 94, 0.3);
          color: #86efac;
        }

        .status.disconnected {
          background: rgba(239, 68, 68, 0.3);
          color: #fca5a5;
        }

        .fresh-filters {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .filter-select,
        .filter-input {
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.1);
          color: white;
          font-size: 12px;
        }

        .filter-input {
          width: 100px;
        }

        .fresh-stats {
          padding: 8px 16px;
          display: flex;
          gap: 16px;
          font-size: 12px;
          color: #9ca3af;
          background: rgba(0, 0, 0, 0.2);
        }

        .fresh-trades {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .fresh-empty {
          padding: 40px 20px;
          text-align: center;
          color: #6b7280;
        }

        .fresh-trade {
          padding: 12px;
          margin-bottom: 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          border-left: 3px solid #6b7280;
          cursor: pointer;
          transition: all 0.2s;
        }

        .fresh-trade:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: translateX(2px);
        }

        .fresh-trade.buy {
          border-left-color: #22c55e;
        }

        .fresh-trade.sell {
          border-left-color: #ef4444;
        }

        .trade-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          font-size: 12px;
        }

        .trade-type {
          font-weight: bold;
        }

        .trade-time {
          color: #9ca3af;
        }

        .trade-token {
          margin-bottom: 8px;
          cursor: pointer;
        }

        .trade-token:hover {
          opacity: 0.8;
        }

        .token-symbol {
          font-size: 16px;
          font-weight: bold;
          color: #c69fff;
          margin-right: 8px;
        }

        .token-address {
          font-size: 11px;
          color: #9ca3af;
          font-family: monospace;
        }

        .trade-amount {
          display: flex;
          gap: 12px;
          margin-bottom: 8px;
          font-size: 14px;
        }

        .amount {
          color: white;
          font-weight: 600;
        }

        .price {
          color: #9ca3af;
        }

        .trade-wallet {
          font-size: 11px;
          color: #9ca3af;
          font-family: monospace;
          margin-bottom: 8px;
          cursor: pointer;
        }

        .trade-wallet:hover {
          color: #c69fff;
        }

        .trade-stats {
          display: flex;
          gap: 12px;
          font-size: 11px;
          margin-bottom: 4px;
        }

        .win-rate {
          color: #86efac;
        }

        .total-trades {
          color: #9ca3af;
        }

        .profit.positive {
          color: #86efac;
        }

        .profit.negative {
          color: #fca5a5;
        }

        .trade-mcap {
          font-size: 11px;
          color: #9ca3af;
        }

        /* Scrollbar */
        .fresh-trades::-webkit-scrollbar {
          width: 6px;
        }

        .fresh-trades::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }

        .fresh-trades::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }

        .fresh-trades::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}