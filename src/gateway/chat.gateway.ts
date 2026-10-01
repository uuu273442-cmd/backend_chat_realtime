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
import {RedisCallService} from "../shared/redis/redisCall.service";
import {SOCKET_EVENTS} from "./gateway.constants";
import {getAllowedOrigins} from "../config/cors.config";

// chỉ hỗ trợ gọi thoại
const CALL_TYPE = "voice" as const;

// quá thời gian này mà chưa ai bắt máy thì tính là cuộc gọi nhỡ
const RING_TIMEOUT_MS = 45_000;

@WebSocketGateway({
    cors: {
        origin: getAllowedOrigins(),
        credentials: true
    },
})
export class ChatGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger(ChatGateway.name);

    // timer đổ chuông theo callId (lưu trong ram của 1 instance)
    private readonly pendingCallTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
        this.logger.log("ChatGateway đã khởi tạo");
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

            this.logger.debug(`Người dùng kết nối: ${userId}`);
        } catch {
            client.disconnect(true);
        }
    }

    async handleDisconnect(client: Socket) {
        const userId: string = client.data.userId;
        if (!userId) return;

        // dọn cuộc gọi nếu đang gọi mà mất kết nối
        const callId = await this.redisCallService.getUserCallId(userId);
        if (callId) {
            await this.handleCallCleanup(userId, callId);
        }

        await this.userService.setOffline(userId);
        const lastSeen = new Date();

        // chỉ gửi lastSeen thật khi người dùng cho phép mọi người xem
        const myPrivacy = await this.userService.getPrivacy(userId);
        const canBroadcastLastSeen = myPrivacy.privacy?.lastSeenVisibility === "everyone";
        this.presenceEmit.userOffline(userId, canBroadcastLastSeen ? lastSeen : null);

        this.logger.debug(`Người dùng ngắt kết nối: ${userId}`);
    }

    // dọn trạng thái cuộc gọi trên redis khi mất kết nối đột ngột
    private async handleCallCleanup(userId: string, callId: string): Promise<void> {
        const call = await this.redisCallService.getCall(callId);
        if (!call) return;

        if (call.isGroup) {
            const remaining = await this.redisCallService.removeParticipant(callId, userId);

            this.callEmit.groupCallLeft(call.conversationId!, {callId, userId});

            if (remaining === 0) {
                await this.redisCallService.deleteCall(callId, []);
                await this.redisCallService.clearActiveGroupCall(call.conversationId!);
                this.callEmit.groupCallEnded(call.conversationId!, {
                    callId,
                    conversationId: call.conversationId!,
                });
            }
        } else {
            this.clearRingTimeout(callId);

            const participants = await this.redisCallService.getParticipants(callId);
            const otherId = call.callerId === userId ? call.calleeId : call.callerId;

            await this.redisCallService.deleteCall(callId, participants);

            if (otherId) {
                this.callEmit.callEnded(otherId, {callId});
            }
        }
    }

    // hẹn giờ đổ chuông, hết giờ mà chưa ai bắt máy thì huỷ và ghi cuộc gọi nhỡ
    private scheduleRingTimeout(callId: string): void {
        const timer = setTimeout(async () => {
            this.pendingCallTimers.delete(callId);
            const call = await this.redisCallService.getCall(callId);
            if (!call || call.startedAt) return;

            const participants = await this.redisCallService.getParticipants(callId);
            await this.redisCallService.deleteCall(callId, participants);

            this.callEmit.callEnded(call.callerId, {callId});
            if (call.calleeId) this.callEmit.callEnded(call.calleeId, {callId});

            if (call.conversationId) {
                await this.messageService.createCallMessage({
                    conversationId: call.conversationId,
                    callerId: call.callerId,
                    callType: call.callType,
                    status: "missed",
                    endedAt: new Date(),
                    participantIds: [call.callerId, call.calleeId ?? ""].filter(Boolean),
                }).catch(() => {});
            }
        }, RING_TIMEOUT_MS);
        this.pendingCallTimers.set(callId, timer);
    }

    private clearRingTimeout(callId: string): void {
        const timer = this.pendingCallTimers.get(callId);
        if (timer) {
            clearTimeout(timer);
            this.pendingCallTimers.delete(callId);
        }
    }

    // ─── hội thoại ────────────────────────────────────────────────────────────

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

        // không hiện "đang soạn tin" nếu 2 người đã chặn nhau
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

    // ─── gọi thoại 1-1 ────────────────────────────────────────────────────────

    @SubscribeMessage("call_initiate")
    async onCallInitiate(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {calleId: string; conversationId: string}
    ) {
        const callerId: string = client.data.userId;

        const ok = await this.conversationService.findUserParticipants(
            callerId, data.conversationId
        );
        if (!ok) return;
        const isCalleeInConversation = ok.participants.find(
            obj => obj.userId.toString() === data.calleId
        );
        if (!isCalleeInConversation) return;

        // bị chặn thì báo bận
        const blocked = await this.userService.isBlocked(callerId, data.calleId);
        if (blocked) {
            this.callEmit.callBusy(callerId, {callId: ""});
            return;
        }

        // người nhận đang trong cuộc gọi khác
        const calleeInCall = await this.redisCallService.isUserInCall(data.calleId);
        if (calleeInCall) {
            this.callEmit.callBusy(callerId, {callId: ""});
            return;
        }

        const callId = randomUUID();
        const callerInfo = await this.userService.findById(callerId);

        await this.redisCallService.createCall({
            callId,
            callerId,
            calleeId: data.calleId,
            conversationId: data.conversationId,
            callType: CALL_TYPE,
            isGroup: false,
        });

        // thêm người gọi vào danh sách để được phép gửi tín hiệu
        await this.redisCallService.addParticipant(callId, callerId);

        this.callEmit.callInittiated(data.calleId, {
            callId,
            callerId,
            callerInfo: {name: callerInfo!.name, avatar: callerInfo?.avatar},
            callType: CALL_TYPE,
            conversationId: data.conversationId,
        });

        // gửi callId về cho người gọi để huỷ/kết thúc
        this.callEmit.callStarted(callerId, {callId, callType: CALL_TYPE});

        this.scheduleRingTimeout(callId);
    }

    @SubscribeMessage("call_accept")
    public async onCallAccept(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string}
    ) {
        const calleId = client.data.userId;
        const call = await this.redisCallService.getCall(data.callId);
        if (!call || call.calleeId !== calleId) return;

        this.clearRingTimeout(data.callId);

        await this.redisCallService.addParticipant(data.callId, calleId);
        // lưu thời điểm bắt máy để tính thời lượng
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

        this.clearRingTimeout(data.callId);

        await this.redisCallService.deleteCall(data.callId, [call.callerId]);
        this.callEmit.callRejected(call.callerId, {
            callId: call.callId,
            reasons: data?.reasons,
        });

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

        this.clearRingTimeout(data.callId);

        const otherId = call.callerId === userId ? call.calleeId : call.callerId;
        const participants = await this.redisCallService.getParticipants(data.callId);
        const endedAt = new Date();

        // tính thời lượng nếu đã bắt máy
        let duration: number | undefined;
        if (call.startedAt) {
            duration = Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000);
        }

        await this.redisCallService.deleteCall(data.callId, participants);

        if (otherId) {
            this.callEmit.callEnded(otherId, {callId: data.callId});
        }

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
                this.logger.error(`[call_end] lỗi tạo tin nhắn cuộc gọi: ${err}`);
            }
        } else {
            this.logger.warn(`[call_end] cuộc gọi ${data.callId} không có conversationId`);
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

        this.clearRingTimeout(data.callId);

        await this.redisCallService.deleteCall(data.callId, [callerId]);

        if (call.calleeId) {
            this.callEmit.callCancelled(call.calleeId, {callId: data.callId});
        }

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
                this.logger.error(`[call_cancel] lỗi tạo tin nhắn cuộc gọi: ${err}`);
            }
        } else {
            this.logger.warn(`[call_cancel] cuộc gọi ${data.callId} không có conversationId`);
        }
    }

    // ─── tín hiệu webrtc (offer / answer / ice candidate) ─────────────────────

    // chỉ cho gửi tín hiệu khi cả người gửi và người nhận đều đang trong cuộc gọi
    private async canSignal(callId: string, fromUserId: string, targetUserId: string) {
        const [fromOk, targetOk] = await Promise.all([
            this.redisCallService.isParticipant(callId, fromUserId),
            this.redisCallService.isParticipant(callId, targetUserId),
        ]);
        return fromOk && targetOk;
    }

    @SubscribeMessage("call_offer")
    async onCallOffer(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {callId: string; targetUserId: string; sdp: any},
    ) {
        const fromUserId = client.data.userId;
        if (!await this.canSignal(data.callId, fromUserId, data.targetUserId)) return;

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
        if (!await this.canSignal(data.callId, fromUserId, data.targetUserId)) return;

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
        if (!await this.canSignal(data.callId, fromUserId, data.targetUserId)) return;

        this.callEmit.callIceCandidate(data.targetUserId, {
            callId: data.callId,
            fromUserId,
            candidate: data.candidate,
        });
    }

    // ─── gọi nhóm ─────────────────────────────────────────────────────────────

    @SubscribeMessage("group_call_start")
    async onGroupCallStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: {conversationId: string},
    ) {
        const userId = client.data.userId;
        const ok = await this.conversationService.findUserParticipants(userId, data.conversationId);
        if (!ok) return;

        // nhóm đã có cuộc gọi thì vào luôn, không tạo cuộc gọi mới
        const existingCallId = await this.redisCallService.getActiveGroupCall(data.conversationId);
        if (existingCallId) {
            const existingCall = await this.redisCallService.getCall(existingCallId);
            if (existingCall) {
                this.callEmit.groupCallRedirect(userId, {
                    callId: existingCallId,
                    conversationId: data.conversationId,
                    hostId: existingCall.callerId,
                    callType: existingCall.callType,
                });
                await this.onGroupCallJoin(client, {callId: existingCallId});
                return;
            }
            // cuộc gọi cũ đã hết hạn, dọn rồi tạo mới
            await this.redisCallService.clearActiveGroupCall(data.conversationId);
        }

        const hostId = userId;
        const callId = randomUUID();

        await this.redisCallService.createCall({
            callId,
            callerId: hostId,
            conversationId: data.conversationId,
            callType: CALL_TYPE,
            isGroup: true,
        });
        await this.redisCallService.setActiveGroupCall(data.conversationId, callId);

        this.callEmit.groupCallStarted(data.conversationId, {
            callId,
            conversationId: data.conversationId,
            hostId,
            callType: CALL_TYPE,
        });

        // lưu tin nhắn "cuộc gọi nhóm bắt đầu" để thành viên khác vào tham gia
        try {
            await this.messageService.createCallMessage({
                conversationId: data.conversationId,
                callerId: hostId,
                callType: CALL_TYPE,
                status: "started",
                startedAt: new Date(),
                participantIds: [hostId],
            });
        } catch (err) {
            this.logger.error(`[group_call_start] lỗi tạo tin nhắn cuộc gọi: ${err}`);
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

        // chỉ thành viên của nhóm mới được vào
        const member = await this.conversationService.findUserParticipants(
            userId, call.conversationId!
        );
        if (!member) return;

        // lấy danh sách người đang có mặt trước khi thêm người mới
        const existingIds = (await this.redisCallService.getParticipants(data.callId))
            .filter(id => id !== userId);

        const existingParticipants = await Promise.all(
            existingIds.map(async (id) => {
                const info = await this.userService.getInfoById(id);
                return {userId: id, name: info.name, avatar: info.avatar};
            })
        );

        await this.redisCallService.addParticipant(data.callId, userId);

        const userInfo = await this.userService.getInfoById(userId);

        // báo cho cả nhóm biết có người mới vào
        this.callEmit.groupCallJoined(call.conversationId!, {
            callId: data.callId,
            userId,
            userInfo: {name: userInfo.name, avatar: userInfo.avatar},
        });

        // gửi riêng cho người mới danh sách người đang có mặt để tạo offer
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
                    status: "ended",
                    duration,
                    startedAt: call.startedAt,
                    endedAt,
                    participantIds: participants,
                });
            } catch (err) {
                this.logger.error(`[group_call_end] lỗi tạo tin nhắn cuộc gọi: ${err}`);
            }
        }
    }

    // ─── gửi sự kiện ──────────────────────────────────────────────

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
            this.logger.error(`Lỗi gửi sự kiện tới thành viên: ${err}`);
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