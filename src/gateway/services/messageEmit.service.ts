import {Injectable} from "@nestjs/common";
import {Server} from "socket.io";

import {gatewayRooms} from "../gateway.rooms";
import {SOCKET_EVENTS} from "../gateway.constants";

@Injectable()
export class MessageEmitService {
    private server!: Server;

    setServer(server: Server) {
        this.server = server;
    }

    private toConversation(conversationId: string) {
        return this.server.to(gatewayRooms.conversation(conversationId));
    }

    newMessage(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.NEW_MESSAGE, payload);
    }

    newMessageFile(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.NEW_MESSAGE_FILE, payload);
    }

    newMessageMedia(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.NEW_MESSAGE_MEDIA, payload);
    }

    newMessageVoice(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.NEW_MESSAGE_VOICE, payload);
    }

    newMessageLinkPreview(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.NEW_MESSAGE_LINK, payload);
    }

    newMessageCall(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.NEW_MESSAGE_CALL, payload);
    }

    messageEdited(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_EDITED, payload);
    }

    messageDeleted(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_DELETED, payload);
    }

    messageReacted(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_REACTED, payload);
    }

    messageForwarded(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_FORWARDED, payload);
    }

    messageSeen(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_SEEN, payload);
    }

    messagePinned(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_PINNED, payload);
    }

    messageUnpinned(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_UNPINNED, payload);
    }

    messageMention(userIds: string[], payload: any) {
        const rooms = userIds.map(uid => gatewayRooms.user(uid));
        this.server.to(rooms).emit(SOCKET_EVENTS.MESSAGE_MENTION, payload);
    }

    messageSystemRoom(conversationId: string, payload: any) {
        this.toConversation(conversationId).emit(SOCKET_EVENTS.MESSAGE_SYSTEM_ROOM, payload);
    }
}
