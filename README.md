# Realtime Chat App

Ứng dụng chat thời gian thực xây dựng bằng NestJS (TypeScript), MongoDB, Redis và Socket.IO. Dự án gồm nhắn tin 1-1 và nhóm, gọi thoại/video qua WebRTC signaling, kết bạn, chặn người dùng, và cache dữ liệu bằng Redis để giảm số lần truy vấn MongoDB. Frontend dùng React + Vite + TypeScript.

---

## Quá trình xây dựng

Trước khi bắt tay vào code, Gemini được dùng để tìm hiểu công nghệ, luồng làm việc và các thuật toán cần dùng cho dự án (NestJS module/guard, Socket.IO, Redis cache pattern, WebRTC signaling). Trong quá trình code, Claude.ai hỗ trợ viết một số thuật toán phức tạp và refactor các đoạn code lặp lại, đồng thời viết 3 file `ARCHITECTURE.md`, `PROGRESS.md`, `RULES.md` đặt trong thư mục `mindmap/` để làm ngữ cảnh cho công cụ AI Antigravity khi generate code — file `RULES.md` mô tả stack và convention của dự án, `ARCHITECTURE.md` mô tả luồng và danh sách route/module, `PROGRESS.md` ghi lại trạng thái các phần đã hoàn thành. Phần Frontend sau đó được Claude.ai viết code theo đúng các quy tắc và tài nguyên đã cài đặt trong 3 file này, đồng thời cập nhật đồng nhất với socket event, API và luồng làm việc đã có ở Backend.

---

## Table of Contents

