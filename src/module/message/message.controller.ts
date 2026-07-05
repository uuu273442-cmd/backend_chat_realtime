import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
    Query,
    Delete,
    UseInterceptors,
    UploadedFiles,
    UploadedFile,
} from "@nestjs/common";
import {FileInterceptor, FilesInterceptor} from "@nestjs/platform-express";

import {MessageService} from "./message.service";

import {JwtAuthGuard} from "../auth/guards/jwt-auth.guard";
import {ConversationParticipantGuard} from "../conversation/guard/conversationParticipant.guard";
import {MessageConversationGuard} from "../conversation/guard/messageConversation.guard";
import {BlockGuard} from "../user/guard/block.guard";

import {JwtDecode} from "../../common/decorators/jwt.decorator";
import {JwtType} from "../../shared/types/jwtTypes.type";

import {ConversationIdDto} from "../conversation/dto/conversationId.dto";
import {CreateMessageDto} from "./dto/createMessage.dto";
import {ReactEmojiDto} from "./dto/reactEmoji.dto";
import {EditMessageDto} from "./dto/editMessage.dto";
import {DeleteMessageDto} from "./dto/deleteMessage.dto";
import {QueryDeleteMessageDto} from "./dto/queryDeleteMessage.dto";
import {ForwardMessageDto} from "./dto/forwardMessage.dto";
import {UnreactEmojiDto} from "./dto/unreactEmoji.dto";
import {UploadFilesDto} from "./dto/uploadFiles.dto";
import {LinkPreviewDto} from "./dto/linkPreview.dto";
import {SearchMessageDto} from "./dto/search.dto";
import {PinMessageDto} from "./dto/pinMessage.dto";
import {PaginationDto} from "./dto/pagination.dto";

import {createMulterOptions} from "../../shared/upload/upload.config";

@Controller("messages")
@UseGuards(JwtAuthGuard, ConversationParticipantGuard)
export class MessageController {
    constructor(
        private readonly messageService: MessageService
    ) {
    }

    @UseGuards(BlockGuard)
    @Post(":id")
    public async message(
        @Param("id") room: ConversationIdDto["id"],
        @Body() dto: CreateMessageDto,
        @JwtDecode() user: JwtType
    ) {
        return this.messageService.create(
            user.userId,
            room,
            dto.content,
            dto?.replyTo,
            dto?.mentions
        );
    }

    @UseGuards(MessageConversationGuard)
    @Post(":id/pin")
    public async pin(
        @Body() dto: PinMessageDto,
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType
    ) {
        return this.messageService.pin(dto.id, user.userId, room);
    }

    @UseGuards(MessageConversationGuard)
    @Patch(":id/unpin")
    public async unpin(
        @Body() dto: PinMessageDto,
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType
    ) {
        return this.messageService.unpin(dto.id, user.userId, room);
    }

    @UseGuards(BlockGuard)
    @Post(":id/file")
    @UseInterceptors(
        FilesInterceptor(
            "files",
            10,
            createMulterOptions("file")
        )
    )
    public async uploadFiles(
        @UploadedFiles() files: Express.Multer.File[],
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType,
        @Body() dto: UploadFilesDto,
    ) {
        return this.messageService.uploadFiles(
            files,
            room,
            user.userId,
            dto?.replyTo,
        );
    }

    @UseGuards(BlockGuard)
    @Post(":id/media")
    @UseInterceptors(
        FilesInterceptor(
            "files",
            10,
            createMulterOptions("media")
        )
    )
    public async uploadMedias(
        @UploadedFiles() files: Express.Multer.File[],
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType,
        @Body() dto: UploadFilesDto,
    ) {
        return this.messageService.uploadMedias(
            files,
            room,
            user.userId,
            dto?.replyTo,
        );
    }

    @UseGuards(BlockGuard)
    @Post(":id/voice")
    @UseInterceptors(
        FileInterceptor(
            "file",
            createMulterOptions("voice")
        )
    )
    public async uploadVoice(
        @UploadedFile() file: Express.Multer.File,
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType,
        @Body() dto: UploadFilesDto
    ) {
        return this.messageService.uploadVoice(
            file,
            room,
            user.userId,
            dto?.replyTo,
        )
    }

    @UseGuards(BlockGuard)
    @Post(":id/link-preview")
    public async linkPreview(
        @Param("id") room: ConversationIdDto["id"],
        @Body() dto: LinkPreviewDto,
        @JwtDecode() user: JwtType,
    ) {
        return this.messageService.create(
            user.userId,
            room,
            dto.content,
            dto?.replyTo,
        )
    }

    @UseGuards(MessageConversationGuard)
    @Patch(":id")
    public async editMessage(
        @JwtDecode() user: JwtType,
        @Body() body: EditMessageDto
    ) {
        return this.messageService.edit(
            user.userId,
            body.content,
            body.id
        )
    }

    @Get(":id")
    public async getMessages(
        @Param("id") room: ConversationIdDto["id"],
        @Query() query: PaginationDto
    ) {
        return this.messageService.messages(
            room,
            query.limit,
            query.before,
        );
    }

    @Get(":id/search")
    public async search(
        @Query() dto: SearchMessageDto,
        @Param("id") room: ConversationIdDto["id"],
    ) {
        return this.messageService.search(dto.q, room);
    }

    @UseGuards(MessageConversationGuard, BlockGuard)
    @Post("/:id/react")
    public async reactMessage(
        @JwtDecode() user: JwtType,
        @Body() dto: ReactEmojiDto
    ) {
        return this.messageService.react(
            dto.id,
            user.userId,
            dto.emoji
        );
    }

    @UseGuards(MessageConversationGuard, BlockGuard)
    @Patch("/:id/unreact")
    public async unreactMessage(
        @JwtDecode() user: JwtType,
        @Body() dto: UnreactEmojiDto
    ) {
        return this.messageService.unreact(
            dto.id,
            user.userId,
        )
    }

    @Patch(":id/seen")
    public async markAsSeen(
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType
    ) {
        return this.messageService.markAsSeen(
            room,
            user
        );
    }

    @UseGuards(MessageConversationGuard)
    @Delete(":id")
    public async deleteMessage(
        @Param("id") room: ConversationIdDto["id"],
        @JwtDecode() user: JwtType,
        @Body() body: DeleteMessageDto,
        @Query() query: QueryDeleteMessageDto
    ) {
        return this.messageService.delete(
            room,
            body.id,
            user.userId,
            query.scope
        );
    }

    @UseGuards(MessageConversationGuard, BlockGuard)
    @Post(":id/forward")
    public async forwardMessage(
        @JwtDecode() user: JwtType,
        @Body() body: ForwardMessageDto
    ) {
        return this.messageService.forwardMessage(
            user.userId,
            body.id,
            body.conversationIds
        )
    }
}