import {Injectable, InternalServerErrorException} from "@nestjs/common";
import {v2 as cloudinary} from "cloudinary";
import * as fs from "node:fs";

import {CloudUpload, UploadFileType} from "./cloud.types";
import {convertStringToObjectId} from "../helpers/convertObjectId.helpers";
import {AttachmentDocument} from "../../module/attachment/schema/attachment.schema";

@Injectable()
export class CloudService {
    constructor() {
        cloudinary.config({
            cloud_name: process.env.CLOUD_NAME,
            api_key: process.env.CLOUD_API_KEY,
            api_secret: process.env.CLOUD_API_SECRET,
        });
    }

    public async uploadSingle(
        file: Express.Multer.File,
        type: UploadFileType,
    ): Promise<CloudUpload> {
        try {
            const resourceType = type === "image"
                ? "image" : type === "video" || type === "voice" ? "video" : "raw"
            const res = await cloudinary.uploader.upload(
                file.path,
                {
                    resource_type: resourceType,
                    folder: `chat/${type}`,
                    use_filename: true,
                    unique_filename: true,
                }
            );
            return {
                url: res.secure_url,
                size: res.bytes,
                publicId: res.public_id,
                thumbnail: res.resource_type === "image"
                    ? res.secure_url.replace("upload", "upload/w_300")
                    : undefined,
                mimeType: res.mimetype,
                originalName: res.original_filename,
                duration: res.duration,
            }
        } catch (err) {
            throw new InternalServerErrorException("Upload to Cloudinary failed");
        } finally {
            fs.unlink(file.path, () => {
            });
        }
    }

    public async uploadMultiple(
        files: Express.Multer.File[],
        messageId: string,
        conversationId: string,
        uploaderId: string,
    ) {
        const messageObjectId = convertStringToObjectId(messageId);
        const convObjectId = convertStringToObjectId(conversationId);
        const uploaderObjectId = convertStringToObjectId(uploaderId);

        const uploads = [];
        for (const file of files) {
            const type = this.detectType(file.mimetype);
            const upload = await this.uploadSingle(file, type);
            uploads.push({
                messageId: messageObjectId,
                conversationId: convObjectId,
                uploaderId: uploaderObjectId,
                type: type,
                url: upload.url,
                thumbnail: upload.thumbnail,
                filename: file.filename,
                originalName: file.originalname,
                size: upload.size,
                mimeType: upload.mimeType,
                duration: upload.duration,
                publicId: upload.publicId
            });
        }
        return uploads;
    }

    private detectType(mime: string) {
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("video/")) return "video";
        return "file";
    }

    public async cleanDataFile(attachments: AttachmentDocument[]) {
        const filesToDelete: {image: string[], video: string[], raw: string[]} = {
            image: [],
            video: [],
            raw: [],
        };
        attachments.forEach((item) => {
            if (item.type === 'image') filesToDelete.image.push(item.publicId);
            else if (['video', 'voice'].includes(item.type)) filesToDelete.video.push(item.publicId);
            else if (item.type === 'file') filesToDelete.raw.push(item.publicId);
        });
        const deletePromises = [];
        if (filesToDelete.image.length > 0) {
            deletePromises.push(cloudinary.api.delete_resources(filesToDelete.image, { resource_type: 'image' }));
        }
        if (filesToDelete.video.length > 0) {
            deletePromises.push(cloudinary.api.delete_resources(filesToDelete.video, { resource_type: 'video' }));
        }
        if (filesToDelete.raw.length > 0) {
            deletePromises.push(cloudinary.api.delete_resources(filesToDelete.raw, { resource_type: 'raw' }));
        }
        await Promise.all(deletePromises);
    }
}