- [Dự án này làm được gì](#dự-án-này-làm-được-gì)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Database Schema](#database-schema)
- [Project Structure](#project-structure)
- [Application Workflows](#application-workflows)
  - [Authentication Flow (JWT + Refresh Token)](#1-authentication-flow-jwt--refresh-token)
  - [Guard Pipeline cho REST API](#2-guard-pipeline-cho-rest-api)
  - [Cache dữ liệu bằng Redis (Cache-aside pattern)](#3-cache-dữ-liệu-bằng-redis-cache-aside-pattern)
  - [Gửi và nhận tin nhắn realtime](#4-gửi-và-nhận-tin-nhắn-realtime)
  - [Cuộc gọi thoại/video qua WebRTC signaling](#5-cuộc-gọi-thoạivideo-qua-webrtc-signaling)
  - [Quản lý nhóm chat](#6-quản-lý-nhóm-chat)
  - [Kết bạn & Chặn người dùng](#7-kết-bạn--chặn-người-dùng)
  - [Upload file / ảnh / voice message](#8-upload-file--ảnh--voice-message)
- [API Routes Reference](#api-routes-reference)
- [Socket Events Reference](#socket-events-reference)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Cập nhật gần đây](#cập-nhật-gần-đây-tối-ưu-để-chạy-ổn-định-với-nhiều-người-dùng-hơn)

---

## Dự án này làm được gì

**Xác thực & tài khoản**

| Chức năng | Mô tả |
|---|---|
| Đăng ký / đăng nhập | JWT access token (15 phút) + refresh token (7 ngày), refresh token được băm bằng SHA-256 trước khi lưu DB |
| Refresh token | Cấp lại access token + refresh token mới, so sánh refresh token cũ bằng thuật toán so sánh không lộ thời gian xử lý (`timingSafeEqual`) thay vì so sánh chuỗi thường |
| Rate limit đăng nhập/đăng ký | Giới hạn 10 lần đăng ký/10 phút, 20 lần đăng nhập/phút, 30 lần refresh/phút cho mỗi IP bằng ThrottlerModule (số cũ 2-3-5 lần quá thấp, dễ tự khóa nhầm người dùng thật khi nhiều người dùng chung 1 mạng Wi-Fi/4G) |
| Hồ sơ cá nhân | Xem/sửa thông tin, avatar, bio, trạng thái (online/away/busy/offline), custom status message |
| Cài đặt riêng tư | Ai được xem lastSeen (everyone/friends/nobody), bật/tắt read receipt, bật/tắt hiển thị đang gõ |
| Tìm người dùng | Tìm theo số điện thoại hoặc theo tên (MongoDB text index) |

**Nhắn tin**

| Chức năng | Mô tả |
|---|---|
| Gửi tin nhắn | Text, file, ảnh/video, voice message, chia sẻ link kèm preview (title/description/ảnh lấy từ trang đích) |
| Trả lời tin nhắn | Reply tới một tin nhắn cụ thể |
| Chuyển tiếp tin nhắn | Forward tin nhắn (kèm file đính kèm) sang cuộc trò chuyện khác |
| Chỉnh sửa / Thu hồi | Sửa nội dung tin nhắn text, xóa cho mình hoặc xóa cho tất cả |
| Reaction | Thả emoji / bỏ thả emoji vào tin nhắn |
| Ghim tin nhắn | Ghim/bỏ ghim, xem danh sách tin đã ghim trong cuộc trò chuyện |
| Đã xem | Đánh dấu đã xem, đếm số tin chưa đọc theo từng cuộc trò chuyện |
| Nhắc tên (mention) | Gắn thẻ thành viên trong tin nhắn nhóm |
| Tìm kiếm tin nhắn | Tìm theo nội dung trong một cuộc trò chuyện (MongoDB text index) |

**Cuộc trò chuyện**

| Chức năng | Mô tả |
|---|---|
| Chat 1-1 | Tạo cuộc trò chuyện riêng giữa 2 người |
| Nhóm chat | Tạo nhóm, thêm/xóa thành viên, đổi vai trò (owner/admin/member), rời nhóm, giải tán nhóm |
| Yêu cầu vào nhóm | Gửi yêu cầu tham gia, admin duyệt/từ chối |
| Thông báo nhóm (announcement) | Ghim thông báo trong nhóm |
| Lưu trữ / Tắt thông báo | Archive cuộc trò chuyện, mute theo thời hạn tùy chọn |
| Xem media/file/link | Xem lại toàn bộ ảnh/video, file, link đã chia sẻ trong một cuộc trò chuyện |

**Gọi thoại/video**

| Chức năng | Mô tả |
|---|---|
| Gọi 1-1 | Khởi tạo, chấp nhận, từ chối, kết thúc, hủy cuộc gọi |
| WebRTC signaling | Trao đổi offer/answer/ICE candidate qua Socket.IO để 2 client kết nối trực tiếp (peer-to-peer) |
| Gọi nhóm | Bắt đầu, tham gia, rời, kết thúc cuộc gọi nhóm; theo dõi danh sách người đang trong cuộc gọi |
| Trạng thái cuộc gọi | Lưu trên Redis (không dùng biến in-memory), tự dọn sau 2 giờ nếu client crash không thoát cuộc gọi đúng cách |
| Lịch sử cuộc gọi | Ghi lại vào Message với loại `call` (trạng thái missed/cancelled/ended, thời lượng) |

**Kết bạn & quyền riêng tư**

| Chức năng | Mô tả |
|---|---|
| Gửi/nhận lời mời kết bạn | Kèm lời nhắn, chấp nhận/từ chối |
| Hủy kết bạn | — |
| Chặn người dùng | Chặn/bỏ chặn, danh sách đã chặn; chặn thì không gửi được tin nhắn 1-1 cho nhau |

**Realtime & tối ưu**

| Chức năng | Mô tả |
|---|---|
| Trạng thái online/offline | Cập nhật qua Socket.IO khi connect/disconnect |
| Đang gõ (typing indicator) | Emit khi bắt đầu/dừng gõ trong một cuộc trò chuyện |
| Cache Redis | Cache danh sách cuộc trò chuyện (TTL 30 giây) và từng trang tin nhắn (TTL 60 giây), tự invalidate khi có thay đổi |

---

## Tech Stack

### Backend

| Mục đích | Công nghệ |
|---|---|
| Framework | NestJS (TypeScript) |
| Database | MongoDB + Mongoose |
| Cache | Redis (ioredis) |
| Realtime | Socket.IO (`@nestjs/websockets`, `@nestjs/platform-socket.io`) |
| Xác thực | Passport (`local`, `jwt` strategy) + `@nestjs/jwt` + bcrypt |
| Rate limit | `@nestjs/throttler` |
| Upload | Multer + Cloudinary |
| Validate | `class-validator` + `class-transformer` (ValidationPipe global) |
| Link preview | `axios` + `cheerio` (crawl title/description/ảnh từ URL) |
| Nén phản hồi | `compression` (gzip middleware) |

### Frontend

| Mục đích | Công nghệ |
|---|---|
| Framework | React + TypeScript |
| Build tool | Vite |
| CSS | Tailwind CSS |
| HTTP client | Axios (có interceptor gắn token + retry khi 429) |
| Realtime client | socket.io-client |
| Thông báo UI | react-hot-toast |

---

## System Architecture

```
Client (React/Vite)
    │
    ├── HTTP (Axios) ──► NestJS REST API (prefix /api)
    │                        │
    │                        ├── Guard: JwtAuthGuard → BlockGuard →
    │                        │           ConversationParticipantGuard → MessageConversationGuard
    │                        ├── Controller → Service
    │                        ├── MongoDB (Mongoose) — dữ liệu chính
    │                        ├── Redis — cache conversation list & message pages
    │                        └── Cloudinary — lưu file/ảnh/voice
    │
    └── WebSocket (Socket.IO) ──► ChatGateway
                                     │
                                     ├── Xác thực bằng JWT trong handshake
                                     ├── Room: user:{userId}, conversation:{conversationId}
                                     ├── messageEmit / groupEmit / presenceEmit / callEmit services
                                     └── Redis — lưu trạng thái cuộc gọi (thay in-memory Map)
```

Rate limit toàn cục 15 request/30 giây (ThrottlerGuard gắn ở `APP_GUARD`), route auth có limit riêng chặt hơn.

---

## Database Schema

### `users`

```ts
{
  email: String,              // unique
  password: String,           // bcrypt hash, tự hash qua pre-save hook
  phoneNumber: String,        // unique
  name: String,
  avatar: String,
  bio: String,
  status: "online" | "away" | "busy" | "offline",
  customStatusMessage: String,
  privacy: {
    lastSeenVisibility: "everyone" | "friends" | "nobody",
    showReadReceipts: Boolean,
    showTypingIndicator: Boolean,
  },
  lastSeen: Date,
  refreshToken: String,       // SHA-256 hash, null nếu đã logout
  timestamps: true,
}
// Index: email (unique), phoneNumber (unique), name (text — tìm kiếm theo tên)
// toJSON transform: luôn ẩn password, refreshToken, phoneNumber khi trả về client
```

### `conversations`

```ts
{
  type: "private" | "group",
  name: String,                // null với private
  createdBy: ObjectId,          // ref User
  participants: [{
    userId: ObjectId,           // ref User
    role: "owner" | "admin" | "member",
    isArchived: Boolean,
    isMuted: Boolean,
    mutedUntil: Date,
  }],
  deletedUser: [ObjectId],      // user đã "xóa" cuộc trò chuyện phía mình
  lastMessage: ObjectId,        // ref Message
  timestamps: true,
}
// Index: {_id, participants.userId}, {type, participants.userId},
//        {type, name, participants.userId}, {participants.userId, updatedAt}
```

### `messages`

```ts
{
  conversationId: ObjectId,     // ref Conversation
  senderId: ObjectId,           // ref User
  content: String,
  type: "text" | "file" | "media" | "voice" | "forward" | "system" | "call",
  reactions: [{ userId: ObjectId, emoji: String }],
  replyTo: ObjectId,            // ref Message
  isEdited: Boolean,
  editedAt: Date,
  mentions: [ObjectId],         // ref User
  seenBy: [ObjectId],           // ref User
  isDeleted: Boolean,
  deletedFor: [ObjectId],       // xóa chỉ phía những user này
  isPinned: Boolean,
  pinByUser: ObjectId,
  pinnedAt: Date,
  forwardedFrom: ObjectId,      // ref Message gốc
  callInfo: {
    callType: "voice" | "video",
    status: "missed" | "cancelled" | "ended" | "started",
    duration: Number,           // giây
    startedAt: Date,
    endedAt: Date,
    participants: [ObjectId],
  },
  timestamps: true,
}
// Index: {conversationId, createdAt}, {conversationId, isPinned},
//        {conversationId, deletedFor, createdAt}, {conversationId, seenBy},
//        {reactions.userId}, {content: "text"},
//        {conversationId, isDeleted, createdAt}, {conversationId, type, createdAt}
```

### `attachments`

```ts
{
  messageId: ObjectId,
  conversationId: ObjectId,
  uploaderId: ObjectId,
  type: "image" | "video" | "file" | "voice",
  publicId: String,             // Cloudinary public id
  url: String,
  thumbnail: String,
  filename: String,
  originalName: String,
  size: Number,
  mimeType: String,
  duration: Number,             // cho voice message
}
// Index: {conversationId}, {messageId}
```

### `friendrequests`

```ts
{
  from: ObjectId,
  to: ObjectId,
  message: String,
  status: "pending" | "accepted" | "rejected",
  timestamps: true,
}
// Index: {from, to} unique, {to, status, updatedAt}, {from, status, updatedAt}
```

### `blockedusers`

```ts
{ blockerId: ObjectId, blockedId: ObjectId }
// Index: {blockerId, blockedId} unique, {blockerId}
```

### `announcements`

```ts
{
  conversationId: ObjectId,
  content: String,
  pinnedBy: ObjectId,
  status: "active" | "inactive",
}
// Index: {conversationId, createdAt}, {pinnedBy, createdAt}, {conversationId, status}
```

### `linkpreviews`

```ts
{
  messageId: ObjectId,
  conversationId: ObjectId,
  senderId: ObjectId,
  url: String,
  title: String,
  description: String,
  image: String,
}
```

### `requestjoinrooms`

```ts
{
  userId: ObjectId,
  status: "pending" | "accept" | "reject",
  actor: ObjectId,               // người xử lý yêu cầu
  conversationId: ObjectId,
  description: String,
}
// Index: {conversationId, createdAt}
// Index: {userId, conversationId} unique CHỈ áp dụng khi status = "pending"
//        (partialFilterExpression — cho phép cùng 1 user gửi lại yêu cầu mới
//         sau khi yêu cầu cũ đã được accept/reject)
```

---

## Project Structure

```
Project-chat-realtime-backend/
├── mindmap/
│   ├── RULES.md                      # Stack, convention, quy tắc làm việc với AI
│   ├── ARCHITECTURE.md               # Luồng tổng quan, danh sách route theo module
│   └── PROGRESS.md                   # Trạng thái các phần đã hoàn thành
│
├── backend/
│   ├── src/
│   │   ├── main.ts                   # Bootstrap NestJS, CORS, global prefix /api, ValidationPipe
│   │   ├── app.module.ts             # Import tất cả module, đăng ký ThrottlerGuard toàn cục
│   │   │
│   │   ├── config/
│   │   │   └── db.config.ts          # Cấu hình kết nối MongoDB
│   │   │
│   │   ├── common/decorators/
│   │   │   ├── user.decorator.ts     # @User() — lấy req.user (UserDocument đầy đủ)
│   │   │   └── jwt.decorator.ts      # @JwtDecode() — lấy payload JWT đã decode (JwtType)
│   │   │
│   │   ├── gateway/
│   │   │   ├── chat.gateway.ts       # Xử lý toàn bộ socket event (connect, message, call...)
│   │   │   ├── chat.module.ts
│   │   │   ├── gateway.constants.ts  # SOCKET_EVENTS — tên toàn bộ event server emit
│   │   │   ├── gateway.rooms.ts      # Quy ước đặt tên room: user:{id}, conversation:{id}
│   │   │   └── services/
│   │   │       ├── messageEmit.service.ts    # emit các event liên quan tin nhắn
│   │   │       ├── groupEmit.service.ts      # emit các event liên quan nhóm
│   │   │       ├── presenceEmit.service.ts   # emit online/offline/typing
│   │   │       └── callEmit.service.ts       # emit các event liên quan cuộc gọi
│   │   │
│   │   ├── module/
│   │   │   ├── auth/
│   │   │   │   ├── auth.controller.ts        # register, login, refresh, logout
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── dto/  inputRegister.dto.ts, login.dto.ts, register.dto.ts
│   │   │   │   ├── guards/  jwt-auth.guard.ts, local-auth.guard.ts
│   │   │   │   └── strategies/  jwt.strategies.ts, local.strategies.ts
│   │   │   │
│   │   │   ├── user/
│   │   │   │   ├── user.controller.ts
│   │   │   │   ├── user.service.ts
│   │   │   │   ├── user.module.ts
│   │   │   │   ├── schema/  user.schema.ts, blockedUser.schema.ts
│   │   │   │   ├── guard/block.guard.ts      # Chặn thao tác giữa 2 user đã block nhau
│   │   │   │   └── dto/  findUserByName, findUserByPhoneNumber, paramUserId,
│   │   │   │             updatePrivacy, updateProfile, updateStatus (6 DTO)
│   │   │   │
│   │   │   ├── conversation/
│   │   │   │   ├── conversation.controller.ts   # 23 endpoint (xem API Reference)
│   │   │   │   ├── conversation.service.ts
│   │   │   │   ├── conversation.module.ts
│   │   │   │   ├── schema/conversation.schema.ts
│   │   │   │   ├── guard/  conversationParticipant.guard.ts, messageConversation.guard.ts
│   │   │   │   └── dto/  addMember, announcement, changeRole, conversationId,
│   │   │   │             createGroup, createPrivate, handleRequest, isArchived,
│   │   │   │             muteDuration, removeMember (9 DTO)
│   │   │   │
│   │   │   ├── message/
│   │   │   │   ├── message.controller.ts        # 15 endpoint (xem API Reference)
│   │   │   │   ├── message.service.ts
│   │   │   │   ├── message.module.ts
│   │   │   │   ├── schema/message.schema.ts
│   │   │   │   └── dto/  callMessage, createMessage, deleteMessage, editMessage,
│   │   │   │             forwardMessage, linkPreview, pagination, pinMessage,
│   │   │   │             queryDeleteMessage, reactEmoji, search, unreactEmoji,
│   │   │   │             uploadFiles (13 DTO)
│   │   │   │
│   │   │   ├── friend/
│   │   │   │   ├── friend.controller.ts
│   │   │   │   ├── friend.service.ts
│   │   │   │   ├── friend.module.ts
│   │   │   │   ├── schema/friendRequest.schema.ts
│   │   │   │   └── dto/  FindByNameDto, findByPhone, requestRequest, sendRequest, unfriend
│   │   │   │
│   │   │   ├── attachment/
│   │   │   │   ├── attachment.service.ts       # groupAttachmentsById — gom theo messageId
│   │   │   │   ├── attachment.module.ts
│   │   │   │   └── schema/attachment.schema.ts
│   │   │   │
│   │   │   ├── announcements/
│   │   │   │   ├── announcement.service.ts
│   │   │   │   ├── announcement.module.ts
│   │   │   │   └── schema/announcement.schema.ts
│   │   │   │
│   │   │   ├── link-preview/
│   │   │   │   ├── link-preview.service.ts     # axios + cheerio crawl meta tag
│   │   │   │   ├── link-preview.module.ts
│   │   │   │   └── schema/link-preview.schema.ts
│   │   │   │
│   │   │   └── requestJoinRoom/
│   │   │       ├── requestJoinRoom.service.ts
│   │   │       ├── requestJoinRoom.module.ts
│   │   │       └── schema/requestJoinRoom.schema.ts
│   │   │
│   │   ├── shared/
│   │   │   ├── redis/
│   │   │   │   ├── redis.module.ts       # Khởi tạo ioredis client (Global module)
│   │   │   │   ├── redisCache.service.ts # Cache conversation list & message pages
│   │   │   │   └── redisCall.service.ts  # Lưu trạng thái cuộc gọi
│   │   │   ├── cloud/
│   │   │   │   ├── cloud.service.ts      # Upload lên Cloudinary
│   │   │   │   ├── cloud.module.ts
│   │   │   │   └── cloud.types.ts
│   │   │   ├── upload/
│   │   │   │   ├── upload.module.ts
│   │   │   │   ├── upload.config.ts      # Cấu hình Multer (memory storage)
│   │   │   │   ├── upload.constants.ts   # Giới hạn dung lượng, loại file
│   │   │   │   └── file-filter.ts        # Lọc mimetype hợp lệ theo loại tin nhắn
│   │   │   ├── helpers/convertObjectId.helpers.ts
│   │   │   ├── utils/extractUrl.util.ts  # Regex trích URL hợp lệ từ nội dung tin nhắn
│   │   │   └── types/jwtTypes.type.ts
│   │   │
│   │   └── (common/decorators đã liệt kê ở trên)
│   │
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
│
└── frontend/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx                       # Định nghĩa route, bọc AuthProvider + SocketProvider
    │   │
    │   ├── context/
    │   │   ├── AuthContext.tsx           # Quản lý user hiện tại + access/refresh token
    │   │   └── SocketContext.tsx         # Khởi tạo & cung cấp socket instance dùng chung
    │   │
    │   ├── services/                     # Gọi REST API qua Axios
    │   │   ├── authService.ts            # + interceptor gắn token, retry khi 429
    │   │   ├── conversationService.ts
    │   │   ├── messageService.ts
    │   │   ├── friendService.ts
    │   │   └── userService.ts
    │   │
    │   ├── hooks/                        # Lắng nghe socket event, đồng bộ vào state UI
    │   │   ├── useMessageSocket.ts       # new_message, message_edited, message_deleted...
    │   │   ├── useConversationSocket.ts  # group_created, member_added, conversation_updated...
    │   │   ├── useFriendSocket.ts        # friend_request_received/accepted/rejected
    │   │   ├── useCallSocket.ts          # call 1-1: initiated/accepted/rejected/ended...
    │   │   ├── useGroupCallSocket.ts     # group_call_started/joined/left/ended
    │   │   └── useGlobalNotifications.tsx
    │   │
    │   ├── components/
    │   │   ├── Auth/
    │   │   │   ├── LoginForm.tsx
    │   │   │   └── RegisterForm.tsx
    │   │   ├── chat/
    │   │   │   ├── SidebarPrimary.tsx        # Thanh điều hướng chính (conversations/contacts/settings)
    │   │   │   ├── SidebarSecondary.tsx      # Danh sách hội thoại / danh bạ theo tab
    │   │   │   ├── ConversationPanel.tsx     # Khung hiển thị 1 cuộc trò chuyện
    │   │   │   ├── ChatArea.tsx              # Khung nhập & hiển thị tin nhắn
    │   │   │   ├── MessageErrorBoundary.tsx  # Error boundary riêng cho khu vực chat
    │   │   │   ├── ContactsView.tsx          # Danh sách bạn bè / lời mời kết bạn
    │   │   │   ├── ProfileView.tsx           # Xem hồ sơ (mình hoặc người khác)
    │   │   │   ├── UserProfileModal.tsx
    │   │   │   ├── SettingsModal.tsx         # Cài đặt riêng tư, trạng thái
    │   │   │   ├── AddFriendModal.tsx
    │   │   │   ├── AddMemberModal.tsx
    │   │   │   ├── CreateGroupModal.tsx
    │   │   │   ├── CreatePrivateChatModal.tsx
    │   │   │   ├── CallModal.tsx             # Giao diện cuộc gọi 1-1 (WebRTC)
    │   │   │   ├── GroupCallModal.tsx        # Giao diện cuộc gọi nhóm
    │   │   │   └── VoiceMessagePlayer.tsx    # Phát lại voice message
    │   │   └── ui/
    │   │       ├── Avatar.tsx
    │   │       └── Modal.tsx
    │   │
    │   ├── layouts/ChatLayout.tsx
    │   ├── pages/
    │   │   ├── AuthPage.tsx
    │   │   ├── ChatPage.tsx
    │   │   ├── ChatContent.tsx
    │   │   ├── ChatPlaceholder.tsx           # Màn hình trống khi chưa chọn cuộc trò chuyện
    │   │   └── ContactsPage.tsx
    │   │
    │   ├── types/index.ts                    # Type dùng chung: User, Message, Conversation...
    │   └── index.css
    ├── public/                            # favicon.svg, icons.svg, ảnh nền trang auth
    ├── index.html
    ├── vite.config.ts
    └── package.json
```

---

## Application Workflows

### 1. Authentication Flow (JWT + Refresh Token)

```
POST /api/auth/register  (giới hạn 10 lần/10 phút cho mỗi IP)
  ├─→ Kiểm tra email và số điện thoại chưa tồn tại
  ├─→ Kiểm tra password === passwordConfirm
  └─→ Tạo User (password tự hash qua pre-save hook của schema)

POST /api/auth/login  (giới hạn 20 lần/phút cho mỗi IP, qua LocalAuthGuard)
  ├─→ validateUser(): tìm theo email, bcrypt.compare password
  ├─→ Tạo accessToken (payload: sub, name, avatar, email — hết hạn 15 phút)
  ├─→ Tạo refreshToken (thêm jti random để mỗi token là duy nhất — hết hạn 7 ngày)
  ├─→ SHA-256(refreshToken) trước khi lưu vào User.refreshToken
  └─→ Trả về { accessToken, refreshToken, user }

POST /api/auth/refresh  (giới hạn 30 lần/phút cho mỗi IP)
  ├─→ jwtService.verify(refreshToken, JWT_SECRET_REFRESH)
  ├─→ Tìm User theo payload.sub
  ├─→ So sánh SHA-256(refreshToken) với giá trị đã lưu bằng timingSafeEqual
  │     (giá trị cũ được hash bằng bcrypt trước đây vẫn được chấp nhận 1 lần
  │      rồi tự chuyển sang SHA-256 ở lần refresh kế tiếp)
  ├─→ Nếu hợp lệ: cấp accessToken + refreshToken mới, hash rồi lưu đè vào DB
  └─→ Nếu không khớp: 401 "Refresh token reused or invalid"

POST /api/auth/logout  (JwtAuthGuard)
  └─→ User.refreshToken = null

Socket.IO cũng xác thực bằng JWT: token gửi qua handshake.auth.token,
verify bằng cùng JWT_SECRET; nếu không hợp lệ thì client bị disconnect ngay
tại handleConnection.

Ghi chú: JwtStrategy nhớ tạm (trong bộ nhớ, 60 giây) những userId đã xác
nhận là còn tồn tại, để không phải truy vấn MongoDB ở mọi request có kèm
access token — chỉ truy vấn lại khi bản ghi nhớ đã hết hạn hoặc chưa có.
```

---

### 2. Guard Pipeline cho REST API

```
Request → JwtAuthGuard → BlockGuard → ConversationParticipantGuard → MessageConversationGuard → Controller

JwtAuthGuard
  └─→ Verify Bearer token, inject req.user = { userId, ... }

BlockGuard  (dùng cho route thao tác trên 1 conversation riêng)
  ├─→ Nếu conversation là group: bỏ qua, cho phép luôn
  └─→ Nếu là private: kiểm tra userService.isBlocked(mình, người còn lại)
        → nếu có block theo 1 trong 2 chiều: 403 Forbidden

ConversationParticipantGuard
  └─→ Kiểm tra user hiện tại có trong participants của conversation không
        → không có: 403 "User does not in private conversation"

MessageConversationGuard  (dùng cho route thao tác trên 1 message cụ thể)
  ├─→ Query song song: tìm Conversation + tìm Message
  └─→ Kiểm tra message.conversationId khớp với conversation đang thao tác
        → không khớp: 409 Conflict "message not in conversation!"

4 guard được áp dụng tùy route, không phải route nào cũng cần đủ cả 4 —
ví dụ route tạo tin nhắn mới cần Block + ConversationParticipant, còn route
sửa/xóa 1 message cụ thể cần thêm MessageConversationGuard.
```

---

### 3. Cache dữ liệu bằng Redis (Cache-aside pattern)

```
[Đọc dữ liệu — ví dụ lấy danh sách cuộc trò chuyện]

GET /api/conversations
  ├─→ 1. redisCacheService.getConversations(userId, archived)
  │       → có trong cache: trả về ngay, KHÔNG đụng MongoDB
  ├─→ 2. Cache miss:
  │       - Query MongoDB: participants.userId = mình, chưa xóa phía mình
  │       - Tính unreadCount bằng 1 aggregation pipeline duy nhất
  │         (getUnreadCountsPerConversation) — thay cho cách cũ lặp qua
  │         từng conversation để đếm riêng (đã sửa vì gây N+1 / full scan)
  └─→ 3. Lưu kết quả vào Redis với TTL 30 giây rồi mới trả về

[Lấy tin nhắn theo trang — cursor-based pagination]

GET /api/messages/:id?limit=20&before=<messageId>
  ├─→ 1. redisCacheService.getMessages(conversationId, limit, before)
  ├─→ 2. Cache miss: query MongoDB theo cursor (before), populate sender/replyTo/seenBy,
  │       gom attachment và link preview theo nhóm ID bằng 1 query duy nhất mỗi loại
  │       (groupAttachmentsById, groupLinkPreviewsById — không lặp query từng message)
  └─→ 3. Lưu vào Redis với TTL 60 giây

[Ghi dữ liệu — luôn đi thẳng MongoDB, sau đó xóa cache liên quan]

Gửi/sửa/xóa message, react, đánh dấu đã xem, thêm/xóa thành viên nhóm, ...
  └─→ invalidateAll(conversationId):
        1. Xóa toàn bộ cache message pages của conversation đó
        2. Lấy participants của conversation, xóa cache danh sách hội thoại
           (cả active lẫn archived) của TẤT CẢ participants cùng lúc bằng
           Redis pipeline — gộp nhiều lệnh xóa thành 1 round-trip

Lỗi khi thao tác với Redis được bắt và bỏ qua ở tầng cache — không để sự cố
Redis làm hỏng luồng chính (đọc/ghi vẫn hoạt động qua MongoDB nếu Redis down).
```

---

### 4. Gửi và nhận tin nhắn realtime

```
[Client A gửi tin nhắn]

POST /api/messages/:conversationId  { content, type, replyTo?, mentions? }
  ├─→ Guard: Jwt → Block → ConversationParticipant
  ├─→ Tạo Message trong MongoDB
  ├─→ invalidateAll(conversationId) — xóa cache liên quan
  └─→ chatGateway.server
        .to(gatewayRooms.conversation(conversationId))
        .emit(SOCKET_EVENTS.NEW_MESSAGE, message)

[Mọi client đang trong room conversation:{id} nhận ngay lập tức]

  Client join room này qua socket event "join_conversation" khi mở
  cuộc trò chuyện, và "leave_conversation" khi rời màn hình chat đó.

[Đang gõ]

Client emit "typing_start" / "typing_stop" { conversationId }
  └─→ Server broadcast lại cho các thành viên khác trong room đó
        (USER_TYPING / USER_STOPPED_TYPING), có kiểm tra
        privacy.showTypingIndicator trước khi báo cho người khác thấy.
```

---

### 5. Cuộc gọi thoại/video qua WebRTC signaling

```
Server chỉ làm nhiệm vụ "signaling" (chuyển tiếp thông tin kết nối),
không xử lý luồng audio/video — audio/video đi trực tiếp giữa 2 client
qua kết nối peer-to-peer (WebRTC) sau khi đã bắt tay xong.

GET /api/calls/ice-servers  (JwtAuthGuard)
  Trả về danh sách máy chủ STUN/TURN cho client dùng khi tạo
  RTCPeerConnection. STUN không cần cấu hình gì thêm (có sẵn giá trị mặc
  định), TURN cần khai báo qua biến môi trường TURN_URLS / TURN_USERNAME /
  TURN_CREDENTIAL — xem mục "Environment Variables" và phần "Giới hạn đã
  biết" bên dưới về lý do TURN quan trọng cho cuộc gọi giữa 2 mạng khác nhau.

[Gọi 1-1]

Client A: emit "call_initiate" { calleeId, callType }
  ├─→ Kiểm tra callee có đang bận (redisCallService.isUserInCall)
  │     → bận: emit "call_busy" về A
  ├─→ redisCallService.createCall(...) — lưu vào Redis, TTL 2 giờ
  ├─→ emit "call_initiated" tới room user:{calleeId}
  └─→ Đặt hẹn giờ đổ chuông 45 giây (RING_TIMEOUT_MS) — nếu callee không
        bắt máy/từ chối/huỷ trong thời gian này, cuộc gọi tự đóng ở cả 2
        phía và được ghi lại là "nhỡ", thay vì treo màn hình gọi vô thời hạn

Client B: emit "call_accept" { callId }
  ├─→ Huỷ hẹn giờ đổ chuông ở trên
  ├─→ redisCallService.setStartedAt(callId)
  ├─→ addParticipant(callId, B)
  └─→ emit "call_accepted" về A

[Trao đổi WebRTC signaling — chuyển tiếp qua Socket.IO]

call_offer → forward tới room user:{calleeId}
call_answer → forward tới room user:{callerId}
call_ice_candidate → forward tới người còn lại trong cuộc gọi

[Kết thúc]

call_end / call_cancel / call_reject
  ├─→ Huỷ hẹn giờ đổ chuông nếu còn (trường hợp kết thúc trước khi hết giờ)
  ├─→ deleteCall(callId, participantIds) trên Redis
  ├─→ Ghi lại Message type "call" với callInfo (status, duration)
  └─→ emit "call_ended" về phía còn lại

[Ngắt kết nối đột ngột — ví dụ tắt trình duyệt]

handleDisconnect trên gateway:
  ├─→ redisCallService.getUserCallId(userId) — tra xem user có đang trong call nào
  └─→ Nếu có: tự dọn participant/call giống như khi emit call_end
        (nếu không cleanup, TTL 2 giờ trên Redis vẫn tự xóa sau cùng)

[Gọi nhóm — chỉ hỗ trợ THOẠI, không có video]

group_call_start / group_call_join / group_call_leave / group_call_end
  ├─→ callType gửi lên bị ép về "voice" bất kể client gửi gì (xem phần
  │     "Giới hạn đã biết" bên dưới về lý do bỏ video nhóm)
  ├─→ redisCallService lưu theo callId + set các participant trong
  │     call:{callId}:members
  ├─→ setActiveGroupCall(conversationId, callId) — tránh tạo 2 cuộc gọi
  │     nhóm cùng lúc trong 1 conversation khi có người bấm gọi trùng lúc
  └─→ Emit group_call_started / joined / left / ended cho cả room conversation

[Giới hạn đã biết]

- Chỉ có STUN là chưa đủ để 2 máy ở 2 mạng khác nhau (ví dụ 2 nhà mạng 4G
  khác nhau, hoặc mạng có NAT/firewall chặt) tự tìm thấy nhau. Cần thêm một
  máy chủ TURN (miễn phí có thể dùng Cloudflare Calls, Metered.ca, hoặc tự
  dựng coturn) và khai báo qua TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL thì
  các trường hợp này mới gọi được ổn định — phần này KHÔNG thể giải quyết
  chỉ bằng code, cần một dịch vụ TURN thật.
- Gọi nhóm dùng kiến trúc "mesh" (n người thì mỗi người mở n-1 kết nối
  ngang hàng) — phù hợp cho nhóm nhỏ (khoảng dưới 6-8 người cùng lúc trong
  1 cuộc gọi). Nhóm rất đông gọi cùng lúc sẽ cần một máy chủ media (SFU)
  chuyên dụng, nằm ngoài phạm vi sửa đổi lần này.
```

---

### 6. Quản lý nhóm chat

```
POST /api/conversations/group  { name, memberIds }
  └─→ Tạo Conversation type "group", người tạo có role "owner"

PATCH /api/conversations/:id/members/add   { memberIds }
PATCH /api/conversations/:id/members/role   { userId, role }
DELETE /api/conversations/:id/members/remove
DELETE /api/conversations/:id/members/leave
DELETE /api/conversations/:id/disband        (chỉ owner)

[Yêu cầu tham gia nhóm]

  User ngoài nhóm gửi RequestJoinRoom (status "pending")
  Admin/owner xem GET /api/conversations/:id/requests
  PATCH /api/conversations/:id/request/handle  { requestId, action: accept|reject }
    → accept: thêm vào participants; reject: cập nhật status
    → Index unique {userId, conversationId} chỉ áp dụng khi status = pending,
      nên user có thể gửi yêu cầu mới sau khi yêu cầu cũ đã bị từ chối

[Archive / Mute]

POST /api/conversations/:id/archive    DELETE cùng path để bỏ archive
POST /api/conversations/:id/mute { duration }   DELETE để bỏ mute
  → Các trường này lưu riêng theo từng participant trong mảng participants,
    không ảnh hưởng tới người khác trong cùng conversation
```

---

### 7. Kết bạn & Chặn người dùng

```
POST /api/friends/request  { to, message }
  └─→ Tạo FriendRequest status "pending", emit FRIEND_REQUEST_RECEIVED tới người nhận

PATCH /api/friends/request/:id  { action: accept|reject }
  └─→ Cập nhật status, emit FRIEND_REQUEST_ACCEPTED / FRIEND_REQUEST_REJECTED

POST /api/users/block/:userId
  └─→ Tạo BlockedUser { blockerId, blockedId }
      Từ lúc này, BlockGuard sẽ chặn mọi thao tác gửi tin nhắn 1-1 giữa 2 người
      (kiểm tra cả 2 chiều: A chặn B hoặc B chặn A đều bị chặn như nhau)
```

---

### 8. Upload file / ảnh / voice message

```
POST /api/messages/:id/file    (multipart/form-data, Multer)
POST /api/messages/:id/media   (ảnh/video)
POST /api/messages/:id/voice   (voice message, kèm duration)
  ├─→ Multer nhận file vào buffer, filter theo loại file cho phép
  ├─→ cloud.service upload lên Cloudinary → nhận url, publicId, thumbnail
  ├─→ Tạo Attachment liên kết với Message vừa tạo
  └─→ invalidateAll(conversationId) + emit event tương ứng
        (NEW_MESSAGE_FILE / NEW_MESSAGE_MEDIA / NEW_MESSAGE_VOICE)

[Chia sẻ link — tự lấy preview]

  extractValidUrls() quét nội dung tin nhắn tìm URL hợp lệ
  → link-preview.service dùng axios tải trang đích, cheerio parse
    thẻ meta (og:title, og:description, og:image) để lấy title/description/ảnh
  → Lưu vào LinkPreview, gắn với Message, emit NEW_MESSAGE_LINK
```

---

## API Routes Reference

### Auth (`/api/auth`)

| Method | Path | Mô tả | Giới hạn |
|---|---|---|---|
| POST | `/api/auth/register` | Đăng ký | 10 lần/10 phút |
| POST | `/api/auth/login` | Đăng nhập | 20 lần/phút |
| POST | `/api/auth/refresh` | Làm mới access token | 30 lần/phút |
| POST | `/api/auth/logout` | Đăng xuất | Auth |

### Calls (`/api/calls`)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/calls/ice-servers` | Danh sách máy chủ STUN/TURN cho WebRTC |

### Health (`/api/health`)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | Kiểm tra server còn sống — không truy vấn DB, dùng cho dịch vụ ping định kỳ |

### Users (`/api/users`)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/users` | Danh sách người dùng |
| GET | `/api/users/find/phone` | Tìm theo số điện thoại |
| GET | `/api/users/find/name` | Tìm theo tên |
| GET | `/api/users/:userId/profile` | Xem hồ sơ người dùng khác |
| PATCH | `/api/users/edit/profile` | Sửa hồ sơ của tôi |
| PATCH | `/api/users/status` | Đổi trạng thái online/away/busy/offline |
| GET | `/api/users/privacy` | Xem cài đặt riêng tư |
| PATCH | `/api/users/privacy` | Sửa cài đặt riêng tư |
| POST | `/api/users/block/:userId` | Chặn người dùng |
| DELETE | `/api/users/block/:userId` | Bỏ chặn |
| GET | `/api/users/blocked` | Danh sách đã chặn |

### Friends (`/api/friends`)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/friends/request` | Gửi lời mời kết bạn |
| PATCH | `/api/friends/request/:id` | Chấp nhận/từ chối |
| GET | `/api/friends/requests` | Danh sách lời mời |
| GET | `/api/friends` | Danh sách bạn bè |
| DELETE | `/api/friends/:id` | Hủy kết bạn |
| GET | `/api/friends/find/phone` | Tìm theo số điện thoại |
| GET | `/api/friends/find/name` | Tìm theo tên |
| GET | `/api/friends/status/:userId` | Trạng thái quan hệ với 1 user |

### Conversations (`/api/conversations`)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/conversations` | Danh sách cuộc trò chuyện (cache Redis) |
| GET | `/api/conversations/list-user` | Danh sách user để bắt đầu chat |
| POST | `/api/conversations/private` | Tạo/mở chat 1-1 |
| POST | `/api/conversations/group` | Tạo nhóm |
| GET | `/api/conversations/:id/info` | Thông tin cuộc trò chuyện |
| GET | `/api/conversations/:id/info/media` | Media đã chia sẻ |
| GET | `/api/conversations/:id/info/file` | File đã chia sẻ |
| GET | `/api/conversations/:id/info/link-preview` | Link đã chia sẻ |
| DELETE | `/api/conversations/:id/remove` | Xóa cuộc trò chuyện (phía tôi) |
| PATCH | `/api/conversations/:id/members/add` | Thêm thành viên |
| DELETE | `/api/conversations/:id/members/remove` | Xóa thành viên |
| PATCH | `/api/conversations/:id/members/role` | Đổi vai trò thành viên |
| DELETE | `/api/conversations/:id/members/leave` | Rời nhóm |
| DELETE | `/api/conversations/:id/disband` | Giải tán nhóm |
| GET | `/api/conversations/:id/requests` | Danh sách yêu cầu tham gia |
| PATCH | `/api/conversations/:id/request/handle` | Duyệt/từ chối yêu cầu |
| POST | `/api/conversations/:id/announcement` | Tạo thông báo ghim |
| GET | `/api/conversations/:id/announcements` | Danh sách thông báo |
| GET | `/api/conversations/:id/pins` | Tin nhắn đã ghim |
| POST | `/api/conversations/:id/archive` | Lưu trữ |
| DELETE | `/api/conversations/:id/archive` | Bỏ lưu trữ |
| POST | `/api/conversations/:id/mute` | Tắt thông báo |
| DELETE | `/api/conversations/:id/mute` | Bật lại thông báo |

### Messages (`/api/messages`)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/messages/:id` | Lấy tin nhắn theo trang (cursor `before`, cache Redis) |
| GET | `/api/messages/:id/search` | Tìm kiếm tin nhắn trong cuộc trò chuyện |
| POST | `/api/messages/:id` | Gửi tin nhắn text |
| POST | `/api/messages/:id/file` | Gửi file |
| POST | `/api/messages/:id/media` | Gửi ảnh/video |
| POST | `/api/messages/:id/voice` | Gửi voice message |
| POST | `/api/messages/:id/link-preview` | Gửi link kèm preview |
| PATCH | `/api/messages/:id` | Sửa nội dung tin nhắn |
| DELETE | `/api/messages/:id` | Xóa tin nhắn |
| POST | `/api/messages/:id/forward` | Chuyển tiếp tin nhắn |
| POST | `/api/messages/:id/react` | Thả reaction |
| PATCH | `/api/messages/:id/unreact` | Bỏ reaction |
| PATCH | `/api/messages/:id/seen` | Đánh dấu đã xem |
| POST | `/api/messages/:id/pin` | Ghim |
| PATCH | `/api/messages/:id/unpin` | Bỏ ghim |

---

## Socket Events Reference

### Client gửi lên server (`@SubscribeMessage`)

```
join_conversation      leave_conversation
typing_start           typing_stop

call_initiate    call_accept    call_reject    call_end    call_cancel
call_offer        call_answer     call_ice_candidate

group_call_start   group_call_join   group_call_leave   group_call_end
```

### Server emit về client (`SOCKET_EVENTS`)

```
Tin nhắn:
  new_message, new_message_file, new_message_media, new_message_voice,
  new_message_linkPreview, new_message_call, message_edited, message_deleted,
  message_reacted, message_forwarded, message_seen, message_pinned,
  message_unpinned, mention_received

Presence:
  user_typing, user_stopped_typing, user_status_changed

Nhóm:
  conversation_updated, group_created, group_member_added, group_added,
  group_member_removed, group_removed, group_member_left, group_left_self,
  group_role_changed, group_dissolved, group_join_requested,
  group_request_handled, group_request_added, group_request_rejected,
  announcement_created

Kết bạn:
  friend_request_received, friend_request_accepted, friend_request_rejected

Cuộc gọi 1-1:
  call_initiated, call_started, call_busy, call_accepted, call_rejected,
  call_ended, call_cancelled, call_offer, call_answer, call_ice_candidate

Cuộc gọi nhóm:
  group_call_started, group_call_joined, group_call_left, group_call_ended,
  group_call_participants, group_call_redirect
```

Toàn bộ tên event được khai báo tập trung tại `gateway/gateway.constants.ts`, tránh viết chuỗi trực tiếp rải rác trong code.

---

## Environment Variables

### Backend `.env`

```env
PORT=3000
# Domain frontend được phép gọi API/socket, cách nhau bằng dấu phẩy nếu có
# nhiều domain (ví dụ vừa có domain Vercel chính vừa có domain xem trước PR).
# Để trống thì mặc định cho phép tất cả (chỉ nên dùng khi đang phát triển local).
URL_FE_CONNECT=http://localhost:5173

# Số lượng reverse proxy đứng trước server (Render có 1 lớp proxy) — dùng để
# Express lấy đúng IP thật của người dùng, phục vụ tính năng giới hạn request
# theo IP (rate limit). Để mặc định 1 nếu deploy trên Render.
TRUST_PROXY_HOPS=1

MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>

JWT_SECRET=your_jwt_access_secret
JWT_SECRET_REFRESH=your_jwt_refresh_secret

CLOUD_NAME=your_cloudinary_name
CLOUD_API_KEY=your_cloudinary_api_key
CLOUD_API_SECRET=your_cloudinary_api_secret

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# STUN/TURN cho cuộc gọi WebRTC — trả về qua GET /api/calls/ice-servers.
# STUN không bắt buộc khai báo (có giá trị mặc định của Google), nhưng TURN
# thì cần một dịch vụ thật mới hoạt động được. Không có TURN, cuộc gọi giữa
# 2 người ở 2 mạng khác nhau (ví dụ 2 nhà mạng 4G khác nhau) có thể không
# kết nối được — xem thêm ở mục "Giới hạn đã biết" trong phần Application
# Workflows > Cuộc gọi thoại/video.
STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
TURN_URLS=
TURN_USERNAME=
TURN_CREDENTIAL=

# (Không bắt buộc) nhà cung cấp TURN thứ 2, dùng làm dự phòng nếu nhà cung
# cấp chính hết quota hoặc gặp sự cố — để trống nếu chỉ dùng 1 nhà cung cấp.
TURN_URLS_2=
TURN_USERNAME_2=
TURN_CREDENTIAL_2=
```

File `.env` đã có trong `.gitignore`, không commit lên repository.

---

## Getting Started

### Yêu cầu

- Node.js >= 18.x
- MongoDB (Atlas hoặc local)
- Redis (local hoặc dịch vụ cloud như Upstash/Redis Cloud)
- Cloudinary account

### Backend

```bash
cd backend
npm install

# Tạo file .env theo mẫu ở trên

npm run dev
# Chạy bằng ts-node-dev, tự restart khi có thay đổi
# Server lắng nghe tại http://localhost:3000/api
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Chạy tại http://localhost:5173 (mặc định Vite)
```

Cần Redis server đang chạy trước khi start Backend — `RedisModule` kết nối ngay khi ứng dụng khởi động (`lazyConnect: false`), nếu Redis không sẵn sàng, các thao tác cache sẽ tự bắt lỗi và bỏ qua (ghi log warning) chứ không làm sập server, nhưng sẽ không có tác dụng tối ưu tốc độ như thiết kế.

---

## Cập nhật gần đây (tối ưu để chạy ổn định với nhiều người dùng hơn)

Đợt cập nhật này tập trung vào việc ứng dụng chạy ổn định hơn ở môi trường
thật (Render + Vercel, đều dùng gói miễn phí), sửa các lỗi phát sinh khi
dùng ở mạng thật thay vì local, và dọn bớt code/tài nguyên không dùng đến.
Chi tiết từng thay đổi theo file/dòng nằm trong `BAO_CAO_CAP_NHAT.md` ở
thư mục gốc của repo.

**Backend**

- Không còn tạo chuỗi request đến database ở mỗi request có kèm access
  token — `JwtStrategy` nhớ tạm trong bộ nhớ 60 giây rằng một user còn tồn
  tại, chỉ truy vấn lại khi hết hạn bản ghi nhớ.
- Refresh token chuyển sang băm bằng SHA-256 và so sánh bằng thuật toán
  không lộ thời gian xử lý (`timingSafeEqual`) thay vì `bcrypt.compare` —
  refresh token là chuỗi ngẫu nhiên (không phải mật khẩu người dùng tự đặt)
  nên không cần thuật toán chậm có "salt" như bcrypt; giá trị bcrypt cũ vẫn
  được chấp nhận một lần rồi tự chuyển sang SHA-256.
- Giới hạn số request (rate limit) cho đăng ký/đăng nhập/làm mới token được
  nới ra mức thực tế hơn (xem bảng ở mục Environment Variables và API Routes
  Reference) — số cũ quá thấp, dễ khóa nhầm người dùng thật khi nhiều người
  dùng chung 1 mạng Wi-Fi/4G (cùng 1 địa chỉ IP công khai).
- Thêm endpoint `GET /api/calls/ice-servers` trả về danh sách STUN/TURN
  cho client, thay vì client tự hardcode sẵn một danh sách STUN cố định.
  Hỗ trợ khai báo thêm một nhà cung cấp TURN thứ 2 làm dự phòng (biến môi
  trường `TURN_URLS_2` / `TURN_USERNAME_2` / `TURN_CREDENTIAL_2`) — không
  bắt buộc, để trống thì chỉ dùng 1 nhà cung cấp như trước.
- Cuộc gọi 1-1 không bắt máy sau 45 giây tự đóng ở cả 2 phía và được ghi
  nhận là "nhỡ", thay vì treo màn hình gọi không giới hạn thời gian.
- Gọi nhóm chỉ còn hỗ trợ thoại — server ép `callType` về `"voice"` bất kể
  client gửi gì lên, để tránh mô hình gọi video nhiều người cùng lúc
  (mesh WebRTC) làm quá tải server free-tier.
- Bật nén phản hồi (gzip qua middleware `compression`), cấu hình
  `trust proxy` đúng cho môi trường có reverse proxy (Render), và danh sách
  domain frontend được phép gọi API (`CORS`) đọc từ danh sách thay vì một
  giá trị chuỗi đơn.
- Endpoint `GET /api/health` phục vụ việc ping định kỳ giữ server free-tier
  trên Render không bị ngủ đông.
- Một số hàm chỉ cần biết "có tồn tại hay không" đổi từ `findOne` sang
  `exists`, và endpoint danh sách người dùng không còn trả về nguyên văn
  document (từng lộ mật khẩu đã băm và refresh token trong response).
- Thêm `socket-io.adapter.ts`, gắn vào `main.ts` qua `app.useWebSocketAdapter(...)`,
  để danh sách domain được phép (CORS) áp dụng nhất quán cho cả tầng
  Socket.IO chứ không chỉ REST API.

**Frontend**

- Sửa lỗi header cuộc trò chuyện bị che khi cuộn trên điện thoại — nguyên
  nhân là dùng đơn vị chiều cao `100vh`, vốn không tính đến việc thanh địa
  chỉ trình duyệt di động tự ẩn/hiện; đổi sang `100dvh`.
- Kết nối Socket.IO cho phép bắt đầu bằng polling rồi nâng cấp lên
  websocket (mặc định của Engine.IO) thay vì ép chỉ dùng websocket — tránh
  cảnh báo kết nối thất bại lúc backend Render đang khởi động lại sau khi
  ngủ đông (cold start), đồng thời cấu hình tự kết nối lại khi mất mạng.
- Cuộc gọi 1-1 và gọi nhóm lấy danh sách STUN/TURN từ backend thay vì
  hardcode sẵn, và tự huỷ nếu không kết nối được sau một khoảng thời gian
  thay vì hiển thị "Đang kết nối..." vô thời hạn khi 2 máy ở 2 mạng khác
  nhau không tự bắt được nhau qua STUN. Việc tải danh sách ICE server được
  `await` ngay trước khi tạo peer connection (trước đây chỉ tải ngầm lúc mở
  modal, có thể chưa tải xong khi 2 bên bắt máy quá nhanh, khiến cuộc gọi
  vô tình chạy với STUN mặc định thay vì danh sách đầy đủ có TURN). Khi
  không lấy được micro/camera, phía đó chủ động báo cho bên kia và đóng
  cuộc gọi ngay, thay vì để bên kia phải tự chờ hết giờ connect-timeout.
  Có thêm cờ debug `localStorage.setItem('ice_transport_policy', 'relay')`
  để ép cuộc gọi test chỉ đi qua TURN, phục vụ việc xác định lỗi mạng.
- Giao diện cuộc gọi video: avatar tròn không còn hiển thị đè lên video khi
  cuộc gọi đã kết nối (trước đây che mất một phần khuôn mặt và góc video
  nhỏ của bản thân).
- Gọi nhóm chỉ còn nút gọi thoại, bỏ nút gọi video nhóm và toàn bộ code xử
  lý camera trong màn hình gọi nhóm.
- Trang đăng nhập (`AuthPage`) và trang chat (`ChatPage` cùng các trang con)
  được tải theo route thay vì gộp chung vào 1 file JavaScript duy nhất;
  màn hình gọi (`CallModal`, `GroupCallModal`) cũng tải riêng khi có cuộc
  gọi. Dung lượng JavaScript tải lần đầu giảm từ khoảng 638KB xuống còn
  khoảng 283KB (đo bằng `npm run build`, chưa nén gzip).
- `authService.ts` tự thêm `/api` vào cuối `VITE_API_URL` nếu thiếu — toàn bộ
  route backend đều có tiền tố `/api`, cấu hình thiếu đoạn này trên Vercel
  từng khiến mọi request REST bị lỗi 404. Đây là lưới an toàn, không thay
  thế việc phải cấu hình đúng giá trị này trên Vercel và deploy lại (Vite
  gắn cứng biến môi trường vào lúc build).
- Xoá các file không còn được import ở đâu trong code: component
  `ProfileView.tsx` (410 dòng, đã có chức năng tương đương trong
  `SettingsModal.tsx`), cùng khoảng 900KB ảnh nền và icon mẫu mặc định của
  Vite/React trong thư mục `public/` — các file trong `public/` được deploy
  nguyên trạng lên Vercel dù không được code nào tham chiếu tới.

---



Dự án cá nhân, thực hành xây dựng backend realtime với NestJS, MongoDB, Redis và Socket.IO, kèm phần frontend React để hoàn thiện một ứng dụng chat sử dụng được đầu cuối.
