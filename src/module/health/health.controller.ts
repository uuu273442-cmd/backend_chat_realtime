import {Controller, Get} from "@nestjs/common";
import {SkipThrottle} from "@nestjs/throttler";

// kiểm tra server còn sống, không truy vấn database
@SkipThrottle()
@Controller("health")
export class HealthController {
    @Get()
    public check() {
        return {status: "ok", uptime: Math.round(process.uptime())};
    }
}
