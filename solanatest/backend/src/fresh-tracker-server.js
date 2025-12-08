// backend/src/fresh-tracker-server.js
// WebSocket сервер для интеграции Fresh Tracker

import WebSocket from 'ws';

export function setupFreshTrackerWebSocket(httpServer) {
  // WebSocket сервер для frontend клиентов
  const wss = new WebSocket.Server({ 
    server: httpServer,
    path: '/fresh-tracker'
  });

  // Подключаемся к Fresh Tracker upstream
  let freshTrackerWs = null;
  const FRESH_TRACKER_URL = 'wss://87.120.93.71:5000';
  
  // Кэш последних трейдов
  const recentTrades = [];
  const MAX_TRADES = 1000;
  
  // Подключение к Fresh Tracker WS
  function connectToFreshTracker() {
    console.log('🔌 Connecting to Fresh Tracker upstream...');
    
    freshTrackerWs = new WebSocket(FRESH_TRACKER_URL);
    
    freshTrackerWs.on('open', () => {
      console.log('✅ Connected to Fresh Tracker upstream');
    });
    
    freshTrackerWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'pong') return;
        
        console.log('📨 Fresh Tracker message:', msg.type);
        
        if (msg.type === 'trade' || msg.data) {
          const trade = normalizeTradeData(msg);
          
          recentTrades.unshift(trade);
          if (recentTrades.length > MAX_TRADES) {
            recentTrades.pop();
          }
          
          broadcastToClients({
            type: 'new_trade',
            trade: trade
          });
        }
        
        if (msg.type === 'wallet_analysis') {
          broadcastToClients({
            type: 'wallet_analysis',
            walletAddress: msg.walletAddress,
            data: msg.data
          });
        }
        
      } catch (e) {
        console.error('Error processing Fresh Tracker message:', e);
      }
    });
    
    freshTrackerWs.on('error', (error) => {
      console.error('❌ Fresh Tracker WS error:', error.message);
    });
    
    freshTrackerWs.on('close', () => {
      console.log('⚠️ Fresh Tracker WS closed, reconnecting in 5s...');
      setTimeout(connectToFreshTracker, 5000);
    });
    
    // Keepalive
    setInterval(() => {
      if (freshTrackerWs && freshTrackerWs.readyState === WebSocket.OPEN) {
        freshTrackerWs.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }
  
  // Normalize trade data
  function normalizeTradeData(msg) {
    const rawTrade = msg.data || msg;
    
    return {
      timestamp: Date.now(),
      walletAddress: rawTrade.wallet || rawTrade.walletAddress || 'unknown',
      tokenMint: rawTrade.token || rawTrade.tokenMint || rawTrade.mint || 'unknown',
      tokenSymbol: rawTrade.symbol || rawTrade.tokenSymbol || null,
      amount: parseFloat(rawTrade.amount || rawTrade.sol || 0),
      type: rawTrade.type || rawTrade.action || 'buy',
      walletWinRate: rawTrade.winRate || rawTrade.walletWinRate || null,
      walletTotalTrades: rawTrade.totalTrades || rawTrade.walletTotalTrades || null,
      walletProfit: rawTrade.profit || rawTrade.walletProfit || null,
      price: rawTrade.price || null,
      marketCap: rawTrade.mc || rawTrade.marketCap || null,
      txSignature: rawTrade.tx || rawTrade.signature || null,
    };
  }
  
  // Broadcast to all clients
  function broadcastToClients(message) {
    const payload = JSON.stringify(message);
    
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
  
  // Handle client connections
  wss.on('connection', (ws) => {
    console.log('🔌 Fresh Tracker client connected');
    
    // Send initial snapshot
    ws.send(JSON.stringify({
      type: 'trades_snapshot',
      trades: recentTrades.slice(0, 100)
    }));
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'request_analysis' && msg.walletAddress) {
          if (freshTrackerWs && freshTrackerWs.readyState === WebSocket.OPEN) {
            freshTrackerWs.send(JSON.stringify({
              type: 'request_analysis',
              walletAddress: msg.walletAddress
            }));
          }
        }
        
      } catch (e) {
        console.error('Error processing client message:', e);
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 Fresh Tracker client disconnected');
    });
  });
  
  // Connect to upstream
  connectToFreshTracker();
  
  console.log('🚀 Fresh Tracker WebSocket server ready on /fresh-tracker');
  
  return {
    wss,
    getRecentTrades: () => recentTrades,
    requestWalletAnalysis: (walletAddress) => {
      if (freshTrackerWs && freshTrackerWs.readyState === WebSocket.OPEN) {
        freshTrackerWs.send(JSON.stringify({
          type: 'request_analysis',
          walletAddress: walletAddress
        }));
      }
    }
  };
}