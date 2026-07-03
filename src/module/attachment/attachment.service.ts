import {Model, Types} from "mongoose";
import {Injectable} from "@nestjs/common";
import {InjectModel} from "@nestjs/mongoose";

import {Attachment, AttachmentDocument} from "./schema/attachment.schema";
import {CloudService} from "../../shared/cloud/cloud.service";
import {convertStringToObjectId} from "../../shared/helpers/convertObjectId.helpers";

@Injectable()
export class AttachmentService {
    constructor(
        @InjectModel(Attachment.name)
        private readonly attachmentModel: Model<AttachmentDocument>,
        private readonly cloudService: CloudService,
    ) {
    }

    public async uploadFiles(
        files: Express.Multer.File[],
        messageId: string,
        uploaderId: string,
        conversationId: string,
    ) {
        const res = await this.cloudService.uploadMultiple(
            files,
            messageId,
            conversationId,
            uploaderId
        );

        return this.attachmentModel.insertMany(res);
    }

    public async uploadMedias(
        files: Express.Multer.File[],
        messageId: string,
        uploaderId: string,
        conversationId: string,
    ) {
        return this.uploadFiles(
            files,
            messageId,
            uploaderId,
            conversationId,
        );
    }

    public async uploadVoice(
        file: Express.Multer.File,
        messageId: string,
        uploaderId: string,
        conversationId: string,
    ) {
        const uploaderObjectId = convertStringToObjectId(uploaderId);
        const messageObjectId = convertStringToObjectId(messageId);
        const conversationObjectId = convertStringToObjectId(conversationId);

        const upload = await this.cloudService.uploadSingle(file, "voice");
        return this.attachmentModel.create({
            messageId: messageObjectId,
            conversationId: conversationObjectId,
            uploaderId: uploaderObjectId,
            type: "voice",
            url: upload.url,
            publicId: upload.publicId,
            thumbnail: upload.thumbnail,
            filename: file.filename,
            originalName: file.originalname,
            size: upload.size,
            mimeType: upload.mimeType,
            duration: upload.duration,
        });
    }

    public async uploadAvatarProfile(
        file: Express.Multer.File,
        uploaderId: string,
    ) {
        // Avatar không gắn với message/conversation nào — chỉ cần upload lên
        // cloud và trả về URL string, không tạo Attachment document (tránh
        // record rác với messageId/conversationId null, và tránh bug cũ
        // set type: "voice" sai + trả về cả document thay vì URL string)
        const upload = await this.cloudService.uploadSingle(file, "image");
        return upload.url;
    }

    public async getAttachments(ids: Types.ObjectId[]) {
        return this.attachmentModel.find({messageId: {$in: ids}}).lean();
    }

    public async groupAttachmentsById(ids: Types.ObjectId[]) {
        const attachments = await this.getAttachments(ids);

        return attachments.reduce<Record<string, AttachmentDocument[]>>(
            (acc, att) => {
                const mgsId = att.messageId.toString();
                if (!acc[mgsId]) acc[mgsId] = [];
                acc[mgsId].push(att);
                return acc;
            }, {});
    }

    public async getAttachmentRoomMedia(room: string) {
        return this.attachmentModel.find({
            conversationId: convertStringToObjectId(room),
            type: {$in: ["video", "image"]},
        })
            .lean();
    }

    public async getAttachmentRoomFile(room: string) {
        return this.attachmentModel.find({
            conversationId: convertStringToObjectId(room),
            type: "file",
        })
            .lean();
    }

    public async cleanDateAttachments(conversationId: string) {
        const convObjectId = convertStringToObjectId(conversationId);
        const attachments = await this.attachmentModel.find({
            conversationId: convObjectId,
        });
        const mapIds = attachments.map(att => att._id);
        if (!attachments.length) return;

        await Promise.all([
            this.cloudService.cleanDataFile(attachments),
            this.attachmentModel.deleteMany({_id: {$in: mapIds}})
        ]);
    }
}