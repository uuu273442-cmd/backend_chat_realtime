import {MongooseModuleOptions} from "@nestjs/mongoose";

// Cấu hình kết nối MongoDB.
// - maxPoolSize: giới hạn số kết nối để không vượt giới hạn của gói Atlas miễn phí.
// - serverSelectionTimeoutMS: báo lỗi sớm nếu không tìm thấy server thay vì treo lâu.
export const mongooseConfig = (): MongooseModuleOptions => ({
    uri: process.env.MONGODB_URI,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
});
