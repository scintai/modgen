import type { Context } from '@devvit/public-api';
import OpenAI from 'openai';

import { ModerationInputItem, AspectRatio } from './type.js';


export function extractAspectRatio(input: string): AspectRatio | undefined {
    // Regex matches only allowed ratios after ar@
    const regex = /ar@(1:1|9:16|16:9|4:3|3:4)/g;

    const matches = [...input.matchAll(regex)];

    if (matches.length === 0) {
        return undefined;
    }

    // Take the LAST occurrence
    const lastMatch = matches[matches.length - 1][1];

    return lastMatch as AspectRatio;
}

export async function sendMessage(username: string, subject: string, message: string, context: Context) {
    await context.reddit.sendPrivateMessage({
        subject: subject,
        text: message,
        to: username,
    });
}

export async function removePostWithReason(postId: string, reason: string, context: Context) {
    const post = await context.reddit.getPostById(postId);

    // 2. Remove the post
    await post.remove(false);
    await post.addComment({
        text: `❌ Post Removed ❌ - ${reason}`,
    })
}


export function extractPrompt(text: string): string | undefined {
    if (typeof text !== "string") return undefined;

    const patterns = [
        /prompt@start\s*([\s\S]*?)\s*prompt@end/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const prompt = match[1].trim();
            if (prompt) return prompt;
        }
    }

    return undefined;
}


export const checkModeration = async (prompt: string, apiKey: string) => {
    const client = new OpenAI({
        apiKey: apiKey
    });
    const moderationInput: ModerationInputItem[] = [{ type: "text", text: prompt }];

    // if (images && images.length > 0) {
    //   for (const image of images) {
    //     moderationInput.push({
    //       type: "image_url",
    //       image_url: {
    //         url: image
    //       }
    //     });
    //   }
    // }

    try {
        const moderation = await client.moderations.create({
            model: "omni-moderation-latest",
            input: moderationInput,
        });

        const BLOCKED_CATEGORIES = [
            "sexual",
            "sexual/minors",
            "hate",
            "hate/threatening",
            "harassment",
            "harassment/threatening",
            "self-harm",
            "self-harm/intent",
            "self-harm/instructions",
        ];

        if (moderation.results[0].flagged) {
            const categories = moderation.results[0].categories;
            const violatedCategories = Object.keys(categories).filter(
                (key) => {
                    // Check if the category is true AND it is in our blocked list
                    return categories[key as keyof typeof categories] && BLOCKED_CATEGORIES.includes(key);
                }
            );


            if (violatedCategories.length > 0) {
                return { flagged: true, categories: violatedCategories };
            }
        }
        return { flagged: false, categories: [] };
    } catch (modError) {
        console.error("Moderation API Error:", modError);
        // Fail closed (secure default)
        return { flagged: true, categories: ["Moderation Check Failed"] };
    }
}



export async function generateImage(
    prompt: string,
    apiKey: string,
    modelId: string = "gemini-3-pro-image-preview",
    aspectRatio: AspectRatio = "1:1"
): Promise<{ data: string, mimeType: string } | undefined> {

    // Check if it's a Gemini model (nano banana) or Imagen model
    const isGeminiModel = modelId === "gemini-3-pro-image-preview";

    if (isGeminiModel) {
        return generateImageWithGemini(prompt, apiKey, modelId, aspectRatio);
    } else {
        return generateImageWithImagen(prompt, apiKey, modelId, aspectRatio);
    }
}

/**
 * Generate image using Gemini (Nano Banana Pro) model
 */
async function generateImageWithGemini(
    prompt: string,
    apiKey: string,
    modelId: string,
    aspectRatio: AspectRatio
): Promise<{ data: string, mimeType: string } | undefined> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [
                        { text: prompt }
                    ]
                }],
                generationConfig: {
                    responseModalities: ["IMAGE", "TEXT"],
                    imageConfig: {
                        image_size: "1K",
                        aspect_ratio: aspectRatio
                    }
                },
                tools: [{
                    googleSearch: {}
                }]
            })
        });

        if (!response.ok) {
            console.error(`Gemini API Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Error details:", text);
            return undefined;
        }

        const data = await response.json();
        const chunks = Array.isArray(data) ? data : [data];

        for (const chunk of chunks) {
            if (chunk.candidates) {
                for (const candidate of chunk.candidates) {
                    if (candidate.content && candidate.content.parts) {
                        for (const part of candidate.content.parts) {
                            if (part.inlineData && part.inlineData.data) {
                                console.log("Gemini: Image received as base64 data");
                                return {
                                    data: part.inlineData.data,
                                    mimeType: part.inlineData.mimeType || "image/png"
                                };
                            }
                        }
                    }
                }
            }
        }

    } catch (error) {
        console.error("Gemini API Request Failed:", error);
    }

    return undefined;
}

/**
 * Generate image using Imagen 4 models (Imagen 4, Imagen 4 Ultra, Imagen 4 Fast)
 */
async function generateImageWithImagen(
    prompt: string,
    apiKey: string,
    modelId: string,
    aspectRatio: AspectRatio
): Promise<{ data: string, mimeType: string } | undefined> {
    // Ensure model ID has proper format for the API
    const formattedModelId = `models/${modelId}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${formattedModelId}:predict?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                instances: [{ prompt }],
                parameters: {
                    outputMimeType: "image/jpeg",
                    sampleCount: 1,
                    personGeneration: "ALLOW_ALL",
                    aspectRatio: aspectRatio,
                    imageSize: "2K"
                }
            })
        });

        if (!response.ok) {
            console.error(`Imagen API Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Error details:", text);
            return undefined;
        }

        const data = await response.json() as { predictions?: Array<{ bytesBase64Encoded?: string }> };

        // Extract the base64 encoded image from predictions
        const images = (data.predictions || [])
            .map(p => p.bytesBase64Encoded)
            .filter(Boolean);

        if (images.length > 0 && images[0]) {
            return {
                data: images[0],
                mimeType: "image/jpeg"
            };
        }
        return undefined;

    } catch (error) {
        return undefined
    }
}
