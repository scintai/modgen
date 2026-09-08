import OpenAI from 'openai';
export function extractAspectRatio(input) {
    // Regex matches only allowed ratios after ar@
    const regex = /ar@(1:1|9:16|16:9|4:3|3:4)/g;
    const matches = [...input.matchAll(regex)];
    if (matches.length === 0) {
        return undefined;
    }
    // Take the LAST occurrence
    const lastMatch = matches[matches.length - 1][1];
    return lastMatch;
}
export async function sendMessage(username, subject, message, context) {
    await context.reddit.sendPrivateMessage({
        subject: subject,
        text: message,
        to: username,
    });
}
export async function removePostWithReason(postId, reason, context) {
    const post = await context.reddit.getPostById(postId);
    // 2. Remove the post
    await post.remove(false);
    await post.addComment({
        text: `❌ Post Removed ❌ - ${reason}`,
    });
}
export function extractPrompt(text) {
    if (typeof text !== "string")
        return undefined;
    const patterns = [
        /prompt@start\s*([\s\S]*?)\s*prompt@end/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const prompt = match[1].trim();
            if (prompt)
                return prompt;
        }
    }
    return undefined;
}
export const checkModeration = async (prompt, apiKey) => {
    const client = new OpenAI({
        apiKey: apiKey
    });
    const moderationInput = [{ type: "text", text: prompt }];
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
        // Only minor-sexual content is blocked. Everything else (adult
        // consensual content, hate, harassment, self-harm, etc.) passes —
        // this bot serves an adult platform, the underage firewall is the
        // single hard rule.
        const BLOCKED_CATEGORIES = [
            "sexual/minors",
        ];
        if (moderation.results[0].flagged) {
            const categories = moderation.results[0].categories;
            const violatedCategories = Object.keys(categories).filter((key) => {
                // Check if the category is true AND it is in our blocked list
                return categories[key] && BLOCKED_CATEGORIES.includes(key);
            });
            if (violatedCategories.length > 0) {
                return { flagged: true, categories: violatedCategories };
            }
        }
        return { flagged: false, categories: [] };
    }
    catch (modError) {
        console.error("Moderation API Error:", modError);
        // Fail closed (secure default)
        return { flagged: true, categories: ["Moderation Check Failed"] };
    }
};
function stripTrailingSlash(url) {
    return url.trim().replace(/\/$/, "");
}
// Fire-and-forget enqueue: returns instantly with the job id (uid).
// The caller must poll getOffloadStatus() — never await generation here:
// Devvit HTTP calls time out after 30s, GPU generation takes minutes.
export async function enqueueOffload(baseUrl, apiKey, prompt, aspectRatio, uid) {
    const url = `${stripTrailingSlash(baseUrl)}/api/offload/scintai`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
        },
        body: JSON.stringify({ prompt, aspectRatio, uid }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Enqueue failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return await response.json();
}
// Lazy poll: modgen returns the cached terminal result, otherwise
// live-proxies the GPU worker. queued/started/pending = not ready yet.
export async function getOffloadStatus(baseUrl, apiKey, uid) {
    const url = `${stripTrailingSlash(baseUrl)}/api/offload/scintai/${encodeURIComponent(uid)}`;
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "X-Api-Key": apiKey,
        },
    });
    if (response.status === 404) {
        throw new Error("Offload not found (unknown uid)");
    }
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Poll failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return await response.json();
}
