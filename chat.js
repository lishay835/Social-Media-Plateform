/**
 * Full Messenger Chat Portal Module
 */

const ChatModule = {
  conversations: [],
  activeConversationId: null,

  async init() {
    await this.loadConversations();
    this.bindEvents();

    // Listen for incoming messages via WebSocket
    socketClient.on('NEW_MESSAGE', (data) => {
      this.handleIncomingMessage(data.conversationId, data.message);
    });

    // Listen for presence changes to update chat dots
    socketClient.on('PRESENCE_CHANGE', (data) => {
      const conv = this.conversations.find(c => c.partnerId === data.userId);
      if (conv) {
        conv.isOnline = data.isOnline;
        conv.lastSeen = data.lastSeen;
        this.renderConversations();
        if (this.activeConversationId === conv.id) {
          this.renderChatHeader(conv);
        }
      }
    });
  },

  async loadConversations() {
    try {
      this.conversations = await API.get('/api/conversations');
      this.renderConversations();
      if (this.conversations.length > 0 && !this.activeConversationId) {
        this.selectConversation(this.conversations[0].id);
      }
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  },

  renderConversations() {
    const listEl = document.getElementById('messenger-conversations-list');
    if (!listEl) return;

    listEl.innerHTML = this.conversations.map(conv => {
      const isActive = conv.id === this.activeConversationId ? 'active' : '';
      return `
        <div class="conversation-item ${isActive}" data-conv-id="${conv.id}">
          <div class="friend-avatar-wrapper">
            <img src="${conv.partnerAvatar}" class="friend-avatar" alt="${conv.partnerName}">
            ${conv.isOnline ? '<span class="online-dot"></span>' : ''}
          </div>
          <div class="conversation-info">
            <div class="conversation-top-line">
              <span class="conv-name">${conv.partnerName}</span>
              <span class="conv-time">${conv.lastMessageTimestamp || ''}</span>
            </div>
            <div class="conv-last-msg">${conv.lastMessage || 'No messages yet'}</div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.conversation-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-conv-id');
        this.selectConversation(id);
      });
    });
  },

  async selectConversation(convId) {
    this.activeConversationId = convId;
    this.renderConversations();

    const conv = this.conversations.find(c => c.id === convId);
    if (conv) {
      this.renderChatHeader(conv);
    }

    // Fetch messages
    try {
      const messages = await API.get(`/api/messages/${convId}`);
      this.renderMessages(messages);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  },

  renderChatHeader(conv) {
    const headerEl = document.getElementById('chat-active-header');
    if (!headerEl) return;

    headerEl.innerHTML = `
      <div class="friend-avatar-wrapper">
        <img src="${conv.partnerAvatar}" class="friend-avatar" alt="${conv.partnerName}">
        ${conv.isOnline ? '<span class="online-dot"></span>' : ''}
      </div>
      <div>
        <div style="font-size: 15px; font-weight: 700; color: var(--text-main);">${conv.partnerName}</div>
        <div style="font-size: 11.5px; color: ${conv.isOnline ? 'var(--accent-green)' : 'var(--text-light)'};">
          ${conv.isOnline ? 'Active now' : (conv.lastSeen ? `Last seen ${conv.lastSeen}` : 'Offline')}
        </div>
      </div>
    `;
  },

  renderMessages(messages) {
    const streamEl = document.getElementById('chat-messages-stream');
    if (!streamEl) return;

    streamEl.innerHTML = messages.map(msg => {
      const isOutgoing = msg.senderId === window.currentUser?.id;
      return `
        <div class="msg-bubble-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}">
          <div class="msg-bubble">${this.escapeHTML(msg.text)}</div>
          <span class="msg-time">${msg.timestamp}</span>
        </div>
      `;
    }).join('');

    // Scroll to bottom smoothly
    streamEl.scrollTop = streamEl.scrollHeight;
  },

  async sendMessage() {
    const input = document.getElementById('chat-input-field');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !this.activeConversationId) return;

    input.value = '';

    try {
      const msg = await API.post('/api/messages', {
        conversationId: this.activeConversationId,
        text
      });
      // The socket broadcast or local return handles rendering
    } catch (e) {
      alert('Failed to send message: ' + e.message);
    }
  },

  handleIncomingMessage(convId, message) {
    // If message is for currently open conversation, append directly
    if (this.activeConversationId === convId) {
      const streamEl = document.getElementById('chat-messages-stream');
      if (streamEl) {
        const isOutgoing = message.senderId === window.currentUser?.id;
        const div = document.createElement('div');
        div.className = `msg-bubble-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}`;
        div.innerHTML = `
          <div class="msg-bubble">${this.escapeHTML(message.text)}</div>
          <span class="msg-time">${message.timestamp}</span>
        `;
        streamEl.appendChild(div);
        streamEl.scrollTop = streamEl.scrollHeight;
      }
    }

    // Update conversation snippet in list
    const conv = this.conversations.find(c => c.id === convId);
    if (conv) {
      conv.lastMessage = message.text;
      conv.lastMessageTimestamp = message.timestamp;
      this.renderConversations();
    }
  },

  bindEvents() {
    const form = document.getElementById('chat-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }

    const sendBtn = document.getElementById('btn-send-message');
    if (sendBtn) {
      sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }
  },

  escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
};
