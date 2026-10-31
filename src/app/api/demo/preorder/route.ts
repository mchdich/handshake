// Order endpoint for the sample bakery site in public/demo. Accepts the form and stores nothing.
export async function POST() {
  return Response.json({ ok: true, message: "Pre-order received" });
}
