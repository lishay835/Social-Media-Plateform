/**
 * WebSocket Real-Time Client Wrapper
 */

class RealtimeSocket {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.userId = null;
    this.pingInterval = null;
  }

  connect(userId) {
    this.userId = userId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('⚡ Connected to Social Platform Real-Time Engine');
        this.reconnectAttempts = 0;
        // Identify active user for presence & targeted notifications
        this.send({ type: 'IDENTIFY', userId: this.userId });

        // Heartbeat ping
        clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.send({ type: 'PING' });
          }
        }, 25000);
      };

      this.socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.emit(msg.type, msg);
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      this.socket.onclose = () => {
        console.warn('⚠️ Real-time connection closed. Reconnecting...');
        clearInterval(this.pingInterval);
        this.scheduleReconnect();
      };

      this.socket.onerror = (err) => {
        console.error('WebSocket encountered error:', err);
      };
    } catch (e) {
      console.error('Failed to initiate WebSocket:', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    setTimeout(() => {
      if (this.userId) this.connect(this.userId);
    }, delay);
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(callback);
  }

  off(type, callback) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).delete(callback);
    }
  }

  emit(type, data) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).forEach(cb => cb(data));
    }
  }
}

const socketClient = new RealtimeSocket();
