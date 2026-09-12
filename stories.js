/**
 * Interactive Stories Module
 * Auto-progress loops, 24-hr TTL checking, and view tracking
 */

const StoriesModule = {
  stories: [],
  currentIndex: 0,
  timer: null,
  progress: 0,
  isPaused: false,
  STORY_DURATION: 5000, // 5 seconds per story

  async init() {
    await this.loadStories();
    this.renderStoriesRow();
    this.bindEvents();

    // Listen for new story broadcasts
    socketClient.on('NEW_STORY', (data) => {
      this.stories.unshift(data.story);
      this.renderStoriesRow();
    });
  },

  async loadStories() {
    try {
      this.stories = await API.get('/api/stories');
    } catch (e) {
      console.error('Failed to load stories:', e);
      this.stories = [];
    }
  },

  renderStoriesRow() {
    const container = document.getElementById('stories-row');
    if (!container) return;

    let html = `
      <!-- Add Your Story -->
      <div class="story-item" id="btn-add-story">
        <div class="story-ring own-story">
          <img src="${window.currentUser?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ayesha'}" class="story-avatar" alt="Your story">
          <div class="story-add-badge">+</div>
        </div>
        <span class="story-name">Your story</span>
      </div>
    `;

    this.stories.forEach((story, idx) => {
      if (story.authorId === window.currentUser?.id && story.isOwn) {
        // Already shown as first item if own story exists
        return;
      }
      html += `
        <div class="story-item" data-index="${idx}">
          <div class="story-ring">
            <img src="${story.authorAvatar}" class="story-avatar" alt="${story.authorName}">
          </div>
          <span class="story-name">${story.authorName}</span>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach click triggers
    document.getElementById('btn-add-story')?.addEventListener('click', () => {
      this.openAddStoryModal();
    });

    container.querySelectorAll('.story-item[data-index]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        this.openViewer(idx);
      });
    });
  },

  openViewer(index) {
    if (index < 0 || index >= this.stories.length) return;
    this.currentIndex = index;
    const modal = document.getElementById('story-viewer-modal');
    modal.classList.add('active');

    this.showCurrentStory();
  },

  showCurrentStory() {
    const story = this.stories[this.currentIndex];
    if (!story) {
      this.closeViewer();
      return;
    }

    const avatarEl = document.getElementById('story-author-avatar');
    const nameEl = document.getElementById('story-author-name');
    const timeEl = document.getElementById('story-timestamp');
    const mediaEl = document.getElementById('story-media');
    const viewersEl = document.getElementById('story-viewers-count');

    if (avatarEl) avatarEl.src = story.authorAvatar;
    if (nameEl) nameEl.textContent = story.authorName;
    if (timeEl) timeEl.textContent = 'Active Story • 24h TTL';
    if (mediaEl) mediaEl.src = story.mediaUrl;
    if (viewersEl) viewersEl.textContent = `👁️ ${(story.views || []).length} Views`;

    // Record view asynchronously
    API.post(`/api/stories/${story.id}/view`).then(res => {
      if (res && res.viewsCount !== undefined) {
        story.views = res.views;
        if (viewersEl) viewersEl.textContent = `👁️ ${res.viewsCount} Views`;
      }
    }).catch(e => console.error(e));

    this.startProgress();
  },

  startProgress() {
    clearInterval(this.timer);
    this.progress = 0;
    const fillBar = document.getElementById('story-progress-fill');
    if (fillBar) fillBar.style.width = '0%';

    const step = 50; // update every 50ms
    const increment = (step / this.STORY_DURATION) * 100;

    this.timer = setInterval(() => {
      if (this.isPaused) return;
      this.progress += increment;
      if (fillBar) fillBar.style.width = `${Math.min(this.progress, 100)}%`;

      if (this.progress >= 100) {
        clearInterval(this.timer);
        this.nextStory();
      }
    }, step);
  },

  nextStory() {
    if (this.currentIndex < this.stories.length - 1) {
      this.currentIndex++;
      this.showCurrentStory();
    } else {
      this.closeViewer();
    }
  },

  prevStory() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.showCurrentStory();
    } else {
      this.startProgress();
    }
  },

  closeViewer() {
    clearInterval(this.timer);
    const modal = document.getElementById('story-viewer-modal');
    if (modal) modal.classList.remove('active');
  },

  openAddStoryModal() {
    const modal = document.getElementById('add-story-modal');
    if (modal) modal.classList.add('active');
  },

  async handleCreateStory(mediaUrl) {
    try {
      const story = await API.post('/api/stories', { mediaUrl });
      const modal = document.getElementById('add-story-modal');
      if (modal) modal.classList.remove('active');
      this.stories.unshift(story);
      this.renderStoriesRow();
    } catch (e) {
      alert('Failed to publish story: ' + e.message);
    }
  },

  bindEvents() {
    document.getElementById('story-btn-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.prevStory();
    });

    document.getElementById('story-btn-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nextStory();
    });

    document.getElementById('story-btn-close')?.addEventListener('click', () => {
      this.closeViewer();
    });

    // Pause on hold
    const mediaEl = document.getElementById('story-media');
    if (mediaEl) {
      mediaEl.addEventListener('mousedown', () => { this.isPaused = true; });
      mediaEl.addEventListener('mouseup', () => { this.isPaused = false; });
      mediaEl.addEventListener('touchstart', () => { this.isPaused = true; }, { passive: true });
      mediaEl.addEventListener('touchend', () => { this.isPaused = false; }, { passive: true });
    }

    // Add Story Form
    document.getElementById('form-add-story')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const select = document.getElementById('story-image-select');
      const mediaUrl = select ? select.value : '/images/post_1.jpg';
      this.handleCreateStory(mediaUrl);
    });

    document.getElementById('btn-close-add-story')?.addEventListener('click', () => {
      document.getElementById('add-story-modal')?.classList.remove('active');
    });
  }
};
