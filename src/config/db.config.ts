import {MongooseModuleOptions} from "@nestjs/mongoose";

// cấu hình kết nối mongodb: giới hạn số kết nối và báo lỗi sớm khi không tìm thấy server
export const mongooseConfig = (): MongooseModuleOptions => ({
    uri: process.env.MONGODB_URI,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
});
