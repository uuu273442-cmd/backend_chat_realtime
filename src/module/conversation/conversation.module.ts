import {forwardRef, Module} from "@nestjs/common";
import {MongooseModule} from "@nestjs/mongoose";

import {Conversation, ConversationSchema} from "./schema/conversation.schema";

import {UsersModule} from "../user/user.module";

import {ConversationService} from "./conversation.service";
import {ConversationController} from "./conversation.controller";

import {ConversationParticipantGuard} from "./guard/conversationParticipant.guard";
import {MessageModule} from "../message/message.module";
import {AttachmentModule} from "../attachment/attachment.module";
import {LinkPreviewModule} from "../link-preview/link-preview.module";
import {RequestJoinRoomModule} from "../requestJoinRoom/requestJoinRoom.module";
import {FriendModule} from "../friend/friend.module";
import {ChatModule} from "../../gateway/chat.module";
import { RedisCacheService } from "../../shared/redis/redisCache.service";

@Module({
    imports: [
        forwardRef(() => MessageModule),
        forwardRef(() => FriendModule),
        ChatModule,
        forwardRef(() => UsersModule),
        AttachmentModule,
        LinkPreviewModule,
        RequestJoinRoomModule,
        MongooseModule.forFeature([{
            name: Conversation.name,
            schema: ConversationSchema,
            collection: "conversations"
        }]),
    ],
    providers: [
        ConversationService,
        ConversationParticipantGuard,
        RedisCacheService
    ],
    controllers: [ConversationController],
    exports: [
        ConversationService,
        ConversationParticipantGuard
    ],
})
export class ConversationModule {
}