// ProTradingPanel.jsx
// Professional meme coin trading panel with auto-execution
import React, { useState, useEffect, useRef } from 'react';

export default function ProTradingPanel({
  wallets,
  selectedWallets,
  setSelectedWallets,
  callBackend
}) {
  // Token state
  const [tokenCA, setTokenCA] = useState('');
  const [tokenData, setTokenData] = useState(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);

  // Trading state
  const [positions, setPositions] = useState([]); // Active positions
  const [autoTradingEnabled, setAutoTradingEnabled] = useState(false);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);

  // Configuration
  const [config, setConfig] = useState({
    // Entry settings
    entryAmount: 0.05, // SOL per wallet
    entryMode: 'fixed', // 'fixed', 'percentage'
    entryPercentage: 10, // % of wallet balance
    
    // Take Profit (multiple levels)
    tp1Percent: 25,
    tp1SellPercent: 30,
    tp2Percent: 50,
    tp2SellPercent: 50,
    tp3Percent: 100,
    tp3SellPercent: 100,
    tpEnabled: true,
    
    // Stop Loss
    slPercent: -15,
    slEnabled: true,
    
    // Trailing Stop
    trailingStopEnabled: false,
    trailingStopPercent: 10,
    trailingStopActivation: 20,
    
    // Auto-buy settings
    autoBuyEnabled: false,
    autoBuyMinWinRate: 85,
    autoBuyMaxWallets: 10,
    autoBuyWatchlist: [], // Fresh wallet addresses to follow
    
    // Execution
    slippage: 15,
    priorityFee: 0.001,
    maxRetries: 3,
    
    // Smart features
    antiRugEnabled: true,
    minLiquiditySOL: 10,
    maxMarketCapM: 5,
  });

  // Presets
  const PRESETS = {
    conservative: {
      entryAmount: 0.02,
      tp1Percent: 15,
      tp2Percent: 30,
      tp3Percent: 50,
      slPercent: -10,
      slippage: 10,
    },
    balanced: {
      entryAmount: 0.05,
      tp1Percent: 25,
      tp2Percent: 50,
      tp3Percent: 100,
      slPercent: -15,
      slippage: 15,
    },
    aggressive: {
      entryAmount: 0.1,
      tp1Percent: 50,
      tp2Percent: 100,
      tp3Percent: 200,
      slPercent: -20,
      slippage: 20,
    },
  };

  // Auto-config based on token
  const autoConfigureForToken = async (token) => {
    if (!token) return;
    
    const mcap = token.marketCap || 0;
    const liquidity = token.liquidity || 0;
    
    // Smart defaults based on market cap
    if (mcap < 100000) {
      // Micro cap - very risky
      setConfig(prev => ({
        ...prev,
        ...PRESETS.aggressive,
        slPercent: -25,
        antiRugEnabled: true,
      }));
    } else if (mcap < 1000000) {
      // Small cap - risky
      setConfig(prev => ({
        ...prev,
        ...PRESETS.balanced,
        antiRugEnabled: true,
      }));
    } else {
      // Larger cap - safer
      setConfig(prev => ({
        ...prev,
        ...PRESETS.conservative,
        antiRugEnabled: false,
      }));
    }
    
    console.log('✅ Auto-configured for market cap:', mcap);
  };

  // Load token data
  const loadToken = async (ca) => {
    if (!ca || ca.length < 32) return;
    
    setIsLoadingToken(true);
    
    try {
      // Fetch token data from backend
      const response = await fetch(`http://localhost:4000/api/token/info?mint=${ca}`);
      const data = await response.json();
      
      setTokenData(data);
      
      // Auto-configure
      await autoConfigureForToken(data);
      
      console.log('✅ Token loaded:', data);
    } catch (e) {
      console.error('Failed to load token:', e);
      setTokenData(null);
    } finally {
      setIsLoadingToken(false);
    }
  };

  // Load token when CA changes (with debounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tokenCA && tokenCA.length >= 32) {
        loadToken(tokenCA);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [tokenCA]);

  // Execute buy
  const executeBuy = async () => {
    if (!tokenCA) {
      alert('Enter token CA first');
      return;
    }
    
    if (selectedWallets.length === 0) {
      alert('Select wallets first');
      return;
    }

    try {
      console.log('🚀 Executing BUY...');
      
      const selectedWalletObjects = wallets.filter(w => 
        selectedWallets.includes(w.publicKey)
      );

      const result = await callBackend('/api/trade/buy-fast', {
        walletSecretKeysBase58: selectedWalletObjects.map(w => w.secretKey),
        mintAddress: tokenCA,
        amountSolPerWallet: config.entryAmount,
        priorityFeeLamports: Math.floor(config.priorityFee * 1e9),
        slippagePercent: config.slippage,
      });

      console.log('✅ Buy executed:', result);
      
      // Create position
      const newPosition = {
        id: Date.now(),
        tokenCA: tokenCA,
        tokenSymbol: tokenData?.symbol || 'TOKEN',
        entryPrice: tokenData?.price || 0,
        entryTime: Date.now(),
        wallets: selectedWalletObjects.length,
        invested: config.entryAmount * selectedWalletObjects.length,
        currentPrice: tokenData?.price || 0,
        pnlPercent: 0,
        pnlSOL: 0,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        slHit: false,
        highestPrice: tokenData?.price || 0,
      };
      
      setPositions(prev => [...prev, newPosition]);
      
      alert('✅ Buy executed! Position opened.');
    } catch (e) {
      console.error('❌ Buy failed:', e);
      alert('❌ Buy failed: ' + e.message);
    }
  };

  // Execute sell
  const executeSell = async (position, percent = 100, reason = 'manual') => {
    try {
      console.log(`🔴 Executing SELL ${percent}% (${reason})...`);
      
      const selectedWalletObjects = wallets.slice(0, position.wallets);

      const result = await callBackend('/api/trade/sell-fast', {
        walletSecretKeysBase58: selectedWalletObjects.map(w => w.secretKey),
        mintAddress: position.tokenCA,
        sellPercent: percent,
        priorityFeeLamports: Math.floor(config.priorityFee * 1e9),
        slippagePercent: config.slippage,
      });

      console.log('✅ Sell executed:', result);
      
      // If 100% sold, remove position
      if (percent === 100) {
        setPositions(prev => prev.filter(p => p.id !== position.id));
      }
      
      alert(`✅ Sold ${percent}% (${reason})`);
    } catch (e) {
      console.error('❌ Sell failed:', e);
      alert('❌ Sell failed: ' + e.message);
    }
  };

  // Monitor positions (TP/SL)
  useEffect(() => {
    if (!monitoringEnabled || positions.length === 0) return;
    
    const interval = setInterval(async () => {
      for (const position of positions) {
        try {
          // Fetch current price
          const response = await fetch(
            `http://localhost:4000/api/token/price?mint=${position.tokenCA}`
          );
          const data = await response.json();
          const currentPrice = data.price;
          
          // Calculate PnL
          const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
          
          // Update highest price for trailing stop
          const highestPrice = Math.max(position.highestPrice, currentPrice);
          
          // Update position
          setPositions(prev => prev.map(p => 
            p.id === position.id 
              ? { 
                  ...p, 
                  currentPrice, 
                  pnlPercent,
                  pnlSOL: (pnlPercent / 100) * position.invested,
                  highestPrice 
                }
              : p
          ));
          
          // Check Stop Loss
          if (config.slEnabled && !position.slHit && pnlPercent <= config.slPercent) {
            console.log(`🛑 STOP LOSS HIT: ${pnlPercent.toFixed(2)}%`);
            await executeSell(position, 100, `SL ${pnlPercent.toFixed(2)}%`);
            continue;
          }
          
          // Check Trailing Stop
          if (config.trailingStopEnabled && pnlPercent >= config.trailingStopActivation) {
            const dropFromHigh = ((currentPrice - highestPrice) / highestPrice) * 100;
            if (dropFromHigh <= -config.trailingStopPercent) {
              console.log(`🔻 TRAILING STOP HIT: ${dropFromHigh.toFixed(2)}% from high`);
              await executeSell(position, 100, `Trail ${dropFromHigh.toFixed(2)}%`);
              continue;
            }
          }
          
          // Check Take Profit levels
          if (config.tpEnabled) {
            // TP3
            if (!position.tp3Hit && pnlPercent >= config.tp3Percent) {
              console.log(`✅ TP3 HIT: ${pnlPercent.toFixed(2)}%`);
              await executeSell(position, config.tp3SellPercent, `TP3 ${pnlPercent.toFixed(2)}%`);
              setPositions(prev => prev.map(p => 
                p.id === position.id ? { ...p, tp3Hit: true } : p
              ));
            }
            // TP2
            else if (!position.tp2Hit && pnlPercent >= config.tp2Percent) {
              console.log(`✅ TP2 HIT: ${pnlPercent.toFixed(2)}%`);
              await executeSell(position, config.tp2SellPercent, `TP2 ${pnlPercent.toFixed(2)}%`);
              setPositions(prev => prev.map(p => 
                p.id === position.id ? { ...p, tp2Hit: true } : p
              ));
            }
            // TP1
            else if (!position.tp1Hit && pnlPercent >= config.tp1Percent) {
              console.log(`✅ TP1 HIT: ${pnlPercent.toFixed(2)}%`);
              await executeSell(position, config.tp1SellPercent, `TP1 ${pnlPercent.toFixed(2)}%`);
              setPositions(prev => prev.map(p => 
                p.id === position.id ? { ...p, tp1Hit: true } : p
              ));
            }
          }
          
        } catch (e) {
          console.error('Monitor error:', e);
        }
      }
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(interval);
  }, [monitoringEnabled, positions, config]);

  // Apply preset
  const applyPreset = (presetName) => {
    setConfig(prev => ({
      ...prev,
      ...PRESETS[presetName]
    }));
    console.log(`✅ Applied ${presetName} preset`);
  };

  return (
    <div className="pro-trading-panel">
      <div className="panel-header">
        <h2>⚡ PRO TRADING PANEL</h2>
        <div className="status-indicators">
          <div className={`indicator ${autoTradingEnabled ? 'active' : ''}`}>
            🤖 Auto-Trading
          </div>
          <div className={`indicator ${monitoringEnabled ? 'active' : ''}`}>
            👁️ Monitoring
          </div>
          <div className={`indicator ${positions.length > 0 ? 'active' : ''}`}>
            💰 {positions.length} Positions
          </div>
        </div>
      </div>

      {/* Token Input & Chart */}
      <div className="card token-section">
        <h3>📊 TOKEN</h3>
        
        <div className="token-input-row">
          <input
            type="text"
            className="ca-input"
            placeholder="Paste token CA here..."
            value={tokenCA}
            onChange={(e) => setTokenCA(e.target.value)}
          />
          <button
            className="btn-load"
            onClick={() => loadToken(tokenCA)}
            disabled={isLoadingToken}
          >
            {isLoadingToken ? '⏳' : '🔍'} Load
          </button>
        </div>

        {tokenData && (
          <>
            <div className="token-info-grid">
              <div className="info-item">
                <span className="label">Symbol:</span>
                <span className="value">{tokenData.symbol || 'N/A'}</span>
              </div>
              <div className="info-item">
                <span className="label">Price:</span>
                <span className="value">${tokenData.price?.toFixed(8) || '0'}</span>
              </div>
              <div className="info-item">
                <span className="label">MCap:</span>
                <span className="value">${((tokenData.marketCap || 0) / 1000000).toFixed(2)}M</span>
              </div>
              <div className="info-item">
                <span className="label">Liquidity:</span>
                <span className="value">${((tokenData.liquidity || 0) / 1000).toFixed(1)}K</span>
              </div>
            </div>

            <div className="chart-embed">
              <iframe
                src={`https://dexscreener.com/solana/${tokenCA}?embed=1&theme=dark&trades=0&info=0`}
                style={{
                  width: '100%',
                  height: '400px',
                  border: 'none',
                  borderRadius: '12px',
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Quick Presets */}
      <div className="card presets-section">
        <h3>⚡ QUICK PRESETS</h3>
        <div className="preset-buttons">
          <button
            className="preset-btn conservative"
            onClick={() => applyPreset('conservative')}
          >
            🛡️ CONSERVATIVE
            <span className="preset-hint">Low risk, stable gains</span>
          </button>
          <button
            className="preset-btn balanced"
            onClick={() => applyPreset('balanced')}
          >
            ⚖️ BALANCED
            <span className="preset-hint">Medium risk/reward</span>
          </button>
          <button
            className="preset-btn aggressive"
            onClick={() => applyPreset('aggressive')}
          >
            🔥 AGGRESSIVE
            <span className="preset-hint">High risk, big gains</span>
          </button>
        </div>
      </div>

      {/* Configuration Grid */}
      <div className="config-grid">
        {/* Entry Settings */}
        <div className="card config-card">
          <h3>💵 ENTRY</h3>
          
          <label>
            Amount per wallet:
            <input
              type="number"
              step="0.01"
              value={config.entryAmount}
              onChange={(e) => setConfig(c => ({ ...c, entryAmount: parseFloat(e.target.value) }))}
            />
            SOL
          </label>
          
          <label>
            Slippage:
            <input
              type="number"
              value={config.slippage}
              onChange={(e) => setConfig(c => ({ ...c, slippage: parseFloat(e.target.value) }))}
            />
            %
          </label>
          
          <label>
            Priority Fee:
            <input
              type="number"
              step="0.0001"
              value={config.priorityFee}
              onChange={(e) => setConfig(c => ({ ...c, priorityFee: parseFloat(e.target.value) }))}
            />
            SOL
          </label>
        </div>

        {/* Take Profit */}
        <div className="card config-card">
          <h3>
            <label className="checkbox-inline-header">
              <input
                type="checkbox"
                checked={config.tpEnabled}
                onChange={(e) => setConfig(c => ({ ...c, tpEnabled: e.target.checked }))}
              />
              ✅ TAKE PROFIT
            </label>
          </h3>
          
          <div className="tp-level">
            <span className="tp-label">TP1:</span>
            <input
              type="number"
              value={config.tp1Percent}
              onChange={(e) => setConfig(c => ({ ...c, tp1Percent: parseFloat(e.target.value) }))}
              disabled={!config.tpEnabled}
            />
            <span>% →</span>
            <input
              type="number"
              value={config.tp1SellPercent}
              onChange={(e) => setConfig(c => ({ ...c, tp1SellPercent: parseFloat(e.target.value) }))}
              disabled={!config.tpEnabled}
            />
            <span>% sell</span>
          </div>

          <div className="tp-level">
            <span className="tp-label">TP2:</span>
            <input
              type="number"
              value={config.tp2Percent}
              onChange={(e) => setConfig(c => ({ ...c, tp2Percent: parseFloat(e.target.value) }))}
              disabled={!config.tpEnabled}
            />
            <span>% →</span>
            <input
              type="number"
              value={config.tp2SellPercent}
              onChange={(e) => setConfig(c => ({ ...c, tp2SellPercent: parseFloat(e.target.value) }))}
              disabled={!config.tpEnabled}
            />
            <span>% sell</span>
          </div>

          <div className="tp-level">
            <span className="tp-label">TP3:</span>
            <input
              type="number"
              value={config.tp3Percent}
              onChange={(e) => setConfig(c => ({ ...c, tp3Percent: parseFloat(e.target.value) }))}
              disabled={!config.tpEnabled}
            />
            <span>% →</span>
            <input
              type="number"
              value={config.tp3SellPercent}
              onChange={(e) => setConfig(c => ({ ...c, tp3SellPercent: parseFloat(e.target.value) }))}
              disabled={!config.tpEnabled}
            />
            <span>% sell</span>
          </div>
        </div>

        {/* Stop Loss */}
        <div className="card config-card">
          <h3>
            <label className="checkbox-inline-header">
              <input
                type="checkbox"
                checked={config.slEnabled}
                onChange={(e) => setConfig(c => ({ ...c, slEnabled: e.target.checked }))}
              />
              🛑 STOP LOSS
            </label>
          </h3>
          
          <label>
            Stop at:
            <input
              type="number"
              value={config.slPercent}
              onChange={(e) => setConfig(c => ({ ...c, slPercent: parseFloat(e.target.value) }))}
              disabled={!config.slEnabled}
            />
            % loss
          </label>

          <hr />

          <h3>
            <label className="checkbox-inline-header">
              <input
                type="checkbox"
                checked={config.trailingStopEnabled}
                onChange={(e) => setConfig(c => ({ ...c, trailingStopEnabled: e.target.checked }))}
              />
              🔻 TRAILING STOP
            </label>
          </h3>
          
          <label>
            Activate at:
            <input
              type="number"
              value={config.trailingStopActivation}
              onChange={(e) => setConfig(c => ({ ...c, trailingStopActivation: parseFloat(e.target.value) }))}
              disabled={!config.trailingStopEnabled}
            />
            % profit
          </label>

          <label>
            Trail by:
            <input
              type="number"
              value={config.trailingStopPercent}
              onChange={(e) => setConfig(c => ({ ...c, trailingStopPercent: parseFloat(e.target.value) }))}
              disabled={!config.trailingStopEnabled}
            />
            % from high
          </label>
        </div>

        {/* Anti-Rug & Safety */}
        <div className="card config-card">
          <h3>🛡️ SAFETY</h3>
          
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.antiRugEnabled}
              onChange={(e) => setConfig(c => ({ ...c, antiRugEnabled: e.target.checked }))}
            />
            Anti-rug protection
          </label>

          <label>
            Min liquidity:
            <input
              type="number"
              value={config.minLiquiditySOL}
              onChange={(e) => setConfig(c => ({ ...c, minLiquiditySOL: parseFloat(e.target.value) }))}
            />
            SOL
          </label>

          <label>
            Max market cap:
            <input
              type="number"
              value={config.maxMarketCapM}
              onChange={(e) => setConfig(c => ({ ...c, maxMarketCapM: parseFloat(e.target.value) }))}
            />
            M
          </label>
        </div>
      </div>

      {/* Execution Buttons */}
      <div className="card execution-section">
        <h3>🚀 EXECUTION</h3>
        
        <div className="wallet-info">
          <span>Selected wallets: {selectedWallets.length}/{wallets.length}</span>
          <div className="wallet-buttons">
            <button
              className="btn-small"
              onClick={() => setSelectedWallets(wallets.map(w => w.publicKey))}
            >
              Select All
            </button>
            <button
              className="btn-small"
              onClick={() => setSelectedWallets([])}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="execution-buttons">
          <button
            className="btn-execute btn-buy-big"
            onClick={executeBuy}
            disabled={!tokenCA || selectedWallets.length === 0}
          >
            🚀 BUY NOW
          </button>

          <button
            className={`btn-execute btn-monitor ${monitoringEnabled ? 'active' : ''}`}
            onClick={() => setMonitoringEnabled(!monitoringEnabled)}
            disabled={positions.length === 0}
          >
            {monitoringEnabled ? '👁️ MONITORING...' : '👁️ START MONITORING'}
          </button>
        </div>
      </div>

      {/* Active Positions */}
      {positions.length > 0 && (
        <div className="card positions-section">
          <h3>💰 ACTIVE POSITIONS</h3>
          
          <div className="positions-list">
            {positions.map(position => {
              const isProfitable = position.pnlPercent > 0;
              
              return (
                <div key={position.id} className="position-item">
                  <div className="position-header">
                    <span className="position-token">{position.tokenSymbol}</span>
                    <span className={`position-pnl ${isProfitable ? 'positive' : 'negative'}`}>
                      {isProfitable ? '+' : ''}{position.pnlPercent.toFixed(2)}%
                    </span>
                  </div>
                  
                  <div className="position-details">
                    <div className="detail-row">
                      <span>Entry: ${position.entryPrice.toFixed(8)}</span>
                      <span>Current: ${position.currentPrice.toFixed(8)}</span>
                    </div>
                    <div className="detail-row">
                      <span>Invested: {position.invested.toFixed(3)} SOL</span>
                      <span className={isProfitable ? 'positive' : 'negative'}>
                        PnL: {isProfitable ? '+' : ''}{position.pnlSOL.toFixed(4)} SOL
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="tp-indicators">
                        {position.tp1Hit && <span className="tp-hit">TP1✅</span>}
                        {position.tp2Hit && <span className="tp-hit">TP2✅</span>}
                        {position.tp3Hit && <span className="tp-hit">TP3✅</span>}
                      </span>
                      <button
                        className="btn-sell-small"
                        onClick={() => executeSell(position, 100, 'manual')}
                      >
                        🔴 Sell All
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
