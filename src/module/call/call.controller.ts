import {Controller, Get, UseGuards} from "@nestjs/common";

import {JwtAuthGuard} from "../auth/guards/jwt-auth.guard";

// stun mặc định khi chưa cấu hình trong .env
const DEFAULT_STUN = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
];

interface IceServerEntry {
    urls: string[];
    username?: string;
    credential?: string;
}

// tách chuỗi "a,b,c" thành mảng
const splitList = (value?: string): string[] =>
    (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

@Controller("calls")
@UseGuards(JwtAuthGuard)
export class CallController {
    // trả về danh sách stun/turn (chỉ dùng 1 turn server duy nhất - metered)
    @Get("ice-servers")
    public getIceServers() {
        const stunUrls = splitList(process.env.STUN_URLS);
        const iceServers: IceServerEntry[] = [
            {urls: stunUrls.length ? stunUrls : DEFAULT_STUN},
        ];

        const turnUrls = splitList(process.env.TURN_URLS);
        const username = process.env.TURN_USERNAME;
        const credential = process.env.TURN_CREDENTIAL;

        // thiếu username/credential thì bỏ qua turn, tránh gửi cấu hình vô dụng
        if (turnUrls.length && username && credential) {
            iceServers.push({urls: turnUrls, username, credential});
        }

        return {iceServers, hasTurn: iceServers.length > 1};
    }
}
