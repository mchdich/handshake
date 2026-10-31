import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { contracts, milestones } from "@/lib/db";
import { fail, workspace } from "@/lib/http";
import { newContract } from "@/lib/seed";

export async function GET() {
  try {
    const ws = await workspace();
    return NextResponse.json(
      contracts.list(ws).map((c) => ({ ...c, milestones: milestones.forContract(c.id) })),
    );
  } catch (e) {
    return fail(e);
  }
}

const Deal = z.object({
  client: z.object({ name: z.string().min(1).max(80), email: z.email(), business: z.string().min(1).max(80) }),
  freelancer: z.object({ name: z.string().min(1).max(80), paypalEmail: z.email(), skills: z.string().max(200) }),
  brief: z.string().min(20).max(2000),
  clientLimits: z.object({
    budgetUsd: z.number().positive().max(10000),
    deadlineDays: z.number().int().min(1).max(365),
    mustHaves: z.string().max(500),
  }),
  freelancerLimits: z.object({
    minUsd: z.number().positive().max(10000),
    minDays: z.number().int().min(1).max(365),
    notes: z.string().max(500),
  }),
});

export async function POST(req: Request) {
  try {
    const ws = await workspace();
    const parsed = Deal.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
    }
    return NextResponse.json(newContract(ws, parsed.data));
  } catch (e) {
    return fail(e);
  }
}
