import {NestFactory} from "@nestjs/core";
import {NestExpressApplication} from "@nestjs/platform-express";
import {ValidationPipe} from "@nestjs/common";
import compression from "compression";

import {AppModule} from "./app.module";
import {getAllowedOrigins} from "./config/cors.config";
import {CorsSocketIoAdapter} from "./socket-io.adapter";

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    // Server chạy sau reverse proxy của Render nên cần tin tưởng proxy
    // để req.ip là IP thật của người dùng (dùng cho giới hạn số request).
    // Số lượng proxy có thể chỉnh bằng biến môi trường TRUST_PROXY_HOPS.
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

    // Nén dữ liệu JSON trả về để giảm thời gian tải khi người dùng ở xa server.
    app.use(compression());

    app.enableCors({
        origin: getAllowedOrigins(),
        credentials: true,
    });

    // Áp dụng cùng danh sách domain được phép cho tầng Socket.IO — xem chú
    // thích trong socket-io.adapter.ts.
    app.useWebSocketAdapter(new CorsSocketIoAdapter(app));

    app.setGlobalPrefix("api");
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
        })
    );

    // Cho phép đóng kết nối MongoDB và Redis đúng cách khi server được restart.
    app.enableShutdownHooks();

    const PORT = process.env.PORT ?? 3000;
    await app.listen(PORT, "0.0.0.0");

    console.log(`App listening on port ${PORT}...`);
}

bootstrap();
