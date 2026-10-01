import {BadRequestException, ValidationError, ValidationPipe} from "@nestjs/common";

// thông báo lỗi dữ liệu đầu vào bằng tiếng việt, theo tên rule của class-validator
const RULE_MESSAGES: Record<string, (field: string) => string> = {
    isNotEmpty: (f) => `${f} không được để trống`,
    isString: (f) => `${f} phải là chuỗi`,
    isEmail: (f) => `${f} không đúng định dạng email`,
    isMongoId: (f) => `${f} không phải id hợp lệ`,
    isEnum: (f) => `${f} có giá trị không hợp lệ`,
    isBoolean: (f) => `${f} phải là true hoặc false`,
    isNumber: (f) => `${f} phải là số`,
    isArray: (f) => `${f} phải là mảng`,
    minLength: (f) => `${f} quá ngắn`,
    maxLength: (f) => `${f} quá dài`,
    min: (f) => `${f} nhỏ hơn giá trị cho phép`,
    max: (f) => `${f} lớn hơn giá trị cho phép`,
    arrayMinSize: (f) => `${f} chưa đủ số lượng tối thiểu`,
};

// gom lỗi của cả các object lồng nhau
const flatten = (errors: ValidationError[], parent = ""): string[] =>
    errors.flatMap((err) => {
        const field = parent ? `${parent}.${err.property}` : err.property;
        const own = Object.entries(err.constraints ?? {}).map(
            ([rule, original]) => RULE_MESSAGES[rule]?.(field) ?? original
        );
        return [...own, ...flatten(err.children ?? [], field)];
    });

export const createValidationPipe = () =>
    new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) => new BadRequestException(flatten(errors)),
    });
