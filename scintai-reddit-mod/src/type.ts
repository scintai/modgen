export type ImageModelId = "gemini-3-pro-image-preview" | "imagen-4.0-generate-001" | "imagen-4.0-fast-generate-001" | "imagen-4.0-ultra-generate-001";

export type ModerationInputItem =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

export type AspectRatio = "1:1" | "9:16" | "16:9" | "4:3" | "3:4";
