/**
 * Main Application Coordinator & State Controller
 */

const App = {
  currentView: 'feed',
  cursor: 0,
  limit: 10,
  hasMorePosts: true,
  isLoadingPosts: false,
  posts: [],
  selectedMediaUrl: null,

  async init() {
    try {
      // 1. Fetch current logged-in user profile
      window.currentUser = await API.get('/api/users/profile');
      this.syncUserInterface();

      // 2. Initialize Real-Time WebSocket
      socketClient.connect(window.currentUser.id);

      // 3. Initialize Interactive Stories
      await StoriesModule.init();

      // 4. Load Initial Feed Posts
      await this.loadFeedPosts(true);

      // 5. Load Right Sidebar Widgets (Suggested Friends & Online Friends)
      await this.loadSidebarWidgets();

      // 6. Load Notifications Badge & Data
      await this.loadNotifications();

      // 7. Initialize Other Modules (Messenger, Events)
      await EventsModule.init();

      // 8. Bind Global Navigation & Interactive Handlers
      this.bindNavigation();
      this.bindCreatePost();
      this.bindSearch();
      this.bindProfileEditor();
      this.bindSocketListeners();
      this.bindInfiniteScroll();

    } catch (e) {
      console.error('App initialization error:', e);
    }
  },

  syncUserInterface() {
    const user = window.currentUser;
    if (!user) return;

    // Topbar
    const topAvatar = document.getElementById('topbar-user-avatar');
    const topName = document.getElementById('topbar-user-name');
    if (topAvatar) topAvatar.src = user.avatar;
    if (topName) topName.textContent = user.name.split(' ')[0] || user.name;

    // Left Sidebar Account Info Card
    const accountAvatar = document.getElementById('account-avatar-img');
    const accountName = document.getElementById('account-name-text');
    const accountHandle = document.getElementById('account-handle-text');
    const accountBio = document.getElementById('account-bio-text');
    const statPosts = document.getElementById('stat-posts-count');
    const statFollowers = document.getElementById('stat-followers-count');
    const statFollowing = document.getElementById('stat-following-count');

    if (accountAvatar) accountAvatar.src = user.avatar;
    if (accountName) accountName.textContent = user.name;
    if (accountHandle) accountHandle.textContent = `@${user.handle}`;
    if (accountBio) accountBio.textContent = user.bio;
    if (statPosts) statPosts.textContent = user.stats?.posts || 0;
    if (statFollowers) statFollowers.textContent = user.stats?.followers || '0';
    if (statFollowing) statFollowing.textContent = user.stats?.following || '0';

    // Create Post Avatar & Input placeholder
    const createAvatar = document.getElementById('create-post-avatar');
    const createInput = document.getElementById('create-post-input');
    if (createAvatar) createAvatar.src = user.avatar;
    if (createInput) createInput.placeholder = `What's on your mind, ${user.name.split(' ')[0]}?`;
  },

  // -----------------------------------------------------------
  // NAVIGATION & VIEW ROUTING
  // -----------------------------------------------------------
  bindNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.getAttribute('data-view');
        this.switchView(targetView);
      });
    });

    // Topbar Profile shortcut
    document.getElementById('topbar-profile-btn')?.addEventListener('click', () => {
      this.switchView('profile');
    });

    // Account info card click triggers profile view
    document.getElementById('account-info-card')?.addEventListener('click', (e) => {
      // Don't trigger if clicked on highlights
      if (!e.target.closest('.highlights-section')) {
        this.switchView('profile');
      }
    });

    // Topbar Messages shortcut
    document.getElementById('btn-top-messages')?.addEventListener('click', () => {
      this.switchView('messages');
    });
  },

  switchView(viewName) {
    this.currentView = viewName;

    // Update active state in left nav
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      if (item.getAttribute('data-view') === viewName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Hide all view containers
    const views = ['feed', 'messages', 'events', 'saved', 'profile'];
    views.forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.style.display = (v === viewName) ? 'block' : 'none';
    });

    // Specific view lifecycle callbacks
    if (viewName === 'messages') {
      ChatModule.init();
    } else if (viewName === 'events') {
      EventsModule.loadEvents();
    } else if (viewName === 'saved') {
      this.loadSavedPosts();
    } else if (viewName === 'profile') {
      this.renderProfilePage();
    }
  },

  // -----------------------------------------------------------
  // POSTS FEED & INFINITE SCROLLING
  // -----------------------------------------------------------
  async loadFeedPosts(reset = false) {
    if (this.isLoadingPosts || (!this.hasMorePosts && !reset)) return;
    this.isLoadingPosts = true;

    if (reset) {
      this.cursor = 0;
      this.posts = [];
      this.hasMorePosts = true;
    }

    try {
      const res = await API.get(`/api/posts/feed?cursor=${this.cursor}&limit=${this.limit}`);
      const newPosts = res.posts || [];

      if (reset) {
        this.posts = newPosts;
      } else {
        this.posts = this.posts.concat(newPosts);
      }

      this.cursor = res.nextCursor;
      if (res.nextCursor === null || newPosts.length === 0) {
        this.hasMorePosts = false;
      }

      this.renderFeedPosts();
    } catch (e) {
      console.error('Failed to load feed posts:', e);
    } finally {
      this.isLoadingPosts = false;
    }
  },

  renderFeedPosts() {
    const container = document.getElementById('feed-posts-stream');
    if (!container) return;

    if (this.posts.length === 0) {
      container.innerHTML = `
        <div class="card empty-state-box">
          <div class="empty-state-icon">📰</div>
          <div class="empty-state-title">No Posts Yet</div>
          <div class="empty-state-desc">Share an update or photo to get the conversation started!</div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.posts.map(post => this.renderPostCardHTML(post)).join('');
    this.bindPostInteractions(container);
  },

  renderPostCardHTML(post) {
    const isLiked = (post.likes || []).includes(window.currentUser?.id);
    const isSaved = (post.savedBy || []).includes(window.currentUser?.id);
    const likesCount = (post.likes || []).length;
    const commentsCount = (post.comments || []).length;

    let mediaHTML = '';
    if (post.mediaUrl) {
      mediaHTML = `
        <div class="post-media-container">
          <img src="${post.mediaUrl}" class="post-media-img" alt="Post attachment" loading="lazy">
        </div>
      `;
    }

    return `
      <div class="card post-card" id="post-card-${post.id}" data-post-id="${post.id}">
        <div class="post-header">
          <div class="post-author-wrapper">
            <img src="${post.authorAvatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=user'}" class="post-author-avatar" alt="${this.escapeHTML(post.authorName)}">
            <div>
              <div class="post-author-name">${this.escapeHTML(post.authorName)}</div>
              <div class="post-meta-sub">${this.escapeHTML(post.location || '')} • ${this.escapeHTML(post.createdAt)}</div>
            </div>
          </div>
          <button class="post-menu-btn" title="Post options">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/>
              <circle cx="12" cy="12" r="2"/>
              <circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
        </div>

        <p class="post-caption">${this.escapeHTML(post.caption)}</p>

        ${mediaHTML}

        <div class="post-actions-bar">
          <div class="post-action-left">
            <button class="action-btn btn-like ${isLiked ? 'active' : ''}" data-post-id="${post.id}">
              <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              <span class="like-count-label">${likesCount}</span>
            </button>

            <button class="action-btn btn-comment-toggle" data-post-id="${post.id}">
              <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span class="comment-count-label">${commentsCount}</span>
            </button>

            <button class="action-btn btn-share" data-post-id="${post.id}">
              <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              <span>${post.sharesCount || 0}</span>
            </button>
          </div>

          <button class="action-btn btn-save ${isSaved ? 'active-save' : ''}" data-post-id="${post.id}">
            <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>

        <div class="post-metrics-summary" id="post-summary-${post.id}">
          ${this.escapeHTML(post.likedBySummary || (likesCount ? `${likesCount} likes` : '0 likes'))}
        </div>

        <!-- Comments Drawer -->
        <div class="comments-drawer" id="comments-drawer-${post.id}">
          <div class="comments-list" id="comments-list-${post.id}">
            ${(post.comments || []).map(c => this.renderCommentItemHTML(post.id, c)).join('')}
          </div>
          <form class="comment-input-row" data-post-id="${post.id}">
            <input type="text" class="comment-input" placeholder="Write a comment..." required>
            <button type="submit" class="comment-post-btn">Post</button>
          </form>
        </div>
      </div>
    `;
  },

  renderCommentItemHTML(postId, comment) {
    const isAuthor = comment.userId === window.currentUser?.id;
    return `
      <div class="comment-row" id="comment-${comment.id}">
        <img src="${comment.userAvatar}" class="comment-avatar" alt="${this.escapeHTML(comment.userName)}">
        <div class="comment-bubble">
          <div class="comment-author-name">
            ${this.escapeHTML(comment.userName)}
            <span style="font-size: 11px; font-weight: normal; color: var(--text-light); margin-left: 6px;">${comment.createdAt}</span>
            ${isAuthor ? `<span class="comment-delete-btn" data-post-id="${postId}" data-comment-id="${comment.id}">Delete</span>` : ''}
          </div>
          <div class="comment-text">${this.escapeHTML(comment.text)}</div>
        </div>
      </div>
    `;
  },

  bindPostInteractions(container) {
    // 1. Like Toggle
    container.querySelectorAll('.btn-like').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const postId = btn.getAttribute('data-post-id');
        await this.toggleLike(postId, btn);
      });
    });

    // 2. Comment Drawer Toggle
    container.querySelectorAll('.btn-comment-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const postId = btn.getAttribute('data-post-id');
        const drawer = document.getElementById(`comments-drawer-${postId}`);
        if (drawer) {
          drawer.classList.toggle('open');
          if (drawer.classList.contains('open')) {
            drawer.querySelector('.comment-input')?.focus();
          }
        }
      });
    });

    // 3. Comment Submission Form
    container.querySelectorAll('.comment-input-row').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const postId = form.getAttribute('data-post-id');
        const input = form.querySelector('.comment-input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        await this.addComment(postId, text);
      });
    });

    // 4. Comment Deletion
    container.querySelectorAll('.comment-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const postId = btn.getAttribute('data-post-id');
        const commentId = btn.getAttribute('data-comment-id');
        await this.deleteComment(postId, commentId);
      });
    });

    // 5. Save/Bookmark Toggle
    container.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const postId = btn.getAttribute('data-post-id');
        await this.toggleSave(postId, btn);
      });
    });

    // 6. Share trigger
    container.querySelectorAll('.btn-share').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard?.writeText(window.location.href);
        alert('Post link copied to clipboard! Share it with your friends.');
      });
    });
  },

  async toggleLike(postId, btnEl) {
    try {
      // Optimistic update
      const countEl = btnEl.querySelector('.like-count-label');
      const wasActive = btnEl.classList.contains('active');
      let count = parseInt(countEl.textContent, 10) || 0;

      if (wasActive) {
        btnEl.classList.remove('active');
        count = Math.max(0, count - 1);
      } else {
        btnEl.classList.add('active');
        count++;
      }
      countEl.textContent = count;

      // Backend API call
      const res = await API.post(`/api/posts/${postId}/like`);
      // Update with server verified state
      if (res.isLiked) {
        btnEl.classList.add('active');
      } else {
        btnEl.classList.remove('active');
      }
      countEl.textContent = res.likesCount;

      const summaryEl = document.getElementById(`post-summary-${postId}`);
      if (summaryEl) summaryEl.textContent = res.likedBySummary;

    } catch (e) {
      console.error('Like toggle failed:', e);
    }
  },

  async addComment(postId, text) {
    try {
      const comment = await API.post(`/api/posts/${postId}/comments`, { text });
      // The socket broadcast or direct append handles rendering
      this.appendCommentToDOM(postId, comment);
    } catch (e) {
      alert('Failed to post comment: ' + e.message);
    }
  },

  async deleteComment(postId, commentId) {
    try {
      await API.delete(`/api/posts/${postId}/comments/${commentId}`);
      document.getElementById(`comment-${commentId}`)?.remove();
    } catch (e) {
      alert('Failed to delete comment: ' + e.message);
    }
  },

  appendCommentToDOM(postId, comment) {
    const listEl = document.getElementById(`comments-list-${postId}`);
    if (!listEl) return;
    if (document.getElementById(`comment-${comment.id}`)) return; // already rendered

    const div = document.createElement('div');
    div.innerHTML = this.renderCommentItemHTML(postId, comment);
    listEl.appendChild(div.firstElementChild);

    // Update comment count badge
    const countBadge = document.querySelector(`#post-card-${postId} .comment-count-label`);
    if (countBadge) {
      let count = parseInt(countBadge.textContent, 10) || 0;
      countBadge.textContent = count + 1;
    }
  },

  async toggleSave(postId, btnEl) {
    try {
      const res = await API.post(`/api/posts/${postId}/save`);
      if (res.isSaved) {
        btnEl.classList.add('active-save');
      } else {
        btnEl.classList.remove('active-save');
      }
    } catch (e) {
      console.error('Save toggle failed:', e);
    }
  },

  // -----------------------------------------------------------
  // CREATE POST WORKFLOW
  // -----------------------------------------------------------
  bindCreatePost() {
    const form = document.getElementById('form-create-post');
    const input = document.getElementById('create-post-input');
    const btnSubmit = document.getElementById('btn-submit-post');
    const mediaChip = document.getElementById('chip-attach-photo');
    const mediaPreview = document.getElementById('create-post-media-preview');

    // Photo Attachment Chip
    mediaChip?.addEventListener('click', () => {
      this.openMediaPickerModal();
    });

    btnSubmit?.addEventListener('click', async (e) => {
      e.preventDefault();
      const caption = input.value.trim();
      if (!caption && !this.selectedMediaUrl) {
        return alert('Please write something or attach a photo before posting.');
      }

      try {
        const payload = {
          caption,
          mediaUrl: this.selectedMediaUrl,
          mediaType: this.selectedMediaUrl ? 'image' : null
        };

        const newPost = await API.post('/api/posts', payload);
        input.value = '';
        this.selectedMediaUrl = null;
        if (mediaPreview) mediaPreview.style.display = 'none';

        // Prepend new post dynamically to feed array
        this.posts.unshift(newPost);
        this.renderFeedPosts();

        // Increment user posts stat
        const statPosts = document.getElementById('stat-posts-count');
        if (statPosts) {
          let count = parseInt(statPosts.textContent, 10) || 0;
          statPosts.textContent = count + 1;
        }

      } catch (err) {
        alert('Failed to publish post: ' + err.message);
      }
    });
  },

  openMediaPickerModal() {
    const modal = document.getElementById('media-picker-modal');
    const grid = document.getElementById('media-picker-grid');
    if (!modal || !grid) return;

    // Populate gallery from pre-saved local post images (post_1.jpg to post_15.jpg)
    const images = Array.from({ length: 15 }, (_, i) => `/images/post_${i + 1}.jpg`);

    grid.innerHTML = images.map(imgUrl => `
      <div class="media-picker-item" data-url="${imgUrl}" style="cursor: pointer; border-radius: 12px; overflow: hidden; height: 100px;">
        <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover; border: 2px solid transparent; border-radius: 12px;" alt="Post image">
      </div>
    `).join('');

    grid.querySelectorAll('.media-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.getAttribute('data-url');
        this.selectedMediaUrl = url;
        const preview = document.getElementById('create-post-media-preview');
        const previewImg = document.getElementById('create-post-preview-img');
        if (preview && previewImg) {
          previewImg.src = url;
          preview.style.display = 'block';
        }
        modal.classList.remove('active');
      });
    });

    modal.classList.add('active');

    document.getElementById('btn-close-media-picker')?.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    document.getElementById('btn-remove-preview-img')?.addEventListener('click', () => {
      this.selectedMediaUrl = null;
      const preview = document.getElementById('create-post-media-preview');
      if (preview) preview.style.display = 'none';
    });
  },

  // -----------------------------------------------------------
  // INFINITE SCROLL
  // -----------------------------------------------------------
  bindInfiniteScroll() {
    window.addEventListener('scroll', () => {
      if (this.currentView !== 'feed') return;
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const clientHeight = window.innerHeight;

      // When within 300px of bottom, lazily fetch sequential paginated package
      if (scrollTop + clientHeight >= scrollHeight - 300) {
        this.loadFeedPosts(false);
      }
    });
  },

  // -----------------------------------------------------------
  // RIGHT SIDEBAR WIDGETS
  // -----------------------------------------------------------
  async loadSidebarWidgets() {
    try {
      // 1. Suggested Friends
      const suggested = await API.get('/api/friends/suggested');
      const suggestedList = document.getElementById('suggested-friends-list');
      if (suggestedList) {
        suggestedList.innerHTML = suggested.slice(0, 4).map(u => `
          <div class="friend-item" id="suggested-user-${u.id}">
            <div class="friend-item-info">
              <img src="${u.avatar}" class="friend-avatar" alt="${this.escapeHTML(u.name)}">
              <div>
                <div class="friend-name">${this.escapeHTML(u.name)}</div>
                <div class="friend-sub">${u.mutualFriends || 3} mutual friends</div>
              </div>
            </div>
            <button class="btn-pill-action ${u.hasRequested ? 'active-state' : ''}" data-suggest-id="${u.id}">
              ${u.hasRequested ? 'Request Sent' : 'Follow'}
            </button>
          </div>
        `).join('');

        suggestedList.querySelectorAll('.btn-pill-action').forEach(btn => {
          btn.addEventListener('click', async () => {
            const userId = btn.getAttribute('data-suggest-id');
            const isSent = btn.classList.contains('active-state');
            if (!isSent) {
              await API.post('/api/friends/request', { userId });
              btn.classList.add('active-state');
              btn.textContent = 'Request Sent';
            } else {
              // 1-way follow toggle
              const res = await API.post('/api/friends/follow', { userId });
              btn.textContent = res.isFollowing ? 'Following' : 'Follow';
            }
          });
        });
      }

      // 2. Online Friends
      const users = await API.get('/api/search?q=a'); // get list of users
      const onlineFriends = (users.users || []).filter(u => u.id !== window.currentUser?.id);
      const onlineList = document.getElementById('online-friends-list');
      if (onlineList) {
        onlineList.innerHTML = onlineFriends.slice(0, 5).map(u => `
          <div class="friend-item" style="cursor: pointer;" data-chat-user="${u.id}">
            <div class="friend-item-info">
              <div class="friend-avatar-wrapper">
                <img src="${u.avatar}" class="friend-avatar" alt="${this.escapeHTML(u.name)}">
                <span class="online-dot"></span>
              </div>
              <div class="friend-name">${this.escapeHTML(u.name)}</div>
            </div>
          </div>
        `).join('');

        onlineList.querySelectorAll('.friend-item').forEach(item => {
          item.addEventListener('click', () => {
            this.switchView('messages');
          });
        });
      }

    } catch (e) {
      console.error('Failed to load sidebar widgets:', e);
    }
  },

  // -----------------------------------------------------------
  // NOTIFICATIONS PIPELINE
  // -----------------------------------------------------------
  async loadNotifications() {
    try {
      const res = await API.get('/api/notifications');
      const notifs = res.notifications || [];
      const unreadCount = res.unreadCount || 0;

      const badge = document.getElementById('notif-badge');
      if (badge) {
        badge.textContent = unreadCount;
        badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
      }

      const listEl = document.getElementById('notifications-popover-list');
      if (listEl) {
        if (notifs.length === 0) {
          listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px 0;">No notifications</div>';
          return;
        }

        listEl.innerHTML = notifs.map(n => `
          <div class="notif-item ${n.isRead ? '' : 'unread'}" id="notif-item-${n.id}">
            <img src="${n.senderAvatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=user'}" class="notif-avatar" alt="Avatar">
            <div class="notif-content">
              <div class="notif-text"><strong>${this.escapeHTML(n.senderName)}</strong> ${this.escapeHTML(n.message)}</div>
              <div class="notif-time">${n.createdAt}</div>
              ${n.type === 'FRIEND_REQUEST' && n.actionStatus === 'pending' ? `
                <div class="notif-actions">
                  <button class="btn-notif-accept" data-notif-id="${n.id}" data-sender-id="${n.senderId}">Accept</button>
                  <button class="btn-notif-reject" data-notif-id="${n.id}" data-sender-id="${n.senderId}">Reject</button>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('');

        // Attach Accept/Reject handlers
        listEl.querySelectorAll('.btn-notif-accept').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nId = btn.getAttribute('data-notif-id');
            const sId = btn.getAttribute('data-sender-id');
            await API.post('/api/friends/respond', { notificationId: nId, senderId: sId, action: 'accept' });
            btn.parentElement.innerHTML = '<span style="font-size: 11px; font-weight: 700; color: var(--accent-green);">Friend Request Accepted</span>';
          });
        });

        listEl.querySelectorAll('.btn-notif-reject').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nId = btn.getAttribute('data-notif-id');
            const sId = btn.getAttribute('data-sender-id');
            await API.post('/api/friends/respond', { notificationId: nId, senderId: sId, action: 'reject' });
            btn.parentElement.innerHTML = '<span style="font-size: 11px; font-weight: 700; color: var(--text-light);">Declined</span>';
          });
        });
      }

      // Bell popover toggle
      document.getElementById('btn-top-notif')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const popover = document.getElementById('notifications-popover');
        popover?.classList.toggle('active');
        if (popover?.classList.contains('active')) {
          API.post('/api/notifications/read').then(() => {
            if (badge) badge.style.display = 'none';
          });
        }
      });

      document.addEventListener('click', () => {
        document.getElementById('notifications-popover')?.classList.remove('active');
      });

    } catch (e) {
      console.error('Failed to load notifications:', e);
    }
  },

  // -----------------------------------------------------------
  // 300MS DEBOUNCED SEARCH UTILITY ENGINE
  // -----------------------------------------------------------
  bindSearch() {
    const input = document.getElementById('topbar-search-input');
    const dropdown = document.getElementById('search-results-dropdown');
    if (!input || !dropdown) return;

    const performSearch = API.debounce(async (query) => {
      query = query.trim();
      if (!query) {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
        return;
      }

      try {
        const res = await API.get(`/api/search?q=${encodeURIComponent(query)}`);
        const { users = [], posts = [], events = [] } = res;

        if (users.length === 0 && posts.length === 0 && events.length === 0) {
          dropdown.innerHTML = '<div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 13px;">No results found</div>';
          dropdown.classList.add('active');
          return;
        }

        let html = '';

        if (users.length > 0) {
          html += `<div class="search-result-group-title">People (${users.length})</div>`;
          users.forEach(u => {
            html += `
              <div class="search-item search-item-user" data-user-id="${u.id}">
                <img src="${u.avatar}" class="search-item-avatar" alt="${this.escapeHTML(u.name)}">
                <div class="search-item-info">
                  <div class="search-item-title">${this.escapeHTML(u.name)}</div>
                  <div class="search-item-subtitle">@${this.escapeHTML(u.handle)} • ${u.location || ''}</div>
                </div>
              </div>
            `;
          });
        }

        if (posts.length > 0) {
          html += `<div class="search-result-group-title">Posts (${posts.length})</div>`;
          posts.forEach(p => {
            html += `
              <div class="search-item search-item-post" data-post-id="${p.id}">
                <div class="search-item-info">
                  <div class="search-item-title">${this.escapeHTML(p.authorName)}</div>
                  <div class="search-item-subtitle">${this.escapeHTML(p.caption.slice(0, 60))}...</div>
                </div>
              </div>
            `;
          });
        }

        if (events.length > 0) {
          html += `<div class="search-result-group-title">Events (${events.length})</div>`;
          events.forEach(ev => {
            html += `
              <div class="search-item search-item-event" data-event-id="${ev.id}">
                <div class="search-item-info">
                  <div class="search-item-title">📅 ${this.escapeHTML(ev.title)}</div>
                  <div class="search-item-subtitle">${this.escapeHTML(ev.date)} • ${this.escapeHTML(ev.location)}</div>
                </div>
              </div>
            `;
          });
        }

        dropdown.innerHTML = html;
        dropdown.classList.add('active');

        // Search item click triggers
        dropdown.querySelectorAll('.search-item-user').forEach(item => {
          item.addEventListener('click', () => {
            dropdown.classList.remove('active');
            input.value = '';
            this.switchView('profile');
          });
        });

        dropdown.querySelectorAll('.search-item-post').forEach(item => {
          item.addEventListener('click', () => {
            dropdown.classList.remove('active');
            input.value = '';
            this.switchView('feed');
            const postId = item.getAttribute('data-post-id');
            document.getElementById(`post-card-${postId}`)?.scrollIntoView({ behavior: 'smooth' });
          });
        });

        dropdown.querySelectorAll('.search-item-event').forEach(item => {
          item.addEventListener('click', () => {
            dropdown.classList.remove('active');
            input.value = '';
            this.switchView('events');
          });
        });

      } catch (e) {
        console.error('Search error:', e);
      }
    }, 300); // 300ms debounce

    input.addEventListener('input', (e) => performSearch(e.target.value));

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('active');
      }
    });
  },

  // -----------------------------------------------------------
  // SAVED POSTS CLEAN VIEW
  // -----------------------------------------------------------
  async loadSavedPosts() {
    const container = document.getElementById('saved-posts-stream');
    if (!container) return;

    try {
      const saved = await API.get('/api/posts/saved');
      const counterEl = document.getElementById('saved-count-badge');
      if (counterEl) counterEl.textContent = `${saved.length} Saved`;

      if (saved.length === 0) {
        container.innerHTML = `
          <div class="empty-state-box">
            <div class="empty-state-icon">🔖</div>
            <div class="empty-state-title">No Saved Posts</div>
            <div class="empty-state-desc">Posts you save will appear here for easy reference.</div>
            <button class="btn-primary" id="btn-explore-posts">Explore Posts</button>
          </div>
        `;
        document.getElementById('btn-explore-posts')?.addEventListener('click', () => {
          this.switchView('feed');
        });
        return;
      }

      container.innerHTML = saved.map(post => this.renderPostCardHTML(post)).join('');
      this.bindPostInteractions(container);
    } catch (e) {
      console.error('Failed to load saved posts:', e);
    }
  },

  // -----------------------------------------------------------
  // USER PROFILE VIEW & EDIT MODAL
  // -----------------------------------------------------------
  renderProfilePage() {
    const user = window.currentUser;
    if (!user) return;

    const coverBox = document.getElementById('profile-cover-display');
    const avatarImg = document.getElementById('profile-main-avatar');
    const nameEl = document.getElementById('profile-full-name');
    const handleEl = document.getElementById('profile-handle');
    const bioEl = document.getElementById('profile-bio');
    const statP = document.getElementById('profile-stat-posts');
    const statF = document.getElementById('profile-stat-followers');
    const statFo = document.getElementById('profile-stat-following');

    if (coverBox) coverBox.style.background = user.cover || 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)';
    if (avatarImg) avatarImg.src = user.avatar;
    if (nameEl) nameEl.textContent = user.name;
    if (handleEl) handleEl.textContent = `@${user.handle}`;
    if (bioEl) bioEl.textContent = user.bio;
    if (statP) statP.textContent = user.stats?.posts || 0;
    if (statF) statF.textContent = user.stats?.followers || '0';
    if (statFo) statFo.textContent = user.stats?.following || '0';

    // Render user posts in profile tab
    const userPosts = this.posts.filter(p => p.authorId === user.id);
    const feedTarget = document.getElementById('profile-posts-stream');
    if (feedTarget) {
      if (userPosts.length === 0) {
        feedTarget.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">No posts yet</div>';
      } else {
        feedTarget.innerHTML = userPosts.map(p => this.renderPostCardHTML(p)).join('');
        this.bindPostInteractions(feedTarget);
      }
    }
  },

  bindProfileEditor() {
    const btnOpenEdit = document.getElementById('btn-open-edit-profile');
    const modal = document.getElementById('edit-profile-modal');
    const btnClose = document.getElementById('btn-close-edit-profile');
    const form = document.getElementById('form-edit-profile');

    btnOpenEdit?.addEventListener('click', () => {
      const user = window.currentUser;
      document.getElementById('edit-name').value = user.name || '';
      document.getElementById('edit-handle').value = user.handle || '';
      document.getElementById('edit-bio').value = user.bio || '';
      modal.classList.add('active');
    });

    btnClose?.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('edit-name').value.trim();
      const handle = document.getElementById('edit-handle').value.trim();
      const bio = document.getElementById('edit-bio').value.trim();
      const cover = document.getElementById('edit-cover-gradient').value;

      try {
        const updated = await API.put('/api/users/profile', {
          name: name || window.currentUser.name,
          handle: handle || window.currentUser.handle,
          bio: bio || window.currentUser.bio,
          cover
        });

        window.currentUser = updated;
        this.syncUserInterface();
        this.renderProfilePage();
        modal.classList.remove('active');
      } catch (err) {
        alert('Failed to update profile: ' + err.message);
      }
    });

    // Profile Sub-navigation tabs [Posts | Media | Saved]
    document.querySelectorAll('.profile-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');

        const postsStream = document.getElementById('profile-posts-stream');
        if (tab === 'posts') {
          postsStream.style.display = 'block';
        } else if (tab === 'media') {
          postsStream.style.display = 'block';
          // Filter only posts with media
          const mediaPosts = this.posts.filter(p => p.authorId === window.currentUser?.id && p.mediaUrl);
          postsStream.innerHTML = mediaPosts.map(p => this.renderPostCardHTML(p)).join('');
          this.bindPostInteractions(postsStream);
        } else if (tab === 'saved') {
          // Verify verified owner check
          postsStream.style.display = 'block';
          this.loadSavedPosts();
        }
      });
    });
  },

  // -----------------------------------------------------------
  // WEBSOCKET BROADCAST LISTENERS
  // -----------------------------------------------------------
  bindSocketListeners() {
    // New Post Broadcast
    socketClient.on('NEW_POST', (data) => {
      if (data.post && data.post.authorId !== window.currentUser?.id) {
        this.posts.unshift(data.post);
        if (this.currentView === 'feed') {
          this.renderFeedPosts();
        }
      }
    });

    // Like Update Broadcast
    socketClient.on('LIKE_UPDATED', (data) => {
      const postCard = document.getElementById(`post-card-${data.postId}`);
      if (postCard) {
        const countLabel = postCard.querySelector('.like-count-label');
        if (countLabel) countLabel.textContent = data.likesCount;
        const summary = document.getElementById(`post-summary-${data.postId}`);
        if (summary) summary.textContent = data.likedBySummary;
      }
    });

    // Real-Time Comments Broadcast
    socketClient.on('NEW_COMMENT', (data) => {
      if (data.comment.userId !== window.currentUser?.id) {
        this.appendCommentToDOM(data.postId, data.comment);
      }
    });

    // Real-Time Notification Broadcast
    socketClient.on('NEW_NOTIFICATION', (data) => {
      const badge = document.getElementById('notif-badge');
      if (badge) {
        let count = parseInt(badge.textContent, 10) || 0;
        badge.textContent = count + 1;
        badge.style.display = 'inline-block';
      }
      this.loadNotifications();
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

// Bootstrap on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
