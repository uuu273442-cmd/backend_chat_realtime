import {Model, Types} from "mongoose";
import {ForbiddenException, Injectable} from "@nestjs/common";
import {InjectModel} from "@nestjs/mongoose";
import axios from "axios";
import * as cheerio from "cheerio";
import {LinkPreview, LinkPreviewDocument} from "./schema/link-preview.schema";
import {convertStringToObjectId} from "../../shared/helpers/convertObjectId.helpers";

@Injectable()
export class LinkPreviewService {
    constructor(
        @InjectModel(LinkPreview.name)
        private readonly linkPreviewModel: Model<LinkPreviewDocument>
    ) {
    }

    private async fetchMetadata(url: string): Promise<{
        title?: string;
        description?: string;
        image?: string;
    } | null> {
        try {
            const {data} = await axios.get(url, {
                timeout: 5000,
                headers: {"User-Agent": "Mozilla/5.0 (compatible; ChatBot/1.0)"},
            });
            const $ = cheerio.load(data);
            const meta = (prop: string) =>
                $(`meta[property='${prop}']`).attr("content") ||
                $(`meta[name='${prop}']`).attr("content");

            return {
                title: meta("og:title") || $("title").text() || undefined,
                description: meta("og:description") || undefined,
                image: meta("og:image") || undefined,
            };
        } catch (err) {
            throw new ForbiddenException("Không thể đọc bản xem trước của liên kết");
        }
    }

    public async fetchLink(
        url: string,
        messageId: string,
        conversationId: string,
        userId: string,
    ) {
        const senderId = convertStringToObjectId(userId);
        const conversationObjectId = convertStringToObjectId(conversationId);
        const messageObjectId = convertStringToObjectId(messageId);

        const existingMeta = await this.linkPreviewModel
            .findOne({url}, {title: 1, description: 1, image: 1})
            .lean();

        const metadata = existingMeta ?? await this.fetchMetadata(url);
        if (!metadata) return null;

        return this.linkPreviewModel.create({
            senderId,
            messageId: messageObjectId,
            conversationId: conversationObjectId,
            url,
            title: metadata.title,
            description: metadata.description,
            image: metadata.image,
        });
    }

    public async getLinkPreviews(ids: Types.ObjectId[]) {
        return this.linkPreviewModel.find({messageId: {$in: ids}}).lean();
    }

    public async groupLinkPreviewsById(ids: Types.ObjectId[]) {
        const linkPreviews = await this.getLinkPreviews(ids);

        return linkPreviews.reduce<Record<string, LinkPreviewDocument[]>>(
            (acc, link) => {
                const mgsId = link.messageId.toString();
                if (!acc[mgsId]) acc[mgsId] = [];
                acc[mgsId].push(link);
                return acc;
            }, {});
    }

    public async getLinkPreview(room: string, limit = 50) {
        return this.linkPreviewModel
            .find({conversationId: convertStringToObjectId(room)})
            .sort({createdAt: -1})
            .limit(limit)
            .lean();
    }

    public async cleanLinkPreview(conversationId: string) {
        const convObjectId = convertStringToObjectId(conversationId);
        await this.linkPreviewModel.deleteMany({conversationId: convObjectId});
    }
}