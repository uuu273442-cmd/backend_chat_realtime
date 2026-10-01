export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const ALLOWED_FILE_TYPES = {
    media: [
        // ảnh
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",

        // video
        "video/mp4",
        "video/webm",
        "video/quicktime",  // .mov (iphone)
    ],

    voice: [
        "audio/mpeg",  // mp3
        "audio/wav",
        "audio/webm",
        "audio/ogg",
        "audio/mp4",  // m4a
    ],

    file: [
        // pdf
        "application/pdf",

        // word
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

        // excel
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

        // powerpoint
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",

        // văn bản
        "text/plain",
    ],
};
