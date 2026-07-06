import {Injectable} from "@nestjs/common";
import {Server} from "socket.io";

import {SOCKET_EVENTS} from "../gateway.constants";
import {gatewayRooms} from "../gateway.rooms";

@Injectable()
export class PresenceEmitService {
    private server!: Server;

    setServer(server: Server) {
        this.server = server;
    }

    public userOnline(userId: string) {
        this.server.emit(SOCKET_EVENTS.USER_STATUS_CHANGED, {
            userId,
            status: "online",
            lastSeen: null,
        });
    }

    public userOffline(userId: string, lastSeen: Date | null) {
        this.server.emit(SOCKET_EVENTS.USER_STATUS_CHANGED, {
            userId,
            status: "offline",
            lastSeen,
        });
    }

    public statusChanged(
        userId: string,
        status: "online" | "away" | "busy" | "offline",
        customStatusMessage: string | null,
        lastSeen: Date | null,
    ) {
        this.server.emit(SOCKET_EVENTS.USER_STATUS_CHANGED, {
            userId,
            status,
            customStatusMessage,
            lastSeen,
        });
    }

    toUser(userId: string, event: string, payload: any) {
        this.server.to(gatewayRooms.user(userId)).emit(event, payload);
    }
}