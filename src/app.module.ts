import {Module} from "@nestjs/common";
import {ConfigModule} from "@nestjs/config";
import {MongooseModule} from "@nestjs/mongoose";
import {ThrottlerModule, ThrottlerGuard} from "@nestjs/throttler";
import {APP_GUARD} from "@nestjs/core";

import {mongooseConfig} from "./config/db.config";
import {UsersModule} from "./module/user/user.module";
import {AuthModule} from "./module/auth/auth.module";
import {ConversationModule} from "./module/conversation/conversation.module";
import {MessageModule} from "./module/message/message.module";
import {ChatModule} from "./gateway/chat.module";
import {FriendModule} from "./module/friend/friend.module";
import {AttachmentModule} from "./module/attachment/attachment.module";
import {CallModule} from "./module/call/call.module";
import {HealthModule} from "./module/health/health.module";
import {RedisModule} from "./shared/redis/redis.module";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        MongooseModule.forRootAsync({
            useFactory: mongooseConfig
        }),
        // giới hạn chung 300 request mỗi phút cho mỗi ip (đăng nhập, đăng ký có giới hạn riêng)
        ThrottlerModule.forRoot([
            {
                limit: 300,
                ttl: 60000
            },
        ]),
        RedisModule,
        AuthModule,
        UsersModule,
        ConversationModule,
        MessageModule,
        FriendModule,
        ChatModule,
        AttachmentModule,
        CallModule,
        HealthModule,
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        }
    ]
})
export class AppModule {
}
