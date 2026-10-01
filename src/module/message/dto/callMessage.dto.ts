import {IsEnum, IsMongoId, IsNumber, IsOptional, Min} from "class-validator";
import {Type} from "class-transformer";

// dùng nội bộ khi gateway tạo tin nhắn cuộc gọi
export class CreateCallMessageDto {
    @IsMongoId()
    conversationId!: string;

    // người gọi
    @IsMongoId()
    callerId!: string;

    @IsEnum(["voice"])
    callType!: "voice";

    @IsEnum(["missed", "cancelled", "ended", "started"])
    status!: "missed" | "cancelled" | "ended" | "started";

    // thời lượng (giây), chỉ có khi status = "ended"
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    duration?: number;

    // lúc bắt máy
    @IsOptional()
    startedAt?: Date;

    // lúc kết thúc
    @IsOptional()
    endedAt?: Date;

    // tất cả userId đã tham gia
    @IsOptional()
    @IsMongoId({each: true})
    participantIds?: string[];
}
