/**
 * Advanced Events Creation & Management Module
 */

const EventsModule = {
  events: [],
  currentCategory: 'All',

  async init() {
    await this.loadEvents();
    this.bindEvents();

    // Real-time listener for newly created events
    socketClient.on('NEW_EVENT', (data) => {
      this.events.unshift(data.event);
      this.renderEvents();
      this.renderSidebarWidget();
    });

    // Real-time listener for RSVP updates
    socketClient.on('EVENT_RSVP_UPDATED', (data) => {
      const ev = this.events.find(e => e.id === data.eventId);
      if (ev) {
        ev.attendeesCount = data.attendeesCount;
        this.renderEvents();
      }
    });
  },

  async loadEvents(category = 'All') {
    this.currentCategory = category;
    try {
      this.events = await API.get(`/api/events?category=${encodeURIComponent(category)}`);
      this.renderEvents();
      this.renderSidebarWidget();
    } catch (e) {
      console.error('Failed to load events:', e);
    }
  },

  renderEvents() {
    const gridEl = document.getElementById('events-grid');
    if (!gridEl) return;

    if (this.events.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state-box" style="grid-column: 1 / -1;">
          <div class="empty-state-icon">📅</div>
          <div class="empty-state-title">No Events in this Category</div>
          <div class="empty-state-desc">Be the first to organize a gathering or explore other categories.</div>
          <button class="btn-primary" id="btn-empty-create-event">+ Create Event</button>
        </div>
      `;
      document.getElementById('btn-empty-create-event')?.addEventListener('click', () => {
        this.openCreateModal();
      });
      return;
    }

    gridEl.innerHTML = this.events.map(ev => {
      const isAttending = (ev.attendees || []).includes(window.currentUser?.id);
      return `
        <div class="event-card" data-event-id="${ev.id}">
          <img src="${ev.banner || '/images/post_3.jpg'}" class="event-banner" alt="${this.escapeHTML(ev.title)}">
          <div class="event-body">
            <span class="event-date-tag">${this.escapeHTML(ev.date)}</span>
            <h3 class="event-title">${this.escapeHTML(ev.title)}</h3>
            <p class="event-desc">${this.escapeHTML(ev.description)}</p>
            <div class="event-meta-row">
              <span>🕒 ${this.escapeHTML(ev.time)}</span>
              <span>📍 ${this.escapeHTML(ev.location)}</span>
              <span>👥 ${ev.attendeesCount || 1} Attending</span>
            </div>
            <button class="btn-rsvp ${isAttending ? 'attending' : ''}" data-rsvp-id="${ev.id}">
              ${isAttending ? '✓ Attending' : 'View Event / RSVP'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('.btn-rsvp').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.getAttribute('data-rsvp-id');
        await this.toggleRSVP(id);
      });
    });
  },

  renderSidebarWidget() {
    const widgetEl = document.getElementById('upcoming-events-list');
    if (!widgetEl) return;

    const previewEvents = this.events.slice(0, 2);
    if (previewEvents.length === 0) {
      widgetEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 10px 0;">No upcoming events</div>';
      return;
    }

    widgetEl.innerHTML = previewEvents.map(ev => {
      const parts = (ev.date || '').split(',');
      const monthDay = parts[1] ? parts[1].trim().split(' ') : ['SEP', '16'];
      return `
        <div class="mini-event-item" data-event-id="${ev.id}">
          <div class="mini-event-date-badge">
            <div class="mini-event-date-month">${monthDay[0] || 'DATE'}</div>
            <div class="mini-event-date-day">${monthDay[1] || '16'}</div>
          </div>
          <div class="mini-event-info">
            <div class="mini-event-title">${this.escapeHTML(ev.title)}</div>
            <div class="mini-event-meta">🕒 ${this.escapeHTML(ev.time)} • ${this.escapeHTML(ev.location)}</div>
          </div>
        </div>
      `;
    }).join('');
  },

  async toggleRSVP(eventId) {
    try {
      const res = await API.post(`/api/events/${eventId}/rsvp`);
      const ev = this.events.find(e => e.id === eventId);
      if (ev) {
        ev.attendeesCount = res.attendeesCount;
        if (res.isAttending) {
          if (!ev.attendees) ev.attendees = [];
          if (!ev.attendees.includes(window.currentUser?.id)) ev.attendees.push(window.currentUser?.id);
        } else {
          ev.attendees = (ev.attendees || []).filter(u => u !== window.currentUser?.id);
        }
        this.renderEvents();
      }
    } catch (e) {
      alert('RSVP failed: ' + e.message);
    }
  },

  openCreateModal() {
    const modal = document.getElementById('create-event-modal');
    if (modal) modal.classList.add('active');
  },

  closeCreateModal() {
    const modal = document.getElementById('create-event-modal');
    if (modal) modal.classList.remove('active');
  },

  async handleCreateEvent(eventData) {
    try {
      const newEv = await API.post('/api/events', eventData);
      this.closeCreateModal();
      // Instantly prepend locally and re-render
      this.events.unshift(newEv);
      this.renderEvents();
      this.renderSidebarWidget();
    } catch (e) {
      alert('Failed to create event: ' + e.message);
    }
  },

  bindEvents() {
    // Open Create Event Modal Buttons
    document.querySelectorAll('.btn-open-create-event').forEach(btn => {
      btn.addEventListener('click', () => this.openCreateModal());
    });

    document.getElementById('btn-close-create-event')?.addEventListener('click', () => {
      this.closeCreateModal();
    });

    // Form Submission
    document.getElementById('form-create-event')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('ev-input-title').value.trim();
      const date = document.getElementById('ev-input-date').value.trim();
      const time = document.getElementById('ev-input-time').value.trim();
      const location = document.getElementById('ev-input-location').value.trim();
      const category = document.getElementById('ev-select-category').value;
      const banner = document.getElementById('ev-select-banner').value;
      const description = document.getElementById('ev-input-description').value.trim();

      if (!title) return alert('Please enter an event title');

      this.handleCreateEvent({
        title,
        date: date || 'Sat, Sep 20, 2026',
        time: time || '6:00 PM',
        location: location || 'Online Meeting Room',
        category,
        banner,
        description: description || 'Exciting community meetup and sharing session.'
      });
    });

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const cat = pill.getAttribute('data-cat') || 'All';
        this.loadEvents(cat);
      });
    });
  },

  escapeHTML(str) {
    return (str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
};
