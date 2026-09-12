/**
 * Comprehensive Automated Test Suite
 * Validates all REST endpoints, WebSocket connectivity, local assets, and database integrity
 */

const http = require('node:http');

async function testEndpoints() {
  console.log('🧪 Running Social Networking Platform Automated Test Suite...\n');
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // 1. Test HTML
  const htmlRes = await fetch('http://localhost:3000/');
  const htmlText = await htmlRes.text();
  assert(htmlRes.status === 200, 'GET / returns 200 OK');
  assert(htmlText.includes('class="topbar"'), 'HTML contains Topbar container');
  assert(htmlText.includes('class="left-sidebar"'), 'HTML contains Left Sidebar');
  assert(htmlText.includes('class="center-workspace"'), 'HTML contains Center Workspace');
  assert(htmlText.includes('class="right-sidebar"'), 'HTML contains Right Sidebar');
  assert(htmlText.includes('id="story-viewer-modal"'), 'HTML contains Story Viewer Modal');
  assert(htmlText.includes('id="create-event-modal"'), 'HTML contains Create Event Modal');
  assert(htmlText.includes('id="edit-profile-modal"'), 'HTML contains Edit Profile Modal');

  // 2. Test Local Images (post_1.jpg to post_12.jpg)
  for (let i = 1; i <= 12; i++) {
    const imgRes = await fetch(`http://localhost:3000/images/post_${i}.jpg`);
    assert(imgRes.status === 200, `GET /images/post_${i}.jpg returns 200 (served locally)`);
    assert(imgRes.headers.get('content-type') === 'image/jpeg', `post_${i}.jpg has image/jpeg Content-Type`);
  }

  // 3. Test Feed Endpoint
  const feedRes = await fetch('http://localhost:3000/api/posts/feed?limit=5');
  const feedData = await feedRes.json();
  assert(feedRes.status === 200, 'GET /api/posts/feed returns 200');
  assert(feedData.posts && feedData.posts.length === 5, 'Returns 5 posts in page chunk');
  assert(feedData.posts[0].mediaUrl.startsWith('/images/post_'), 'Feed post explicitly maps to local image asset');

  // 4. Test Like Toggle
  const post1 = feedData.posts[0];
  const initialLikes = post1.likes.length;
  const likeRes = await fetch(`http://localhost:3000/api/posts/${post1.id}/like`, { method: 'POST' });
  const likeData = await likeRes.json();
  assert(likeRes.status === 200, 'POST /api/posts/:id/like returns 200');
  assert(typeof likeData.isLiked === 'boolean', 'Like response contains boolean isLiked');

  // 5. Test Comment Addition
  const commentRes = await fetch(`http://localhost:3000/api/posts/${post1.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Automated test comment: brilliant work!' })
  });
  const commentData = await commentRes.json();
  assert(commentRes.status === 201, 'POST /api/posts/:id/comments returns 201 Created');
  assert(commentData.text === 'Automated test comment: brilliant work!', 'Comment text persisted');

  // 6. Test Save / Bookmark
  const saveRes = await fetch(`http://localhost:3000/api/posts/${post1.id}/save`, { method: 'POST' });
  const saveData = await saveRes.json();
  assert(saveRes.status === 200, 'POST /api/posts/:id/save returns 200');
  assert(typeof saveData.isSaved === 'boolean', 'Save response contains boolean isSaved');

  // 7. Test Stories API (24h TTL)
  const storiesRes = await fetch('http://localhost:3000/api/stories');
  const storiesData = await storiesRes.json();
  assert(storiesRes.status === 200, 'GET /api/stories returns 200');
  assert(Array.isArray(storiesData) && storiesData.length > 0, 'Active stories retrieved');
  assert(storiesData.every(s => s.expiresAt > Date.now()), 'All returned stories satisfy 24-hr TTL rule');

  // 8. Test Search Engine (Users, Posts, Events)
  const searchRes = await fetch('http://localhost:3000/api/search?q=Hamza');
  const searchData = await searchRes.json();
  assert(searchRes.status === 200, 'GET /api/search returns 200');
  assert(searchData.users.some(u => u.name.includes('Hamza')), 'Search returns matched user Hamza Ali');

  // 9. Test Create Event
  const eventRes = await fetch('http://localhost:3000/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Global AI & Web Developers Summit',
      date: 'Fri, Oct 10, 2026',
      time: '2:00 PM',
      location: 'Grand Convention Hall',
      category: 'Nearby',
      description: 'Annual gathering of engineers, creators, and product visionaries.'
    })
  });
  const eventData = await eventRes.json();
  assert(eventRes.status === 201, 'POST /api/events returns 201 Created');
  assert(eventData.title === 'Global AI & Web Developers Summit', 'Event title persisted');

  // 10. Test Event RSVP
  const rsvpRes = await fetch(`http://localhost:3000/api/events/${eventData.id}/rsvp`, { method: 'POST' });
  const rsvpData = await rsvpRes.json();
  assert(rsvpRes.status === 200, 'POST /api/events/:id/rsvp returns 200');
  assert(typeof rsvpData.isAttending === 'boolean', 'RSVP toggle returned isAttending');

  // 11. Test Chat Messaging
  const msgRes = await fetch('http://localhost:3000/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: 'conv_hamza',
      text: 'Testing real-time message stream'
    })
  });
  const msgData = await msgRes.json();
  assert(msgRes.status === 201, 'POST /api/messages returns 201 Created');
  assert(msgData.text === 'Testing real-time message stream', 'Message text persisted');

  // 12. Test Native WebSocket Connection
  await new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:3000/ws');
    ws.onopen = () => {
      assert(true, 'WebSocket connection established successfully on ws://localhost:3000/ws');
      ws.send(JSON.stringify({ type: 'IDENTIFY', userId: 'u_ayesha' }));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 500);
    };
    ws.onerror = (err) => {
      assert(false, 'WebSocket failed to connect: ' + err.message);
      resolve();
    };
  });

  console.log(`\n========================================`);
  console.log(`📊 Test Results: ${passed} / ${total} Passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`========================================\n`);
}

testEndpoints().catch(console.error);
