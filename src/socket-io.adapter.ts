import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { getAllowedOrigins } from './config/cors.config';

// Vì sao cần adapter riêng thay vì chỉ khai báo cors trong @WebSocketGateway:
// Nest tạo Socket.IO server thông qua adapter này, còn cors khai báo trong
// @WebSocketGateway({cors: {...}}) chỉ áp dụng cho namespace/gateway đó ở
// một số phiên bản/kịch bản triển khai, không đảm bảo áp dụng cho tầng
// engine.io transport bên dưới (đặc biệt là bước bắt tay polling trước khi
// nâng cấp lên websocket). Ghi đè createIOServer đảm bảo mọi kết nối tới
// server socket.io — bất kể namespace nào — đều dùng cùng 1 danh sách domain
// được phép, giống hệt danh sách dùng cho CORS của REST API.
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
