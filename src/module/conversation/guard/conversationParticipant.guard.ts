import {CanActivate, ExecutionContext, ForbiddenException, Injectable} from "@nestjs/common";

import {ConversationService} from "../conversation.service";

@Injectable()
export class ConversationParticipantGuard implements CanActivate {
    constructor(
        private readonly conversationService: ConversationService,
    ) {
    }

    async canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        const userId = req.user.userId;
        const conversationId = req.params.id;

        const isMember = await this.conversationService
            .findUserParticipants(
                userId,
                conversationId,
            );
        if (!isMember) {
            throw new ForbiddenException("Bạn không thuộc cuộc trò chuyện này");
        }

        // lưu lại cho guard và service phía sau dùng
        req.conversation = isMember;
        return true;
    }
}