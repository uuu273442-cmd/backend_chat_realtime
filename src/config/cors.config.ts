// Danh sách domain frontend được phép gọi API và socket.
// Cấu hình trong biến môi trường URL_FE_CONNECT, nhiều domain cách nhau bằng dấu phẩy.
export const getAllowedOrigins = (): string[] | "*" => {
    const raw = process.env.URL_FE_CONNECT;
    if (!raw) return "*";

    const origins = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    return origins.length ? origins : "*";
};
