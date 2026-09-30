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
            throw new ForbiddenException("User does not in private conversation");
        }

        // Lưu lại để các guard và service phía sau dùng lại, không phải truy vấn lần nữa
        req.conversation = isMember;
        return true;
    }
}