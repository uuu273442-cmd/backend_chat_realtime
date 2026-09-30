import {Controller, Get, UseGuards} from "@nestjs/common";

import {JwtAuthGuard} from "../auth/guards/jwt-auth.guard";

// Trả về danh sách máy chủ STUN/TURN để trình duyệt thiết lập cuộc gọi.
//
// Khi hai người dùng ở hai mạng khác nhau (ví dụ 4G và Wi-Fi), chỉ có STUN là chưa đủ
// vì nhiều mạng chặn kết nối trực tiếp. Lúc đó cần máy chủ TURN để chuyển tiếp âm thanh và hình ảnh.
//
// Cấu hình bằng biến môi trường:
//   STUN_URLS         danh sách STUN, cách nhau bằng dấu phẩy (không bắt buộc)
//   TURN_URLS         danh sách TURN của nhà cung cấp CHÍNH, cách nhau bằng dấu phẩy
//   TURN_USERNAME     tên đăng nhập TURN (nhà cung cấp chính)
//   TURN_CREDENTIAL   mật khẩu TURN (nhà cung cấp chính)
//   TURN_URLS_2       (không bắt buộc) danh sách TURN của nhà cung cấp DỰ PHÒNG
//   TURN_USERNAME_2   (không bắt buộc) tên đăng nhập TURN dự phòng
//   TURN_CREDENTIAL_2 (không bắt buộc) mật khẩu TURN dự phòng
//
// Vì sao có nhà cung cấp dự phòng: mỗi dịch vụ TURN miễn phí/giá rẻ đều có
// giới hạn băng thông hoặc có thể tạm ngừng hoạt động. Trình duyệt tự thử
// lần lượt các mục trong danh sách iceServers, nên khai báo thêm một nhà
// cung cấp thứ 2 giúp cuộc gọi vẫn có đường TURN dự phòng nếu nhà cung cấp
// chính gặp sự cố hoặc hết quota tháng đó — không bắt buộc, để trống thì
// chỉ dùng 1 nhà cung cấp như bình thường.
const DEFAULT_STUN = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
];

interface IceServerEntry {
    urls: string[];
    username?: string;
    credential?: string;
}

const splitList = (value?: string): string[] =>
    (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

// Đọc 1 bộ cấu hình TURN theo hậu tố biến môi trường ("" cho nhà cung cấp
// chính, "_2" cho dự phòng). Trả về null nếu thiếu bất kỳ giá trị nào —
// tránh gửi cho client một mục TURN thiếu username/credential (vô dụng).
const readTurnConfig = (envSuffix: string): IceServerEntry | null => {
    const urls = splitList(process.env[`TURN_URLS${envSuffix}`]);
    const username = process.env[`TURN_USERNAME${envSuffix}`];
    const credential = process.env[`TURN_CREDENTIAL${envSuffix}`];

    if (urls.length && username && credential) {
        return {urls, username, credential};
    }
    return null;
};

@Controller("calls")
@UseGuards(JwtAuthGuard)
export class CallController {
    @Get("ice-servers")
    public getIceServers() {
        const stunUrls = splitList(process.env.STUN_URLS);
        const iceServers: IceServerEntry[] = [
            {urls: stunUrls.length ? stunUrls : DEFAULT_STUN},
        ];

        const primaryTurn = readTurnConfig("");
        if (primaryTurn) iceServers.push(primaryTurn);

        const backupTurn = readTurnConfig("_2");
        if (backupTurn) iceServers.push(backupTurn);

        const turnCount = iceServers.length - 1;
        return {iceServers, hasTurn: turnCount > 0, turnProviderCount: turnCount};
    }
}
