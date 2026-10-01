import {ArgumentsHost, Catch, ExceptionFilter, HttpException} from "@nestjs/common";
import {Response} from "express";

// dịch các thông báo mặc định của nestjs sang tiếng việt
const DEFAULT_MESSAGES: Record<string, string> = {
    "Unauthorized": "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn",
    "Forbidden resource": "Bạn không có quyền thực hiện thao tác này",
    "ThrottlerException: Too Many Requests": "Bạn thao tác quá nhanh, vui lòng thử lại sau",
    "Too Many Requests": "Bạn thao tác quá nhanh, vui lòng thử lại sau",
    "Internal server error": "Lỗi hệ thống, vui lòng thử lại sau",
};

const translate = (text: string) =>
    DEFAULT_MESSAGES[text]
    ?? (text.startsWith("Cannot ") ? "Không tìm thấy đường dẫn yêu cầu" : text);

@Catch(HttpException)
export class VietnameseExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost) {
        const res = host.switchToHttp().getResponse<Response>();
        const status = exception.getStatus();
        const body = exception.getResponse();

        if (typeof body === "string") {
            return res.status(status).json({statusCode: status, message: translate(body)});
        }

        const payload = body as Record<string, any>;
        const message = Array.isArray(payload.message)
            ? payload.message.map(translate)
            : translate(String(payload.message ?? exception.message));

        res.status(status).json({...payload, message});
    }
}
