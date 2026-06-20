import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ExtractedBill {
  vendor_name: string;
  bill_date: string | null;
  line_items: {
    name: string;
    qty: number;
    unit: string;
    unit_price: number;
  }[];
  raw_extract: unknown;
}

/**
 * POST /api/bills/extract
 * Extract vendor, date, and line items from a supplier bill image or PDF.
 * Request: multipart/form-data with "image" field (file or base64 data)
 * Response: { success: true, data: ExtractedBill } or { success: false, error }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get("image") as File | null;

    if (!imageFile) {
      return NextResponse.json(
        { success: false, error: "No image provided" },
        { status: 400 },
      );
    }

    // Read file as base64
    const buffer = await imageFile.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Determine media type
    let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" =
      "image/jpeg";
    if (imageFile.type.includes("png")) mediaType = "image/png";
    else if (imageFile.type.includes("gif")) mediaType = "image/gif";
    else if (imageFile.type.includes("webp")) mediaType = "image/webp";

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 },
      );
    }

    // Call Claude vision via HTTP API
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: "text",
                text: `Extract the following from this supplier invoice/bill image:
1. Vendor name (e.g., "Ocean Direct", "Prime Cuts Co")
2. Bill date (YYYY-MM-DD format, or null if not visible)
3. Line items as a JSON array: [{ "name": "Salmon fillet", "qty": 5, "unit": "kg", "unit_price": 84 }, ...]

Return ONLY valid JSON in this exact format:
{
  "vendor_name": "...",
  "bill_date": "YYYY-MM-DD" or null,
  "line_items": [{ "name": "...", "qty": <number>, "unit": "...", "unit_price": <number> }, ...]
}

Be strict about extracting quantities and prices as numbers. If a line item is incomplete (no qty or price), skip it. Return empty array if no line items found.`,
              },
            ],
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const err = await claudeResponse.text();
      return NextResponse.json(
        { success: false, error: `Claude API error: ${err}` },
        { status: claudeResponse.status },
      );
    }

    const claudeData = (await claudeResponse.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const content = claudeData.content[0];
    if (!content || content.type !== "text") {
      return NextResponse.json(
        { success: false, error: "Unexpected response type" },
        { status: 500 },
      );
    }

    let extracted: ExtractedBill;
    try {
      const parsed = JSON.parse(content.text);
      extracted = {
        vendor_name: parsed.vendor_name || "Unknown Vendor",
        bill_date: parsed.bill_date || null,
        line_items: (parsed.line_items || []).filter(
          (item: unknown) => item && typeof item === "object",
        ),
        raw_extract: parsed,
      };
    } catch (e) {
      return NextResponse.json(
        { success: false, error: "Failed to parse Claude response" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: extracted });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 },
    );
  }
}
