import {Global, Module} from "@nestjs/common";
import {ConfigService} from "@nestjs/config";
import Redis from "ioredis";

export const REDIS_CLIENT = "REDIS_CLIENT"

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService): Redis => {
                const host = config.get<string>("REDIS_HOST", "localhost");
                const port = config.get<number>("REDIS_PORT", 6379);
                const password = config.get<string>("REDIS_PASSWORD") || undefined;

                const client = new Redis({
                    host,
                    port,
                    password,
                    tls: password ? {} : undefined,
                    // tự kết nối lại khi mất kết nối
                    retryStrategy: (times) => Math.min(times * 100, 3000),
                    lazyConnect: false,
                });
 
                client.on("connect", () => console.log("[Redis] Đã kết nối"));
                client.on("error", (err) => console.error("[Redis] Lỗi:", err));
 
                return client;
            },
        },
    ],
    exports: [REDIS_CLIENT]
})
export class RedisModule {};