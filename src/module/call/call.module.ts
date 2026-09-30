import {Module} from "@nestjs/common";

import {CallController} from "./call.controller";

@Module({
    controllers: [CallController],
})
export class CallModule {
}
