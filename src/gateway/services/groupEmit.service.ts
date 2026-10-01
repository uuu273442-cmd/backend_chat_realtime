import {Injectable} from "@nestjs/common";
import {Server} from "socket.io";

import {gatewayRooms} from "../gateway.rooms";
import {SOCKET_EVENTS} from "../gateway.constants";
import {Types} from "mongoose";

@Injectable()
export class GroupEmitService {
    private server!: Server;

    setServer(server: Server): void {
        this.server = server;
    }

    private toConversation(conversationId: string) {
        return this.server.to(gatewayRooms.conversation(conversationId));
    }

    private toUser(userId: string) {
        return this.server.to(gatewayRooms.user(userId));
    }

    public groupCreated(userIds: string[], payload: any) {
        const rooms = userIds.map(uid => gatewayRooms.user(uid));
        this.server.to(rooms).emit(SOCKET_EVENTS.GROUP_CREATED, payload);
    }

    public membersAdded(conversationId: string, userIds: string[], payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.GROUP_MEMBER_ADDED, payload);
        const rooms = userIds.map(uid => gatewayRooms.user(uid));
        this.server.to(rooms).emit(SOCKET_EVENTS.GROUP_ADDED, payload);
    }

    public membersRemoved(conversationId: string, userIds: string[], payload: any) {
        const rooms = userIds.map(uid => gatewayRooms.user(uid));
        this.server.in(rooms).socketsLeave(gatewayRooms.conversation(conversationId));
        this.toConversation(conversationId).emit(SOCKET_EVENTS.GROUP_MEMBER_REMOVED, payload);
        this.server.to(rooms).emit(SOCKET_EVENTS.GROUP_REMOVED, payload);
    }

    public memberLeft(conversationId: string, userId: string, payload: any) {
        this.server.in(userId).socketsLeave(gatewayRooms.conversation(conversationId));
        this.toConversation(conversationId).emit(SOCKET_EVENTS.GROUP_MEMBER_LEFT, payload);
        this.toUser(userId).emit(SOCKET_EVENTS.GROUP_LEFT_SELF, payload);
    }

    public roleChanged(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.GROUP_ROLE_CHANGED, payload);
    }

    public joinRequested(
        participants: {userId: Types.ObjectId, role: "owner" | "admin" | "member"}[],
        payload: any
    ) {
        // gửi cho tất cả thành viên để ai cũng thấy huy hiệu thông báo
        const rooms = participants
            .map(obj => gatewayRooms.user(obj.userId.toString()));
        this.server.to(rooms).emit(SOCKET_EVENTS.GROUP_JOIN_REQUESTED, payload);
    }

    public requestHandled(conversationId: string, newUserId: string, payload: any) {
        // 1. báo thành viên hiện tại có người mới
        this.toConversation(conversationId).emit(SOCKET_EVENTS.GROUP_MEMBER_ADDED, payload);
        // 2. báo yêu cầu đã được xử lý
        this.toConversation(conversationId).emit(SOCKET_EVENTS.GROUP_REQUEST_HANDLED, payload);
        // 3. báo riêng người mới được thêm vào nhóm
        this.toUser(newUserId).emit(SOCKET_EVENTS.GROUP_ADDED, payload);
        this.toUser(newUserId).emit(SOCKET_EVENTS.GROUP_REQUEST_ADDED, payload);
    }

    public dissolved(memberIds: string[], conversationId: string, payload: any) {
        const rooms = memberIds.map(uid => gatewayRooms.user(uid));
        // đưa mọi người ra khỏi phòng trước
        this.server.in(gatewayRooms.conversation(conversationId)).socketsLeave(gatewayRooms.conversation(conversationId));
        // báo từng người để frontend thoát khỏi nhóm
        this.server.to(rooms).emit(SOCKET_EVENTS.GROUP_DISSOLVED, payload);
    }
}