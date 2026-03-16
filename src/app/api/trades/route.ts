import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/trades — List all simulated trades
 * Query params: status=OPEN|CLOSED_PROFIT|CLOSED_LOSS|ASSIGNED|EXPIRED|all (default: all)
 */
export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    await ensureSchema();
    const status = request.nextUrl.searchParams.get("status");

    let rows;
    if (status && status !== "all") {
      rows = await db`
        SELECT * FROM simulated_trades
        WHERE status = ${status}
        ORDER BY created_at DESC
      `;
    } else {
      rows = await db`
        SELECT * FROM simulated_trades
        ORDER BY created_at DESC
      `;
    }

    return NextResponse.json({ trades: rows });
  } catch (err) {
    console.error("[trades] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch trades" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trades — Create a new simulated trade
 */
export async function POST(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  try {
    await ensureSchema();
    const body = await request.json();

    const {
      symbol,
      companyName,
      strikePrice,
      expiration,
      dteAtEntry,
      premiumReceived,
      stockPriceAtEntry,
      deltaAtEntry,
      scoreAtEntry,
      stabilityScoreAtEntry,
      ivRankAtEntry,
      notes,
    } = body;

    if (!symbol || !strikePrice || !expiration || !premiumReceived || !stockPriceAtEntry) {
      return NextResponse.json(
        { error: "Missing required fields: symbol, strikePrice, expiration, premiumReceived, stockPriceAtEntry" },
        { status: 400 }
      );
    }

    const collateral = strikePrice * 100;

    const rows = await db`
      INSERT INTO simulated_trades (
        symbol, company_name, strike_price, expiration, dte_at_entry,
        premium_received, stock_price_at_entry, delta_at_entry,
        score_at_entry, stability_score_at_entry, iv_rank_at_entry,
        collateral, notes
      ) VALUES (
        ${symbol}, ${companyName ?? null}, ${strikePrice}, ${expiration}, ${dteAtEntry ?? 0},
        ${premiumReceived}, ${stockPriceAtEntry}, ${deltaAtEntry ?? null},
        ${scoreAtEntry ?? null}, ${stabilityScoreAtEntry ?? null}, ${ivRankAtEntry ?? null},
        ${collateral}, ${notes ?? null}
      )
      RETURNING *
    `;

    return NextResponse.json({ trade: rows[0] }, { status: 201 });
  } catch (err) {
    console.error("[trades] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create trade" },
      { status: 500 }
    );
  }
}
