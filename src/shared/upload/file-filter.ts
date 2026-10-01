import {BadRequestException} from "@nestjs/common";

import {ALLOWED_FILE_TYPES} from "./upload.constants";
import {CloudUploadType} from "../cloud/cloud.types";

export const createFileFilter =
    (type: CloudUploadType) =>
        (req: any, file: Express.Multer.File, cb: Function) => {
            const allowed = ALLOWED_FILE_TYPES[type];
            if (!allowed.includes(file.mimetype)) {
                return cb(
                    new BadRequestException(
                        `Không cho phép định dạng tệp ${file.mimetype}`
                    ),
                    false,
                );
            }

            cb(null, true);
        };