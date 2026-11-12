import { NextResponse } from "next/server";
import { currentStore, onRootHost } from "@/lib/store";

/** Which store this address belongs to (public: name and slug only). */
export async function GET() {
  const store = await currentStore();
  if (store) return NextResponse.json({ store: { name: store.name, slug: store.slug } });
  return NextResponse.json({ store: null, root: await onRootHost() }, { status: 404 });
}
