const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const url = require('node:url');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const IMAGES_DIR = path.join(__dirname, 'images');

// -------------------------------------------------------------
// Database Helper
// -------------------------------------------------------------
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return { currentUser: {}, users: [], posts: [], stories: [], events: [], conversations: [], messages: {}, notifications: [], friendships: [], follows: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing db.json:', err);
  }
}

// -------------------------------------------------------------
// MIME Types Dictionary
// -------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

// -------------------------------------------------------------
// WebSocket RFC-6455 Implementation (Standard Node.js)
// -------------------------------------------------------------
const wsClients = new Set();

function handleWebSocketUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(responseHeaders.join('\r\n'));

  const client = {
    socket,
    userId: null,
    isAlive: true
  };
  wsClients.add(client);

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const fin = (firstByte & 0x80) === 0x80;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) === 0x80;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (buffer.length < offset + 2) break;
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (buffer.length < offset + 8) break;
        const high = buffer.readUInt32BE(offset);
        const low = buffer.readUInt32BE(offset + 4);
        payloadLength = high * 2 ** 32 + low;
        offset += 8;
      }

      let mask = null;
      if (isMasked) {
        if (buffer.length < offset + 4) break;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + payloadLength) break;

      let payload = buffer.subarray(offset, offset + payloadLength);
      buffer = buffer.subarray(offset + payloadLength);

      if (isMasked && mask) {
        const unmasked = Buffer.alloc(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      // Handle Opcode
      if (opcode === 0x8) {
        // Close frame
        sendWebSocketClose(socket);
        cleanupClient(client);
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        sendWebSocketFrame(socket, 0xa, payload);
      } else if (opcode === 0x1) {
        // Text Frame
        const text = payload.toString('utf-8');
        try {
          const msg = JSON.parse(text);
          handleClientMessage(client, msg);
        } catch (e) {
          console.error('Invalid WS JSON:', e);
        }
      }
    }
  });

  socket.on('error', () => cleanupClient(client));
  socket.on('close', () => cleanupClient(client));
}

function cleanupClient(client) {
  if (wsClients.has(client)) {
    wsClients.delete(client);
    if (client.userId) {
      // Check if user has other active connections
      const hasOther = Array.from(wsClients).some(c => c.userId === client.userId);
      if (!hasOther) {
        const db = readDB();
        if (db.currentUser && db.currentUser.id === client.userId) {
          db.currentUser.isOnline = false;
          db.currentUser.lastSeen = 'Just now';
        }
        const user = db.users.find(u => u.id === client.userId);
        if (user) {
          user.isOnline = false;
          user.lastSeen = 'Just now';
        }
        writeDB(db);
        broadcast({
          type: 'PRESENCE_CHANGE',
          userId: client.userId,
          isOnline: false,
          lastSeen: 'Just now'
        });
      }
    }
  }
}

