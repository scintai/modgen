export type ModerationInputItem =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

export type AspectRatio = "1:1" | "9:16" | "16:9" | "4:3" | "3:4";
