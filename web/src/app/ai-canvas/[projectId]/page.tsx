import { CanvasFrame } from "../canvas-frame";

type CanvasProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function CanvasProjectPage({ params }: CanvasProjectPageProps) {
  const { projectId } = await params;
  return <CanvasFrame projectId={projectId} />;
}
