import {CanActivate, ConflictException, ExecutionContext, Injectable, NotFoundException} from "@nestjs/common";

import {ConversationService} from "../conversation.service";
import {MessageService} from "../../message/message.service";

@Injectable()
export class MessageConversationGuard implements CanActivate {
    constructor(
        private readonly conversationService: ConversationService,
        private readonly messageService: MessageService
    ) {
    }

    async canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        const messageId: string = req.body.id;
        const conversationId: string = req.params.id;

        const [findConversation, findMessage] = await Promise.all([
            this.conversationService.findById(conversationId),
            this.messageService.findByIdCheck(messageId)
        ])
        if (!findConversation || !findMessage) {
            throw new NotFoundException("conversation or Không tìm thấy tin nhắn");
        }
        if (findConversation._id.toString() !== findMessage.conversationId.toString()) {
            throw new ConflictException("Tin nhắn không thuộc cuộc trò chuyện này");
        }

        return true;
    }
}