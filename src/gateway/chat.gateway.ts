import {
    WebSocketGateway,
    WebSocketServer,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    MessageBody,
} from "@nestjs/websockets";
import {forwardRef, Inject, Logger} from "@nestjs/common";
import {JwtService} from "@nestjs/jwt";
import {Socket, Server} from "socket.io";
import {randomUUID} from "crypto";
import {Types} from "mongoose";

import {ConversationService} from "../module/conversation/conversation.service";
import {MessageService} from "../module/message/message.service";
import {UserService} from "../module/user/user.service";
import {MessageEmitService} from "./services/messageEmit.service";
import {GroupEmitService} from "./services/groupEmit.service";
import {PresenceEmitService} from "./services/presenceEmit.service";
import {CallEmitService} from "./services/callEmit.service";

import {gatewayRooms} from "./gateway.rooms";

// [Redis] memory ram redis
import {RedisCallService} from "../shared/redis/redisCall.service";
import { SOCKET_EVENTS } from "./gateway.constants";

@WebSocketGateway({
    cors: {
        origin: process.env.URL_FE_CONNECT, 
        credentials: true
    },
})
export class ChatGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger(ChatGateway.name);

    constructor(
        private readonly jwtService: JwtService,
        @Inject(forwardRef(() => ConversationService))
        private readonly conversationService: ConversationService,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
        private readonly messageEmit: MessageEmitService,
        private readonly groupEmit: GroupEmitService,
        private readonly presenceEmit: PresenceEmitService,
        private readonly callEmit: CallEmitService,

        // [REDIS] Inject RedisCallService thay thế in-memory Maps
        private readonly redisCallService: RedisCallService,
        @Inject(forwardRef(() => MessageService))
        private readonly messageService: MessageService,
    ) {
    }

    afterInit(server: Server) {
        this.messageEmit.setServer(server);
        this.groupEmit.setServer(server);
        this.presenceEmit.setServer(server);
        this.callEmit.setServer(server);
        this.logger.log("ChatGateway initialized");
    }

    async handleConnection(client: Socket) {
        const token =
            client.handshake.auth?.token ||
            client.handshake.query?.token;

        if (!token) {
            client.disconnect(true);
            return;
        }

        try {
            const payload = this.jwtService.verify(token);
            const userId: string = payload.sub;

            client.data.userId = userId;
            client.join(gatewayRooms.user(userId));

            await this.userService.setOnline(userId);
            this.presenceEmit.userOnline(userId);

            this.logger.debug(`Client connected: ${userId}`);
        } catch {
            client.disconnect(true);
        }
    }

    async handleDisconnect(client: Socket) {
        const userId: string = client.data.userId;
        if (!userId) return;

        // Cleanup call state trên Redis nếu user đang trong cuộc gọi
        const callId = await this.redisCallService.getUserCallId(userId);
        if (callId) {
            await this._handleCallCleanup(userId, callId);
        }

        await this.userService.setOffline(userId);
        const lastSeen = new Date();
        this.presenceEmit.userOffline(userId, lastSeen);

        this.logger.debug(`Client disconnected: ${userId}`);
    }

    /**
     * [REDIS] Cleanup call state trên Redis.
     * Dùng chung cho handleDisconnect và các event call_end/call_cancel.
     */
    private async _handleCallCleanup(userId: string, callId: string): Promise<void> {
        const call = await this.redisCallService.getCall(callId);
        if (!call) return;
 
        if (call.isGroup) {
            const remaining = await this.redisCallService.removeParticipant(callId, userId);
 
            this.callEmit.groupCallLeft(call.conversationId!, {callId, userId});
 
            if (remaining === 0) {
                await this.redisCallService.deleteCall(callId, []);
                this.callEmit.groupCallEnded(call.conversationId!, {
                    callId,
                    conversationId: call.conversationId!,
                });
            }
        } else {
            const participants = await this.redisCallService.getParticipants(callId);
            const otherId = call.callerId === userId ? call.calleeId : call.callerId;
 
            await this.redisCallService.deleteCall(callId, participants);
 
            if (otherId) {
                this.callEmit.callEnded(otherId, {callId});
            }
        }
    }

    @SubscribeMessage("join_conversation")
    async joinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        const userId: string = client.data.userId;
        const ok = await this.conversationService.findUserParticipants(userId, data.conversationId);
        if (!ok) return;

        client.join(gatewayRooms.conversation(data.conversationId));
    }

    @SubscribeMessage("leave_conversation")
    leaveConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        client.leave(gatewayRooms.conversation(data.conversationId));
    }

    @SubscribeMessage("typing_start")
    async typingStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        const userId: string = client.data.userId;

        const getPrivacy = await this.userService.getPrivacy(userId);
        if (getPrivacy && !getPrivacy.privacy.showTypingIndicator) return;

        const ok = await this.conversationService.findUserParticipants(userId, data.conversationId);
        if (!ok) return;

        // Không hiện "đang soạn tin" nếu 1 trong 2 đã chặn nhau (private chat)
        const conv = await this.conversationService.findConversation(data.conversationId);
        if (conv.type !== "group") {
            const otherId = conv.participants.find(
                (p) => p.userId.toString() !== userId
            )?.userId.toString();
            if (otherId && await this.userService.isBlocked(userId, otherId)) {
                return;
            }
        }

        client
            .to(gatewayRooms.conversation(data.conversationId))
            .emit("user_typing", {conversationId: data.conversationId, userId});
    }

    @SubscribeMessage("typing_stop")
    typingStop(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { conversationId: string },
    ) {
        const userId: string = client.data.userId;
        client
            .to(gatewayRooms.conversation(data.conversationId))
            .emit("user_stopped_typing", {conversationId: data.conversationId, userId});
    }

    // ─── 1-1 Call ─────────────────────────────────────────────────────────────

    @SubscribeMessage("call_initiate")
    async onCallInitiate(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {calleId: string, conversationId: string, callType: "voice" | "video"}
    ) {
        const callerId: string = client.data.userId;

        const ok = await this.conversationService.findUserParticipants(
            callerId, data.conversationId
        );
        if (!ok) return;
        const isCalleeExistInCall = ok.participants.find(
            obj => obj.userId.toString() === data.calleId
        )
        if (!isCalleeExistInCall) return;
        // need to add method event error

        // Chặn gọi điện nếu 1 trong 2 người đã block người còn lại
        const blocked = await this.userService.isBlocked(callerId, data.calleId);
        if (blocked) {
            this.callEmit.callBusy(callerId, {callId: ""});
            return;
        }

        // [REDIS] Kiểm tra busy từ Redis thay Map
        const calleeInCall = await this.redisCallService.isUserInCall(data.calleId);
        if (calleeInCall) {
            this.callEmit.callBusy(callerId, {callId: ""});
            return;
        }
        const callId = randomUUID();
        const callerInfo = await this.userService.findById(callerId);

        // [REDIS] Lưu call state vào Redis
        await this.redisCallService.createCall({
            callId,
            callerId,
            calleeId: data.calleId,
            conversationId: data.conversationId,
            callType: data.callType,
            isGroup: false,
        });

        // Thêm caller vào participants ngay để pass security check khi gửi offer
        await this.redisCallService.addParticipant(callId, callerId);

        this.callEmit.callInittiated(data.calleId, {
            callId,
            callerId,
            callerInfo: {name: callerInfo!.name, avatar: callerInfo?.avatar},
            callType: data.callType,
            conversationId: data.conversationId,
        });

        // Emit callId về cho caller để dùng cancel/end
        this.callEmit.callStarted(callerId, { callId, callType: data.callType });
    }

    @SubscribeMessage("call_accept")
    public async onCallAccept(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string}
    ) {
        const calleId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call || call.calleeId !== calleId) return;

        // [REDIS] Thêm callee vào participants set trên Redis
        await this.redisCallService.addParticipant(data.callId, calleId);
        // Lưu thời điểm bắt đầu để tính duration khi kết thúc
        await this.redisCallService.setStartedAt(data.callId);
        this.callEmit.callAccepted(call.callerId, {callId: call.callId});
    }

    @SubscribeMessage("call_reject")
    async onCallReject(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string; reasons?: string},
    ) {
        const calleeId: string = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call || call.calleeId !== calleeId) return;
 
        // [REDIS] Xoá call khỏi Redis
        await this.redisCallService.deleteCall(data.callId, [call.callerId]);
        this.callEmit.callRejected(call.callerId, {
            callId: call.callId,
            reasons: data?.reasons,
        });

        // Lưu missed call message nếu có conversationId
        if (call.conversationId) {
            await this.messageService.createCallMessage({
                conversationId: call.conversationId,
                callerId: call.callerId,
                callType: call.callType,
                status: "missed",
                endedAt: new Date(),
                participantIds: [call.callerId, calleeId],
            }).catch(() => {});
        }
    }

    @SubscribeMessage("call_end")
    async onCallEnd(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string},
    ) {
        const userId: string = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call) return;
 
        const otherId = call.callerId === userId ? call.calleeId : call.callerId;
        const participants = await this.redisCallService.getParticipants(data.callId);
        const endedAt = new Date();

        // Tính duration nếu có startedAt
        let duration: number | undefined;
        if (call.startedAt) {
            duration = Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000);
        }

        // [REDIS] Xoá toàn bộ call state
        await this.redisCallService.deleteCall(data.callId, participants);

        if (otherId) {
            this.callEmit.callEnded(otherId, {callId: data.callId});
        }

        // Lưu call message
        if (call.conversationId) {
            const status = call.startedAt ? "ended" : "missed";
            try {
                await this.messageService.createCallMessage({
                    conversationId: call.conversationId,
                    callerId: call.callerId,
                    callType: call.callType,
                    status,
                    duration,
                    startedAt: call.startedAt,
                    endedAt,
                    participantIds: [...participants],
                });
            } catch (err) {
                console.error('[call_end] createCallMessage error:', err);
            }
        } else {
            console.warn('[call_end] No conversationId for callId:', data.callId, '| call:', call);
        }
    }

    @SubscribeMessage("call_cancel")
    async onCallCancel(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string},
    ) {
        const callerId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call || call.callerId !== callerId) return;
 
        await this.redisCallService.deleteCall(data.callId, [callerId]);

        if (call.calleeId) {
            this.callEmit.callCancelled(call.calleeId, {callId: data.callId});
        }

        // Lưu cancelled call message
        if (call.conversationId) {
            try {
                await this.messageService.createCallMessage({
                    conversationId: call.conversationId,
                    callerId: call.callerId,
                    callType: call.callType,
                    status: "cancelled",
                    endedAt: new Date(),
                    participantIds: [call.callerId, call.calleeId ?? ""].filter(Boolean),
                });
            } catch (err) {
                console.error('[call_cancel] createCallMessage error:', err);
            }
        } else {
            console.warn('[call_cancel] No conversationId for callId:', data.callId, '| call:', call);
        }
    }

    // ─── WebRTC Signaling (call_offer / call_answer / call_ice_candidate) ─────
 
    @SubscribeMessage("call_offer")
    async onCallOffer(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string; targetUserId: string; sdp: any},
    ) {
        const fromUserId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
 
        // [SECURITY] Verify participant từ Redis
        if (!call || !call.participants.has(fromUserId)) return;
 
        this.callEmit.callOffer(data.targetUserId, {
            callId: data.callId,
            fromUserId,
            sdp: data.sdp,
        });
    }
 
    @SubscribeMessage("call_answer")
    async onCallAnswer(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string; targetUserId: string; sdp: any},
    ) {
        const fromUserId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
 
        if (!call || !call.participants.has(fromUserId)) return;
 
        this.callEmit.callAnswer(data.targetUserId, {
            callId: data.callId,
            fromUserId,
            sdp: data.sdp,
        });
    }
 
    @SubscribeMessage("call_ice_candidate")
    async onCallIceCandidate(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string; targetUserId: string; candidate: any},
    ) {
        const fromUserId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
 
        if (!call || !call.participants.has(fromUserId)) return;
 
        this.callEmit.callIceCandidate(data.targetUserId, {
            callId: data.callId,
            fromUserId,
            candidate: data.candidate,
        });
    }

    // ─── Group Call ───────────────────────────────────────────────────────────

    @SubscribeMessage("group_call_start")
    async onGroupCallStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {conversationId: string; callType: "voice" | "video"},
    ) {
        const userId = client.data.userId;
        const ok = await this.conversationService.findUserParticipants(userId, data.conversationId);
        if (!ok) return;

        // Kiểm tra conversation đã có call đang chạy chưa — tránh tạo call trùng
        // khi user rejoin hoặc 2 người cùng bấm gọi gần như đồng thời
        const existingCallId = await this.redisCallService.getActiveGroupCall(data.conversationId);
        if (existingCallId) {
            const existingCall = await this.redisCallService.getCall(existingCallId);
            if (existingCall) {
                // Call vẫn còn sống → redirect user này vào call đã có (auto-join)
                // thay vì tạo call/message mới. Emit riêng cho user này biết
                // callId thật để FE chuyển từ "outgoing/host" sang "đã tham gia".
                this.callEmit.groupCallRedirect(userId, {
                    callId: existingCallId,
                    conversationId: data.conversationId,
                    hostId: existingCall.callerId,
                    callType: existingCall.callType,
                });
                await this.onGroupCallJoin(client, { callId: existingCallId });
                return;
            }
            // Call đã chết (TTL/lỗi) — dọn mapping cũ, tạo call mới bên dưới
            await this.redisCallService.clearActiveGroupCall(data.conversationId);
        }

        const hostId = userId;
        const callId = randomUUID();

        // [REDIS] Lưu group call vào Redis
        await this.redisCallService.createCall({
            callId,
            callerId: hostId,
            conversationId: data.conversationId,
            callType: data.callType,
            isGroup: true,
        });
        await this.redisCallService.setActiveGroupCall(data.conversationId, callId);

        this.callEmit.groupCallStarted(data.conversationId, {
            callId,
            conversationId: data.conversationId,
            hostId,
            callType: data.callType,
        });

        // Lưu message "cuộc gọi nhóm bắt đầu" để members thấy và có thể join
        try {
            await this.messageService.createCallMessage({
                conversationId: data.conversationId,
                callerId: hostId,
                callType: data.callType,
                status: 'started',
                startedAt: new Date(),
                participantIds: [hostId],
            });
        } catch (err) {
            console.error('[group_call_start] createCallMessage error:', err);
        }
    }

    @SubscribeMessage("group_call_join")
    async onGroupCallJoin(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string},
    ) {
        const userId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call || !call.isGroup) return;
 
        // Lấy danh sách participants TRƯỚC khi thêm user mới
        const existingIds = (await this.redisCallService.getParticipants(data.callId))
            .filter(id => id !== userId);

        // Lấy thông tin (name, avatar) cho từng existing participant
        const existingParticipants = await Promise.all(
            existingIds.map(async (id) => {
                const info = await this.userService.getInfoById(id);
                return { userId: id, name: info.name, avatar: info.avatar };
            })
        );

        // [REDIS] Thêm participant vào Redis
        await this.redisCallService.addParticipant(data.callId, userId);
 
        const userInfo = await this.userService.getInfoById(userId);

        // Broadcast cho tất cả: có người mới join
        this.callEmit.groupCallJoined(call.conversationId!, {
            callId: data.callId,
            userId,
            userInfo: {name: userInfo.name, avatar: userInfo.avatar},
        });

        // Emit riêng cho user mới: danh sách người đang có mặt (kèm tên) để tạo WebRTC offer
        this.callEmit.groupCallParticipants(userId, {
            callId: data.callId,
            existingParticipants,
        });
    }

    @SubscribeMessage("group_call_leave")
    async onGroupCallLeave(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string},
    ) {
        const userId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call || !call.isGroup) return;
 
        const remaining = await this.redisCallService.removeParticipant(
            data.callId, userId,
        );
        
        this.callEmit.groupCallLeft(call.conversationId!, {callId: data.callId, userId});

        if (remaining === 0) {
            await this.redisCallService.deleteCall(data.callId, []);
            await this.redisCallService.clearActiveGroupCall(call.conversationId!);
            this.callEmit.groupCallEnded(call.conversationId!, {
                callId: data.callId,
                conversationId: call.conversationId!,
            });
        }
    }

    @SubscribeMessage("group_call_end")
    async onGroupCallEnd(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string},
    ) {
        const hostId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call || !call.isGroup || call.callerId !== hostId) return;
 
        const participants = await this.redisCallService.getParticipants(data.callId);
        await this.redisCallService.deleteCall(data.callId, participants);
        await this.redisCallService.clearActiveGroupCall(call.conversationId!);
 
        this.callEmit.groupCallEnded(call.conversationId!, {
            callId: data.callId,
            conversationId: call.conversationId!,
        });

        // Lưu message kết thúc
        if (call.conversationId) {
            const endedAt = new Date();
            const duration = call.startedAt
                ? Math.floor((endedAt.getTime() - new Date(call.startedAt).getTime()) / 1000)
                : 0;
            try {
                await this.messageService.createCallMessage({
                    conversationId: call.conversationId,
                    callerId: hostId,
                    callType: call.callType,
                    status: 'ended',
                    duration,
                    startedAt: call.startedAt,
                    endedAt,
                    participantIds: participants,
                });
            } catch (err) {
                console.error('[group_call_end] createCallMessage error:', err);
            }
        }
    }

    // ─── Emit helpers ─────────────────────────────────────────────

    private async emitToParticipants(cid: string, event: string, payload: any) {
        try {
            const conversation = await this.conversationService.findConversation(cid);
            if (conversation && conversation.participants) {
                const participantIds = conversation.participants.map(p => p.userId.toString());
                const rooms = participantIds.map(uid => gatewayRooms.user(uid));
                this.server.to(rooms).emit(SOCKET_EVENTS.GROUP_UPDATED, {
                    conversationId: cid,
                    event,
                    payload
                });
            }
        } catch (err) {
            this.logger.error(`Error emitting to participants: ${err}`);
        }
    }

    emitNewMessage(cid: string, p: any) {
        this.messageEmit.newMessage(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.NEW_MESSAGE, p);
    }

    emitNewMessageFiles(cid: string, p: any) {
        this.messageEmit.newMessageFile(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.NEW_MESSAGE_FILE, p);
    }

    emitNewMessageMedias(cid: string, p: any) {
        this.messageEmit.newMessageMedia(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.NEW_MESSAGE_MEDIA, p);
    }

    emitNewMessageVoice(cid: string, p: any) {
        this.messageEmit.newMessageVoice(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.NEW_MESSAGE_VOICE, p);
    }

    emitNewMessageLinkPreview(cid: string, p: any) {
        this.messageEmit.newMessageLinkPreview(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.NEW_MESSAGE_LINK, p);
    }

    emitNewMessageCall(cid: string, p: any) { 
        this.messageEmit.newMessageCall(cid, p); 
        this.emitToParticipants(cid, SOCKET_EVENTS.NEW_MESSAGE_CALL, p);
    }

    emitMessageEdited(cid: string, p: any) {
        this.messageEmit.messageEdited(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.MESSAGE_EDITED, p);
    }

    emitMessageDeleted(cid: string, p: any) {
        this.messageEmit.messageDeleted(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.MESSAGE_DELETED, p);
    }

    emitMessageReacted(cid: string, p: any) {
        this.messageEmit.messageReacted(cid, p);
    }

    emitMessageForwarded(cid: string, p: any) {
        this.messageEmit.messageForwarded(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.MESSAGE_FORWARDED, p);
    }

    emitMessageSeen(cid: string, p: any) {
        this.messageEmit.messageSeen(cid, p);
    }

    emitMessagePinned(cid: string, p: any) {
        this.messageEmit.messagePinned(cid, p);
    }

    emitMessageUnpinned(cid: string, p: any) {
        this.messageEmit.messageUnpinned(cid, p);
    }

    emitMentions(uids: string[], p: any) {
        this.messageEmit.messageMention(uids, p);
    }

    emitSystemRoom(cid: string, p: any) {
        this.messageEmit.messageSystemRoom(cid, p);
        this.emitToParticipants(cid, SOCKET_EVENTS.MESSAGE_SYSTEM_ROOM, p);
    }

    emitAnnouncement(cid: string, p: any) {
        this.messageEmit.announcementCreated(cid, p);
    }

    emitGroupCreated(uids: string[], p: any) {
        this.groupEmit.groupCreated(uids, p);
    }

    emitAddMembersGroup(cid: string, newUids: string[], p: any) {
        this.groupEmit.membersAdded(cid, newUids, p);
    }

    emitRemoveMembersGroup(cid: string, removedUids: string[], p: any) {
        this.groupEmit.membersRemoved(cid, removedUids, p);
    }

    emitLeftGroup(cid: string, uid: string, p: any) {
        this.groupEmit.memberLeft(cid, uid, p);
    }

    emitChangeRoleMemberGroup(cid: string, p: any) {
        this.groupEmit.roleChanged(cid, p);
    }

    emitNewRequestJoinRoom(
        participants: { userId: Types.ObjectId; role: "owner" | "admin" | "member" }[],
        p: any
    ) {
        this.groupEmit.joinRequested(participants, p);
    }

    emitHandelRequestJoinRoom(cid: string, uid: string, p: any) {
        this.groupEmit.requestHandled(cid, uid, p);
    }

    emitGroupDissolved(memberIds: string[], conversationId: string, p: any) {
        this.groupEmit.dissolved(memberIds, conversationId, p);
    }

    emitStatusChanged(
        userId: string,
        status: "online" | "away" | "busy" | "offline",
        customStatusMessage: string | null,
        lastSeen: Date | null,
    ) {
        this.presenceEmit.statusChanged(userId, status, customStatusMessage, lastSeen);
    }

    emitToUser(uid: string, event: string, p: any) {
        this.presenceEmit.toUser(uid, event, p);
    }
}