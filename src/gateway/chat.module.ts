import {forwardRef, Module} from "@nestjs/common";
import {JwtModule} from "@nestjs/jwt";
import {ConfigService} from "@nestjs/config";

import {ChatGateway} from "./chat.gateway";
import {ConversationModule} from "../module/conversation/conversation.module";
import {UsersModule} from "../module/user/user.module";
import {MessageEmitService} from "./services/messageEmit.service";
import {GroupEmitService} from "./services/groupEmit.service";
import {PresenceEmitService} from "./services/presenceEmit.service";
import {CallEmitService} from "./services/callEmit.service";
import {RedisCallService} from "../shared/redis/redisCall.service";
import {MessageModule} from "../module/message/message.module";

@Module({
    imports: [
        forwardRef(() => ConversationModule),
        forwardRef(() => UsersModule),
        forwardRef(() => MessageModule),
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>("JWT_SECRET")
            })
        })
    ],
    providers: [
        ChatGateway,
        MessageEmitService,
        GroupEmitService,
        PresenceEmitService,
        RedisCallService,
        CallEmitService,
    ],
    exports: [ChatGateway]
})
export class ChatModule {
}