function sendWebSocketFrame(socket, opcode, payloadBuffer) {
  if (!socket.writable) return;
  const length = payloadBuffer.length;
  let header;

  if (length <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  socket.write(Buffer.concat([header, payloadBuffer]));
}

function sendWebSocketClose(socket) {
  if (!socket.writable) return;
  const frame = Buffer.from([0x88, 0x00]);
  socket.write(frame, () => socket.destroy());
}

function broadcast(msgObj) {
  const payload = Buffer.from(JSON.stringify(msgObj), 'utf-8');
  for (const client of wsClients) {
    sendWebSocketFrame(client.socket, 0x1, payload);
  }
}

function sendToUser(userId, msgObj) {
  const payload = Buffer.from(JSON.stringify(msgObj), 'utf-8');
  for (const client of wsClients) {
    if (client.userId === userId) {
      sendWebSocketFrame(client.socket, 0x1, payload);
    }
  }
}

function handleClientMessage(client, msg) {
  if (msg.type === 'IDENTIFY') {
    client.userId = msg.userId;
    const db = readDB();
    if (db.currentUser && db.currentUser.id === msg.userId) {
      db.currentUser.isOnline = true;
      db.currentUser.lastSeen = null;
    }
    const user = db.users.find(u => u.id === msg.userId);
    if (user) {
      user.isOnline = true;
      user.lastSeen = null;
    }
    writeDB(db);
    broadcast({
      type: 'PRESENCE_CHANGE',
      userId: msg.userId,
      isOnline: true,
      lastSeen: null
    });
  } else if (msg.type === 'PING') {
    sendWebSocketFrame(client.socket, 0x1, Buffer.from(JSON.stringify({ type: 'PONG' })));
  }
}

// -------------------------------------------------------------
// HTTP Utilities & Parsers
// -------------------------------------------------------------
function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// -------------------------------------------------------------
// Request Handler
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  try {
    // ---------------------------------------------------------
    // API ROUTES
    // ---------------------------------------------------------

    // 1. Current User Profile
    if (pathname === '/api/users/profile' && method === 'GET') {
      const db = readDB();
      return sendJSON(res, db.currentUser);
    }

    if (pathname === '/api/users/profile' && method === 'PUT') {
      const body = await parseJSONBody(req);
      const db = readDB();
      Object.assign(db.currentUser, body);
      writeDB(db);
      return sendJSON(res, db.currentUser);
    }

    // Get specific user by ID
    if (pathname.startsWith('/api/users/') && method === 'GET') {
      const userId = pathname.replace('/api/users/', '');
      const db = readDB();
      if (db.currentUser.id === userId) {
        return sendJSON(res, db.currentUser);
      }
      const user = db.users.find(u => u.id === userId);
      if (!user) return sendJSON(res, { error: 'User not found' }, 404);
      return sendJSON(res, user);
    }

    // 2. Posts Feed (Latest First, Cursor-based pagination)
    if (pathname === '/api/posts/feed' && method === 'GET') {
      const db = readDB();
      const cursor = parseInt(query.cursor, 10) || 0;
      const limit = parseInt(query.limit, 10) || 10;
      
      const posts = db.posts || [];
      const slice = posts.slice(cursor, cursor + limit);
      const nextCursor = (cursor + limit < posts.length) ? cursor + limit : null;

      return sendJSON(res, {
        posts: slice,
        nextCursor,
        total: posts.length
      });
    }

    // 3. Create Post
    if (pathname === '/api/posts' && method === 'POST') {
      const body = await parseJSONBody(req);
      const db = readDB();

      const newPost = {
        id: `post_${Date.now()}`,
        authorId: db.currentUser.id,
        authorName: db.currentUser.name,
        authorHandle: db.currentUser.handle,
        authorAvatar: db.currentUser.avatar,
        location: body.location || 'Lahore, Pakistan',
        createdAt: 'Just now',
        createdAtTimestamp: Date.now(),
        caption: body.caption || '',
        mediaUrl: body.mediaUrl || null,
        mediaType: body.mediaType || (body.mediaUrl ? 'image' : null),
        likes: [],
        likedBySummary: '0 likes',
        comments: [],
        sharesCount: 0,
        savedBy: []
      };

      db.posts.unshift(newPost);
      if (db.currentUser.stats && typeof db.currentUser.stats.posts === 'number') {
        db.currentUser.stats.posts++;
      }
      writeDB(db);

      // Real-time broadcast
      broadcast({ type: 'NEW_POST', post: newPost });

      return sendJSON(res, newPost, 201);
    }

    // 4. Like / Unlike Post (Compound Unique Index Rule postId + userId)
    if (pathname.match(/^\/api\/posts\/[^/]+\/like$/) && method === 'POST') {
      const postId = pathname.split('/')[3];
      const db = readDB();
      const currentUserId = db.currentUser.id;

      const post = db.posts.find(p => p.id === postId);
      if (!post) return sendJSON(res, { error: 'Post not found' }, 404);

      if (!post.likes) post.likes = [];
      const index = post.likes.indexOf(currentUserId);
      let isLiked = false;

      if (index === -1) {
        // Enforce compound uniqueness: insert only if not already present
        post.likes.push(currentUserId);
        isLiked = true;

        // Trigger real-time notification to author if author isn't self
        if (post.authorId !== currentUserId) {
          const notif = {
            id: `notif_${Date.now()}`,
            type: 'LIKE',
            receiverId: post.authorId,
            senderId: currentUserId,
            senderName: db.currentUser.name,
            senderAvatar: db.currentUser.avatar,
            referenceId: postId,
            message: 'liked your post',
            createdAt: 'Just now',
            isRead: false
          };
          db.notifications.unshift(notif);
          broadcast({ type: 'NEW_NOTIFICATION', notification: notif });
        }
      } else {
        // Unlike: remove record
        post.likes.splice(index, 1);
        isLiked = false;
      }

      // Update summary text
      if (post.likes.length === 0) {
        post.likedBySummary = '0 likes';
      } else if (post.likes.length === 1) {
        post.likedBySummary = 'Liked by 1 person';
      } else {
        post.likedBySummary = `Liked by Andrew and ${post.likes.length + 350} others`;
      }

      writeDB(db);

      const updateData = {
        type: 'LIKE_UPDATED',
        postId,
        likesCount: post.likes.length,
        likes: post.likes,
        isLiked,
        likedBySummary: post.likedBySummary
      };
      broadcast(updateData);

      return sendJSON(res, updateData);
    }

    // 5. Comments on Post (GET, POST, DELETE)
    if (pathname.match(/^\/api\/posts\/[^/]+\/comments$/) && method === 'GET') {
      const postId = pathname.split('/')[3];
      const db = readDB();
      const post = db.posts.find(p => p.id === postId);
      if (!post) return sendJSON(res, { error: 'Post not found' }, 404);
      return sendJSON(res, post.comments || []);
    }

    if (pathname.match(/^\/api\/posts\/[^/]+\/comments$/) && method === 'POST') {
      const postId = pathname.split('/')[3];
      const body = await parseJSONBody(req);
      const db = readDB();
      const post = db.posts.find(p => p.id === postId);
      if (!post) return sendJSON(res, { error: 'Post not found' }, 404);

      const newComment = {
        id: `c_${Date.now()}`,
        userId: db.currentUser.id,
        userName: db.currentUser.name,
        userAvatar: db.currentUser.avatar,
        text: body.text || '',
        createdAt: 'Just now'
      };

      if (!post.comments) post.comments = [];
      post.comments.push(newComment);

      // Notify post author if not self
      if (post.authorId !== db.currentUser.id) {
        const notif = {
          id: `notif_${Date.now()}`,
          type: 'COMMENT',
          receiverId: post.authorId,
          senderId: db.currentUser.id,
          senderName: db.currentUser.name,
          senderAvatar: db.currentUser.avatar,
          referenceId: postId,
          message: `commented: "${newComment.text.slice(0, 30)}..."`,
          createdAt: 'Just now',
          isRead: false
        };
        db.notifications.unshift(notif);
        broadcast({ type: 'NEW_NOTIFICATION', notification: notif });
      }

      writeDB(db);

      broadcast({
        type: 'NEW_COMMENT',
        postId,
        comment: newComment,
        commentsCount: post.comments.length
      });

      return sendJSON(res, newComment, 201);
    }

    if (pathname.match(/^\/api\/posts\/[^/]+\/comments\/[^/]+$/) && method === 'DELETE') {
      const parts = pathname.split('/');
      const postId = parts[3];
      const commentId = parts[5];
      const db = readDB();
      const post = db.posts.find(p => p.id === postId);
      if (!post) return sendJSON(res, { error: 'Post not found' }, 404);

      const cIndex = (post.comments || []).findIndex(c => c.id === commentId && c.userId === db.currentUser.id);
      if (cIndex === -1) return sendJSON(res, { error: 'Comment not found or unauthorized' }, 403);

      post.comments.splice(cIndex, 1);
      writeDB(db);

      broadcast({
        type: 'DELETE_COMMENT',
        postId,
        commentId,
        commentsCount: post.comments.length
      });

      return sendJSON(res, { success: true });
    }

    // 6. Save / Bookmark Post
    if (pathname.match(/^\/api\/posts\/[^/]+\/save$/) && method === 'POST') {
      const postId = pathname.split('/')[3];
      const db = readDB();
      const currentUserId = db.currentUser.id;
      const post = db.posts.find(p => p.id === postId);
      if (!post) return sendJSON(res, { error: 'Post not found' }, 404);

      if (!post.savedBy) post.savedBy = [];
      const sIndex = post.savedBy.indexOf(currentUserId);
      let isSaved = false;

      if (sIndex === -1) {
        post.savedBy.push(currentUserId);
        isSaved = true;
      } else {
        post.savedBy.splice(sIndex, 1);
        isSaved = false;
      }

      writeDB(db);
      return sendJSON(res, { postId, isSaved });
    }

    // Saved Posts List
    if (pathname === '/api/posts/saved' && method === 'GET') {
      const db = readDB();
      const currentUserId = db.currentUser.id;
      const savedPosts = (db.posts || []).filter(p => (p.savedBy || []).includes(currentUserId));
      return sendJSON(res, savedPosts);
    }

    // 7. Interactive Stories (24h TTL)
    if (pathname === '/api/stories' && method === 'GET') {
      const db = readDB();
      const now = Date.now();
      // Filter expired stories by 24h TTL rule
      const activeStories = (db.stories || []).filter(s => s.expiresAt > now);
      return sendJSON(res, activeStories);
    }

    if (pathname === '/api/stories' && method === 'POST') {
      const body = await parseJSONBody(req);
      const db = readDB();
      const now = Date.now();

      const newStory = {
        id: `story_${Date.now()}`,
        authorId: db.currentUser.id,
        authorName: db.currentUser.name,
        authorAvatar: db.currentUser.avatar,
        isOwn: true,
        mediaUrl: body.mediaUrl || '/images/post_1.jpg',
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000, // 24hr TTL
        views: []
      };

      db.stories.unshift(newStory);
      writeDB(db);
      broadcast({ type: 'NEW_STORY', story: newStory });
      return sendJSON(res, newStory, 201);
    }

    if (pathname.match(/^\/api\/stories\/[^/]+\/view$/) && method === 'POST') {
      const storyId = pathname.split('/')[3];
      const db = readDB();
      const story = db.stories.find(s => s.id === storyId);
      if (!story) return sendJSON(res, { error: 'Story not found' }, 404);

      if (!story.views) story.views = [];
      if (!story.views.includes(db.currentUser.id)) {
        story.views.push(db.currentUser.id);
        writeDB(db);
      }
      return sendJSON(res, { viewsCount: story.views.length, views: story.views });
    }

    // 8. Search Engine (Users, Posts, Events)
    if (pathname === '/api/search' && method === 'GET') {
      const q = (query.q || '').trim().toLowerCase();
      if (!q) return sendJSON(res, { users: [], posts: [], events: [] });

      const db = readDB();
      const matchedUsers = db.users.filter(u =>
        u.name.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q)
      );
      const matchedPosts = db.posts.filter(p =>
        p.caption.toLowerCase().includes(q) || p.authorName.toLowerCase().includes(q)
      ).slice(0, 5);
      const matchedEvents = db.events.filter(e =>
        e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q)
      ).slice(0, 5);

      return sendJSON(res, {
        users: matchedUsers,
        posts: matchedPosts,
        events: matchedEvents
      });
    }

    // 9. Friend Recommendations & Matrix
    if (pathname === '/api/friends/suggested' && method === 'GET') {
      const db = readDB();
      const currentUserId = db.currentUser.id;
      // Exclude current user and already accepted friends
      const acceptedFriendIds = db.friendships
        .filter(f => f.status === 'accepted' && (f.user1 === currentUserId || f.user2 === currentUserId))
        .map(f => (f.user1 === currentUserId ? f.user2 : f.user1));

      const pendingRequestIds = db.friendships
        .filter(f => f.status === 'pending' && f.requesterId === currentUserId)
        .map(f => (f.user1 === currentUserId ? f.user2 : f.user1));

      const suggested = db.users
        .filter(u => u.id !== currentUserId && !acceptedFriendIds.includes(u.id))
        .map(u => ({
          ...u,
          hasRequested: pendingRequestIds.includes(u.id)
        }));

      return sendJSON(res, suggested);
    }

    // Send Friend Request
    if (pathname === '/api/friends/request' && method === 'POST') {
      const body = await parseJSONBody(req);
      const targetUserId = body.userId;
      const db = readDB();
      const currentUserId = db.currentUser.id;

      // Check if relationship already exists
      let relation = db.friendships.find(f =>
        (f.user1 === currentUserId && f.user2 === targetUserId) ||
        (f.user1 === targetUserId && f.user2 === currentUserId)
      );

      if (!relation) {
        relation = {
          user1: currentUserId,
          user2: targetUserId,
          status: 'pending',
          requesterId: currentUserId
        };
        db.friendships.push(relation);

        // Notify target user
        const notif = {
          id: `notif_${Date.now()}`,
          type: 'FRIEND_REQUEST',
          receiverId: targetUserId,
          senderId: currentUserId,
          senderName: db.currentUser.name,
          senderAvatar: db.currentUser.avatar,
          message: 'sent you a friend request',
          createdAt: 'Just now',
          isRead: false,
          actionStatus: 'pending'
        };
        db.notifications.unshift(notif);
        broadcast({ type: 'NEW_NOTIFICATION', notification: notif });
      }

      writeDB(db);
      return sendJSON(res, { success: true, status: relation.status });
    }

    // Respond to Friend Request (Accept / Reject)
    if (pathname === '/api/friends/respond' && method === 'POST') {
      const body = await parseJSONBody(req);
      const { notificationId, senderId, action } = body;
      const db = readDB();
      const currentUserId = db.currentUser.id;

      const fIndex = db.friendships.findIndex(f =>
        ((f.user1 === currentUserId && f.user2 === senderId) ||
         (f.user1 === senderId && f.user2 === currentUserId)) &&
        f.status === 'pending'
      );

      if (action === 'accept') {
        if (fIndex !== -1) {
          db.friendships[fIndex].status = 'accepted';
        } else {
          db.friendships.push({
            user1: senderId,
            user2: currentUserId,
            status: 'accepted'
          });
        }

        // Notify sender that request was accepted
        const notif = {
          id: `notif_${Date.now()}`,
          type: 'REQUEST_ACCEPTED',
          receiverId: senderId,
          senderId: currentUserId,
          senderName: db.currentUser.name,
          senderAvatar: db.currentUser.avatar,
          message: 'accepted your friend request',
          createdAt: 'Just now',
          isRead: false
        };
        db.notifications.unshift(notif);
        broadcast({ type: 'NEW_NOTIFICATION', notification: notif });
      } else if (action === 'reject') {
        if (fIndex !== -1) {
          db.friendships.splice(fIndex, 1);
        }
      }

      // Update notification status if exists
      if (notificationId) {
        const targetNotif = db.notifications.find(n => n.id === notificationId);
        if (targetNotif) {
          targetNotif.actionStatus = action === 'accept' ? 'accepted' : 'rejected';
          targetNotif.isRead = true;
        }
      }

      writeDB(db);
      return sendJSON(res, { success: true, action });
    }

    // 10. One-Way Follow System
    if (pathname === '/api/friends/follow' && method === 'POST') {
      const body = await parseJSONBody(req);
      const targetUserId = body.userId;
      const db = readDB();
      const currentUserId = db.currentUser.id;

      if (!db.follows) db.follows = [];
      const fIndex = db.follows.findIndex(f => f.followerId === currentUserId && f.followingId === targetUserId);
      let isFollowing = false;

      if (fIndex === -1) {
        db.follows.push({ followerId: currentUserId, followingId: targetUserId });
        isFollowing = true;
      } else {
        db.follows.splice(fIndex, 1);
        isFollowing = false;
      }

      writeDB(db);
      return sendJSON(res, { targetUserId, isFollowing });
    }

    // 11. Messenger Conversations & Messages
    if (pathname === '/api/conversations' && method === 'GET') {
      const db = readDB();
      const currentUserId = db.currentUser.id;
      // Enrich conversations with partner details
      const enriched = (db.conversations || []).map(conv => {
        const partner = db.users.find(u => u.id === conv.partnerId) || {};
        return {
          ...conv,
          partnerName: partner.name || 'User',
          partnerAvatar: partner.avatar || '',
          partnerHandle: partner.handle || '',
          isOnline: partner.isOnline || false,
          lastSeen: partner.lastSeen || null
        };
      });
      return sendJSON(res, enriched);
    }

    if (pathname.match(/^\/api\/messages\/[^/]+$/) && method === 'GET') {
      const convId = pathname.split('/')[3];
      const db = readDB();
      const messages = (db.messages && db.messages[convId]) || [];
      return sendJSON(res, messages);
    }

    if (pathname === '/api/messages' && method === 'POST') {
      const body = await parseJSONBody(req);
      const { conversationId, text } = body;
      const db = readDB();
      const currentUserId = db.currentUser.id;

      if (!db.messages) db.messages = {};
      if (!db.messages[conversationId]) db.messages[conversationId] = [];

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const newMsg = {
        id: `m_${Date.now()}`,
        senderId: currentUserId,
        text,
        timestamp: timeStr
      };

      db.messages[conversationId].push(newMsg);

      // Update conversation ledger snippet
      let conv = (db.conversations || []).find(c => c.id === conversationId);
      if (conv) {
        conv.lastMessage = text;
        conv.lastMessageTimestamp = timeStr;
      }

      writeDB(db);

      // Real-time broadcast
      broadcast({
        type: 'NEW_MESSAGE',
        conversationId,
        message: newMsg
      });

      return sendJSON(res, newMsg, 201);
    }

    // 12. Events Engine (List, Create, RSVP)
    if (pathname === '/api/events' && method === 'GET') {
      const db = readDB();
      const cat = query.category || 'All';
      let events = db.events || [];
      if (cat !== 'All') {
        events = events.filter(e => e.category === cat);
      }
      return sendJSON(res, events);
    }

    if (pathname === '/api/events' && method === 'POST') {
      const body = await parseJSONBody(req);
      const db = readDB();

      const newEvent = {
        id: `ev_${Date.now()}`,
        title: body.title || 'Untitled Event',
        description: body.description || '',
        date: body.date || 'Soon',
        time: body.time || '12:00 PM',
        location: body.location || 'Online',
        category: body.category || 'Nearby',
        attendeesCount: 1,
        attendees: [db.currentUser.id],
        banner: body.banner || '/images/post_4.jpg'
      };

      db.events.unshift(newEvent);
      writeDB(db);

      broadcast({ type: 'NEW_EVENT', event: newEvent });
      return sendJSON(res, newEvent, 201);
    }

    if (pathname.match(/^\/api\/events\/[^/]+\/rsvp$/) && method === 'POST') {
      const eventId = pathname.split('/')[3];
      const db = readDB();
      const event = db.events.find(e => e.id === eventId);
      if (!event) return sendJSON(res, { error: 'Event not found' }, 404);

      if (!event.attendees) event.attendees = [];
      const currentUserId = db.currentUser.id;
      const index = event.attendees.indexOf(currentUserId);
      let isAttending = false;

      if (index === -1) {
        event.attendees.push(currentUserId);
        event.attendeesCount = (event.attendeesCount || 0) + 1;
        isAttending = true;
      } else {
        event.attendees.splice(index, 1);
        event.attendeesCount = Math.max(0, (event.attendeesCount || 1) - 1);
        isAttending = false;
      }

      writeDB(db);
      broadcast({
        type: 'EVENT_RSVP_UPDATED',
        eventId,
        attendeesCount: event.attendeesCount,
        isAttending
      });

      return sendJSON(res, { eventId, attendeesCount: event.attendeesCount, isAttending });
    }

    // 13. Notifications Engine
    if (pathname === '/api/notifications' && method === 'GET') {
      const db = readDB();
      const currentUserId = db.currentUser.id;
      const notifs = (db.notifications || []).filter(n => !n.receiverId || n.receiverId === currentUserId);
      const unreadCount = notifs.filter(n => !n.isRead).length;
      return sendJSON(res, { notifications: notifs, unreadCount });
    }

    if (pathname === '/api/notifications/read' && method === 'POST') {
      const db = readDB();
      const currentUserId = db.currentUser.id;
      (db.notifications || []).forEach(n => {
        if (!n.receiverId || n.receiverId === currentUserId) {
          n.isRead = true;
        }
      });
      writeDB(db);
      return sendJSON(res, { success: true });
    }

    // ---------------------------------------------------------
    // STATIC ASSET SERVING
    // ---------------------------------------------------------

    let filePath;
    if (pathname === '/' || pathname === '/index.html') {
      filePath = path.join(__dirname, 'index.html');
    } else if (pathname.startsWith('/images/')) {
      const rel = pathname.replace('/images/', '');
      filePath = path.join(IMAGES_DIR, rel);
    } else {
      filePath = path.join(__dirname, pathname);
    }

    // Prevent directory traversal
    const safePath = path.normalize(filePath);
    if (!safePath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Access Forbidden');
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('File Not Found');
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'public, max-age=3600'
      });

      const readStream = fs.createReadStream(safePath);
      readStream.pipe(res);
    });

  } catch (err) {
    console.error('Server error on request:', req.url, err);
    sendJSON(res, { error: 'Internal Server Error', message: err.message }, 500);
  }
});

// Attach WebSocket Upgrade Handler
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url);
  if (parsedUrl.pathname === '/ws') {
    handleWebSocketUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Social Networking Platform running at http://localhost:${PORT}`);
  console.log(`⚡ WebSocket live sync endpoint at ws://localhost:${PORT}/ws`);
  console.log(`🖼️ Serving local post images from: ${IMAGES_DIR}`);
  console.log(`=======================================================`);
});
