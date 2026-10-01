import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { getAllowedOrigins } from './config/cors.config';

// dùng chung danh sách domain được phép với cors của rest api
export class CorsSocketIoAdapter extends IoAdapter {
    override createIOServer(port: number, options?: ServerOptions): any {
        const corsOptions: ServerOptions = {
            ...(options ?? {}),
            cors: {
                origin: getAllowedOrigins(),
                credentials: true,
            },
        } as ServerOptions;

        return super.createIOServer(port, corsOptions);
    }
}
