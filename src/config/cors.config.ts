// danh sách domain frontend được gọi api và socket (biến URL_FE_CONNECT, cách nhau bằng dấu phẩy)
export const getAllowedOrigins = (): string[] | "*" => {
    const raw = process.env.URL_FE_CONNECT;
    if (!raw) return "*";

    const origins = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    return origins.length ? origins : "*";
};
