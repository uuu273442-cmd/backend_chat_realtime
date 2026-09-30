import {Controller, Get} from "@nestjs/common";
import {SkipThrottle} from "@nestjs/throttler";

// Endpoint kiểm tra server còn sống.
// Dùng cho dịch vụ ping định kỳ (giúp Render bản miễn phí không bị ngủ đông)
// và không truy vấn database nên trả lời rất nhanh.
@SkipThrottle()
@Controller("health")
export class HealthController {
    @Get()
    public check() {
        return {status: "ok", uptime: Math.round(process.uptime())};
    }
}
