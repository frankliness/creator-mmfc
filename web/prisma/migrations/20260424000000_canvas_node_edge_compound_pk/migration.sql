ALTER TABLE "CanvasEdge" DROP CONSTRAINT "CanvasEdge_pkey";
ALTER TABLE "CanvasEdge" ADD PRIMARY KEY ("projectId", "id");

ALTER TABLE "CanvasNode" DROP CONSTRAINT "CanvasNode_pkey";
ALTER TABLE "CanvasNode" ADD PRIMARY KEY ("projectId", "id");
