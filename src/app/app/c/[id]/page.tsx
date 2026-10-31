import { Suspense } from "react";
import { Room } from "./room";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <Room id={id} />
    </Suspense>
  );
}
