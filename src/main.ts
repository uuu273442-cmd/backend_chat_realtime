import {NestFactory} from "@nestjs/core";
import {NestExpressApplication} from "@nestjs/platform-express";
import compression from "compression";

import {AppModule} from "./app.module";
import {getAllowedOrigins} from "./config/cors.config";
import {CorsSocketIoAdapter} from "./socket-io.adapter";
import {createValidationPipe} from "./common/pipes/validation.pipe";
import {VietnameseExceptionFilter} from "./common/filters/http-exception.filter";

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    // server chạy sau proxy của render nên cần trust proxy để lấy đúng ip
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

    // nén json trả về
    app.use(compression());

    app.enableCors({
        origin: getAllowedOrigins(),
        credentials: true,
    });

    // cors cho socket.io
    app.useWebSocketAdapter(new CorsSocketIoAdapter(app));

    app.setGlobalPrefix("api");
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new VietnameseExceptionFilter());

    // đóng mongodb và redis đúng cách khi restart
    app.enableShutdownHooks();

    const PORT = process.env.PORT ?? 3000;
    await app.listen(PORT, "0.0.0.0");

    console.log(`Server đang chạy ở cổng ${PORT}`);
}

bootstrap();
