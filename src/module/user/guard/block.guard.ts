import {CanActivate, ExecutionContext, ForbiddenException} from "@nestjs/common";
import {Injectable} from "@nestjs/common";
import {UserService} from "../user.service";
import {ConversationService} from "../../conversation/conversation.service";
import {ConversationDocument} from "../../conversation/schema/conversation.schema";

@Injectable()
export class BlockGuard implements CanActivate {
    constructor(
        private readonly userService: UserService,
        private readonly conversationService: ConversationService,
    ) {
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const room = req.params.id;
        const userId = req.user.userId;

        // dùng lại hội thoại đã được guard trước tải sẵn
        const findConv: ConversationDocument = req.conversation
            ?? await this.conversationService.findConversation(room);
        if (findConv.type === "group") return true;
        const otherId = findConv.participants.find(
            obj => obj.userId.toString() !== userId
        )?.userId.toString();

        if (!otherId) return true;
        const isBlocked = await this.userService.isBlocked(userId, otherId);
        if (isBlocked) throw new ForbiddenException("Người dùng đã bị chặn");

        return true;
    }
}